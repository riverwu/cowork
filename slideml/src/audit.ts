/**
 * OOXML conformance audit (library form).
 *
 * Catches the kind of bugs that LibreOffice silently tolerates but
 * PowerPoint rejects ("file corrupted / needs repair"). The script in
 * `scripts/conformance-audit.mjs` has driven CI for a while; this module
 * exposes the same logic as a callable function so it can be used from
 * the CLI (`slideml audit`) and from cowork tools (`audit_pptx`).
 *
 * Three checks (all pure: read the .pptx as a ZIP, no subprocess):
 *   1. ZIP hygiene — no directory entries, every file extension in
 *      Content_Types defaults.
 *   2. Content_Types ↔ parts consistency — every <Override PartName=...>
 *      points to an actual file in the zip.
 *   3. Rels integrity — every <Relationship Target=...> resolves to an
 *      existing part; rId1 of every slide-rels is the slideLayout.
 *
 * Returns a structured `AuditReport` with severity-tagged issues and
 * package-level stats. Callers decide what to do on errors.
 */

import { readFile } from "node:fs/promises";
import JSZip from "jszip";

export type Severity = "error" | "warn";

export interface AuditIssue {
  severity: Severity;
  code: string;
  message: string;
}

export interface AuditReport {
  ok: boolean;
  path: string;
  stats: {
    slides: number;
    parts: number;
    media: number;
    charts: number;
    notesSlides: number;
  };
  issues: AuditIssue[];
}

/** Audit a .pptx file at `path`. Returns the structured report. */
export async function auditPptx(path: string): Promise<AuditReport> {
  const buf = await readFile(path);
  return auditPptxBuffer(buf, path);
}

/** Audit a .pptx already in memory. */
export async function auditPptxBuffer(buf: Buffer | Uint8Array, path = "<buffer>"): Promise<AuditReport> {
  const issues: AuditIssue[] = [];
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (err) {
    return {
      ok: false,
      path,
      stats: { slides: 0, parts: 0, media: 0, charts: 0, notesSlides: 0 },
      issues: [{ severity: "error", code: "ZIP_INVALID", message: `Cannot open as ZIP: ${err instanceof Error ? err.message : err}` }],
    };
  }

  const allEntries = Object.keys(zip.files);
  const fileEntries = allEntries.filter((n) => !zip.files[n]!.dir);
  const dirEntries = allEntries.filter((n) => zip.files[n]!.dir);
  const fileSet = new Set(fileEntries);

  // 1. ZIP hygiene
  for (const d of dirEntries) {
    issues.push({
      severity: "error",
      code: "DIR_ENTRY",
      message: `ZIP contains a directory entry "${d}". OPC forbids these and PowerPoint rejects the file.`,
    });
  }

  // Read [Content_Types].xml
  const ctEntry = zip.file("[Content_Types].xml");
  if (!ctEntry) {
    issues.push({ severity: "error", code: "MISSING_CONTENT_TYPES", message: "[Content_Types].xml is missing." });
    return finish(path, fileEntries, issues);
  }
  const ct = await ctEntry.async("string");

  // 2. Content_Types ↔ parts
  for (const m of ct.matchAll(/<Override\s+PartName="\/([^"]+)"/g)) {
    const part = m[1]!;
    if (!fileSet.has(part)) {
      issues.push({
        severity: "error",
        code: "OVERRIDE_MISSING_PART",
        message: `Content_Types declares /${part} but the file is missing from the zip.`,
      });
    }
  }
  // Every file extension used should have a Default or be covered by an Override.
  const defaults = new Set([...ct.matchAll(/<Default\s+Extension="([^"]+)"/g)].map((m) => m[1]!.toLowerCase()));
  const overridePaths = new Set([...ct.matchAll(/<Override\s+PartName="\/([^"]+)"/g)].map((m) => m[1]!));
  for (const f of fileEntries) {
    if (overridePaths.has(f)) continue;
    if (f === "[Content_Types].xml") continue;
    const dot = f.lastIndexOf(".");
    if (dot < 0) continue;
    const ext = f.slice(dot + 1).toLowerCase();
    if (!defaults.has(ext)) {
      issues.push({
        severity: "warn",
        code: "MISSING_CONTENT_TYPE",
        message: `${f} has no Override or Default for extension ".${ext}".`,
      });
    }
  }

  // 3. Rels integrity
  for (const entry of fileEntries) {
    if (!entry.endsWith(".rels")) continue;
    const body = await zip.file(entry)!.async("string");
    const baseDir = dirname(entry).replace(/\/?_rels$/, "");
    const seenIds = new Set<string>();
    for (const m of body.matchAll(/<Relationship\s+Id="([^"]+)"[^>]*Type="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      const id = m[1]!;
      const target = m[3]!;
      if (seenIds.has(id)) {
        issues.push({
          severity: "error",
          code: "REL_DUPLICATE_ID",
          message: `${entry}: duplicate Relationship Id "${id}".`,
        });
      }
      seenIds.add(id);
      if (target.startsWith("http") || target.startsWith("#")) continue;
      const resolved = normalize(joinPath(baseDir, target));
      if (!fileSet.has(resolved)) {
        issues.push({
          severity: "error",
          code: "REL_TARGET_MISSING",
          message: `${entry}: Relationship Id="${id}" Target="${target}" → /${resolved} not present in package.`,
        });
      }
    }

    // Slide-rels invariant: rId1 must be the slideLayout relationship.
    if (/^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(entry)) {
      if (!/<Relationship\s+Id="rId1"[^>]*Type="[^"]+\/slideLayout"/.test(body)) {
        issues.push({
          severity: "error",
          code: "SLIDE_RELS_RID1",
          message: `${entry}: rId1 must be the slideLayout relationship.`,
        });
      }
    }
  }

  return finish(path, fileEntries, issues);
}

function finish(path: string, fileEntries: string[], issues: AuditIssue[]): AuditReport {
  const stats = {
    slides: fileEntries.filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length,
    parts: fileEntries.length,
    media: fileEntries.filter((f) => f.startsWith("ppt/media/")).length,
    charts: fileEntries.filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f)).length,
    notesSlides: fileEntries.filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f)).length,
  };
  return {
    ok: !issues.some((i) => i.severity === "error"),
    path,
    stats,
    issues,
  };
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function joinPath(a: string, b: string): string {
  if (!a) return b;
  return `${a.replace(/\/$/, "")}/${b.replace(/^\.?\//, "")}`;
}

function normalize(p: string): string {
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}
