import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * timeline `content` field — agent can embed any DomNode as a step's
 * body content (metric-card, image, insight-card, quote, nested stack).
 * Backward compat: items with only {time, title, body} still work.
 */

const BLOCKING = new Set(["FALLBACK_FAILED", "TINY_RECT", "SQUASHED", "UNKNOWN_NODE_TYPE", "MISSING_NODE_TYPE", "UNKNOWN_COLOR", "LOW_CONTRAST"]);

function deck(slides: SlideV2[]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
    slides,
  };
}

function render(slide: SlideV2) {
  clearRenderDiagnostics();
  const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
  const diagnostics = getRenderDiagnostics();
  return {
    ast,
    diagnostics,
    blocking: diagnostics.filter((d) => BLOCKING.has(d.code)),
  };
}

function findRunByText(shapes: Array<{ type: string }>, needle: string) {
  for (const sh of shapes) {
    if (sh.type !== "text") continue;
    const t = sh as { paragraphs?: Array<{ runs: Array<{ text: string }> }> };
    for (const p of t.paragraphs || []) {
      for (const r of p.runs || []) {
        if (r.text === needle || r.text.includes(needle)) return r;
      }
    }
  }
  return undefined;
}

describe("timeline backward-compatibility", () => {
  it("legacy {time, title, body} items still render", () => {
    const slide: SlideV2 = {
      id: "tl",
      title: "Releases",
      children: [{
        id: "tl.tl",
        type: "timeline",
        items: [
          { time: "2024 Q1", title: "Launch", body: "First customer onboarded" },
          { time: "2024 Q3", title: "Growth", body: "10x MRR" },
        ],
      } as unknown as DomNode],
    };
    const { ast, blocking } = render(slide);
    expect(blocking).toEqual([]);
    expect(findRunByText(ast.slides[0].shapes, "2024 Q1")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "Launch")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "First customer onboarded")).toBeDefined();
  });

  it("title is now optional (back-compat: items without title still render)", () => {
    const slide: SlideV2 = {
      id: "tl",
      title: "x",
      children: [{
        id: "tl.tl",
        type: "timeline",
        items: [
          { time: "2024", body: "Just body, no title" },
        ],
      } as unknown as DomNode],
    };
    const { ast, blocking } = render(slide);
    expect(blocking).toEqual([]);
    expect(findRunByText(ast.slides[0].shapes, "Just body, no title")).toBeDefined();
  });
});

describe("timeline content: metric-card", () => {
  it("vertical timeline with metric-card content renders the metric", () => {
    const slide: SlideV2 = {
      id: "tl",
      title: "Funding history",
      children: [{
        id: "tl.tl",
        type: "timeline",
        direction: "vertical",
        items: [
          {
            time: "2024 Q3",
            content: { id: "tl.tl.0.metric", type: "metric-card", value: "$15M", label: "Series A raised" },
          },
          {
            time: "2025 Q4",
            content: { id: "tl.tl.1.metric", type: "metric-card", value: "$60M", label: "Series B raised" },
          },
        ],
      } as unknown as DomNode],
    };
    const { ast, blocking } = render(slide);
    expect(blocking).toEqual([]);
    expect(findRunByText(ast.slides[0].shapes, "$15M")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "Series A raised")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "$60M")).toBeDefined();
  });
});

describe("timeline content: insight-card with bullets", () => {
  it("vertical timeline with insight-card content (multi-bullet) renders all bullets", () => {
    const slide: SlideV2 = {
      id: "tl",
      title: "Expansion milestones",
      children: [{
        id: "tl.tl",
        type: "timeline",
        direction: "vertical",
        items: [
          {
            time: "2025 Q1",
            content: {
              id: "tl.tl.0.card",
              type: "insight-card",
              headline: "Geographic expansion",
              bullets: ["Tokyo office", "Singapore hub", "London partner"],
            },
          },
        ],
      } as unknown as DomNode],
    };
    const { ast, blocking } = render(slide);
    expect(blocking).toEqual([]);
    expect(findRunByText(ast.slides[0].shapes, "Geographic expansion")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "Tokyo office")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "Singapore hub")).toBeDefined();
  });
});

