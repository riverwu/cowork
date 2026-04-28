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
  title:     { type: "text",       maxChars: 60, optional: true },
  // Effective capacity comes from `density` (see two-col-text-image for the
  // budget table). DENSITY_OVERFLOW fires before this hard ceiling.
  text:      { type: "text-block", maxChars: 1500 },
  image:     { type: "image-ref" },
  imageSide: { type: "text",       maxChars: 6, optional: true },
  density:   { type: "enum",       values: ["loose", "normal", "dense", "micro"], default: "normal", optional: true },
};

const imageSplitText: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
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

  // Text column: padded. When title absent, text starts higher and gets more height.
  const pad = ctx.cm(1.6);
  let textY = ctx.cm(2.2);
  if (title) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: txtX + pad, y: textY, cx: halfW - pad * 2, cy: ctx.cm(2) },
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
    textY = ctx.cm(5.0);
  }
  out.push(...richText(ctx, {
    x: txtX + pad,
    y: textY,
    width: halfW - pad * 2,
    height: ctx.deck.height - textY - ctx.cm(2),
  }, text, {
    color: "text-strong",
    density: ctx.slot<string>("density"),
  }));

  return out;
};

export default imageSplitText;
