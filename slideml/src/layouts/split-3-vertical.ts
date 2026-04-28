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
import { computeRegionTopInset, renderRegion, type Region } from "../render/regions.js";

export const slots: Record<string, SlotSchema> = {
  title: { type: "text",   maxChars: 50, optional: true },
  top:   { type: "region" },
  bl:    { type: "region", optional: true },
  br:    { type: "region", optional: true },
  // Top:bottom row height ratio. Default 50-50.
  ratio: {
    type: "enum",
    values: ["50-50", "60-40", "40-60", "67-33", "33-67"],
    default: "50-50",
    optional: true,
  },
};

const RATIO_TOP_BOTTOM: Record<string, [number, number]> = {
  "50-50": [1, 1],
  "60-40": [6, 4],
  "40-60": [4, 6],
  "67-33": [2, 1],
  "33-67": [1, 2],
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
  const ratioKey = ctx.slot<string>("ratio") ?? "50-50";
  const [topW, botW] = RATIO_TOP_BOTTOM[ratioKey] ?? RATIO_TOP_BOTTOM["50-50"]!;
  const usableH = body.height - rowGap;
  const topH = Math.floor((usableH * topW) / (topW + botW));
  const rowH = topH;
  const botH = usableH - topH;

  const top = ctx.slot<Region>("top");
  // Top region renders alone — no sibling to align with, so topInset is 0.
  if (top) {
    out.push(...renderRegion(ctx, { x: body.x, y: body.y, width: body.width, height: rowH }, top));
  }

  const bottomY = body.y + rowH + rowGap;
  const cols = gridCols(ctx, { x: body.x, y: bottomY, width: body.width, height: botH }, 2, { gap: ctx.cm(0.6) });
  // Bottom row: sibling cells share a topInset for baseline alignment.
  const bl = ctx.slot<Region>("bl");
  const br = ctx.slot<Region>("br");
  const bottomTopInset = computeRegionTopInset(ctx, [bl, br]);
  for (const [name, i] of [["bl", 0], ["br", 1]] as const) {
    const r = ctx.slot<Region>(name);
    if (!r) continue;
    out.push(...renderRegion(ctx, { x: cols[i]!.x, y: bottomY, width: cols[i]!.width, height: botH }, r, { topInset: bottomTopInset }));
  }
  return out;
};

export default split3v;
