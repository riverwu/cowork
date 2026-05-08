import { pushDiagnostic } from "./diagnostics.js";
import type { BrandSpec, ThemeOverride } from "./types.js";

export interface SimpleTheme {
  name: string;
  colors: Record<string, string>;
  text: Record<string, TextStyle>;
  /**
   * Semantic font-size dials. Agents pick a scale (`xs` … `2xl`) instead of
   * raw points; the theme controls the actual multiplier so the same source
   * deck stays readable across themes/screens. Default `md` = 1.0×.
   */
  sizeScale: Record<"xs" | "sm" | "md" | "lg" | "xl" | "2xl", number>;
  component: Record<string, ComponentStyle>;
  tone: Record<string, { fg: string; bg: string; line: string }>;
  fontFace: string;
  /**
   * Per-script font chains. `latin` and `cjk` carry an optional `display`
   * chain (covers, hero quotes, oversized titles) alongside `text` (body,
   * captions). `mono` is a single chain — code is code. Backwards-compat:
   * if `latin` / `cjk` is supplied as a `string[]`, it's interpreted as the
   * `text` chain and reused for `display`.
   */
  fonts: {
    latin: { display: string[]; text: string[] };
    cjk: { display: string[]; text: string[] };
    mono: string[];
  };
  layout: {
    slideWidthCm: number;
    slideHeightCm: number;
    pageMarginX: number;
    titleTop: number;
    titleHeight: number;
    contentTop: number;
    contentBottom: number;
    defaultGap: number;
    columnGap: number;
    cardPadding: number;
  };
  chart: {
    series: string[];
  };
  guidance: {
    scenario?: string;
    stylePrinciples: string[];
    layoutPrinciples: string[];
    componentGuidance: Record<string, string>;
    dataVizGuidance: string[];
    imageGuidance: string[];
    avoid: string[];
  };
  chrome: {
    brandMark: "none" | "top-right" | "bottom-right";
    pageNumber: boolean;
    footerText?: string;
    footerLine: boolean;
    footerHeight: number;
    footerPadding: number;
  };
  imageGrowWeight: number;
}

/**
 * Numeric font weight axis (CSS-style: 100..900). Numeric weights resolve
 * to typeface name suffixes when the theme's font chain has named variants
 * available (e.g. "Inter Light" / "Inter SemiBold" / "Inter Black"). For
 * the OOXML `b` attribute we treat anything ≥ 600 as bold so renderers
 * without the named variant still get visible emphasis.
 */
/**
 * Named CSS-style weights agents may use:
 *   thin (100) | extralight (200) | light (300) | regular/normal (400) |
 *   medium (500) | semibold (600) | bold (700) | extrabold (800) | black (900)
 * Numeric values 100..900 are also accepted directly.
 */
export type FontWeight =
  | "thin" | "hairline"
  | "extralight" | "ultralight"
  | "light"
  | "normal" | "regular" | "book"
  | "medium"
  | "semibold" | "demibold"
  | "bold"
  | "extrabold" | "ultrabold" | "heavy"
  | "black" | "super"
  | number;

export interface TextStyle {
  fontSize: number;
  weight?: FontWeight;
  fontWeight?: FontWeight;
  color: string;
  lineHeight: number;
  margin?: { l?: number; r?: number; t?: number; b?: number };
  /** Letter spacing in 1/100 pt. Negative tightens, positive opens. */
  letterSpacing?: number;
  /**
   * Which font role this text style draws from. `display` (large headlines,
   * quote heroes), `text` (default body / labels / captions), or `mono`
   * (code, identifiers). Defaults to `text`.
   */
  fontFamily?: "display" | "text" | "mono";
  /** OpenType feature flags emitted on every run rendered with this style.
   *  Common: ['tnum'] for tabular numerals on data tables, ['smcp'] for
   *  small-caps on eyebrows. Renderer support varies; PowerPoint honors
   *  `tnum` and `smcp` reliably on installed OpenType fonts. */
  fontFeatures?: string[];
  /** Uppercase transform applied at render time (CSS text-transform). */
  uppercase?: boolean;
  /** Italic by default for this style (e.g. quote, citation). */
  italic?: boolean;
}

export interface ComponentStyle {
  fill?: string;
  line?: string;
  accent?: string;
  padding?: number;
  cornerRadius?: number;
  elevation?: "flat" | "raised" | "floating" | "outlined";
}

type TextStyleDerivation = {
  extends: string;
  overrides?: Partial<TextStyle>;
};

export const COMPONENT_TEXT_STYLE_DERIVATIONS: Record<string, TextStyleDerivation> = {
  "timeline-time": {
    extends: "label",
    overrides: { color: "text.primary", weight: "bold" },
  },
  "timeline-title": {
    extends: "card-title",
  },
  "timeline-body": {
    extends: "caption",
    overrides: { color: "text.primary" },
  },
};

export type ThemeFactory = (brandPrimary: string) => SimpleTheme;

export function listThemes(): string[] {
  // The default scaffold is the only built-in theme. Specific styling
  // (consulting / academic / pitch-deck) is the agent's job — call
  // `set_theme` on the deck to install your design choices over the
  // default. The default is intentionally neutral.
  return ["default"];
}

export function listColorWarnings(): string[] {
  return Array.from(colorWarnings);
}

export function clearColorWarnings(): void {
  colorWarnings.clear();
}

const colorWarnings = new Set<string>();

/**
 * Build a theme by deep-merging an agent-supplied `themeOverride` over the
 * minimal default scaffold. The default is a "safe but plain" baseline so
 * that decks render without an explicit theme; agents are expected to
 * override colors, text styles, and component padding to suit subject
 * matter.
 */
export function buildTheme(brand: BrandSpec = {}, themeName = "default", themeOverride?: ThemeOverride): SimpleTheme {
  void themeName;
  const flatColors = flattenColorOverrides(themeOverride?.colors);
  const brandPrimary = normalizeHex(brand.primary || flatColors["brand.primary"] || "2563EB");
  const base = defaultBase(brandPrimary);
  return mergeTheme(base, brandPrimary, themeOverride, flatColors);
}

/**
 * Normalize agent-supplied themeOverride.colors into the flat dot-notation
 * shape the renderer expects. Both forms are accepted:
 *   {brand:{primary:"..."}, text:{primary:"..."}}    (nested)
 *   {"brand.primary":"...", "text.primary":"..."}    (flat)
 * Mixed forms are merged. Hex values are normalized (strip "#",
 * uppercase). Non-string leaves are dropped silently — strict checks live in
 * validateThemeOverride.
 */
export function flattenColorOverrides(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") {
      out[key] = stripHexPrefix(value);
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = flattenColorOverrides(value);
      for (const [subKey, subValue] of Object.entries(nested)) {
        out[`${key}.${subKey}`] = subValue;
      }
    }
  }
  return out;
}

