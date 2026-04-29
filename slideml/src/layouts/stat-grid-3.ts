import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { bodyTopAfterTitle, card, contentRect, gridCols, slideTitle } from "../render/primitives.js";

export const slots: Record<string, SlotSchema> = {
  title: { type: "text", maxChars: 28, optional: true },
  // Slot value validation for shape-typed entries lands fully in Stage 4.
  // Until then, the layout reads `items` as `KpiItem[]` and ignores extra fields.
  items: { type: "bullets", min: 3, max: 3, itemMaxChars: 45 },
  // Visual style. "tile" (default) renders each KPI on a card backing.
  // "minimal" drops the card and uses pure type hierarchy — better for
  // restrained themes (charcoal-minimal, editorial-paper).
  style: { type: "enum", values: ["tile", "minimal"], default: "tile", optional: true },
};

interface KpiItem {
  // Canonical pair is `value` (big number) + `label` (small caption) +
  // `delta` (optional bottom annotation). Agents reach for `{ label,
  // detail }` ~30% of the time (label = metric name, detail = the data
  // itself), so accept synonyms and promote sensibly when `value` is
  // missing — see normalizeKpi() below.
  value?: string;
  number?: string;       // synonym for value
  metric?: string;       // synonym for value
  label?: string;
  name?: string;         // synonym for label
  title?: string;        // synonym for label
  delta?: string;
  detail?: string;       // synonym for delta — agent's most common spelling
  description?: string;  // synonym for delta
  sublabel?: string;     // synonym for delta
  caption?: string;      // synonym for delta — agent reaches for this when label = metric name
  body?: string;         // synonym for delta
  trend?: "up" | "down" | "flat";
}

interface NormalizedKpi {
  value: string;
  label: string;
  delta?: string;
  trend?: "up" | "down" | "flat";
}

/**
 * Reduce the polymorphic input shape to {value, label, delta?, trend?}.
 * When `value` is absent but a delta-shaped field carries the actual
 * content, promote it to value so the slide shows real data instead of
 * the em-dash placeholder. Long promoted values rely on the value
 * shape's autoFit to shrink rather than overflow horizontally.
 */
function normalizeKpi(raw: KpiItem): NormalizedKpi {
  const value = raw.value ?? raw.number ?? raw.metric;
  const label = raw.label ?? raw.name ?? raw.title ?? "";
  const delta = raw.delta ?? raw.detail ?? raw.description ?? raw.sublabel ?? raw.caption ?? raw.body;
  if (!value && delta) {
    // Promote delta → value so something meaningful renders, drop the
    // bottom-line slot entirely (it would otherwise duplicate the value).
    return { value: delta, label, trend: raw.trend };
  }
  return { value: value ?? "", label, delta, trend: raw.trend };
}

const statGrid3: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const items = (ctx.slot<KpiItem[]>("items") ?? []).slice(0, 3).map(normalizeKpi);
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
    const item: NormalizedKpi = items[i] ?? { value: "", label: "" };
    if (style === "tile") out.push(...card(ctx, cell));

    // KPI value (large, centered). When value is empty (agent supplied
    // only label/detail), skip rendering the dash placeholder — earlier
    // versions emitted "—" which read as a horizontal line, not data.
    // autoFit lets long promoted-detail strings shrink to fit.
    if (item.value) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: cell.x, y: cell.y + ctx.cm(1.0), cx: cell.width, cy: ctx.cm(2.4) },
        valign: "middle",
        autoFit: "shrink",
        paragraphs: [{
          align: "center",
          runs: [{
            text: item.value,
            sizeHalfPt: 80,
            color: ctx.color("brand-primary"),
            bold: true,
            cjk: ctx.cjk,
            fontFace,
          }],
        }],
      });
    }

    // Label.
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: cell.x, y: cell.y + ctx.cm(3.6), cx: cell.width, cy: ctx.cm(1.0) },
      valign: "middle",
      paragraphs: [{
        align: "center",
        runs: [{
          text: item.label,
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
