/**
 * Native OOXML table emitter.
 *
 * Tables in PowerPoint are wrapped in a `<p:graphicFrame>` whose
 * `<a:graphic><a:graphicData uri=".../table">` payload contains the
 * `<a:tbl>` tree. Unlike charts, tables live inline in the slide XML —
 * no separate chart-style part files.
 *
 * Vendored carve-out: structure mirrors PptxGenJS `gen-xml.ts`'s
 * `slideObjectToXml` for tables. Stripped to the slot SlideML's
 * `table` slot exposes.
 */

import { assertHex, escapeText } from "./xml.js";
import type { FillSpec, HexColor, TableBorderLineSpec, TableBorderSide, TableCell, TableShape, TextRun } from "./types.js";
import { protectTextRunsForCjkLineBreaks } from "./text-protection.js";

const URI_TABLE = "http://schemas.openxmlformats.org/drawingml/2006/table";

const DEFAULT_BORDER_COLOR = "BFBFBF";
const DEFAULT_TABLE_STYLE_ID = "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}";
const TABLE_STYLE_ALIASES: Record<string, string> = {
  lightgridaccent1: "{5940675A-B579-460E-94D1-54222C63F5DA}",
  mediumgridaccent1: DEFAULT_TABLE_STYLE_ID,
};
const KNOWN_TABLE_STYLE_IDS = new Set<string>([
  DEFAULT_TABLE_STYLE_ID,
  ...Object.values(TABLE_STYLE_ALIASES),
]);

/** Build the entire `<p:graphicFrame>` for a table shape. */
export function tableGraphicFrameXml(shape: TableShape): string {
  const nvGFP =
    `<p:nvGraphicFramePr>` +
    `<p:cNvPr id="${shape.id}" name="${shape.name ?? `Table ${shape.id}`}"/>` +
    `<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>` +
    `<p:nvPr/>` +
    `</p:nvGraphicFramePr>`;

  const xfrm =
    `<p:xfrm>` +
    `<a:off x="${Math.round(shape.xfrm.x)}" y="${Math.round(shape.xfrm.y)}"/>` +
    `<a:ext cx="${Math.round(shape.xfrm.cx)}" cy="${Math.round(shape.xfrm.cy)}"/>` +
    `</p:xfrm>`;

  const tbl = tblXml(shape);

  const graphic =
    `<a:graphic>` +
    `<a:graphicData uri="${URI_TABLE}">` +
    tbl +
    `</a:graphicData>` +
    `</a:graphic>`;

  return `<p:graphicFrame>${nvGFP}${xfrm}${graphic}</p:graphicFrame>`;
}

/** `<a:tbl>` body. */
function tblXml(shape: TableShape): string {
  const tableStyleId = normalizeTableStyleId(shape.tableStyleId);
  const tblPr =
    `<a:tblPr firstRow="${shape.firstRowHeader ? 1 : 0}" bandRow="${shape.bandRows === false ? 0 : 1}" bandCol="${shape.bandCols ? 1 : 0}" firstCol="${shape.firstCol ? 1 : 0}" lastCol="${shape.lastCol ? 1 : 0}" lastRow="${shape.lastRow ? 1 : 0}">` +
    `<a:tableStyleId>${xmlEscape(tableStyleId)}</a:tableStyleId>` +
    `</a:tblPr>`;

  const tblGrid =
    `<a:tblGrid>` +
    shape.colWidths.map((w) => `<a:gridCol w="${Math.round(w)}"/>`).join("") +
    `</a:tblGrid>`;

  const rows = shape.cells.map((row, ri) =>
    rowXml(row, shape.rowHeights[ri] ?? 0, shape, ri),
  ).join("");

  return `<a:tbl>${tblPr}${tblGrid}${rows}</a:tbl>`;
}

function normalizeTableStyleId(value: string | undefined): string {
  if (!value) return DEFAULT_TABLE_STYLE_ID;
  const trimmed = value.trim();
  if (/^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$/.test(trimmed)) {
    const upper = trimmed.toUpperCase();
    return KNOWN_TABLE_STYLE_IDS.has(upper) ? upper : DEFAULT_TABLE_STYLE_ID;
  }
  return TABLE_STYLE_ALIASES[trimmed.replace(/[\s_-]+/g, "").toLowerCase()] ?? DEFAULT_TABLE_STYLE_ID;
}

function rowXml(
  cells: TableCell[],
  height: number,
  shape: TableShape,
  rowIndex: number,
): string {
  const cellsXml = cells
    .map((c) => cellXml(c, shape, rowIndex))
    .join("");
  return `<a:tr h="${Math.round(height)}">${cellsXml}</a:tr>`;
}

