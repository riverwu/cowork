import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { bodyTopAfterTitle, card, contentRect, gridCols, slideTitle } from "../render/primitives.js";

export const slots: Record<string, SlotSchema> = {
  title: { type: "text", maxChars: 40, optional: true },
  // Slot value validation for shape-typed entries lands fully in Stage 4.
  // Until then, the layout reads `items` as `KpiItem[]` and ignores extra fields.
  items: { type: "bullets", min: 3, max: 3, itemMaxChars: 64 },
  // Visual style. "tile" (default) renders each KPI on a card backing.
  // "minimal" drops the card and uses pure type hierarchy — better for
  // restrained themes (charcoal-minimal, editorial-paper).
  style: { type: "enum", values: ["tile", "minimal"], default: "tile", optional: true },
};

interface KpiItem {
  value: string;
  label: string;
  delta?: string;
  trend?: "up" | "down" | "flat";
}

const statGrid3: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const items = (ctx.slot<KpiItem[]>("items") ?? []).slice(0, 3);
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  if (title) out.push(...slideTitle(ctx, title));

  // Three KPI tiles. This layout uses CENTERED text + large value (sz 40pt)
  // — visually distinct from the inline kpiTile primitive (left-aligned,
  // smaller). Kept inline rather than over-parameterizing the primitive.
  const tileBand = contentRect(ctx, {
    top: title ? ctx.cm(4.6) : bodyTopAfterTitle(ctx, undefined),
    bottom: ctx.cm(2),
  });
  const cells = gridCols(ctx, tileBand, 3, { gap: ctx.cm(0.8) });

  const style = ctx.slot<string>("style") ?? "tile";
  cells.forEach((cell, i) => {
    const item = items[i] ?? { value: "—", label: "" };
    if (style === "tile") out.push(...card(ctx, cell));

    // KPI value (large, centered).
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: cell.x, y: cell.y + ctx.cm(1.0), cx: cell.width, cy: ctx.cm(2.4) },
      valign: "middle",
      paragraphs: [{
        align: "center",
        runs: [{
          text: String(item.value ?? "—"),
          sizeHalfPt: 80,
          color: ctx.color("brand-primary"),
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });

    // Label.
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: cell.x, y: cell.y + ctx.cm(3.6), cx: cell.width, cy: ctx.cm(1.0) },
      valign: "middle",
      paragraphs: [{
        align: "center",
        runs: [{
          text: String(item.label ?? ""),
          sizeHalfPt: 24,
          color: ctx.color("text-muted"),
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });

    if (item.delta) {
      const trendColor =
        item.trend === "down" ? ctx.color("accent") : ctx.color("brand-primary");
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: cell.x, y: cell.y + ctx.cm(4.8), cx: cell.width, cy: ctx.cm(0.9) },
        valign: "middle",
        paragraphs: [{
          align: "center",
          runs: [{
            text: String(item.delta),
            sizeHalfPt: 22,
            color: trendColor,
            bold: true,
            cjk: ctx.cjk,
            fontFace,
          }],
        }],
      });
    }
  });

  return out;
};

export default statGrid3;
