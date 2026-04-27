/**
 * SlideML — public API surface.
 *
 * This is the ONLY file external callers should import from. Internal modules
 * are not re-exported. See SPEC.md → "Public API surface" for the contract.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parseSlideml } from "./parser.js";
import { renderDeck, type DeckSpec } from "./render/index.js";
import { emitPackage } from "./emitter/package.js";
import { loadTheme as internalLoadTheme } from "./theme/loader.js";
import { validateDeckSpec, type SlidemlValidationError } from "./validator.js";
import type { LoadedTheme, SlotSchema } from "./theme/types.js";
import { exampleForSlot } from "./slot-examples.js";

export type { Length, DeckSize } from "./units.js";
export { toEmu, cm, inch, pt, SLIDE_SIZES } from "./units.js";
export type { FontHint } from "./fonts.js";
export { fontStackFor, cjkHintForLanguage, primaryFontFace } from "./fonts.js";
export type {
  HexColor,
  TokenValue,
  Tokens,
  RequiredTokens,
  LayoutEntry,
  ComponentEntry,
  ThemeManifest,
  LoadedLayout,
  LoadedComponent,
  LoadedTheme,
  SlotSchema,
} from "./theme/types.js";
export type { DeckSpec, SlideSpec } from "./render/index.js";

export interface CompileOptions {
  /** Path to a theme package directory, OR a pre-loaded theme. */
  themeDir?: string;
  theme?: LoadedTheme;
  /** If set, also writes the produced .pptx to this path. */
  output?: string;
  /**
   * When `output` is set, also write the source YAML to a sidecar
   * `<output>.slideml`. Default true. Lets later edit-flows mutate the
   * source instead of re-emitting the whole deck. Pass `false` for
   * one-off compiles where the source is already on disk.
   */
  writeSidecar?: boolean;
}

export interface CompileResult {
  buffer: Buffer;
  written?: string;
  /** Absolute path to the sidecar YAML, when written. */
  sidecar?: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: SlidemlError[] };

export interface SlidemlError {
  code: string;
  slideIndex?: number;
  layout?: string;
  slot?: string;
  message: string;
  hint?: string;
}

export interface LayoutInfo {
  name: string;
  description: string;
  slotSchema: Record<string, SlotSchema>;
  thumbnailPath: string;
}

/**
 * Compact layout summary for the agent's first-pass picker. ~20 tokens
 * per layout vs ~200+ for the full schema — designed for "show me what
 * exists so I can choose 4-6 to fetch in detail".
 */
export interface LayoutSummary {
  name: string;
  /** One-line purpose (first sentence of the layout's theme.md description). */
  purpose: string;
  /** Required slot names only (no schemas). */
  requiredSlots: string[];
  /** Optional slot names. */
  optionalSlots: string[];
}

/**
 * Full layout detail with per-slot examples. Returned by `describeLayout`
 * for the layouts the agent has decided to use, after picking from the
 * compact summary list. Examples eliminate the slot-shape retry loop.
 */
export interface LayoutDetail extends LayoutInfo {
  slotSchema: Record<string, SlotSchema & { example?: unknown }>;
}

/**
 * Compile a SlideML YAML document to a .pptx Buffer.
 *
 * Throws on parse error. Returns `{ ok: false, errors }` -shaped result via
 * the `validateDeck` API for slot validation; for `compile` validation
 * errors throw a `SlidemlAggregateError` with `.errors`.
 */
export async function compile(
  slidemlYaml: string,
  opts: CompileOptions,
): Promise<CompileResult> {
  const theme = opts.theme ?? (await loadTheme(requireThemeDir(opts)));
  const spec = parseSlideml(slidemlYaml);

  const validation = validateDeckSpec(spec, theme);
  if (!validation.ok) {
    throw aggregateError(validation.errors);
  }

  const ast = renderDeck(spec, theme);
  const buffer = await emitPackage(ast);

  if (opts.output) {
    await mkdir(dirname(opts.output), { recursive: true });
    await writeFile(opts.output, buffer);
    let sidecar: string | undefined;
    if (opts.writeSidecar !== false) {
      sidecar = `${opts.output}.slideml`;
      await writeFile(sidecar, slidemlYaml, "utf8");
    }
    return { buffer, written: opts.output, sidecar };
  }
  return { buffer };
}

