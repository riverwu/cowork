import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { chipColorResolver } from "../render/primitives.js";
import { parseInline } from "../render/markdown-inline.js";

export const slots: Record<string, SlotSchema> = {
  quote:       { type: "text-block", maxChars: 240 },
  attribution: { type: "text",       maxChars: 60, optional: true },
};

const quote: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const quoteText = ctx.slot<string>("quote") ?? "";
  const attribution = ctx.slot<string>("attribution");
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  // Big opening quote mark in cyan, top-left of the text block.
  const quoteMarkY = ctx.cm(2.6);
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: ctx.cm(2), y: quoteMarkY, cx: ctx.cm(3), cy: ctx.cm(3) },
    valign: "top",
    paragraphs: [{
      align: "left",
      runs: [{
        text: "\u201C",
        sizeHalfPt: 220,
        color: ctx.color("brand-primary"),
        bold: true,
        fontFace: ctx.font("latin"),
      }],
    }],
  });

  // The quote itself, indented under the open mark. Runs through the
  // inline-markdown parser so authors can emphasize words inside the quote.
  const bodyTop = ctx.cm(5.6);
  const bodyHeight = ctx.cm(5.5);
  const quoteRuns = parseInline(quoteText, {
    sizeHalfPt: 40,
    color: ctx.color("text-strong"),
    fontFace,
    monoFont: ctx.font("mono"),
    cjk: ctx.cjk,
    resolveChipColor: chipColorResolver(ctx),
  }).map((r) => ({ ...r, italic: r.italic ?? true }));
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: ctx.cm(3.4), y: bodyTop, cx: ctx.deck.width - ctx.cm(6.8), cy: bodyHeight },
    valign: "middle",
    paragraphs: [{
      align: "left",
      lineSpacingHalfPt: 76,
      runs: quoteRuns,
    }],
  });

  if (attribution) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(3.4), y: bodyTop + bodyHeight + ctx.cm(0.6), cx: ctx.deck.width - ctx.cm(6.8), cy: ctx.cm(1) },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [
          { text: "— ", sizeHalfPt: 26, color: ctx.color("text-muted"), fontFace },
          { text: attribution, sizeHalfPt: 26, color: ctx.color("text-muted"), bold: true, cjk: ctx.cjk, fontFace },
        ],
      }],
    });
  }

  return out;
};

export default quote;
