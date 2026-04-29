/**
 * Polymorphic visual content — `Visual` is a discriminated union over the
 * four kinds of "thing-you-show-on-a-slide": image, chart, table, svg.
 *
 * Layouts that want to display *any* visual side-by-side with text /
 * annotations / takeaways accept a `visual` slot and call `renderVisual`
 * to emit the right shapes for the given kind. Replaces per-kind layouts
 * (chart-with-takeaway, etc.) for cases where the design treatment is
 * the same regardless of visual kind.
 *
 * Not the right primitive for kind-specific design (image-full-bleed,
 * hero-image-overlay, image-pair, image-grid-2x2, data-table) — those
 * encode visual-kind-specific layout decisions and stay separate.
 *
 * Back-compat: `coerceVisual` accepts the legacy un-tagged shapes
 * (image-ref `{ src }`, chart-spec `{ type, data }`, table `{ header,
 * rows }`) so existing decks keep rendering. New decks should pass the
 * tagged form `{ kind: "image" | "chart" | "table" | "svg", ... }`.
 */

import type { LayoutContext } from "./layout-context.js";
import type { ChartShape, ShapeList, TableCell } from "../emitter/types.js";
import {
  chartAnnotationOverlay,
  imageOrPlaceholder,
  inferTableAlign,
  tableCellOf,
} from "./primitives.js";

// ---------------------------------------------------------------------------
// SVG → high-resolution raster helper
// ---------------------------------------------------------------------------

/**
 * Force the rasterizer (LibreOffice / PowerPoint when not using svgBlip
 * native vector display) to render an SVG at a high pixel target rather
 * than at the OOXML display size. PowerPoint and LibreOffice both
 * rasterize SVGs at the intrinsic dimensions declared on the root
 * `<svg>` tag — without explicit width/height attributes they fall back
 * to the OOXML xfrm size (typically ~400-500 px on a normal slide
 * column) which looks blurry when the deck is zoomed or projected.
 *
 * Strategy: inject (or replace) `width=`/`height=` on the root tag with
 * a generous pixel value (default 2400 — enough for 4K projection and
 * reasonable zoom). The viewBox stays untouched so coordinates inside
 * the SVG don't change. preserveAspectRatio is also injected if absent
 * so the rasterizer doesn't squish to non-square dimensions.
 *
 * Used by every `data:image/svg+xml,...` emit point in the pipeline —
 * agents that pass a custom SVG via `{ kind: "svg", svg: "..." }` get
 * sharpness for free, and built-in SVG primitives (sparkline) too.
 */
const SVG_RASTER_TARGET_PX = 2400;

export function svgToHighResDataUrl(svg: string, targetPx: number = SVG_RASTER_TARGET_PX): string {
  const upsized = upsizeSvgForRaster(svg, targetPx);
  return `data:image/svg+xml;utf8,${encodeURIComponent(upsized)}`;
}

function upsizeSvgForRaster(svg: string, targetPx: number): string {
  const trimmed = svg.trim();
  // Find the opening <svg ...> tag (case-insensitive).
  const m = /^<svg\b([^>]*)>/i.exec(trimmed);
  if (!m) return trimmed;
  const attrs = m[1] ?? "";
  // If width AND height are already set explicitly to a pixel value
  // larger than the target, leave it alone. Otherwise replace.
  const widthMatch = /\bwidth\s*=\s*["']([^"']+)["']/i.exec(attrs);
  const heightMatch = /\bheight\s*=\s*["']([^"']+)["']/i.exec(attrs);
  const enoughWidth = widthMatch && parsePx(widthMatch[1]!) >= targetPx;
  const enoughHeight = heightMatch && parsePx(heightMatch[1]!) >= targetPx;
  if (enoughWidth && enoughHeight) return trimmed;

  let rebuilt = attrs;
  rebuilt = stripAttr(rebuilt, "width");
  rebuilt = stripAttr(rebuilt, "height");
  // Honor the SVG's aspect ratio when viewBox is present: target pixels
  // on the longer side; scale the shorter side to match.
  const viewBox = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
  let pxW = targetPx;
  let pxH = targetPx;
  if (viewBox) {
    const parts = viewBox.split(/\s+|,/).map(Number).filter((n) => !Number.isNaN(n));
    if (parts.length === 4) {
      const vbW = parts[2]!;
      const vbH = parts[3]!;
      if (vbW > 0 && vbH > 0) {
        const ratio = vbW / vbH;
        if (ratio >= 1) { pxH = Math.round(targetPx / ratio); }
        else            { pxW = Math.round(targetPx * ratio); }
      }
    }
  }
  rebuilt = `${rebuilt.trimEnd()} width="${pxW}" height="${pxH}"`;
  if (!/\bxmlns\s*=/i.test(rebuilt)) {
    rebuilt = ` xmlns="http://www.w3.org/2000/svg"${rebuilt}`;
  }
  return `<svg${rebuilt}>${trimmed.slice(m[0].length)}`;
}

