import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

const BLOCKING = new Set(["FALLBACK_FAILED", "TINY_RECT", "SQUASHED", "UNKNOWN_NODE_TYPE", "MISSING_NODE_TYPE", "UNKNOWN_COLOR", "LOW_CONTRAST"]);

function deck(slides: SlideV2[]): Slideml2SourceDeck {
  return { slideml2: 2, deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } }, slides };
}

function render(slide: SlideV2) {
  clearRenderDiagnostics();
  const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
  const diagnostics = getRenderDiagnostics();
  return { ast, blocking: diagnostics.filter((d) => BLOCKING.has(d.code)) };
}

function findRunByText(shapes: Array<{ type: string }>, needle: string) {
  for (const sh of shapes) {
    if (sh.type !== "text") continue;
    const t = sh as { paragraphs?: Array<{ runs: Array<{ text: string }> }> };
    for (const p of t.paragraphs || []) for (const r of p.runs || []) {
      if (r.text === needle || r.text.includes(needle)) return r;
    }
  }
  return undefined;
}

function expectClean(slide: SlideV2, label: string) {
  const { blocking } = render(slide);
  if (blocking.length > 0) {
    const summary = blocking.map((d) => `${d.code}@${d.nodeId || "?"}: ${(d.message || "").slice(0, 100)}`).join("\n  ");
    throw new Error(`[${label}] blocking diagnostics:\n  ${summary}`);
  }
}

/* ============================================================ DATA */

describe("scorecard", () => {
  it("4 metrics with mixed status renders all values + statuses", () => {
    const slide: SlideV2 = {
      id: "s", title: "Q3 Health",
      children: [{
        id: "s.sc", type: "scorecard",
        items: [
          { label: "Revenue", value: "$4.2M", status: "good", delta: "+12%", trend: "up" },
          { label: "Churn", value: "3.1%", status: "warning", delta: "+0.4", trend: "up" },
          { label: "P95 latency", value: "920ms", status: "danger", delta: "+120ms", trend: "up" },
          { label: "NPS", value: "72", status: "neutral" },
        ],
      } as unknown as DomNode],
    };
    expectClean(slide, "scorecard-4");
    const { ast } = render(slide);
    expect(findRunByText(ast.slides[0].shapes, "Revenue")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "$4.2M")).toBeDefined();
    // PR2 number-aware metric weight splits "920ms" → "920m" + "s" runs
    // (m is a recognized unit suffix). Both runs are still rendered;
    // searching for "920" hits the numeric run.
    expect(findRunByText(ast.slides[0].shapes, "920")).toBeDefined();
  });
});

describe("funnel", () => {
  it("4-stage conversion funnel renders stage labels + values + drops", () => {
    const slide: SlideV2 = {
      id: "s", title: "Funnel",
      children: [{
        id: "s.f", type: "funnel",
        stages: [
          { label: "Visitors", value: 100000 },
          { label: "Sign-ups", value: 12000 },
          { label: "Activated", value: 4500 },
          { label: "Paid", value: 380 },
        ],
      } as unknown as DomNode],
    };
    expectClean(slide, "funnel-4");
    const { ast } = render(slide);
    expect(findRunByText(ast.slides[0].shapes, "Visitors")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "Paid")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "drop")).toBeDefined();
  });
});

describe("gauge", () => {
  it("gauge with thresholds renders value + label + threshold zones", () => {
    const slide: SlideV2 = {
      id: "s", title: "NPS",
      children: [{
        id: "s.g", type: "gauge",
        value: 72, max: 100, label: "NPS",
        thresholds: [
          { upTo: 30, tone: "danger" },
          { upTo: 70, tone: "warning" },
          { upTo: 100, tone: "positive" },
        ],
      } as unknown as DomNode],
    };
    expectClean(slide, "gauge");
    const { ast } = render(slide);
    expect(findRunByText(ast.slides[0].shapes, "72")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "NPS")).toBeDefined();
  });
});

