/**
 * `footer` component — bottom byline (date / context). Distinct from the
 * `page-number` chrome decoration.
 */

import type { LayoutContext } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";

export const slots: Record<string, SlotSchema> = {
  text: { type: "text", maxChars: 40 },
};

const footer = (ctx: LayoutContext): ShapeList => {
  const text = ctx.slot<string>("text") ?? "";
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  return [{
    type: "text",
    id: ctx.id(),
    xfrm: {
      x: ctx.cm(2),
      y: ctx.deck.height - ctx.cm(1.2),
      cx: ctx.deck.width - ctx.cm(4),
      cy: ctx.cm(0.8),
    },
    valign: "middle",
    paragraphs: [{
      align: "left",
      runs: [{
        text,
        sizeHalfPt: 18,
        color: ctx.color("text-muted"),
        cjk: ctx.cjk,
        fontFace,
      }],
    }],
  }];
};

export default footer;
