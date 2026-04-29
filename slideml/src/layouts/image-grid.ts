import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { card, imageOrPlaceholder, imageRefOf, slideTitle } from "../render/primitives.js";

/**
 * Gallery of N images. Replaces the older image-pair (1×2) and
 * image-grid-2x2 (2×2) layouts — pick `count: 2 | 4` (default 2 when
 * 2 images supplied, 4 otherwise).
 *
 * Item shape per image: `{ src, alt?, caption? }` (or bare path string,
 * coerced via imageRefOf). For 2-up the caption renders as a small
 * uppercase label band above the image (before/after style). For 4-up
 * captions render below each tile inside the card backing.
 */
export const slots: Record<string, SlotSchema> = {
  title:  { type: "text",    maxChars: 35, optional: true },
  // 2-4 image entries. Each `{ src, alt?, caption? }` or bare path.
  images: { type: "bullets", min: 2, max: 4, itemMaxChars: 140 },
};

interface ImageEntry { src?: string; alt?: string; caption?: string; label?: string }

function captionOf(raw: unknown, fallbackAlt?: string): string | undefined {
  if (typeof raw === "object" && raw !== null) {
    const o = raw as { caption?: unknown; label?: unknown; alt?: unknown };
    const c = (typeof o.caption === "string" && o.caption) ||
              (typeof o.label === "string" && o.label) ||
              (typeof o.alt === "string" && o.alt) ||
              fallbackAlt;
    return typeof c === "string" && c.length > 0 ? c : undefined;
  }
  return fallbackAlt;
}

const imageGrid: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const items = (ctx.slot<ImageEntry[]>("images") ?? []).slice(0, 4);
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  if (title) out.push(...slideTitle(ctx, title));

  const count = items.length === 2 ? 2 : Math.min(items.length, 4);
  const cols = count <= 2 ? 2 : 2;
  const rows = count <= 2 ? 1 : 2;

  if (count === 2) {
    // Side-by-side gallery (former image-pair). Tiny uppercase label
    // along the top of each image; image fills the rest of the cell.
    const top = title ? ctx.cm(4.4) : ctx.cm(1.4);
    const sideMargin = ctx.cm(1.4);
    const gap = ctx.cm(0.4);
    const anyLabel = items.some((it) => captionOf(it));
    const labelH = anyLabel ? ctx.cm(0.9) : 0;
    const innerY = top + labelH;
    const innerH = ctx.deck.height - innerY - ctx.cm(1.4);
    const colW = Math.floor((ctx.deck.width - sideMargin * 2 - gap) / 2);
    items.forEach((raw, i) => {
      const x = sideMargin + i * (colW + gap);
      const ref = imageRefOf(raw);
      const caption = captionOf(raw, ref?.alt);
      if (caption) {
        out.push({
          type: "text",
          id: ctx.id(),
          xfrm: { x, y: top, cx: colW, cy: labelH },
          valign: "middle",
          autoFit: "shrink",
          paragraphs: [{
            align: "center",
            runs: [{ text: caption.toUpperCase(), sizeHalfPt: 18, color: ctx.color("brand-primary"), bold: true, cjk: ctx.cjk, fontFace }],
          }],
        });
      }
      out.push(...imageOrPlaceholder(ctx, { x, y: innerY, width: colW, height: innerH }, ref));
    });
    return out;
  }

  // 4-up grid (former image-grid-2x2). Each tile gets a card backing
  // and an optional bottom caption inside the card.
  const bodyTop = title ? ctx.cm(3.4) : ctx.cm(2);
  const gridLeft = ctx.cm(2);
  const gridWidth = ctx.deck.width - ctx.cm(4);
  const gridHeight = ctx.deck.height - bodyTop - ctx.cm(2);
  const gap = ctx.cm(0.4);
  const cellW = (gridWidth - gap) / cols;
  const cellH = (gridHeight - gap) / rows;
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = gridLeft + col * (cellW + gap);
    const y = bodyTop + row * (cellH + gap);
    const raw = items[i]!;
    const ref = imageRefOf(raw);
    if (!ref) continue;
    const caption = captionOf(raw, ref.alt);
    out.push(...card(ctx, { x, y, width: cellW, height: cellH }, { cornerRadius: 0.02 }));
    out.push(...imageOrPlaceholder(ctx, {
      x: x + ctx.cm(0.3),
      y: y + ctx.cm(0.3),
      width: cellW - ctx.cm(0.6),
      height: cellH - ctx.cm(caption ? 1.6 : 0.6),
    }, ref));
    if (caption) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: x + ctx.cm(0.3), y: y + cellH - ctx.cm(1.2), cx: cellW - ctx.cm(0.6), cy: ctx.cm(1) },
        valign: "middle",
        autoFit: "shrink",
        paragraphs: [{
          align: "center",
          runs: [{ text: caption, sizeHalfPt: 22, color: ctx.color("text-muted"), cjk: ctx.cjk, fontFace }],
        }],
      });
    }
  }
  return out;
};

export default imageGrid;
