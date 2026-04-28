import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { contentRect, richText } from "../render/primitives.js";

/**
 * Dictionary-style term definition. Big term + part-of-speech / etymology
 * label + definition body + optional example. Use when one slide exists
 * to define a single concept (a "what is X" page).
 */
export const slots: Record<string, SlotSchema> = {
  term:       { type: "text",       maxChars: 40 },
  pronounce:  { type: "text",       maxChars: 60, optional: true },
  partOfSpeech: { type: "text",     maxChars: 32, optional: true },
  body:       { type: "text-block", maxChars: 600 },
  example:    { type: "text-block", maxChars: 240, optional: true },
};

const definition: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const term = ctx.slot<string>("term") ?? "";
  const pronounce = ctx.slot<string>("pronounce");
  const partOfSpeech = ctx.slot<string>("partOfSpeech");
  const body = ctx.slot<unknown>("body");
  const example = ctx.slot<unknown>("example");
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  // Big term, top-left.
  const headerH = ctx.cm(2.6);
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: ctx.cm(2), y: ctx.cm(2.0), cx: ctx.deck.width - ctx.cm(4), cy: headerH },
    valign: "top",
    paragraphs: [{
      align: "left",
      runs: [{
        text: term,
        sizeHalfPt: 88,
        color: ctx.color("text-strong"),
        bold: true,
        cjk: ctx.cjk,
        fontFace,
      }],
    }],
  });

  // Pronunciation + part-of-speech, italic, beneath term.
  const subBits: string[] = [];
  if (pronounce) subBits.push(pronounce);
  if (partOfSpeech) subBits.push(partOfSpeech);
  let cursorY = ctx.cm(2.0) + headerH;
  if (subBits.length > 0) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(2), y: cursorY, cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(0.8) },
      valign: "top",
      paragraphs: [{
        align: "left",
        runs: [{
          text: subBits.join("   ·   "),
          sizeHalfPt: 22,
          color: ctx.color("text-muted"),
          italic: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
    cursorY += ctx.cm(0.9);
  }

  // Hairline divider in brand color.
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: { x: ctx.cm(2), y: cursorY + ctx.cm(0.3), cx: ctx.cm(2.4), cy: ctx.cm(0.08) },
    fill: { type: "solid", color: ctx.color("brand-primary") },
  });
  cursorY += ctx.cm(0.6);

  // Definition body — large readable.
  const bodyRect = contentRect(ctx, { top: cursorY + ctx.cm(0.3), marginX: ctx.cm(2), bottom: ctx.cm(1.6) });
  const exampleH = example ? ctx.cm(2.2) : 0;
  out.push(...richText(ctx, {
    x: bodyRect.x,
    y: bodyRect.y,
    width: bodyRect.width,
    height: bodyRect.height - exampleH,
  }, body, {
    sizeHalfPt: 26,
    color: "text-strong",
    lineSpacingHalfPt: 56,
    spaceAfterHalfPt: 18,
  }));

  // Example block — italic, indented.
  if (example) {
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: bodyRect.x, y: bodyRect.y + bodyRect.height - exampleH, cx: ctx.cm(0.06), cy: exampleH },
      fill: { type: "solid", color: ctx.color("brand-primary") },
    });
    out.push(...richText(ctx, {
      x: bodyRect.x + ctx.cm(0.4),
      y: bodyRect.y + bodyRect.height - exampleH,
      width: bodyRect.width - ctx.cm(0.4),
      height: exampleH,
    }, example, {
      sizeHalfPt: 22,
      color: "text-muted",
      italic: true,
      lineSpacingHalfPt: 50,
    }));
  }

  return out;
};

export default definition;
