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
import type { FillSpec, HexColor, TableCell, TableShape, TextRun } from "./types.js";

const URI_TABLE = "http://schemas.openxmlformats.org/drawingml/2006/table";

const DEFAULT_BORDER_COLOR = "BFBFBF";

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
  const tblPr =
    `<a:tblPr firstRow="${shape.firstRowHeader ? 1 : 0}" bandRow="1">` +
    `<a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId>` +
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
  const attrs = [
    cell.colspan && cell.colspan > 1 ? `gridSpan="${Math.floor(cell.colspan)}"` : "",
    cell.rowspan && cell.rowspan > 1 ? `rowSpan="${Math.floor(cell.rowspan)}"` : "",
    cell.hMerge ? `hMerge="1"` : "",
    cell.vMerge ? `vMerge="1"` : "",
  ].filter(Boolean).join(" ");
  const attrText = attrs ? ` ${attrs}` : "";

  const fill = cell.fill ?? (isHeader ? undefined : undefined);
  const txBody =
    `<a:txBody>` +
    `<a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="${anchor}"/>` +
    `<a:lstStyle/>` +
    `<a:p>` +
    `<a:pPr algn="${algn}"/>` +
    cell.runs.map((r) => runXml(r)).join("") +
    (cell.runs.length === 0 ? `<a:endParaRPr lang="en-US"/>` : "") +
    `</a:p>` +
    `</a:txBody>`;

  const tcPr = tcPrXml(fill, shape, isHeader);
  return `<a:tc${attrText}>${txBody}${tcPr}</a:tc>`;
}

/**
 * `<a:tcPr>` — element order per CT_TableCellProperties:
 *   lnL → lnR → lnT → lnB → lnTlToBr → lnBlToTr → cell3D → fill → headers → extLst.
 * We only emit the four side borders + the fill.
 */
function tcPrXml(fill: FillSpec | undefined, shape: TableShape, isHeader: boolean): string {
  if (shape.borderColor) assertHex(shape.borderColor, "TableShape.borderColor");
  const borderColor = (shape.borderColor ?? DEFAULT_BORDER_COLOR).toUpperCase();
  const borderWidth = Math.max(1, Math.round(shape.borderWidth ?? 6350));

  const lnW = `w="${borderWidth}" cap="flat" cmpd="sng" algn="ctr"`;
  const lnFill = `<a:solidFill><a:srgbClr val="${borderColor}"/></a:solidFill><a:prstDash val="solid"/><a:round/>`;
  const headLnEnd = `<a:headEnd type="none" w="med" len="med"/><a:tailEnd type="none" w="med" len="med"/>`;
  const fillXml = fillXmlOf(fill, isHeader);

  return (
    `<a:tcPr>` +
    `<a:lnL ${lnW}>${lnFill}${headLnEnd}</a:lnL>` +
    `<a:lnR ${lnW}>${lnFill}${headLnEnd}</a:lnR>` +
    `<a:lnT ${lnW}>${lnFill}${headLnEnd}</a:lnT>` +
    `<a:lnB ${lnW}>${lnFill}${headLnEnd}</a:lnB>` +
    fillXml +
    `</a:tcPr>`
  );
}

function fillXmlOf(fill: FillSpec | undefined, isHeader: boolean): string {
  if (!fill && !isHeader) return "";
  if (!fill || fill.type === "none") return "";
  assertHex(fill.color, "TableCell.fill.color");
  const alphaXml = fill.alpha !== undefined && fill.alpha < 1
    ? `<a:alpha val="${Math.round(fill.alpha * 100000)}"/>`
    : "";
  return `<a:solidFill><a:srgbClr val="${fill.color.toUpperCase()}">${alphaXml}</a:srgbClr></a:solidFill>`;
}

/** Reuse a tiny subset of run-XML rules — table cells use the same shape as text shapes. */
function runXml(run: TextRun): string {
  if (run.color) assertHex(run.color, "TableCell.runs[].color");
  const sz = run.sizeHalfPt !== undefined ? ` sz="${Math.round(run.sizeHalfPt * 50)}"` : "";
  const b = run.bold ? ` b="1"` : "";
  const i = run.italic ? ` i="1"` : "";
  const fill = run.color
    ? `<a:solidFill><a:srgbClr val="${run.color.toUpperCase()}"/></a:solidFill>`
    : "";

  let fonts = "";
  if (run.fontFace || run.cjk || run.mono) {
    const latinFace = xmlEscape(run.fontFace ?? "Calibri");
    const eaFace = run.cjk ? xmlEscape(run.fontFace ?? "PingFang SC") : undefined;
    const csFace = run.mono ? xmlEscape(run.fontFace ?? "Menlo") : undefined;
    fonts += `<a:latin typeface="${latinFace}"/>`;
    if (eaFace) fonts += `<a:ea typeface="${eaFace}"/>`;
    if (csFace) fonts += `<a:cs typeface="${csFace}"/>`;
  }

  const rPr = `<a:rPr lang="en-US"${sz}${b}${i} dirty="0">${fill}${fonts}</a:rPr>`;
  return `<a:r>${rPr}<a:t xml:space="preserve">${escapeText(run.text)}</a:t></a:r>`;
}

function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c] ?? c));
}
