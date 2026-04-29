import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { chipColorResolver, imageOrPlaceholder, imageRefOf } from "../render/primitives.js";
import { parseInline } from "../render/markdown-inline.js";

/**
 * Pull-quote layout. Two visual modes — picked by whether `portrait` is
 * supplied:
 *   - Portrait mode (magazine): circular avatar on the left, quote on
 *     the right, name + role underneath. Use when the speaker matters
 *     and you want a humane treatment.
 *   - Bare mode (default): centered quote with a big opening glyph and
 *     attribution underneath. Use for emphasis without a face.
 *
 * Replaces the older quote / quote-with-portrait pair.
 */
export const slots: Record<string, SlotSchema> = {
  quote:       { type: "text-block", maxChars: 196 },
  // attribution is the bare-mode caption ("— John Doe"). For portrait
  // mode use `name` + optional `role`.
  attribution: { type: "text",       maxChars: 42, optional: true },
  name:        { type: "text",       maxChars: 42, optional: true },
  role:        { type: "text",       maxChars: 56, optional: true },
  portrait:    { type: "image-ref",  optional: true },
};

const quote: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const quoteText = ctx.slot<string>("quote") ?? "";
  const attribution = ctx.slot<string>("attribution");
  const name = ctx.slot<string>("name");
  const role = ctx.slot<string>("role");
  const portraitRef = imageRefOf(ctx.slot<unknown>("portrait"));
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const monoFont = ctx.font("mono");
  const resolveChipColor = chipColorResolver(ctx);

  // Portrait mode if either a portrait image or a name is supplied —
  // covers `quote + name` (no photo yet) the same way as the original
  // quote-with-portrait layout. Otherwise fall through to bare mode.
  const portraitMode = !!portraitRef || !!name;

  if (portraitMode) {
    const portraitSize = ctx.cm(5.4);
    const portraitX = ctx.cm(2.4);
    const portraitY = ctx.centerV(portraitSize) - ctx.cm(0.6);
    out.push(...imageOrPlaceholder(ctx, {
      x: portraitX, y: portraitY, width: portraitSize, height: portraitSize,
    }, portraitRef ? { ...portraitRef, shape: "circle" as const } : undefined,
    { placeholderText: "[portrait]" }));

    const quoteX = portraitX + portraitSize + ctx.cm(1.4);
    const quoteW = ctx.deck.width - quoteX - ctx.cm(2);
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: quoteX, y: portraitY - ctx.cm(0.2), cx: ctx.cm(2), cy: ctx.cm(2) },
      valign: "top",
      paragraphs: [{
        align: "left",
        runs: [{ text: "\u201C", sizeHalfPt: 160, color: ctx.color("brand-primary"), bold: true, fontFace: ctx.font("latin") }],
      }],
    });

    const quoteRuns = parseInline(quoteText, {
      sizeHalfPt: 32, color: ctx.color("text-strong"), fontFace, monoFont, cjk: ctx.cjk, resolveChipColor,
    }).map((r) => ({ ...r, italic: r.italic ?? true }));
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: quoteX + ctx.cm(0.4), y: portraitY + ctx.cm(0.6), cx: quoteW - ctx.cm(0.4), cy: ctx.cm(5.5) },
      valign: "top",
      autoFit: "shrink",
      paragraphs: [{ align: "left", lineSpacingHalfPt: 64, runs: quoteRuns }],
    });

    const attribY = portraitY + ctx.cm(6.4);
    if (name) {
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
    }
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
  }

  // Bare mode — big opening glyph, centered quote, optional attribution.
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: ctx.cm(2), y: ctx.cm(2.6), cx: ctx.cm(3), cy: ctx.cm(3) },
    valign: "top",
    paragraphs: [{
      align: "left",
      runs: [{ text: "\u201C", sizeHalfPt: 220, color: ctx.color("brand-primary"), bold: true, fontFace: ctx.font("latin") }],
    }],
  });

  const bodyTop = ctx.cm(5.6);
  const bodyHeight = ctx.cm(5.5);
  const quoteRuns = parseInline(quoteText, {
    sizeHalfPt: 40, color: ctx.color("text-strong"), fontFace, monoFont, cjk: ctx.cjk, resolveChipColor,
  }).map((r) => ({ ...r, italic: r.italic ?? true }));
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: ctx.cm(3.4), y: bodyTop, cx: ctx.deck.width - ctx.cm(6.8), cy: bodyHeight },
    valign: "middle",
    autoFit: "shrink",
    paragraphs: [{ align: "left", lineSpacingHalfPt: 76, runs: quoteRuns }],
  });

  if (attribution) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(3.4), y: bodyTop + bodyHeight + ctx.cm(0.6), cx: ctx.deck.width - ctx.cm(6.8), cy: ctx.cm(1) },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [
          { text: "— ", sizeHalfPt: 26, color: ctx.color("text-muted"), fontFace },
          { text: attribution, sizeHalfPt: 26, color: ctx.color("text-muted"), bold: true, cjk: ctx.cjk, fontFace },
        ],
      }],
    });
  }

  return out;
};

export default quote;
