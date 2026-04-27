/**
 * `page-header` chrome — thin band at the top of the slide.
 *
 * Renders nothing when no header content is provided (deck.header /
 * slide.header both empty). Layouts that want to reserve room for the
 * header can read it from ChromeContext (future); v1 simply paints over
 * y=0..cm(0.9) with muted text and a hairline divider — most content
 * layouts already start at y=cm(1.4) so the band sits in their margin.
 */

import type { ChromeContext } from "../../../render/chrome.js";
import type { ShapeList } from "../../../emitter/types.js";

const pageHeader = (ctx: ChromeContext): ShapeList => {
  const { left, center, right } = ctx.header;
  if (!left && !center && !right) return [];

  const out: ShapeList = [];
  const fontFace = ctx.font("latin");

  // Three text slots split horizontally — left/center/right thirds.
  const margin = ctx.cm(1.0);
  const bandY = ctx.cm(0.18);
  const bandH = ctx.cm(0.7);
  const usable = ctx.deck.width - margin * 2;
  const slot = usable / 3;

  const slots: Array<{ text: string | undefined; align: "left" | "center" | "right"; x: number; w: number }> = [
    { text: left,   align: "left",   x: margin,                w: slot },
    { text: center, align: "center", x: margin + slot,         w: slot },
    { text: right,  align: "right",  x: margin + slot * 2,     w: slot },
  ];

  for (const s of slots) {
    if (!s.text) continue;
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: s.x, y: bandY, cx: s.w, cy: bandH },
      valign: "middle",
      paragraphs: [{
        align: s.align,
        runs: [{
          text: s.text,
          sizeHalfPt: 18,
          color: ctx.color("text-muted"),
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
  }

  // Hairline rule below the band.
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: { x: margin, y: bandY + bandH + ctx.cm(0.05), cx: usable, cy: ctx.cm(0.04) },
    fill: { type: "solid", color: ctx.color("divider") },
  });

  return out;
};

export default pageHeader;
