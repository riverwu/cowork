/**
 * Theme loader.
 *
 * Loads a theme directory: parses `theme.json`, parses `theme.md` for the
 * required section structure, dynamically imports layout / component /
 * chrome modules, and returns a `LoadedTheme` ready for the renderer.
 *
 * The loader is the one place where the theme contract is enforced. If a
 * theme is malformed, the loader throws a structured error pointing at
 * the file and section that's wrong.
 */

import { readFile } from "node:fs/promises";
import { resolve, isAbsolute, dirname, join } from "node:path";
import { validateThemeStructure, parseThemeMd, extractGuidance, type ThemeMdSections } from "./validator.js";
import { auditThemeContrast } from "./contrast.js";
import { assertHex } from "../emitter/xml.js";
import { LAYOUT_REGISTRY } from "../layouts/_registry.js";
import { COMPONENT_REGISTRY } from "../components/_registry.js";
import { CHROME_REGISTRY } from "../chrome/_registry.js";
import type {
  LoadedComponent,
  LoadedLayout,
  LoadedTheme,
  RequiredTokens,
  ThemeManifest,
} from "./types.js";

const SLIDEML_CORE_VERSION = "1";

/** Load a theme from an absolute or cwd-relative directory path. */
export async function loadTheme(themeDir: string): Promise<LoadedTheme> {
  const rootDir = isAbsolute(themeDir) ? themeDir : resolve(process.cwd(), themeDir);

  // 1. Read manifest.
  const manifestPath = join(rootDir, "theme.json");
  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, "utf8");
  } catch {
    throw structured("THEME_INVALID", `theme.json missing at ${manifestPath}`);
  }
  let manifest: ThemeManifest;
  try {
    manifest = JSON.parse(manifestRaw) as ThemeManifest;
  } catch (err) {
    throw structured("THEME_INVALID", `theme.json parse error: ${err instanceof Error ? err.message : err}`);
  }

  // 2. Version check.
  if (String(manifest.slidemlVersion) !== SLIDEML_CORE_VERSION) {
    throw structured(
      "THEME_VERSION_MISMATCH",
      `Theme "${manifest.name}" targets SlideML v${manifest.slidemlVersion} but core is v${SLIDEML_CORE_VERSION}. ` +
        `Update the theme or pin slideml to a matching major version.`,
    );
  }

  // 3. Required-token presence + color validation.
  validateRequiredTokens(manifest);

  // 4. Read theme.md, validate structure.
  const docPath = join(rootDir, "theme.md");
  let docRaw: string;
  try {
    docRaw = await readFile(docPath, "utf8");
  } catch {
    throw structured("THEME_INVALID", `theme.md missing at ${docPath}`);
  }

  const layoutNames = manifest.layouts.map((l) => l.name);
  const componentNames = (manifest.components ?? []).map((c) => c.name);
  let docSections: ThemeMdSections;
  try {
    docSections = parseThemeMd(docRaw);
    validateThemeStructure(docSections, { layoutNames, componentNames });
  } catch (err) {
    throw structured("THEME_INVALID", err instanceof Error ? err.message : String(err));
  }

  // 5. Resolve layout/component/chrome from the global registries (Phase A).
  // Themes no longer ship code; the manifest's layouts[]/components[]/chrome[]
  // arrays are now selection lists referencing names in the core registries.
  // The `module:` field on layout/component entries is tolerated but ignored.
  const layouts = new Map<string, LoadedLayout>();
  for (const entry of manifest.layouts) {
    const reg = LAYOUT_REGISTRY.get(entry.name);
    if (!reg) {
      throw structured(
        "THEME_INVALID",
        `Theme "${manifest.name}" references layout "${entry.name}" which is not in the SlideML core registry. ` +
          `Available: ${[...LAYOUT_REGISTRY.keys()].join(", ")}.`,
      );
    }
    const thumbAbs = resolve(rootDir, entry.thumbnail);
    const layoutSubsection = docSections.layoutSubsections[entry.name] ?? "";
    layouts.set(entry.name, {
      entry,
      slots: reg.slots,
      render: reg.render as unknown as LoadedLayout["render"],
      description: docSections.layoutDescriptions[entry.name] ?? "",
      ...(reg.purpose ? { purpose: reg.purpose } : {}),
      thumbnailAbsPath: thumbAbs,
      guidance: extractGuidance(layoutSubsection),
    });
  }

  const components = new Map<string, LoadedComponent>();
  for (const entry of manifest.components ?? []) {
    const reg = COMPONENT_REGISTRY.get(entry.name);
    if (!reg) {
      throw structured(
        "THEME_INVALID",
        `Theme "${manifest.name}" references component "${entry.name}" which is not in the SlideML core registry. ` +
          `Available: ${[...COMPONENT_REGISTRY.keys()].join(", ")}.`,
      );
    }
    components.set(entry.name, {
      entry,
      slots: reg.slots,
      render: reg.render as unknown as LoadedComponent["render"],
    });
  }

  const chrome = new Map<string, (...args: unknown[]) => unknown>();
  for (const name of manifest.chrome ?? []) {
    const fn = CHROME_REGISTRY.get(name);
    if (!fn) {
      throw structured(
        "THEME_INVALID",
        `Theme "${manifest.name}" references chrome "${name}" which is not in the SlideML core registry. ` +
          `Available: ${[...CHROME_REGISTRY.keys()].join(", ")}.`,
      );
    }
    chrome.set(name, fn as unknown as (...args: unknown[]) => unknown);
  }

  // WCAG contrast audit. We warn (stderr) by default and only throw when
  // the theme opted into strict enforcement via `style.contrastTarget`.
  const target = (manifest as { style?: { contrastTarget?: "AA" | "AAA" | "warn" } }).style?.contrastTarget ?? "warn";
  const contrastReport = auditThemeContrast(manifest.tokens, target === "AAA" ? "AAA" : "AA");
  if (!contrastReport.ok) {
    if (target === "warn") {
      for (const w of contrastReport.warnings) {
        process.stderr.write(`[slideml] theme "${manifest.name}" contrast warning: ${w}\n`);
      }
    } else {
      throw structured(
        "THEME_INVALID",
        `Theme "${manifest.name}" fails ${target} contrast checks:\n  - ${contrastReport.warnings.join("\n  - ")}`,
      );
    }
  }

  return {
    manifest,
    rootDir,
    layouts,
    components,
    chrome,
    docSections: docSections.byHeading,
  };
}

