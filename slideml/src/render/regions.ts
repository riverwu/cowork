/**
 * Region renderer — shared cell-level rendering for compositional layouts
 * (`dashboard`, `split-2`, `split-3-vertical`, `split-3-horizontal`).
 *
 * A "region" is a polymorphic cell value carried by the `region` slot
 * type. The eight kinds cover ~95% of what fits in a half-slide cell:
 *   kpi      — single big number with label/delta/trend
 *   chart    — typed chart-spec
 *   table    — typed table-spec
 *   text     — title + body paragraph(s)
 *   bullets  — title + bulleted list
 *   image    — image with optional caption
 *   code     — title + code block (mono font)
 *   quote    — quotation with attribution
 *
 * Each kind renders inside an arbitrary bounding rectangle, so the same
 * region helpers serve dashboard's 2x2 cells, split (cells: 2)'s halves, and
 * split-3-{horizontal,vertical}'s thirds.
 *
 * Out of scope by design: nested split layouts. A region cannot contain
 * another region — keeps visual grammar bounded and renderer predictable.
 */

import type { LayoutContext } from "./layout-context.js";
import type { ChartShape, ShapeList, TableCell } from "../emitter/types.js";
import {
  bulletsBlock,
  card,
  chartAnnotationOverlay,
  chipColorResolver,
  imageOrPlaceholder,
  imageRefOf,
  inferTableAlign,
  kpiTile,
  richText,
  tableCellOf,
} from "./primitives.js";
import { parseInline } from "./markdown-inline.js";
import { svgToHighResDataUrl } from "./visual.js";

// ---------------------------------------------------------------------------
// Region union
// ---------------------------------------------------------------------------

export interface RegionRect { x: number; y: number; width: number; height: number }

/**
 * Visual style applied to every region cell. `filled` (default) is the
 * existing card backing with accent stripe. `ghost` removes the backing
 * entirely, `outlined` is a hairline rect with no fill, `elevated` adds
 * a drop shadow, `glass` is a semi-transparent fill (good over hero
 * backgrounds).
 */
export type RegionStyle = "filled" | "ghost" | "outlined" | "elevated" | "glass";
export interface RegionStyleable { style?: RegionStyle }

export interface RegionKpi extends RegionStyleable    { kind: "kpi"; value: string; label: string; delta?: string; trend?: "up" | "down" | "flat" }
export interface RegionChart extends RegionStyleable  {
  kind: "chart";
  chart: {
    type: ChartShape["chartType"];
    data: {
      labels: string[];
      series: Array<{
        name: string;
        values?: number[];
        type?: "bar" | "line";
        points?: Array<{ x: number; y: number }>;
      }>;
    };
    format?: { y?: ChartShape["yFormat"] };
    annotations?: Array<{ at?: number; range?: [number, number]; label: string; style?: "callout" | "marker" | "band" }>;
  };
  title?: string;
}
export interface RegionTable extends RegionStyleable  { kind: "table"; table: { header: string[]; rows: unknown[][]; colWidths?: number[]; align?: Array<"left" | "center" | "right"> }; title?: string }
export interface RegionText extends RegionStyleable   { kind: "text"; body: string | string[]; title?: string }
export interface RegionBullets extends RegionStyleable { kind: "bullets"; items: string[]; title?: string }
export interface RegionImage extends RegionStyleable  { kind: "image"; image: unknown; caption?: string }
export interface RegionCode extends RegionStyleable   { kind: "code"; code: string; language?: string; title? : string }
export interface RegionQuote extends RegionStyleable  { kind: "quote"; text: string; attribution?: string }
export interface RegionSparkline extends RegionStyleable {
  kind: "sparkline";
  values: number[];
  color?: string;          // token name or hex
  area?: boolean;          // fill below the line
  baseline?: number;       // explicit baseline; default = min(values)
  title?: string;
  caption?: string;
}
export interface RegionProgress extends RegionStyleable {
  kind: "progress";
  value: number;           // 0..1
  label?: string;
  color?: string;          // token name or hex (defaults to brand-primary)
  trackColor?: string;     // defaults to divider
  showPercent?: boolean;   // defaults true
}

