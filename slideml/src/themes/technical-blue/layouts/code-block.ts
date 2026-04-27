import type { LayoutContext, LayoutFn } from "../../../render/layout-context.js";
import type { ShapeList, TextRun } from "../../../emitter/types.js";
import type { SlotSchema } from "../../../theme/types.js";

export const slots: Record<string, SlotSchema> = {
  title:    { type: "text",       maxChars: 50, optional: true },
  language: { type: "text",       maxChars: 16, optional: true }, // informational badge
  code:     { type: "text-block", maxChars: 1600 },
  caption:  { type: "markdown-inline", maxChars: 160, optional: true },
};

const codeBlock: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const language = ctx.slot<string>("language");
  const code = ctx.slot<string>("code") ?? "";
  const caption = ctx.slot<string>("caption");
  const labelFont = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  let bodyTop = ctx.cm(2);
  if (title) {
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
          fontFace: labelFont,
        }],
      }],
    });
    bodyTop = ctx.cm(3.4);
  }

  // Code card.
  const captionBlock = caption ? ctx.cm(1.4) : 0;
  const cardHeight = ctx.deck.height - bodyTop - ctx.cm(2) - captionBlock;
  const cardX = ctx.cm(2);
  const cardW = ctx.deck.width - ctx.cm(4);

  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "roundRect",
    xfrm: { x: cardX, y: bodyTop, cx: cardW, cy: cardHeight },
    fill: { type: "solid", color: "0A1622" },
    line: { color: ctx.color("divider"), width: ctx.pt(0.5) },
    cornerRadius: 0.02,
  });

  // Language badge top-right of the card.
  if (language) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: cardX + cardW - ctx.cm(4.4), y: bodyTop + ctx.cm(0.3), cx: ctx.cm(4), cy: ctx.cm(0.7) },
      valign: "middle",
      paragraphs: [{
        align: "right",
        runs: [{
          text: language,
          sizeHalfPt: 18,
          color: ctx.color("text-muted"),
          fontFace: ctx.font("mono"),
          mono: true,
        }],
      }],
    });
  }

  // Code body — split on newlines into one paragraph per line so wrapping
  // doesn't surprise the agent.
  const lines = code.split(/\r?\n/);
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: {
      x: cardX + ctx.cm(0.6),
      y: bodyTop + ctx.cm(0.9),
      cx: cardW - ctx.cm(1.2),
      cy: cardHeight - ctx.cm(1.4),
    },
    valign: "top",
    margin: { l: 0, r: 0, t: 0, b: 0 },
    paragraphs: lines.map((line) => {
      const runs: TextRun[] = line.length > 0 ? [{
        text: line,
        sizeHalfPt: 22,
        color: "DDE6F0",
        fontFace: ctx.font("mono"),
        mono: true,
      }] : [];
      return {
        align: "left",
        lineSpacingHalfPt: 44,
        runs,
      };
    }),
  });

  if (caption) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: cardX, y: bodyTop + cardHeight + ctx.cm(0.4), cx: cardW, cy: ctx.cm(1) },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{
          text: caption,
          sizeHalfPt: 22,
          color: ctx.color("text-muted"),
          italic: true,
          cjk: ctx.cjk,
          fontFace: labelFont,
        }],
      }],
    });
  }

  return out;
};

export default codeBlock;
