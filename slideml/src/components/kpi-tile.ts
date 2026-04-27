/**
 * `kpi-tile` component — single KPI card. Used by `stat-grid-3` and any
 * future layout that wants individually-placed KPI tiles.
 *
 * Components don't own absolute geometry — callers position them by passing
 * `x`, `y`, `cx`, `cy` slot values in EMU. (For the standard "in a grid"
 * case, layouts compose tiles directly.)
 */

import type { LayoutContext } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";

export const slots: Record<string, SlotSchema> = {
  value: { type: "text", maxChars: 8 },
  label: { type: "text", maxChars: 20 },
  delta: { type: "text", maxChars: 10, optional: true },
  trend: { type: "text", maxChars: 6,  optional: true },
};

interface Pos { x: number; y: number; cx: number; cy: number }

const kpiTile = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const value = ctx.slot<string>("value") ?? "—";
  const label = ctx.slot<string>("label") ?? "";
  const delta = ctx.slot<string>("delta");
  const trend = ctx.slot<string>("trend");
  const pos = ctx.slot<Pos>("__pos") ?? { x: ctx.cm(2), y: ctx.cm(2), cx: ctx.cm(8), cy: ctx.cm(6) };
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "roundRect",
    xfrm: pos,
    fill: { type: "solid", color: ctx.color("bg-card") },
    line: { color: ctx.color("divider"), width: ctx.pt(0.5) },
    cornerRadius: 0.04,
  });

  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: pos.x, y: pos.y + ctx.cm(1.0), cx: pos.cx, cy: ctx.cm(2.4) },
    valign: "middle",
    paragraphs: [{
      align: "center",
      runs: [{
        text: value,
        sizeHalfPt: 80,
        color: ctx.color("brand-primary"),
        bold: true,
        cjk: ctx.cjk,
        fontFace,
      }],
    }],
  });

  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: pos.x, y: pos.y + ctx.cm(3.6), cx: pos.cx, cy: ctx.cm(1.0) },
    valign: "middle",
    paragraphs: [{
      align: "center",
      runs: [{
        text: label,
        sizeHalfPt: 24,
        color: ctx.color("text-muted"),
        cjk: ctx.cjk,
        fontFace,
      }],
    }],
  });

  if (delta) {
    const trendColor = trend === "down" ? ctx.color("accent") : ctx.color("brand-primary");
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: pos.x, y: pos.y + ctx.cm(4.8), cx: pos.cx, cy: ctx.cm(0.9) },
      valign: "middle",
      paragraphs: [{
        align: "center",
        runs: [{
          text: delta,
          sizeHalfPt: 22,
          color: trendColor,
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
  }

  return out;
};

export default kpiTile;
