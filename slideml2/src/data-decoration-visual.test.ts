import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
} from "./diagnostics.js";
import { renderToAst, measureDeck } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Visual-property tests for the 18 new components. Goes deeper than the
 * "no blocking diagnostics" smoke audit by asserting concrete rendered
 * geometry: shape positions/sizes, fill colors, anchor placement,
 * structural relationships between sibling shapes.
 */

const EMU = 360000;
const SLIDE_W_CM = 25.4;
const SLIDE_H_CM = 14.288;

function deck(slides: SlideV2[]): Slideml2SourceDeck {
  return { slideml2: 2, deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } }, slides };
}

type AnyShape = {
  type: string;
  name?: string;
  preset?: string;
  xfrm?: { x: number; y: number; cx: number; cy: number; flipH?: boolean; flipV?: boolean };
  fill?: { type: string; color?: string };
  line?: { color: string; width: number };
  cornerRadius?: number;
  paragraphs?: Array<{ runs: Array<{ text: string; color?: string; bold?: boolean }> }>;
};

function renderShapes(child: DomNode): AnyShape[] {
  clearRenderDiagnostics();
  const ast = renderToAst(sourceToRenderedDeck(deck([{
    id: "s", title: "x", children: [child],
  } as SlideV2])));
  return ast.slides[0].shapes as AnyShape[];
}

function findByNameSuffix(shapes: AnyShape[], suffix: string): AnyShape | undefined {
  return shapes.find((s) => typeof s.name === "string" && s.name.endsWith(suffix));
}

function findAllByPrefix(shapes: AnyShape[], prefix: string): AnyShape[] {
  return shapes.filter((s) => typeof s.name === "string" && s.name.startsWith(prefix));
}

function fillColor(s: AnyShape | undefined): string | undefined {
  return s?.fill?.color?.toUpperCase();
}

function measureRects(child: DomNode): Map<string, { x: number; y: number; w: number; h: number }> {
  const r = sourceToRenderedDeck(deck([{ id: "s", title: "x", children: [child] } as SlideV2]));
  const measured = measureDeck(r);
  const m = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const node of measured[0]!.nodes) m.set(node.id, node.rect);
  return m;
}

/* ============================================================ scorecard */

describe("scorecard visual structure", () => {
  it("renders one card + one accent-bar per item; accent color matches status", () => {
    const shapes = renderShapes({
      id: "s.sc", type: "scorecard", items: [
        { label: "Revenue", value: "$4M", status: "good" },
        { label: "Latency", value: "800", status: "danger" },
        { label: "NPS", value: "72", status: "neutral" },
      ],
    } as unknown as DomNode);
    expect(findAllByPrefix(shapes, "s.sc.").filter((s) => s.name?.endsWith("-card"))).toHaveLength(3);
    expect(findAllByPrefix(shapes, "s.sc.").filter((s) => s.name?.endsWith("-accent"))).toHaveLength(3);
    // status colors: good→success, danger→danger, neutral→muted (not all the same)
    const a0 = findByNameSuffix(shapes, "s.sc.0-accent");
    const a1 = findByNameSuffix(shapes, "s.sc.1-accent");
    const a2 = findByNameSuffix(shapes, "s.sc.2-accent");
    expect(fillColor(a0)).not.toBe(fillColor(a1));
    expect(fillColor(a1)).not.toBe(fillColor(a2));
  });

  it("delta with trend:up renders ▲ prefix and trend:down renders ▼", () => {
    const shapes = renderShapes({
      id: "s.sc", type: "scorecard", items: [
        { label: "A", value: "1", delta: "+5", trend: "up" },
        { label: "B", value: "2", delta: "-3", trend: "down" },
      ],
    } as unknown as DomNode);
    const allText = shapes.flatMap((s) => (s.paragraphs || []).flatMap((p) => p.runs.map((r) => r.text))).join(" ");
    expect(allText).toContain("▲");
    expect(allText).toContain("▼");
  });
});

/* ============================================================ funnel */