export type Region =
  | RegionKpi
  | RegionChart
  | RegionTable
  | RegionText
  | RegionBullets
  | RegionImage
  | RegionCode
  | RegionQuote
  | RegionSparkline
  | RegionProgress;

/** Discriminator values agents see in `describe_content_component` examples. */
export const REGION_KINDS = ["kpi", "chart", "table", "text", "bullets", "image", "code", "quote", "sparkline", "progress"] as const;

// ---------------------------------------------------------------------------
// Top-level dispatch
// ---------------------------------------------------------------------------

/**
 * Per-call options threaded into each cell renderer. Composite layouts
 * (split, dashboard, matrix-2x2) use these to enforce
 * cross-cell visual alignment — most importantly `topInset`, which
 * forces every cell's body to start at the same y so cells without
 * `title` line up with cells that have one.
 */
export interface RegionRenderOptions {
  /**
   * Extra space (EMU) reserved at the top of the cell, regardless of
   * whether the cell has its own `title`. When one sibling cell has a
   * title, composite layouts pass this so the title-less cell's body
   * doesn't fill upward into the title row, breaking baseline alignment.
   */
  topInset?: number;
}

/**
 * Compute the topInset a composite layout should pass to all its region
 * cells: the max title-row height across cells with a `title` field.
 * Returns 0 when no cell has a title.
 */
export function computeRegionTopInset(ctx: LayoutContext, regions: ReadonlyArray<Region | undefined>): number {
  const hasAnyTitle = regions.some((r) => r && typeof (r as { title?: unknown }).title === "string" && ((r as { title: string }).title.length > 0));
  return hasAnyTitle ? ctx.cm(0.9) : 0;
}

export function renderRegion(
  ctx: LayoutContext,
  rect: RegionRect,
  region: Region,
  opts: RegionRenderOptions = {},
): ShapeList {
  switch (region.kind) {
    case "kpi":       return renderKpiCell(ctx, rect, region, opts);
    case "chart":     return renderChartCell(ctx, rect, region, opts);
    case "table":     return renderTableCell(ctx, rect, region, opts);
    case "text":      return renderTextCell(ctx, rect, region, opts);
    case "bullets":   return renderBulletsCell(ctx, rect, region, opts);
    case "image":     return renderImageCell(ctx, rect, region, opts);
    case "code":      return renderCodeCell(ctx, rect, region, opts);
    case "quote":     return renderQuoteCell(ctx, rect, region, opts);
    case "sparkline": return renderSparklineCell(ctx, rect, region, opts);
    case "progress":  return renderProgressCell(ctx, rect, region, opts);
  }
}

// ---------------------------------------------------------------------------
// Per-kind cell renderers
// ---------------------------------------------------------------------------

/**
 * Build the cell backing for a region according to its `style` field.
 * - filled (default): existing card with accent stripe
 * - ghost: nothing (transparent)
 * - outlined: hairline rect, no fill
 * - elevated: solid card with a soft drop shadow
 * - glass: semi-transparent fill, suited for slides with hero backgrounds
 */