function stripHexPrefix(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed.slice(1).toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(trimmed)) {
    const c = trimmed.slice(1);
    return (c[0]! + c[0]! + c[1]! + c[1]! + c[2]! + c[2]!).toUpperCase();
  }
  if (/^[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  return trimmed;
}

function mergeTheme(base: SimpleTheme, brandPrimary: string, override?: ThemeOverride, prebuiltColors?: Record<string, string>): SimpleTheme {
  const flatColors = prebuiltColors ?? flattenColorOverrides(override?.colors);
  const colors = { ...base.colors, ...derivedBrandPalette(brandPrimary), ...flatColors };
  if (flatColors["text.secondary"] && !flatColors["text.muted"]) {
    colors["text.muted"] = flatColors["text.secondary"];
  }
  applySemanticAccentAliases(colors, flatColors);
  // Reconcile dependent surface tokens: when the agent overrides
  // `surface` to a dark color (or `background` to dark) but doesn't
  // override `surface.subtle` or `divider`, those default to the
  // light-theme constants (F1F4FA / DDE3EC) and create invisible
  // strips inside cards (vdhl38 log: agent set surface=#1A1A2E for a
  // dark-themed deck, table headers kept the F1F4FA fill, white
  // header text became invisible). Auto-derive a slight tone shift
  // from `surface` so the dependents stay consistent.
  applySurfaceConsistency(colors, flatColors);
  const merged: SimpleTheme = {
    ...base,
    colors,
    text: mergeTextStyles(base.text, override?.text),
    component: mergeComponentStyles(base.component, override?.component),
    tone: { ...base.tone, ...(override?.tone || {}) },
    layout: { ...base.layout, ...(override?.layout || {}) },
    fonts: mergeFonts(base.fonts, override?.fonts),
    chart: { series: override?.chart?.series ?? base.chart.series },
    guidance: {
      scenario: override?.guidance?.scenario ?? base.guidance.scenario,
      stylePrinciples: override?.guidance?.stylePrinciples ?? base.guidance.stylePrinciples,
      layoutPrinciples: override?.guidance?.layoutPrinciples ?? base.guidance.layoutPrinciples,
      componentGuidance: { ...base.guidance.componentGuidance, ...(override?.guidance?.componentGuidance || {}) },
      dataVizGuidance: override?.guidance?.dataVizGuidance ?? base.guidance.dataVizGuidance,
      imageGuidance: override?.guidance?.imageGuidance ?? base.guidance.imageGuidance,
      avoid: override?.guidance?.avoid ?? base.guidance.avoid,
    },
    chrome: { ...base.chrome, ...(override?.chrome || {}) },
    imageGrowWeight: override?.imageGrowWeight ?? base.imageGrowWeight,
    sizeScale: { ...base.sizeScale, ...(override?.sizeScale || {}) },
  };
  return merged;
}

function applySemanticAccentAliases(colors: Record<string, string>, flatOverrides: Record<string, string>): void {
  const userSet = (key: string): boolean => Object.prototype.hasOwnProperty.call(flatOverrides, key);
  const aliases: Array<{ accent: string; semantic: string; tint: string }> = [
    { accent: "accent.green", semantic: "success", tint: "success.tint" },
    { accent: "accent.orange", semantic: "warning", tint: "warning.tint" },
    { accent: "accent.red", semantic: "danger", tint: "danger.tint" },
    { accent: "accent.blue", semantic: "info", tint: "info.tint" },
  ];

  for (const { accent, semantic, tint } of aliases) {
    const accentToken = `${semantic}.accent`;
    const accentHex = isHexColor(colors[accent]) ? colors[accent] : undefined;
    if (accentHex && !userSet(accentToken)) {
      colors[accentToken] = accentHex;
    }
    if (accentHex && !userSet(semantic)) {
      colors[semantic] = semanticForeground(colors, accentHex);
    }

    const semanticHex = isHexColor(colors[semantic]) ? colors[semantic] : undefined;
    if (semanticHex && !colors[accentToken]) {
      colors[accentToken] = semanticHex;
    }
    if (!semanticHex || userSet(tint)) continue;

    const accentTint = colors[`${accent}.tint`];
    colors[tint] = isHexColor(accentTint) ? accentTint : semanticTint(colors, accentHex || semanticHex);
  }
}

function semanticForeground(colors: Record<string, string>, accentHex: string): string {
  const backgrounds = ["background", "surface", "surface.subtle"]
    .map((key) => colors[key])
    .filter(isHexColor);
  let out = accentHex;
  for (const bg of backgrounds) {
    if (contrastRatioOfHex(out, bg) >= 4.5) continue;
    out = shadedVariantForContrast(out, bg, 4.5) || out;
  }
  return out;
}

function semanticTint(colors: Record<string, string>, semanticHex: string): string {
  const surfaceHex = isHexColor(colors.surface) ? colors.surface : "FFFFFF";
  const surfaceLum = relativeLuminanceOfHex(surfaceHex);
  return mixHex(surfaceHex, semanticHex, surfaceLum < 0.3 ? 0.72 : 0.88);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^[0-9A-Fa-f]{6}$/.test(value);
}

function contrastRatioOfHex(fgHex: string, bgHex: string): number {
  const lf = relativeLuminanceOfHex(fgHex);
  const lb = relativeLuminanceOfHex(bgHex);
  const light = Math.max(lf, lb);
  const dark = Math.min(lf, lb);
  return (light + 0.05) / (dark + 0.05);
}

function shadedVariantForContrast(srcHex: string, bgHex: string, threshold: number): string | null {
  const bgIsLight = relativeLuminanceOfHex(bgHex) > 0.5;
  const target = bgIsLight ? "000000" : "FFFFFF";
  const sr = parseInt(srcHex.slice(0, 2), 16);
  const sg = parseInt(srcHex.slice(2, 4), 16);
  const sb = parseInt(srcHex.slice(4, 6), 16);
  const tr = parseInt(target.slice(0, 2), 16);
  const tg = parseInt(target.slice(2, 4), 16);
  const tb = parseInt(target.slice(4, 6), 16);
  for (let pct = 5; pct <= 60; pct += 5) {
    const t = pct / 100;
    const r = Math.round(sr + (tr - sr) * t);
    const g = Math.round(sg + (tg - sg) * t);
    const b = Math.round(sb + (tb - sb) * t);
    const hex = [r, g, b].map((n) => n.toString(16).padStart(2, "0").toUpperCase()).join("");
    if (contrastRatioOfHex(hex, bgHex) >= threshold) return hex;
  }
  return null;
}

function mergeTextStyles(base: Record<string, TextStyle>, override?: Record<string, Partial<TextStyle>>): Record<string, TextStyle> {
  const out: Record<string, TextStyle> = cloneTextStyles(base);
  if (!override) return completeDerivedTextStyles(out, base, {});
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key] || base.paragraph || { fontSize: 11, color: "text.primary", lineHeight: 1.4 };
    out[key] = {
      fontSize: typeof value.fontSize === "number" ? value.fontSize : existing.fontSize,
      weight: value.weight ?? value.fontWeight ?? existing.weight,
      color: typeof value.color === "string" ? value.color : existing.color,
      lineHeight: typeof value.lineHeight === "number" ? value.lineHeight : existing.lineHeight,
      margin: value.margin ?? existing.margin,
      letterSpacing: value.letterSpacing ?? existing.letterSpacing,
      fontFamily: value.fontFamily ?? existing.fontFamily,
      fontFeatures: value.fontFeatures ?? existing.fontFeatures,
      uppercase: value.uppercase ?? existing.uppercase,
      italic: value.italic ?? existing.italic,
    };
  }
  return completeDerivedTextStyles(out, base, override);
}

function cloneTextStyles(styles: Record<string, TextStyle>): Record<string, TextStyle> {
  const out: Record<string, TextStyle> = {};
  for (const [key, style] of Object.entries(styles)) {
    out[key] = { ...style, ...(style.margin ? { margin: { ...style.margin } } : {}) };
  }
  return out;
}