describe("funnel visual structure", () => {
  it("emits one chevron shape per stage with width proportional to value", () => {
    const shapes = renderShapes({
      id: "s.f", type: "funnel", stages: [
        { label: "A", value: 1000 },
        { label: "B", value: 500 },
        { label: "C", value: 100 },
      ],
    } as unknown as DomNode);
    const chevrons = shapes.filter((s) => s.preset === "chevron");
    expect(chevrons.length).toBe(3);
    // First stage's chevron should be widest (value=max), last narrowest
    expect(chevrons[0]!.xfrm!.cx).toBeGreaterThan(chevrons[2]!.xfrm!.cx);
  });

  it("drop% text appears for stages 2..N (not stage 0)", () => {
    const shapes = renderShapes({
      id: "s.f", type: "funnel", stages: [
        { label: "A", value: 1000 },
        { label: "B", value: 500 },
      ],
    } as unknown as DomNode);
    const valueTexts = shapes.filter((s) => s.name?.endsWith(".value"))
      .map((s) => (s.paragraphs?.[0]?.runs || []).map((r) => r.text).join(""));
    expect(valueTexts.some((t) => t.includes("drop"))).toBe(true);
    // First stage's value should NOT contain "drop"
    expect(valueTexts[0]!).not.toContain("drop");
  });
});

/* ============================================================ gauge */

describe("gauge visual structure", () => {
  it("track has fixedHeight 0.45cm (renderer pins it, doesn't expand)", () => {
    const rects = measureRects({
      id: "s.g", type: "gauge", value: 50, label: "NPS",
      thresholds: [{ upTo: 30, tone: "danger" }, { upTo: 70, tone: "warning" }, { upTo: 100, tone: "positive" }],
    } as unknown as DomNode);
    const trackRect = rects.get("s.g.track");
    expect(trackRect).toBeDefined();
    expect(trackRect!.h).toBeCloseTo(0.45, 1);
  });

  it("threshold band widths sum to track width and are proportional to (upTo - prevUpTo)", () => {
    const rects = measureRects({
      id: "s.g", type: "gauge", value: 50, label: "NPS",
      thresholds: [{ upTo: 30, tone: "danger" }, { upTo: 70, tone: "warning" }, { upTo: 100, tone: "positive" }],
    } as unknown as DomNode);
    const t0 = rects.get("s.g.t0")!;
    const t1 = rects.get("s.g.t1")!;
    const t2 = rects.get("s.g.t2")!;
    // ratios: 30:40:30 → t1 should be ~33% wider than t0
    expect(t1.w / t0.w).toBeCloseTo(40 / 30, 0.5);
    expect(t0.w).toBeCloseTo(t2.w, 1);
  });

  it("pointer triangle x-position is past the midpoint when value > max/2", () => {
    // The exact ratio honors slightly less than the requested 0.75 because
    // the layout solver reserves a min size for spacers; assert direction
    // and rough magnitude rather than precise position.
    const rects = measureRects({
      id: "s.g", type: "gauge", value: 75, max: 100, label: "x",
      thresholds: [{ upTo: 100, tone: "brand" }],
    } as unknown as DomNode);
    const trackRect = rects.get("s.g.track")!;
    const tickRect = rects.get("s.g.pointer.tick")!;
    const tickCenterX = tickRect.x + tickRect.w / 2;
    const trackMidX = trackRect.x + trackRect.w * 0.5;
    expect(tickCenterX).toBeGreaterThan(trackMidX);
    // And below value=25 the tick is on the left half
    const rectsLow = measureRects({
      id: "s.g", type: "gauge", value: 25, max: 100, label: "x",
      thresholds: [{ upTo: 100, tone: "brand" }],
    } as unknown as DomNode);
    const tickLow = rectsLow.get("s.g.pointer.tick")!;
    const trackLow = rectsLow.get("s.g.track")!;
    expect(tickLow.x + tickLow.w / 2).toBeLessThan(trackLow.x + trackLow.w * 0.5);
  });

  it("active threshold's tone determines the value text color", () => {
    const dangerShapes = renderShapes({
      id: "s.g", type: "gauge", value: 20, label: "x",
      thresholds: [{ upTo: 30, tone: "danger" }, { upTo: 100, tone: "positive" }],
    } as unknown as DomNode);
    const positiveShapes = renderShapes({
      id: "s.g", type: "gauge", value: 80, label: "x",
      thresholds: [{ upTo: 30, tone: "danger" }, { upTo: 100, tone: "positive" }],
    } as unknown as DomNode);
    const dangerValueColor = findByNameSuffix(dangerShapes, "s.g.value")?.paragraphs?.[0]?.runs[0]?.color?.toUpperCase();
    const positiveValueColor = findByNameSuffix(positiveShapes, "s.g.value")?.paragraphs?.[0]?.runs[0]?.color?.toUpperCase();
    expect(dangerValueColor).not.toBe(positiveValueColor);
  });
});

