import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { imageOrPlaceholder, imageRefOf } from "../render/primitives.js";

/**
 * Image fills the entire slide. Optional `caption` is rendered on top
 * inside a small dark band along the bottom edge — useful for credit
 * lines / location stamps. No title slot; if you need title text use
 * `hero-image-overlay`.
 */
export const slots: Record<string, SlotSchema> = {
  image:   { type: "image-ref" },
  caption: { type: "text",      maxChars: 84, optional: true },
};

const imageFullBleed: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const image = imageRefOf(ctx.slot<unknown>("image"));
  const caption = ctx.slot<string>("caption");
  out.push(...imageOrPlaceholder(ctx, {
    x: 0, y: 0, width: ctx.deck.width, height: ctx.deck.height,
  }, image));
  if (caption) {
    const bandH = ctx.cm(0.9);
    const bandY = ctx.deck.height - bandH;
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: 0, y: bandY, cx: ctx.deck.width, cy: bandH },
      fill: { type: "solid", color: "000000", alpha: 0.55 },
    });
    const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(1.2), y: bandY, cx: ctx.deck.width - ctx.cm(2.4), cy: bandH },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{
          text: caption,
          sizeHalfPt: 18,
          color: "FFFFFF",
          italic: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
  }
  return out;
};

export default imageFullBleed;
