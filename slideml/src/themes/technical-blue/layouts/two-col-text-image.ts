import type { LayoutContext, LayoutFn } from "../../../render/layout-context.js";
import type { ShapeList } from "../../../emitter/types.js";
import type { SlotSchema } from "../../../theme/types.js";

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
  const text = ctx.slot<string>("text") ?? "";
  const image = ctx.slot<ImageSlot>("image");
  const imageSide = (ctx.slot<string>("imageSide") ?? "right").toLowerCase();
  const imageOnLeft = imageSide === "left";
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  // Title across the top.
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: ctx.cm(2), y: ctx.cm(1.4), cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(1.6) },
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

  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: { x: ctx.cm(2), y: ctx.cm(3.2), cx: ctx.cm(2.4), cy: ctx.cm(0.12) },
    fill: { type: "solid", color: ctx.color("brand-primary") },
  });

  const colTop = ctx.cm(4.4);
  const colHeight = ctx.deck.height - colTop - ctx.cm(2);
  const colA = ctx.gridCol(0, 2, { gap: ctx.cm(1.2), marginX: ctx.cm(2) });
  const colB = ctx.gridCol(1, 2, { gap: ctx.cm(1.2), marginX: ctx.cm(2) });
  const textCol = imageOnLeft ? colB : colA;
  const imageCol = imageOnLeft ? colA : colB;

  // Text block — split on blank lines into paragraphs.
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: textCol.x, y: colTop, cx: textCol.width, cy: colHeight },
    valign: "top",
    paragraphs: (paras.length > 0 ? paras : [text]).map((p) => ({
      align: "left",
      lineSpacingHalfPt: 56,
      spaceAfterHalfPt: 24,
      runs: [{
        text: p,
        sizeHalfPt: 28,
        color: ctx.color("text-strong"),
        cjk: ctx.cjk,
        fontFace,
      }],
    })),
  });

  // Image card.
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "roundRect",
    xfrm: { x: imageCol.x, y: colTop, cx: imageCol.width, cy: colHeight },
    fill: { type: "solid", color: ctx.color("bg-card") },
    line: { color: ctx.color("divider"), width: ctx.pt(0.5) },
    cornerRadius: 0.03,
  });
  if (image && image.src) {
    out.push({
      type: "image",
      id: ctx.id(),
      xfrm: {
        x: imageCol.x + ctx.cm(0.4),
        y: colTop + ctx.cm(0.4),
        cx: imageCol.width - ctx.cm(0.8),
        cy: colHeight - ctx.cm(0.8),
      },
      src: image.src,
      altText: image.alt,
    });
  }

  return out;
};

export default twoColTextImage;