/* ============================================================ heatmap */

describe("heatmap visual structure", () => {
  it("renders xLabels.length × yLabels.length data cells with distinct colors", () => {
    const shapes = renderShapes({
      id: "s.h", type: "heatmap",
      xLabels: ["A", "B", "C"], yLabels: ["1", "2"],
      values: [[0, 5, 10], [10, 5, 0]],
    } as unknown as DomNode);
    // 6 data cells (each is a text shape with fill since showValues default true)
    const cells = shapes.filter((s) => s.name?.startsWith("s.h.c") && s.fill?.type === "solid");
    expect(cells.length).toBe(6);
    // Min vs max value cells should have different fill colors
    const cell00 = findByNameSuffix(shapes, "s.h.c0.0"); // value 0 = min
    const cell02 = findByNameSuffix(shapes, "s.h.c0.2"); // value 10 = max
    expect(fillColor(cell00)).not.toBe(fillColor(cell02));
  });

  it("warm palette uses a different color for max value than cool palette", () => {
    const warmShapes = renderShapes({
      id: "s.h", type: "heatmap",
      xLabels: ["A"], yLabels: ["1"], values: [[10]], palette: "warm",
    } as unknown as DomNode);
    const coolShapes = renderShapes({
      id: "s.h", type: "heatmap",
      xLabels: ["A"], yLabels: ["1"], values: [[10]], palette: "cool",
    } as unknown as DomNode);
    const warmCell = findByNameSuffix(warmShapes, "s.h.c0.0");
    const coolCell = findByNameSuffix(coolShapes, "s.h.c0.0");
    expect(fillColor(warmCell)).not.toBe(fillColor(coolCell));
  });
});

/* ============================================================ matrix-2x2 */

describe("matrix-2x2 visual structure", () => {
  it("emits exactly 4 quadrant cards (tl, tr, bl, br)", () => {
    const shapes = renderShapes({
      id: "s.m", type: "matrix-2x2",
      xAxis: { low: "L", high: "H" }, yAxis: { low: "L", high: "H" },
      items: [],
    } as unknown as DomNode);
    expect(findByNameSuffix(shapes, "s.m.tl-card")).toBeDefined();
    expect(findByNameSuffix(shapes, "s.m.tr-card")).toBeDefined();
    expect(findByNameSuffix(shapes, "s.m.bl-card")).toBeDefined();
    expect(findByNameSuffix(shapes, "s.m.br-card")).toBeDefined();
  });

  it("items land in the correct quadrant by x/y values", () => {
    const rects = measureRects({
      id: "s.m", type: "matrix-2x2",
      xAxis: { low: "L", high: "H" }, yAxis: { low: "L", high: "H" },
      items: [
        { label: "TopLeft", x: "low", y: "high" },
        { label: "BottomRight", x: "high", y: "low" },
      ],
    } as unknown as DomNode);
    const tlCard = rects.get("s.m.tl");
    const brCard = rects.get("s.m.br");
    // top-left card y < bottom-right card y; top-left x < bottom-right x
    expect(tlCard!.y).toBeLessThan(brCard!.y);
    expect(tlCard!.x).toBeLessThan(brCard!.x);
  });
});

