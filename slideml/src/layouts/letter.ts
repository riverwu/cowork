import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { contentRect, richText } from "../render/primitives.js";

/**
 * Letter / open-letter format. A salutation header (date + recipient),
 * a multi-paragraph body, a sign-off, and the writer's name + role.
 * Use for CEO letters to shareholders, public letters to users,
 * commemorative slides.
 */
export const slots: Record<string, SlotSchema> = {
  date:       { type: "text",       maxChars: 28, optional: true },
  recipient:  { type: "text",       maxChars: 42, optional: true },
  body:       { type: "text-block", maxChars: 980 },
  signoff:    { type: "text",       maxChars: 28, optional: true },
  signature:  { type: "text",       maxChars: 42 },
  signRole:   { type: "text",       maxChars: 56, optional: true },
};

const letter: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const date = ctx.slot<string>("date");
  const recipient = ctx.slot<string>("recipient");
  const body = ctx.slot<unknown>("body");
  const signoff = ctx.slot<string>("signoff") ?? (ctx.cjk ? "此致" : "Sincerely,");
  const signature = ctx.slot<string>("signature") ?? "";
  const signRole = ctx.slot<string>("signRole");
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  // Generous margins for a letter feel.
  const margin = Math.max(ctx.cm(2.6), Math.floor(ctx.deck.width * 0.18));
  const writableWidth = ctx.deck.width - margin * 2;
  let cursorY = ctx.cm(1.6);

  if (date) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: margin, y: cursorY, cx: writableWidth, cy: ctx.cm(0.7) },
      valign: "top",
      paragraphs: [{
        align: "right",
        runs: [{ text: date, sizeHalfPt: 20, color: ctx.color("text-muted"), italic: true, fontFace }],
      }],
    });
    cursorY += ctx.cm(0.9);
  }
  if (recipient) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: margin, y: cursorY, cx: writableWidth, cy: ctx.cm(0.9) },
      valign: "top",
      autoFit: "shrink",
      paragraphs: [{
        align: "left",
        runs: [{
          text: recipient,
          sizeHalfPt: 24,
          color: ctx.color("text-strong"),
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
    cursorY += ctx.cm(1.2);
  }

  // Body — leave room for sign-off block at the bottom.
  const signOffH = ctx.cm(2.2);
  const bodyRect = contentRect(ctx, { top: cursorY, marginX: margin, bottom: signOffH + ctx.cm(0.6) });
  out.push(...richText(ctx, bodyRect, body, {
    sizeHalfPt: 22,
    color: "text-strong",
    lineSpacingHalfPt: 52,
    spaceAfterHalfPt: 18,
    autoFit: "shrink",
  }));

  // Signature block, anchored bottom-right of the writable column.
  const signY = ctx.deck.height - signOffH - ctx.cm(0.8);
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: margin, y: signY, cx: writableWidth, cy: ctx.cm(0.6) },
    valign: "top",
    paragraphs: [{
      align: "left",
      runs: [{ text: signoff, sizeHalfPt: 22, color: ctx.color("text-strong"), italic: true, cjk: ctx.cjk, fontFace }],
    }],
  });
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: margin, y: signY + ctx.cm(0.7), cx: writableWidth, cy: ctx.cm(0.8) },
    valign: "top",
    autoFit: "shrink",
    paragraphs: [{
      align: "left",
      runs: [{
        text: signature,
        sizeHalfPt: 26,
        color: ctx.color("text-strong"),
        bold: true,
        cjk: ctx.cjk,
        fontFace,
      }],
    }],
  });
  if (signRole) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: margin, y: signY + ctx.cm(1.5), cx: writableWidth, cy: ctx.cm(0.6) },
      valign: "top",
      paragraphs: [{
        align: "left",
        runs: [{
          text: signRole,
          sizeHalfPt: 18,
          color: ctx.color("text-muted"),
          italic: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
  }

  return out;
};

export default letter;
