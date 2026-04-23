/**
 * Skill Loader — scans ~/.cowork/skills/ directory and loads SKILL.md files.
 *
 * Filesystem is source of truth. DB (apps table) is just an index.
 *
 * Directory structure per skill:
 *   skill-name/
 *     SKILL.md        ← required, YAML frontmatter + markdown body
 *     scripts/        ← optional, executable scripts
 *     references/     ← optional, reference documents
 *     assets/         ← optional, templates/images
 *
 * SKILL.md format:
 *   ---
 *   name: image-generator
 *   type: skill          # "skill" (tool) or "app" (workflow)
 *   description: Generate images using AI models
 *   parameters:
 *     prompt: Image description
 *   config:
 *     API_KEY: Your image API key
 *   ---
 *   ## Instructions
 *   - Use the image generation API at $API_KEY endpoint
 *   - Save output to the working directory
 */

import { readFileText, listDirectory } from "@/lib/tauri";
import { getEnv } from "@/lib/tauri";
import type { SkillRecord, SkillDefinition, SkillType } from "@/types";

export interface LoadedSkill {
  /** Parsed skill record (for DB index and agent use). */
  record: SkillRecord;
  /** Filesystem path to the skill directory. */
  dirPath: string;
  /** Path to SKILL.md. */
  skillMdPath: string;
  /** Whether scripts/ directory exists. */
  hasScripts: boolean;
}

/** Skills directory path. */
export async function getSkillsDir(): Promise<string> {
  const home = await getEnv("HOME") || "/tmp";
  return `${home}/.cowork/skills`;
}

/** Scan ~/.cowork/skills/ and load all SKILL.md files. */
export async function loadSkillsFromFilesystem(): Promise<LoadedSkill[]> {
  const skillsDir = await getSkillsDir();
  const loaded: LoadedSkill[] = [];

  let entries;
  try {
    entries = await listDirectory(skillsDir);
  } catch {
    // Directory doesn't exist yet — that's fine
    return [];
  }

  for (const entry of entries) {
    if (!entry.is_dir) continue;

    const dirPath = entry.path;
    const skillMdPath = `${dirPath}/SKILL.md`;

    try {
      const content = await readFileText(skillMdPath);
      const parsed = parseSkillMd(content, entry.name, dirPath);
      if (parsed) {
        // Check for scripts directory
        let hasScripts = false;
        try {
          const subEntries = await listDirectory(dirPath);
          hasScripts = subEntries.some((e) => e.is_dir && e.name === "scripts");
        } catch { /* ignore */ }

        loaded.push({
          record: parsed,
          dirPath,
          skillMdPath,
          hasScripts,
        });
      }
    } catch {
      // No SKILL.md or can't read — skip
    }
  }

  return loaded;
}

/** Parse a SKILL.md file into a SkillRecord. */
function parseSkillMd(content: string, dirName: string, _dirPath: string): SkillRecord | null {
  const { frontmatter, body } = parseFrontmatter(content);
  if (!frontmatter) return null;

  const name = String(frontmatter.name || dirName);
  const type: SkillType = frontmatter.type === "app" ? "app" : "skill";
  const description = String(frontmatter.description || "");

  // Parse parameters from frontmatter
  let parameters: SkillDefinition["parameters"] | undefined;
  if (frontmatter.parameters && typeof frontmatter.parameters === "object") {
    const p: Record<string, { description: string }> = {};
    for (const [key, value] of Object.entries(frontmatter.parameters as Record<string, unknown>)) {
      p[key] = { description: typeof value === "string" ? value : String(value) };
    }
    if (Object.keys(p).length > 0) parameters = p;
  }

  // Parse required config (API keys etc.)
  let requiredConfig: SkillDefinition["requiredConfig"] | undefined;
  if (frontmatter.config && typeof frontmatter.config === "object") {
    const c: Record<string, string> = {};
    for (const [key, value] of Object.entries(frontmatter.config as Record<string, unknown>)) {
      c[key] = typeof value === "string" ? value : String(value);
    }
    if (Object.keys(c).length > 0) requiredConfig = c;
  }

  // Parse instructions from markdown body
  const instructions = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- ") || l.startsWith("* "))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);

  const definition: SkillDefinition = {
    purpose: description,
    instructions: instructions.length > 0 ? instructions : undefined,
    parameters,
    requiredConfig,
  };

  return {
    id: `fs_${dirName}`,
    name,
    type,
    version: 1,
    definition,
    config: {},
    status: "active",
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Simple YAML-like frontmatter parser (between --- delimiters). */
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown> | null; body: string } {
  const lines = content.split("\n");
  if (lines[0].trim() !== "---") {
    return { frontmatter: null, body: content };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex < 0) {
    return { frontmatter: null, body: content };
  }

  const yamlLines = lines.slice(1, endIndex);
  const body = lines.slice(endIndex + 1).join("\n").trim();
  const frontmatter = parseSimpleYaml(yamlLines);

  return { frontmatter, body };
}

/** Minimal YAML parser — handles key: value and nested objects (one level). */
function parseSimpleYaml(lines: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentObj: Record<string, string> | null = null;

  for (const line of lines) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;

    if (indent >= 2 && currentKey) {
      // Nested key-value pair
      const match = line.trim().match(/^(\w+)\s*:\s*(.+)$/);
      if (match) {
        if (!currentObj) currentObj = {};
        currentObj[match[1]] = match[2].trim();
      }
    } else {
      // Top-level key
      if (currentKey && currentObj) {
        result[currentKey] = currentObj;
        currentObj = null;
      }

      const match = line.match(/^(\w+)\s*:\s*(.*)$/);
      if (match) {
        const key = match[1];
        const value = match[2].trim();
        if (value) {
          result[key] = value;
          currentKey = null;
        } else {
          // Object start
          currentKey = key;
          currentObj = {};
        }
      }
    }
  }

  if (currentKey && currentObj) {
    result[currentKey] = currentObj;
  }

  return result;
}
