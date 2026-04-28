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
import { computeRegionTopInset, renderRegion, type Region } from "../render/regions.js";

export const slots: Record<string, SlotSchema> = {
  title:  { type: "text",   maxChars: 50, optional: true },
  left:   { type: "region" },
  center: { type: "region" },
  right:  { type: "region" },
  // Column-width ratio. Default equal. Other values dedicate more space
  // to one column: wide-center = 25/50/25, wide-left = 50/25/25, etc.
  ratio: {
    type: "enum",
    values: ["equal", "wide-center", "wide-left", "wide-right"],
    default: "equal",
    optional: true,
  },
};

const RATIO_WEIGHTS_3: Record<string, [number, number, number]> = {
  "equal":       [1, 1, 1],
  "wide-center": [1, 2, 1],
  "wide-left":   [2, 1, 1],
  "wide-right":  [1, 1, 2],
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
  const ratioKey = ctx.slot<string>("ratio") ?? "equal";
  const weights = RATIO_WEIGHTS_3[ratioKey] ?? RATIO_WEIGHTS_3["equal"];
  const cols = gridCols(ctx, body, 3, { gap: ctx.cm(0.5), weights });
  const slotsArr: Array<["left" | "center" | "right", number]> = [["left", 0], ["center", 1], ["right", 2]];
  const cells = slotsArr.map(([name]) => ctx.slot<Region>(name));
  const topInset = computeRegionTopInset(ctx, cells);
  for (const [name, i] of slotsArr) {
    const r = ctx.slot<Region>(name);
    if (!r) continue;
    out.push(...renderRegion(ctx, { x: cols[i]!.x, y: body.y, width: cols[i]!.width, height: body.height }, r, { topInset }));
  }
  return out;
};

export default split3h;
