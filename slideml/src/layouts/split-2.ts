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
import { renderRegion, type Region } from "../render/regions.js";

export const slots: Record<string, SlotSchema> = {
  title: { type: "text",   maxChars: 50, optional: true },
  left:  { type: "region" },
  right: { type: "region" },
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
  const cols = gridCols(ctx, body, 2, { gap: ctx.cm(0.6) });

  if (left)  out.push(...renderRegion(ctx, { x: cols[0]!.x, y: body.y, width: cols[0]!.width, height: body.height }, left));
  if (right) out.push(...renderRegion(ctx, { x: cols[1]!.x, y: body.y, width: cols[1]!.width, height: body.height }, right));

  return out;
};

export default split2;