function regionBacking(
  ctx: LayoutContext,
  rect: RegionRect,
  style: RegionStyle | undefined,
  opts: { accentStripe?: string } = {},
): ShapeList {
  const s = style ?? "filled";
  if (s === "ghost") return [];
  if (s === "outlined") {
    return [{
      type: "shape",
      id: ctx.id(),
      preset: "roundRect",
      xfrm: { x: rect.x, y: rect.y, cx: rect.width, cy: rect.height },
      fill: { type: "none" },
      line: { color: ctx.color("divider"), width: ctx.pt(0.75) },
      cornerRadius: 0.03,
    }];
  }
  if (s === "elevated") {
    // Soft shadow approximation via a slightly-offset duplicate rect.
    const out: ShapeList = [];
    const shadowOffset = ctx.cm(0.18);
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "roundRect",
      xfrm: { x: rect.x + shadowOffset, y: rect.y + shadowOffset, cx: rect.width, cy: rect.height },
      fill: { type: "solid", color: "000000", alpha: 0.12 },
      line: { color: "000000", width: 0 },
      cornerRadius: 0.03,
    });
    out.push(...card(ctx, rect, { accentStripe: opts.accentStripe }));
    return out;
  }
  if (s === "glass") {
    const out: ShapeList = [];
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "roundRect",
      xfrm: { x: rect.x, y: rect.y, cx: rect.width, cy: rect.height },
      fill: { type: "solid", color: ctx.color("bg-card"), alpha: 0.55 },
      line: { color: "FFFFFF", width: ctx.pt(0.5) },
      cornerRadius: 0.03,
    });
    return out;
  }
  return card(ctx, rect, { accentStripe: opts.accentStripe });
}

function cellTitle(ctx: LayoutContext, rect: RegionRect, title: string, sizeHalfPt = 24): { shape: ShapeList[number]; height: number } {
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const inset = ctx.cm(0.6);
  const h = ctx.cm(0.9);
  return {
    shape: {
      type: "text",
      id: ctx.id(),
      xfrm: { x: rect.x + inset, y: rect.y + ctx.cm(0.45), cx: rect.width - inset * 2, cy: h },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{ text: title, sizeHalfPt, color: ctx.color("text-strong"), bold: true, cjk: ctx.cjk, fontFace }],
      }],
    },
    height: h,
  };
}

function renderKpiCell(ctx: LayoutContext, rect: RegionRect, region: RegionKpi, _opts: RegionRenderOptions = {}): ShapeList {
  // For non-default styles we emit our own backing then ask kpiTile to
  // skip its own card. For "filled" we let kpiTile draw its standard
  // tile (which already has the accent stripe).
  if (!region.style || region.style === "filled") {
    return kpiTile(ctx, rect, region);
  }
  const out: ShapeList = regionBacking(ctx, rect, region.style, { accentStripe: "brand-primary" });
  out.push(...kpiTile(ctx, rect, region, { card: false }));
  return out;
}

function renderChartCell(ctx: LayoutContext, rect: RegionRect, region: RegionChart, opts: RegionRenderOptions = {}): ShapeList {
  const out: ShapeList = regionBacking(ctx, rect, region.style, { accentStripe: "brand-primary" });
  const inset = ctx.cm(0.6);
  // Body always starts at rect.y + cm(0.45) + max(titleH, opts.topInset).
  // The max ensures cells without their own title still leave the same
  // space at top as cells that have one — keeps baselines aligned.
  const titleH = region.title ? ctx.cm(0.9) : 0;
  const reserved = Math.max(titleH, opts.topInset ?? 0);
  if (region.title) out.push(cellTitle(ctx, rect, region.title).shape);
  const chartFrame = {
    x: rect.x + inset,
    y: rect.y + ctx.cm(0.45) + reserved,
    width: rect.width - inset * 2,
    height: rect.height - ctx.cm(0.9) - reserved,
  };
  const chartShape: ChartShape = {
    type: "chart",
    id: ctx.id(),
    xfrm: { x: chartFrame.x, y: chartFrame.y, cx: chartFrame.width, cy: chartFrame.height },
    chartType: region.chart.type,
    labels: region.chart.data.labels,
    series: region.chart.data.series.map((s) => ({
      name: s.name,
      values: s.values ?? [],
      ...(s.type ? { type: s.type } : {}),
      ...(s.points ? { points: s.points } : {}),
    })),
    yFormat: region.chart.format?.y ?? "int",
    colors: [ctx.color("brand-primary"), ctx.color("accent"), ctx.color("text-muted")],
    showValues: region.chart.type !== "pie" && region.chart.type !== "doughnut" && region.chart.type !== "scatter",
    annotations: region.chart.annotations,
  };
  out.push(chartShape);
  out.push(...chartAnnotationOverlay(ctx, chartFrame, region.chart.data.labels, region.chart.annotations));
  return out;
}

