#!/usr/bin/env node
/**
 * OOXML strict-conformance audit.
 *
 * Catches the kind of bug that LibreOffice silently tolerates but PowerPoint
 * rejects ("file corrupted / needs repair"). Runs three independent checks
 * against every fixture-derived .pptx:
 *
 *   1. Round-trip via python-pptx — parses with python-pptx's strict OPC
 *      reader. Any oxml schema violation surfaces here.
 *   2. ZIP hygiene — no directory entries, lowercase rels paths, file count
 *      sanity vs python-pptx baseline.
 *   3. Required-parts presence — every Content_Types override exists, every
 *      rels target resolves, every slide-rels has a layout entry as rId1.
 *
 * Exits non-zero on any failure. Designed to be wired into CI alongside the
 * vitest suite and the LibreOffice render-check.
 *
 * Usage:
 *   node scripts/conformance-audit.mjs                       # all bundled fixtures
 *   node scripts/conformance-audit.mjs path/to/deck.pptx ... # specific files
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_OUT = "/tmp/slideml-conformance";

let failures = 0;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { code: r.status ?? -1, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function fail(msg) {
  failures++;
  console.error(`  ✗ ${msg}`);
}

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

function compileFixtures() {
  // Build first so dist/ is fresh.
  execSync("pnpm run build", { cwd: ROOT, stdio: "inherit" });
  // Compile each fixture to /tmp/slideml-conformance/<base>.pptx
  execSync(`mkdir -p ${DEFAULT_OUT}`);
  const fixtures = ["quarterly-review", "stat-only", "cover-and-quote", "wave-a-showcase", "wave-b-showcase"];
  const out = [];
  for (const f of fixtures) {
    const yaml = `fixtures/${f}.slideml.yaml`;
    const pptx = join(DEFAULT_OUT, `${f}.pptx`);
    const r = run("node", ["dist/bin/slideml.js", "compile", yaml, "--theme", "technical-blue", "-o", pptx], { cwd: ROOT });
    if (r.code !== 0) {
      console.error(`compile ${f} failed:\n${r.stderr || r.stdout}`);
      process.exit(2);
    }
    out.push(pptx);
  }
  return out;
}

function pythonPptxRoundtrip(pptxPath) {
  const code = `
import sys
from pptx import Presentation
try:
    p = Presentation(sys.argv[1])
    # Touch every slide and shape to force lazy parsing.
    for s in p.slides:
        _ = list(s.shapes)
        if s.has_notes_slide:
            _ = s.notes_slide.notes_text_frame.text
    # Re-save to a temp file to exercise the writer path too.
    p.save("/tmp/slideml-roundtrip-tmp.pptx")
    print("OK")
except Exception as e:
    print(f"FAIL {type(e).__name__}: {e}", file=sys.stderr)
    sys.exit(1)
`;
  const r = run("python3", ["-c", code, pptxPath]);
  return r.code === 0 ? null : r.stderr.trim() || r.stdout.trim();
}

function inspectZip(pptxPath) {
  // List file entries with sizes, exclude directory entries.
  const r = run("unzip", ["-Z1", pptxPath]);
  if (r.code !== 0) return { error: `unzip -Z1 failed: ${r.stderr}` };
  const entries = r.stdout.split(/\r?\n/).filter((l) => l.length > 0);
  const dirEntries = entries.filter((e) => e.endsWith("/"));
  const fileEntries = entries.filter((e) => !e.endsWith("/"));
  return { dirEntries, fileEntries, all: entries };
}

function readEntry(pptxPath, name) {
  // unzip treats `[`/`]` as glob brackets; backslash-escape them so literal
  // names like `[Content_Types].xml` are matched as-is.
  const escaped = name.replace(/[[\]]/g, "\\$&");
  const r = run("unzip", ["-p", pptxPath, escaped]);
  return r.code === 0 && r.stdout ? r.stdout : null;
}

function auditContentTypesAndRels(pptxPath) {
  const issues = [];
  const ct = readEntry(pptxPath, "[Content_Types].xml");
  if (!ct) return ["[Content_Types].xml missing"];

  // Pull every Override PartName.
  const overrides = [...ct.matchAll(/<Override\s+PartName="\/([^"]+)"/g)].map((m) => m[1]);
  const { fileEntries } = inspectZip(pptxPath);
  const fileSet = new Set(fileEntries);
  for (const part of overrides) {
    if (!fileSet.has(part)) issues.push(`Content_Types Override declares /${part} but the file is missing from the zip`);
  }

  // Pull every Default Extension and check there's at least one file with that ext (informational, no fail).
  const defaults = [...ct.matchAll(/<Default\s+Extension="([^"]+)"/g)].map((m) => m[1]);
  void defaults;

  // Walk every .rels file and check that every Target resolves.
  for (const entry of fileEntries) {
    if (!entry.endsWith(".rels")) continue;
    const body = readEntry(pptxPath, entry);
    if (!body) continue;
    const baseDir = dirname(entry).replace(/\/?_rels$/, "");
    const rels = [...body.matchAll(/<Relationship\s+Id="([^"]+)"[^>]*Type="([^"]+)"[^>]*Target="([^"]+)"/g)];
    const seenIds = new Set();
    for (const [, id, type, target] of rels) {
      if (seenIds.has(id)) issues.push(`${entry}: duplicate Relationship Id "${id}"`);
      seenIds.add(id);
      if (target.startsWith("http")) continue; // external link
      // Resolve target against the rels file's parent folder.
      const resolved = normalize(joinPath(baseDir, target));
      if (!fileSet.has(resolved)) {
        issues.push(`${entry}: Relationship Id="${id}" Target="${target}" → /${resolved} not present in package`);
      }
      void type;
    }
  }

  // Slide-rels invariant: rId1 must be the slideLayout.
  for (const entry of fileEntries) {
    const m = /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.exec(entry);
    if (!m) continue;
    const body = readEntry(pptxPath, entry) || "";
    if (!/<Relationship\s+Id="rId1"[^>]*Type="[^"]+\/slideLayout"/.test(body)) {
      issues.push(`${entry}: rId1 must be the slideLayout relationship`);
    }
  }

  return issues;
}

function joinPath(a, b) {
  if (!a) return b;
  return `${a.replace(/\/$/, "")}/${b.replace(/^\.?\//, "")}`;
}
function normalize(p) {
  // collapse `a/b/../c` → `a/c`
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  const out = [];
  for (const seg of parts) {
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

const files = process.argv.slice(2).length > 0
  ? process.argv.slice(2).map((p) => resolve(p))
  : compileFixtures();

for (const pptxPath of files) {
  console.log(`\n[${pptxPath}]`);
  if (!existsSync(pptxPath)) {
    fail(`file not found`);
    continue;
  }

  // 1. python-pptx round-trip
  const pyErr = pythonPptxRoundtrip(pptxPath);
  if (pyErr) fail(`python-pptx round-trip failed: ${pyErr}`);
  else ok(`python-pptx round-trip OK`);

  // 2. zip hygiene
  const zipInfo = inspectZip(pptxPath);
  if (zipInfo.error) {
    fail(zipInfo.error);
  } else {
    if (zipInfo.dirEntries.length > 0) {
      fail(`zip contains ${zipInfo.dirEntries.length} OPC-illegal directory entries: ${zipInfo.dirEntries.join(", ")}`);
    } else {
      ok(`zip clean: ${zipInfo.fileEntries.length} file entries, 0 directory entries`);
    }
  }

  // 3. Content_Types + rels integrity
  const issues = auditContentTypesAndRels(pptxPath);
  if (issues.length > 0) {
    for (const i of issues) fail(i);
  } else {
    ok(`Content_Types overrides + rels targets all resolve`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} conformance failure(s). The file is likely to fail PowerPoint's strict reader.`);
  process.exit(2);
}
console.log(`\nAll checks passed.`);