function parsePx(value: string): number {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : 0;
}

function stripAttr(attrs: string, name: string): string {
  return attrs.replace(new RegExp(`\\s+${name}\\s*=\\s*["'][^"']*["']`, "ig"), "");
}

// ---------------------------------------------------------------------------
// Visual union
// ---------------------------------------------------------------------------

export interface VisualImage {
  kind: "image";
  src: string;
  alt?: string;
  fit?: "contain" | "cover";
  shape?: "rounded" | "circle";
  border?: { color: string; width?: number };
  overlay?: { color: string; alpha?: number };
}

export interface VisualChart {
  kind: "chart";
  chartType: ChartShape["chartType"];
  data: {
    labels: string[];
    series: Array<{
      name: string;
      values?: number[];
      type?: "bar" | "line";
      points?: Array<{ x: number; y: number }>;
    }>;
  };
  format?: { y?: ChartShape["yFormat"] };
  title?: string;
  annotations?: Array<{
    at?: number;
    range?: [number, number];
    label: string;
    style?: "callout" | "marker" | "band";
  }>;
}

export interface VisualTable {
  kind: "table";
  header: string[];
  rows: unknown[][];
  colWidths?: number[];
  align?: Array<"left" | "center" | "right">;
}

export interface VisualSvg {
  kind: "svg";
  svg: string;
  alt?: string;
}

export type Visual = VisualImage | VisualChart | VisualTable | VisualSvg;

export const VISUAL_KINDS = ["image", "chart", "table", "svg"] as const;

// ---------------------------------------------------------------------------
// Coercion: accept tagged Visual OR legacy un-tagged shapes
// ---------------------------------------------------------------------------

/**
 * Convert any of the supported input shapes into a tagged Visual.
 *
 * Accepts (in priority order):
 *   1. Already-tagged Visual: `{ kind: "image"|"chart"|"table"|"svg", ... }`
 *   2. Plain string         → image-ref (treated as `{ kind: "image", src }`)
 *   3. image-ref shape      → image (has `src` field)
 *   4. chart-spec shape     → chart (has `type` field with chart-shape literal,
 *                                    OR has `data.labels` array + `series`)
 *   5. table shape          → table (has `header` and `rows` arrays)
 *
 * Returns null when nothing matches — caller should treat as "no visual".
 */
