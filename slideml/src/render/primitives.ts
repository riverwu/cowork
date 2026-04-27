/**
 * Layout primitives — high-level building blocks shared across layouts.
 *
 * Goals:
 *   1. Eliminate the title-rule / card-backing / grid / bullets boilerplate
 *      every layout was duplicating (~30 lines per layout × 16 layouts).
 *   2. Centralize chrome-zone awareness: `contentRect()` returns a
 *      rectangle that already accounts for header/footer chrome bands.
 *   3. Provide graceful degradation (`imageOrPlaceholder`, `textBlockOf`).
 *   4. Give theme authors one place to change visual style without
 *      hunting through 16 layouts.
 *
 * Convention: every primitive takes `ctx: LayoutContext` first, returns a
 * `ShapeList` (even single-shape primitives — easy to spread). Options
 * objects come last and every field is optional.
 */

import type { LayoutContext } from "./layout-context.js";
import type { ShapeList } from "../emitter/types.js";

// ---------------------------------------------------------------------------
// Title + accent rule
// ---------------------------------------------------------------------------

export interface TitleOptions {
  /** Override font color (defaults to "text-strong"). */
  color?: string;
  /** Override font size in half-points (defaults to 44 / 22pt). */
  sizeHalfPt?: number;
  /** Whether to render the accent rule under the title. Default true. */
  rule?: boolean;
  /** Token name for the rule color (defaults to "brand-primary"). */
  ruleColor?: string;
  /** y position of the title. Default cm(1.4). */
  y?: number;
}

/**
 * Standard slide title: bold left-aligned text + (optionally) a brand-color
 * accent rule beneath. The accent rule defaults to the theme's
 * `style.titleAccentRule` flag — restrained themes (editorial, minimal)
 * suppress it because universal accent rules are an AI-generated-deck
 * tell (per Pptx skill guidance).
 *
 * Layouts can force the rule on/off via `opts.rule`.
 */
export function slideTitle(ctx: LayoutContext, text: string, opts: TitleOptions = {}): ShapeList {
  const out: ShapeList = [];
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const y = opts.y ?? ctx.cm(1.4);

  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: ctx.cm(2), y, cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(1.6) },
    valign: "middle",
    paragraphs: [{
      align: "left",
      runs: [{
        text,
        sizeHalfPt: opts.sizeHalfPt ?? 44,
        color: ctx.color(opts.color ?? "text-strong"),
        bold: true,
        cjk: ctx.cjk,
        fontFace,
      }],
    }],
  });

  const showRule = opts.rule ?? ctx.style.titleAccentRule;
  if (showRule) {
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: ctx.cm(2), y: y + ctx.cm(1.8), cx: ctx.cm(2.4), cy: ctx.cm(0.12) },
      fill: { type: "solid", color: ctx.color(opts.ruleColor ?? "brand-primary") },
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Content rectangle — chrome-aware
// ---------------------------------------------------------------------------

export interface ContentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContentRectOptions {
  /** Top inset from header band (or slide top when no header). Default cm(2). */
  top?: number;
  /** Bottom inset from footer/brand-bar (or slide bottom). Default cm(2). */
  bottom?: number;
  /** Horizontal margins. Default cm(2). */
  marginX?: number;
}

/**
 * The rectangle a layout should paint into. Chrome reservations (header
 * band cm(0.95), footer band cm(1.0), brand-bar cm(0.18)) are NOT yet
 * subtracted automatically — that's a future stage; for now the default
 * insets are tuned so layouts visually clear typical chrome. Use this
 * primitive everywhere to make the future shrink mechanical.
 */
export function contentRect(ctx: LayoutContext, opts: ContentRectOptions = {}): ContentRect {
  const top = opts.top ?? ctx.cm(2);
  const bottom = opts.bottom ?? ctx.cm(2);
  const marginX = opts.marginX ?? ctx.cm(2);
  return {
    x: marginX,
    y: top,
    width: ctx.deck.width - marginX * 2,
    height: ctx.deck.height - top - bottom,
  };
}

// ---------------------------------------------------------------------------
// Card backing — rounded rect with optional accent stripe
// ---------------------------------------------------------------------------

export interface CardOptions {
  /** Background fill token. Default "bg-card". */
  fill?: string;
  /** Border color token. Default "divider". */
  borderColor?: string;
  /** Border width in EMU. Default ctx.pt(0.5). */
  borderWidth?: number;
  /** Corner radius (0..0.5 of min(width,height)). Default 0.03. */
  cornerRadius?: number;
  /** Optional accent stripe token name. Stripe sits across the top, height cm(0.12). */
  accentStripe?: string;
}

