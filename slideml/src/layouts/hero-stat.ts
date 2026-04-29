import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { bestTextOn, chipColorResolver, richText } from "../render/primitives.js";
import { parseInline } from "../render/markdown-inline.js";

/**
 * Hero stat — one giant headline number with a tagline. Use when a slide
 * exists to make ONE point land. Pattern popularised by Google's
 * "47% of Americans..." marketing decks.
 */
export const slots: Record<string, SlotSchema> = {
  value:    { type: "text",       maxChars: 16 },
  label:    { type: "text",       maxChars: 42 },
  caption:  { type: "text-block", maxChars: 168, optional: true },
  eyebrow:  { type: "text",       maxChars: 22, optional: true },
};

const heroStat: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const value = ctx.slot<string>("value") ?? "";
  const label = ctx.slot<string>("label") ?? "";
  const caption = ctx.slot<unknown>("caption");
  const eyebrow = ctx.slot<string>("eyebrow");
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const monoFont = ctx.font("mono");
  const resolveChipColor = chipColorResolver(ctx);

  if (eyebrow) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(2), y: ctx.cm(2.4), cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(0.9) },
      valign: "middle",
      autoFit: "shrink",
      paragraphs: [{
        align: "center",
        runs: [{
          text: eyebrow.toUpperCase(),
          sizeHalfPt: 22,
          color: ctx.color("brand-primary"),
          bold: true,
          fontFace,
          cjk: ctx.cjk,
        }],
      }],
    });
  }

  // Headline value — full slide width, centered, very large.
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: {
      x: ctx.cm(1),
      y: eyebrow ? ctx.cm(3.6) : ctx.cm(3.0),
      cx: ctx.deck.width - ctx.cm(2),
      cy: ctx.cm(4.2),
    },
    valign: "middle",
    autoFit: "shrink",
    paragraphs: [{
      align: "center",
      runs: parseInline(value, {
        sizeHalfPt: 200,
        color: ctx.color("brand-primary"),
        fontFace,
        monoFont,
        cjk: ctx.cjk,
        resolveChipColor,
      }).map((r) => ({ ...r, bold: r.bold ?? true })),
    }],
  });

  // Label — supporting text immediately below.
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: {
      x: ctx.cm(2),
      y: eyebrow ? ctx.cm(8.6) : ctx.cm(8.0),
      cx: ctx.deck.width - ctx.cm(4),
      cy: ctx.cm(1.4),
    },
    valign: "top",
    autoFit: "shrink",
    paragraphs: [{
      align: "center",
      runs: parseInline(label, {
        sizeHalfPt: 36,
        color: ctx.color("text-strong"),
        fontFace,
        monoFont,
        cjk: ctx.cjk,
        resolveChipColor,
      }),
    }],
  });

  if (caption) {
    out.push(...richText(ctx, {
      x: ctx.cm(4),
      y: ctx.cm(10.4),
      width: ctx.deck.width - ctx.cm(8),
      height: ctx.cm(2),
    }, caption, {
      sizeHalfPt: 22,
      color: "text-muted",
      align: "center",
      lineSpacingHalfPt: 44,
    }));
  }

  // Suppress the `bestTextOn` lint — only used by other heroish layouts.
  void bestTextOn;
  return out;
};

export default heroStat;
