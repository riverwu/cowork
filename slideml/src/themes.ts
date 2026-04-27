/**
 * Theme discovery — list themes installed on this machine.
 *
 * Walks both built-in themes (shipped under `dist/themes/`) and user
 * themes (`~/.cowork/themes/`). Reads each theme.json shallowly to
 * surface name + displayName + description + a one-line "when to use"
 * extracted from theme.md so an agent can pick a theme without first
 * loading every layout file.
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ThemeSummary {
  /** Theme id (also the directory name). Pass to `--theme` / tools. */
  name: string;
  /** Human-friendly name from theme.json `displayName`. */
  displayName: string;
  /** One-line description from theme.json `description`. */
  description: string;
  /** Where this theme came from. */
  source: "builtin" | "user";
  /** Absolute directory path. */
  rootDir: string;
  /** First bullet under "## When to use this theme" in theme.md. */
  whenToUse?: string;
}

const BUILTIN_DIR = resolve(__dirname, "themes");
const USER_DIR = join(homedir(), ".cowork", "themes");

/**
 * Enumerate every installed theme. Built-in themes come first; user
 * themes follow. A user theme with the same name as a built-in
 * shadows it (the user copy wins when looked up by name elsewhere).
 */
export async function listInstalledThemes(): Promise<ThemeSummary[]> {
  const out: ThemeSummary[] = [];
  const seen = new Set<string>();

  for (const [dir, source] of [[BUILTIN_DIR, "builtin"], [USER_DIR, "user"]] as const) {
    if (!existsSync(dir)) continue;
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (seen.has(name)) continue;
      const themeDir = join(dir, name);
      const summary = await readThemeShallow(themeDir, source);
      if (summary) {
        out.push(summary);
        seen.add(summary.name);
      }
    }
  }
  return out;
}

async function readThemeShallow(themeDir: string, source: "builtin" | "user"): Promise<ThemeSummary | null> {
  const manifestPath = join(themeDir, "theme.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = await readFile(manifestPath, "utf8");
    const m = JSON.parse(raw) as { name?: string; displayName?: string; description?: string };
    if (!m.name) return null;
    let whenToUse: string | undefined;
    const mdPath = join(themeDir, "theme.md");
    if (existsSync(mdPath)) {
      try {
        const md = await readFile(mdPath, "utf8");
        whenToUse = firstUseBullet(md);
      } catch { /* ignore */ }
    }
    return {
      name: m.name,
      displayName: m.displayName ?? m.name,
      description: m.description ?? "",
      source,
      rootDir: themeDir,
      whenToUse,
    };
  } catch {
    return null;
  }
}

function firstUseBullet(md: string): string | undefined {
  // Match the first `- ...` line under `## When to use this theme`.
  const m = /##\s+When to use this theme[^\n]*\n+([\s\S]*?)(?:\n##|\n$)/i.exec(md);
  if (!m) return undefined;
  const block = m[1]!;
  const bullet = /^[-*]\s+(.+)$/m.exec(block);
  return bullet ? bullet[1]!.trim() : undefined;
}
