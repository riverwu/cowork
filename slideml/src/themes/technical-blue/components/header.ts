/**
 * `header` component — slide-top eyebrow + title block.
 *
 * Used internally by content layouts that want a consistent header. Returns
 * a fragment that callers can splice into their ShapeList. Components are
 * functions of `ctx`; the renderer hands them the slide's id pool so IDs
 * stay unique.
 */

import type { LayoutContext } from "../../../render/layout-context.js";
import type { ShapeList } from "../../../emitter/types.js";
import type { SlotSchema } from "../../../theme/types.js";

export const slots: Record<string, SlotSchema> = {
  eyebrow: { type: "text", maxChars: 20, optional: true },
  title:   { type: "text", maxChars: 60 },
};

const header = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title") ?? "";
  const eyebrow = ctx.slot<string>("eyebrow");
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  if (eyebrow) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(2), y: ctx.cm(1.0), cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(0.8) },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{
          text: eyebrow,
          sizeHalfPt: 22,
          color: ctx.color("brand-primary"),
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
  }

  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: ctx.cm(2), y: eyebrow ? ctx.cm(1.7) : ctx.cm(1.4), cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(1.6) },
    valign: "middle",
    paragraphs: [{
      align: "left",
      runs: [{
        text: title,
        sizeHalfPt: 44,
        color: ctx.color("text-strong"),
        bold: true,
        cjk: ctx.cjk,
        fontFace,
      }],
    }],
  });

  return out;
};

export default header;
