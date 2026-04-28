import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { chipColorResolver, contentRect, slideTitle } from "../render/primitives.js";
import { parseInline } from "../render/markdown-inline.js";

/**
 * Q&A / FAQ — N pairs of question + answer. Question renders bold and
 * larger, answer indented and lighter. Use for FAQ slides, Q&A
 * recap, panel transcript summary.
 */
export const slots: Record<string, SlotSchema> = {
  title: { type: "text",    maxChars: 60, optional: true },
  items: { type: "bullets", min: 1, max: 5, itemMaxChars: 400 },
};

interface QA {
  q?: string;
  question?: string;
  a?: string;
  answer?: string;
}

const qAndA: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const rawItems = (ctx.slot<unknown[]>("items") ?? []) as Array<QA | string>;
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const monoFont = ctx.font("mono");
  const resolveChipColor = chipColorResolver(ctx);

  if (title) out.push(...slideTitle(ctx, title));

  const top = title ? ctx.cm(4.4) : ctx.cm(2);
  const body = contentRect(ctx, { top, marginX: ctx.cm(2), bottom: ctx.cm(1.6) });
  const gap = ctx.cm(0.6);
  const pairH = Math.floor((body.height - gap * (rawItems.length - 1)) / Math.max(1, rawItems.length));

  rawItems.forEach((raw, idx) => {
    const item: QA = typeof raw === "string" ? { q: raw } : raw;
    const q = item.q ?? item.question ?? "";
    const a = item.a ?? item.answer ?? "";
    const y = body.y + idx * (pairH + gap);

    // Q. — bold question
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: body.x, y, cx: body.width, cy: ctx.cm(1.0) },
      valign: "top",
      paragraphs: [{
        align: "left",
        runs: [
          { text: "Q. ", sizeHalfPt: 26, color: ctx.color("brand-primary"), bold: true, fontFace: ctx.font("latin") },
          ...parseInline(q, {
            sizeHalfPt: 26,
            color: ctx.color("text-strong"),
            fontFace,
            monoFont,
            cjk: ctx.cjk,
            resolveChipColor,
          }).map((r) => ({ ...r, bold: r.bold ?? true })),
        ],
      }],
    });
    // A. — answer indented, muted
    if (a) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: body.x + ctx.cm(0.6), y: y + ctx.cm(1.2), cx: body.width - ctx.cm(0.6), cy: pairH - ctx.cm(1.2) },
        valign: "top",
        paragraphs: [{
          align: "left",
          lineSpacingHalfPt: 48,
          runs: [
            { text: "A. ", sizeHalfPt: 22, color: ctx.color("text-muted"), italic: true, fontFace: ctx.font("latin") },
            ...parseInline(a, {
              sizeHalfPt: 22,
              color: ctx.color("text-strong"),
              fontFace,
              monoFont,
              cjk: ctx.cjk,
              resolveChipColor,
            }),
          ],
        }],
      });
    }
  });

  return out;
};

export default qAndA;
