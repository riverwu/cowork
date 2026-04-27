/**
 * `progress-bar` chrome — top thin bar showing the current slide as a
 * fraction of the deck. Useful for talks where the audience can't see
 * the page-number widget.
 *
 * Overrides: `{ color: "<token-or-hex>", track: "<token-or-hex>", height: cm }`.
 */

import type { ChromeContext } from "../render/chrome.js";
import type { ShapeList } from "../emitter/types.js";

const progressBar = (ctx: ChromeContext): ShapeList => {
  const o = ctx.overrides as { color?: unknown; track?: unknown; height?: unknown };
  const colorRaw = typeof o.color === "string" ? o.color : "brand-primary";
  const trackRaw = typeof o.track === "string" ? o.track : "divider";
  const fillColor  = /^[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : ctx.color(colorRaw);
  const trackColor = /^[0-9A-Fa-f]{6}$/.test(trackRaw) ? trackRaw : ctx.color(trackRaw);
  const heightCm = typeof o.height === "number" ? o.height : 0.10;
  const fraction = ctx.slideCount > 0 ? ctx.slideIndex / ctx.slideCount : 0;
  const barW = Math.round(ctx.deck.width * fraction);
  return [
    {
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: 0, y: 0, cx: ctx.deck.width, cy: ctx.cm(heightCm) },
      fill: { type: "solid", color: trackColor },
    },
    {
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: 0, y: 0, cx: barW, cy: ctx.cm(heightCm) },
      fill: { type: "solid", color: fillColor },
    },
  ];
};

export default progressBar;
