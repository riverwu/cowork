import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { slideTitle } from "../render/primitives.js";

export const slots: Record<string, SlotSchema> = {
  title: { type: "text",    maxChars: 30, optional: true },
  items: { type: "bullets", min: 2, max: 8, itemMaxChars: 60 },
};

const agenda: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title") ?? (ctx.cjk ? "目录" : "Agenda");
  const items = ctx.slot<string[]>("items") ?? [];
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  out.push(...slideTitle(ctx, title));

  // Numbered list — large numerals in cyan, item text in muted strong.
  const itemTop = ctx.cm(4.2);
  const lineHeight = ctx.cm(1.0);
  items.forEach((item, idx) => {
    const y = itemTop + idx * lineHeight;
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(2), y, cx: ctx.cm(1.6), cy: lineHeight },
      valign: "middle",
      paragraphs: [{
        align: "right",
        runs: [{
          text: `${(idx + 1).toString().padStart(2, "0")}`,
          sizeHalfPt: 36,
          color: ctx.color("brand-primary"),
          bold: true,
          fontFace: ctx.font("latin"),
        }],
      }],
    });
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(4.2), y, cx: ctx.deck.width - ctx.cm(6.2), cy: lineHeight },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{ text: String(item), sizeHalfPt: 28, color: ctx.color("text-strong"), cjk: ctx.cjk, fontFace }],
      }],
    });
  });

  return out;
};

export default agenda;