describe("heatmap", () => {
  it("5×7 heatmap renders all axis labels", () => {
    const slide: SlideV2 = {
      id: "s", title: "Activity",
      children: [{
        id: "s.h", type: "heatmap",
        xLabels: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
        yLabels: ["6am","9am","12pm","3pm","6pm"],
        values: [
          [1,2,2,3,3,1,1],[3,4,5,4,5,2,1],[5,6,7,7,8,3,2],
          [4,5,6,6,7,2,2],[2,3,3,4,4,1,1],
        ],
        palette: "warm",
      } as unknown as DomNode],
    };
    expectClean(slide, "heatmap-5x7");
    const { ast } = render(slide);
    for (const lbl of ["Mon","Sun","6am","6pm"]) {
      expect(findRunByText(ast.slides[0].shapes, lbl)).toBeDefined();
    }
  });

  it("3×3 heatmap with showValues:true renders cell numbers", () => {
    const slide: SlideV2 = {
      id: "s", title: "x",
      children: [{
        id: "s.h", type: "heatmap",
        xLabels: ["A","B","C"], yLabels: ["1","2","3"],
        values: [[10,20,30],[5,15,25],[1,2,3]],
        showValues: true,
      } as unknown as DomNode],
    };
    expectClean(slide, "heatmap-3x3-values");
  });
});

describe("matrix-2x2", () => {
  it("4 quadrants with items + axis labels render", () => {
    const slide: SlideV2 = {
      id: "s", title: "Priority Matrix",
      children: [{
        id: "s.m", type: "matrix-2x2",
        xAxis: { low: "Low Effort", high: "High Effort" },
        yAxis: { low: "Low Value",  high: "High Value" },
        quadrantLabels: { tl: "Quick Wins", tr: "Big Bets", bl: "Skip", br: "Time Sinks" },
        items: [
          { label: "Fix Auth", x: "low", y: "high", tone: "positive" },
          { label: "Onboarding", x: "low", y: "high" },
          { label: "Migration", x: "high", y: "high", tone: "warning" },
          { label: "Refactor logging", x: "high", y: "low", tone: "danger" },
        ],
      } as unknown as DomNode],
    };
    expectClean(slide, "matrix-2x2");
    const { ast } = render(slide);
    expect(findRunByText(ast.slides[0].shapes, "Quick Wins")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "High Effort")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "High Value")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "Fix Auth")).toBeDefined();
  });
});

describe("trend-line", () => {
  it("12 monthly values render as bars without crash", () => {
    const slide: SlideV2 = {
      id: "s", title: "x",
      children: [{
        id: "s.tl", type: "trend-line",
        values: [12, 14, 13, 18, 22, 28, 26, 31, 35, 33, 41, 48],
        tone: "positive",
      } as unknown as DomNode],
    };
    expectClean(slide, "trend-line-12");
  });
});

describe("stat-flow", () => {
  it("CAC → LTV unit economics flow renders all values + connectors", () => {
    const slide: SlideV2 = {
      id: "s", title: "Unit Economics",
      children: [{
        id: "s.sf", type: "stat-flow",
        steps: [
          { value: "$120", label: "CAC", tone: "warning" },
          { connector: "÷ 24m" },
          { value: "$5/mo", label: "Recovery", tone: "neutral" },
          { connector: "→" },
          { value: "$200", label: "LTV", tone: "positive" },
        ],
      } as unknown as DomNode],
    };
    expectClean(slide, "stat-flow");
    const { ast } = render(slide);
    expect(findRunByText(ast.slides[0].shapes, "CAC")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "÷ 24m")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "LTV")).toBeDefined();
  });
});

describe("donut-summary", () => {
  it("primary share + 3 others renders ring + legend", () => {
    const slide: SlideV2 = {
      id: "s", title: "Traffic Sources",
      children: [{
        id: "s.d", type: "donut-summary",
        primary: { label: "Direct", value: 62 },
        others: [{ label: "Search", value: 23 }, { label: "Social", value: 15 }],
        unit: "of traffic",
      } as unknown as DomNode],
    };
    expectClean(slide, "donut-summary");
    const { ast } = render(slide);
    expect(findRunByText(ast.slides[0].shapes, "Direct")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "Search")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "62%")).toBeDefined();
  });
});

