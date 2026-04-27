import type { LayoutContext, LayoutFn } from "../../../render/layout-context.js";
import type { ShapeList } from "../../../emitter/types.js";
import type { SlotSchema } from "../../../theme/types.js";
import {
  card,
  contentRect,
  gridCols,
  slideTitle,
  textBlockOf,
} from "../../../render/primitives.js";

export const slots: Record<string, SlotSchema> = {
  title:      { type: "text",       maxChars: 50, optional: true },
  leftTitle:  { type: "text",       maxChars: 30 },
  leftBody:   { type: "text-block", maxChars: 280 },
  rightTitle: { type: "text",       maxChars: 30 },
  rightBody:  { type: "text-block", maxChars: 280 },
};

const compareTwoColumns: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const leftTitle = ctx.slot<string>("leftTitle") ?? "";
  const leftBody = textBlockOf(ctx.slot<unknown>("leftBody"));
  const rightTitle = ctx.slot<string>("rightTitle") ?? "";
  const rightBody = textBlockOf(ctx.slot<unknown>("rightBody"));
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  let bodyTop = ctx.cm(2);
  if (title) {
    out.push(...slideTitle(ctx, title));
    bodyTop = ctx.cm(4.2);
  }

  const body = contentRect(ctx, { top: bodyTop });
  const [left, right] = gridCols(ctx, body, 2);

  for (const [col, t, b, accent] of [
    [left!,  leftTitle,  leftBody,  "brand-primary"] as const,
    [right!, rightTitle, rightBody, "accent"]        as const,
  ]) {
    out.push(...card(ctx, col, { accentStripe: accent }));

    // Column title
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: col.x + ctx.cm(0.6), y: col.y + ctx.cm(0.6), cx: col.width - ctx.cm(1.2), cy: ctx.cm(1.0) },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{ text: t, sizeHalfPt: 32, color: ctx.color("text-strong"), bold: true, cjk: ctx.cjk, fontFace }],
      }],
    });

    // Body — paragraph splits on blank lines.
    const paras = b.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: col.x + ctx.cm(0.6), y: col.y + ctx.cm(2.0), cx: col.width - ctx.cm(1.2), cy: col.height - ctx.cm(2.6) },
      valign: "top",
      paragraphs: (paras.length > 0 ? paras : [b]).map((p) => ({
        align: "left",
        lineSpacingHalfPt: 56,
        spaceAfterHalfPt: 20,
        runs: [{ text: p, sizeHalfPt: 26, color: ctx.color("text-strong"), cjk: ctx.cjk, fontFace }],
      })),
    });
  }

  return out;
};

export default compareTwoColumns;
