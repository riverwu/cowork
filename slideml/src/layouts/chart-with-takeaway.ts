import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ChartShape, ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { bestTextOn, slideTitle } from "../render/primitives.js";

export const slots: Record<string, SlotSchema> = {
  title:    { type: "text",            maxChars: 50 },
  chart:    { type: "chart-spec" },
  takeaway: { type: "markdown-inline", maxChars: 160, optional: true },
};

interface ChartSpec {
  type: "bar" | "line" | "pie";
  data: { labels: string[]; series: Array<{ name: string; values: number[] }> };
  format?: { y?: "int" | "decimal" | "percent" | "wanyuan" | "yi" };
  title?: string;
}

const chartWithTakeaway: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title") ?? "";
  const chart = ctx.slot<ChartSpec>("chart");
  const takeaway = ctx.slot<string>("takeaway");
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  out.push(...slideTitle(ctx, title));

  // Chart fills the upper region; takeaway sits below it.
  const chartTop = ctx.cm(4.0);
  const takeawayHeight = takeaway ? ctx.cm(2.0) : 0;
  const chartHeight = ctx.deck.height - chartTop - ctx.cm(2) - takeawayHeight - (takeaway ? ctx.cm(0.4) : 0);

  if (chart) {
    const chartShape: ChartShape = {
      type: "chart",
      id: ctx.id(),
      xfrm: { x: ctx.cm(2), y: chartTop, cx: ctx.deck.width - ctx.cm(4), cy: chartHeight },
      chartType: chart.type,
      labels: chart.data.labels,
      series: chart.data.series,
      yFormat: chart.format?.y ?? "int",
      title: chart.title,
      // Series palette: pick colors that are visually distinct from
      // bg-canvas across both light and dark themes. brand-deep is
      // unsafe — in dark themes it tends to be near-canvas.
      colors: [ctx.color("brand-primary"), ctx.color("accent"), ctx.color("text-muted")],
      showValues: chart.type !== "pie",
    };
    out.push(chartShape);
  }

  if (takeaway) {
    const pos = {
      x: ctx.cm(2),
      y: chartTop + chartHeight + ctx.cm(0.4),
      cx: ctx.deck.width - ctx.cm(4),
      cy: takeawayHeight,
    };
    const panelColor = ctx.color("brand-deep");
    const takeawayTextColor = bestTextOn(ctx, panelColor);
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "roundRect",
      xfrm: pos,
      fill: { type: "solid", color: panelColor },
      line: { color: ctx.color("brand-primary"), width: ctx.pt(1) },
      cornerRadius: 0.05,
    });
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: pos,
      valign: "middle",
      margin: { l: ctx.cm(0.6), r: ctx.cm(0.6), t: ctx.cm(0.3), b: ctx.cm(0.3) },
      paragraphs: [{
        align: "left",
        runs: [{
          text: takeaway.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").replace(/`(.*?)`/g, "$1"),
          sizeHalfPt: 26,
          // Pick white vs theme text-strong by luminance — fixes
          // dark-text-on-dark-panel for light themes.
          color: takeawayTextColor,
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
  }

  return out;
};

export default chartWithTakeaway;
