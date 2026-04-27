import type { LayoutContext, LayoutFn } from "../../../render/layout-context.js";
import type { ShapeList, TextShape } from "../../../emitter/types.js";
import type { SlotSchema } from "../../../theme/types.js";

export const slots: Record<string, SlotSchema> = {
  title:    { type: "text", maxChars: 60 },
  subtitle: { type: "text", maxChars: 80, optional: true },
  // 32 chars accommodates common values like "Engineering · 2026 Q1"
  // (real-LLM testing showed agents consistently overshot 20 by 1-4 chars).
  eyebrow:  { type: "text", maxChars: 32, optional: true },
};

const cover: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title") ?? "";
  const subtitle = ctx.slot<string>("subtitle");
  const eyebrow = ctx.slot<string>("eyebrow");

  // Decorative cyan bar above the title.
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: { x: ctx.centerH(ctx.cm(2)), y: ctx.cm(5.6), cx: ctx.cm(2), cy: ctx.cm(0.18) },
    fill: { type: "solid", color: ctx.color("brand-primary") },
  });

  if (eyebrow) {
    out.push(textBox(ctx, eyebrow, {
      y: ctx.cm(4.6),
      cy: ctx.cm(0.8),
      sizeHalfPt: 24,
      color: ctx.color("brand-primary"),
      bold: false,
      align: "center",
    }));
  }

  out.push(textBox(ctx, title, {
    y: ctx.cm(6.2),
    cy: ctx.cm(2.4),
    sizeHalfPt: 88,
    color: ctx.color("text-strong"),
    bold: true,
    align: "center",
  }));

  if (subtitle) {
    out.push(textBox(ctx, subtitle, {
      y: ctx.cm(9.4),
      cy: ctx.cm(1.4),
      sizeHalfPt: 36,
      color: ctx.color("text-muted"),
      bold: false,
      align: "center",
    }));
  }

  return out;
};

export default cover;

function textBox(
  ctx: LayoutContext,
  text: string,
  opts: { y: number; cy: number; sizeHalfPt: number; color: string; bold?: boolean; align: "left" | "center" | "right" },
): TextShape {
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  return {
    type: "text",
    id: ctx.id(),
    xfrm: { x: ctx.cm(2), y: opts.y, cx: ctx.deck.width - 2 * ctx.cm(2), cy: opts.cy },
    valign: "middle",
    paragraphs: [{
      align: opts.align,
      runs: [{
        text,
        sizeHalfPt: opts.sizeHalfPt,
        color: opts.color,
        bold: opts.bold,
        cjk: ctx.cjk,
        fontFace,
      }],
    }],
  };
}