/**
 * Rounded card backing — the workhorse for KPI tiles, comparison panes,
 * sidebars, etc. Returns either one shape (just the card) or two (card +
 * accent stripe).
 */
export function card(ctx: LayoutContext, rect: ContentRect, opts: CardOptions = {}): ShapeList {
  const out: ShapeList = [];
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "roundRect",
    xfrm: { x: rect.x, y: rect.y, cx: rect.width, cy: rect.height },
    fill: { type: "solid", color: ctx.color(opts.fill ?? "bg-card") },
    line: { color: ctx.color(opts.borderColor ?? "divider"), width: opts.borderWidth ?? ctx.pt(0.5) },
    cornerRadius: opts.cornerRadius ?? 0.03,
  });
  if (opts.accentStripe) {
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: rect.x, y: rect.y, cx: rect.width, cy: ctx.cm(0.12) },
      fill: { type: "solid", color: ctx.color(opts.accentStripe) },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grid columns — N equal columns inside a content rect
// ---------------------------------------------------------------------------

export interface GridColsOptions {
  /** Inter-column gap. Default cm(1.2). */
  gap?: number;
}

/**
 * Subdivide a content rectangle into N equal-width columns with `gap`
 * between them. Returns one ContentRect per column (same y/height as the
 * source rect).
 */
export function gridCols(ctx: LayoutContext, rect: ContentRect, n: number, opts: GridColsOptions = {}): ContentRect[] {
  const gap = opts.gap ?? ctx.cm(1.2);
  const totalGap = gap * Math.max(0, n - 1);
  const colW = Math.floor((rect.width - totalGap) / n);
  const out: ContentRect[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: rect.x + i * (colW + gap),
      y: rect.y,
      width: colW,
      height: rect.height,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bullets block — text shape with bullet styling
// ---------------------------------------------------------------------------

export interface BulletsBlockOptions {
  /** Bullet text size in half-points. Default 28 (= 14pt). */
  sizeHalfPt?: number;
  /** Color token for the text. Default "text-strong". */
  color?: string;
  /** Line spacing in half-points. Default 56. */
  lineSpacingHalfPt?: number;
  /** Space after each item in half-points. Default 16. */
  spaceAfterHalfPt?: number;
  /** Whether to render leading bullets. Default true. */
  bullets?: boolean;
}

/**
 * Bullet list inside a rectangle. Coerces array entries to strings.
 * Returns one TextShape — the caller passes a card backing separately
 * if needed.
 */
export function bulletsBlock(ctx: LayoutContext, rect: ContentRect, items: readonly unknown[], opts: BulletsBlockOptions = {}): ShapeList {
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  return [{
    type: "text",
    id: ctx.id(),
    xfrm: { x: rect.x, y: rect.y, cx: rect.width, cy: rect.height },
    valign: "top",
    paragraphs: items.map((item) => ({
      align: "left",
      bullet: opts.bullets === false ? undefined : ({ auto: true } as const),
      lineSpacingHalfPt: opts.lineSpacingHalfPt ?? 56,
      spaceAfterHalfPt: opts.spaceAfterHalfPt ?? 16,
      runs: [{
        text: String(item),
        sizeHalfPt: opts.sizeHalfPt ?? 28,
        color: ctx.color(opts.color ?? "text-strong"),
        cjk: ctx.cjk,
        fontFace,
      }],
    })),
  }];
}

// ---------------------------------------------------------------------------
// KPI tile — card with value, label, optional delta+trend
// ---------------------------------------------------------------------------

export interface KpiData {
  value: string;
  label: string;
  delta?: string;
  trend?: "up" | "down" | "flat";
}

export interface KpiTileOptions {
  /** Token for the value text. Default "brand-primary". */
  valueColor?: string;
  /** Value font size half-points. Default 60 (= 30pt). */
  valueSizeHalfPt?: number;
  /** Pass true to draw a card backing under the tile. Default true. */
  card?: boolean;
}

/** A full KPI tile — card backing + big value + label + delta line. */
export function kpiTile(ctx: LayoutContext, rect: ContentRect, kpi: KpiData, opts: KpiTileOptions = {}): ShapeList {
  const out: ShapeList = [];
  if (opts.card !== false) {
    out.push(...card(ctx, rect, { accentStripe: "brand-primary" }));
  }
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const inset = ctx.cm(0.6);

  // Big value
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: rect.x + inset, y: rect.y + ctx.cm(0.6), cx: rect.width - inset * 2, cy: ctx.cm(2.0) },
    valign: "middle",
    paragraphs: [{
      align: "left",
      runs: [{
        text: kpi.value,
        sizeHalfPt: opts.valueSizeHalfPt ?? 60,
        color: ctx.color(opts.valueColor ?? "brand-primary"),
        bold: true,
        cjk: ctx.cjk,
        fontFace,
      }],
    }],
  });

  // Label
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: rect.x + inset, y: rect.y + ctx.cm(2.7), cx: rect.width - inset * 2, cy: ctx.cm(0.9) },
    valign: "top",
    paragraphs: [{
      align: "left",
      runs: [{
        text: kpi.label,
        sizeHalfPt: 24,
        color: ctx.color("text-muted"),
        cjk: ctx.cjk,
        fontFace,
      }],
    }],
  });

  // Delta + trend arrow
  if (kpi.delta) {
    const arrow = kpi.trend === "up" ? "▲" : kpi.trend === "down" ? "▼" : "→";
    const trendColor = kpi.trend === "down" ? ctx.color("text-strong") : ctx.color("brand-primary");
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: rect.x + inset, y: rect.y + rect.height - ctx.cm(1.2), cx: rect.width - inset * 2, cy: ctx.cm(0.7) },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [
          { text: `${arrow} `, sizeHalfPt: 22, color: trendColor, bold: true, cjk: ctx.cjk, fontFace },
          { text: kpi.delta, sizeHalfPt: 22, color: ctx.color("text-muted"), cjk: ctx.cjk, fontFace },
        ],
      }],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Image-or-placeholder
