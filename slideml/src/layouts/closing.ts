import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { bestTextOn, chipColorResolver, imageOrPlaceholder, imageRefOf } from "../render/primitives.js";
import { parseInline } from "../render/markdown-inline.js";

export const slots: Record<string, SlotSchema> = {
  title:    { type: "text",      maxChars: 42 },
  subtitle: { type: "text",      maxChars: 56, optional: true },
  // Optional full-bleed background image. When supplied, the brand-deep
  // panel renders as a 75%-opacity overlay on top of the image so the
  // title stays readable. Use for hero "thank you" closes.
  image:    { type: "image-ref", optional: true },
};

const closing: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title") ?? "";
  const subtitle = ctx.slot<string>("subtitle");
  const image = imageRefOf(ctx.slot<unknown>("image"));
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  // Pick title color by contrast — handles both dark themes (where
  // text-strong is light) and warm/light themes (where text-strong is
  // dark and would fail on a deep brand panel).
  const panelColor = ctx.color("brand-deep");
  const titleColor = bestTextOn(ctx, panelColor);
  const subtitleColor = titleColor === "FFFFFF" ? "E2E8F0" : ctx.color("text-muted");

  // Background image (when provided) under a translucent brand panel —
  // keeps title legible without sacrificing the hero photo.
  if (image) {
    out.push(...imageOrPlaceholder(ctx, {
      x: 0, y: 0, width: ctx.deck.width, height: ctx.deck.height,
    }, { ...image, fit: "cover" }));
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: 0, y: 0, cx: ctx.deck.width, cy: ctx.deck.height },
      fill: { type: "solid", color: panelColor, alpha: 0.75 },
    });
  } else {
    // Full-bleed deep panel for visual closure (default).
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: 0, y: 0, cx: ctx.deck.width, cy: ctx.deck.height },
      fill: { type: "solid", color: panelColor },
    });
  }
  // Cyan band as a closing flourish.
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: { x: ctx.centerH(ctx.cm(3)), y: ctx.cm(4.4), cx: ctx.cm(3), cy: ctx.cm(0.18) },
    fill: { type: "solid", color: ctx.color("brand-primary") },
  });

  const baseInline = {
    fontFace,
    monoFont: ctx.font("mono"),
    cjk: ctx.cjk,
    resolveChipColor: chipColorResolver(ctx),
  };
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: ctx.cm(2), y: ctx.cm(5.4), cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(2.4) },
    valign: "middle",
    autoFit: "shrink",
    paragraphs: [{
      align: "center",
      runs: parseInline(title, { ...baseInline, sizeHalfPt: 96, color: titleColor })
        .map((r) => ({ ...r, bold: r.bold ?? true })),
    }],
  });
  if (subtitle) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(2), y: ctx.cm(8.4), cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(1.4) },
      valign: "middle",
      autoFit: "shrink",
      paragraphs: [{
        align: "center",
        runs: parseInline(subtitle, { ...baseInline, sizeHalfPt: 32, color: subtitleColor }),
      }],
    });
  }

  return out;
};

export default closing;
