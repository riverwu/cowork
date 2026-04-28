/**
 * `split-2` — title (optional) over two side-by-side cells.
 *
 * Each cell is a polymorphic region (one of 8 kinds — see render/regions.ts).
 * Use this when a slide pairs two heterogeneous things side-by-side, e.g.
 * bullets + chart, image + quote, code + explanation.
 *
 * For single-content slides prefer the focused layouts (chart-with-takeaway,
 * bullet-with-image, etc.). For 4 cells use `dashboard`.
 */

import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { contentRect, gridCols, slideTitle } from "../render/primitives.js";
import { computeRegionTopInset, renderRegion, type Region } from "../render/regions.js";

export const slots: Record<string, SlotSchema> = {
  title: { type: "text",   maxChars: 50, optional: true },
  left:  { type: "region" },
  right: { type: "region" },
  // Column-width ratio. Default 50-50. Other values shift weight between
  // the two cells: 60-40 = left dominant, 25-75 = right dominant, etc.
  ratio: {
    type: "enum",
    values: ["50-50", "60-40", "40-60", "67-33", "33-67", "75-25", "25-75"],
    default: "50-50",
    optional: true,
  },
};

const RATIO_WEIGHTS: Record<string, [number, number]> = {
  "50-50": [1, 1],
  "60-40": [6, 4],
  "40-60": [4, 6],
  "67-33": [2, 1],
  "33-67": [1, 2],
  "75-25": [3, 1],
  "25-75": [1, 3],
};

const split2: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const left  = ctx.slot<Region>("left");
  const right = ctx.slot<Region>("right");

  let bodyTop = ctx.cm(2);
  if (title) {
    out.push(...slideTitle(ctx, title));
    bodyTop = ctx.cm(4.4);
  }

  const body = contentRect(ctx, { top: bodyTop, bottom: ctx.cm(2) });
  const ratioKey = ctx.slot<string>("ratio") ?? "50-50";
  const weights = RATIO_WEIGHTS[ratioKey] ?? RATIO_WEIGHTS["50-50"];
  const cols = gridCols(ctx, body, 2, { gap: ctx.cm(0.6), weights });

  // Cross-cell baseline alignment: pre-compute the max title-row height
  // so a cell without its own title still leaves the same vertical space
  // at top as a sibling cell that does have one.
  const topInset = computeRegionTopInset(ctx, [left, right]);

  if (left)  out.push(...renderRegion(ctx, { x: cols[0]!.x, y: body.y, width: cols[0]!.width, height: body.height }, left, { topInset }));
  if (right) out.push(...renderRegion(ctx, { x: cols[1]!.x, y: body.y, width: cols[1]!.width, height: body.height }, right, { topInset }));

  return out;
};

export default split2;
