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
export type FontWeight = "normal" | "bold" | number;

export interface TextStyle {
  fontSize: number;
  weight?: FontWeight;
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
  radius?: number;
}

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
  const brandPrimary = normalizeHex(brand.primary || themeOverride?.colors?.["brand.primary"] || "2563EB");
  const base = defaultBase(brandPrimary);
  return mergeTheme(base, brandPrimary, themeOverride);
}

function mergeTheme(base: SimpleTheme, brandPrimary: string, override?: ThemeOverride): SimpleTheme {
  const merged: SimpleTheme = {
    ...base,
    colors: { ...base.colors, ...derivedBrandPalette(brandPrimary), ...(override?.colors || {}) },
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

function mergeTextStyles(base: Record<string, TextStyle>, override?: Record<string, Partial<TextStyle>>): Record<string, TextStyle> {
  if (!override) return { ...base };
  const out: Record<string, TextStyle> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key] || base.paragraph || { fontSize: 11, color: "text.primary", lineHeight: 1.4 };
    out[key] = {
      fontSize: typeof value.fontSize === "number" ? value.fontSize : existing.fontSize,
      weight: value.weight ?? existing.weight,
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
  return out;
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
    out[key] = { ...(base[key] || {}), ...value };
  }
  return out;
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
};

export function color(theme: SimpleTheme, value: unknown, fallback = "text.primary"): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (/^[0-9A-Fa-f]{6}$/.test(raw)) return raw.toUpperCase();
  if (theme.colors[raw]) return theme.colors[raw]!;
  // Try aliases before warning.
  const aliased = COLOR_ALIASES[raw];
  if (aliased && theme.colors[aliased]) return theme.colors[aliased]!;
  // Try simple suffix expansion: "red.tint" already exists; "red.bg" → "red.tint", etc.
  if (raw.endsWith(".bg") && theme.colors[raw.replace(/\.bg$/, ".tint")]) return theme.colors[raw.replace(/\.bg$/, ".tint")]!;
  if (raw.endsWith(".fg") && theme.colors[raw.replace(/\.fg$/, "")]) return theme.colors[raw.replace(/\.fg$/, "")]!;
  if (raw !== fallback) {
    colorWarnings.add(raw);
    pushDiagnostic({
      severity: "warn",
      code: "UNKNOWN_COLOR",
      message: `Unknown color token '${raw}'; falling back to '${fallback}'.`,
      suggestion: `Use a token from describeDeck().colorTokens (e.g. brand.primary, surface, text.primary, success, or palette colors red/orange/yellow/lime/green/teal/blue/purple/pink) or a 6-char hex.`,
    });
  }
  return theme.colors[fallback] || "111827";
}

function commonText(): Record<string, TextStyle> {
  // Typography is calibrated for 16:9 / 25.4×14.29 cm slides. The aim is a
  // strong title hierarchy with restrained body copy and visibly different
  // component roles. The default theme should already feel designed before
  // an agent adds a subject-specific themeOverride.
  return {
    "deck-title": { fontSize: 48, weight: "bold", color: "text.inverse", lineHeight: 1.04 },
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
    hero: { fontSize: 44, weight: "bold", color: "text.inverse", lineHeight: 1.06 },
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
      "success.tint": "E6F6EC",
      warning: "B45309",
      "warning.tint": "FFF6E6",
      danger: "B42318",
      "danger.tint": "FEECEB",
      ...defaultPalette(),
    },
    text: commonText(),
    sizeScale: { ...DEFAULT_SIZE_SCALE },
    component: {
      "metric-card": { fill: "surface", line: "divider", padding: 0.4, radius: 0.06 },
      callout: { fill: "brand.tint", line: "divider", accent: "brand.primary", padding: 0.55, radius: 0.06 },
      "comparison-card": { fill: "surface", line: "divider", padding: 0.55, radius: 0.06 },
      "step-card": { fill: "surface", line: "divider", padding: 0.55, radius: 0.06 },
      "definition-card": { fill: "surface", line: "divider", padding: 0.6, radius: 0.08 },
      quote: { fill: "surface.subtle", line: "divider", padding: 0.7, radius: 0.08 },
      "timeline-step": { fill: "surface", line: "divider", padding: 0.5, radius: 0.06 },
      "profile-card": { fill: "surface", line: "divider", padding: 0.5, radius: 0.08 },
      "swot-quadrant": { fill: "surface", line: "divider", padding: 0.55, radius: 0.06 },
      cta: { fill: "brand.primary", padding: 0.4, radius: 0.3 },
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
      panel: { fill: "surface", line: "divider", padding: 0.55, radius: 0.12 },
      card: { fill: "surface", line: "divider", padding: 0.6, radius: 0.12 },
      band: { fill: "surface.subtle", padding: 0.7, radius: 0 },
      frame: { line: "divider", padding: 0.5, radius: 0.12 },
      inset: { padding: 0.4, radius: 0 },
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
        display: ["Aptos Display", "Aptos", "Calibri", "Arial"],
        text: ["Aptos", "Calibri", "Arial"],
      },
      cjk: {
        display: ["PingFang SC", "Microsoft YaHei", "SimHei"],
        text: ["PingFang SC", "Microsoft YaHei", "SimHei"],
      },
      mono: ["Menlo", "Consolas", "Courier New"],
    },
    fontFace: "Aptos",
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
      contentBottom: 1.0,
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
  return /^[0-9A-Fa-f]{6}$/.test(cleaned) ? cleaned.toUpperCase() : "2563EB";
}

function derivedBrandPalette(primary: string): Record<string, string> {
  const tint = mixHex(primary, "FFFFFF", 0.85);
  const shade = mixHex(primary, "000000", 0.75);
  return {
    "brand.primary": primary,
    "brand.primary.tint": tint,
    "brand.primary.shade": shade,
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
  if (script === "mono" || numericWeight === undefined || numericWeight === 400) return head;
  // Suffixes only apply when the face name doesn't already carry one.
  if (/\b(thin|light|medium|semibold|bold|black)\b/i.test(head)) return head;
  const suffix = WEIGHT_SUFFIX[numericWeight];
  return suffix ? `${head} ${suffix}` : head;
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

function resolveNumericWeight(weight: FontWeight | undefined): number | undefined {
  if (typeof weight === "number") {
    if (weight < 100 || weight > 900) return undefined;
    return Math.round(weight / 100) * 100;
  }
  if (weight === "bold") return 700;
  if (weight === "normal") return 400;
  return undefined;
}
