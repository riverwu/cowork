/**
 * Catalog Installer — handles installing/updating skills and MCPs
 * from the bundled catalog to the user's working directory.
 *
 * Skills are stored as files in src/catalog/skills/{id}/ and loaded
 * at build time via Vite's import.meta.glob. On install, they're
 * copied to ~/.cowork/skills/{id}/.
 */

import { writeFile, readFileText, deleteDirectory } from "./tauri";
import { getSkillsDir } from "./ai/skill-loader";
import { getMcpsDir, installMcpToFilesystem } from "./mcp/loader";
import { CATALOG_SKILLS, CATALOG_MCPS } from "./catalog";

export interface InstallStatus {
  id: string;
  catalogVersion: string;
  installedVersion: string | null;
  needsUpdate: boolean;
  installed: boolean;
}

const SKILL_MANIFEST_FILE = ".cowork-skill-manifest.json";

/**
 * Load all catalog skill files at build time.
 * Vite resolves these imports statically — no runtime filesystem access needed.
 *
 * Returns a map: { "deep-research/SKILL.md": "content...", "data-analyzer/scripts/analyze.py": "content...", ... }
 */
const catalogFiles = import.meta.glob<string>("../catalog/skills/**/*", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Get all files for a specific catalog skill. Returns { relativePath: content } */
function getCatalogSkillFiles(id: string): Record<string, string> {
  const prefix = `../catalog/skills/${id}/`;
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(catalogFiles)) {
    if (path.startsWith(prefix)) {
      // Convert "../catalog/skills/pptx/editing.md" → "editing.md"
      const relativePath = path.slice(prefix.length);
      if (!isRuntimeSkillFile(relativePath)) continue;
      files[relativePath] = content;
    }
  }
  return files;
}

function isRuntimeSkillFile(relativePath: string): boolean {
  if (!relativePath || relativePath.startsWith(".")) return false;
  if (/(^|\/)[^/]+\.test\.[cm]?[jt]sx?$/.test(relativePath)) return false;
  if (/(^|\/)__tests__(\/|$)/.test(relativePath)) return false;
  return true;
}

/** Get the SKILL.md content for a catalog skill (for detail display). */
export function getCatalogSkillMd(id: string): string | null {
  const files = getCatalogSkillFiles(id);
  return files["SKILL.md"] || null;
}

/** Get all file names in a catalog skill (for detail display). */
export function getCatalogSkillFileList(id: string): string[] {
  return Object.keys(getCatalogSkillFiles(id));
}

/** Check install status of all catalog skills. */
export async function getSkillInstallStatus(): Promise<InstallStatus[]> {
  const skillsDir = await getSkillsDir();
  const statuses: InstallStatus[] = [];

  for (const skill of CATALOG_SKILLS) {
    let installedVersion: string | null = null;
    let manifestOutOfDate = false;
    const catalogSkillFiles = getCatalogSkillFiles(skill.id);
    try {
      const content = await readFileText(`${skillsDir}/${skill.id}/SKILL.md`);
      const match = content.match(/^version:\s*(.+)$/m);
      installedVersion = match?.[1]?.trim() || "0.0.0";
      try {
        const rawManifest = await readFileText(`${skillsDir}/${skill.id}/${SKILL_MANIFEST_FILE}`);
        manifestOutOfDate = !sameSkillManifest(parseSkillManifest(rawManifest), buildSkillManifest(catalogSkillFiles));
      } catch {
        // Older installs only had SKILL.md version checks. If the bundled
        // skill has auxiliary files, force one update so business.md/scripts
        // cannot lag behind an already-updated SKILL.md.
        manifestOutOfDate = Object.keys(catalogSkillFiles).some((name) => name !== "SKILL.md");
      }
    } catch {
      // Not installed
    }

    statuses.push({
      id: skill.id,
      catalogVersion: skill.version,
      installedVersion,
      installed: installedVersion !== null,
      needsUpdate: installedVersion !== null && (compareVersions(skill.version, installedVersion) > 0 || manifestOutOfDate),
    });
  }

  return statuses;
}

