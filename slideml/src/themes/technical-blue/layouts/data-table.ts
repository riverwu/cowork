import type { LayoutContext, LayoutFn } from "../../../render/layout-context.js";
import type { ShapeList, TableCell } from "../../../emitter/types.js";
import type { SlotSchema } from "../../../theme/types.js";

export const slots: Record<string, SlotSchema> = {
  title: { type: "text",  maxChars: 50, optional: true },
  table: { type: "table" },
};

interface TableSlot {
  header: string[];
  rows: string[][];
  /** Optional relative column weights. */
  colWidths?: number[];
}

const dataTable: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const tableSpec = ctx.slot<TableSlot>("table");
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  if (!tableSpec) return out;

  let bodyTop = ctx.cm(2);
  if (title) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(2), y: ctx.cm(1.4), cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(1.6) },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{
          text: title,
          sizeHalfPt: 44,
          color: ctx.color("text-strong"),
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: ctx.cm(2), y: ctx.cm(3.2), cx: ctx.cm(2.4), cy: ctx.cm(0.12) },
      fill: { type: "solid", color: ctx.color("brand-primary") },
    });
    bodyTop = ctx.cm(4.4);
  }

  const tableX = ctx.cm(2);
  const tableW = ctx.deck.width - ctx.cm(4);
  const tableH = ctx.deck.height - bodyTop - ctx.cm(2);
  const cols = tableSpec.header.length;

  // Column widths: explicit weights, else equal split.
  const weights = (tableSpec.colWidths && tableSpec.colWidths.length === cols)
    ? tableSpec.colWidths
    : Array(cols).fill(1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const colWidths = weights.map((w) => Math.floor((tableW * w) / weightSum));

  // Row heights: header taller, rest equal.
  const rowCount = 1 + tableSpec.rows.length;
  const headerH = ctx.cm(1.0);
  const bodyRowH = Math.floor((tableH - headerH) / Math.max(1, rowCount - 1));
  const rowHeights = [headerH, ...Array(tableSpec.rows.length).fill(bodyRowH)];

  // Build cells.
  const cells: TableCell[][] = [];
  // Header row.
  cells.push(
    tableSpec.header.map((h) => ({
      runs: [{
        text: String(h),
        sizeHalfPt: 26,
        color: "FFFFFF",
        bold: true,
        cjk: ctx.cjk,
        fontFace,
      }],
      fill: { type: "solid", color: ctx.color("brand-deep") },
      valign: "middle",
      align: "left",
    })),
  );
  // Body rows.
  for (let r = 0; r < tableSpec.rows.length; r++) {
    const row = tableSpec.rows[r]!;
    cells.push(
      row.map((cell, c) => ({
        runs: [{
          text: String(cell),
          sizeHalfPt: 24,
          color: ctx.color("text-strong"),
          cjk: ctx.cjk,
          fontFace,
        }],
        fill: r % 2 === 1 ? { type: "solid", color: ctx.color("bg-card") } : undefined,
        valign: "middle",
        align: c === 0 ? "left" : "left",
      })),
    );
  }

  out.push({
    type: "table",
    id: ctx.id(),
    xfrm: { x: tableX, y: bodyTop, cx: tableW, cy: tableH },
    colWidths,
    rowHeights,
    cells,
    firstRowHeader: true,
    borderColor: ctx.color("divider"),
    borderWidth: ctx.pt(0.5),
  });

  return out;
};

export default dataTable;