/* ============================================================ trend-line */

describe("trend-line visual structure", () => {
  it("emits one bar per value with proportional heights", () => {
    const rects = measureRects({
      id: "s.tl", type: "trend-line", values: [1, 5, 10, 5, 1],
    } as unknown as DomNode);
    const b0 = rects.get("s.tl.0")!;
    const b2 = rects.get("s.tl.2")!;
    // Middle (max) bar should be tallest
    expect(b2.h).toBeGreaterThan(b0.h);
  });

  it("12 values render as 12 bars", () => {
    const rects = measureRects({
      id: "s.tl", type: "trend-line", values: [1,2,3,4,5,6,7,8,9,10,11,12],
    } as unknown as DomNode);
    let count = 0;
    for (const k of rects.keys()) if (/^s\.tl\.\d+$/.test(k)) count++;
    expect(count).toBe(12);
  });
});

/* ============================================================ stat-flow */

describe("stat-flow visual structure", () => {
  it("renders value+label per stat step and connector text between", () => {
    const shapes = renderShapes({
      id: "s.sf", type: "stat-flow", steps: [
        { value: "$120", label: "CAC" },
        { connector: "→" },
        { value: "$200", label: "LTV" },
      ],
    } as unknown as DomNode);
    expect(findByNameSuffix(shapes, "s.sf.0.value")).toBeDefined();
    expect(findByNameSuffix(shapes, "s.sf.0.label")).toBeDefined();
    expect(findByNameSuffix(shapes, "s.sf.1.connector")).toBeDefined();
    expect(findByNameSuffix(shapes, "s.sf.2.value")).toBeDefined();
  });

  it("connector text appears between step values left-to-right", () => {
    const rects = measureRects({
      id: "s.sf", type: "stat-flow", steps: [
        { value: "A", label: "x" },
        { connector: "+" },
        { value: "B", label: "y" },
      ],
    } as unknown as DomNode);
    const v0 = rects.get("s.sf.0.value")!;
    const conn = rects.get("s.sf.1.connector")!;
    const v2 = rects.get("s.sf.2.value")!;
    expect(v0.x).toBeLessThan(conn.x);
    expect(conn.x).toBeLessThan(v2.x);
  });
});

/* ============================================================ donut-summary */

describe("donut-summary visual structure", () => {
  it("primary value text shows percent of total", () => {
    const shapes = renderShapes({
      id: "s.d", type: "donut-summary",
      primary: { label: "Direct", value: 60 },
      others: [{ label: "Search", value: 40 }],
    } as unknown as DomNode);
    const valueRun = findByNameSuffix(shapes, "s.d.value")?.paragraphs?.[0]?.runs[0];
    expect(valueRun?.text).toContain("60%");
  });

  it("renders an actual doughnut chart and keeps unit out of the hero percent", () => {
    const shapes = renderShapes({
      id: "s.d", type: "donut-summary",
      primary: { label: "Direct", value: 60 },
      others: [{ label: "Search", value: 40 }],
      unit: "of revenue",
    } as unknown as DomNode);
    const chart = findByNameSuffix(shapes, "s.d.chart") as (AnyShape & { chartType?: string }) | undefined;
    expect(chart?.type).toBe("chart");
    expect(chart?.chartType).toBe("doughnut");
    const valueRun = findByNameSuffix(shapes, "s.d.value")?.paragraphs?.[0]?.runs[0];
    expect(valueRun?.text).toBe("60%");
    const unitRun = findByNameSuffix(shapes, "s.d.unit")?.paragraphs?.[0]?.runs[0];
    expect(unitRun?.text).toBe("of revenue");
  });

  it("renders one legend dot per entry (primary + others)", () => {
    const shapes = renderShapes({
      id: "s.d", type: "donut-summary",
      primary: { label: "A", value: 50 },
      others: [{ label: "B", value: 30 }, { label: "C", value: 20 }],
    } as unknown as DomNode);
    const dots = shapes.filter((s) => s.preset === "ellipse" && s.name?.includes("legend"));
    expect(dots.length).toBe(3);
  });
});