function completeDerivedTextStyles(
  out: Record<string, TextStyle>,
  base: Record<string, TextStyle>,
  override: Record<string, Partial<TextStyle>>,
): Record<string, TextStyle> {
  const touched = (key: string): boolean => Object.prototype.hasOwnProperty.call(override, key);
  const anyTouched = (...keys: string[]): boolean => keys.some(touched);
  const style = (key: string): TextStyle => out[key] || out.paragraph || base.paragraph;
  const baseStyle = (key: string): TextStyle => base[key] || base.paragraph;
  const has = (key: string, prop: keyof TextStyle): boolean => {
    const value = override[key];
    if (!value) return false;
    if (prop === "weight") {
      return Object.prototype.hasOwnProperty.call(value, "weight") || Object.prototype.hasOwnProperty.call(value, "fontWeight");
    }
    return Object.prototype.hasOwnProperty.call(value, prop);
  };
  const ensure = (key: string): TextStyle => {
    out[key] = out[key] || { ...baseStyle(key) };
    return out[key]!;
  };
  const scaled = (source: string, target: string, prop: "fontSize" | "lineHeight"): number => {
    const src = style(source)[prop];
    const srcBase = baseStyle(source)[prop];
    const targetBase = baseStyle(target)[prop];
    if (!Number.isFinite(src) || !Number.isFinite(srcBase) || !Number.isFinite(targetBase) || srcBase === 0) {
      return targetBase;
    }
    const precision = prop === "fontSize" ? 10 : 100;
    return Math.round(src * (targetBase / srcBase) * precision) / precision;
  };
  const deriveMetrics = (target: string, source: string, condition: boolean): void => {
    if (!condition) return;
    const t = ensure(target);
    if (!has(target, "fontSize")) t.fontSize = scaled(source, target, "fontSize");
    if (!has(target, "lineHeight")) t.lineHeight = scaled(source, target, "lineHeight");
  };
  const inheritFontRole = (target: string, source: string, condition: boolean): void => {
    if (!condition) return;
    const sourceFamily = style(source).fontFamily;
    if (sourceFamily && !has(target, "fontFamily")) ensure(target).fontFamily = sourceFamily;
  };
  const inheritWeight = (target: string, source: string, condition: boolean): void => {
    if (!condition) return;
    const sourceWeight = style(source).weight ?? style(source).fontWeight;
    if (sourceWeight !== undefined && !has(target, "weight")) ensure(target).weight = sourceWeight;
  };
  const inheritFeatures = (target: string, source: string, condition: boolean): void => {
    if (!condition) return;
    const sourceFeatures = style(source).fontFeatures;
    if (sourceFeatures && !has(target, "fontFeatures")) ensure(target).fontFeatures = [...sourceFeatures];
  };

  const titleTouched = anyTouched("slide-title");
  const sectionTouched = anyTouched("section-title") || titleTouched;
  const paragraphTouched = anyTouched("paragraph");
  const captionTouched = anyTouched("caption") || paragraphTouched;
  const metricTouched = anyTouched("metric-value");

  deriveMetrics("deck-title", "slide-title", titleTouched);
  inheritFontRole("deck-title", "slide-title", titleTouched);
  inheritWeight("deck-title", "slide-title", titleTouched);

  deriveMetrics("section-title", "slide-title", titleTouched);
  inheritFontRole("section-title", "slide-title", titleTouched);
  inheritWeight("section-title", "slide-title", titleTouched);

  deriveMetrics("card-title", paragraphTouched ? "paragraph" : "section-title", paragraphTouched || sectionTouched);
  inheritFontRole("card-title", sectionTouched ? "section-title" : "paragraph", paragraphTouched || sectionTouched);
  inheritWeight("card-title", "section-title", sectionTouched);

  for (const key of ["lead", "article", "body", "bullet", "bullet-compact", "table-cell"]) {
    deriveMetrics(key, "paragraph", paragraphTouched);
    inheritFontRole(key, "paragraph", paragraphTouched);
    inheritFeatures(key, "paragraph", paragraphTouched);
  }

  deriveMetrics("caption", "paragraph", paragraphTouched);
  inheritFontRole("caption", "paragraph", paragraphTouched);

  for (const key of ["figure-caption", "footnote", "axis-label", "legend-label", "tag"]) {
    deriveMetrics(key, "caption", captionTouched);
    inheritFontRole(key, "caption", captionTouched);
    inheritFeatures(key, "caption", captionTouched);
  }

  deriveMetrics("label", touched("caption") ? "caption" : "paragraph", captionTouched);
  inheritFontRole("label", touched("caption") ? "caption" : "paragraph", captionTouched);

  deriveMetrics("badge", "label", captionTouched);
  inheritFontRole("badge", "label", captionTouched);

  deriveMetrics("table-header", "table-cell", paragraphTouched || touched("table-cell"));
  inheritFontRole("table-header", "table-cell", paragraphTouched || touched("table-cell"));
  inheritWeight("table-header", "card-title", sectionTouched);
  inheritFeatures("table-header", "table-cell", paragraphTouched || touched("table-cell"));

  deriveMetrics("metric-label", metricTouched ? "metric-value" : "caption", metricTouched || captionTouched);
  inheritFontRole("metric-label", captionTouched ? "caption" : "paragraph", captionTouched || paragraphTouched);

  applyComponentTextStyleDerivations(out, base, override);

  return out;
}

function applyComponentTextStyleDerivations(
  out: Record<string, TextStyle>,
  base: Record<string, TextStyle>,
  override: Record<string, Partial<TextStyle>>,
): void {
  for (const [target, def] of Object.entries(COMPONENT_TEXT_STYLE_DERIVATIONS)) {
    const source = out[def.extends] || base[def.extends] || out.paragraph || base.paragraph;
    const explicit = override[target] || {};
    const derived: TextStyle = {
      ...source,
      ...def.overrides,
    };
    out[target] = {
      fontSize: typeof explicit.fontSize === "number" ? explicit.fontSize : derived.fontSize,
      weight: explicit.weight ?? explicit.fontWeight ?? derived.weight,
      color: typeof explicit.color === "string" ? explicit.color : derived.color,
      lineHeight: typeof explicit.lineHeight === "number" ? explicit.lineHeight : derived.lineHeight,
      margin: explicit.margin ?? derived.margin,
      letterSpacing: explicit.letterSpacing ?? derived.letterSpacing,
      fontFamily: explicit.fontFamily ?? derived.fontFamily,
      fontFeatures: explicit.fontFeatures ?? derived.fontFeatures,
      uppercase: explicit.uppercase ?? derived.uppercase,
      italic: explicit.italic ?? derived.italic,
    };
  }
}

/** Accept either the legacy `string[]` form or the new `{ display, text }`
 *  shape for `latin` and `cjk`. The legacy array becomes both `text` and
 *  `display` so old themeOverrides still render identically. */
function mergeFonts(
  base: SimpleTheme["fonts"],
  override?: { latin?: string[] | { display?: string[]; text?: string[] }; cjk?: string[] | { display?: string[]; text?: string[] }; mono?: string[] },
): SimpleTheme["fonts"] {
  if (!override) {
    return { latin: { ...base.latin }, cjk: { ...base.cjk }, mono: [...base.mono] };
  }
  return {
    latin: mergeScriptFonts(base.latin, override.latin),
    cjk: mergeScriptFonts(base.cjk, override.cjk),
    mono: override.mono ?? [...base.mono],
  };
}

function mergeScriptFonts(
  base: { display: string[]; text: string[] },
  override?: string[] | { display?: string[]; text?: string[] },
): { display: string[]; text: string[] } {
  if (!override) return { display: [...base.display], text: [...base.text] };
  if (Array.isArray(override)) {
    // Legacy: a single chain doubles as text + display.
    return { display: override, text: override };
  }
  return {
    display: override.display ?? [...base.display],
    text: override.text ?? [...base.text],
  };
}

function mergeComponentStyles(base: Record<string, ComponentStyle>, override?: Record<string, ComponentStyle>): Record<string, ComponentStyle> {
  if (!override) return { ...base };
  const out: Record<string, ComponentStyle> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const { cornerRadius: rawCornerRadius, padding: rawPadding, ...restWithLegacy } = value as ComponentStyle & { radius?: unknown };
    const rest = { ...restWithLegacy };
    delete rest.radius;
    const cornerRadius = typeof rawCornerRadius === "number"
      ? normalizeCornerRadius(rawCornerRadius)
      : undefined;
    const padding = typeof rawPadding === "number" ? normalizeComponentPadding(rawPadding) : undefined;
    out[key] = {
      ...(base[key] || {}),
      ...rest,
      ...(padding !== undefined ? { padding } : {}),
      ...(cornerRadius !== undefined ? { cornerRadius } : {}),
    };
  }
  return out;
}

