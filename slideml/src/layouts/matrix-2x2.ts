import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { contentRect, slideTitle } from "../render/primitives.js";
import { computeRegionTopInset, renderRegion, type Region } from "../render/regions.js";

/**
 * 2x2 matrix — four polymorphic region cells laid out as a quadrant grid
 * with optional axis labels. Use for BCG-matrix-style frameworks
 * (priority/effort, urgency/importance, growth/profitability, …).
 *
 * Cells are the same `region` polymorphic type used by `dashboard` and
 * the split-N layouts: kpi | chart | table | text | bullets | image |
 * code | quote.
 */
export const slots: Record<string, SlotSchema> = {
  title:    { type: "text",   maxChars: 50, optional: true },
  xLabel:   { type: "text",   maxChars: 32, optional: true },
  yLabel:   { type: "text",   maxChars: 32, optional: true },
  topLeft:  { type: "region" },
  topRight: { type: "region" },
  botLeft:  { type: "region" },
  botRight: { type: "region" },
};

const matrix2x2: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const xLabel = ctx.slot<string>("xLabel");
  const yLabel = ctx.slot<string>("yLabel");
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  if (title) out.push(...slideTitle(ctx, title));

  // Reserve room for axis labels on the left + bottom.
  const top = title ? ctx.cm(4.4) : ctx.cm(2);
  const yLabelW = yLabel ? ctx.cm(0.8) : 0;
  const xLabelH = xLabel ? ctx.cm(0.8) : 0;
  const body = contentRect(ctx, { top, marginX: ctx.cm(2) });
  const matrixX = body.x + yLabelW;
  const matrixY = body.y;
  const matrixW = body.width - yLabelW;
  const matrixH = body.height - xLabelH;
  const gap = ctx.cm(0.4);
  const cellW = Math.floor((matrixW - gap) / 2);
  const cellH = Math.floor((matrixH - gap) / 2);

  // Quadrant grid: TL, TR, BL, BR.
  const tl = ctx.slot<Region>("topLeft");
  const tr = ctx.slot<Region>("topRight");
  const bl = ctx.slot<Region>("botLeft");
  const br = ctx.slot<Region>("botRight");
  // Each row's cells share a topInset for cellTitle baseline alignment.
  const topRowInset = computeRegionTopInset(ctx, [tl, tr]);
  const bottomRowInset = computeRegionTopInset(ctx, [bl, br]);
  if (tl) out.push(...renderRegion(ctx, { x: matrixX, y: matrixY, width: cellW, height: cellH }, tl, { topInset: topRowInset }));
  if (tr) out.push(...renderRegion(ctx, { x: matrixX + cellW + gap, y: matrixY, width: cellW, height: cellH }, tr, { topInset: topRowInset }));
  if (bl) out.push(...renderRegion(ctx, { x: matrixX, y: matrixY + cellH + gap, width: cellW, height: cellH }, bl, { topInset: bottomRowInset }));
  if (br) out.push(...renderRegion(ctx, { x: matrixX + cellW + gap, y: matrixY + cellH + gap, width: cellW, height: cellH }, br, { topInset: bottomRowInset }));

  // Axis labels — yLabel rotated 90° on the left, xLabel below the matrix.
  if (yLabel) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: body.x, y: matrixY, cx: yLabelW, cy: matrixH, rot: -5400000 },
      valign: "middle",
      paragraphs: [{
        align: "center",
        runs: [{ text: yLabel, sizeHalfPt: 22, color: ctx.color("text-muted"), bold: true, cjk: ctx.cjk, fontFace }],
      }],
    });
  }
  if (xLabel) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: matrixX, y: matrixY + matrixH, cx: matrixW, cy: xLabelH },
      valign: "middle",
      paragraphs: [{
        align: "center",
        runs: [{ text: xLabel, sizeHalfPt: 22, color: ctx.color("text-muted"), bold: true, cjk: ctx.cjk, fontFace }],
      }],
    });
  }

  return out;
};

export default matrix2x2;