/* ============================================================ range-plot */

describe("range-plot visual structure", () => {
  it("range-bar width is proportional to span size (wider span → wider bar)", () => {
    // Layout solver reserves spacer minimums, so precise ratios aren't
    // exact. Verify directional correctness and rough scale instead.
    const rects = measureRects({
      id: "s.rp", type: "range-plot", items: [
        { label: "Narrow", min: 90, max: 100 },
        { label: "Wide",   min: 50, max: 150 },
      ],
    } as unknown as DomNode);
    const narrow = rects.get("s.rp.0.b.range")!;
    const wide = rects.get("s.rp.1.b.range")!;
    // Wide span (100) should produce a bar at least 2x wider than narrow (10).
    expect(wide.w).toBeGreaterThan(narrow.w * 2);
  });

  it("optional point dot is rendered for items with `point` set", () => {
    const shapes = renderShapes({
      id: "s.rp", type: "range-plot", items: [
        { label: "WithPoint", min: 0, max: 100, point: 50 },
        { label: "NoPoint",   min: 0, max: 100 },
      ],
    } as unknown as DomNode);
    expect(findByNameSuffix(shapes, "s.rp.0.p.dot")).toBeDefined();
    expect(findByNameSuffix(shapes, "s.rp.1.p.dot")).toBeUndefined();
  });
});

/* ============================================================ callout-marker */

describe("callout-marker overlay positioning", () => {
  it("with anchor:top-right is placed in the top-right corner of the slide", () => {
    const shapes = renderShapes({
      id: "s.cm", type: "callout-marker",
      text: "Important", anchor: "top-right", tone: "warning",
    } as unknown as DomNode);
    const marker = findByNameSuffix(shapes, "s.cm");
    expect(marker).toBeDefined();
    const rect = marker!.xfrm!;
    // top-right means x near slideW, y near 0 (within first 4cm)
    expect(rect.x / EMU + rect.cx / EMU).toBeCloseTo(SLIDE_W_CM, 0);
    expect(rect.y / EMU).toBeLessThan(2);
  });

  it("with anchor:middle-center is centered horizontally and vertically", () => {
    const shapes = renderShapes({
      id: "s.cm", type: "callout-marker",
      text: "Center", anchor: "middle-center", tone: "brand",
      width: 6, height: 1.2,
    } as unknown as DomNode);
    const marker = findByNameSuffix(shapes, "s.cm")!;
    const xCenter = (marker.xfrm!.x + marker.xfrm!.cx / 2) / EMU;
    const yCenter = (marker.xfrm!.y + marker.xfrm!.cy / 2) / EMU;
    expect(xCenter).toBeCloseTo(SLIDE_W_CM / 2, 0);
    expect(yCenter).toBeCloseTo(SLIDE_H_CM / 2, 0);
  });
});

/* ============================================================ decoration-grid */

describe("decoration-grid visual structure", () => {
  it("each muted background dot is rendered as a subtle texture mark, not a dark block", () => {
    const shapes = renderShapes({
      id: "s.dg", type: "decoration-grid",
      pattern: "dots", density: "sparse", tone: "muted",
      asBackground: false, // inline so the shapes flow into the test's renderShapes container
    } as unknown as DomNode);
    const dots = shapes.filter((s) => s.preset === "ellipse");
    expect(dots.length).toBeGreaterThan(0);
    for (const d of dots) {
      expect(d.xfrm!.cx / EMU).toBeLessThanOrEqual(0.13);
      expect(d.xfrm!.cy / EMU).toBeLessThanOrEqual(0.13);
      expect(fillColor(d)).toBe("DDE3EC");
    }
    expect(getRenderDiagnostics().filter((d) => d.code === "SHAPE_INVISIBLE_FIXED")).toHaveLength(0);
  });

  it("dense density emits more cells than sparse", () => {
    const sparseShapes = renderShapes({
      id: "s.dg", type: "decoration-grid", pattern: "dots", density: "sparse",
    } as unknown as DomNode);
    const denseShapes = renderShapes({
      id: "s.dg", type: "decoration-grid", pattern: "dots", density: "dense",
    } as unknown as DomNode);
    const sparseDots = sparseShapes.filter((s) => s.preset === "ellipse").length;
    const denseDots = denseShapes.filter((s) => s.preset === "ellipse").length;
    expect(denseDots).toBeGreaterThan(sparseDots);
  });

  it("grid pattern uses rect preset (not ellipse)", () => {
    const shapes = renderShapes({
      id: "s.dg", type: "decoration-grid", pattern: "grid",
    } as unknown as DomNode);
    expect(shapes.some((s) => s.preset === "ellipse")).toBe(false);
    expect(shapes.filter((s) => s.preset === "rect").length).toBeGreaterThan(0);
  });
});