describe("range-plot", () => {
  it("salary bands with mid-points render labels + range visualization", () => {
    const slide: SlideV2 = {
      id: "s", title: "Compensation",
      children: [{
        id: "s.r", type: "range-plot",
        items: [
          { label: "Junior",  min: 80,  max: 110, point: 95,  unit: "k" },
          { label: "Mid",     min: 110, max: 150, point: 130, unit: "k" },
          { label: "Senior",  min: 140, max: 200, point: 170, unit: "k" },
          { label: "Staff",   min: 180, max: 250, point: 215, unit: "k" },
        ],
      } as unknown as DomNode],
    };
    expectClean(slide, "range-plot");
    const { ast } = render(slide);
    expect(findRunByText(ast.slides[0].shapes, "Junior")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "Senior")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "215k")).toBeDefined();
  });
});

/* ============================================================ DECORATION */

describe("callout-marker", () => {
  it("anchored bubble at top-right renders text", () => {
    const slide: SlideV2 = {
      id: "s", title: "x",
      children: [{
        id: "s.cm", type: "callout-marker",
        text: "Q3 inflection",
        anchor: "top-right",
        tone: "warning",
      } as unknown as DomNode],
    };
    expectClean(slide, "callout-marker");
    const { ast } = render(slide);
    expect(findRunByText(ast.slides[0].shapes, "Q3 inflection")).toBeDefined();
  });
});

describe("decoration-grid", () => {
  it("dot-grid sparse renders without errors", () => {
    const slide: SlideV2 = {
      id: "s", title: "x",
      children: [{
        id: "s.dg", type: "decoration-grid",
        pattern: "dots", density: "sparse", tone: "muted",
      } as unknown as DomNode],
    };
    expectClean(slide, "decoration-grid-dots");
  });

  it("grid pattern renders without errors", () => {
    const slide: SlideV2 = {
      id: "s", title: "x",
      children: [{
        id: "s.dg", type: "decoration-grid",
        pattern: "grid", density: "normal",
      } as unknown as DomNode],
    };
    expectClean(slide, "decoration-grid-grid");
  });
});

describe("decorative-shapes", () => {
  it("confetti motif renders as a background overlay", () => {
    const slide: SlideV2 = {
      id: "s", title: "x",
      children: [{
        id: "s.ds", type: "decorative-shapes",
        motif: "confetti", position: "full", tone: "accent", count: 16,
      } as unknown as DomNode],
    };
    expectClean(slide, "decorative-shapes");
  });

  it("corner blobs render multiple vector marks", () => {
    const slide: SlideV2 = {
      id: "s", title: "x",
      children: [{
        id: "s.ds", type: "decorative-shapes",
        motif: "corner-blobs", position: "bottom-right", tone: "brand", count: 6,
      } as unknown as DomNode],
    };
    expectClean(slide, "decorative-shapes-corner");
    const { ast } = render(slide);
    const marks = ast.slides[0].shapes.filter((shape) => String(shape.name || "").includes("s.ds") && shape.type === "shape");
    expect(marks.length).toBeGreaterThanOrEqual(6);
  });
});

describe("corner-mark", () => {
  it("DRAFT marker at top-right renders", () => {
    const slide: SlideV2 = {
      id: "s", title: "x",
      children: [{
        id: "s.cm", type: "corner-mark",
        text: "DRAFT", corner: "top-right", tone: "warning", style: "tag",
      } as unknown as DomNode],
    };
    expectClean(slide, "corner-mark");
    const { ast } = render(slide);
    expect(findRunByText(ast.slides[0].shapes, "DRAFT")).toBeDefined();
  });
});

describe("bracket", () => {
  it("left bracket with label renders", () => {
    const slide: SlideV2 = {
      id: "s", title: "x",
      children: [{
        id: "s.b", type: "bracket",
        direction: "left", label: "Core strategies", tone: "brand",
      } as unknown as DomNode],
    };
    expectClean(slide, "bracket");
    const { ast } = render(slide);
    expect(findRunByText(ast.slides[0].shapes, "Core strategies")).toBeDefined();
  });
});

