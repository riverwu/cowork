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
import type { Paragraph, ShapeList, TableCell, TextRun } from "../emitter/types.js";
import { CHIP_KINDS, type ChipKind, parseInline } from "./markdown-inline.js";
import { type Density, densityPreset } from "./density.js";
import { svgToHighResDataUrl } from "./visual.js";

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
 *
 * Title text supports the inline-markdown subset (bold/italic/code/chips/
 * icons) — runs through `parseInline` so authors can emit a title like
 * `"Q3 results — {up:+12% YoY}"`.
 */
export function slideTitle(ctx: LayoutContext, text: string, opts: TitleOptions = {}): ShapeList {
  const out: ShapeList = [];
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const y = opts.y ?? ctx.cm(1.4);

  // Pull weight/transform/tracking from the title role (theme-coordinated)
  // but keep the legacy 44 halfPt (22pt) as the slide-title default.
  // Themes that want larger / smaller titles set
  // `style.typography.roles.title.sizeHalfPt` via a future override hook
  // OR pass `opts.sizeHalfPt` from the layout. Avoiding `role.sizeHalfPt`
  // here prevents regression on themes with no typography overrides
  // (where the modular scale's `display` step is much larger than the
  // historic title size).
  const role = ctx.role("title");
  const sizeHalfPt = opts.sizeHalfPt ?? 44;
  const transformedText = applyTextTransform(text, role.transform);

  const baseRuns = parseInline(transformedText, {
    sizeHalfPt,
    color: ctx.color(opts.color ?? "text-strong"),
    fontFace,
    monoFont: ctx.font("mono"),
    cjk: ctx.cjk,
    resolveChipColor: chipColorResolver(ctx),
    resolveChipGlyph: chipGlyphResolver(ctx),
  });
  const wantBold = role.weight !== "regular";
  const titleRuns: TextRun[] = baseRuns.map((r) => ({ ...r, bold: r.bold ?? wantBold }));

  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: ctx.cm(2), y, cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(1.6) },
    valign: "middle",
    autoFit: "shrink",
    paragraphs: [{
      align: "left",
      runs: titleRuns,
    }],
  });

  // Caller win, then theme. We honour explicit overrides regardless of
  // role transform (transforms only affect the displayed text).
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

/**
 * Apply theme-policy text transforms — `upper` uppercases (CJK pass-through
 * since CJK has no case), `smallCaps` is approximated by uppercasing for
 * latin runs (true small-caps require a font feature; uppercase reads
 * close enough at title sizes). `none` returns input unchanged.
 *
 * NOTE: this transforms the input STRING. inline markdown tokens (`{up:...}`,
 * backticks, etc.) survive uppercasing because their syntax is symbol-only.
 */
