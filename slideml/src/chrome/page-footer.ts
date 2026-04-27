/**
 * `page-footer` chrome — thin band at the bottom of the slide.
 *
 * Renders nothing when no footer content is provided. Sits just above the
 * brand-bar / page-number chrome. Three slots: left (typical: copyright /
 * confidentiality marker), center, right (typical: section name).
 *
 * The page-number chrome already renders "n / N" at the bottom-right; the
 * footer respects that by reserving the right slot for callers that want
 * to override it (page-number renders LATER and sits on top).
 */

import type { ChromeContext } from "../render/chrome.js";
import type { ShapeList } from "../emitter/types.js";

const pageFooter = (ctx: ChromeContext): ShapeList => {
  const { left, center, right } = ctx.footer;
  if (!left && !center && !right) return [];

  const out: ShapeList = [];
  const fontFace = ctx.font("latin");

  const margin = ctx.cm(1.0);
  const bandH = ctx.cm(0.6);
  const bandY = ctx.deck.height - bandH - ctx.cm(0.4);
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
          sizeHalfPt: 16,
          color: ctx.color("text-muted"),
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
  }

  return out;
};

export default pageFooter;