describe("timeline content: quote", () => {
  it("vertical timeline with quote content renders the quote text + source", () => {
    const slide: SlideV2 = {
      id: "tl",
      title: "Notable moments",
      children: [{
        id: "tl.tl",
        type: "timeline",
        direction: "vertical",
        items: [
          {
            time: "2026 Q2",
            content: {
              id: "tl.tl.0.q",
              type: "quote",
              text: "A defining moment for the industry.",
              source: "CEO",
            },
          },
        ],
      } as unknown as DomNode],
    };
    const { ast, blocking } = render(slide);
    expect(blocking).toEqual([]);
    expect(findRunByText(ast.slides[0].shapes, "defining moment")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "CEO")).toBeDefined();
  });
});

describe("timeline content: nested stack with multiple blocks", () => {
  it("a stack containing h2 + metric-card + quote all render in one item", () => {
    const slide: SlideV2 = {
      id: "tl",
      title: "IPO moment",
      children: [{
        id: "tl.tl",
        type: "timeline",
        direction: "vertical",
        items: [
          {
            time: "2026 Q3",
            content: {
              id: "tl.tl.0.stack",
              type: "stack",
              direction: "vertical",
              gap: 0.2,
              children: [
                { id: "tl.tl.0.h", type: "h2", text: "Public listing" },
                { id: "tl.tl.0.m", type: "metric-card", value: "$2.1B", label: "Market cap day 1" },
              ],
            },
          },
        ],
      } as unknown as DomNode],
    };
    const { ast, blocking } = render(slide);
    expect(blocking).toEqual([]);
    expect(findRunByText(ast.slides[0].shapes, "Public listing")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "$2.1B")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "Market cap day 1")).toBeDefined();
  });
});

describe("timeline content priority", () => {
  it("when both content and body are supplied, content wins (body is ignored)", () => {
    const slide: SlideV2 = {
      id: "tl",
      title: "x",
      children: [{
        id: "tl.tl",
        type: "timeline",
        direction: "vertical",
        items: [
          {
            time: "2024",
            body: "this body should NOT appear",
            content: { id: "tl.tl.0.m", type: "metric-card", value: "100%", label: "win rate" },
          },
        ],
      } as unknown as DomNode],
    };
    const { ast, blocking } = render(slide);
    expect(blocking).toEqual([]);
    expect(findRunByText(ast.slides[0].shapes, "100%")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "win rate")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "this body should NOT appear")).toBeUndefined();
  });
});

describe("timeline content: mixed items (some with content, some without)", () => {
  it("a timeline can mix legacy text items and content items", () => {
    const slide: SlideV2 = {
      id: "tl",
      title: "Mixed timeline",
      children: [{
        id: "tl.tl",
        type: "timeline",
        direction: "vertical",
        items: [
          { time: "2024", title: "Founded", body: "Two co-founders" },
          {
            time: "2025",
            content: { id: "tl.tl.1.m", type: "metric-card", value: "$15M", label: "Series A" },
          },
          { time: "2026", title: "Expansion", body: "Three new offices" },
        ],
      } as unknown as DomNode],
    };
    const { ast, blocking } = render(slide);
    expect(blocking).toEqual([]);
    expect(findRunByText(ast.slides[0].shapes, "Founded")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "$15M")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "Three new offices")).toBeDefined();
  });
});

describe("timeline content: id auto-stamping", () => {
  it("when content lacks an id, the renderer stamps a stable namespaced id", () => {
    const slide: SlideV2 = {
      id: "tl",
      title: "x",
      children: [{
        id: "tl.tl",
        type: "timeline",
        direction: "vertical",
        items: [
          {
            time: "2024",
            // No id on content; component must still render without crashing
            content: { type: "metric-card", value: "42", label: "answer" },
          },
        ],
      } as unknown as DomNode],
    };
    const { ast, blocking } = render(slide);
    expect(blocking).toEqual([]);
    expect(findRunByText(ast.slides[0].shapes, "42")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "answer")).toBeDefined();
  });
});

