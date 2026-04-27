/**
 * `split-3-horizontal` — title (optional) over three equal columns,
 * each hosting a polymorphic region. Use when comparing/sequencing
 * three items of the same kind (e.g. three KPIs with different cell
 * types, three image+caption tiles, three text blurbs).
 */

import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { contentRect, gridCols, slideTitle } from "../render/primitives.js";
import { renderRegion, type Region } from "../render/regions.js";

export const slots: Record<string, SlotSchema> = {
  title:  { type: "text",   maxChars: 50, optional: true },
  left:   { type: "region" },
  center: { type: "region" },
  right:  { type: "region" },
};

const split3h: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");

  let bodyTop = ctx.cm(2);
  if (title) {
    out.push(...slideTitle(ctx, title));
    bodyTop = ctx.cm(4.4);
  }

  const body = contentRect(ctx, { top: bodyTop, bottom: ctx.cm(2) });
  const cols = gridCols(ctx, body, 3, { gap: ctx.cm(0.5) });
  const slotsArr: Array<["left" | "center" | "right", number]> = [["left", 0], ["center", 1], ["right", 2]];
  for (const [name, i] of slotsArr) {
    const r = ctx.slot<Region>(name);
    if (!r) continue;
    out.push(...renderRegion(ctx, { x: cols[i]!.x, y: body.y, width: cols[i]!.width, height: body.height }, r));
  }
  return out;
};

export default split3h;