describe("arrow-link", () => {
  it("from → to with label renders all three", () => {
    const slide: SlideV2 = {
      id: "s", title: "x",
      children: [{
        id: "s.al", type: "arrow-link",
        fromLabel: "Step A", toLabel: "Step B", label: "depends on",
      } as unknown as DomNode],
    };
    expectClean(slide, "arrow-link");
    const { ast } = render(slide);
    expect(findRunByText(ast.slides[0].shapes, "Step A")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "Step B")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "depends on")).toBeDefined();
  });
});

describe("pointer-arrow", () => {
  it("anchored overlay arrow renders with label", () => {
    const slide: SlideV2 = {
      id: "s", title: "x",
      children: [{
        id: "s.pa", type: "pointer-arrow",
        label: "重点", direction: "left", anchor: "middle-right", offsetX: 1, tone: "warning",
      } as unknown as DomNode],
    };
    expectClean(slide, "pointer-arrow");
    const { ast } = render(slide);
    expect(findRunByText(ast.slides[0].shapes, "重点")).toBeDefined();
  });
});

describe("watermark", () => {
  it("CONFIDENTIAL watermark renders", () => {
    const slide: SlideV2 = {
      id: "s", title: "x",
      children: [
        { id: "s.body", type: "text", text: "Body content" },
        { id: "s.wm", type: "watermark", text: "CONFIDENTIAL", tone: "danger" } as unknown as DomNode,
      ],
    };
    expectClean(slide, "watermark");
    const { ast } = render(slide);
    expect(findRunByText(ast.slides[0].shapes, "CONFIDENTIAL")).toBeDefined();
  });
});

describe("big-page-number", () => {
  it("05 / 22 with current+total renders", () => {
    const slide: SlideV2 = {
      id: "s", title: "x",
      children: [{
        id: "s.bpn", type: "big-page-number",
        current: 5, total: 22, position: "top-right", tone: "brand",
      } as unknown as DomNode],
    };
    expectClean(slide, "big-page-number");
    const { ast } = render(slide);
    expect(findRunByText(ast.slides[0].shapes, "05")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "22")).toBeDefined();
  });
});

describe("timeline-axis-bar", () => {
  it("5 sections with current=2 highlights middle dot + labels", () => {
    const slide: SlideV2 = {
      id: "s", title: "Section break",
      children: [{
        id: "s.tab", type: "timeline-axis-bar",
        sections: ["Intro", "Strategy", "Examples", "Q&A", "Wrap-up"],
        current: 2,
      } as unknown as DomNode],
    };
    expectClean(slide, "timeline-axis-bar");
    const { ast } = render(slide);
    for (const s of ["Intro", "Examples", "Wrap-up"]) {
      expect(findRunByText(ast.slides[0].shapes, s)).toBeDefined();
    }
  });
});

describe("scale-bar", () => {
  it("0..100% scale with 5 ticks renders all labels", () => {
    const slide: SlideV2 = {
      id: "s", title: "x",
      children: [{
        id: "s.sb", type: "scale-bar",
        min: 0, max: 100, unit: "%", ticks: 5,
      } as unknown as DomNode],
    };
    expectClean(slide, "scale-bar");
    const { ast } = render(slide);
    expect(findRunByText(ast.slides[0].shapes, "0%")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "100%")).toBeDefined();
  });
});

/* ============================================================ MIXED USE */

describe("real-world: dashboard slide with scorecard + trend-line + corner-mark", () => {
  it("composite slide renders all components without conflict", () => {
    const slide: SlideV2 = {
      id: "s", title: "Q3 Dashboard",
      children: [
        {
          id: "s.sc", type: "scorecard",
          items: [
            { label: "Revenue", value: "$4.2M", status: "good", delta: "+12%", trend: "up" },
            { label: "Customers", value: "1,820", status: "good", delta: "+220", trend: "up" },
            { label: "Latency", value: "920ms", status: "danger", delta: "+120", trend: "up" },
          ],
        } as unknown as DomNode,
        {
          id: "s.cm", type: "corner-mark",
          text: "Q3 2026", corner: "top-right", tone: "brand", style: "tag",
        } as unknown as DomNode,
      ],
    };
    expectClean(slide, "dashboard-mix");
  });
});
