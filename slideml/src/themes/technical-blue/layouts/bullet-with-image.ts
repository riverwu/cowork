import type { LayoutContext, LayoutFn } from "../../../render/layout-context.js";
import type { ShapeList } from "../../../emitter/types.js";
import type { SlotSchema } from "../../../theme/types.js";

export const slots: Record<string, SlotSchema> = {
  title:   { type: "text",       maxChars: 50 },
  bullets: { type: "bullets",    min: 3, max: 6, itemMaxChars: 80 },
  // Optional: when omitted, bullets expand to full slide width. Real-LLM
  // testing showed agents frequently forget the image slot even when it's
  // required; making it optional avoids forcing a retry just to add a
  // placeholder.
  image:   { type: "image-ref",  optional: true },
};

interface ImageSlot { src: string; alt?: string; fit?: "contain" | "cover" | "crop" }

const bulletWithImage: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title") ?? "";
  const bullets = ctx.slot<string[]>("bullets") ?? [];
  const image = ctx.slot<ImageSlot>("image");
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  // Title.
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

  // Cyan rule.
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: { x: ctx.cm(2), y: ctx.cm(3.2), cx: ctx.cm(2.4), cy: ctx.cm(0.12) },
    fill: { type: "solid", color: ctx.color("brand-primary") },
  });

  // Two columns when image is present; full-width bullets when not.
  const hasImage = !!(image && image.src);
  const left = hasImage
    ? ctx.gridCol(0, 2, { gap: ctx.cm(1.2), marginX: ctx.cm(2) })
    : { x: ctx.cm(2), width: ctx.deck.width - ctx.cm(4) };
  const right = ctx.gridCol(1, 2, { gap: ctx.cm(1.2), marginX: ctx.cm(2) });
  const colTop = ctx.cm(4.4);
  const colHeight = ctx.deck.height - colTop - ctx.cm(2);

  // Bullets.
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: left.x, y: colTop, cx: left.width, cy: colHeight },
    valign: "top",
    paragraphs: bullets.map((b) => ({
      align: "left",
      bullet: { auto: true } as const,
      lineSpacingHalfPt: 56,
      spaceAfterHalfPt: 16,
      runs: [{
        text: String(b),
        sizeHalfPt: 28,
        color: ctx.color("text-strong"),
        cjk: ctx.cjk,
        fontFace,
      }],
    })),
  });

  if (hasImage) {
    // Image card backing.
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "roundRect",
      xfrm: { x: right.x, y: colTop, cx: right.width, cy: colHeight },
      fill: { type: "solid", color: ctx.color("bg-card") },
      line: { color: ctx.color("divider"), width: ctx.pt(0.5) },
      cornerRadius: 0.03,
    });
    out.push({
      type: "image",
      id: ctx.id(),
      xfrm: {
        x: right.x + ctx.cm(0.4),
        y: colTop + ctx.cm(0.4),
        cx: right.width - ctx.cm(0.8),
        cy: colHeight - ctx.cm(0.8),
      },
      src: image!.src,
      altText: image!.alt,
    });
  }

  return out;
};

export default bulletWithImage;
