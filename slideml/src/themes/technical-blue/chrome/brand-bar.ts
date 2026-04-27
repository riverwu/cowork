/**
 * `brand-bar` chrome — thin cyan rule along the bottom edge of every slide.
 */

import type { ChromeContext } from "../../../render/chrome.js";
import type { ShapeList } from "../../../emitter/types.js";

const brandBar = (ctx: ChromeContext): ShapeList => [{
  type: "shape",
  id: ctx.id(),
  preset: "rect",
  xfrm: {
    x: 0,
    y: ctx.deck.height - ctx.cm(0.18),
    cx: ctx.deck.width,
    cy: ctx.cm(0.18),
  },
  fill: { type: "solid", color: ctx.color("brand-primary") },
}];

export default brandBar;