/** Validate a SlideML document against a loaded theme without rendering. */
export async function validateDeck(
  slidemlYaml: string,
  opts: { themeDir?: string; theme?: LoadedTheme },
): Promise<ValidationResult> {
  const theme = opts.theme ?? (await loadTheme(requireThemeDir(opts)));
  let spec: DeckSpec;
  try {
    spec = parseSlideml(slidemlYaml);
  } catch (err) {
    return { ok: false, errors: [parseErrorToSlideml(err)] };
  }
  const result = validateDeckSpec(spec, theme);
  return result.ok ? { ok: true } : { ok: false, errors: result.errors };
}

/** Load a theme package from disk. */
export async function loadTheme(themeDir: string): Promise<LoadedTheme> {
  return internalLoadTheme(themeDir);
}

/**
 * List the layouts a loaded theme exposes, with the slot schema and
 * thumbnail path needed by an LLM agent or UI to pick one.
 *
 * NOTE: this returns the full schema for every layout — fine for tooling,
 * but heavy for an agent's first call. Prefer `summarizeLayouts` →
 * `describeLayout` for agent flows.
 */
export function listLayouts(theme: LoadedTheme): LayoutInfo[] {
  const out: LayoutInfo[] = [];
  for (const [name, loaded] of theme.layouts) {
    out.push({
      name,
      description: loaded.description,
      slotSchema: loaded.slots,
      thumbnailPath: loaded.thumbnailAbsPath,
    });
  }
  return out;
}

/**
 * Compact layout list for agent first-pass picking. Returns just enough
 * info to choose layouts (name + 1-line purpose + required/optional
 * slot names). The agent then calls `describeLayout` for each layout it
 * actually plans to use.
 */
export function summarizeLayouts(theme: LoadedTheme): LayoutSummary[] {
  const out: LayoutSummary[] = [];
  for (const [name, loaded] of theme.layouts) {
    const required: string[] = [];
    const optional: string[] = [];
    for (const [slotName, schema] of Object.entries(loaded.slots)) {
      if (schema.optional) optional.push(slotName);
      else required.push(slotName);
    }
    out.push({
      name,
      purpose: firstSentence(loaded.description),
      requiredSlots: required,
      optionalSlots: optional,
    });
  }
  return out;
}

/**
 * Full schema + per-slot examples for a single layout. Returns null when
 * the layout name is not in the theme.
 */
export function describeLayout(
  theme: LoadedTheme,
  layoutName: string,
): LayoutDetail | null {
  const loaded = theme.layouts.get(layoutName);
  if (!loaded) return null;
  const enriched: Record<string, SlotSchema & { example?: unknown }> = {};
  for (const [slotName, schema] of Object.entries(loaded.slots)) {
    const example = exampleForSlot(slotName, schema);
    enriched[slotName] = example !== undefined ? { ...schema, example } : { ...schema };
  }
  return {
    name: layoutName,
    description: loaded.description,
    slotSchema: enriched,
    thumbnailPath: loaded.thumbnailAbsPath,
  };
}

function firstSentence(s: string): string {
  const trimmed = s.trim();
  const cut = trimmed.search(/[.!?。！？]\s|\n/);
  if (cut <= 0) return trimmed;
  return trimmed.slice(0, cut + 1).trim();
}

/** Aggregate validation error thrown by `compile()` when slots are wrong. */
export class SlidemlAggregateError extends Error {
  override name = "SlidemlAggregateError";
  errors: SlidemlError[];
  constructor(errors: SlidemlError[]) {
    const summary = errors.length === 1
      ? errors[0]!.message
      : `SlideML validation failed with ${errors.length} error(s).`;
    super(summary);
    this.errors = errors;
  }
}

function aggregateError(errors: SlidemlValidationError[]): SlidemlAggregateError {
  return new SlidemlAggregateError(errors);
}

function requireThemeDir(opts: { themeDir?: string }): string {
  if (!opts.themeDir) {
    throw new Error("compile()/validateDeck(): pass either `theme` (LoadedTheme) or `themeDir` (path).");
  }
  return opts.themeDir;
}

function parseErrorToSlideml(err: unknown): SlidemlError {
  if (err instanceof Error) {
    const code = (err as { code?: string }).code ?? "PARSE_ERROR";
    const hint = (err as { hint?: string }).hint;
    return { code, message: err.message, hint };
  }
  return { code: "PARSE_ERROR", message: String(err) };
}
