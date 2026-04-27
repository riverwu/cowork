import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { chipColorResolver, imageOrPlaceholder, imageRefOf } from "../render/primitives.js";
import { parseInline } from "../render/markdown-inline.js";

/**
 * Pull-quote with a circular portrait of the speaker on the left,
 * quote on the right, name + title underneath. Magazine-style — much
 * more humane than the bare `quote` layout when the source matters.
 */
export const slots: Record<string, SlotSchema> = {
  quote:      { type: "text-block", maxChars: 280 },
  name:       { type: "text",       maxChars: 60 },
  role:       { type: "text",       maxChars: 80, optional: true },
  portrait:   { type: "image-ref",  optional: true },
};

const quoteWithPortrait: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const quoteText = ctx.slot<string>("quote") ?? "";
  const name = ctx.slot<string>("name") ?? "";
  const role = ctx.slot<string>("role");
  const portrait = imageRefOf(ctx.slot<unknown>("portrait"));
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const monoFont = ctx.font("mono");

  // Portrait — circular, ≈4cm, anchored mid-left.
  const portraitSize = ctx.cm(5.4);
  const portraitX = ctx.cm(2.4);
  const portraitY = ctx.centerV(portraitSize) - ctx.cm(0.6);
  const portraitRef = portrait ? { ...portrait, shape: "circle" as const } : undefined;
  out.push(...imageOrPlaceholder(ctx, {
    x: portraitX, y: portraitY, width: portraitSize, height: portraitSize,
  }, portraitRef, { placeholderText: "[portrait]" }));

  // Big opening quote glyph.
  const quoteX = portraitX + portraitSize + ctx.cm(1.4);
  const quoteW = ctx.deck.width - quoteX - ctx.cm(2);
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: quoteX, y: portraitY - ctx.cm(0.2), cx: ctx.cm(2), cy: ctx.cm(2) },
    valign: "top",
    paragraphs: [{
      align: "left",
      runs: [{
        text: "\u201C",
        sizeHalfPt: 160,
        color: ctx.color("brand-primary"),
        bold: true,
        fontFace: ctx.font("latin"),
      }],
    }],
  });

  // Quote body — italic serif feel.
  const quoteRuns = parseInline(quoteText, {
    sizeHalfPt: 32, color: ctx.color("text-strong"), fontFace, monoFont, cjk: ctx.cjk,
    resolveChipColor: chipColorResolver(ctx),
  }).map((r) => ({ ...r, italic: r.italic ?? true }));
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: quoteX + ctx.cm(0.4), y: portraitY + ctx.cm(0.6), cx: quoteW - ctx.cm(0.4), cy: ctx.cm(5.5) },
    valign: "top",
    paragraphs: [{
      align: "left",
      lineSpacingHalfPt: 64,
      runs: quoteRuns,
    }],
  });

  // Name + role under the quote, aligned with the quote text.
  const attribY = portraitY + ctx.cm(6.4);
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: quoteX + ctx.cm(0.4), y: attribY, cx: quoteW - ctx.cm(0.4), cy: ctx.cm(0.8) },
    valign: "top",
    paragraphs: [{
      align: "left",
      runs: [
        { text: "\u2014 ",  sizeHalfPt: 22, color: ctx.color("text-muted"), fontFace },
        { text: name,        sizeHalfPt: 22, color: ctx.color("text-strong"), bold: true, cjk: ctx.cjk, fontFace },
      ],
    }],
  });
  if (role) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: quoteX + ctx.cm(0.4), y: attribY + ctx.cm(0.7), cx: quoteW - ctx.cm(0.4), cy: ctx.cm(0.8) },
      valign: "top",
      paragraphs: [{
        align: "left",
        runs: [{ text: role, sizeHalfPt: 18, color: ctx.color("text-muted"), italic: true, cjk: ctx.cjk, fontFace }],
      }],
    });
  }

  return out;
};

export default quoteWithPortrait;