export function normalizeCornerRadius(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  // SlideML cornerRadius is a 0..0.5 fraction of the shorter side. Agents
  // often write CSS-like pixel values in theme overrides (10, 12). Treat
  // those as percent-like shorthand so they become 0.10/0.12 instead of
  // maximum-pill roundRects.
  const normalized = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(0.5, normalized));
}

export function normalizeComponentPadding(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  // Component padding is authored in centimeters. Agents often copy CSS-like
  // theme snippets (`padding:16`) where the number means px; treating that as
  // 16cm destroys layout. Values above 2cm are not practical for slide cards,
  // so normalize them as CSS px at 96dpi.
  const normalized = value > 2 ? value / 37.7952755906 : value;
  return Math.max(0, Math.min(1.5, normalized));
}

export function textStyle(theme: SimpleTheme, kindOrVariant: unknown, fallback = "paragraph"): TextStyle {
  const key = typeof kindOrVariant === "string" && kindOrVariant.trim() ? kindOrVariant.trim() : fallback;
  return theme.text[key] || theme.text[fallback] || theme.text.paragraph;
}

// Common short-form aliases LLMs gravitate toward. Resolve them silently so
// every minor wording variant does not produce an UNKNOWN_COLOR warning.
const COLOR_ALIASES: Record<string, string> = {
  brand: "brand.primary",
  primary: "text.primary",
  inverse: "text.inverse",
  muted: "text.muted",
  text: "text.primary",
  bg: "background",
  background: "background",
  surface: "surface",
  fg: "text.primary",
  accent: "brand.primary",
  highlight: "brand.primary",
  // Common token names agents reach for that aren't in the default theme
  // but exist in many themeOverrides. Fall back to a safe approximation so
  // the renderer doesn't drop through to a style default like brand.primary.
  "text.secondary": "text.muted",
  "text.tertiary": "text.muted",
  "text.subtle": "text.muted",
  "text.body": "text.primary",
  "text.heading": "text.primary",
};

// Common CSS named colors agents reach for. We map to safe hex equivalents so
// `iconColor:"white"` or `color:"black"` doesn't trip UNKNOWN_COLOR. The list is
// deliberately short — anything more exotic should still go through tokens.
const CSS_NAMED_COLORS: Record<string, string> = {
  white: "FFFFFF",
  black: "000000",
  silver: "C0C0C0",
  gray: "808080",
  grey: "808080",
  lightgray: "D3D3D3",
  lightgrey: "D3D3D3",
  darkgray: "A9A9A9",
  darkgrey: "A9A9A9",
  red: "DC2626",
  crimson: "DC143C",
  orange: "EA580C",
  yellow: "FACC15",
  gold: "D4A017",
  lime: "65A30D",
  green: "16A34A",
  teal: "0D9488",
  cyan: "06B6D4",
  blue: "2563EB",
  navy: "1E3A8A",
  indigo: "4F46E5",
  purple: "7C3AED",
  violet: "8B5CF6",
  magenta: "C026D3",
  pink: "DB2777",
  brown: "92400E",
  beige: "F5F0E1",
  cream: "FFF8E7",
  ivory: "FFFFF0",
  transparent: "FFFFFF",
};

/**
 * Parse a CSS rgb()/rgba()/hsl()/hsla() expression into a 6-char hex. Returns
 * null when the input doesn't match a known CSS color function. Alpha values
 * are returned alongside so callers that paint shapes can honor partial
 * transparency; downstream code that only takes a hex (e.g. text color) can
 * discard alpha — the perceived color stays close.
 */
export function parseCssColor(expression: string): { hex: string; alpha: number } | null {
  const text = expression.trim().toLowerCase();
  const rgbMatch = text.match(/^rgba?\s*\(\s*([^)]+)\s*\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1]!.split(/[ ,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const r = parseChannel(parts[0]!);
    const g = parseChannel(parts[1]!);
    const b = parseChannel(parts[2]!);
    if (r === null || g === null || b === null) return null;
    const alpha = parts.length >= 4 ? parseAlpha(parts[3]!) : 1;
    return { hex: rgbToHex(r, g, b), alpha };
  }
  const hslMatch = text.match(/^hsla?\s*\(\s*([^)]+)\s*\)$/);
  if (hslMatch) {
    const parts = hslMatch[1]!.split(/[ ,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const h = parseFloat(parts[0]!.replace(/deg$/, ""));
    const s = parseFloat(parts[1]!.replace(/%$/, "")) / 100;
    const l = parseFloat(parts[2]!.replace(/%$/, "")) / 100;
    if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return null;
    const alpha = parts.length >= 4 ? parseAlpha(parts[3]!) : 1;
    return { hex: hslToHex(h, s, l), alpha };
  }
  return null;
}

function parseChannel(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.endsWith("%")) {
    const pct = parseFloat(trimmed.slice(0, -1));
    if (!Number.isFinite(pct)) return null;
    return Math.round(Math.max(0, Math.min(100, pct)) * 2.55);
  }
  const n = parseFloat(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(0, Math.min(255, n)));
}

function parseAlpha(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed.endsWith("%")) {
    const pct = parseFloat(trimmed.slice(0, -1));
    return Math.max(0, Math.min(1, Number.isFinite(pct) ? pct / 100 : 1));
  }
  const n = parseFloat(trimmed);
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 1));
}

function rgbToHex(r: number, g: number, b: number): string {
  return [r, g, b].map((n) => n.toString(16).padStart(2, "0").toUpperCase()).join("");
}

function hslToHex(h: number, s: number, l: number): string {
  // Standard HSL→RGB conversion.
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
}

/**
 * Resolve any agent-supplied color expression to a 6-char hex.
 *
 * Accepts:
 *   - "#RRGGBB" / "#RGB" / "RRGGBB"      — raw hex, # is optional
 *   - "rgb(...)" / "rgba(...)"           — CSS color functions (alpha discarded)
 *   - "hsl(...)" / "hsla(...)"
 *   - "brand.primary" / "text.muted"    — theme tokens
 *   - "brand" / "primary" / "fg"         — short aliases
 *   - "white" / "blue" / ...             — common CSS named colors
 *   - "<token>.bg" / "<token>.fg"        — suffix shorthand
 *
 * Defensive: never throws on non-string input. The renderer relies on this
 * being total — an exception here would crash validate_render and leave the
 * agent without a recoverable diagnostic.
 */