export function applyTextTransform(text: string, transform: "none" | "upper" | "smallCaps"): string {
  if (transform === "none") return text;
  return text.toLocaleUpperCase();
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
 * sidebars, etc. Returns one shape per visible element (card + optional
 * shadow + optional accent stripe).
 *
 * Theme-coordination: when the caller doesn't override `cornerRadius`,
 * `elevation`, or `accentStripe`, the values come from
 * `ctx.style.surface.*`. So a theme that sets `surface.elevation:
 * "shadow"` upgrades every card across every layout to a soft drop
 * shadow without touching layout source. Same for accent stripes — set
 * `accentStripe.position: "left"` and every cards' stripe migrates from
 * top-band to left-edge.
 */
export function card(ctx: LayoutContext, rect: ContentRect, opts: CardOptions = {}): ShapeList {
  const out: ShapeList = [];
  const surface = ctx.style.surface;
  const cornerRadius = opts.cornerRadius ?? surface.cornerRadius;

  // Elevation: "shadow" prepends a soft offset duplicate; "flat" omits
  // the border line; "hairline" (default) keeps the standard border.
  const elevation = surface.elevation;
  if (elevation === "shadow") {
    const offset = ctx.cm(0.18);
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "roundRect",
      xfrm: { x: rect.x + offset, y: rect.y + offset, cx: rect.width, cy: rect.height },
      fill: { type: "solid", color: "000000", alpha: 0.12 },
      line: { color: "000000", width: 0 },
      cornerRadius,
    });
  }

  const showBorder = elevation !== "flat" && surface.borderPolicy !== "none";
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "roundRect",
    xfrm: { x: rect.x, y: rect.y, cx: rect.width, cy: rect.height },
    fill: { type: "solid", color: ctx.color(opts.fill ?? "bg-card") },
    line: showBorder
      ? { color: ctx.color(opts.borderColor ?? "divider"), width: opts.borderWidth ?? ctx.pt(0.5) }
      : { color: "FFFFFF", width: 0 },
    cornerRadius,
  });

  // Accent stripe: per-call override OR theme surface default.
  const stripeColor = opts.accentStripe ?? (
    surface.accentStripe.position !== "none" ? surface.accentStripe.color : undefined
  );
  if (stripeColor) {
    const widthEmu = ctx.cm(surface.accentStripe.widthCm);
    const callerWantsTop = !!opts.accentStripe; // legacy callers always meant top
    const position = callerWantsTop ? "top" : surface.accentStripe.position;
    if (position === "top") {
      out.push({
        type: "shape",
        id: ctx.id(),
        preset: "rect",
        xfrm: { x: rect.x, y: rect.y, cx: rect.width, cy: widthEmu },
        fill: { type: "solid", color: ctx.color(stripeColor) },
      });
    } else if (position === "left") {
      out.push({
        type: "shape",
        id: ctx.id(),
        preset: "rect",
        xfrm: { x: rect.x, y: rect.y, cx: widthEmu, cy: rect.height },
        fill: { type: "solid", color: ctx.color(stripeColor) },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grid columns — N equal columns inside a content rect
// ---------------------------------------------------------------------------

export interface GridColsOptions {
  /** Inter-column gap. Default cm(1.2). */
  gap?: number;
  /**
   * Per-column relative weights. When supplied, must have length === n;
   * column widths are proportional to these weights. Default = all 1s
   * (equal columns). Examples:
   *   [1, 1]      → 50/50    (default for n=2)
   *   [3, 2]      → 60/40
   *   [1, 2, 1]   → 25/50/25 (wide center)
   *   [2, 1, 1]   → 50/25/25 (wide left)
   */
  weights?: readonly number[];
}

/**
 * Subdivide a content rectangle into N columns with `gap` between them.
 * Equal-width by default; pass `weights` for proportional sizing.
 */
export function gridCols(ctx: LayoutContext, rect: ContentRect, n: number, opts: GridColsOptions = {}): ContentRect[] {
  const gap = opts.gap ?? ctx.cm(1.2);
  const totalGap = gap * Math.max(0, n - 1);
  const usable = rect.width - totalGap;
  const weights = opts.weights && opts.weights.length === n
    ? opts.weights
    : Array(n).fill(1);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const out: ContentRect[] = [];
  let cursorX = rect.x;
  for (let i = 0; i < n; i++) {
    const colW = Math.floor((usable * weights[i]!) / sum);
    out.push({ x: cursorX, y: rect.y, width: colW, height: rect.height });
    cursorX += colW + gap;
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
 * Bullet list inside a rectangle. Items can be plain strings or 2-level
 * nested objects: `{ text: string, sub?: BulletItem[] }`. Sub-items render
 * indented one level (PowerPoint's `<a:pPr lvl="1">`).
 *
 * Each item's `text` runs through `parseInline`, so bullets carry the same
 * inline markdown / chip / icon vocabulary as regular text. Sub-items
 * rendered slightly smaller and in `text-muted`.
 *
 * Object-shaped items that DON'T have a `text` field (e.g. KPI tile data
 * `{ value, label, delta? }`) are stringified — the caller is expected to
 * use a different primitive (`kpiTile`) for those cases.
 *
 * Returns one TextShape — the caller passes a card backing separately
 * if needed.
 */
export function bulletsBlock(ctx: LayoutContext, rect: ContentRect, items: readonly unknown[], opts: BulletsBlockOptions = {}): ShapeList {
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const monoFont = ctx.font("mono");
  const baseSize = opts.sizeHalfPt ?? 28;
  const baseColor = ctx.color(opts.color ?? "text-strong");
  const subColor = ctx.color("text-muted");
  const resolveChipColor = chipColorResolver(ctx);
  const resolveChipGlyph = chipGlyphResolver(ctx);
  const flat = flattenBullets(items);
  // Theme-supplied bullet glyph: when set, we disable PowerPoint's auto
  // bullets and prepend the glyph as its own run so it inherits theme
  // colour and stays visually consistent across viewers (PPT/Keynote/LO
  // each renderer the auto-bullet glyph slightly differently).
  const themeGlyphL0 = ctx.style.bullets?.glyph;
  const themeGlyphL1 = ctx.style.bullets?.level1 ?? themeGlyphL0;
  const themeGlyphL2 = ctx.style.bullets?.level2 ?? themeGlyphL1;
  const themeGlyphColor = ctx.style.bullets?.color
    ? ctx.color(ctx.style.bullets.color)
    : ctx.color("brand-primary");
  const useThemeGlyph = !!themeGlyphL0 && opts.bullets !== false;
  const glyphForLevel = (lvl: number): string =>
    lvl >= 2 ? (themeGlyphL2 ?? themeGlyphL0!) : lvl === 1 ? (themeGlyphL1 ?? themeGlyphL0!) : themeGlyphL0!;
  return [{
    type: "text",
    id: ctx.id(),
    xfrm: { x: rect.x, y: rect.y, cx: rect.width, cy: rect.height },
    valign: "top",
    // Many CJK bullets in narrow regions push past the cell — autoFit
    // shrinks rather than spilling. Bullet schemas already cap item count
    // and itemMaxChars; this is the safety net for long CJK items.
    autoFit: "shrink",
    paragraphs: flat.map((b) => {
      const sizeHalfPt = b.level === 0 ? baseSize : Math.max(20, baseSize - 4);
      const color = b.level === 0 ? baseColor : subColor;
      const inlineRuns = parseInline(b.text, {
        sizeHalfPt, color, fontFace, monoFont, cjk: ctx.cjk, resolveChipColor, resolveChipGlyph,
      });
      const runs: TextRun[] = useThemeGlyph
        ? [
            {
              text: `${glyphForLevel(b.level)}  `,
              sizeHalfPt,
              color: themeGlyphColor,
              fontFace,
              bold: true,
            },
            ...inlineRuns,
          ]
        : inlineRuns;
      return {
        align: "left",
        // When we draw our own glyph, suppress PowerPoint's auto bullets.
        bullet: opts.bullets === false || useThemeGlyph
          ? undefined
          : ({ auto: true } as const),
        indentLevel: b.level,
        lineSpacingHalfPt: opts.lineSpacingHalfPt ?? 56,
        spaceAfterHalfPt: opts.spaceAfterHalfPt ?? 16,
        runs,
      };
    }),
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

export interface ImageRefValue {
  src: string;
  alt?: string;
  /** Clip silhouette: square (default) | rounded | circle. */
  shape?: "square" | "rounded" | "circle";
  /** Corner radius for "rounded" clip (0..0.5 of the shorter side). */
  cornerRadius?: number;
  /** Optional border around the (clipped) image. */
  border?: { color: string; width?: number };
  /** Translucent colored overlay drawn on top of the image. */
  overlay?: { color: string; alpha?: number };
  /**
   * Fit mode against the target rectangle. Default `cover` — preserves
   * source aspect ratio, crops the overflow. `contain` letterboxes;
   * `fill` stretches (legacy behavior, may distort).
   */
  fit?: "cover" | "contain" | "fill";
  /** Inset crop fractions (0..1 each side) — passed straight to OOXML srcRect. */
  crop?: { left?: number; right?: number; top?: number; bottom?: number };
  /** Soft / feathered edge — fade-into-canvas. Fraction of shorter side. */
  softEdge?: number;
  /** Drop shadow under the image. blur/dx/dy in EMU. */
  shadow?: { color: string; alpha?: number; blur?: number; dx?: number; dy?: number };
  /** Convert image to grayscale. */
  grayscale?: boolean;
  /** Brightness shift in [-1, 1]. */
  brightness?: number;
  /** Gaussian blur on the image (EMU radius). */
  blur?: number;
  /** Two-tone recolour (dark → light hex). Magazine / editorial treatment. */
  duotone?: { dark: string; light: string };
}

/**
 * Render an image when present; otherwise paint a polite card placeholder.
 * Layouts that take an optional `image` slot should never branch — they
 * call this and trust the result.
 *
 * The image's optional `shape`/`border`/`overlay` modifiers are forwarded
 * to the OOXML emitter — clipping happens at the picture's `prstGeom`,
 * border via `<a:ln>`, overlay as a translucent shape on top.
 */
export function imageOrPlaceholder(
  ctx: LayoutContext,
  rect: ContentRect,
  image: ImageRefValue | undefined,
  opts: ImageOrPlaceholderOptions = {},
): ShapeList {
  if (image && image.src) {
    // Theme-coordinated image defaults: when the layout/payload doesn't
    // specify a clip, fall back to `style.image.defaultClip`. Same for
    // border + grayscale (treatment: "grayscale"). Lets a theme apply a
    // uniform image style without each layout reaching for it.
    const themeImage = ctx.style.image;
    const themeClip = themeImage.defaultClip === "circle" ? "circle"
                    : themeImage.defaultClip === "rounded" ? "rounded"
                    : "square";
    const clip = image.shape ?? themeClip;
    const themeBorder = themeImage.border;
    const wantThemeGrayscale = themeImage.treatment === "grayscale" && image.grayscale === undefined;
    return [{
      type: "image",
      id: ctx.id(),
      xfrm: { x: rect.x, y: rect.y, cx: rect.width, cy: rect.height },
      src: image.src,
      altText: image.alt,
      clip,
      fit: image.fit ?? "cover",
      ...(image.cornerRadius !== undefined ? { cornerRadius: image.cornerRadius } : {}),
      ...(image.border
        ? { border: { color: image.border.color, width: image.border.width ?? ctx.pt(1) } }
        : themeBorder
          ? { border: { color: ctx.color(themeBorder.color), width: ctx.pt(themeBorder.widthPt) } }
          : {}),
      ...(image.overlay ? { overlay: image.overlay } : {}),
      ...(image.crop ? { crop: image.crop } : {}),
      ...(image.softEdge !== undefined ? { softEdge: image.softEdge } : {}),
      ...(image.shadow ? { shadow: image.shadow } : {}),
      ...((image.grayscale || wantThemeGrayscale) ? { grayscale: true } : {}),
      ...(image.brightness !== undefined ? { brightness: image.brightness } : {}),
      ...(image.blur !== undefined ? { blur: image.blur } : {}),
      ...(image.duotone ? { duotone: image.duotone } : {}),
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
 * Normalize an image-ref slot value into the canonical shape. Accepts:
 *   - bare path/URL string (auto-wrapped to `{ src }`)
 *   - `{ src, alt?, shape?, border?, overlay?, cornerRadius? }` — canonical
 *   - `{ url, ... }` (alias for src — agents naturally use both keys)
 *
 * Returns undefined when the value can't be coerced — layouts use
 * `imageOrPlaceholder()` to render a polite fallback in that case.
 */
export function imageRefOf(value: unknown): ImageRefValue | undefined {
  if (typeof value === "string" && value.length > 0) return { src: value };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const o = value as Record<string, unknown>;
  // Inline SVG ergonomic form: `{ svg: "<svg ...>...</svg>" }` — wrap as
  // a data URL so the rest of the pipeline (asset resolver, OOXML emitter)
  // sees a normal SVG image source. Agents reach for this form when they
  // generate a chart/icon programmatically and want it on the slide
  // without writing it to disk.
  let src = typeof o.src === "string" ? o.src : (typeof o.url === "string" ? (o.url as string) : undefined);
  if (!src && typeof o.svg === "string") {
    src = svgToHighResDataUrl(o.svg.trim());
  }
  if (!src) return undefined;
  const out: ImageRefValue = { src };
  if (typeof o.alt === "string") out.alt = o.alt;
  if (o.fit === "cover" || o.fit === "contain" || o.fit === "fill") out.fit = o.fit;
  if (o.shape === "circle" || o.shape === "rounded" || o.shape === "square") out.shape = o.shape;
  if (typeof o.cornerRadius === "number") out.cornerRadius = o.cornerRadius;
  if (o.border && typeof o.border === "object" && !Array.isArray(o.border)) {
    const b = o.border as { color?: unknown; width?: unknown };
    if (typeof b.color === "string") {
      out.border = { color: b.color, ...(typeof b.width === "number" ? { width: b.width } : {}) };
    }
  }
  if (o.overlay && typeof o.overlay === "object" && !Array.isArray(o.overlay)) {
    const ov = o.overlay as { color?: unknown; alpha?: unknown };
    if (typeof ov.color === "string") {
      out.overlay = { color: ov.color, ...(typeof ov.alpha === "number" ? { alpha: ov.alpha } : {}) };
    }
  }
  if (o.crop && typeof o.crop === "object" && !Array.isArray(o.crop)) {
    const c = o.crop as { left?: unknown; right?: unknown; top?: unknown; bottom?: unknown };
    out.crop = {
      ...(typeof c.left   === "number" ? { left:   c.left }   : {}),
      ...(typeof c.right  === "number" ? { right:  c.right }  : {}),
      ...(typeof c.top    === "number" ? { top:    c.top }    : {}),
      ...(typeof c.bottom === "number" ? { bottom: c.bottom } : {}),
    };
  }
  if (typeof o.softEdge === "number") out.softEdge = o.softEdge;
  if (o.shadow && typeof o.shadow === "object" && !Array.isArray(o.shadow)) {
    const sh = o.shadow as { color?: unknown; alpha?: unknown; blur?: unknown; dx?: unknown; dy?: unknown };
    if (typeof sh.color === "string") {
      out.shadow = {
        color: sh.color,
        ...(typeof sh.alpha === "number" ? { alpha: sh.alpha } : {}),
        ...(typeof sh.blur  === "number" ? { blur:  sh.blur }  : {}),
        ...(typeof sh.dx    === "number" ? { dx:    sh.dx }    : {}),
        ...(typeof sh.dy    === "number" ? { dy:    sh.dy }    : {}),
      };
    }
  }
  if (o.grayscale === true) out.grayscale = true;
  if (typeof o.brightness === "number") out.brightness = o.brightness;
  if (typeof o.blur === "number") out.blur = o.blur;
  if (o.duotone && typeof o.duotone === "object" && !Array.isArray(o.duotone)) {
    const d = o.duotone as { dark?: unknown; light?: unknown };
    if (typeof d.dark === "string" && typeof d.light === "string") {
      out.duotone = { dark: d.dark, light: d.light };
    }
  }
  return out;
}

/**
 * Single source of truth for "where does the body start" — used by every
 * layout that has an optional title. When `title` is present, body starts
 * at `cm(4.4)` (title row + accent rule + breathing room). When absent,
 * body collapses up to `cm(2)` so the layout naturally supports title-less
 * variants without needing dedicated `*-no-title` layouts.
 *
 * Convention: every content layout with an optional title uses this helper
 * for its body geometry instead of hard-coding cm(4.4).
 */
export function bodyTopAfterTitle(ctx: LayoutContext, title: unknown): number {
  return typeof title === "string" && title.length > 0 ? ctx.cm(4.4) : ctx.cm(2);
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

// ---------------------------------------------------------------------------
// Inline-markdown helpers — chip colors, nested bullets, richText
// ---------------------------------------------------------------------------

/**
 * Map a chip kind to a hex color using the deck's theme. Themes can
 * override the defaults by declaring optional tokens
 * `semantic-up`/`-down`/`-flat`/`-ok`/`-warn`/`-bad`/`-highlight`; otherwise
 * we fall back to a sensible mapping that works on every built-in theme:
 *
 *   up / ok        → brand-primary
 *   down / bad     → custom token if set, else fixed terracotta C0432D
 *   flat           → text-muted
 *   warn           → custom token if set, else amber D08F00
 *   highlight      → accent
 *
 * The fallbacks are calibrated for AA contrast on every built-in canvas.
 */
/**
 * Theme-aware chip glyph lookup — pairs with `chipColorResolver`. Returns
 * the theme override (`style.chips.<kind>.glyph`) when set, else `undefined`
 * so the parser falls back to the default `CHIP_GLYPH` table. Wire into
 * `parseInline` via `resolveChipGlyph: chipGlyphResolver(ctx)`.
 */
export function chipGlyphResolver(ctx: LayoutContext): (kind: ChipKind) => string | undefined {
  return (kind) => ctx.style.chips[kind]?.glyph;
}

/**
 * Format a 1-based ordinal number per the theme's numbering style:
 *   "padded"  → "01" / "02"   (default — uniform width)
 *   "decimal" → "1." / "2."   (compact)
 *   "roman"   → "I." / "II."  (formal)
 *   "circled" → "①" / "②"     (icon-style; 1..50 supported)
 *
 * Layouts call this in agenda / outline / process-flow numbering so the
 * theme controls the look without per-layout branches.
 */
export function formatOrdinal(ctx: LayoutContext, n: number): string {
  const style = ctx.style.numbering.style;
  if (style === "padded") return n.toString().padStart(2, "0");
  if (style === "decimal") return `${n}.`;
  if (style === "roman") return `${toRoman(n)}.`;
  if (style === "circled") {
    if (n >= 1 && n <= 20) {
      return String.fromCodePoint(0x2460 + (n - 1)); // ①..⑳
    }
    if (n <= 35) return String.fromCodePoint(0x3251 + (n - 21)); // ㉑..㉟
    if (n <= 50) return String.fromCodePoint(0x32B1 + (n - 36)); // ㊱..㊿
    return n.toString();
  }
  return n.toString().padStart(2, "0");
}

function toRoman(n: number): string {
  const pairs: Array<[number, string]> = [
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  let v = n;
  for (const [val, sym] of pairs) {
    while (v >= val) { out += sym; v -= val; }
  }
  return out;
}

export function chipColorResolver(ctx: LayoutContext): (kind: ChipKind) => string {
  const tryToken = (name: string): string | undefined => {
    try {
      const v = ctx.token(name);
      return typeof v === "string" ? v : undefined;
    } catch {
      return undefined;
    }
  };
  // Resolution order:
  //   1. style.chips.<kind>.color   (theme override targeting this chip)
  //   2. style.semantic.<mapped>    (theme semantic palette)
  //   3. legacy semantic-<kind> hex token
  //   4. brand fallback
  // Centralizing here means SWOT, alerts, status badges, and inline chips
  // all draw from the same theme-coordinated palette.
  return (kind) => {
    const chipOverride = ctx.style.chips[kind]?.color;
    if (chipOverride) return chipOverride;

    const sem = ctx.style.semantic;
    switch (kind) {
      case "up":
      case "ok":        return sem.positive;
      case "down":
      case "bad":       return tryToken("semantic-bad") ?? sem.negative;
      case "warn":      return tryToken("semantic-warn") ?? sem.warning;
      case "flat":      return sem.neutral;
      case "highlight": return ctx.color("accent");
    }
  };
}

// ---------------------------------------------------------------------------
// Chart annotation overlay
// ---------------------------------------------------------------------------

export interface ChartAnnotationLike {
  at?: number;
  range?: [number, number];
  label: string;
  style?: "callout" | "marker" | "band";
}

/**
 * Draw a list of annotations on top of a chart frame. Position math is
 * approximate — we assume the chart's plot area runs from ~12% inset on
 * the left to ~98% on the right, and from ~10% on top to ~85% on bottom
 * (typical defaults for the OOXML axis layout we emit). Good enough to
 * land a callout near the right column; not pixel-perfect.
 *
 * Layouts call this AFTER pushing the ChartShape. The `frame` argument
 * is the chart's bounding rectangle (the same {x,y,width,height} the
 * chart's xfrm uses).
 */
export function chartAnnotationOverlay(
  ctx: LayoutContext,
  frame: ContentRect,
  labels: readonly unknown[],
  annotations: readonly ChartAnnotationLike[] | undefined,
): ShapeList {
  if (!annotations || annotations.length === 0) return [];
  const out: ShapeList = [];
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const monoFont = ctx.font("mono");
  const resolveChipColor = chipColorResolver(ctx);
  const PLOT_LEFT = 0.12;
  const PLOT_RIGHT = 0.98;
  const PLOT_TOP = 0.10;
  const colCount = Math.max(labels.length, 1);
  const colCenter = (i: number) => {
    const fraction = PLOT_LEFT + ((PLOT_RIGHT - PLOT_LEFT) * (i + 0.5)) / colCount;
    return frame.x + fraction * frame.width;
  };
  for (const ann of annotations) {
    const style = ann.style ?? "callout";
    if (style === "band" && Array.isArray(ann.range)) {
      const [start, end] = ann.range;
      const xStart = colCenter(start) - (frame.width / colCount) * 0.4;
      const xEnd = colCenter(end) + (frame.width / colCount) * 0.4;
      out.push({
        type: "shape",
        id: ctx.id(),
        preset: "rect",
        xfrm: {
          x: Math.round(xStart),
          y: Math.round(frame.y + frame.height * PLOT_TOP),
          cx: Math.round(xEnd - xStart),
          cy: Math.round(frame.height * (1 - PLOT_TOP - 0.18)),
        },
        fill: { type: "solid", color: ctx.color("brand-primary"), alpha: 0.10 },
        line: { color: ctx.color("brand-primary"), width: ctx.pt(0.5), dash: "dash" },
      });
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: {
          x: Math.round(xStart),
          y: Math.round(frame.y),
          cx: Math.round(xEnd - xStart),
          cy: Math.round(frame.height * PLOT_TOP),
        },
        valign: "middle",
        paragraphs: [{
          align: "center",
          runs: parseInline(ann.label, {
            sizeHalfPt: 18, color: ctx.color("brand-primary"),
            fontFace, monoFont, cjk: ctx.cjk, resolveChipColor,
          }).map((r) => ({ ...r, bold: r.bold ?? true })),
        }],
      });
      continue;
    }
    // callout / marker — anchor at `at` (default 0 if range was supplied without at).
    const idx = ann.at ?? (ann.range ? ann.range[1] : 0);
    const cx = colCenter(idx);
    if (style === "marker") {
      // Solid dot above the data point.
      const dotSize = ctx.cm(0.22);
      out.push({
        type: "shape",
        id: ctx.id(),
        preset: "ellipse",
        xfrm: {
          x: Math.round(cx - dotSize / 2),
          y: Math.round(frame.y + frame.height * PLOT_TOP - dotSize / 2),
          cx: dotSize,
          cy: dotSize,
        },
        fill: { type: "solid", color: ctx.color("brand-primary") },
      });
    }
    // Callout strip — small chip near the top of the chart, horizontally
    // centred on the column.
    const labelW = ctx.cm(5.0);
    const labelH = ctx.cm(0.7);
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "roundRect",
      xfrm: {
        x: Math.round(Math.max(frame.x, Math.min(frame.x + frame.width - labelW, cx - labelW / 2))),
        y: Math.round(frame.y + frame.height * PLOT_TOP - labelH - ctx.cm(0.1)),
        cx: labelW,
        cy: labelH,
      },
      fill: { type: "solid", color: ctx.color("brand-deep") },
      line: { color: ctx.color("brand-primary"), width: ctx.pt(0.5) },
      cornerRadius: 0.35,
    });
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: {
        x: Math.round(Math.max(frame.x, Math.min(frame.x + frame.width - labelW, cx - labelW / 2))),
        y: Math.round(frame.y + frame.height * PLOT_TOP - labelH - ctx.cm(0.1)),
        cx: labelW,
        cy: labelH,
      },
      valign: "middle",
      margin: { l: ctx.cm(0.15), r: ctx.cm(0.15), t: 0, b: 0 },
      paragraphs: [{
        align: "center",
        runs: parseInline(ann.label, {
          sizeHalfPt: 16, color: bestTextOn(ctx, ctx.color("brand-deep")),
          fontFace, monoFont, cjk: ctx.cjk, resolveChipColor,
        }).map((r) => ({ ...r, bold: r.bold ?? true })),
      }],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Table cells — emphasis + inline-markdown runs
// ---------------------------------------------------------------------------

/**
 * Map a table cell value to a `TableCell` honouring the optional
 * `emphasis` discriminator. Cells can be:
 *   - a string or number (rendered with body-text styling)
 *   - `{ value, emphasis: "ok"|"warn"|"bad"|"highlight"|"up"|"down"|"flat" }`
 *
 * Emphasis tints the run via `chipColorResolver` and bolds it. Cell text
 * runs through `parseInline`, so cells get the same inline-markdown
 * vocabulary as everything else (chips and icons inside table cells).
 */
export interface TableCellOptions {
  sizeHalfPt?: number;
  baseColor?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  fill?: { color: string };
  /** Force bold on every cell (used for the header row). */
  bold?: boolean;
}

/**
 * Pick a cell alignment given an explicit per-column override + a fallback.
 * Heuristic when neither is supplied: numeric-looking strings (matches
 * /^[\s\-+]*\$?[\d,.%]+\s*\w*$/) right-align; everything else left-aligns.
 * Lets `data-table` produce decent defaults without authors hand-aligning
 * every column.
 */
export function inferTableAlign(
  cell: unknown,
  override: "left" | "center" | "right" | undefined,
): "left" | "center" | "right" {
  if (override) return override;
  const text = typeof cell === "object" && cell !== null && "value" in (cell as { value?: unknown })
    ? String((cell as { value?: unknown }).value ?? "")
    : String(cell ?? "");
  if (text === "" || text === "—" || text === "-") return "left";
  return /^[\s\-+]*\$?[\d,.%]+\s*\w{0,4}$/.test(text) ? "right" : "left";
}

export function tableCellOf(ctx: LayoutContext, cell: unknown, opts: TableCellOptions = {}): TableCell {
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const monoFont = ctx.font("mono");
  const sizeHalfPt = opts.sizeHalfPt ?? 22;
  const baseColor = opts.baseColor ?? ctx.color("text-strong");
  const resolveChipColor = chipColorResolver(ctx);
  let text = "";
  let color = baseColor;
  let bold = !!opts.bold;
  if (cell == null) {
    text = "";
  } else if (typeof cell === "string") {
    text = cell;
  } else if (typeof cell === "number") {
    text = String(cell);
  } else if (typeof cell === "object" && !Array.isArray(cell)) {
    const c = cell as { value?: unknown; emphasis?: unknown };
    text = c.value === undefined || c.value === null ? "" : String(c.value);
    if (typeof c.emphasis === "string" && (CHIP_KINDS as readonly string[]).includes(c.emphasis)) {
      color = resolveChipColor(c.emphasis as ChipKind);
      bold = true;
    }
  } else {
    text = String(cell);
  }
  const runs = parseInline(text, {
    sizeHalfPt,
    color,
    fontFace,
    monoFont,
    cjk: ctx.cjk,
    resolveChipColor,
  }).map((r) => ({ ...r, bold: bold ? true : r.bold }));
  return {
    runs: runs.length > 0 ? runs : [{ text: "", sizeHalfPt, color, fontFace, cjk: ctx.cjk }],
    align: opts.align ?? "left",
    valign: opts.valign ?? "middle",
    fill: opts.fill ? { type: "solid", color: opts.fill.color } : undefined,
  };
}

/** Flat representation of a possibly-nested bullet item. */
interface FlatBullet { text: string; level: number }

/**
 * Flatten nested bullets into `{ text, level }` rows. Accepts:
 *   - plain string items
 *   - `{ text: string, sub?: BulletItem[] }` (one level of nesting)
 *   - any object without `text` is stringified (kept for legacy callers)
 *
 * Nesting deeper than 2 levels is collapsed to level 1 — keeps the visual
 * grammar bounded and the validator's depth check matches.
 */
function flattenBullets(items: readonly unknown[], level = 0, out: FlatBullet[] = []): FlatBullet[] {
  for (const item of items) {
    if (typeof item === "string") {
      out.push({ text: item, level: Math.min(level, 1) });
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const o = item as { text?: unknown; sub?: unknown };
      if (typeof o.text === "string") {
        out.push({ text: o.text, level: Math.min(level, 1) });
        if (Array.isArray(o.sub)) flattenBullets(o.sub, level + 1, out);
        continue;
      }
    }
    out.push({ text: String(item), level: Math.min(level, 1) });
  }
  return out;
}

export interface RichTextOptions {
  sizeHalfPt?: number;
  color?: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  italic?: boolean;
  lineSpacingHalfPt?: number;
  spaceAfterHalfPt?: number;
  valign?: "top" | "middle" | "bottom";
  /** Optional fill behind the text shape. */
  fill?: { color: string; alpha?: number };
  /** Internal padding inside the text box, in EMU. */
  margin?: { l?: number; t?: number; r?: number; b?: number };
  /**
   * Flow paragraphs into N equal-width columns inside `rect`. Default 1.
   * Useful for long body text that would otherwise read like a wall in
   * a single column.
   */
  columns?: number;
  /** Inter-column gap when `columns > 1`. Default cm(0.6). */
  columnGap?: number;
  /**
   * Named density preset that overrides `sizeHalfPt` / `lineSpacingHalfPt` /
   * `spaceAfterHalfPt` (loose | normal | dense | micro). Layouts pass the
   * agent-supplied `density` slot value here. Falls back to "normal".
   */
  density?: Density | string;
  /**
   * Forwarded to TextShape.autoFit. Use "shrink" on body slots whose char
   * cap is soft and whose content may still spill in edge cases (CJK with
   * many short paragraphs, long single sentences). Avoid on titles, KPI
   * numbers, or anything where shrinking would look broken.
   */
  autoFit?: "shrink" | "resize";
}

/**
 * One element in a `text-block` slot. Either a plain paragraph string
 * (existing behaviour) OR a typed paragraph that picks distinctive
 * styling at render time:
 *
 *   { kind: "quote",    text }   — italic, indented, accent rule on left
 *   { kind: "note",     text }   — small, muted, italic
 *   { kind: "callout",  text }   — bold, brand-coloured panel
 *   { kind: "h2",       text }   — sub-heading inside the body
 *
 * Mixing strings and typed paragraphs in the same array is allowed; the
 * renderer walks them in order.
 */
export type RichParagraph =
  | string
  | { kind: "quote";   text: string }
  | { kind: "note";    text: string }
  | { kind: "callout"; text: string }
  | { kind: "h2";      text: string }
  // Markdown bullet line — emitted by paragraphsFromValue when it
  // detects `- ` / `* ` / `+ ` at the start of a line. Renderer adds
  // the theme bullet glyph and indents.
  | { kind: "bullet";  text: string };

/**
 * Strip leading whitespace from each line of a paragraph and collapse
 * empty leading/trailing lines. Defends against YAML over-indent leakage:
 *
 *   text: |
 *           para line 1                    ← YAML strips the BASE indent
 *             para line 2 (extra 2 spaces) ← but extra indent SURVIVES,
 *           para line 3                       leaving leading spaces here
 *
 * Without this normalize step, those leading spaces flow into the markdown
 * renderer where they're either rendered literally (visible left padding)
 * or interpreted as preformatted-block indicators (4+ spaces ⇒ code block
 * in CommonMark). They also break dash-bulleted continuation lines —
 * `  - item` reads as a sub-item of an enclosing list, not a top-level
 * bullet.
 *
 * What we DON'T touch: the `\n` between lines is preserved (so explicit
 * line breaks the agent intends — e.g. inline `· bullet` enumerations —
 * still render as line breaks). Only horizontal indent is normalized.
 */
function normalizeParagraph(p: string): string {
  return p
    .split("\n")
    .map((l) => l.replace(/^[ \t]+/, "")) // strip leading spaces/tabs per line
    .join("\n")
    .trim();                              // strip outer blank lines / trailing space
}

// Recognise both ASCII markdown bullets (- * +) AND Unicode bullets the
// agent commonly emits when "writing nicely formatted text" rather than
// markdown — `•` U+2022, `·` U+00B7 middle dot, `‣` U+2023, `▪` U+25AA.
// Without these the lines stay embedded in one paragraph and the cell
// over-shrinks via autoFit (raw line breaks consume height without the
// renderer being able to paragraph-shrink them gracefully).
const BULLET_LINE_RE = /^[-*+\u2022\u00B7\u2023\u25AA]\s+(.*)$/;

/**
 * Walk a normalized paragraph line-by-line. Lines starting with
 * `- ` / `* ` / `+ ` (markdown bullet syntax) get extracted as their
 * own `kind: "bullet"` entries; non-bullet lines accumulate into
 * regular paragraphs flanking the bullet block.
 *
 * Example input (one paragraph, blank-line-separated upstream):
 *   宋代的文化成就同样辉煌：
 *   - **理学**完成儒学的哲学化重建
 *   - **文人画**达到高峰
 *   - **活字印刷术**发明
 *
 * Output:
 *   "宋代的文化成就同样辉煌：",
 *   { kind: "bullet", text: "**理学**完成儒学的哲学化重建" },
 *   { kind: "bullet", text: "**文人画**达到高峰" },
 *   { kind: "bullet", text: "**活字印刷术**发明" },
 */
function expandBulletLines(p: string): RichParagraph[] {
  const lines = p.split("\n");
  if (!lines.some((l) => BULLET_LINE_RE.test(l))) return [p];
  const out: RichParagraph[] = [];
  let buffer: string[] = [];
  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const joined = buffer.join("\n").trim();
    if (joined) out.push(joined);
    buffer = [];
  };
  for (const line of lines) {
    const m = BULLET_LINE_RE.exec(line);
    if (m) {
      flushBuffer();
      out.push({ kind: "bullet", text: m[1]!.trim() });
    } else {
      buffer.push(line);
    }
  }
  flushBuffer();
  return out;
}

function paragraphsFromValue(value: unknown): RichParagraph[] {
  if (typeof value === "string") {
    return value
      .split(/\n\s*\n/)
      .map(normalizeParagraph)
      .filter(Boolean)
      .flatMap(expandBulletLines);
  }
  if (Array.isArray(value)) {
    const out: RichParagraph[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        for (const p of item.split(/\n\s*\n/).map(normalizeParagraph).filter(Boolean)) {
          for (const sub of expandBulletLines(p)) out.push(sub);
        }
      } else if (item && typeof item === "object" && !Array.isArray(item)) {
        const o = item as { kind?: unknown; text?: unknown };
        if (typeof o.text === "string" && (o.kind === "quote" || o.kind === "note" || o.kind === "callout" || o.kind === "h2")) {
          out.push({ kind: o.kind, text: normalizeParagraph(o.text) });
        } else if (typeof o.text === "string") {
          for (const sub of expandBulletLines(normalizeParagraph(o.text))) out.push(sub);
        }
      }
    }
    return out;
  }
  return [];
}

/**
 * Render a text or text-block slot value as one or more TextShapes with
 * inline markdown / chips / icons resolved. Accepts:
 *   - a string (split on blank lines into paragraphs)
 *   - a `RichParagraph[]` (mix of strings and typed paragraphs)
 *   - `string[]` (legacy — same as a string joined with blank lines)
 *
 * When `columns > 1`, paragraphs are flowed evenly across columns by
 * count (not by visual height — PowerPoint doesn't let us measure
 * content). Typed paragraphs (quote/note/callout/h2) get distinctive
 * styling per kind.
 */
export function richText(
  ctx: LayoutContext,
  rect: ContentRect,
  value: unknown,
  opts: RichTextOptions = {},
): ShapeList {
  const paras = paragraphsFromValue(value);
  if (paras.length === 0) return [];
  const cols = Math.max(1, Math.round(opts.columns ?? 1));
  if (cols === 1) {
    return [renderRichTextShape(ctx, rect, paras, opts)];
  }
  const gap = opts.columnGap ?? ctx.cm(0.6);
  const colW = Math.floor((rect.width - gap * (cols - 1)) / cols);
  const out: ShapeList = [];
  // Distribute by paragraph count — `Math.ceil(paras/cols)` per column.
  const perCol = Math.ceil(paras.length / cols);
  for (let c = 0; c < cols; c++) {
    const slice = paras.slice(c * perCol, (c + 1) * perCol);
    if (slice.length === 0) continue;
    out.push(renderRichTextShape(ctx, {
      x: rect.x + c * (colW + gap),
      y: rect.y,
      width: colW,
      height: rect.height,
    }, slice, opts));
  }
  return out;
}

function renderRichTextShape(
  ctx: LayoutContext,
  rect: ContentRect,
  paras: RichParagraph[],
  opts: RichTextOptions,
): import("../emitter/types.js").TextShape {
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const monoFont = ctx.font("mono");
  // Density preset is the visual contract for body text. Layout passes
  // either the agent-supplied `density` slot value or undefined; the
  // preset table provides a sensible default (`normal`) so fonts stay
  // consistent across calls. Explicit `sizeHalfPt` / `lineSpacingHalfPt`
  // overrides only when a layout intentionally hard-codes them (small
  // captions, code blocks, etc.).
  const dp = densityPreset(opts.density);
  const baseSize = opts.sizeHalfPt ?? dp.sizeHalfPt;
  const lineSpacing = opts.lineSpacingHalfPt ?? dp.lineSpacingHalfPt;
  const spaceAfter = opts.spaceAfterHalfPt ?? dp.spaceAfterHalfPt;
  const baseColor = ctx.color(opts.color ?? "text-strong");
  const resolveChipColor = chipColorResolver(ctx);
  // Theme bullet glyph for `kind: "bullet"` paragraphs (markdown-extracted
  // `- `/`* `/`+ ` lines). Use the theme's configured glyph + colour, the
  // same convention `bulletsBlock()` uses, so dash-bulleted prose matches
  // first-class bullets visually.
  const bulletGlyph = ctx.style.bullets?.glyph ?? "•";
  const bulletColor = ctx.style.bullets?.color
    ? ctx.color(ctx.style.bullets.color)
    : ctx.color("brand-primary");
  const paragraphs: Paragraph[] = paras.map((p) => {
    const isString = typeof p === "string";
    const text = isString ? p : p.text;
    const kind = isString ? undefined : p.kind;
    let sizeHalfPt = baseSize;
    let color = baseColor;
    let italic = !!opts.italic;
    let bold = !!opts.bold;
    let align: Paragraph["align"] = opts.align ?? "left";
    let indentLevel: number | undefined = undefined;
    let prependBullet = false;
    if (kind === "quote") {
      italic = true;
      indentLevel = 1;
      color = ctx.color("text-strong");
    } else if (kind === "note") {
      sizeHalfPt = Math.max(18, baseSize - 6);
      color = ctx.color("text-muted");
      italic = true;
    } else if (kind === "callout") {
      bold = true;
      color = ctx.color("brand-primary");
    } else if (kind === "h2") {
      sizeHalfPt = Math.max(baseSize + 6, 32);
      bold = true;
      color = ctx.color("text-strong");
    } else if (kind === "bullet") {
      prependBullet = true;
      indentLevel = 0;
    }
    const inlineRuns = parseInline(text, {
      sizeHalfPt, color, fontFace, monoFont, cjk: ctx.cjk, resolveChipColor,
    }).map((r) => ({
      ...r,
      bold: bold ? true : r.bold,
      italic: italic ? true : r.italic,
    }));
    const runs = prependBullet
      ? [
          { text: `${bulletGlyph}  `, sizeHalfPt, color: bulletColor, fontFace, bold: true },
          ...inlineRuns,
        ]
      : inlineRuns;
    return {
      align,
      lineSpacingHalfPt: lineSpacing,
      spaceAfterHalfPt: spaceAfter,
      indentLevel,
      runs,
    };
  });
  return {
    type: "text",
    id: ctx.id(),
    xfrm: { x: rect.x, y: rect.y, cx: rect.width, cy: rect.height },
    valign: opts.valign ?? "top",
    paragraphs,
    fill: opts.fill ? { type: "solid", color: opts.fill.color, alpha: opts.fill.alpha } : undefined,
    margin: opts.margin,
    autoFit: opts.autoFit,
  };
}