function renderTableCell(ctx: LayoutContext, rect: RegionRect, region: RegionTable, opts: RegionRenderOptions = {}): ShapeList {
  const out: ShapeList = regionBacking(ctx, rect, region.style, { accentStripe: "brand-primary" });
  const inset = ctx.cm(0.5);
  const titleH = region.title ? ctx.cm(0.9) : 0;
  const reserved = Math.max(titleH, opts.topInset ?? 0);
  if (region.title) out.push(cellTitle(ctx, rect, region.title, 22).shape);
  const tableX = rect.x + inset;
  const tableY = rect.y + ctx.cm(0.4) + reserved;
  const tableW = rect.width - inset * 2;
  const tableH = rect.height - (reserved + ctx.cm(0.8));
  const cols = region.table.header.length;
  const weights = region.table.colWidths && region.table.colWidths.length === cols ? region.table.colWidths : Array(cols).fill(1);
  const sum = weights.reduce((a, b) => a + b, 0);
  const colWidths = weights.map((w) => Math.floor((tableW * w) / sum));
  const rowCount = 1 + region.table.rows.length;
  const headerH = ctx.cm(0.7);
  const bodyRowH = Math.floor((tableH - headerH) / Math.max(1, rowCount - 1));
  const colAlign = region.table.align ?? [];
  const cells: TableCell[][] = [
    region.table.header.map((h, ci) => tableCellOf(ctx, h, {
      sizeHalfPt: 20,
      baseColor: "FFFFFF",
      bold: true,
      align: colAlign[ci] ?? "left",
      fill: { color: ctx.color("brand-deep") },
    })),
    ...region.table.rows.map((r, ri) => r.map((c, ci) => tableCellOf(ctx, c, {
      sizeHalfPt: 18,
      align: inferTableAlign(c, colAlign[ci]),
      fill: ri % 2 === 1 ? { color: ctx.color("bg-card") } : undefined,
    }))),
  ];
  out.push({
    type: "table",
    id: ctx.id(),
    xfrm: { x: tableX, y: tableY, cx: tableW, cy: tableH },
    colWidths,
    rowHeights: [headerH, ...Array(region.table.rows.length).fill(bodyRowH)],
    cells,
    firstRowHeader: true,
    borderColor: ctx.color("divider"),
    borderWidth: ctx.pt(0.5),
  });
  return out;
}

function renderTextCell(ctx: LayoutContext, rect: RegionRect, region: RegionText, opts: RegionRenderOptions = {}): ShapeList {
  const out: ShapeList = regionBacking(ctx, rect, region.style, { accentStripe: "brand-primary" });
  const inset = ctx.cm(0.6);
  const titleH = region.title ? ctx.cm(0.9) : 0;
  const reserved = Math.max(titleH, opts.topInset ?? 0);
  if (region.title) out.push(cellTitle(ctx, rect, region.title).shape);
  // Cell text typography: tighter than richText defaults because cells
  // are small. Earlier (sizeHalfPt 20 + lineSpacing 48 + spaceAfter 12),
  // a 4-line CJK body in a ~2cm region pushed natural height to 3.4cm,
  // triggering autoFit at 60% scale → text rendered at 6pt. Trim line
  // spacing to 36 (≈18pt line) and drop spaceAfter to 4 so the body
  // fits naturally without aggressive shrink. Also bump bottom padding
  // back from 0.9 → 0.45 to match the top inset (was wasting 0.45cm).
  out.push(...richText(ctx, {
    x: rect.x + inset,
    y: rect.y + ctx.cm(0.45) + reserved,
    width: rect.width - inset * 2,
    height: rect.height - ctx.cm(0.45) - reserved,
  }, region.body, { sizeHalfPt: 22, lineSpacingHalfPt: 36, spaceAfterHalfPt: 4, autoFit: "shrink" }));
  return out;
}