export function color(theme: SimpleTheme, value: unknown, fallback = "text.primary"): string {
  const fallbackHex = theme.colors[fallback] || "111827";
  if (typeof value !== "string") {
    if (value !== undefined && value !== null) {
      colorWarnings.add(`<non-string:${typeof value}>`);
      pushDiagnostic({
        severity: "warn",
        code: "UNKNOWN_COLOR",
        message: `Color value must be a string token or hex; got ${typeof value}. Falling back to '${fallback}'.`,
        suggestion: "Use a flat token (e.g. \"brand.primary\", \"text.inverse\") or a hex string. themeOverride.colors should be flat keys, not nested objects.",
      });
    }
    return fallbackHex;
  }
  const raw = value.trim();
  if (!raw) return fallbackHex;
  // Strip a leading "#" so "#B8860B" works the same as "B8860B".
  const stripped = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[0-9A-Fa-f]{6}$/.test(stripped)) return stripped.toUpperCase();
  if (/^[0-9A-Fa-f]{3}$/.test(stripped)) {
    const c = stripped;
    return (c[0]! + c[0]! + c[1]! + c[1]! + c[2]! + c[2]!).toUpperCase();
  }
  // CSS color functions: rgb(), rgba(), hsl(), hsla() — agents reach for
  // these when they want a quick translucency or color expression. We accept
  // them everywhere `color()` is called and discard alpha in this hex-only
  // path (paint code uses `parseCssColor` directly to honor alpha).
  if (/^(rgba?|hsla?)\s*\(/i.test(raw)) {
    const parsed = parseCssColor(raw);
    if (parsed) return parsed.hex;
  }
  if (theme.colors[raw]) return theme.colors[raw]!;
  // Aliases before the warning.
  const aliased = COLOR_ALIASES[raw];
  if (aliased && theme.colors[aliased]) return theme.colors[aliased]!;
  const cssNamed = CSS_NAMED_COLORS[raw.toLowerCase()];
  if (cssNamed) return cssNamed;
  // Simple suffix expansion: "red.tint" already exists; "red.bg" → "red.tint".
  if (raw.endsWith(".bg") && theme.colors[raw.replace(/\.bg$/, ".tint")]) return theme.colors[raw.replace(/\.bg$/, ".tint")]!;
  if (raw.endsWith(".fg") && theme.colors[raw.replace(/\.fg$/, "")]) return theme.colors[raw.replace(/\.fg$/, "")]!;
  if (raw !== fallback) {
    colorWarnings.add(raw);
    pushDiagnostic({
      severity: "warn",
      code: "UNKNOWN_COLOR",
      message: `Unknown color token '${raw}'; falling back to '${fallback}'.`,
      suggestion: `Use a token from describeDeck().colorTokens (e.g. brand.primary, surface, text.primary, success, palette colors red/orange/yellow/lime/green/teal/blue/purple/pink, or CSS names white/black) or a 6-char hex (with or without "#").`,
    });
  }
  return fallbackHex;
}

function commonText(): Record<string, TextStyle> {
  // Typography is calibrated for 16:9 / 25.4×14.29 cm slides. The aim is a
  // strong title hierarchy with restrained body copy and visibly different
  // component roles. The default theme should already feel designed before
  // an agent adds a subject-specific themeOverride.
  return {
    // deck-title defaults to text.primary so a bare {type:"deck-title", text}
    // renders against any deck background. Components that need an inverse hero
    // (e.g. dark cover) override color explicitly via the surface.
    "deck-title": { fontSize: 48, weight: "bold", color: "text.primary", lineHeight: 1.04 },
    "slide-title": { fontSize: 29, weight: "bold", color: "text.primary", lineHeight: 1.08 },
    "section-title": { fontSize: 21, weight: "bold", color: "text.primary", lineHeight: 1.14 },
    "card-title": { fontSize: 13.8, weight: "bold", color: "text.primary", lineHeight: 1.16 },
    // Slightly bolder labels so kicker / category tags don't fade into noise.
    label: { fontSize: 9.2, weight: "bold", color: "brand.primary", lineHeight: 1.08 },
    lead: { fontSize: 15.5, color: "text.primary", lineHeight: 1.30 },
    // Body copy: smaller font, more line-height for readable density.
    paragraph: { fontSize: 10.8, color: "text.primary", lineHeight: 1.38 },
    article: { fontSize: 10.6, color: "text.primary", lineHeight: 1.50 },
    caption: { fontSize: 8.8, color: "text.muted", lineHeight: 1.28 },
    "figure-caption": { fontSize: 8.8, color: "text.muted", lineHeight: 1.24 },
    footnote: { fontSize: 8.2, color: "text.muted", lineHeight: 1.20 },
    bullet: { fontSize: 10.4, color: "text.primary", lineHeight: 1.36 },
    "bullet-compact": { fontSize: 9.4, color: "text.primary", lineHeight: 1.24 },
    "numbered-step": { fontSize: 11, weight: "bold", color: "brand.primary", lineHeight: 1.0 },
    "metric-value": { fontSize: 25, weight: "bold", color: "brand.primary", lineHeight: 0.96 },
    "metric-label": { fontSize: 9.2, color: "text.muted", lineHeight: 1.12 },
    "table-header": { fontSize: 10, weight: "bold", color: "text.primary", lineHeight: 1.18 },
    "table-cell": { fontSize: 9.5, color: "text.primary", lineHeight: 1.24 },
    "axis-label": { fontSize: 8.8, color: "text.muted", lineHeight: 1.0 },
    "legend-label": { fontSize: 8.8, color: "text.muted", lineHeight: 1.0 },
    callout: { fontSize: 15, weight: "bold", color: "brand.primary", lineHeight: 1.18 },
    quote: { fontSize: 20, color: "text.primary", lineHeight: 1.30 },
    "quote-source": { fontSize: 9.2, color: "text.muted", lineHeight: 1.18 },
    badge: { fontSize: 8.6, weight: "bold", color: "brand.primary", lineHeight: 1.0 },
    tag: { fontSize: 8.8, color: "text.muted", lineHeight: 1.0 },
    code: { fontSize: 10, color: "text.primary", lineHeight: 1.28 },
    "code-caption": { fontSize: 9, color: "text.muted", lineHeight: 1.22 },
    hero: { fontSize: 44, weight: "bold", color: "text.primary", lineHeight: 1.06 },
    title: { fontSize: 30, weight: "bold", color: "text.primary", lineHeight: 1.12 },
    body: { fontSize: 14.5, color: "text.primary", lineHeight: 1.36 },
  };
}

/**
 * Semantic palette colors. Agents may use these names anywhere a color token
 * is accepted (`fill`, `line`, `color`). Each palette color resolves to a
 * concrete hex via the theme, so different themes can re-tune the mood while
 * agents keep speaking in semantic names like `red` or `lime`.
 *
 * Rules of thumb (encoded in describeDeck().colorPaletteUsage):
 *   - Use semantic palette only for *categorical* meaning (process steps,
 *     SWOT quadrants, distinct product lines). Do not decorate with palette.
 *   - Within one slide, use at most 4 palette colors and pick adjacent hues.
 *   - Do not mix palette colors with brand.primary as emphasis on the same
 *     slide; pick one accent system.
 */
const PALETTE_COLOR_NAMES = ["red", "orange", "yellow", "lime", "green", "teal", "blue", "purple", "pink"] as const;
export type PaletteColorName = typeof PALETTE_COLOR_NAMES[number];

export function listPaletteColors(): PaletteColorName[] {
  return [...PALETTE_COLOR_NAMES];
}

export type SizeName = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

const DEFAULT_SIZE_SCALE: Record<SizeName, number> = {
  xs: 0.78,
  sm: 0.88,
  md: 1.0,
  lg: 1.18,
  xl: 1.4,
  "2xl": 1.7,
};

export function sizeMultiplier(theme: SimpleTheme, size: unknown): number {
  if (typeof size !== "string") return 1;
  const scale = theme.sizeScale || DEFAULT_SIZE_SCALE;
  const key = size as SizeName;
  if (Object.prototype.hasOwnProperty.call(scale, key)) return scale[key];
  return 1;
}

export function listSizeNames(): SizeName[] {
  return ["xs", "sm", "md", "lg", "xl", "2xl"];
}

function defaultPalette(): Record<string, string> {
  // Tailwind 600/100/700-ish — readable foreground + softer tints.
  const palette: Record<string, [string, string, string]> = {
    red: ["DC2626", "FEE2E2", "991B1B"],
    orange: ["EA580C", "FFEDD5", "9A3412"],
    yellow: ["CA8A04", "FEF9C3", "854D0E"],
    lime: ["65A30D", "ECFCCB", "365314"],
    green: ["16A34A", "DCFCE7", "166534"],
    teal: ["0D9488", "CCFBF1", "115E59"],
    blue: ["2563EB", "DBEAFE", "1E40AF"],
    purple: ["9333EA", "F3E8FF", "6B21A8"],
    pink: ["DB2777", "FCE7F3", "9D174D"],
  };
  const out: Record<string, string> = {};
  for (const [name, [base, tint, shade]] of Object.entries(palette)) {
    out[name] = base;
    out[`${name}.tint`] = tint;
    out[`${name}.shade`] = shade;
  }
  return out;
}

