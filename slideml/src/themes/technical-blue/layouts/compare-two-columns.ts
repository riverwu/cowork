import type { LayoutContext, LayoutFn } from "../../../render/layout-context.js";
import type { ShapeList } from "../../../emitter/types.js";
import type { SlotSchema } from "../../../theme/types.js";

export const slots: Record<string, SlotSchema> = {
  title:    { type: "text",       maxChars: 50, optional: true },
  leftTitle:  { type: "text",       maxChars: 30 },
  leftBody:   { type: "text-block", maxChars: 280 },
  rightTitle: { type: "text",       maxChars: 30 },
  rightBody:  { type: "text-block", maxChars: 280 },
};

const compareTwoColumns: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const leftTitle = ctx.slot<string>("leftTitle") ?? "";
  const leftBody = textBlock(ctx.slot<unknown>("leftBody"));
  const rightTitle = ctx.slot<string>("rightTitle") ?? "";
  const rightBody = textBlock(ctx.slot<unknown>("rightBody"));
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  let bodyTop = ctx.cm(2);
  if (title) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(2), y: ctx.cm(1.4), cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(1.6) },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{
          text: title,
          sizeHalfPt: 44,
          color: ctx.color("text-strong"),
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: ctx.cm(2), y: ctx.cm(3.2), cx: ctx.cm(2.4), cy: ctx.cm(0.12) },
      fill: { type: "solid", color: ctx.color("brand-primary") },
    });
    bodyTop = ctx.cm(4.2);
  }

  const colHeight = ctx.deck.height - bodyTop - ctx.cm(2);
  const cols: Array<{ x: number; w: number; title: string; body: string; accent: string }> = [
    { ...ctx.gridCol(0, 2, { gap: ctx.cm(1.2) }), title: leftTitle, body: leftBody, accent: ctx.color("brand-primary") },
    { ...ctx.gridCol(1, 2, { gap: ctx.cm(1.2) }), title: rightTitle, body: rightBody, accent: ctx.color("accent") },
  ].map((c, i) => {
    const cell = ctx.gridCol(i, 2, { gap: ctx.cm(1.2) });
    return { x: cell.x, w: cell.width, title: c.title, body: c.body, accent: c.accent };
  });

  for (const col of cols) {
    // Card backing
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "roundRect",
      xfrm: { x: col.x, y: bodyTop, cx: col.w, cy: colHeight },
      fill: { type: "solid", color: ctx.color("bg-card") },
      line: { color: ctx.color("divider"), width: ctx.pt(0.5) },
      cornerRadius: 0.03,
    });
    // Accent rule top
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: col.x, y: bodyTop, cx: col.w, cy: ctx.cm(0.12) },
      fill: { type: "solid", color: col.accent },
    });
    // Title
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: col.x + ctx.cm(0.6), y: bodyTop + ctx.cm(0.6), cx: col.w - ctx.cm(1.2), cy: ctx.cm(1.0) },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{
          text: col.title,
          sizeHalfPt: 32,
          color: ctx.color("text-strong"),
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
    // Body — supports paragraph splits on blank lines
    const paras = col.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: col.x + ctx.cm(0.6), y: bodyTop + ctx.cm(2.0), cx: col.w - ctx.cm(1.2), cy: colHeight - ctx.cm(2.6) },
      valign: "top",
      paragraphs: (paras.length > 0 ? paras : [col.body]).map((p) => ({
        align: "left",
        lineSpacingHalfPt: 56,
        spaceAfterHalfPt: 20,
        runs: [{
          text: p,
          sizeHalfPt: 26,
          color: ctx.color("text-strong"),
          cjk: ctx.cjk,
          fontFace,
        }],
      })),
    });
  }

  return out;
};

export default compareTwoColumns;

// Lenient text-block accessor — accepts either a string or a string[]
// (joined with paragraph breaks). Mirrors the validator's accommodation.
function textBlock(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return (value as string[]).join("\n\n");
  }
  return "";
}
