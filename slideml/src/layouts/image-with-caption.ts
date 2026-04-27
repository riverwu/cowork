import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { imageOrPlaceholder, imageRefOf, richText } from "../render/primitives.js";

/**
 * Editorial / documentary layout: centred image with an asymmetric
 * left margin, an italic caption below, and optional credit line.
 * The composition is deliberately off-centre — magazines never centre
 * everything.
 */
export const slots: Record<string, SlotSchema> = {
  image:   { type: "image-ref" },
  caption: { type: "text-block", maxChars: 320 },
  credit:  { type: "text",       maxChars: 80, optional: true },
};

const imageWithCaption: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const image = imageRefOf(ctx.slot<unknown>("image"));
  const caption = ctx.slot<unknown>("caption");
  const credit = ctx.slot<string>("credit");
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  // Image: 60% width, anchored top-left with generous left margin.
  const imgX = ctx.cm(2.4);
  const imgW = Math.floor(ctx.deck.width * 0.62);
  const imgY = ctx.cm(1.8);
  const imgH = Math.floor(ctx.deck.height * 0.58);
  out.push(...imageOrPlaceholder(ctx, { x: imgX, y: imgY, width: imgW, height: imgH }, image));

  // Caption sits below image, indented under it.
  const captionY = imgY + imgH + ctx.cm(0.5);
  out.push(...richText(ctx, {
    x: imgX,
    y: captionY,
    width: imgW,
    height: ctx.cm(2.6),
  }, caption, {
    sizeHalfPt: 22,
    italic: true,
    color: "text-strong",
    lineSpacingHalfPt: 50,
  }));

  if (credit) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: imgX, y: ctx.deck.height - ctx.cm(1.6), cx: imgW, cy: ctx.cm(0.7) },
      valign: "top",
      paragraphs: [{
        align: "left",
        runs: [{
          text: credit.toUpperCase(),
          sizeHalfPt: 14,
          color: ctx.color("text-muted"),
          fontFace,
          cjk: ctx.cjk,
        }],
      }],
    });
  }

  return out;
};

export default imageWithCaption;
