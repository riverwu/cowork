import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import {
  card,
  contentRect,
  gridCols,
  imageOrPlaceholder,
  imageRefOf,
  richText,
  slideTitle,
} from "../render/primitives.js";

export const slots: Record<string, SlotSchema> = {
  title:     { type: "text",       maxChars: 50 },
  text:      { type: "text-block", maxChars: 400 },
  image:     { type: "image-ref" },
  imageSide: { type: "text",       maxChars: 6, optional: true },
};

interface ImageSlot { src: string; alt?: string; fit?: "contain" | "cover" | "crop" }

const twoColTextImage: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title") ?? "";
  const image = imageRefOf(ctx.slot<unknown>("image"));
  const imageOnLeft = (ctx.slot<string>("imageSide") ?? "right").toLowerCase() === "left";

  out.push(...slideTitle(ctx, title));

  const body = contentRect(ctx, { top: ctx.cm(4.4) });
  const [colA, colB] = gridCols(ctx, body, 2);
  const textCol = imageOnLeft ? colB! : colA!;
  const imageCol = imageOnLeft ? colA! : colB!;

  out.push(...richText(ctx, textCol, ctx.slot<unknown>("text"), {
    sizeHalfPt: 28,
    spaceAfterHalfPt: 24,
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
