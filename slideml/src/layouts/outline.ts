import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { bulletsBlock, contentRect, slideTitle } from "../render/primitives.js";

/**
 * Multi-level outline. Like `agenda` but supports nested sections via
 * the existing `{ text, sub: [...] }` bullets vocabulary. Use for
 * book / report ToC, course syllabus, multi-day event programme.
 *
 * Visual contract: numbered top-level entries, indented sub-items
 * with the theme's bullet glyph.
 */
export const slots: Record<string, SlotSchema> = {
  title: { type: "text",    maxChars: 60, optional: true },
  items: { type: "bullets", min: 2, max: 8, itemMaxChars: 100 },
};

const outline: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title") ?? (ctx.cjk ? "目录" : "Outline");
  const items = (ctx.slot<unknown[]>("items") ?? []);
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  out.push(...slideTitle(ctx, title));

  // Render the top-level numerals manually + sub-items via bulletsBlock.
  // We pass the original nested items but render numerals as a parallel
  // column so the visual hierarchy reads "01 / 02 / 03" + indented subs.
  const top = ctx.cm(4.4);
  const body = contentRect(ctx, { top, marginX: ctx.cm(2.4), bottom: ctx.cm(1.6) });
  const numColW = ctx.cm(1.6);
  const textColX = body.x + numColW + ctx.cm(0.4);
  const textColW = body.width - (numColW + ctx.cm(0.4));

  // Compute top-level entry vertical slots; sub-items extend their slot.
  const topEntries = items as Array<unknown>;
  const totalSubCount = topEntries.reduce<number>((acc, item) => {
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      const o = item as { sub?: unknown };
      if (Array.isArray(o.sub)) return acc + o.sub.length;
    }
    return acc;
  }, 0);
  const topRowH = ctx.cm(1.0);
  const subRowH = ctx.cm(0.7);
  const usedH = topEntries.length * topRowH + totalSubCount * subRowH;
  const startY = body.y + Math.max(0, Math.floor((body.height - usedH) / 2));
  let cursorY = startY;

  topEntries.forEach((item, idx) => {
    const itemText = typeof item === "string"
      ? item
      : (item && typeof item === "object" && !Array.isArray(item) && typeof (item as { text?: unknown }).text === "string"
          ? (item as { text: string }).text
          : String(item ?? ""));
    const sub: unknown[] = (item && typeof item === "object" && !Array.isArray(item) && Array.isArray((item as { sub?: unknown }).sub))
      ? (item as { sub: unknown[] }).sub
      : [];

    // Numeral
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: body.x, y: cursorY, cx: numColW, cy: topRowH },
      valign: "middle",
      paragraphs: [{
        align: "right",
        runs: [{
          text: String(idx + 1).padStart(2, "0"),
          sizeHalfPt: 30,
          color: ctx.color("brand-primary"),
          bold: true,
          fontFace: ctx.font("latin"),
        }],
      }],
    });
    // Heading
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: textColX, y: cursorY, cx: textColW, cy: topRowH },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{
          text: itemText,
          sizeHalfPt: 26,
          color: ctx.color("text-strong"),
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
    cursorY += topRowH;

    // Sub-items via bulletsBlock (single-level — pass strings).
    if (sub.length > 0) {
      const subStrings = sub.map((s) => typeof s === "string" ? s : (s && typeof s === "object" && typeof (s as { text?: unknown }).text === "string" ? (s as { text: string }).text : String(s)));
      out.push(...bulletsBlock(ctx, {
        x: textColX,
        y: cursorY,
        width: textColW,
        height: sub.length * subRowH,
      }, subStrings, { sizeHalfPt: 20, color: "text-muted", lineSpacingHalfPt: 40, spaceAfterHalfPt: 8 }));
      cursorY += sub.length * subRowH + ctx.cm(0.1);
    }
  });

  return out;
};

export default outline;
