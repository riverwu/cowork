import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { imageOrPlaceholder, imageRefOf, richText } from "../render/primitives.js";

/**
 * Immersive 50/50 split: image is full-bleed on its half (no card,
 * touches slide edges), text fills the other half with generous margins.
 * Use when `two-col-text-image` feels too contained.
 */
export const slots: Record<string, SlotSchema> = {
  title:     { type: "text",       maxChars: 60 },
  text:      { type: "text-block", maxChars: 480 },
  image:     { type: "image-ref" },
  imageSide: { type: "text",       maxChars: 6, optional: true },
};

const imageSplitText: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title") ?? "";
  const text = ctx.slot<unknown>("text");
  const image = imageRefOf(ctx.slot<unknown>("image"));
  const imageOnLeft = (ctx.slot<string>("imageSide") ?? "right").toLowerCase() === "left";
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  const halfW = Math.floor(ctx.deck.width / 2);
  const imgX = imageOnLeft ? 0 : halfW;
  const txtX = imageOnLeft ? halfW : 0;

  // Image: edge-to-edge on its half.
  out.push(...imageOrPlaceholder(ctx, {
    x: imgX, y: 0, width: halfW, height: ctx.deck.height,
  }, image));

  // Text column: padded, vertically centred.
  const pad = ctx.cm(1.6);
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: txtX + pad, y: ctx.cm(2.2), cx: halfW - pad * 2, cy: ctx.cm(2) },
    valign: "top",
    paragraphs: [{
      align: "left",
      runs: [{
        text: title,
        sizeHalfPt: 48,
        color: ctx.color("text-strong"),
        bold: true,
        cjk: ctx.cjk,
        fontFace,
      }],
    }],
  });
  out.push(...richText(ctx, {
    x: txtX + pad,
    y: ctx.cm(5.0),
    width: halfW - pad * 2,
    height: ctx.deck.height - ctx.cm(7),
  }, text, {
    sizeHalfPt: 24,
    color: "text-strong",
    lineSpacingHalfPt: 52,
    spaceAfterHalfPt: 24,
  }));

  return out;
};

export default imageSplitText;
