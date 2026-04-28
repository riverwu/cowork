import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import {
  bodyTopAfterTitle,
  bulletsBlock,
  contentRect,
  gridCols,
  imageOrPlaceholder,
  imageRefOf,
  slideTitle,
} from "../render/primitives.js";

export const slots: Record<string, SlotSchema> = {
  title:   { type: "text",       maxChars: 50, optional: true },
  bullets: { type: "bullets",    min: 3, max: 6, itemMaxChars: 80 },
  // Optional: when omitted, bullets expand to full slide width.
  image:   { type: "image-ref",  optional: true },
  // Bullets:image column-width ratio. Default 50-50.
  imageRatio: { type: "enum",    values: ["50-50", "60-40", "40-60", "67-33", "33-67"], default: "50-50", optional: true },
};

const IMAGE_RATIO_WEIGHTS: Record<string, [number, number]> = {
  "50-50": [1, 1],
  "60-40": [3, 2],
  "40-60": [2, 3],
  "67-33": [2, 1],
  "33-67": [1, 2],
};

interface ImageSlot { src: string; alt?: string }

const bulletWithImage: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const bullets = ctx.slot<string[]>("bullets") ?? [];
  const image = imageRefOf(ctx.slot<unknown>("image"));

  if (title) out.push(...slideTitle(ctx, title));

  // Body geometry collapses up when title is absent.
  const body = contentRect(ctx, { top: bodyTopAfterTitle(ctx, title) });
  const ratioKey = ctx.slot<string>("imageRatio") ?? "50-50";
  const weights = IMAGE_RATIO_WEIGHTS[ratioKey] ?? IMAGE_RATIO_WEIGHTS["50-50"]!;
  const cols = image && image.src
    ? gridCols(ctx, body, 2, { weights })
    : [body];                              // bullets fill the slide when no image

  out.push(...bulletsBlock(ctx, cols[0]!, bullets));

  if (cols.length === 2) {
    out.push(...imageOrPlaceholder(ctx, cols[1]!, image));
  }

  return out;
};

export default bulletWithImage;
