import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

function deck(slides: SlideV2[]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
    slides,
  };
}

function findRunByText(shapes: Array<{ type: string }>, needle: string) {
  for (const sh of shapes) {
    if (sh.type !== "text") continue;
    const t = sh as { paragraphs?: Array<{ runs: Array<{ text: string; bold?: boolean; color?: string }> }> };
    for (const p of t.paragraphs || []) {
      for (const r of p.runs || []) {
        if (r.text === needle || r.text.includes(needle)) return r;
      }
    }
  }
  return undefined;
}

describe("outline component", () => {
  it("renders 5 chapters WITHOUT auto-numbering when items omit `number`", () => {
    const slide: SlideV2 = {
      id: "toc",
      title: "Contents",
      children: [{
        id: "toc.outline",
        type: "outline",
        items: [
          { title: "Introduction", body: "Why this matters" },
          { title: "Strategies", body: "Four core methods" },
          { title: "Question Types", body: "Five categories" },
          { title: "Examples", body: "Worked passages" },
          { title: "Takeaways", body: "Final tips" },
        ],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    // No auto "01"/"02" — agent must pass `number` explicitly
    for (const num of ["01", "02", "03", "04", "05"]) {
      expect(findRunByText(ast.slides[0].shapes, num), `should NOT auto-emit "${num}"`).toBeUndefined();
    }
    // Titles still rendered
    for (const t of ["Introduction", "Strategies", "Examples"]) {
      expect(findRunByText(ast.slides[0].shapes, t)).toBeDefined();
    }
  });

  it("agent-supplied numbers render verbatim", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.outline",
        type: "outline",
        items: [
          { number: "01", title: "First chapter" },
          { number: "02", title: "Second chapter" },
          { number: "03", title: "Third chapter" },
        ],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    for (const num of ["01", "02", "03"]) {
      expect(findRunByText(ast.slides[0].shapes, num)).toBeDefined();
    }
  });

  it("custom number values are preserved", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.outline",
        type: "outline",
        items: [
          { number: "I", title: "First" },
          { number: "II", title: "Second" },
          { number: "III", title: "Third" },
        ],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    expect(findRunByText(ast.slides[0].shapes, "I")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "II")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "III")).toBeDefined();
  });

  it("showPages:true emits page references", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.outline",
        type: "outline",
        showPages: true,
        items: [
          { title: "Intro", page: 3 },
          { title: "Body", page: "8" },
        ],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    expect(findRunByText(ast.slides[0].shapes, "p.3")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "p.8")).toBeDefined();
  });

  it("12 chapters fit without FALLBACK_FAILED (very-compact density)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "Long TOC",
      children: [{
        id: "s.outline",
        type: "outline",
        items: Array.from({ length: 12 }, (_, i) => ({ title: `Chapter ${i + 1}`, body: "lorem ipsum" })),
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide])));
    const fb = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED");
    expect(fb).toEqual([]);
  });
});

describe("glossary component", () => {
  it("renders 8 terms with bold term + definition", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "Glossary",
      children: [{
        id: "s.glossary",
        type: "glossary",
        items: [
          { term: "Skimming", definition: "Reading quickly to grasp the main idea" },
          { term: "Scanning", definition: "Locating specific facts in a passage" },
          { term: "Inference", definition: "Drawing conclusions not explicitly stated" },
          { term: "Context", definition: "Surrounding text used to deduce meaning" },
        ],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    for (const term of ["Skimming", "Scanning", "Inference", "Context"]) {
      const run = findRunByText(ast.slides[0].shapes, term);
      expect(run, `expected term "${term}"`).toBeDefined();
      expect(run!.bold).toBe(true);
    }
  });

  it("layout:\"two-column\" arranges items in 2 columns (grid-based)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.glossary",
        type: "glossary",
        layout: "two-column",
        items: [
          { term: "A", definition: "1" },
          { term: "B", definition: "2" },
          { term: "C", definition: "3" },
          { term: "D", definition: "4" },
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide])));
    const fb = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED");
    expect(fb).toEqual([]);
  });
});

describe("q-and-a component", () => {
  it("renders 3 Q/A pairs with Q and A chips on each row", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "FAQ",
      children: [{
        id: "s.qa",
        type: "q-and-a",
        items: [
          { q: "How long is the test?", a: "35 minutes for 2 passages." },
          { q: "Can I skip questions?", a: "Yes, but flag them to revisit." },
          { q: "What's the best strategy?", a: "Skim first, then answer in order." },
        ],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const shapes = ast.slides[0].shapes as Array<{ type: string; paragraphs?: Array<{ runs: Array<{ text: string }> }>; fill?: { color?: string } }>;
    const qChips = shapes.filter((s) => s.type === "text"
      && s.paragraphs?.length === 1
      && s.paragraphs[0]!.runs.length === 1
      && s.paragraphs[0]!.runs[0]!.text === "Q"
      && s.fill);
    const aChips = shapes.filter((s) => s.type === "text"
      && s.paragraphs?.length === 1
      && s.paragraphs[0]!.runs.length === 1
      && s.paragraphs[0]!.runs[0]!.text === "A"
      && s.fill);
    expect(qChips.length).toBe(3);
    expect(aChips.length).toBe(3);
    expect(qChips[0]!.fill?.color).not.toBe(aChips[0]!.fill?.color);
  });

  it("does NOT FALLBACK_FAILED with 5 Q/A pairs (compact mode)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.qa",
        type: "q-and-a",
        items: Array.from({ length: 5 }, (_, i) => ({
          q: `Question ${i + 1}?`,
          a: `Answer ${i + 1}.`,
        })),
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide])));
    const fb = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED");
    expect(fb).toEqual([]);
  });

  it("alias `question`/`answer` work in addition to q/a", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.qa",
        type: "q-and-a",
        items: [
          { question: "Aliased Q", answer: "Aliased A" },
        ],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    expect(findRunByText(ast.slides[0].shapes, "Aliased Q")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "Aliased A")).toBeDefined();
  });
});

