/**
 * LayoutContext — what a layout/component module receives.
 *
 * Layouts are pure functions: `(ctx) => ShapeList`. They never touch raw
 * EMU; they call `cm()`, `pt()`, `inch()`, `token()`, `font()`, and the
 * positioning helpers (`centerH`, `gridCol`, etc.) so the language stays
 * coordinate-free at the call site.
 *
 * Each render call creates a fresh context. Shape IDs are auto-issued
 * starting from 2 (id 1 is reserved by OOXML for the slide's nvGrpSpPr).
 */

import { cm as cmFn, inch as inchFn, pt as ptFn } from "../units.js";
import { primaryFontFace, type FontHint } from "../fonts.js";
import type { LoadedTheme, RequiredTokens, TokenValue } from "../theme/types.js";
import type { ShapeList } from "../emitter/types.js";

export interface DeckGeometry {
  /** Total slide width in EMU. */
  width: number;
  /** Total slide height in EMU. */
  height: number;
}

/** A column descriptor returned by `gridCol`. */
export interface GridCell {
  x: number;
  width: number;
}

export interface LayoutContext {
  /** EMU helpers. Layouts use these instead of raw numbers. */
  cm: (n: number) => number;
  pt: (n: number) => number;
  inch: (n: number) => number;

  /** Resolve a theme token by name. Throws on unknown tokens. */
  token: (name: keyof RequiredTokens | string) => TokenValue;

  /** Convenience: get a token value as a HexColor (asserts type). */
  color: (name: keyof RequiredTokens | string) => string;

  /**
   * Resolve a font face. `font("cjk")` / `font("latin")` / `font("mono")`
   * returns the FIRST family in the relevant fallback chain — OOXML's
   * `typeface=` attribute takes a single name, not a stack.
   */
  font: (hint: "latin" | "cjk" | "mono") => string;

  /** Slide geometry in EMU. */
  deck: DeckGeometry;

  /** Looks up a slot value. Throws if the slot wasn't provided AND wasn't
   *  marked optional; returns `undefined` for optional missing slots. */
  slot: <T = unknown>(name: string) => T | undefined;

  /** True when the slot was provided (regardless of value). */
  hasSlot: (name: string) => boolean;

  /** Issue a fresh shape ID. */
  id: () => number;

  /**
   * Center an element of `width` horizontally on the slide.
   * Returns the EMU x-coordinate.
   */
  centerH: (width: number) => number;

  /**
   * Center an element of `height` vertically on the slide.
   * Returns the EMU y-coordinate.
   */
  centerV: (height: number) => number;

  /**
   * `gridCol(index, totalCols, options)` — one column of an N-column grid
   * inside a band that spans the slide width with edge margins.
   *
   * - `index` is 0-based.
   * - `gap` is inter-column spacing in EMU; default `cm(1)`.
   * - `marginX` is left/right edge inset; default `cm(2)`.
   */
  gridCol: (
    index: number,
    totalCols: number,
    options?: { gap?: number; marginX?: number },
  ) => GridCell;

  /** Run-language hint: "cjk" if the deck language is a CJK locale. */
  cjk: boolean;

  /**
   * Theme-level style flags from `manifest.style`. Primitives consult
   * these to apply theme-driven design defaults (e.g. whether to draw
   * an accent rule under titles). All groups have sane defaults — old
   * themes that omit any of these keep working.
   */
  style: {
    titleAccentRule: boolean;
    bullets?: { glyph?: string; color?: string; level1?: string; level2?: string };
    surface: SurfaceStyle;
    semantic: SemanticPalette;
    dataviz: DatavizPalette;
    typography: TypographyPolicy;
    numbering: { style: NumberingStyle };
    chips: ChipsOverrides;
    image: ImageStyle;
    chart: ChartStyle;
    table: TableStyle;
  };

  /**
   * Resolve a semantic size token to half-points (PowerPoint's run unit).
   * Defaults: xs=20, sm=24, base=28, lg=36, xl=48, display=96, hero=192.
   * Themes override via manifest.style.fontSizes (in pt) or via the
   * modular scale (style.typography.{baseHalfPt, ratio}). When typography
   * scale is set it takes precedence; layouts that opt for size tokens
   * automatically inherit theme-appropriate density.
   */
  size: (token: SizeToken) => number;

  /**
   * Resolve a text role to a complete style snapshot
   * { sizeHalfPt, weight, transform, trackingHalfPt }. Layouts call
   * `ctx.role("title")` instead of hardcoding sizeHalfPt + bold; a
   * magazine theme can flip every title to small-caps without any layout
   * code change. Roles map to size tokens by default:
   *   title=display, heading=xl, body=base, caption=sm, label=xs.
   */
  role: (name: TextRole) => RoleStyle;

