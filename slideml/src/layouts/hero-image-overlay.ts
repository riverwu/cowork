import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { imageRefOf } from "../render/primitives.js";

export const slots: Record<string, SlotSchema> = {
  image:    { type: "image-ref" },
  title:    { type: "text", maxChars: 42 },
  subtitle: { type: "text", maxChars: 70, optional: true },
  /** Position of the text overlay. Default `bottom-left`. */
  align:    { type: "text", maxChars: 16, optional: true },
};

interface ImageSlot { src: string; alt?: string }

const heroImageOverlay: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const image = imageRefOf(ctx.slot<unknown>("image"));
  const title = ctx.slot<string>("title") ?? "";
  const subtitle = ctx.slot<string>("subtitle");
  const align = (ctx.slot<string>("align") ?? "bottom-left").toLowerCase();
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  // Full-bleed image (or a card backing if no src).
  if (image && image.src) {
    out.push({
      type: "image",
      id: ctx.id(),
      xfrm: { x: 0, y: 0, cx: ctx.deck.width, cy: ctx.deck.height },
      src: image.src,
      altText: image.alt,
    });
  } else {
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: 0, y: 0, cx: ctx.deck.width, cy: ctx.deck.height },
      fill: { type: "solid", color: ctx.color("brand-deep") },
    });
  }

  // Dark overlay band behind the text for legibility.
  const isBottom = align.startsWith("bottom");
  const isCenter = align.includes("center");
  const overlayHeight = ctx.cm(3.6);
  const overlayY = isBottom ? ctx.deck.height - overlayHeight : isCenter ? ctx.centerV(overlayHeight) : 0;
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: { x: 0, y: overlayY, cx: ctx.deck.width, cy: overlayHeight },
    fill: { type: "solid", color: "000000", alpha: 0.55 },
  });

  // Title + subtitle inside the overlay.
  const textAlign = align.endsWith("right") ? "right" : align.endsWith("center") ? "center" : "left";
  const textXLeft = ctx.cm(2);
  const textWidth = ctx.deck.width - ctx.cm(4);

  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: textXLeft, y: overlayY + ctx.cm(0.6), cx: textWidth, cy: ctx.cm(1.6) },
    valign: "middle",
    autoFit: "shrink",
    paragraphs: [{
      align: textAlign,
      runs: [{
        text: title,
        sizeHalfPt: 56,
        color: "FFFFFF",
        bold: true,
        cjk: ctx.cjk,
        fontFace,
      }],
    }],
  });
  if (subtitle) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: textXLeft, y: overlayY + ctx.cm(2.2), cx: textWidth, cy: ctx.cm(1.0) },
      valign: "middle",
      autoFit: "shrink",
      paragraphs: [{
        align: textAlign,
        runs: [{
          text: subtitle,
          sizeHalfPt: 26,
          color: "E2E8F0",
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
  }

  return out;
};

export default heroImageOverlay;