function defaultBase(brandPrimary: string): SimpleTheme {
  return {
    name: "default",
    colors: {
      "brand.primary": brandPrimary,
      // Slightly cool off-white slide background lets white cards float —
      // gives the deck designed depth without resorting to shadows.
      background: "F7F9FC",
      surface: "FFFFFF",
      "surface.subtle": "F1F4FA",
      "brand.tint": "EEF2FF",
      "text.primary": "0F172A",
      "text.inverse": "FFFFFF",
      // Slightly darker muted text so captions stay legible at small sizes.
      "text.muted": "5B6478",
      divider: "DDE3EC",
      success: "0E7C3A",
      "success.accent": "0E7C3A",
      "success.tint": "E6F6EC",
      warning: "B45309",
      "warning.accent": "B45309",
      "warning.tint": "FFF6E6",
      danger: "B42318",
      "danger.accent": "B42318",
      "danger.tint": "FEECEB",
      info: "2563EB",
      "info.accent": "2563EB",
      "info.tint": "DBEAFE",
      ...defaultPalette(),
    },
    text: commonText(),
    sizeScale: { ...DEFAULT_SIZE_SCALE },
    component: {
      "metric-card": { fill: "surface", line: "divider", padding: 0.4, cornerRadius: 0.06 },
      callout: { fill: "brand.tint", line: "divider", accent: "brand.primary", padding: 0.55, cornerRadius: 0.06 },
      "comparison-card": { fill: "surface", line: "divider", padding: 0.55, cornerRadius: 0.06 },
      "step-card": { fill: "surface", line: "divider", padding: 0.55, cornerRadius: 0.06 },
      "definition-card": { fill: "surface", line: "divider", padding: 0.6, cornerRadius: 0.08 },
      quote: { fill: "surface.subtle", line: "divider", padding: 0.7, cornerRadius: 0.08 },
      // timeline-step is a flow group, not a card. Earlier the entry declared
      // {fill:"surface", line:"divider", padding:0.5}, which made the stack
      // paint a card frame around every step (via containerBackgroundShape)
      // AND steal 0.5cm of inner height on each side. Vertical timelines with
      // ≥3 items collapsed under FALLBACK_FAILED. Strip chrome + padding so
      // the timeline reads as a connected sequence, not a column of cards.
      "timeline-step": { padding: 0 },
      "profile-card": { fill: "surface", line: "divider", padding: 0.5, cornerRadius: 0.08 },
      "swot-quadrant": { fill: "surface", line: "divider", padding: 0.55, cornerRadius: 0.06 },
      cta: { fill: "brand.primary", padding: 0.4, cornerRadius: 0.3 },
      "icon-text": { padding: 0 },
      "section-break": { padding: 0 },
      "kpi-grid": { padding: 0 },
      timeline: { padding: 0 },
      "swot-matrix": { padding: 0 },
      "hero-stat": { padding: 0 },
      "bar-list": { padding: 0 },
      "tag-list": { padding: 0 },
      "key-takeaway": { padding: 0 },
      "numbered-grid": { padding: 0 },
      "numbered-step": { padding: 0 },
      "stat-strip": { padding: 0 },
      legend: { padding: 0 },
      badge: { padding: 0 },
      "flow-arrow": { padding: 0 },
      panel: { fill: "surface", line: "divider", padding: 0.55, cornerRadius: 0.12 },
      card: { fill: "surface", line: "divider", padding: 0.6, cornerRadius: 0.12 },
      band: { fill: "surface.subtle", padding: 0.7, cornerRadius: 0 },
      frame: { line: "divider", padding: 0.5, cornerRadius: 0.12 },
      inset: { padding: 0.4, cornerRadius: 0 },
    },
    tone: {
      neutral: { fg: "text.primary", bg: "surface", line: "divider" },
      positive: { fg: "success", bg: "success.tint", line: "success" },
      warning: { fg: "warning", bg: "warning.tint", line: "warning" },
      danger: { fg: "danger", bg: "danger.tint", line: "danger" },
      brand: { fg: "brand.primary", bg: "brand.tint", line: "brand.primary" },
    },
    fonts: {
      latin: {
        display: ["Helvetica Neue", "Arial", "Aptos Display", "Aptos", "Calibri"],
        text: ["Arial", "Helvetica Neue", "Aptos", "Calibri"],
      },
      cjk: {
        display: ["PingFang SC", "Microsoft YaHei", "SimHei"],
        text: ["PingFang SC", "Microsoft YaHei", "SimHei"],
      },
      mono: ["Menlo", "Consolas", "Courier New"],
    },
    fontFace: "Arial",
    layout: {
      slideWidthCm: 25.4,
      slideHeightCm: 14.2875,
      // Slightly tighter outer margin gives more usable area while still
      // leaving generous side gutter; title/content gap raised so slide
      // titles get clear breathing room before content starts.
      pageMarginX: 1.8,
      titleTop: 0.85,
      titleHeight: 1.45,
      contentTop: 2.95,
      contentBottom: 13.2875,
      defaultGap: 0.5,
      columnGap: 0.7,
      cardPadding: 0.55,
    },
    chart: {
      series: ["brand.primary", "brand.primary.shade", "brand.primary.tint", "success", "warning", "danger"],
    },
    guidance: {
      scenario: "general-purpose presentation",
      stylePrinciples: [
        "Use the default theme as a neutral scaffold; supply themeOverride guidance for a specific scenario.",
        "Keep body text quiet and let structure, component choice, and one accent system create hierarchy.",
      ],
      layoutPrinciples: [
        "Prefer stack/grid/split composition over absolute positioning.",
        "Use card/panel/band/frame wrappers when content needs a visual surface.",
      ],
      componentGuidance: {},
      dataVizGuidance: [
        "Use native chart/table primitives for data; use bar-list or stat-strip for lightweight comparisons.",
      ],
      imageGuidance: [
        "Use image-card for framed evidence and raw image for hero visuals or full-bleed media.",
      ],
      avoid: [
        "Do not treat colors/fonts alone as a theme; encode layout and component preferences too.",
      ],
    },
    chrome: {
      brandMark: "none",
      pageNumber: false,
      footerLine: false,
      footerHeight: 0.55,
      footerPadding: 0.5,
    },
    imageGrowWeight: 2,
  };
}

// Built-in themes have been removed. The single `default` scaffold above is
// intentionally neutral; agents apply concrete styling via the deck's
// `themeOverride` field (see `set_theme` tool).