  /**
   * Resolve a semantic color (positive/negative/warning/info/neutral).
   * Falls back to brand-aligned defaults when the theme doesn't override.
   * Used by SWOT, chips, alerts, status badges.
   */
  semantic: (kind: SemanticKind) => string;
}

export type SizeToken = "xs" | "sm" | "base" | "lg" | "xl" | "display" | "hero";
export type TextRole = "title" | "heading" | "body" | "caption" | "label";
export type SemanticKind = "positive" | "negative" | "warning" | "info" | "neutral";
export type NumberingStyle = "padded" | "decimal" | "roman" | "circled";

export interface SurfaceStyle {
  cornerRadius: number;
  elevation: "flat" | "hairline" | "shadow";
  accentStripe: { position: "top" | "left" | "none"; widthCm: number; color: string };
  borderPolicy: "card-only" | "full" | "none";
}
export interface SemanticPalette {
  positive: string;
  negative: string;
  warning: string;
  info: string;
  neutral: string;
}
export interface DatavizPalette {
  categorical: readonly string[];
  sequential: { from: string; to: string };
  diverging: { negative: string; mid: string; positive: string };
}
export interface TypographyPolicy {
  baseHalfPt: number;
  ratio: number;
  italicCjk: boolean;
  numerals: "proportional" | "tabular";
  roles: Record<TextRole, RoleStyle>;
}
export interface RoleStyle {
  sizeHalfPt: number;
  weight: "regular" | "medium" | "bold";
  transform: "none" | "upper" | "smallCaps";
  trackingHalfPt: number;
}
export interface ChipsOverrides {
  up?: { glyph?: string; color?: string };
  down?: { glyph?: string; color?: string };
  flat?: { glyph?: string; color?: string };
  ok?: { glyph?: string; color?: string };
  warn?: { glyph?: string; color?: string };
  bad?: { glyph?: string; color?: string };
  highlight?: { glyph?: string; color?: string };
}
export interface ImageStyle {
  defaultClip: "rect" | "rounded" | "circle";
  border?: { widthPt: number; color: string };
  treatment: "none" | "sepia" | "duotone" | "grayscale";
}
export interface ChartStyle {
  gridStyle: "solid" | "dashed" | "none";
  barCornerRadius: number;
  dataLabelPosition: "inside" | "outside" | "none";
}
export interface TableStyle {
  headerFill: string;
  rowStripe: boolean;
  borderStyle: "full" | "rows" | "none";
  firstColEmphasis: "none" | "bold" | "accent";
}

const DEFAULT_SIZES_PT: Record<SizeToken, number> = {
  xs: 10, sm: 12, base: 14, lg: 18, xl: 24, display: 48, hero: 96,
};

// Default role → size-token mapping. Themes can override per role via
// style.typography.roles; the size token resolves through the modular
// scale OR style.fontSizes OR the hardcoded default in that order.
const ROLE_TO_SIZE_TOKEN: Record<TextRole, SizeToken> = {
  title:   "display",
  heading: "xl",
  body:    "base",
  caption: "sm",
  label:   "xs",
};
const DEFAULT_ROLE_WEIGHT: Record<TextRole, "regular" | "medium" | "bold"> = {
  title: "bold", heading: "bold", body: "regular", caption: "regular", label: "medium",
};

// Default semantic palette — neutral, AA-contrasting on white. Themes
// override via style.semantic. Do NOT change these defaults lightly:
// every chip and SWOT cell falls back here when a theme is silent.
const DEFAULT_SEMANTIC: SemanticPalette = {
  positive: "1E8449",
  negative: "C0392B",
  warning:  "B7950B",
  info:     "2874A6",
  neutral:  "6B7280",
};

const DEFAULT_DATAVIZ: DatavizPalette = {
  categorical: ["3B6FA4", "C0392B", "1E8449", "B7950B", "8E44AD", "16A085"],
  sequential:  { from: "E5EEF7", to: "1F4E79" },
  diverging:   { negative: "C0392B", mid: "F4F1E8", positive: "1E8449" },
};

const DEFAULT_SURFACE: SurfaceStyle = {
  cornerRadius: 0.03,
  elevation: "hairline",
  accentStripe: { position: "none", widthCm: 0.12, color: "brand-primary" },
  borderPolicy: "card-only",
};

const DEFAULT_IMAGE: ImageStyle = {
  defaultClip: "rect",
  treatment: "none",
};

const DEFAULT_CHART: ChartStyle = {
  gridStyle: "solid",
  barCornerRadius: 0,
  dataLabelPosition: "outside",
};

const DEFAULT_TABLE: TableStyle = {
  headerFill: "brand-deep",
  rowStripe: true,
  borderStyle: "rows",
  firstColEmphasis: "none",
};