function renderBulletsCell(ctx: LayoutContext, rect: RegionRect, region: RegionBullets, opts: RegionRenderOptions = {}): ShapeList {
  const out: ShapeList = regionBacking(ctx, rect, region.style, { accentStripe: "brand-primary" });
  const inset = ctx.cm(0.6);
  const titleH = region.title ? ctx.cm(0.9) : 0;
  const reserved = Math.max(titleH, opts.topInset ?? 0);
  if (region.title) out.push(cellTitle(ctx, rect, region.title).shape);
  // Quadrant cells (matrix-2x2 / dashboard) typically carry 2-4 short
  // bullets in a small rect. The previous bottom-padding reservation
  // (0.9cm) plus default lineSpacing (56hp = 28pt) made the bullets'
  // natural height exceed the available rect for any cell with 3+
  // items, triggering aggressive autoFit shrink (text rendered at 30%
  // and unreadable). Trim bottom padding to match the top inset and
  // use tighter line-spacing — 16pt line + 4pt after for short items.
  out.push(...bulletsBlock(ctx, {
    x: rect.x + inset,
    y: rect.y + ctx.cm(0.45) + reserved,
    width: rect.width - inset * 2,
    height: rect.height - ctx.cm(0.45) - reserved,
  }, region.items, { sizeHalfPt: 24, lineSpacingHalfPt: 32, spaceAfterHalfPt: 8 }));
  return out;
}

function renderImageCell(ctx: LayoutContext, rect: RegionRect, region: RegionImage, opts: RegionRenderOptions = {}): ShapeList {
  const out: ShapeList = regionBacking(ctx, rect, region.style, { accentStripe: "brand-primary" });
  const ref = imageRefOf(region.image);
  const inset = ctx.cm(0.4);
  const captionH = region.caption ? ctx.cm(0.9) : 0;
  const topReserve = opts.topInset ?? 0;
  out.push(...imageOrPlaceholder(ctx, {
    x: rect.x + inset,
    y: rect.y + inset + topReserve,
    width: rect.width - inset * 2,
    height: rect.height - inset * 2 - captionH - topReserve,
  }, ref));
  if (region.caption) {
    const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: rect.x + inset, y: rect.y + rect.height - captionH - ctx.cm(0.1), cx: rect.width - inset * 2, cy: captionH },
      valign: "middle",
      paragraphs: [{
        align: "center",
        runs: [{ text: region.caption, sizeHalfPt: 20, color: ctx.color("text-muted"), italic: true, cjk: ctx.cjk, fontFace }],
      }],
    });
  }
  return out;
}

function renderCodeCell(ctx: LayoutContext, rect: RegionRect, region: RegionCode, _opts: RegionRenderOptions = {}): ShapeList {
  // Dark code card; ignores theme bg-card so code stays readable.
  const out: ShapeList = [];
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "roundRect",
    xfrm: { x: rect.x, y: rect.y, cx: rect.width, cy: rect.height },
    fill: { type: "solid", color: "0A1622" },
    line: { color: ctx.color("divider"), width: ctx.pt(0.5) },
    cornerRadius: 0.02,
  });
  const inset = ctx.cm(0.5);
  let topY = rect.y + inset;
  if (region.title) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: rect.x + inset, y: topY, cx: rect.width - inset * 2, cy: ctx.cm(0.7) },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{ text: region.title, sizeHalfPt: 22, color: "DDE6F0", bold: true, fontFace: ctx.font("mono"), mono: true }],
      }],
    });
    topY += ctx.cm(0.8);
  }
  if (region.language) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: rect.x + rect.width - ctx.cm(3.4), y: rect.y + inset, cx: ctx.cm(3), cy: ctx.cm(0.6) },
      valign: "middle",
      paragraphs: [{
        align: "right",
        runs: [{ text: region.language, sizeHalfPt: 16, color: ctx.color("text-muted"), fontFace: ctx.font("mono"), mono: true }],
      }],
    });
  }
  const lines = region.code.split(/\r?\n/);
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: rect.x + inset, y: topY, cx: rect.width - inset * 2, cy: rect.y + rect.height - inset - topY },
    valign: "top",
    autoFit: "shrink",
    margin: { l: 0, r: 0, t: 0, b: 0 },
    paragraphs: lines.map((line) => ({
      align: "left",
      lineSpacingHalfPt: 40,
      runs: line.length > 0
        ? [{ text: line, sizeHalfPt: 18, color: "DDE6F0", fontFace: ctx.font("mono"), mono: true }]
        : [],
    })),
  });
  return out;
}

