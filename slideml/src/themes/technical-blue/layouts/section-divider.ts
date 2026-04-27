import type { LayoutContext, LayoutFn } from "../../../render/layout-context.js";
import type { ShapeList } from "../../../emitter/types.js";
import type { SlotSchema } from "../../../theme/types.js";
import { bestTextOn } from "../../../render/primitives.js";

export const slots: Record<string, SlotSchema> = {
  eyebrow: { type: "text", maxChars: 20, optional: true },
  title:   { type: "text", maxChars: 50 },
};

const sectionDivider: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title") ?? "";
  const eyebrow = ctx.slot<string>("eyebrow");
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const panelColor = ctx.color("brand-deep");
  const titleColor = bestTextOn(ctx, panelColor);
  // Full-bleed deep-blue panel.
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: { x: 0, y: 0, cx: ctx.deck.width, cy: ctx.deck.height },
    fill: { type: "solid", color: ctx.color("brand-deep") },
  });

  // Cyan accent bar.
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: {
      x: ctx.cm(2),
      y: Math.round(ctx.deck.height / 2) - ctx.cm(0.6),
      cx: ctx.cm(0.8),
      cy: ctx.cm(0.12),
    },
    fill: { type: "solid", color: ctx.color("brand-primary") },
  });

  if (eyebrow) {
    // Eyebrow color: use the same titleColor (best contrast on the dark
    // brand-deep panel). brand-primary often fails contrast on
    // brand-deep when both are tints of the same hue (e.g. rust on
    // deeper rust, forest on deeper forest).
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: {
        x: ctx.cm(2),
        y: Math.round(ctx.deck.height / 2) - ctx.cm(2.0),
        cx: ctx.deck.width - ctx.cm(4),
        cy: ctx.cm(1),
      },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{
          text: eyebrow,
          sizeHalfPt: 24,
          color: titleColor,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
  }

  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: {
      x: ctx.cm(2),
      y: Math.round(ctx.deck.height / 2),
      cx: ctx.deck.width - ctx.cm(4),
      cy: ctx.cm(2.5),
    },
    valign: "middle",
    paragraphs: [{
      align: "left",
      runs: [{
        text: title,
        sizeHalfPt: 64,
        color: titleColor,
        bold: true,
        cjk: ctx.cjk,
        fontFace,
      }],
    }],
  });

  return out;
};

export default sectionDivider;