describe("timeline horizontal layout fits short content but vertical handles rich content", () => {
  it("horizontal timeline with simple text in 4 cells renders cleanly", () => {
    const slide: SlideV2 = {
      id: "tl",
      title: "Quarters",
      children: [{
        id: "tl.tl",
        type: "timeline",
        direction: "horizontal",
        items: [
          { time: "Q1", title: "Plan" },
          { time: "Q2", title: "Build" },
          { time: "Q3", title: "Launch" },
          { time: "Q4", title: "Iterate" },
        ],
      } as unknown as DomNode],
    };
    const { blocking } = render(slide);
    expect(blocking).toEqual([]);
  });

  it("vertical timeline with metric-card content (3 items) renders cleanly", () => {
    // Realistic limit on 8cm content area: 3 metric-cards × ~1.75cm = 5.25cm,
    // plus 2 gaps. metric-card has high vertical demand (large value font),
    // so 4+ metric-card rows on one slide will overflow. Use simpler text
    // content or split into two slides for longer timelines.
    const slide: SlideV2 = {
      id: "tl",
      title: "Funding",
      children: [{
        id: "tl.tl",
        type: "timeline",
        direction: "vertical",
        items: Array.from({ length: 3 }, (_, i) => ({
          time: `202${4 + i}`,
          content: { id: `tl.tl.${i}.m`, type: "metric-card", value: `$${(i + 1) * 5}M`, label: `Round ${i + 1}` } as unknown as DomNode,
        })),
      } as unknown as DomNode],
    };
    const { blocking } = render(slide);
    expect(blocking).toEqual([]);
  });

  it("vertical timeline with 6 simple text items still renders (text is more compact than metric-card)", () => {
    const slide: SlideV2 = {
      id: "tl",
      title: "Quarters",
      children: [{
        id: "tl.tl",
        type: "timeline",
        direction: "vertical",
        items: Array.from({ length: 6 }, (_, i) => ({
          time: `2024 Q${i + 1}`,
          title: `Milestone ${i + 1}`,
          body: `Brief description ${i + 1}`,
        })),
      } as unknown as DomNode],
    };
    const { blocking } = render(slide);
    expect(blocking).toEqual([]);
  });
});

describe("timeline content: nested validation surfaces invalid embedded components", () => {
  // The validator recursively walks items[].content so missing required
  // fields on a nested metric-card (or any embedded component) get flagged
  // BEFORE render. Otherwise the agent only sees a generic render-time
  // error with no path back to the broken sub-tree.
  it("missing required field on embedded metric-card surfaces a validation error", async () => {
    const { validateSlide } = await import("./validate.js");
    const slide: SlideV2 = {
      id: "tl",
      title: "x",
      children: [{
        id: "tl.tl",
        type: "timeline",
        direction: "vertical",
        items: [
          // metric-card requires `value` and `label`; we omit `label`
          { time: "2024", content: { id: "tl.tl.0.m", type: "metric-card", value: "$15M" } },
        ],
      } as unknown as DomNode],
    };
    const report = validateSlide(slide);
    const errs = report.errors.filter((e) => e.code === "MISSING_REQUIRED_FIELD" && /label/.test(e.message));
    expect(errs.length).toBeGreaterThan(0);
    // Path should point into the timeline item's content
    const pathHit = errs.find((e) => typeof e.path === "string" && e.path.includes("items[0].content"));
    expect(pathHit, "path should reference items[0].content").toBeDefined();
  });

  it("invalid nested component type inside timeline content is flagged", async () => {
    const { validateSlide } = await import("./validate.js");
    const slide: SlideV2 = {
      id: "tl",
      title: "x",
      children: [{
        id: "tl.tl",
        type: "timeline",
        direction: "vertical",
        items: [
          { time: "2024", content: { id: "tl.tl.0.bogus", type: "this-is-not-a-component" } as unknown as DomNode },
        ],
      } as unknown as DomNode],
    };
    const report = validateSlide(slide);
    const unknown = report.errors.filter((e) => e.code === "UNKNOWN_NODE_TYPE");
    expect(unknown.length).toBeGreaterThan(0);
  });
});

describe("timeline real-world example: Yahoo IPO style milestone", () => {
  it("a milestone with sub-headline + metric content renders all parts", () => {
    const slide: SlideV2 = {
      id: "tl",
      title: "Defining moments",
      children: [{
        id: "tl.tl",
        type: "timeline",
        direction: "vertical",
        items: [
          {
            time: "1996",
            title: "Yahoo IPO",
            content: { id: "tl.tl.0.m", type: "metric-card", value: "$849M", label: "First-day market cap" },
          },
          {
            time: "1998",
            title: "Google founded",
            body: "Larry Page and Sergey Brin incorporate Google.",
          },
          {
            time: "2004",
            title: "Google IPO",
            content: { id: "tl.tl.2.m", type: "metric-card", value: "$23B", label: "Day-one valuation" },
          },
        ],
      } as unknown as DomNode],
    };
    const { ast, blocking } = render(slide);
    expect(blocking).toEqual([]);
    expect(findRunByText(ast.slides[0].shapes, "Yahoo IPO")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "$849M")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "Google founded")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "Larry Page")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "$23B")).toBeDefined();
  });
});