function validateRequiredTokens(manifest: ThemeManifest): void {
  const required: Array<keyof RequiredTokens> = [
    "bg-canvas", "bg-card", "brand-primary", "brand-deep",
    "text-strong", "text-muted", "accent", "divider",
    "font-latin", "font-cjk", "font-mono",
  ];
  for (const key of required) {
    if (!(key in manifest.tokens)) {
      throw structured("THEME_INVALID", `Theme "${manifest.name}" missing required token "${key}".`);
    }
  }
  // Color tokens must be 6-char hex (no `#`).
  for (const key of ["bg-canvas", "bg-card", "brand-primary", "brand-deep", "text-strong", "text-muted", "accent", "divider"] as const) {
    const value = manifest.tokens[key];
    if (typeof value !== "string") {
      throw structured("THEME_INVALID", `Theme token "${key}" must be a hex color string.`);
    }
    try {
      assertHex(value, `tokens.${key}`);
    } catch (err) {
      throw structured("THEME_INVALID", err instanceof Error ? err.message : String(err));
    }
  }
  // Font tokens must be non-empty arrays.
  for (const key of ["font-latin", "font-cjk", "font-mono"] as const) {
    const value = manifest.tokens[key];
    if (!Array.isArray(value) || value.length === 0) {
      throw structured("THEME_INVALID", `Theme token "${key}" must be a non-empty string[] (font fallback chain).`);
    }
  }
}

function structured(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

// Re-export for consumers that want the directory of the `theme.json`
// they passed in.
export { dirname };
