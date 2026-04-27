/**
 * `split-3-vertical` — title (optional), then a full-width top region
 * over a 50/50 bottom row. Use for "headline + supporting evidence"
 * patterns: e.g. one chart on top, KPI + commentary on the bottom row.
 *
 * Top : bottom heights are 50/50 of the body area by default.
 */

import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { contentRect, gridCols, slideTitle } from "../render/primitives.js";
import { renderRegion, type Region } from "../render/regions.js";

export const slots: Record<string, SlotSchema> = {
  title: { type: "text",   maxChars: 50, optional: true },
  top:   { type: "region" },
  bl:    { type: "region", optional: true },
  br:    { type: "region", optional: true },
};

const split3v: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");

  let bodyTop = ctx.cm(2);
  if (title) {
    out.push(...slideTitle(ctx, title));
    bodyTop = ctx.cm(4.4);
  }

  const body = contentRect(ctx, { top: bodyTop, bottom: ctx.cm(2) });
  const rowGap = ctx.cm(0.6);
  const rowH = (body.height - rowGap) / 2;

  const top = ctx.slot<Region>("top");
  if (top) {
    out.push(...renderRegion(ctx, { x: body.x, y: body.y, width: body.width, height: rowH }, top));
  }

  const bottomY = body.y + rowH + rowGap;
  const cols = gridCols(ctx, { x: body.x, y: bottomY, width: body.width, height: rowH }, 2, { gap: ctx.cm(0.6) });
  for (const [name, i] of [["bl", 0], ["br", 1]] as const) {
    const r = ctx.slot<Region>(name);
    if (!r) continue;
    out.push(...renderRegion(ctx, { x: cols[i]!.x, y: bottomY, width: cols[i]!.width, height: rowH }, r));
  }
  return out;
};

export default split3v;
