/**
 * `hairline` chrome — restrained alternative to `brand-bar`. Draws a
 * thin divider rule along an edge. Defaults to a 1-px-equivalent line
 * along the bottom edge in the theme's `divider` colour.
 *
 * Overrides:
 *   { color, position: "top"|"bottom", insetCm, weight }
 */

import type { ChromeContext } from "../render/chrome.js";
import type { ShapeList } from "../emitter/types.js";

const hairline = (ctx: ChromeContext): ShapeList => {
  const o = ctx.overrides as { color?: unknown; position?: unknown; insetCm?: unknown; weight?: unknown };
  const colorRaw = typeof o.color === "string" ? o.color : "divider";
  const color = /^[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : ctx.color(colorRaw);
  const position = o.position === "top" ? "top" : "bottom";
  const insetCm = typeof o.insetCm === "number" ? o.insetCm : 0.6;
  const weight = typeof o.weight === "number" ? o.weight : 0.02;
  const y = position === "top"
    ? ctx.cm(insetCm)
    : ctx.deck.height - ctx.cm(insetCm) - ctx.cm(weight);
  return [{
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: {
      x: ctx.cm(2),
      y,
      cx: ctx.deck.width - ctx.cm(4),
      cy: ctx.cm(weight),
    },
    fill: { type: "solid", color },
  }];
};

export default hairline;