// ---------------------------------------------------------------------------

export interface ImageOrPlaceholderOptions {
  /** Card backing color when no image is present. Default "bg-card". */
  placeholderFill?: string;
  /** Caption shown when no image is present. Default "[image]". */
  placeholderText?: string;
}

interface ImageRefValue { src: string; alt?: string }

/**
 * Render an image when present; otherwise paint a polite card placeholder.
 * Layouts that take an optional `image` slot should never branch — they
 * call this and trust the result.
 */
export function imageOrPlaceholder(
  ctx: LayoutContext,
  rect: ContentRect,
  image: ImageRefValue | undefined,
  opts: ImageOrPlaceholderOptions = {},
): ShapeList {
  if (image && image.src) {
    return [{
      type: "image",
      id: ctx.id(),
      xfrm: { x: rect.x, y: rect.y, cx: rect.width, cy: rect.height },
      src: image.src,
      altText: image.alt,
    }];
  }
  // Card backing + centered "[image]" caption.
  const out: ShapeList = card(ctx, rect, { fill: opts.placeholderFill ?? "bg-card" });
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: rect.x, y: rect.y, cx: rect.width, cy: rect.height },
    valign: "middle",
    paragraphs: [{
      align: "center",
      runs: [{
        text: opts.placeholderText ?? "[image]",
        sizeHalfPt: 22,
        color: ctx.color("text-muted"),
        cjk: ctx.cjk,
        fontFace,
      }],
    }],
  });
  return out;
}

// ---------------------------------------------------------------------------
// Coercions
// ---------------------------------------------------------------------------

/**
 * Pick the best-contrast foreground color (white vs theme text-strong)
 * for a given background hex. Used by full-bleed layouts (closing,
 * section-divider, hero overlays) so a theme with dark text-strong
 * doesn't paint dark-on-dark on a brand-deep panel.
 *
 * Uses WCAG relative luminance — same math as the theme contrast audit.
 */
export function bestTextOn(ctx: LayoutContext, bgHex: string): string {
  const lum = relLum(bgHex);
  // Compare to text-strong's luminance — pick whichever has more contrast.
  const strong = ctx.color("text-strong");
  const strongLum = relLum(strong);
  const whiteContrast = (1.0 + 0.05) / (lum + 0.05);
  const strongContrast = strongLum > lum
    ? (strongLum + 0.05) / (lum + 0.05)
    : (lum + 0.05) / (strongLum + 0.05);
  return whiteContrast >= strongContrast ? "FFFFFF" : strong;
}

function relLum(hex: string): number {
  const c = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * c(0) + 0.7152 * c(2) + 0.0722 * c(4);
}

/**
 * Normalize a text-block slot value into a single string. Real-LLM testing
 * showed agents naturally reach for `string[]` when a slot accepts "list of
 * points", so the validator accepts both shapes — this helper lets layout
 * code stay branch-free.
 */
export function textBlockOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return (value as string[]).join("\n\n");
  }
  return "";
}
