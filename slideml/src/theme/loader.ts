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

import { readFile, access } from "node:fs/promises";
import { resolve, isAbsolute, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateThemeStructure, parseThemeMd, extractGuidance, type ThemeMdSections } from "./validator.js";
import { auditThemeContrast } from "./contrast.js";
import { assertHex } from "../emitter/xml.js";
import type {
  LoadedComponent,
  LoadedLayout,
  LoadedTheme,
  RequiredTokens,
  SlotSchema,
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

  // 5. Dynamic-import layout/component/chrome modules.
  const layouts = new Map<string, LoadedLayout>();
  for (const entry of manifest.layouts) {
    const modulePath = resolveModulePath(rootDir, entry.module);
    await assertExists(modulePath, `Layout "${entry.name}" module ${modulePath}`);

    const mod = await dynamicImport(modulePath);
    const slots = mod.slots as Record<string, SlotSchema> | undefined;
    const render = mod.default as ((...args: unknown[]) => unknown) | undefined;
    if (!slots || typeof slots !== "object") {
      throw structured(
        "THEME_INVALID",
        `Layout "${entry.name}" (${modulePath}) must export a \`slots\` object.`,
      );
    }
    if (typeof render !== "function") {
      throw structured(
        "THEME_INVALID",
        `Layout "${entry.name}" (${modulePath}) must default-export a render function.`,
      );
    }

    const thumbAbs = resolve(rootDir, entry.thumbnail);
    const layoutSubsection = docSections.layoutSubsections[entry.name] ?? "";
    layouts.set(entry.name, {
      entry,
      slots,
      render,
      description: docSections.layoutDescriptions[entry.name] ?? "",
      thumbnailAbsPath: thumbAbs,
      guidance: extractGuidance(layoutSubsection),
    });
  }

  const components = new Map<string, LoadedComponent>();
  for (const entry of manifest.components ?? []) {
    const modulePath = resolveModulePath(rootDir, entry.module);
    await assertExists(modulePath, `Component "${entry.name}" module ${modulePath}`);
    const mod = await dynamicImport(modulePath);
    const slots = (mod.slots as Record<string, SlotSchema>) ?? {};
    const render = mod.default as ((...args: unknown[]) => unknown) | undefined;
    if (typeof render !== "function") {
      throw structured(
        "THEME_INVALID",
        `Component "${entry.name}" (${modulePath}) must default-export a render function.`,
      );
    }
    components.set(entry.name, { entry, slots, render });
  }

  const chrome = new Map<string, (...args: unknown[]) => unknown>();
  for (const name of manifest.chrome ?? []) {
    // Convention: chrome modules live at chrome/<name>.{ts|js}
    const modulePath = resolveModulePath(rootDir, `chrome/${name}.js`);
    try {
      await access(modulePath);
    } catch {
      throw structured("THEME_INVALID", `Chrome decoration "${name}" missing at ${modulePath}`);
    }
    const mod = await dynamicImport(modulePath);
    const fn = mod.default as ((...args: unknown[]) => unknown) | undefined;
    if (typeof fn !== "function") {
      throw structured(
        "THEME_INVALID",
        `Chrome "${name}" (${modulePath}) must default-export a function.`,
      );
    }
    chrome.set(name, fn);
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

/** Resolve a module path declared in theme.json, allowing `.ts`/`.js` swap. */
function resolveModulePath(rootDir: string, declared: string): string {
  let resolved = isAbsolute(declared) ? declared : resolve(rootDir, declared);
  // Theme manifests typically declare `.ts` paths for source readability; at
  // runtime we load the compiled `.js`.
  if (resolved.endsWith(".ts")) resolved = `${resolved.slice(0, -3)}.js`;
  return resolved;
}

async function assertExists(path: string, label: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw structured("THEME_INVALID", `${label} not found.`);
  }
}

async function dynamicImport(absPath: string): Promise<Record<string, unknown>> {
  const url = pathToFileURL(absPath).href;
  return (await import(url)) as Record<string, unknown>;
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