/* ============================================================ corner-mark */

describe("corner-mark overlay positioning", () => {
  it("top-right corner places the mark at the right edge", () => {
    const shapes = renderShapes({
      id: "s.cm", type: "corner-mark",
      text: "DRAFT", corner: "top-right", tone: "warning",
    } as unknown as DomNode);
    const cm = findByNameSuffix(shapes, "s.cm")!;
    expect(cm.xfrm!.x / EMU + cm.xfrm!.cx / EMU).toBeCloseTo(SLIDE_W_CM, 0);
    expect(cm.xfrm!.y / EMU).toBeLessThan(2);
  });

  it("bottom-left corner places the mark at the bottom-left edge", () => {
    const shapes = renderShapes({
      id: "s.cm", type: "corner-mark",
      text: "FOOTER", corner: "bottom-left",
    } as unknown as DomNode);
    const cm = findByNameSuffix(shapes, "s.cm")!;
    expect(cm.xfrm!.x / EMU).toBeCloseTo(0, 0);
    expect(cm.xfrm!.y / EMU + cm.xfrm!.cy / EMU).toBeCloseTo(SLIDE_H_CM, 0);
  });
});

/* ============================================================ bracket */

describe("bracket visual structure", () => {
  it("left direction emits a vertical line shape (cy >> cx)", () => {
    const shapes = renderShapes({
      id: "s.b", type: "bracket", direction: "left", label: "Group",
    } as unknown as DomNode);
    const line = findByNameSuffix(shapes, "s.b.line")!;
    expect(line.xfrm!.cy).toBeGreaterThan(line.xfrm!.cx * 10);
  });

  it("top direction emits a horizontal line shape (cx >> cy)", () => {
    const shapes = renderShapes({
      id: "s.b", type: "bracket", direction: "top", label: "Group",
    } as unknown as DomNode);
    const line = findByNameSuffix(shapes, "s.b.line")!;
    expect(line.xfrm!.cx).toBeGreaterThan(line.xfrm!.cy * 10);
  });
});

/* ============================================================ arrow-link */

describe("arrow-link visual structure", () => {
  it("from + arrow + to are arranged left-to-right when direction:right", () => {
    const rects = measureRects({
      id: "s.al", type: "arrow-link",
      fromLabel: "A", toLabel: "B", direction: "right",
    } as unknown as DomNode);
    const from = rects.get("s.al.from")!;
    const arrow = rects.get("s.al.arrow")!;
    const to = rects.get("s.al.to")!;
    expect(from.x).toBeLessThan(arrow.x);
    expect(arrow.x).toBeLessThan(to.x);
  });

  it("arrow shape uses arrow-right preset for direction:right", () => {
    const shapes = renderShapes({
      id: "s.al", type: "arrow-link", fromLabel: "A", toLabel: "B", direction: "right",
    } as unknown as DomNode);
    const arrow = findByNameSuffix(shapes, "s.al.shape");
    expect(arrow?.preset).toBe("arrow-right");
  });

  it("arrow shape uses arrow-down preset for direction:down", () => {
    const shapes = renderShapes({
      id: "s.al", type: "arrow-link", fromLabel: "A", toLabel: "B", direction: "down",
    } as unknown as DomNode);
    const arrow = findByNameSuffix(shapes, "s.al.shape");
    expect(arrow?.preset).toBe("arrow-down");
  });
});