export interface BuildContextOptions {
  theme: LoadedTheme;
  deck: DeckGeometry;
  slots: Record<string, unknown>;
  /** Optional language; falls back to `en-US` if absent. */
  language?: string;
  /** Initial id counter (defaults to 2 — id 1 is reserved by the slide group). */
  startId?: number;
}

/**
 * Build a fresh `LayoutContext`. Used by the renderer once per slide and
 * once per component invocation (components share the slide's id pool).
 */
export function buildLayoutContext(opts: BuildContextOptions): LayoutContext {
  const { theme, deck, slots, language, startId = 2 } = opts;
  const tokens = theme.manifest.tokens;
  let nextId = startId;

  const isCjk = !!language && /^(zh|ja|ko)/i.test(language);

  return {
    cm: cmFn,
    pt: ptFn,
    inch: inchFn,

    token(name) {
      if (!(name in tokens)) {
        throw new Error(
          `LayoutContext.token("${String(name)}"): unknown token. Theme "${theme.manifest.name}" defines: ${Object.keys(tokens).join(", ")}`,
        );
      }
      return tokens[name as string]!;
    },

    color(name) {
      const v = this.token(name);
      if (typeof v !== "string") {
        throw new Error(`LayoutContext.color("${String(name)}"): token is not a color string`);
      }
      return v;
    },

    font(hint) {
      // The layout asks for a semantic role; we return the right face based
      // on whether the deck is CJK. Latin layouts ignore `cjk`; CJK content
      // shapes should call `font("cjk")` explicitly.
      if (hint === "mono") return primaryFontFace("mono");
      if (hint === "cjk") return resolveFontFromToken(tokens["font-cjk"], "cjk-zh" as FontHint);
      return resolveFontFromToken(tokens["font-latin"], "latin");
    },

    deck,

    slot(name) {
      return slots[name] as never;
    },

    hasSlot(name) {
      return Object.prototype.hasOwnProperty.call(slots, name) && slots[name] !== undefined && slots[name] !== null;
    },

    id() {
      const v = nextId;
      nextId++;
      return v;
    },

    centerH(width) {
      return Math.round((deck.width - width) / 2);
    },

    centerV(height) {
      return Math.round((deck.height - height) / 2);
    },

    gridCol(index, totalCols, options) {
      const gap = options?.gap ?? cmFn(1);
      const marginX = options?.marginX ?? cmFn(2);
      const usable = deck.width - 2 * marginX;
      const totalGap = gap * Math.max(0, totalCols - 1);
      const colWidth = Math.floor((usable - totalGap) / totalCols);
      const x = marginX + index * (colWidth + gap);
      return { x, width: colWidth };
    },

    cjk: isCjk,

    style: buildStyle(theme),

    size(token) {
      return resolveSizeHalfPt(theme, token);
    },

    role(name) {
      return resolveRole(theme, name);
    },

    semantic(kind) {
      const palette = (theme.manifest.style?.semantic ?? {}) as Partial<SemanticPalette>;
      return palette[kind] ?? DEFAULT_SEMANTIC[kind];
    },
  };
}

function resolveSizeHalfPt(theme: LoadedTheme, token: SizeToken): number {
  const sty = theme.manifest.style ?? {};
  // 1) modular scale takes precedence when typography.baseHalfPt + ratio set.
  const typ = sty.typography ?? {};
  if (typeof typ.baseHalfPt === "number" && typeof typ.ratio === "number") {
    const steps: Record<SizeToken, number> = {
      xs: -2, sm: -1, base: 0, lg: 1, xl: 2, display: 4, hero: 6,
    };
    return Math.round(typ.baseHalfPt * Math.pow(typ.ratio, steps[token]));
  }
  // 2) explicit fontSizes pt mapping.
  const overrides = sty.fontSizes ?? {};
  const pt = overrides[token] ?? DEFAULT_SIZES_PT[token];
  return Math.round(pt * 2);
}

function resolveRole(theme: LoadedTheme, name: TextRole): RoleStyle {
  const role = theme.manifest.style?.typography?.roles?.[name] ?? {};
  return {
    sizeHalfPt: resolveSizeHalfPt(theme, ROLE_TO_SIZE_TOKEN[name]),
    weight: role.weight ?? DEFAULT_ROLE_WEIGHT[name],
    transform: role.transform ?? "none",
    trackingHalfPt: role.trackingHalfPt ?? 0,
  };
}

