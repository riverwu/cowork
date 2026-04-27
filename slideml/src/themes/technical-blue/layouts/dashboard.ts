/**
 * `dashboard` — 2x2 grid where each cell hosts a different content type.
 *
 * Each cell value is a polymorphic region object:
 *   { kind: "kpi",   value, label, delta?, trend? }
 *   { kind: "chart", chart: { type, data, format? }, title? }
 *   { kind: "table", table: { header, rows, colWidths? }, title? }
 *   { kind: "text",  body, title? }
 *
 * Use this when one slide must surface multiple kinds of content at once
 * (KPIs + chart + table on a single executive dashboard). For
 * single-purpose slides, prefer the focused layouts (stat-grid-3,
 * chart-with-takeaway, data-table).
 */

import type { LayoutContext, LayoutFn } from "../../../render/layout-context.js";
import type { ChartShape, ShapeList, TableCell } from "../../../emitter/types.js";
import type { SlotSchema } from "../../../theme/types.js";
import {
  card,
  contentRect,
  gridCols,
  kpiTile,
  slideTitle,
  textBlockOf,
} from "../../../render/primitives.js";

export const slots: Record<string, SlotSchema> = {
  title: { type: "text",   maxChars: 50, optional: true },
  tl:    { type: "region" },
  tr:    { type: "region", optional: true },
  bl:    { type: "region", optional: true },
  br:    { type: "region", optional: true },
};

interface RegionKpi   { kind: "kpi"; value: string; label: string; delta?: string; trend?: "up" | "down" | "flat" }
interface RegionChart { kind: "chart"; chart: { type: ChartShape["chartType"]; data: { labels: string[]; series: Array<{ name: string; values: number[] }> }; format?: { y?: ChartShape["yFormat"] } }; title?: string }
interface RegionTable { kind: "table"; table: { header: string[]; rows: string[][]; colWidths?: number[] }; title?: string }
interface RegionText  { kind: "text"; body: string | string[]; title?: string }
type Region = RegionKpi | RegionChart | RegionTable | RegionText;

const dashboard: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");

  let bodyTop = ctx.cm(2);
  if (title) {
    out.push(...slideTitle(ctx, title));
    bodyTop = ctx.cm(4.4);
  }

  // 2x2 grid inside the available content area.
  const body = contentRect(ctx, { top: bodyTop, bottom: ctx.cm(2) });
  const cols = gridCols(ctx, body, 2, { gap: ctx.cm(0.6) });
  const rowGap = ctx.cm(0.6);
  const rowH = (body.height - rowGap) / 2;

  const positions = [
    { region: ctx.slot<Region>("tl"), x: cols[0]!.x, y: body.y,                     w: cols[0]!.width, h: rowH },
    { region: ctx.slot<Region>("tr"), x: cols[1]!.x, y: body.y,                     w: cols[1]!.width, h: rowH },
    { region: ctx.slot<Region>("bl"), x: cols[0]!.x, y: body.y + rowH + rowGap,     w: cols[0]!.width, h: rowH },
    { region: ctx.slot<Region>("br"), x: cols[1]!.x, y: body.y + rowH + rowGap,     w: cols[1]!.width, h: rowH },
  ];

  for (const p of positions) {
    if (!p.region) continue;
    const rect = { x: p.x, y: p.y, width: p.w, height: p.h };
    out.push(...renderRegion(ctx, rect, p.region));
  }

  return out;
};

export default dashboard;

function renderRegion(ctx: LayoutContext, rect: { x: number; y: number; width: number; height: number }, region: Region): ShapeList {
  switch (region.kind) {
    case "kpi":
      return kpiTile(ctx, rect, region);
    case "chart":
      return renderChartCell(ctx, rect, region);
    case "table":
      return renderTableCell(ctx, rect, region);
    case "text":
      return renderTextCell(ctx, rect, region);
  }
}

function renderChartCell(ctx: LayoutContext, rect: { x: number; y: number; width: number; height: number }, region: RegionChart): ShapeList {
  const out: ShapeList = card(ctx, rect, { accentStripe: "brand-primary" });
  const inset = ctx.cm(0.6);
  const titleH = region.title ? ctx.cm(0.9) : 0;
  if (region.title) {
    const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: rect.x + inset, y: rect.y + ctx.cm(0.45), cx: rect.width - inset * 2, cy: titleH },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{ text: region.title, sizeHalfPt: 24, color: ctx.color("text-strong"), bold: true, cjk: ctx.cjk, fontFace }],
      }],
    });
  }
  const chartShape: ChartShape = {
    type: "chart",
    id: ctx.id(),
    xfrm: { x: rect.x + inset, y: rect.y + ctx.cm(0.45) + titleH, cx: rect.width - inset * 2, cy: rect.height - ctx.cm(0.9) - titleH },
    chartType: region.chart.type,
    labels: region.chart.data.labels,
    series: region.chart.data.series,
    yFormat: region.chart.format?.y ?? "int",
    colors: [ctx.color("brand-primary"), ctx.color("brand-deep"), ctx.color("accent")],
    showValues: region.chart.type !== "pie",
  };
  out.push(chartShape);
  return out;
}

function renderTableCell(ctx: LayoutContext, rect: { x: number; y: number; width: number; height: number }, region: RegionTable): ShapeList {
  const out: ShapeList = card(ctx, rect, { accentStripe: "brand-primary" });
  const inset = ctx.cm(0.5);
  const titleH = region.title ? ctx.cm(0.8) : 0;
  if (region.title) {
    const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: rect.x + inset, y: rect.y + ctx.cm(0.4), cx: rect.width - inset * 2, cy: titleH },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{ text: region.title, sizeHalfPt: 22, color: ctx.color("text-strong"), bold: true, cjk: ctx.cjk, fontFace }],
      }],
    });
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

function renderTextCell(ctx: LayoutContext, rect: { x: number; y: number; width: number; height: number }, region: RegionText): ShapeList {
  const out: ShapeList = card(ctx, rect, { accentStripe: "brand-primary" });
  const inset = ctx.cm(0.6);
  const titleH = region.title ? ctx.cm(0.9) : 0;
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  if (region.title) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: rect.x + inset, y: rect.y + ctx.cm(0.45), cx: rect.width - inset * 2, cy: titleH },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{ text: region.title, sizeHalfPt: 24, color: ctx.color("text-strong"), bold: true, cjk: ctx.cjk, fontFace }],
      }],
    });
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