function normalizeHex(value: string): string {
  const cleaned = value.replace(/^#/, "");
  if (/^[0-9A-Fa-f]{6}$/.test(cleaned)) return cleaned.toUpperCase();
  if (/^[0-9A-Fa-f]{3}$/.test(cleaned)) {
    return (cleaned[0]! + cleaned[0]! + cleaned[1]! + cleaned[1]! + cleaned[2]! + cleaned[2]!).toUpperCase();
  }
  return "2563EB";
}

export interface ParsedGradient {
  kind: "linear" | "radial";
  angle?: number;
  stops: Array<{ position: number; color: string; alpha?: number }>;
}

/**
 * Parse a CSS-like gradient expression into a normalized form. Supported:
 *   linear-gradient(135deg, #1A1A1A 0%, #2C3E50 50%, #1E4D6B 100%)
 *   linear-gradient(to right, brand.primary, brand.primary.tint)
 *   radial-gradient(circle at center, FFFFFF 0%, 000000 100%)
 *
 * Each color stop may use hex (with/without #), 3-char hex shorthand, theme
 * tokens, or CSS named colors. Stops without explicit positions get
 * evenly spaced. Returns null if the expression is malformed; callers can
 * surface a typed validation error pointing to the offending text.
 */
export function parseGradientExpression(theme: SimpleTheme, expression: string): ParsedGradient | null {
  if (typeof expression !== "string") return null;
  const text = expression.trim();
  const linearMatch = text.match(/^linear-gradient\s*\(([\s\S]*)\)\s*$/i);
  const radialMatch = text.match(/^radial-gradient\s*\(([\s\S]*)\)\s*$/i);
  const kind: "linear" | "radial" | null = linearMatch ? "linear" : radialMatch ? "radial" : null;
  if (!kind) return null;
  const inside = (linearMatch || radialMatch)![1]!.trim();
  if (!inside) return null;
  const parts = splitTopLevelCommas(inside);
  if (parts.length < 2) return null;
  let angle: number | undefined;
  let stopParts: string[] = parts;
  const first = parts[0]!.trim();
  if (kind === "linear") {
    const angleDeg = first.match(/^(-?\d+(?:\.\d+)?)\s*deg$/i);
    const toMatch = first.match(/^to\s+(top|bottom|left|right|top\s+left|top\s+right|bottom\s+left|bottom\s+right)\s*$/i);
    if (angleDeg) {
      angle = parseFloat(angleDeg[1]!);
      stopParts = parts.slice(1);
    } else if (toMatch) {
      angle = directionToAngle(toMatch[1]!);
      stopParts = parts.slice(1);
    }
  } else {
    // For radial, first segment may describe shape ("circle", "ellipse at center"); we ignore details and just consume.
    if (/(circle|ellipse|at\s|closest|farthest)/i.test(first)) stopParts = parts.slice(1);
  }
  if (stopParts.length < 2) return null;
  const stops = stopParts.map((segment, index) => parseGradientStop(theme, segment, index, stopParts.length));
  if (stops.some((s) => s === null)) return null;
  return { kind, angle, stops: stops as ParsedGradient["stops"] };
}

function splitTopLevelCommas(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of input) {
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

function directionToAngle(dir: string): number {
  const normalized = dir.toLowerCase().replace(/\s+/g, " ").trim();
  switch (normalized) {
    case "top": return 0;
    case "right": return 90;
    case "bottom": return 180;
    case "left": return 270;
    case "top right": return 45;
    case "bottom right": return 135;
    case "bottom left": return 225;
    case "top left": return 315;
    default: return 180;
  }
}

function parseGradientStop(theme: SimpleTheme, segment: string, index: number, total: number): { position: number; color: string } | null {
  const trimmed = segment.trim();
  if (!trimmed) return null;
  // Accept "color [position%]" or "color [position]" with optional whitespace.
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0) return null;
  const last = tokens[tokens.length - 1]!;
  let position: number | undefined;
  let colorTokens = tokens;
  const positionMatch = last.match(/^(-?\d+(?:\.\d+)?)%?$/);
  if (positionMatch && tokens.length > 1) {
    position = parseFloat(positionMatch[1]!);
    colorTokens = tokens.slice(0, -1);
  }
  const colorExpr = colorTokens.join(" ");
  const resolvedHex = color(theme, colorExpr, "text.primary");
  if (!/^[0-9A-Fa-f]{6}$/.test(resolvedHex)) return null;
  const finalPosition = position !== undefined ? Math.max(0, Math.min(100, position)) : (total === 1 ? 0 : (index / (total - 1)) * 100);
  return { position: finalPosition, color: resolvedHex.toUpperCase() };
}

/**
 * Resolve any agent-supplied fill expression to a FillSpec. Unlike `color()`
 * (which always returns a hex), this preserves gradients so the OOXML emitter
 * can produce <a:gradFill>.
 */
export function resolveFill(theme: SimpleTheme, value: unknown, fallback = "background"):
  | { type: "solid"; color: string; alpha?: number }
  | { type: "gradient"; kind: "linear" | "radial"; angle?: number; stops: Array<{ position: number; color: string }> } {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^(linear|radial)-gradient\s*\(/i.test(trimmed)) {
      const parsed = parseGradientExpression(theme, trimmed);
      if (parsed) return { type: "gradient", kind: parsed.kind, angle: parsed.angle, stops: parsed.stops };
      pushDiagnostic({
        severity: "warn",
        code: "UNKNOWN_COLOR",
        message: `Could not parse gradient expression "${trimmed.slice(0, 80)}"; falling back to solid '${fallback}'.`,
        suggestion: "Use the form linear-gradient(135deg, #HEX 0%, #HEX 100%) or linear-gradient(to right, token1, token2). Stops accept hex (with or without #), theme tokens, or CSS named colors.",
      });
    }
    if (/^(rgba?|hsla?)\s*\(/i.test(trimmed)) {
      const parsed = parseCssColor(trimmed);
      if (parsed) return { type: "solid", color: parsed.hex, alpha: parsed.alpha };
    }
  }
  return { type: "solid", color: color(theme, value, fallback) };
}

/**
 * Keep dependent surface tokens consistent when the agent overrides
 * `surface` (or `background`). If they only set the base surface but the
 * dependents (`surface.subtle`, `divider`) inherit the light-theme
 * defaults, dark-themed decks render light strips inside dark cards —
 * exactly the vdhl38 table-header bug.
 *
 * Derivation: nudge `surface` toward white (when dark) or black (when
 * light) by ~10% to get `surface.subtle`, ~25% for `divider`. Only runs
 * when the agent didn't explicitly set the dependent.
 */
function applySurfaceConsistency(colors: Record<string, string>, flatOverrides: Record<string, string>): void {
  const userSet = (key: string): boolean => Object.prototype.hasOwnProperty.call(flatOverrides, key);
  const surfaceHex = colors["surface"];
  if (typeof surfaceHex !== "string" || !/^[0-9A-Fa-f]{6}$/.test(surfaceHex)) return;
  const surfaceLum = relativeLuminanceOfHex(surfaceHex);
  const isDarkSurface = surfaceLum < 0.3;
  // Only override dependents the user didn't explicitly set themselves.
  // Also only intervene when the existing dependent is on the wrong side
  // (light dependent on dark surface, or vice versa) — preserves a user
  // who overrode `surface` to a mid-toned color where the defaults still
  // contrast acceptably.
  // mixHex(a, b, weight) blends a × weight + b × (1 - weight). Weight 0.92
  // = 92% surface + 8% destination; 0.78 = 78% + 22%. Destination is white
  // for dark surfaces, black for light surfaces.
  if (!userSet("surface.subtle")) {
    const cur = colors["surface.subtle"];
    const curLum = typeof cur === "string" ? relativeLuminanceOfHex(cur) : 0.95;
    const inconsistent = isDarkSurface ? curLum > 0.5 : curLum < 0.5;
    if (inconsistent) {
      colors["surface.subtle"] = mixHex(surfaceHex, isDarkSurface ? "FFFFFF" : "000000", 0.92);
    }
  }
  if (!userSet("divider")) {
    const cur = colors["divider"];
    const curLum = typeof cur === "string" ? relativeLuminanceOfHex(cur) : 0.85;
    const inconsistent = isDarkSurface ? curLum > 0.5 : curLum < 0.3;
    if (inconsistent) {
      colors["divider"] = mixHex(surfaceHex, isDarkSurface ? "FFFFFF" : "000000", 0.78);
    }
  }
  if (isDarkSurface) {
    const tintPairs: Array<[string, string]> = [
      ["brand.tint", "brand.primary"],
      ["success.tint", "success"],
      ["warning.tint", "warning"],
      ["danger.tint", "danger"],
    ];
    for (const [tintKey, baseKey] of tintPairs) {
      if (userSet(tintKey)) continue;
      const baseHex = colors[baseKey];
      if (typeof baseHex !== "string" || !/^[0-9A-Fa-f]{6}$/.test(baseHex)) continue;
      const cur = colors[tintKey];
      const curLum = typeof cur === "string" ? relativeLuminanceOfHex(cur) : 0.95;
      if (curLum > 0.5) colors[tintKey] = mixHex(surfaceHex, baseHex, 0.72);
    }
  }
}

function relativeLuminanceOfHex(hex: string): number {
  const cleaned = hex.replace(/^#/, "");
  if (!/^[0-9A-Fa-f]{6}$/.test(cleaned)) return 1;
  const toLin = (n: number) => {
    const s = n / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = toLin(parseInt(cleaned.slice(0, 2), 16));
  const g = toLin(parseInt(cleaned.slice(2, 4), 16));
  const b = toLin(parseInt(cleaned.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function derivedBrandPalette(primary: string): Record<string, string> {
  const tint = mixHex(primary, "FFFFFF", 0.85);
  const shade = mixHex(primary, "000000", 0.75);
  const primaryLum = relativeLuminanceOfHex(primary);
  const whiteContrast = (1.05) / (primaryLum + 0.05);
  const blackContrast = (primaryLum + 0.05) / 0.05;
  return {
    "brand.primary": primary,
    "brand.primary.tint": tint,
    "brand.primary.shade": shade,
    "brand.onPrimary": whiteContrast >= blackContrast ? "FFFFFF" : "000000",
  };
}

function mixHex(a: string, b: string, weight: number): string {
  const hex = (input: string) => [parseInt(input.slice(0, 2), 16), parseInt(input.slice(2, 4), 16), parseInt(input.slice(4, 6), 16)] as const;
  const [ar, ag, ab] = hex(a);
  const [br, bg, bb] = hex(b);
  const blend = (x: number, y: number) => Math.round(x * weight + y * (1 - weight));
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0").toUpperCase();
  return `${toHex(blend(ar, br))}${toHex(blend(ag, bg))}${toHex(blend(ab, bb))}`;
}

export type FontRole = "display" | "text" | "mono";

function chainFor(theme: SimpleTheme, script: "latin" | "cjk" | "mono", role: FontRole): string[] {
  if (script === "mono") return theme.fonts.mono;
  const branch = theme.fonts[script];
  if (role === "display") return branch.display.length ? branch.display : branch.text;
  return branch.text.length ? branch.text : branch.display;
}

export function fontFamilyChain(theme: SimpleTheme, script: "latin" | "cjk" | "mono", role: FontRole = "text"): string {
  return chainFor(theme, script, role).join(", ");
}

/**
 * Pick the head-of-chain font for the requested script + role. OOXML's
 * `typeface` attribute takes ONE name, so SlideML resolves the chain to a
 * single face here. If a numeric `weight` is supplied and the chosen face
 * has a known weight-suffix variant ("Inter Bold", "Inter Light"), we
 * prefer the suffix so renderers with the variant installed pick the
 * correct outline. Renderers without the variant fall back to the base
 * face's weight scaling.
 */
export function preferredFont(
  theme: SimpleTheme,
  script: "latin" | "cjk" | "mono",
  role: FontRole = "text",
  weight?: FontWeight,
): string {
  const chain = chainFor(theme, script, role);
  const head = chain[0] || theme.fontFace;
  const numericWeight = resolveNumericWeight(weight);
  if (script === "mono" || script === "cjk" || numericWeight === undefined || numericWeight === 400) return head;
  // Suffixes only apply when the face name doesn't already carry one.
  if (/\b(thin|light|medium|semibold|bold|black)\b/i.test(head)) return head;
  const suffix = weightSuffixForFace(head, numericWeight);
  return suffix ? `${head} ${suffix}` : head;
}

function weightSuffixForFace(face: string, numericWeight: number): string | undefined {
  const lower = face.toLowerCase();
  if (lower.includes("arial")) {
    if (numericWeight >= 600) return "Bold";
    return undefined;
  }
  if (lower.includes("helvetica neue") || lower === "helvetica") {
    if (numericWeight >= 600) return "Bold";
    if (numericWeight === 500) return "Medium";
    if (numericWeight === 300) return "Light";
    if (numericWeight === 100) return "Thin";
    return undefined;
  }
  return WEIGHT_SUFFIX[numericWeight];
}

const WEIGHT_SUFFIX: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};

/** Convert a TextStyle/RichTextRun weight into (numeric, isBold) for the
 *  emitter. Numeric weights >= 600 emit `b="1"` so renderers without the
 *  named typeface variant still get visible emphasis. */
export function resolveFontWeight(weight: FontWeight | undefined): { numeric: number; bold: boolean } {
  const numeric = resolveNumericWeight(weight) ?? 400;
  return { numeric, bold: numeric >= 600 };
}

/**
 * Semantic emphasis vocabulary. Agents pick a word ("key", "muted",
 * "danger") and the theme resolves it to the right combination of color +
 * weight + letter-spacing. The same word stays meaningful across themes
 * (e.g. "danger" picks the theme's danger token, not a hardcoded red).
 *
 * Resolution rules:
 *   - color hint may be a token name or undefined (caller falls back to style.color)
 *   - weight hint is numeric/named; only applied when caller's weight is unset
 *   - letterSpacing is in 1/100 pt — small negative values tighten kerning
 *     for hero / display roles
 */
export type EmphasisName =
  | "lead"     // soft heading-of-paragraph emphasis
  | "key"      // important keyword inside body text
  | "strong"   // hard emphasis, like CSS <strong>
  | "muted"    // de-emphasized supporting copy
  | "subtle"   // even softer than muted
  | "accent"   // brand accent color
  | "danger"   // semantic warning / negative
  | "warning"  // semantic caution
  | "success"  // semantic positive
  | "info";    // semantic info / neutral-blue

export interface EmphasisStyle {
  color?: string;
  weight?: FontWeight;
  italic?: boolean;
  letterSpacing?: number;
}

const EMPHASIS_TABLE: Record<EmphasisName, EmphasisStyle> = {
  lead: { weight: "medium", color: "text.primary" },
  key: { weight: "semibold", color: "text.primary" },
  strong: { weight: "bold", color: "text.primary" },
  muted: { color: "text.muted" },
  subtle: { color: "text.muted", weight: "light" },
  accent: { color: "brand.primary", weight: "semibold" },
  danger: { color: "danger", weight: "semibold" },
  warning: { color: "warning", weight: "semibold" },
  success: { color: "success", weight: "semibold" },
  info: { color: "info", weight: "semibold" },
};

export function listEmphasisNames(): EmphasisName[] {
  return Object.keys(EMPHASIS_TABLE) as EmphasisName[];
}

export function resolveEmphasis(emphasis: unknown): EmphasisStyle | undefined {
  if (typeof emphasis !== "string") return undefined;
  const key = emphasis.trim().toLowerCase() as EmphasisName;
  if (key in EMPHASIS_TABLE) return EMPHASIS_TABLE[key];
  return undefined;
}

// CSS-style named weight axis. Agents reach for these words ("medium",
// "semibold") instead of remembering the numeric scale; we resolve them to
// numeric so downstream logic — typeface variant naming, OOXML `b`
// attribute — has a single source of truth. `regular` is an alias for
// `normal` because both wordings are common.
const NAMED_WEIGHTS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  normal: 400,
  regular: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  heavy: 800,
  black: 900,
  super: 900,
};

function resolveNumericWeight(weight: FontWeight | undefined): number | undefined {
  if (typeof weight === "number") {
    if (weight < 100 || weight > 900) return undefined;
    return Math.round(weight / 100) * 100;
  }
  if (typeof weight === "string") {
    const named = NAMED_WEIGHTS[weight.trim().toLowerCase()];
    if (typeof named === "number") return named;
  }
  return undefined;
}
