import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { chipColorResolver, contentRect, slideTitle } from "../render/primitives.js";
import { parseInline } from "../render/markdown-inline.js";

/**
 * TL;DR / executive-summary clipboard. A title + 3–6 entries, each a
 * `{ heading, line }` pair: bold short heading on one line, one
 * descriptive sentence below. Quieter than `key-point` (no icons, no
 * centered hero treatment) — designed for report front-pages, board
 * decision summaries, release notes.
 */
export const slots: Record<string, SlotSchema> = {
  title: { type: "text",    maxChars: 60, optional: true },
  items: { type: "bullets", min: 2, max: 6, itemMaxChars: 240 },
};

interface ItemRaw {
  heading?: string;
  line?: string;
  text?: string;          // accepted alias when both heading and line are merged
}

const executiveSummary: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const rawItems = (ctx.slot<unknown[]>("items") ?? []) as Array<ItemRaw | string>;
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const monoFont = ctx.font("mono");
  const resolveChipColor = chipColorResolver(ctx);

  if (title) out.push(...slideTitle(ctx, title));

  const top = title ? ctx.cm(4.4) : ctx.cm(2);
  const body = contentRect(ctx, { top, marginX: ctx.cm(2.4), bottom: ctx.cm(1.6) });
  const itemGap = ctx.cm(0.5);
  const itemH = Math.floor((body.height - itemGap * (rawItems.length - 1)) / Math.max(1, rawItems.length));

  rawItems.forEach((raw, idx) => {
    const item: ItemRaw = typeof raw === "string" ? { heading: raw } : raw;
    const y = body.y + idx * (itemH + itemGap);
    // A small index numeral on the left, in brand colour.
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: body.x, y, cx: ctx.cm(1.4), cy: itemH },
      valign: "top",
      paragraphs: [{
        align: "right",
        runs: [{
          text: String(idx + 1).padStart(2, "0"),
          sizeHalfPt: 30,
          color: ctx.color("brand-primary"),
          bold: true,
          fontFace: ctx.font("latin"),
        }],
      }],
    });
    // Heading
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: body.x + ctx.cm(1.8), y, cx: body.width - ctx.cm(1.8), cy: ctx.cm(0.9) },
      valign: "top",
      paragraphs: [{
        align: "left",
        runs: parseInline(item.heading ?? item.text ?? "", {
          sizeHalfPt: 28,
          color: ctx.color("text-strong"),
          fontFace,
          monoFont,
          cjk: ctx.cjk,
          resolveChipColor,
        }).map((r) => ({ ...r, bold: r.bold ?? true })),
      }],
    });
    // Line / explanation
    if (item.line) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: body.x + ctx.cm(1.8), y: y + ctx.cm(0.95), cx: body.width - ctx.cm(1.8), cy: itemH - ctx.cm(0.95) },
        valign: "top",
        paragraphs: [{
          align: "left",
          lineSpacingHalfPt: 48,
          runs: parseInline(item.line, {
            sizeHalfPt: 22,
            color: ctx.color("text-muted"),
            fontFace,
            monoFont,
            cjk: ctx.cjk,
            resolveChipColor,
          }),
        }],
      });
    }
  });

  return out;
};

export default executiveSummary;
