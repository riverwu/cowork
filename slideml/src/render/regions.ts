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
 * region helpers serve dashboard's 2x2 cells, split-2's halves, and
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
  imageOrPlaceholder,
  imageRefOf,
  kpiTile,
  textBlockOf,
} from "./primitives.js";

// ---------------------------------------------------------------------------
// Region union
// ---------------------------------------------------------------------------

export interface RegionRect { x: number; y: number; width: number; height: number }

export interface RegionKpi    { kind: "kpi"; value: string; label: string; delta?: string; trend?: "up" | "down" | "flat" }
export interface RegionChart  { kind: "chart"; chart: { type: ChartShape["chartType"]; data: { labels: string[]; series: Array<{ name: string; values: number[] }> }; format?: { y?: ChartShape["yFormat"] } }; title?: string }
export interface RegionTable  { kind: "table"; table: { header: string[]; rows: string[][]; colWidths?: number[] }; title?: string }
export interface RegionText   { kind: "text"; body: string | string[]; title?: string }
export interface RegionBullets { kind: "bullets"; items: string[]; title?: string }
export interface RegionImage  { kind: "image"; image: unknown; caption?: string }
export interface RegionCode   { kind: "code"; code: string; language?: string; title? : string }
export interface RegionQuote  { kind: "quote"; text: string; attribution?: string }

export type Region =
  | RegionKpi
  | RegionChart
  | RegionTable
  | RegionText
  | RegionBullets
  | RegionImage
  | RegionCode
  | RegionQuote;

/** Discriminator values agents see in `describe_slide_layout` examples. */
export const REGION_KINDS = ["kpi", "chart", "table", "text", "bullets", "image", "code", "quote"] as const;

// ---------------------------------------------------------------------------
// Top-level dispatch
// ---------------------------------------------------------------------------

export function renderRegion(ctx: LayoutContext, rect: RegionRect, region: Region): ShapeList {
  switch (region.kind) {
    case "kpi":     return kpiTile(ctx, rect, region);
    case "chart":   return renderChartCell(ctx, rect, region);
    case "table":   return renderTableCell(ctx, rect, region);
    case "text":    return renderTextCell(ctx, rect, region);
    case "bullets": return renderBulletsCell(ctx, rect, region);
    case "image":   return renderImageCell(ctx, rect, region);
    case "code":    return renderCodeCell(ctx, rect, region);
    case "quote":   return renderQuoteCell(ctx, rect, region);
  }
}

// ---------------------------------------------------------------------------
// Per-kind cell renderers
// ---------------------------------------------------------------------------

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

function renderChartCell(ctx: LayoutContext, rect: RegionRect, region: RegionChart): ShapeList {
  const out: ShapeList = card(ctx, rect, { accentStripe: "brand-primary" });
  const inset = ctx.cm(0.6);
  let titleH = 0;
  if (region.title) {
    const t = cellTitle(ctx, rect, region.title);
    out.push(t.shape);
    titleH = t.height;
  }
  const chartShape: ChartShape = {
    type: "chart",
    id: ctx.id(),
    xfrm: { x: rect.x + inset, y: rect.y + ctx.cm(0.45) + titleH, cx: rect.width - inset * 2, cy: rect.height - ctx.cm(0.9) - titleH },
    chartType: region.chart.type,
    labels: region.chart.data.labels,
    series: region.chart.data.series,
    yFormat: region.chart.format?.y ?? "int",
    colors: [ctx.color("brand-primary"), ctx.color("accent"), ctx.color("text-muted")],
    showValues: region.chart.type !== "pie",
  };
  out.push(chartShape);
  return out;
}