function cellXml(cell: TableCell, shape: TableShape, rowIndex: number): string {
  const isHeader = !!shape.firstRowHeader && rowIndex === 0;
  const align = cell.align ?? (isHeader ? "left" : "left");
  const algn = align === "center" ? "ctr" : align === "right" ? "r" : "l";
  const valign = cell.valign ?? "middle";
  const anchor = valign === "middle" ? "ctr" : valign === "bottom" ? "b" : "t";
  const padding = { ...shape.cellPadding, ...cell.padding };
  const bodyInsets =
    ` lIns="${Math.round(padding.l ?? 91440)}"` +
    ` tIns="${Math.round(padding.t ?? 45720)}"` +
    ` rIns="${Math.round(padding.r ?? 91440)}"` +
    ` bIns="${Math.round(padding.b ?? 45720)}"`;
  const rotation = cell.textRotation === 90 ? ` rot="5400000"`
    : cell.textRotation === 270 ? ` rot="16200000"`
      : cell.textRotation === "vertical" ? ` vert="vert"`
        : "";
  const attrs = [
    cell.colspan && cell.colspan > 1 ? `gridSpan="${Math.floor(cell.colspan)}"` : "",
    cell.rowspan && cell.rowspan > 1 ? `rowSpan="${Math.floor(cell.rowspan)}"` : "",
    cell.hMerge ? `hMerge="1"` : "",
    cell.vMerge ? `vMerge="1"` : "",
  ].filter(Boolean).join(" ");
  const attrText = attrs ? ` ${attrs}` : "";

  const fill = cell.fill ?? (isHeader ? undefined : undefined);
  const protectedRuns = protectTextRunsForCjkLineBreaks(cell.runs);
  const txBody =
    `<a:txBody>` +
    `<a:bodyPr wrap="square"${bodyInsets} anchor="${anchor}"${rotation}/>` +
    `<a:lstStyle/>` +
    `<a:p>` +
    `<a:pPr algn="${algn}" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"/>` +
    protectedRuns.map((r) => runXml(r)).join("") +
    (protectedRuns.length === 0 ? `<a:endParaRPr lang="en-US"/>` : "") +
    `</a:p>` +
    `</a:txBody>`;

  const tcPr = tcPrXml(fill, shape, cell, isHeader);
  return `<a:tc${attrText}>${txBody}${tcPr}</a:tc>`;
}

/**
 * `<a:tcPr>` — element order per CT_TableCellProperties:
 *   lnL → lnR → lnT → lnB → lnTlToBr → lnBlToTr → cell3D → fill → headers → extLst.
 * We only emit the four side borders + the fill.
 */
function tcPrXml(fill: FillSpec | undefined, shape: TableShape, cell: TableCell, isHeader: boolean): string {
  if (shape.borderColor) assertHex(shape.borderColor, "TableShape.borderColor");
  const fillXml = fillXmlOf(fill, isHeader);

  return (
    `<a:tcPr>` +
    tableLineXml("left", shape, cell) +
    tableLineXml("right", shape, cell) +
    tableLineXml("top", shape, cell) +
    tableLineXml("bottom", shape, cell) +
    fillXml +
    `</a:tcPr>`
  );
}

function tableLineXml(side: TableBorderSide, shape: TableShape, cell: TableCell): string {
  const tag = side === "left" ? "lnL" : side === "right" ? "lnR" : side === "top" ? "lnT" : "lnB";
  const spec = borderForSide(side, shape, cell);
  if (spec === "none") return `<a:${tag}><a:noFill/></a:${tag}>`;
  const borderColor = (spec.color ?? shape.borderColor ?? DEFAULT_BORDER_COLOR).toUpperCase();
  assertHex(borderColor, `TableCell.border.${side}.color`);
  const borderWidth = Math.max(1, Math.round(spec.width ?? shape.borderWidth ?? 6350));
  const dash = spec.dash ?? shape.borderDash ?? "solid";
  const alphaXml = spec.alpha !== undefined && spec.alpha < 1
    ? `<a:alpha val="${Math.round(spec.alpha * 100000)}"/>`
    : "";
  const dashXml = dash && dash !== "solid" ? `<a:prstDash val="${dash}"/>` : `<a:prstDash val="solid"/>`;
  const lnW = `w="${borderWidth}" cap="flat" cmpd="sng" algn="ctr"`;
  const lnFill = `<a:solidFill><a:srgbClr val="${borderColor}">${alphaXml}</a:srgbClr></a:solidFill>${dashXml}<a:round/>`;
  const headLnEnd = `<a:headEnd type="none" w="med" len="med"/><a:tailEnd type="none" w="med" len="med"/>`;
  return `<a:${tag} ${lnW}>${lnFill}${headLnEnd}</a:${tag}>`;
}

function borderForSide(side: TableBorderSide, shape: TableShape, cell: TableCell): TableBorderLineSpec | "none" {
  const merged = mergeBorderSpec(side, shape.borders);
  const cellSpec = mergeBorderSpec(side, cell.border);
  return cellSpec ?? merged ?? { color: shape.borderColor, width: shape.borderWidth, dash: shape.borderDash };
}