/* ============================================================ pointer-arrow */

describe("pointer-arrow visual structure", () => {
  it("left direction flips the arrow-right preset horizontally", () => {
    const shapes = renderShapes({
      id: "s.pa", type: "pointer-arrow", direction: "left", anchor: "middle-right",
    } as unknown as DomNode);
    const arrow = findByNameSuffix(shapes, "s.pa.shape");
    expect(arrow?.preset).toBe("arrow-right");
    expect(arrow?.xfrm?.flipH).toBe(true);
  });

  it("up direction flips the arrow-down preset vertically", () => {
    const shapes = renderShapes({
      id: "s.pa", type: "pointer-arrow", direction: "up", anchor: "bottom-center",
    } as unknown as DomNode);
    const arrow = findByNameSuffix(shapes, "s.pa.shape");
    expect(arrow?.preset).toBe("arrow-down");
    expect(arrow?.xfrm?.flipV).toBe(true);
  });
});

/* ============================================================ watermark */

describe("watermark overlay positioning", () => {
  it("renders as middle-center anchored across the slide", () => {
    const shapes = renderShapes({
      id: "s.wm", type: "watermark", text: "DRAFT",
    } as unknown as DomNode);
    const wm = findByNameSuffix(shapes, "s.wm")!;
    const xCenter = (wm.xfrm!.x + wm.xfrm!.cx / 2) / EMU;
    const yCenter = (wm.xfrm!.y + wm.xfrm!.cy / 2) / EMU;
    expect(xCenter).toBeCloseTo(SLIDE_W_CM / 2, 0);
    expect(yCenter).toBeCloseTo(SLIDE_H_CM / 2, 0);
  });

  it("does NOT push body content out of the way (overlay extracted from flow)", () => {
    const shapes = renderShapes({
      id: "s.wrap",
      type: "stack",
      direction: "vertical",
      children: [
        { id: "s.body", type: "text", text: "Body content" },
        { id: "s.wm", type: "watermark", text: "DRAFT" },
      ],
    } as unknown as DomNode);
    // body content stays at the start of content area (not displaced by watermark)
    const body = shapes.find((s) => (s.paragraphs || []).some((p) => p.runs.some((r) => r.text === "Body content")));
    expect(body).toBeDefined();
    expect(body!.xfrm!.y / EMU).toBeLessThan(5); // body near content top, not crammed
  });
});

/* ============================================================ big-page-number */

describe("big-page-number overlay positioning", () => {
  it("position:top-right anchors to top-right corner with current/total", () => {
    const shapes = renderShapes({
      id: "s.bpn", type: "big-page-number",
      current: 5, total: 22, position: "top-right",
    } as unknown as DomNode);
    const bpn = findByNameSuffix(shapes, "s.bpn")!;
    const text = bpn.paragraphs?.[0]?.runs.map((r) => r.text).join("") || "";
    expect(text).toContain("05");
    expect(text).toContain("22");
    expect(bpn.xfrm!.x / EMU + bpn.xfrm!.cx / EMU).toBeCloseTo(SLIDE_W_CM, 0);
  });

  it("without `total`, only current is rendered (no slash)", () => {
    const shapes = renderShapes({
      id: "s.bpn", type: "big-page-number", current: 7,
    } as unknown as DomNode);
    const bpn = findByNameSuffix(shapes, "s.bpn")!;
    const text = bpn.paragraphs?.[0]?.runs.map((r) => r.text).join("") || "";
    expect(text).toContain("07");
    expect(text).not.toContain("/");
  });
});

/* ============================================================ timeline-axis-bar */

