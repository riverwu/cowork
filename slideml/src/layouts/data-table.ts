import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList, TableCell } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { inferTableAlign, slideTitle, tableCellOf } from "../render/primitives.js";

export const slots: Record<string, SlotSchema> = {
  title: { type: "text",  maxChars: 50, optional: true },
  table: { type: "table" },
};

interface TableSlot {
  header: string[];
  rows: unknown[][];
  /** Optional relative column weights. */
  colWidths?: number[];
  /** Optional per-column alignment. Defaults: numeric→right, else left. */
  align?: Array<"left" | "center" | "right">;
}

const dataTable: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const tableSpec = ctx.slot<TableSlot>("table");
  if (!tableSpec) return out;

  let bodyTop = ctx.cm(2);
  if (title) {
    out.push(...slideTitle(ctx, title));
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

  // Build cells via the shared `tableCellOf` primitive — picks up inline
  // markdown, chip syntax, and the optional `{ value, emphasis }` shape.
  // Header cells follow each column's `align` override; body cells fall
  // back to a numeric-vs-text heuristic when no explicit align is given.
  const colAlign = tableSpec.align ?? [];
  const cells: TableCell[][] = [];
  cells.push(
    tableSpec.header.map((h, ci) => tableCellOf(ctx, h, {
      sizeHalfPt: 26,
      baseColor: "FFFFFF",
      bold: true,
      align: colAlign[ci] ?? "left",
      fill: { color: ctx.color("brand-deep") },
    })),
  );
  for (let r = 0; r < tableSpec.rows.length; r++) {
    const row = tableSpec.rows[r]!;
    cells.push(
      row.map((cell, ci) => tableCellOf(ctx, cell, {
        sizeHalfPt: 24,
        align: inferTableAlign(cell, colAlign[ci]),
        fill: r % 2 === 1 ? { color: ctx.color("bg-card") } : undefined,
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
