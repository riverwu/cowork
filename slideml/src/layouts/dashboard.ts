/**
 * `dashboard` — 2x2 grid where each cell hosts a polymorphic region
 * (one of 8 kinds: kpi/chart/table/text/bullets/image/code/quote).
 *
 * Use this when one slide must surface multiple kinds of content at
 * once (e.g. KPI + chart + table + text on a single executive view).
 * For single-purpose slides, prefer the focused layouts (stat-grid-3,
 * chart-with-takeaway, data-table). For 1×2 or 1×3 cell layouts use
 * `split-2` / `split-3-horizontal` / `split-3-vertical`.
 */

import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { contentRect, gridCols, slideTitle } from "../render/primitives.js";
import { renderRegion, type Region } from "../render/regions.js";

export const slots: Record<string, SlotSchema> = {
  title: { type: "text",   maxChars: 50, optional: true },
  tl:    { type: "region" },
  tr:    { type: "region", optional: true },
  bl:    { type: "region", optional: true },
  br:    { type: "region", optional: true },
};

const dashboard: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");

  let bodyTop = ctx.cm(2);
  if (title) {
    out.push(...slideTitle(ctx, title));
    bodyTop = ctx.cm(4.4);
  }

  const body = contentRect(ctx, { top: bodyTop, bottom: ctx.cm(2) });
  const cols = gridCols(ctx, body, 2, { gap: ctx.cm(0.6) });
  const rowGap = ctx.cm(0.6);
  const rowH = (body.height - rowGap) / 2;

  const positions = [
    { region: ctx.slot<Region>("tl"), x: cols[0]!.x, y: body.y,                 w: cols[0]!.width, h: rowH },
    { region: ctx.slot<Region>("tr"), x: cols[1]!.x, y: body.y,                 w: cols[1]!.width, h: rowH },
    { region: ctx.slot<Region>("bl"), x: cols[0]!.x, y: body.y + rowH + rowGap, w: cols[0]!.width, h: rowH },
    { region: ctx.slot<Region>("br"), x: cols[1]!.x, y: body.y + rowH + rowGap, w: cols[1]!.width, h: rowH },
  ];

  for (const p of positions) {
    if (!p.region) continue;
    out.push(...renderRegion(ctx, { x: p.x, y: p.y, width: p.w, height: p.h }, p.region));
  }
  return out;
};

export default dashboard;
