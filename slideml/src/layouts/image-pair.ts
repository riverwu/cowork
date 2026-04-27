import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { imageOrPlaceholder, imageRefOf, slideTitle } from "../render/primitives.js";

/**
 * Two images side by side — perfect for before/after, comparison,
 * "current state vs proposed", landscape pairs. Each side carries a
 * tiny label band along its top edge.
 */
export const slots: Record<string, SlotSchema> = {
  title:      { type: "text",      maxChars: 50, optional: true },
  leftImage:  { type: "image-ref" },
  rightImage: { type: "image-ref" },
  leftLabel:  { type: "text",      maxChars: 32, optional: true },
  rightLabel: { type: "text",      maxChars: 32, optional: true },
};

const imagePair: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const left = imageRefOf(ctx.slot<unknown>("leftImage"));
  const right = imageRefOf(ctx.slot<unknown>("rightImage"));
  const leftLabel = ctx.slot<string>("leftLabel");
  const rightLabel = ctx.slot<string>("rightLabel");
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  if (title) out.push(...slideTitle(ctx, title));

  const top = title ? ctx.cm(4.4) : ctx.cm(1.4);
  const bottomMargin = ctx.cm(1.4);
  const sideMargin = ctx.cm(1.4);
  const gap = ctx.cm(0.4);
  const labelH = (leftLabel || rightLabel) ? ctx.cm(0.9) : 0;
  const innerY = top + labelH;
  const innerH = ctx.deck.height - innerY - bottomMargin;
  const colW = Math.floor((ctx.deck.width - sideMargin * 2 - gap) / 2);

  const renderColumn = (x: number, label: string | undefined, image: ReturnType<typeof imageRefOf>) => {
    if (label) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x, y: top, cx: colW, cy: labelH },
        valign: "middle",
        paragraphs: [{
          align: "center",
          runs: [{
            text: label.toUpperCase(),
            sizeHalfPt: 18,
            color: ctx.color("brand-primary"),
            bold: true,
            cjk: ctx.cjk,
            fontFace,
          }],
        }],
      });
    }
    out.push(...imageOrPlaceholder(ctx, { x, y: innerY, width: colW, height: innerH }, image));
  };

  renderColumn(sideMargin, leftLabel, left);
  renderColumn(sideMargin + colW + gap, rightLabel, right);

  return out;
};

export default imagePair;
