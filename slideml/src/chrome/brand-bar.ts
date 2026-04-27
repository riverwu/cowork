/**
 * `brand-bar` chrome — thin coloured rule along the bottom edge of every
 * slide. Per-slide overrides: `{ color, height }` where `color` is either
 * a hex string or a theme token name and `height` is a cm fraction.
 */

import type { ChromeContext } from "../render/chrome.js";
import type { ShapeList } from "../emitter/types.js";

const brandBar = (ctx: ChromeContext): ShapeList => {
  const o = ctx.overrides as { color?: unknown; height?: unknown };
  const colorRaw = typeof o.color === "string" ? o.color : "brand-primary";
  const color = /^[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : ctx.color(colorRaw);
  const heightCm = typeof o.height === "number" ? o.height : 0.18;
  return [{
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: {
      x: 0,
      y: ctx.deck.height - ctx.cm(heightCm),
      cx: ctx.deck.width,
      cy: ctx.cm(heightCm),
    },
    fill: { type: "solid", color },
  }];
};

export default brandBar;
