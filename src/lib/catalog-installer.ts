/**
 * Catalog Installer — handles installing/updating skills and MCPs
 * from the bundled catalog to the user's working directory.
 */

import { writeFile, readFileText } from "./tauri";
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

/** Check install status of all catalog skills. */
export async function getSkillInstallStatus(): Promise<InstallStatus[]> {
  const skillsDir = await getSkillsDir();
  const statuses: InstallStatus[] = [];

  for (const skill of CATALOG_SKILLS) {
    let installedVersion: string | null = null;
    try {
      const content = await readFileText(`${skillsDir}/${skill.id}/SKILL.md`);
      const match = content.match(/^version:\s*(.+)$/m);
      installedVersion = match?.[1]?.trim() || "0.0.0";
    } catch {
      // Not installed
    }

    statuses.push({
      id: skill.id,
      catalogVersion: skill.version,
      installedVersion,
      installed: installedVersion !== null,
      needsUpdate: installedVersion !== null && compareVersions(skill.version, installedVersion) > 0,
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

/** Install a skill from the catalog. */
export async function installCatalogSkill(id: string): Promise<void> {
  const skill = CATALOG_SKILLS.find((s) => s.id === id);
  if (!skill) throw new Error(`Skill '${id}' not found in catalog`);

  const skillsDir = await getSkillsDir();
  const skillDir = `${skillsDir}/${id}`;

  // Write SKILL.md
  await writeFile(`${skillDir}/SKILL.md`, skill.skillMd);

  // Write scripts if any
  if (skill.scripts) {
    for (const [filename, content] of Object.entries(skill.scripts)) {
      await writeFile(`${skillDir}/scripts/${filename}`, content);
    }
  }
}

/** Install an MCP from the catalog. */
export async function installCatalogMcp(id: string): Promise<void> {
  const mcp = CATALOG_MCPS.find((m) => m.id === id);
  if (!mcp) throw new Error(`MCP '${id}' not found in catalog`);

  await installMcpToFilesystem(id, mcp.definition);
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