function resolveColorOrToken(ctx: LayoutContext, value: string | undefined, fallback: string): string {
  const v = value ?? fallback;
  return /^[0-9A-Fa-f]{6}$/.test(v) ? v : ctx.color(v);
}

function renderSparklineCell(ctx: LayoutContext, rect: RegionRect, region: RegionSparkline, opts: RegionRenderOptions = {}): ShapeList {
  const out: ShapeList = regionBacking(ctx, rect, region.style, { accentStripe: "brand-primary" });
  const inset = ctx.cm(0.6);
  const titleH = region.title ? ctx.cm(0.9) : 0;
  const reserved = Math.max(titleH, opts.topInset ?? 0);
  if (region.title) out.push(cellTitle(ctx, rect, region.title).shape);
  const captionH = region.caption ? ctx.cm(0.7) : 0;
  const chartX = rect.x + inset;
  const chartY = rect.y + ctx.cm(0.45) + reserved;
  const chartW = rect.width - inset * 2;
  const chartH = rect.height - ctx.cm(0.9) - reserved - captionH;

  // Build inline SVG so the renderer pipes it through the data-URL image
  // path. SVG viewBox is 0..100 × 0..100 — points scale to that, image
  // shape stretches to chartW × chartH.
  const values = region.values.length > 0 ? region.values : [0];
  const baseline = region.baseline ?? Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1e-9, max - baseline);
  const colorRaw = region.color ?? "brand-primary";
  const color = /^[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : ctx.color(colorRaw);
  const stepX = values.length > 1 ? 100 / (values.length - 1) : 0;
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = 100 - ((v - baseline) / range) * 90 - 5; // 5% top/bottom padding
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const polyline = `<polyline points="${points.join(" ")}" fill="none" stroke="#${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
  const area = region.area
    ? `<polygon points="0,100 ${points.join(" ")} 100,100" fill="#${color}" fill-opacity="0.18" stroke="none"/>`
    : "";
  // End marker at the last point.
  const lastPt = points[points.length - 1]?.split(",") ?? ["100", "50"];
  const endDot = `<circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="3" fill="#${color}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">${area}${polyline}${endDot}</svg>`;
  out.push({
    type: "image",
    id: ctx.id(),
    xfrm: { x: chartX, y: chartY, cx: chartW, cy: chartH },
    src: svgToHighResDataUrl(svg),
    altText: region.title ?? "sparkline",
  });

  if (region.caption) {
    const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: chartX, y: chartY + chartH + ctx.cm(0.1), cx: chartW, cy: captionH },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{ text: region.caption, sizeHalfPt: 18, color: ctx.color("text-muted"), italic: true, cjk: ctx.cjk, fontFace }],
      }],
    });
  }
  return out;
}

function renderProgressCell(ctx: LayoutContext, rect: RegionRect, region: RegionProgress, _opts: RegionRenderOptions = {}): ShapeList {
  const out: ShapeList = regionBacking(ctx, rect, region.style);
  const inset = ctx.cm(0.6);
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const fillColor = resolveColorOrToken(ctx, region.color, "brand-primary");
  const trackColor = resolveColorOrToken(ctx, region.trackColor, "divider");
  const value = Math.max(0, Math.min(1, region.value));
  const showPercent = region.showPercent !== false;

  // Layout: label (top), big percent (center), bar (bottom).
  if (region.label) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: rect.x + inset, y: rect.y + inset, cx: rect.width - inset * 2, cy: ctx.cm(0.8) },
      valign: "top",
      paragraphs: [{
        align: "left",
        runs: [{ text: region.label, sizeHalfPt: 22, color: ctx.color("text-muted"), bold: true, cjk: ctx.cjk, fontFace }],
      }],
    });
  }
  if (showPercent) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: rect.x + inset, y: rect.y + inset + ctx.cm(0.7), cx: rect.width - inset * 2, cy: rect.height - inset * 2 - ctx.cm(2.0) },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{ text: `${Math.round(value * 100)}%`, sizeHalfPt: 80, color: fillColor, bold: true, cjk: ctx.cjk, fontFace }],
      }],
    });
  }
  // Bar
  const barH = ctx.cm(0.4);
  const barY = rect.y + rect.height - inset - barH;
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "roundRect",
    xfrm: { x: rect.x + inset, y: barY, cx: rect.width - inset * 2, cy: barH },
    fill: { type: "solid", color: trackColor },
    line: { color: trackColor, width: 0 },
    cornerRadius: 0.5,
  });
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "roundRect",
    xfrm: {
      x: rect.x + inset,
      y: barY,
      cx: Math.round((rect.width - inset * 2) * value),
      cy: barH,
    },
    fill: { type: "solid", color: fillColor },
    line: { color: fillColor, width: 0 },
    cornerRadius: 0.5,
  });
  return out;
}

function renderQuoteCell(ctx: LayoutContext, rect: RegionRect, region: RegionQuote, _opts: RegionRenderOptions = {}): ShapeList {
  const out: ShapeList = regionBacking(ctx, rect, region.style, { accentStripe: "brand-primary" });
  const inset = ctx.cm(0.8);
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  // Big opening quote mark in brand color, top-left.
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: rect.x + inset - ctx.cm(0.2), y: rect.y + inset - ctx.cm(0.4), cx: ctx.cm(2), cy: ctx.cm(2) },
    valign: "top",
    paragraphs: [{
      align: "left",
      runs: [{ text: "\u201C", sizeHalfPt: 120, color: ctx.color("brand-primary"), bold: true, fontFace: ctx.font("latin") }],
    }],
  });
  const quoteHeight = region.attribution ? rect.height - inset * 2 - ctx.cm(1.2) : rect.height - inset * 2;
  const quoteRuns = parseInline(region.text, {
    sizeHalfPt: 26,
    color: ctx.color("text-strong"),
    fontFace,
    monoFont: ctx.font("mono"),
    cjk: ctx.cjk,
    resolveChipColor: chipColorResolver(ctx),
  }).map((r) => ({ ...r, italic: r.italic ?? true }));
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: rect.x + inset + ctx.cm(0.6), y: rect.y + inset + ctx.cm(0.6), cx: rect.width - inset * 2 - ctx.cm(0.6), cy: quoteHeight },
    valign: "middle",
    autoFit: "shrink",
    paragraphs: [{
      align: "left",
      lineSpacingHalfPt: 56,
      runs: quoteRuns,
    }],
  });
  if (region.attribution) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: rect.x + inset + ctx.cm(0.6), y: rect.y + rect.height - inset - ctx.cm(1.0), cx: rect.width - inset * 2 - ctx.cm(0.6), cy: ctx.cm(0.8) },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [
          { text: "— ",                  sizeHalfPt: 18, color: ctx.color("text-muted"), fontFace },
          { text: region.attribution,    sizeHalfPt: 18, color: ctx.color("text-muted"), bold: true, cjk: ctx.cjk, fontFace },
        ],
      }],
    });
  }
  return out;
}