function mergeBorderSpec(side: TableBorderSide, value: TableShape["borders"] | TableCell["border"] | undefined): TableBorderLineSpec | "none" | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  const sideValue = rec[side];
  if (sideValue === "none") return "none";
  const base: TableBorderLineSpec = {};
  if (typeof rec.color === "string") base.color = rec.color;
  if (typeof rec.width === "number") base.width = rec.width;
  if (rec.dash === "solid" || rec.dash === "dash" || rec.dash === "dashDot" || rec.dash === "dot") base.dash = rec.dash;
  if (typeof rec.alpha === "number") base.alpha = rec.alpha;
  if (sideValue && typeof sideValue === "object") {
    const s = sideValue as Record<string, unknown>;
    if (typeof s.color === "string") base.color = s.color;
    if (typeof s.width === "number") base.width = s.width;
    if (s.dash === "solid" || s.dash === "dash" || s.dash === "dashDot" || s.dash === "dot") base.dash = s.dash;
    if (typeof s.alpha === "number") base.alpha = s.alpha;
  }
  return base;
}

function fillXmlOf(fill: FillSpec | undefined, isHeader: boolean): string {
  if (!fill && !isHeader) return "";
  if (!fill || fill.type === "none") return "";
  if (fill.type === "gradient") {
    // Table cells don't carry full <a:gradFill>; collapse to the average stop
    // color so we still emit a useful solid fill.
    const stops = fill.stops || [];
    if (stops.length === 0) return "";
    const avg = stops.map((s) => s.color);
    const r = Math.round(avg.reduce((acc, c) => acc + parseInt(c.slice(0, 2), 16), 0) / avg.length);
    const g = Math.round(avg.reduce((acc, c) => acc + parseInt(c.slice(2, 4), 16), 0) / avg.length);
    const b = Math.round(avg.reduce((acc, c) => acc + parseInt(c.slice(4, 6), 16), 0) / avg.length);
    const hex = [r, g, b].map((n) => n.toString(16).padStart(2, "0").toUpperCase()).join("");
    return `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
  }
  assertHex(fill.color, "TableCell.fill.color");
  const alphaXml = fill.alpha !== undefined && fill.alpha < 1
    ? `<a:alpha val="${Math.round(fill.alpha * 100000)}"/>`
    : "";
  return `<a:solidFill><a:srgbClr val="${fill.color.toUpperCase()}">${alphaXml}</a:srgbClr></a:solidFill>`;
}

/** Reuse a tiny subset of run-XML rules — table cells use the same shape as text shapes. */
function runXml(run: TextRun): string {
  if (run.color) assertHex(run.color, "TableCell.runs[].color");
  if (run.highlight) assertHex(run.highlight, "TableCell.runs[].highlight");
  const sz = run.sizeHalfPt !== undefined ? ` sz="${Math.round(run.sizeHalfPt * 50)}"` : "";
  const b = run.bold ? ` b="1"` : "";
  const i = run.italic ? ` i="1"` : "";
  const u = run.underline ? ` u="sng"` : "";
  const strike = run.strike ? ` strike="sngStrike"` : "";
  const baseline = typeof run.baseline === "number" ? ` baseline="${Math.round(run.baseline * 1000)}"` : "";
  const spc = typeof run.letterSpacing === "number" ? ` spc="${Math.round(run.letterSpacing)}"` : "";
  const fill = run.color
    ? `<a:solidFill><a:srgbClr val="${run.color.toUpperCase()}"/></a:solidFill>`
    : "";
  const highlight = run.highlight
    ? `<a:highlight><a:srgbClr val="${run.highlight.toUpperCase()}"/></a:highlight>`
    : "";

  let fonts = "";
  if (run.fontFace || run.cjk || run.mono) {
    const latinFace = xmlEscape(run.fontFace ?? "Calibri");
    const eaFace = run.cjk ? xmlEscape(run.eastAsianFontFace ?? run.fontFace ?? "PingFang SC") : undefined;
    const csFace = run.mono ? xmlEscape(run.complexScriptFontFace ?? run.fontFace ?? "Menlo") : undefined;
    fonts += `<a:latin typeface="${latinFace}"/>`;
    if (eaFace) fonts += `<a:ea typeface="${eaFace}"/>`;
    if (csFace) fonts += `<a:cs typeface="${csFace}"/>`;
  }

  const rPr = `<a:rPr lang="en-US"${sz}${b}${i}${u}${strike}${baseline}${spc} dirty="0">${fill}${highlight}${fonts}</a:rPr>`;
  return `<a:r>${rPr}<a:t xml:space="preserve">${escapeText(run.text)}</a:t></a:r>`;
}

function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c] ?? c));
}
