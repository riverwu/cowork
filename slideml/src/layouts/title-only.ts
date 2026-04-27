import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";

export const slots: Record<string, SlotSchema> = {
  title: { type: "text", maxChars: 80 },
};

const titleOnly: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const title = ctx.slot<string>("title") ?? "";
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  return [
    {
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(2), y: ctx.cm(5), cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(4) },
      valign: "middle",
      paragraphs: [{
        align: "center",
        runs: [{
          text: title,
          sizeHalfPt: 80,
          color: ctx.color("text-strong"),
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    },
  ];
};

export default titleOnly;