/** Check install status of all catalog MCPs. */
export async function getMcpInstallStatus(): Promise<InstallStatus[]> {
  const mcpsDir = await getMcpsDir();
  const statuses: InstallStatus[] = [];

  for (const mcp of CATALOG_MCPS) {
    let installedVersion: string | null = null;
    try {
      const content = await readFileText(`${mcpsDir}/${mcp.id}/MCP.json`);
      const parsed = JSON.parse(content);
      installedVersion = parsed.version || "0.0.0";
    } catch {
      // Not installed
    }

    statuses.push({
      id: mcp.id,
      catalogVersion: mcp.version,
      installedVersion,
      installed: installedVersion !== null,
      needsUpdate: installedVersion !== null && compareVersions(mcp.version, installedVersion) > 0,
    });
  }

  return statuses;
}

export interface SkillSyncResult {
  updated: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * Keep already-installed bundled skills aligned with the packaged catalog.
 * This deliberately does not install skills the user has never installed; it
 * only repairs stale installed copies so the agent reads the current guidance.
 */
export async function syncInstalledCatalogSkills(): Promise<SkillSyncResult> {
  const statuses = await getSkillInstallStatus();
  const result: SkillSyncResult = { updated: [], failed: [] };

  for (const status of statuses) {
    if (!status.installed || !status.needsUpdate) continue;
    try {
      await installCatalogSkill(status.id);
      result.updated.push(status.id);
    } catch (err) {
      result.failed.push({
        id: status.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/** Install a skill from the catalog — copies all files to ~/.cowork/skills/{id}/ */
export async function installCatalogSkill(id: string): Promise<void> {
  const skill = CATALOG_SKILLS.find((s) => s.id === id);
  if (!skill) throw new Error(`Skill '${id}' not found in catalog`);

  const skillsDir = await getSkillsDir();
  const skillDir = `${skillsDir}/${id}`;
  const files = getCatalogSkillFiles(id);

  if (Object.keys(files).length === 0) {
    throw new Error(`No catalog files found for skill '${id}'`);
  }

  // Write all files (SKILL.md, scripts, reference docs, etc.)
  for (const [relativePath, content] of Object.entries(files)) {
    await writeFile(`${skillDir}/${relativePath}`, content);
  }
  await writeFile(`${skillDir}/${SKILL_MANIFEST_FILE}`, JSON.stringify(buildSkillManifest(files), null, 2));
}

/** Install an MCP from the catalog. */
export async function installCatalogMcp(id: string): Promise<void> {
  const mcp = CATALOG_MCPS.find((m) => m.id === id);
  if (!mcp) throw new Error(`MCP '${id}' not found in catalog`);

  await installMcpToFilesystem(id, mcp.definition);
}

/**
 * Uninstall an installed skill by removing its directory under
 * ~/.cowork/skills/. Accepts either a directory name (e.g. "pptx") or an
 * absolute path to the skill directory. The caller is expected to reload
 * the skill registry afterwards.
 */
export async function uninstallSkill(target: string): Promise<void> {
  if (!target) throw new Error("Skill target is required for uninstall");
  let dirPath: string;
  if (target.startsWith("/")) {
    dirPath = target;
  } else {
    const skillsDir = await getSkillsDir();
    dirPath = `${skillsDir}/${target}`;
  }
  await deleteDirectory(dirPath);
}

/** Simple semver comparison: returns >0 if a > b, <0 if a < b, 0 if equal. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

interface SkillManifest {
  version: 1;
  files: Record<string, { length: number; hash: string }>;
}

function buildSkillManifest(files: Record<string, string>): SkillManifest {
  return {
    version: 1,
    files: Object.fromEntries(
      Object.entries(files)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, content]) => [name, { length: content.length, hash: hashString(content) }]),
    ),
  };
}

function parseSkillManifest(raw: string): SkillManifest | null {
  try {
    const parsed = JSON.parse(raw) as SkillManifest;
    if (parsed?.version !== 1 || !parsed.files || typeof parsed.files !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function sameSkillManifest(a: SkillManifest | null, b: SkillManifest): boolean {
  if (!a) return false;
  const aFiles = Object.keys(a.files).sort();
  const bFiles = Object.keys(b.files).sort();
  if (aFiles.length !== bFiles.length) return false;
  for (let i = 0; i < aFiles.length; i++) {
    const name = aFiles[i]!;
    if (name !== bFiles[i]) return false;
    const left = a.files[name];
    const right = b.files[name];
    if (!left || !right || left.length !== right.length || left.hash !== right.hash) return false;
  }
  return true;
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
