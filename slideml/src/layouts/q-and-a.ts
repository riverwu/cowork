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
  title: { type: "text",    maxChars: 42, optional: true },
  items: { type: "bullets", min: 1, max: 5, itemMaxChars: 280 },
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

  // Pair geometry — compute each pair's own height from Q (always 1
  // line) + A (estimated from content length) so wrapped answers don't
  // bleed into the next pair's slot. Gap between pairs is INTENTIONALLY
  // larger than the implicit Q→A spacing so the visual reads as
  // [Q-tightly-followed-by-A] [gap] [next pair], not the inverse where
  // the answer floats closer to the following question. Earlier
  // equal-division layout produced the latter for any deck with ≥3
  // pairs because pairH was so small that the A box's allocated
  // height (pairH − 1.2cm) was sub-line.
  // Natural per-line consumption + insets at full size:
  //   Q line ≈ 0.9cm; A line @ lineSpacing 48halfPt = 24pt ≈ 0.85cm;
  //   text-frame top+bottom inset ≈ 0.5cm; pair gap ≈ 0.7cm.
  const Q_H_NAT     = 0.9;
  const A_LINE_NAT  = 0.85;
  const A_INSET_NAT = 0.5;
  const PAIR_GAP_NAT = 0.7;
  const A_LINE_SPACING_HALFPT_NAT = 48;
  const charsPerLine = ctx.cjk ? 38 : 105;
  const linesFor = (a: string): number =>
    a ? Math.max(1, Math.ceil([...a].length / charsPerLine)) : 0;

  // Sum naturally-needed total height for all pairs at full size.
  const items = rawItems.map((raw) => {
    const item: QA = typeof raw === "string" ? { q: raw } : raw;
    return {
      q: item.q ?? item.question ?? "",
      a: item.a ?? item.answer ?? "",
    };
  });
  const totalLinesA = items.reduce((sum, it) => sum + linesFor(it.a), 0);
  const naturalH = items.length * Q_H_NAT
    + totalLinesA * A_LINE_NAT
    + items.filter((it) => it.a).length * A_INSET_NAT
    + Math.max(0, items.length - 1) * PAIR_GAP_NAT;
  const bodyHcm = body.height / 360000; // EMU → cm

  // If natural fits → use it; otherwise scale all metrics down proportionally.
  // The line-spacing follows the same scale so text doesn't get squished
  // into a too-tight box (which would re-trigger autoFit shrinkage).
  const scale = naturalH > bodyHcm ? bodyHcm / naturalH : 1;
  const Q_H = ctx.cm(Q_H_NAT * scale);
  const A_LINE_H = ctx.cm(A_LINE_NAT * scale);
  const A_INSET = ctx.cm(A_INSET_NAT * scale);
  const PAIR_GAP = ctx.cm(PAIR_GAP_NAT * scale);
  const lineSpacingHalfPt = Math.round(A_LINE_SPACING_HALFPT_NAT * scale);
  // When scaled down, also shrink font sizes so text fits the line height
  // (line-spacing-only shrink would overlap glyphs).
  const qSize = Math.max(18, Math.round(26 * scale));
  const aSize = Math.max(16, Math.round(22 * scale));

  let yCursor = body.y;

  items.forEach(({ q, a }, idx) => {
    const aLines = linesFor(a);
    const aH = aLines > 0 ? A_LINE_H * aLines + A_INSET : 0;
    const y = yCursor;

    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: body.x, y, cx: body.width, cy: Q_H },
      valign: "top",
      autoFit: "shrink",
      paragraphs: [{
        align: "left",
        runs: [
          { text: "Q. ", sizeHalfPt: qSize, color: ctx.color("brand-primary"), bold: true, fontFace: ctx.font("latin") },
          ...parseInline(q, {
            sizeHalfPt: qSize,
            color: ctx.color("text-strong"),
            fontFace,
            monoFont,
            cjk: ctx.cjk,
            resolveChipColor,
          }).map((r) => ({ ...r, bold: r.bold ?? true })),
        ],
      }],
    });
    if (a) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: body.x + ctx.cm(0.6), y: y + Q_H, cx: body.width - ctx.cm(0.6), cy: aH },
        valign: "top",
        autoFit: "shrink",
        paragraphs: [{
          align: "left",
          lineSpacingHalfPt,
          runs: [
            { text: "A. ", sizeHalfPt: aSize, color: ctx.color("text-muted"), italic: true, fontFace: ctx.font("latin") },
            ...parseInline(a, {
              sizeHalfPt: aSize,
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

    yCursor += Q_H + aH + (idx < items.length - 1 ? PAIR_GAP : 0);
  });

  return out;
};

export default qAndA;
