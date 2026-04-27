import type { LayoutContext, LayoutFn } from "../../../render/layout-context.js";
import type { ShapeList } from "../../../emitter/types.js";
import type { SlotSchema } from "../../../theme/types.js";
import { bestTextOn } from "../../../render/primitives.js";

export const slots: Record<string, SlotSchema> = {
  title:    { type: "text", maxChars: 60 },
  subtitle: { type: "text", maxChars: 80, optional: true },
};

const closing: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title") ?? "";
  const subtitle = ctx.slot<string>("subtitle");
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  // Pick title color by contrast — handles both dark themes (where
  // text-strong is light) and warm/light themes (where text-strong is
  // dark and would fail on a deep brand panel).
  const panelColor = ctx.color("brand-deep");
  const titleColor = bestTextOn(ctx, panelColor);
  const subtitleColor = titleColor === "FFFFFF" ? "E2E8F0" : ctx.color("text-muted");

  // Full-bleed deep-blue panel for visual closure.
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: { x: 0, y: 0, cx: ctx.deck.width, cy: ctx.deck.height },
    fill: { type: "solid", color: ctx.color("brand-deep") },
  });
  // Cyan band as a closing flourish.
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: { x: ctx.centerH(ctx.cm(3)), y: ctx.cm(4.4), cx: ctx.cm(3), cy: ctx.cm(0.18) },
    fill: { type: "solid", color: ctx.color("brand-primary") },
  });

  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: ctx.cm(2), y: ctx.cm(5.4), cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(2.4) },
    valign: "middle",
    paragraphs: [{
      align: "center",
      runs: [{
        text: title,
        sizeHalfPt: 96,
        color: titleColor,
        bold: true,
        cjk: ctx.cjk,
        fontFace,
      }],
    }],
  });
  if (subtitle) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(2), y: ctx.cm(8.4), cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(1.4) },
      valign: "middle",
      paragraphs: [{
        align: "center",
        runs: [{
          text: subtitle,
          sizeHalfPt: 32,
          color: subtitleColor,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
  }

  return out;
};

export default closing;