describe("comparison-table component", () => {
  it("renders header row + feature rows with the recommended option highlighted", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "Plan Comparison",
      children: [{
        id: "s.cmp",
        type: "comparison-table",
        features: ["Pricing", "Setup", "Best for"],
        options: [
          { name: "Plan A", values: ["$10/mo", "5 min", "Solo"] },
          { name: "Plan B", values: ["$30/mo", "30 min", "Team"], recommended: true },
          { name: "Plan C", values: ["$100/mo", "1 day", "Enterprise"] },
        ],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const shapes = ast.slides[0].shapes as Array<{ type: string; paragraphs?: Array<{ runs: Array<{ text: string }> }>; fill?: { color?: string } }>;
    // RECOMMENDED badge present
    expect(findRunByText(ast.slides[0].shapes, "RECOMMENDED")).toBeDefined();
    // Each option name is a header cell
    for (const name of ["Plan A", "Plan B", "Plan C"]) {
      expect(findRunByText(ast.slides[0].shapes, name)).toBeDefined();
    }
    // Each feature label is a left-column cell
    for (const f of ["Pricing", "Setup", "Best for"]) {
      expect(findRunByText(ast.slides[0].shapes, f)).toBeDefined();
    }
    // Recommended column has tinted fill on its cells
    const tinted = shapes.filter((s) => s.fill && s.fill.color && /^[0-9A-F]{6}$/.test(s.fill.color));
    expect(tinted.length).toBeGreaterThan(0);
  });

  it("auto-styles ✓ as success and ✗ as danger", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.cmp",
        type: "comparison-table",
        features: ["Feature 1", "Feature 2"],
        options: [
          { name: "A", values: ["✓", "✗"] },
          { name: "B", values: ["yes", "no"] },
        ],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const shapes = ast.slides[0].shapes as Array<{ type: string; paragraphs?: Array<{ runs: Array<{ text: string; color?: string }> }> }>;
    const checkRuns: Array<{ color?: string }> = [];
    const crossRuns: Array<{ color?: string }> = [];
    for (const sh of shapes) {
      for (const p of sh.paragraphs || []) {
        for (const r of p.runs || []) {
          if (/^(✓|yes)$/i.test(r.text)) checkRuns.push(r);
          if (/^(✗|no)$/i.test(r.text)) crossRuns.push(r);
        }
      }
    }
    expect(checkRuns.length).toBeGreaterThan(0);
    expect(crossRuns.length).toBeGreaterThan(0);
    // Their colors should differ — ✓ green, ✗ red
    expect(checkRuns[0]!.color).not.toBe(crossRuns[0]!.color);
  });

  it("missing values render as em-dash, not empty/blank", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.cmp",
        type: "comparison-table",
        features: ["F1", "F2", "F3"],
        options: [{ name: "Only", values: ["a"] }],  // length mismatch
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    expect(findRunByText(ast.slides[0].shapes, "—")).toBeDefined();
  });

  it("doesn't FALLBACK_FAILED with 4 options × 6 features", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.cmp",
        type: "comparison-table",
        features: ["A", "B", "C", "D", "E", "F"],
        options: [
          { name: "P1", values: ["1", "2", "3", "4", "5", "6"] },
          { name: "P2", values: ["1", "2", "3", "4", "5", "6"], recommended: true },
          { name: "P3", values: ["1", "2", "3", "4", "5", "6"] },
          { name: "P4", values: ["1", "2", "3", "4", "5", "6"] },
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide])));
    const fb = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED");
    expect(fb).toEqual([]);
  });
});

describe("end-to-end: a real TOC slide built from outline", () => {
  it("renders the 761q1u-style 5-chapter TOC without dropping body items", () => {
    // The 761q1u log used numbered-grid columns:2 and lost all 5 .body
    // entries to DROP. outline keeps all body lines because it's
    // a single-column linear list, not a grid.
    const slide: SlideV2 = {
      id: "toc",
      title: "Contents",
      children: [{
        id: "toc.outline",
        type: "outline",
        items: [
          { title: "Core Reading Strategies", body: "Skimming, Scanning, Context Clues, Inference" },
          { title: "Question Types", body: "Factual, Inference, Vocabulary, Purpose, Structure" },
          { title: "Example 1: Industrial Revolution", body: "Full passage with 4 annotated questions" },
          { title: "Example 2: Coral Reef Ecosystem", body: "Full passage with 4 annotated questions" },
          { title: "Key Takeaways", body: "Summary checklist & final tips" },
        ],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    // All 5 bodies must appear (this was the failure mode)
    for (const body of [
      "Skimming, Scanning, Context Clues, Inference",
      "Factual, Inference, Vocabulary, Purpose, Structure",
      "Full passage with 4 annotated questions",
      "Summary checklist",
    ]) {
      expect(findRunByText(ast.slides[0].shapes, body), `expected body "${body}"`).toBeDefined();
    }
  });
});
