import type { LayoutContext, LayoutFn } from "../../../render/layout-context.js";
import type { ShapeList } from "../../../emitter/types.js";
import type { SlotSchema } from "../../../theme/types.js";

export const slots: Record<string, SlotSchema> = {
  title: { type: "text", maxChars: 40 },
  // Slot value validation for shape-typed entries lands fully in Stage 4.
  // Until then, the layout reads `items` as `KpiItem[]` and ignores extra fields.
  items: { type: "bullets", min: 3, max: 3, itemMaxChars: 64 },
};

interface KpiItem {
  value: string;
  label: string;
  delta?: string;
  trend?: "up" | "down" | "flat";
}

const statGrid3: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title") ?? "";
  const items = (ctx.slot<KpiItem[]>("items") ?? []).slice(0, 3);
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  // Title bar.
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

  // Decorative cyan rule under the title.
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: { x: ctx.cm(2), y: ctx.cm(3.2), cx: ctx.cm(2.4), cy: ctx.cm(0.12) },
    fill: { type: "solid", color: ctx.color("brand-primary") },
  });

  // Three KPI cards.
  const tileTop = ctx.cm(4.6);
  const tileHeight = ctx.cm(6.6);

  for (let i = 0; i < 3; i++) {
    const cell = ctx.gridCol(i, 3, { gap: ctx.cm(0.8), marginX: ctx.cm(2) });
    const item = items[i] ?? { value: "—", label: "" };

    // Card.
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "roundRect",
      xfrm: { x: cell.x, y: tileTop, cx: cell.width, cy: tileHeight },
      fill: { type: "solid", color: ctx.color("bg-card") },
      line: { color: ctx.color("divider"), width: ctx.pt(0.5) },
      cornerRadius: 0.04,
    });

    // KPI value (large).
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: cell.x, y: tileTop + ctx.cm(1.0), cx: cell.width, cy: ctx.cm(2.4) },
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
      xfrm: { x: cell.x, y: tileTop + ctx.cm(3.6), cx: cell.width, cy: ctx.cm(1.0) },
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

    // Delta (optional).
    if (item.delta) {
      const trendColor =
        item.trend === "down" ? ctx.color("accent") : ctx.color("brand-primary");
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: cell.x, y: tileTop + ctx.cm(4.8), cx: cell.width, cy: ctx.cm(0.9) },
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
  }

  return out;
};

export default statGrid3;
