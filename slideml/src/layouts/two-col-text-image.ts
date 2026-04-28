import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import {
  bodyTopAfterTitle,
  card,
  contentRect,
  gridCols,
  imageOrPlaceholder,
  imageRefOf,
  richText,
  slideTitle,
} from "../render/primitives.js";

export const slots: Record<string, SlotSchema> = {
  title:     { type: "text",       maxChars: 50, optional: true },
  // Effective capacity comes from the `density` slot, NOT this maxChars
  // ceiling. Density budgets per half-slide column:
  //   loose   ≤ 110 CJK / 180 latin
  //   normal  ≤ 225 CJK / 360 latin (default)
  //   dense   ≤ 450 CJK / 720 latin
  //   micro   ≤ 750 CJK / 1200 latin
  // Validator emits DENSITY_OVERFLOW with concrete next-step suggestions
  // when content exceeds the declared density's budget.
  text:      { type: "text-block", maxChars: 1500 },
  image:     { type: "image-ref" },
  imageSide: { type: "text",       maxChars: 6, optional: true },
  density:   { type: "enum",       values: ["loose", "normal", "dense", "micro"], default: "normal", optional: true },
  // Text:image column-width ratio. Default 50-50. Use 60-40 for text-heavy
  // slides, 40-60 to give image more space.
  imageRatio: { type: "enum",      values: ["50-50", "60-40", "40-60", "67-33", "33-67"], default: "50-50", optional: true },
};

const IMAGE_RATIO_WEIGHTS: Record<string, [number, number]> = {
  "50-50": [1, 1],
  "60-40": [3, 2],   // text 60, image 40
  "40-60": [2, 3],   // text 40, image 60
  "67-33": [2, 1],
  "33-67": [1, 2],
};

interface ImageSlot { src: string; alt?: string; fit?: "contain" | "cover" | "crop" }

const twoColTextImage: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const image = imageRefOf(ctx.slot<unknown>("image"));
  const imageOnLeft = (ctx.slot<string>("imageSide") ?? "right").toLowerCase() === "left";

  if (title) out.push(...slideTitle(ctx, title));

  const body = contentRect(ctx, { top: bodyTopAfterTitle(ctx, title) });
  // Per imageRatio. Weights are [text, image] in left-to-right column
  // order; flip when imageOnLeft.
  const ratioKey = ctx.slot<string>("imageRatio") ?? "50-50";
  const [textW, imageW] = IMAGE_RATIO_WEIGHTS[ratioKey] ?? IMAGE_RATIO_WEIGHTS["50-50"]!;
  const colWeights: [number, number] = imageOnLeft ? [imageW, textW] : [textW, imageW];
  const [colA, colB] = gridCols(ctx, body, 2, { weights: colWeights });
  const textCol = imageOnLeft ? colB! : colA!;
  const imageCol = imageOnLeft ? colA! : colB!;

  out.push(...richText(ctx, textCol, ctx.slot<unknown>("text"), {
    density: ctx.slot<string>("density"),
  }));

  // Image on a card (insets keep the image off the card border).
  out.push(...card(ctx, imageCol));
  out.push(...imageOrPlaceholder(ctx, {
    x: imageCol.x + ctx.cm(0.4),
    y: imageCol.y + ctx.cm(0.4),
    width: imageCol.width - ctx.cm(0.8),
    height: imageCol.height - ctx.cm(0.8),
  }, image));

  return out;
};

export default twoColTextImage;
