import type { LayoutContext, LayoutFn } from "../../../render/layout-context.js";
import type { ShapeList } from "../../../emitter/types.js";
import type { SlotSchema } from "../../../theme/types.js";
import {
  card,
  contentRect,
  gridCols,
  imageOrPlaceholder,
  imageRefOf,
  slideTitle,
  textBlockOf,
} from "../../../render/primitives.js";

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
  const text = textBlockOf(ctx.slot<unknown>("text"));
  const image = imageRefOf(ctx.slot<unknown>("image"));
  const imageOnLeft = (ctx.slot<string>("imageSide") ?? "right").toLowerCase() === "left";
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  out.push(...slideTitle(ctx, title));

  const body = contentRect(ctx, { top: ctx.cm(4.4) });
  const [colA, colB] = gridCols(ctx, body, 2);
  const textCol = imageOnLeft ? colB! : colA!;
  const imageCol = imageOnLeft ? colA! : colB!;

  // Text block — split on blank lines into paragraphs.
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: textCol.x, y: textCol.y, cx: textCol.width, cy: textCol.height },
    valign: "top",
    paragraphs: (paras.length > 0 ? paras : [text]).map((p) => ({
      align: "left",
      lineSpacingHalfPt: 56,
      spaceAfterHalfPt: 24,
      runs: [{ text: p, sizeHalfPt: 28, color: ctx.color("text-strong"), cjk: ctx.cjk, fontFace }],
    })),
  });

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
