import type { LayoutContext, LayoutFn } from "../../../render/layout-context.js";
import type { ShapeList } from "../../../emitter/types.js";
import type { SlotSchema } from "../../../theme/types.js";
import { card, slideTitle } from "../../../render/primitives.js";

export const slots: Record<string, SlotSchema> = {
  title:  { type: "text",    maxChars: 50, optional: true },
  images: { type: "bullets", min: 2, max: 4, itemMaxChars: 64 },
};

interface ImageEntry { src: string; alt?: string; caption?: string; fit?: "contain" | "cover" }

const imageGrid2x2: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const items = ctx.slot<ImageEntry[]>("images") ?? [];
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  let bodyTop = ctx.cm(2);
  if (title) {
    out.push(...slideTitle(ctx, title));
    bodyTop = ctx.cm(3.4);
  }

  const gridLeft = ctx.cm(2);
  const gridWidth = ctx.deck.width - ctx.cm(4);
  const gridHeight = ctx.deck.height - bodyTop - ctx.cm(2);
  const gap = ctx.cm(0.4);
  const cellW = (gridWidth - gap) / 2;
  const cellH = (gridHeight - gap) / 2;

  for (let i = 0; i < Math.min(items.length, 4); i++) {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const x = gridLeft + col * (cellW + gap);
    const y = bodyTop + row * (cellH + gap);
    const item = items[i]!;
    if (typeof item === "object" && item.src) {
      out.push(...card(ctx, { x, y, width: cellW, height: cellH }, { cornerRadius: 0.02 }));
      out.push({
        type: "image",
        id: ctx.id(),
        xfrm: {
          x: x + ctx.cm(0.3),
          y: y + ctx.cm(0.3),
          cx: cellW - ctx.cm(0.6),
          cy: cellH - ctx.cm(item.caption ? 1.6 : 0.6),
        },
        src: item.src,
        altText: item.alt,
      });
      if (item.caption) {
        out.push({
          type: "text",
          id: ctx.id(),
          xfrm: { x: x + ctx.cm(0.3), y: y + cellH - ctx.cm(1.2), cx: cellW - ctx.cm(0.6), cy: ctx.cm(1) },
          valign: "middle",
          paragraphs: [{
            align: "center",
            runs: [{ text: item.caption, sizeHalfPt: 22, color: ctx.color("text-muted"), cjk: ctx.cjk, fontFace }],
          }],
        });
      }
    }
  }
  return out;
};

export default imageGrid2x2;
