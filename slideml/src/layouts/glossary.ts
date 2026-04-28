import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { chipColorResolver, contentRect, slideTitle } from "../render/primitives.js";
import { parseInline } from "../render/markdown-inline.js";

/**
 * Term + short definition list — like a printed glossary page or a
 * spec's "definitions" slide. Two-column layout: term on the left
 * (bold + brand color), one-line definition on the right (text-muted).
 * Different from `definition` which is one-term-per-slide.
 */
export const slots: Record<string, SlotSchema> = {
  title: { type: "text",    maxChars: 60, optional: true },
  terms: { type: "bullets", min: 3, max: 12, itemMaxChars: 200 },
};

interface Term {
  term?: string;
  word?: string;
  definition?: string;
  meaning?: string;
}

const glossary: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const terms = (ctx.slot<unknown[]>("terms") ?? []) as Array<Term | string>;
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const monoFont = ctx.font("mono");
  const resolveChipColor = chipColorResolver(ctx);

  if (title) out.push(...slideTitle(ctx, title));

  const top = title ? ctx.cm(4.4) : ctx.cm(2);
  const body = contentRect(ctx, { top, marginX: ctx.cm(2.4), bottom: ctx.cm(1.6) });
  // Two-column layout: 35% / 65%, narrow gutter.
  const termColW = Math.floor(body.width * 0.32);
  const defColX = body.x + termColW + ctx.cm(0.6);
  const defColW = body.width - termColW - ctx.cm(0.6);

  const rowGap = ctx.cm(0.25);
  const rowH = Math.floor((body.height - rowGap * (terms.length - 1)) / Math.max(1, terms.length));

  terms.forEach((raw, idx) => {
    const t: Term = typeof raw === "string" ? { term: raw } : raw;
    const term = t.term ?? t.word ?? "";
    const definition = t.definition ?? t.meaning ?? "";
    const y = body.y + idx * (rowH + rowGap);

    // Hairline divider above each row except the first.
    if (idx > 0) {
      out.push({
        type: "shape",
        id: ctx.id(),
        preset: "rect",
        xfrm: { x: body.x, y: y - rowGap / 2 - ctx.cm(0.02), cx: body.width, cy: ctx.cm(0.02) },
        fill: { type: "solid", color: ctx.color("divider") },
      });
    }
    // Term
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: body.x, y, cx: termColW, cy: rowH },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{
          text: term,
          sizeHalfPt: 22,
          color: ctx.color("brand-primary"),
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
    // Definition
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: defColX, y, cx: defColW, cy: rowH },
      valign: "middle",
      paragraphs: [{
        align: "left",
        lineSpacingHalfPt: 44,
        runs: parseInline(definition, {
          sizeHalfPt: 18,
          color: ctx.color("text-strong"),
          fontFace,
          monoFont,
          cjk: ctx.cjk,
          resolveChipColor,
        }),
      }],
    });
  });

  return out;
};

export default glossary;