export function coerceVisual(input: unknown): Visual | null {
  if (input === undefined || input === null) return null;
  if (typeof input === "string") {
    return input.length > 0 ? { kind: "image", src: input } : null;
  }
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;

  // Already tagged.
  if (typeof o.kind === "string") {
    if ((VISUAL_KINDS as readonly string[]).includes(o.kind)) {
      return o as unknown as Visual;
    }
    return null;
  }

  // Legacy SVG inline form (rare, but cheap to detect).
  if (typeof o.svg === "string") {
    return { kind: "svg", svg: o.svg, alt: typeof o.alt === "string" ? o.alt : undefined };
  }

  // image-ref: `{ src, ... }`
  if (typeof o.src === "string") {
    return { kind: "image", ...(o as Omit<VisualImage, "kind">) } as VisualImage;
  }

  // table: `{ header: [...], rows: [...] }`
  if (Array.isArray(o.header) && Array.isArray(o.rows)) {
    return { kind: "table", ...(o as Omit<VisualTable, "kind">) } as VisualTable;
  }

  // chart-spec: `{ type: "bar"|... , data: { labels, series } }`
  if (typeof o.type === "string" && o.data && typeof o.data === "object") {
    const data = o.data as { labels?: unknown; series?: unknown };
    if (Array.isArray(data.labels) && Array.isArray(data.series)) {
      // Rename `type` → `chartType` so downstream handlers see the
      // tagged shape. Existing chart-spec layouts use `type` directly,
      // but the Visual union uses `chartType` to avoid a name collision
      // with the kind discriminator.
      return {
        kind: "chart",
        chartType: o.type as VisualChart["chartType"],
        data: o.data as VisualChart["data"],
        format: (o.format ?? undefined) as VisualChart["format"],
        title: typeof o.title === "string" ? o.title : undefined,
        annotations: (o.annotations ?? undefined) as VisualChart["annotations"],
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Render: emit the right shapes for the given Visual + rect
// ---------------------------------------------------------------------------

export interface VisualRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Render a Visual into the given rect. Caller owns rect placement and any
 * surrounding chrome (title, caption, panel) — this fn just emits the
 * visual content shapes.
 */
export function renderVisual(
  ctx: LayoutContext,
  rect: VisualRect,
  visual: Visual,
): ShapeList {
  switch (visual.kind) {
    case "image": return renderImage(ctx, rect, visual);
    case "svg":   return renderSvg(ctx, rect, visual);
    case "chart": return renderChart(ctx, rect, visual);
    case "table": return renderTable(ctx, rect, visual);
  }
}

function renderImage(ctx: LayoutContext, rect: VisualRect, v: VisualImage): ShapeList {
  return imageOrPlaceholder(ctx, rect, {
    src: v.src,
    alt: v.alt,
    fit: v.fit,
    shape: v.shape,
    border: v.border,
    overlay: v.overlay,
  });
}

function renderSvg(ctx: LayoutContext, rect: VisualRect, v: VisualSvg): ShapeList {
  return [{
    type: "image",
    id: ctx.id(),
    xfrm: { x: rect.x, y: rect.y, cx: rect.width, cy: rect.height },
    src: svgToHighResDataUrl(v.svg),
    altText: v.alt ?? "svg",
  }];
}

function renderChart(ctx: LayoutContext, rect: VisualRect, v: VisualChart): ShapeList {
  const chartShape: ChartShape = {
    type: "chart",
    id: ctx.id(),
    xfrm: { x: rect.x, y: rect.y, cx: rect.width, cy: rect.height },
    chartType: v.chartType,
    labels: v.data.labels,
    series: v.data.series.map((s) => ({
      name: s.name,
      values: s.values ?? [],
      ...(s.type ? { type: s.type } : {}),
      ...(s.points ? { points: s.points } : {}),
    })),
    yFormat: v.format?.y ?? "int",
    title: v.title,
    colors: [ctx.color("brand-primary"), ctx.color("accent"), ctx.color("text-muted")],
    showValues: v.chartType !== "pie" && v.chartType !== "doughnut" && v.chartType !== "scatter",
    annotations: v.annotations,
  };
  const out: ShapeList = [chartShape];
  out.push(...chartAnnotationOverlay(ctx, rect, v.data.labels, v.annotations));
  return out;
}

function renderTable(ctx: LayoutContext, rect: VisualRect, v: VisualTable): ShapeList {
  const cols = v.header.length;
  const weights = v.colWidths && v.colWidths.length === cols ? v.colWidths : Array(cols).fill(1);
  const sum = weights.reduce((a, b) => a + b, 0);
  const colWidths = weights.map((w) => Math.floor((rect.width * w) / sum));
  const rowCount = 1 + v.rows.length;
  const headerH = ctx.cm(0.7);
  const bodyRowH = Math.floor((rect.height - headerH) / Math.max(1, rowCount - 1));
  const colAlign = v.align ?? [];
  const cells: TableCell[][] = [
    v.header.map((h, ci) => tableCellOf(ctx, h, {
      sizeHalfPt: 20,
      baseColor: "FFFFFF",
      bold: true,
      align: colAlign[ci] ?? "left",
      fill: { color: ctx.color("brand-deep") },
    })),
    ...v.rows.map((r, ri) => r.map((c, ci) => tableCellOf(ctx, c, {
      sizeHalfPt: 18,
      align: inferTableAlign(c, colAlign[ci]),
      fill: ri % 2 === 1 ? { color: ctx.color("bg-card") } : undefined,
    }))),
  ];
  return [{
    type: "table",
    id: ctx.id(),
    xfrm: { x: rect.x, y: rect.y, cx: rect.width, cy: rect.height },
    colWidths,
    rowHeights: [headerH, ...Array(v.rows.length).fill(bodyRowH)],
    cells,
    firstRowHeader: true,
    borderColor: ctx.color("divider"),
    borderWidth: ctx.pt(0.5),
  }];
}
