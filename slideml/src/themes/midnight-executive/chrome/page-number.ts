/**
 * `page-number` chrome — bottom-right "n / N" stamp in muted text color.
 */

import type { ChromeContext } from "../../../render/chrome.js";
import type { ShapeList } from "../../../emitter/types.js";

const pageNumber = (ctx: ChromeContext): ShapeList => [{
  type: "text",
  id: ctx.id(),
  xfrm: {
    x: ctx.deck.width - ctx.cm(3),
    y: ctx.deck.height - ctx.cm(0.9),
    cx: ctx.cm(2.6),
    cy: ctx.cm(0.6),
  },
  valign: "middle",
  paragraphs: [{
    align: "right",
    runs: [{
      text: `${ctx.slideIndex} / ${ctx.slideCount}`,
      sizeHalfPt: 18,
      color: ctx.color("text-muted"),
      fontFace: ctx.font("latin"),
    }],
  }],
}];

export default pageNumber;
