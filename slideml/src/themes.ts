/**
 * Theme discovery — list and describe themes installed on this machine.
 *
 * Two surfaces:
 *   - `listInstalledThemes()` returns a compact summary per theme,
 *     including routing metadata (audiences/industries/moods) so an
 *     agent can pick a theme without first loading its layouts.
 *   - `describeTheme(name)` returns the full theme detail: imagery
 *     guidance, palette tokens, layout list, voice tips. The agent
 *     calls this AFTER picking a theme to learn how to keep
 *     image_gen / text content visually coherent.
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ThemeSummary {
  name: string;
  displayName: string;
  description: string;
  source: "builtin" | "user";
  rootDir: string;
  /** First bullet under "## When to use this theme" in theme.md. */
  whenToUse?: string;
  /** Routing metadata from theme.json `meta` block. */
  audiences?: string[];
  industries?: string[];
  moods?: string[];
  antiPatterns?: string[];
}

export interface ThemeDetail extends ThemeSummary {
  /** Hex tokens (the deck's palette anchors). */
  palette: Record<string, string>;
  /** Major / minor font names (from oxml.fontScheme or font-latin). */
  typography: {
    headingFamily: string;
    bodyFamily: string;
  };
  /** Image generation guidance — feed into image_gen prompts. */
  imagery?: {
    guidance?: string;
    palette?: string[];
    avoid?: string[];
    preferredStyles?: string[];
  };
  /** Voice / tone for text content. */
  voice?: { tone?: string; avoid?: string[] };
  /** Names of every layout this theme provides. */
  layouts: string[];
  /** Style flags primitives consume (titleAccentRule etc.). */
  style: {
    titleAccentRule: boolean;
    contrastTarget: "warn" | "AA" | "AAA";
  };
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

/**
 * Full theme detail by name — call this AFTER `listInstalledThemes`
 * narrowed the choice. Includes imagery guidance, palette, and the
 * layout list so the agent can plan slide composition + image
 * generation in one round-trip.
 */
export async function describeInstalledTheme(name: string): Promise<ThemeDetail | null> {
  for (const [dir, source] of [[BUILTIN_DIR, "builtin"], [USER_DIR, "user"]] as const) {
    const themeDir = join(dir, name);
    if (!existsSync(join(themeDir, "theme.json"))) continue;
    return readThemeDeep(themeDir, source);
  }
  return null;
}

// ---------------------------------------------------------------------------

async function readThemeShallow(themeDir: string, source: "builtin" | "user"): Promise<ThemeSummary | null> {
  const manifestPath = join(themeDir, "theme.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = await readFile(manifestPath, "utf8");
    const m = JSON.parse(raw) as ManifestShape;
    if (!m.name) return null;
    return {
      name: m.name,
      displayName: m.displayName ?? m.name,
      description: m.description ?? "",
      source,
      rootDir: themeDir,
      whenToUse: await firstUseBullet(themeDir),
      audiences:    m.meta?.audiences ? [...m.meta.audiences] : undefined,
      industries:   m.meta?.industries ? [...m.meta.industries] : undefined,
      moods:        m.meta?.moods ? [...m.meta.moods] : undefined,
      antiPatterns: m.meta?.antiPatterns ? [...m.meta.antiPatterns] : undefined,
    };
  } catch {
    return null;
  }
}

async function readThemeDeep(themeDir: string, source: "builtin" | "user"): Promise<ThemeDetail | null> {
  const summary = await readThemeShallow(themeDir, source);
  if (!summary) return null;
  const raw = await readFile(join(themeDir, "theme.json"), "utf8");
  const m = JSON.parse(raw) as ManifestShape;
  const palette: Record<string, string> = {};
  for (const [k, v] of Object.entries(m.tokens ?? {})) {
    if (typeof v === "string") palette[k] = v;
  }
  const fontStack = m.tokens?.["font-latin"];
  const fallbackFont = Array.isArray(fontStack) && typeof fontStack[0] === "string" ? fontStack[0] : "Inter";
  return {
    ...summary,
    palette,
    typography: {
      headingFamily: m.oxml?.fontScheme?.majorLatin ?? fallbackFont,
      bodyFamily:    m.oxml?.fontScheme?.minorLatin ?? fallbackFont,
    },
    imagery: m.style?.imagery
      ? {
          guidance: m.style.imagery.guidance,
          palette:  m.style.imagery.palette ? [...m.style.imagery.palette] : undefined,
          avoid:    m.style.imagery.avoid ? [...m.style.imagery.avoid] : undefined,
          preferredStyles: m.style.imagery.preferredStyles ? [...m.style.imagery.preferredStyles] : undefined,
        }
      : undefined,
    voice: m.style?.voice
      ? { tone: m.style.voice.tone, avoid: m.style.voice.avoid ? [...m.style.voice.avoid] : undefined }
      : undefined,
    layouts: (m.layouts ?? []).map((l) => l.name).filter((n): n is string => !!n),
    style: {
      titleAccentRule: m.style?.titleAccentRule ?? true,
      contrastTarget:  m.style?.contrastTarget ?? "warn",
    },
  };
}

async function firstUseBullet(themeDir: string): Promise<string | undefined> {
  const mdPath = join(themeDir, "theme.md");
  if (!existsSync(mdPath)) return undefined;
  try {
    const md = await readFile(mdPath, "utf8");
    const m = /##\s+When to use this theme[^\n]*\n+([\s\S]*?)(?:\n##|\n$)/i.exec(md);
    if (!m) return undefined;
    const bullet = /^[-*]\s+(.+)$/m.exec(m[1]!);
    return bullet ? bullet[1]!.trim() : undefined;
  } catch {
    return undefined;
  }
}

interface ManifestShape {
  name?: string;
  displayName?: string;
  description?: string;
  tokens?: Record<string, unknown>;
  layouts?: Array<{ name?: string }>;
  meta?: {
    audiences?: readonly string[];
    industries?: readonly string[];
    moods?: readonly string[];
    antiPatterns?: readonly string[];
  };
  style?: {
    titleAccentRule?: boolean;
    contrastTarget?: "warn" | "AA" | "AAA";
    imagery?: {
      guidance?: string;
      palette?: readonly string[];
      avoid?: readonly string[];
      preferredStyles?: readonly string[];
    };
    voice?: { tone?: string; avoid?: readonly string[] };
  };
  oxml?: {
    fontScheme?: { majorLatin?: string; minorLatin?: string };
  };
}