function buildStyle(theme: LoadedTheme): LayoutContext["style"] {
  const s = theme.manifest.style ?? {};

  // Surface — merge theme override into defaults; nested accentStripe
  // also merges so themes can set just `position: "left"` without losing
  // widthCm / color.
  const themeSurface = s.surface ?? {};
  const surface: SurfaceStyle = {
    cornerRadius: themeSurface.cornerRadius ?? DEFAULT_SURFACE.cornerRadius,
    elevation: themeSurface.elevation ?? DEFAULT_SURFACE.elevation,
    accentStripe: {
      position: themeSurface.accentStripe?.position ?? DEFAULT_SURFACE.accentStripe.position,
      widthCm: themeSurface.accentStripe?.widthCm ?? DEFAULT_SURFACE.accentStripe.widthCm,
      color: themeSurface.accentStripe?.color ?? DEFAULT_SURFACE.accentStripe.color,
    },
    borderPolicy: themeSurface.borderPolicy ?? DEFAULT_SURFACE.borderPolicy,
  };

  const semantic: SemanticPalette = {
    positive: s.semantic?.positive ?? DEFAULT_SEMANTIC.positive,
    negative: s.semantic?.negative ?? DEFAULT_SEMANTIC.negative,
    warning:  s.semantic?.warning  ?? DEFAULT_SEMANTIC.warning,
    info:     s.semantic?.info     ?? DEFAULT_SEMANTIC.info,
    neutral:  s.semantic?.neutral  ?? DEFAULT_SEMANTIC.neutral,
  };

  const dv = s.dataviz ?? {};
  const dataviz: DatavizPalette = {
    categorical: dv.categorical ?? DEFAULT_DATAVIZ.categorical,
    sequential:  dv.sequential  ?? DEFAULT_DATAVIZ.sequential,
    diverging:   dv.diverging   ?? DEFAULT_DATAVIZ.diverging,
  };

  const t = s.typography ?? {};
  const tRoles = t.roles ?? {};
  const typography: TypographyPolicy = {
    baseHalfPt: t.baseHalfPt ?? 28,
    ratio: t.ratio ?? 1.25,
    italicCjk: t.italicCjk ?? false,
    numerals: t.numerals ?? "proportional",
    roles: {
      title:   { sizeHalfPt: 0, weight: tRoles.title?.weight   ?? "bold",    transform: tRoles.title?.transform   ?? "none", trackingHalfPt: tRoles.title?.trackingHalfPt   ?? 0 },
      heading: { sizeHalfPt: 0, weight: tRoles.heading?.weight ?? "bold",    transform: tRoles.heading?.transform ?? "none", trackingHalfPt: tRoles.heading?.trackingHalfPt ?? 0 },
      body:    { sizeHalfPt: 0, weight: tRoles.body?.weight    ?? "regular", transform: tRoles.body?.transform    ?? "none", trackingHalfPt: tRoles.body?.trackingHalfPt    ?? 0 },
      caption: { sizeHalfPt: 0, weight: tRoles.caption?.weight ?? "regular", transform: tRoles.caption?.transform ?? "none", trackingHalfPt: tRoles.caption?.trackingHalfPt ?? 0 },
      label:   { sizeHalfPt: 0, weight: tRoles.label?.weight   ?? "medium",  transform: tRoles.label?.transform   ?? "none", trackingHalfPt: tRoles.label?.trackingHalfPt   ?? 0 },
    },
  };

  const numbering = { style: (s.numbering?.style ?? "padded") as NumberingStyle };

  const image: ImageStyle = {
    defaultClip: s.image?.defaultClip ?? DEFAULT_IMAGE.defaultClip,
    ...(s.image?.border ? { border: { widthPt: s.image.border.widthPt ?? 0.5, color: s.image.border.color ?? "divider" } } : {}),
    treatment: s.image?.treatment ?? DEFAULT_IMAGE.treatment,
  };

  const chart: ChartStyle = {
    gridStyle: s.chart?.gridStyle ?? DEFAULT_CHART.gridStyle,
    barCornerRadius: s.chart?.barCornerRadius ?? DEFAULT_CHART.barCornerRadius,
    dataLabelPosition: s.chart?.dataLabelPosition ?? DEFAULT_CHART.dataLabelPosition,
  };

  const table: TableStyle = {
    headerFill: s.table?.headerFill ?? DEFAULT_TABLE.headerFill,
    rowStripe: s.table?.rowStripe ?? DEFAULT_TABLE.rowStripe,
    borderStyle: s.table?.borderStyle ?? DEFAULT_TABLE.borderStyle,
    firstColEmphasis: s.table?.firstColEmphasis ?? DEFAULT_TABLE.firstColEmphasis,
  };

  return {
    titleAccentRule: s.titleAccentRule ?? true,
    bullets: s.bullets,
    surface,
    semantic,
    dataviz,
    typography,
    numbering,
    chips: s.chips ?? {},
    image,
    chart,
    table,
  };
}

function resolveFontFromToken(value: TokenValue | undefined, fallbackHint: FontHint): string {
  if (Array.isArray(value) && value.length > 0) return value[0]!;
  return primaryFontFace(fallbackHint);
}

/** A layout module's default export — the render function shape. */
export type LayoutFn = (ctx: LayoutContext) => ShapeList;