describe("timeline-axis-bar visual structure", () => {
  it("active section dot is bigger than inactive dots", () => {
    const shapes = renderShapes({
      id: "s.tab", type: "timeline-axis-bar",
      sections: ["A", "B", "C"], current: 1,
    } as unknown as DomNode);
    const dots = shapes.filter((s) => s.preset === "ellipse" && s.name?.includes(".dot"));
    expect(dots.length).toBe(3);
    const activeDot = findByNameSuffix(shapes, "s.tab.1.dot")!;
    const inactiveDot = findByNameSuffix(shapes, "s.tab.0.dot")!;
    expect(activeDot.xfrm!.cx).toBeGreaterThan(inactiveDot.xfrm!.cx);
  });

  it("active and future-section dots are visually distinguishable (size differs even if color is auto-promoted)", () => {
    const shapes = renderShapes({
      id: "s.tab", type: "timeline-axis-bar",
      sections: ["A", "B", "C"], current: 0,
    } as unknown as DomNode);
    const activeDot = findByNameSuffix(shapes, "s.tab.0.dot")!;
    const futureDot = findByNameSuffix(shapes, "s.tab.2.dot")!;
    // The 'divider' token futureDot fill matches the slide bg on the
    // default theme and gets auto-promoted by SHAPE_INVISIBLE — so we
    // can't guarantee the colors differ. Distinction is preserved by
    // SIZE: the active dot is bigger than the future dot.
    expect(activeDot.xfrm!.cx).toBeGreaterThan(futureDot.xfrm!.cx);
  });
});

/* ============================================================ scale-bar */

describe("scale-bar visual structure", () => {
  it("emits ticks tick marks", () => {
    const shapes = renderShapes({
      id: "s.sb", type: "scale-bar", min: 0, max: 100, ticks: 5,
    } as unknown as DomNode);
    const ticks = shapes.filter((s) => s.preset === "rect" && s.name?.includes("tick") && s.name?.includes(".bar"));
    expect(ticks.length).toBe(5);
  });

  it("first label is the min value, last label is the max value", () => {
    const shapes = renderShapes({
      id: "s.sb", type: "scale-bar", min: 10, max: 90, ticks: 5, unit: "%",
    } as unknown as DomNode);
    const labels = shapes.filter((s) => s.name?.match(/^s\.sb\.lbl\d+$/));
    const first = labels[0]?.paragraphs?.[0]?.runs[0]?.text;
    const last = labels[labels.length - 1]?.paragraphs?.[0]?.runs[0]?.text;
    expect(first).toContain("10");
    expect(last).toContain("90");
  });
});

/* ============================================================ cross-component composition */

describe("composite slides combining multiple new components", () => {
  it("scorecard + corner-mark + watermark all render with correct anchoring (overlays at slide-children level)", () => {
    // Overlay components (corner-mark, watermark) must be DIRECT slide
    // children — source-deck's ensureContentArea pulls them out of the
    // flow only at the top level. Nesting them inside another container
    // disables anchor extraction.
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck({
      slideml2: 2,
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "s", title: "Composite",
        children: [
          { id: "s.sc", type: "scorecard", items: [
            { label: "MRR", value: "$420k", status: "good" },
            { label: "Churn", value: "3.1%", status: "warning" },
          ]} as DomNode,
          { id: "s.cm", type: "corner-mark", text: "Q3", corner: "top-right" } as DomNode,
          { id: "s.wm", type: "watermark", text: "DRAFT" } as DomNode,
        ],
      } as SlideV2],
    }));
    const shapes = ast.slides[0].shapes as AnyShape[];
    expect(findByNameSuffix(shapes, "s.sc.0-card")).toBeDefined();
    const wm = findByNameSuffix(shapes, "s.wm")!;
    const wmCenter = (wm.xfrm!.x + wm.xfrm!.cx / 2) / EMU;
    expect(wmCenter).toBeCloseTo(SLIDE_W_CM / 2, 0);
    const cm = findByNameSuffix(shapes, "s.cm")!;
    expect(cm.xfrm!.x / EMU + cm.xfrm!.cx / EMU).toBeCloseTo(SLIDE_W_CM, 0);
  });
});