function renderTableCell(ctx: LayoutContext, rect: RegionRect, region: RegionTable): ShapeList {
  const out: ShapeList = card(ctx, rect, { accentStripe: "brand-primary" });
  const inset = ctx.cm(0.5);
  let titleH = 0;
  if (region.title) {
    const t = cellTitle(ctx, rect, region.title, 22);
    out.push(t.shape);
    titleH = t.height;
  }
  const tableX = rect.x + inset;
  const tableY = rect.y + ctx.cm(0.4) + titleH;
  const tableW = rect.width - inset * 2;
  const tableH = rect.height - (titleH + ctx.cm(0.8));
  const cols = region.table.header.length;
  const weights = region.table.colWidths && region.table.colWidths.length === cols ? region.table.colWidths : Array(cols).fill(1);
  const sum = weights.reduce((a, b) => a + b, 0);
  const colWidths = weights.map((w) => Math.floor((tableW * w) / sum));
  const rowCount = 1 + region.table.rows.length;
  const headerH = ctx.cm(0.7);
  const bodyRowH = Math.floor((tableH - headerH) / Math.max(1, rowCount - 1));
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const cells: TableCell[][] = [
    region.table.header.map((h) => ({
      runs: [{ text: String(h), sizeHalfPt: 20, color: "FFFFFF", bold: true, cjk: ctx.cjk, fontFace }],
      fill: { type: "solid", color: ctx.color("brand-deep") },
      valign: "middle",
      align: "left",
    })),
    ...region.table.rows.map((r, ri) => r.map((c): TableCell => ({
      runs: [{ text: String(c), sizeHalfPt: 18, color: ctx.color("text-strong"), cjk: ctx.cjk, fontFace }],
      fill: ri % 2 === 1 ? { type: "solid", color: ctx.color("bg-card") } : undefined,
      valign: "middle",
      align: "left",
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

function renderTextCell(ctx: LayoutContext, rect: RegionRect, region: RegionText): ShapeList {
  const out: ShapeList = card(ctx, rect, { accentStripe: "brand-primary" });
  const inset = ctx.cm(0.6);
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  let titleH = 0;
  if (region.title) {
    const t = cellTitle(ctx, rect, region.title);
    out.push(t.shape);
    titleH = t.height;
  }
  const text = textBlockOf(region.body);
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: rect.x + inset, y: rect.y + ctx.cm(0.45) + titleH, cx: rect.width - inset * 2, cy: rect.height - ctx.cm(0.9) - titleH },
    valign: "top",
    paragraphs: (paras.length > 0 ? paras : [text]).map((p) => ({
      align: "left",
      lineSpacingHalfPt: 48,
      spaceAfterHalfPt: 12,
      runs: [{ text: p, sizeHalfPt: 20, color: ctx.color("text-strong"), cjk: ctx.cjk, fontFace }],
    })),
  });
  return out;
}

function renderBulletsCell(ctx: LayoutContext, rect: RegionRect, region: RegionBullets): ShapeList {
  const out: ShapeList = card(ctx, rect, { accentStripe: "brand-primary" });
  const inset = ctx.cm(0.6);
  let titleH = 0;
  if (region.title) {
    const t = cellTitle(ctx, rect, region.title);
    out.push(t.shape);
    titleH = t.height;
  }
  out.push(...bulletsBlock(ctx, {
    x: rect.x + inset,
    y: rect.y + ctx.cm(0.45) + titleH,
    width: rect.width - inset * 2,
    height: rect.height - ctx.cm(0.9) - titleH,
  }, region.items, { sizeHalfPt: 22 }));
  return out;
}

function renderImageCell(ctx: LayoutContext, rect: RegionRect, region: RegionImage): ShapeList {
  const out: ShapeList = card(ctx, rect, { accentStripe: "brand-primary" });
  const ref = imageRefOf(region.image);
  const inset = ctx.cm(0.4);
  const captionH = region.caption ? ctx.cm(0.9) : 0;
  out.push(...imageOrPlaceholder(ctx, {
    x: rect.x + inset,
    y: rect.y + inset,
    width: rect.width - inset * 2,
    height: rect.height - inset * 2 - captionH,
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

function renderCodeCell(ctx: LayoutContext, rect: RegionRect, region: RegionCode): ShapeList {
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

function renderQuoteCell(ctx: LayoutContext, rect: RegionRect, region: RegionQuote): ShapeList {
  const out: ShapeList = card(ctx, rect, { accentStripe: "brand-primary" });
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
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: rect.x + inset + ctx.cm(0.6), y: rect.y + inset + ctx.cm(0.6), cx: rect.width - inset * 2 - ctx.cm(0.6), cy: quoteHeight },
    valign: "middle",
    paragraphs: [{
      align: "left",
      lineSpacingHalfPt: 56,
      runs: [{ text: region.text, sizeHalfPt: 26, color: ctx.color("text-strong"), italic: true, cjk: ctx.cjk, fontFace }],
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
