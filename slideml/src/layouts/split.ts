/**
 * `split` — title (optional) over N polymorphic regions arranged in a
 * row, column, or T-shape. Replaces the older split-2, split-3-horizontal,
 * and split-3-vertical layouts; `cells` + `direction` pick the geometry.
 *
 *   cells: 2, direction: horizontal           — two side-by-side cells
 *   cells: 3, direction: horizontal           — three columns
 *   cells: 3, direction: vertical             — top region + 2-cell bottom row
 *
 * Cells are named by index: cell1, cell2, cell3 (1-based for agent
 * readability). For 3-vertical: cell1 = top, cell2 = bottom-left,
 * cell3 = bottom-right.
 *
 * Each cell is a polymorphic Region (kpi/chart/table/text/bullets/image/
 * code/quote/sparkline/progress).  For 4 cells use `dashboard` (2×2 grid).
 */

import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { contentRect, gridCols, slideTitle } from "../render/primitives.js";
import { computeRegionTopInset, renderRegion, type Region } from "../render/regions.js";

export const slots: Record<string, SlotSchema> = {
  title:     { type: "text", maxChars: 35, optional: true },
  cell1:     { type: "region" },
  cell2:     { type: "region" },
  cell3:     { type: "region", optional: true },
  cells:     { type: "enum",   values: ["2", "3"], default: "2", optional: true },
  direction: { type: "enum",   values: ["horizontal", "vertical"], default: "horizontal", optional: true },
  // Width / height ratio between cells. Meaning depends on direction:
  //   horizontal 2: column widths   (50-50 / 60-40 / 40-60 / 67-33 / 33-67 / 75-25 / 25-75)
  //   horizontal 3: column widths   (equal / wide-center / wide-left / wide-right)
  //   vertical 3:   top:bottom rows (50-50 / 60-40 / 40-60 / 67-33 / 33-67)
  ratio:     { type: "enum",
    values: ["50-50", "60-40", "40-60", "67-33", "33-67", "75-25", "25-75",
             "equal", "wide-center", "wide-left", "wide-right"],
    default: "50-50", optional: true },
};

const RATIO_2: Record<string, [number, number]> = {
  "50-50": [1, 1],
  "60-40": [6, 4],
  "40-60": [4, 6],
  "67-33": [2, 1],
  "33-67": [1, 2],
  "75-25": [3, 1],
  "25-75": [1, 3],
};

const RATIO_3H: Record<string, [number, number, number]> = {
  "equal":       [1, 1, 1],
  "wide-center": [1, 2, 1],
  "wide-left":   [2, 1, 1],
  "wide-right":  [1, 1, 2],
};

const split: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const cellsCount = ctx.slot<string>("cells") === "3" ? 3 : 2;
  const direction = ctx.slot<string>("direction") ?? "horizontal";
  const ratioKey = ctx.slot<string>("ratio") ?? (cellsCount === 3 && direction === "horizontal" ? "equal" : "50-50");

  let bodyTop = ctx.cm(2);
  if (title) {
    out.push(...slideTitle(ctx, title));
    bodyTop = ctx.cm(4.4);
  }
  const body = contentRect(ctx, { top: bodyTop, bottom: ctx.cm(2) });

  const c1 = ctx.slot<Region>("cell1");
  const c2 = ctx.slot<Region>("cell2");
  const c3 = ctx.slot<Region>("cell3");

  // 3 cells, vertical: top region + bottom row of 2.
  if (cellsCount === 3 && direction === "vertical") {
    const rowGap = ctx.cm(0.6);
    const [topW, botW] = RATIO_2[ratioKey] ?? RATIO_2["50-50"]!;
    const usableH = body.height - rowGap;
    const topH = Math.floor((usableH * topW) / (topW + botW));
    const botH = usableH - topH;
    if (c1) out.push(...renderRegion(ctx, { x: body.x, y: body.y, width: body.width, height: topH }, c1));
    const bottomY = body.y + topH + rowGap;
    const cols = gridCols(ctx, { x: body.x, y: bottomY, width: body.width, height: botH }, 2, { gap: ctx.cm(0.6) });
    const inset = computeRegionTopInset(ctx, [c2, c3]);
    if (c2) out.push(...renderRegion(ctx, { x: cols[0]!.x, y: bottomY, width: cols[0]!.width, height: botH }, c2, { topInset: inset }));
    if (c3) out.push(...renderRegion(ctx, { x: cols[1]!.x, y: bottomY, width: cols[1]!.width, height: botH }, c3, { topInset: inset }));
    return out;
  }

  // Horizontal: 2 or 3 columns side by side.
  const n = cellsCount;
  const weights = n === 3
    ? (RATIO_3H[ratioKey] ?? RATIO_3H["equal"])
    : (RATIO_2[ratioKey] ?? RATIO_2["50-50"]);
  const cols = gridCols(ctx, body, n, { gap: ctx.cm(n === 3 ? 0.5 : 0.6), weights });
  const cellsArr: Array<Region | undefined> = n === 3 ? [c1, c2, c3] : [c1, c2];
  const inset = computeRegionTopInset(ctx, cellsArr);
  cellsArr.forEach((cell, i) => {
    if (!cell) return;
    out.push(...renderRegion(ctx, { x: cols[i]!.x, y: body.y, width: cols[i]!.width, height: body.height }, cell, { topInset: inset }));
  });
  return out;
};

export default split;
