/**
 * `takeaway-callout` component — boxed conclusion at the bottom of a content
 * slide. Reads slot `text` (markdown-inline allowed; current emitter shows
 * runs as plain bold body for v1) and an optional `__pos` slot for the box.
 */

import type { LayoutContext } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";

export const slots: Record<string, SlotSchema> = {
  text: { type: "markdown-inline", maxChars: 160 },
};

interface Pos { x: number; y: number; cx: number; cy: number }

const takeawayCallout = (ctx: LayoutContext): ShapeList => {
  const text = ctx.slot<string>("text") ?? "";
  const pos = ctx.slot<Pos>("__pos") ?? {
    x: ctx.cm(2),
    y: ctx.deck.height - ctx.cm(3),
    cx: ctx.deck.width - ctx.cm(4),
    cy: ctx.cm(1.6),
  };
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  return [
    {
      type: "shape",
      id: ctx.id(),
      preset: "roundRect",
      xfrm: pos,
      fill: { type: "solid", color: ctx.color("brand-deep") },
      line: { color: ctx.color("brand-primary"), width: ctx.pt(1) },
      cornerRadius: 0.05,
    },
    {
      type: "text",
      id: ctx.id(),
      xfrm: pos,
      valign: "middle",
      margin: { l: ctx.cm(0.6), r: ctx.cm(0.6), t: ctx.cm(0.4), b: ctx.cm(0.4) },
      paragraphs: [{
        align: "left",
        runs: [{
          text: stripMarkdown(text),
          sizeHalfPt: 26,
          color: ctx.color("text-strong"),
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    },
  ];
};

export default takeawayCallout;

/** Strip the small subset of markdown-inline tokens for v1 (full inline-md
 *  parsing into multiple runs lands when SlideML's markdown-inline parser
 *  arrives in a follow-up). */
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1");
}
