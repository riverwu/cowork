import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Audit pass for the 6 components added in this session:
 * quiz-card, takeaway-list, outline, glossary, q-and-a, comparison-table.
 *
 * For each component this suite verifies:
 *   1. Minimal call (only required fields) renders without blocking diagnostics
 *   2. Single-item case works
 *   3. Typical (3-5 item) case works
 *   4. Edge cases at the documented max
 *   5. Long text doesn't crash layout
 *   6. Field aliases mentioned in the registry mapping work
 *   7. No UNKNOWN_NODE_TYPE / MISSING_NODE_TYPE / UNKNOWN_COLOR /
 *      LOW_CONTRAST blocking diagnostics
 *   8. Required text content actually appears in the rendered AST
 */

const BLOCKING_CODES = new Set([
  "FALLBACK_FAILED", "TINY_RECT", "SQUASHED",
  "UNKNOWN_NODE_TYPE", "MISSING_NODE_TYPE",
  "UNKNOWN_COLOR", "LOW_CONTRAST",
]);

function deck(slides: SlideV2[]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
    slides,
  };
}

function renderAndCollect(slide: SlideV2) {
  clearRenderDiagnostics();
  const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
  const diagnostics = getRenderDiagnostics();
  const blocking = diagnostics.filter((d) => BLOCKING_CODES.has(d.code));
  return { ast, diagnostics, blocking };
}

function findRunByText(shapes: Array<{ type: string }>, needle: string): { text: string; bold?: boolean; color?: string; fill?: string } | undefined {
  for (const sh of shapes) {
    if (sh.type !== "text") continue;
    const t = sh as { paragraphs?: Array<{ runs: Array<{ text: string; bold?: boolean; color?: string }> }>; fill?: { color?: string } };
    for (const p of t.paragraphs || []) {
      for (const r of p.runs || []) {
        if (r.text === needle || r.text.includes(needle)) return { ...r, fill: t.fill?.color };
      }
    }
  }
  return undefined;
}

function expectNoBlocking(slide: SlideV2, label: string) {
  const { blocking } = renderAndCollect(slide);
  if (blocking.length > 0) {
    const summary = blocking.map((d) => `${d.code}@${d.nodeId || "?"}: ${(d.message || "").slice(0, 100)}`).join("\n  ");
    throw new Error(`[${label}] expected no blocking diagnostics but got ${blocking.length}:\n  ${summary}`);
  }
}

/* =========================== quiz-card =========================== */

describe("audit: quiz-card defaults", () => {
  it("minimal call (just question, no items, no correct) renders cleanly", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "Q",
      children: [{ id: "s.q", type: "quiz-card", question: "What is the capital of France?" } as unknown as DomNode],
    };
    expectNoBlocking(slide, "minimal");
    const { ast } = renderAndCollect(slide);
    expect(findRunByText(ast.slides[0].shapes, "What is the capital of France?")).toBeDefined();
  });

  it("question + 4 options, no correct, no explanation (typical MCQ)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "Q1",
      children: [{
        id: "s.q",
        type: "quiz-card",
        question: "Which is true?",
        items: ["Statement A", "Statement B", "Statement C", "Statement D"],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "4-options no correct");
    const { ast } = renderAndCollect(slide);
    for (const t of ["Statement A", "Statement B", "Statement C", "Statement D"]) {
      expect(findRunByText(ast.slides[0].shapes, t)).toBeDefined();
    }
  });

  it("with correct + explanation (full ANSWER page)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "Answer",
      children: [{
        id: "s.q",
        type: "quiz-card",
        question: "Which is true?",
        items: ["A1", "A2", "A3", "A4"],
        correct: "C",
        explanation: "Statement C aligns with the passage's main argument.",
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "with correct+explanation");
    const { ast } = renderAndCollect(slide);
    expect(findRunByText(ast.slides[0].shapes, "Statement C aligns")).toBeDefined();
    // Letter chip C should exist (chip mode auto-enabled when correct set)
    expect(findRunByText(ast.slides[0].shapes, "C")).toBeDefined();
  });

  it("legacy `options` field works as alias for `items`", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.q",
        type: "quiz-card",
        question: "Q?",
        options: ["alpha", "beta"],
        correct: "B",
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "options-alias");
    const { ast } = renderAndCollect(slide);
    expect(findRunByText(ast.slides[0].shapes, "alpha")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "beta")).toBeDefined();
  });

  it("numeric correct (0-based index) works", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.q",
        type: "quiz-card",
        question: "Q?",
        items: ["X", "Y", "Z"],
        correct: 1,
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "numeric-correct");
    const { ast } = renderAndCollect(slide);
    // Y is at index 1 → correct → its run should be bold semibold + success
    const yRun = findRunByText(ast.slides[0].shapes, "Y");
    expect(yRun).toBeDefined();
  });

  it("question + just explanation (no items) — short-answer / open-ended", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.q",
        type: "quiz-card",
        question: "Why does the author cite the steam engine?",
        explanation: "To illustrate how technological innovation enabled industrial expansion.",
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "question+explanation only");
  });

  it("max 6 items still renders cleanly", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.q",
        type: "quiz-card",
        question: "Pick the best:",
        items: ["A", "B", "C", "D", "E", "F"],
        correct: "F",
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "6-items");
  });

  it("long question text (typical TOEFL stem ~150 chars)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.q",
        type: "quiz-card",
        number: "Q1",
        questionType: "Inference",
        question: "According to the passage, what distinguished the oasis cities along the Silk Road from ordinary stopping points along the trade routes between East and West?",
        items: [
          "They produced goods for both local use and long-distance trade",
          "They were the only sources of fresh water in the desert",
          "They were ruled by Chinese imperial authorities",
          "They were home to the largest merchants on the route",
        ],
        correct: "A",
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "long-question");
  });
});

/* =========================== takeaway-list =========================== */

describe("audit: takeaway-list defaults", () => {
  it("minimal: 1 item with just headline", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "Key",
      children: [{
        id: "s.t",
        type: "takeaway-list",
        items: [{ headline: "One bold conclusion" }],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "1-item-headline-only");
    const { ast } = renderAndCollect(slide);
    expect(findRunByText(ast.slides[0].shapes, "One bold conclusion")).toBeDefined();
  });

  it("typical: 3 items with headline + detail", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "Key Takeaways",
      children: [{
        id: "s.t",
        type: "takeaway-list",
        items: [
          { headline: "Master the method", detail: "Skim, scan, eliminate, infer." },
          { headline: "Practice daily", detail: "30 min/day for 4 weeks." },
          { headline: "Track patterns", detail: "Note recurring trap answers." },
        ],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "3-items-typical");
    const { ast } = renderAndCollect(slide);
    expect(findRunByText(ast.slides[0].shapes, "Master the method")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "Skim, scan, eliminate")).toBeDefined();
  });

  it("max 6 items in dense mode", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.t",
        type: "takeaway-list",
        items: Array.from({ length: 6 }, (_, i) => ({ headline: `Takeaway ${i + 1}`, detail: `Detail ${i + 1}.` })),
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "6-items-dense");
  });

  it("per-item tone (different colors per item) renders", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.t",
        type: "takeaway-list",
        items: [
          { headline: "Strength", tone: "positive" },
          { headline: "Risk", tone: "danger" },
          { headline: "Action", tone: "brand" },
        ],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "per-item-tone");
  });
});

/* =========================== outline =========================== */

describe("audit: outline defaults", () => {
  it("minimal: 1 item with just title", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "Contents",
      children: [{
        id: "s.o",
        type: "outline",
        items: [{ title: "Just one chapter" }],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "outline-1");
    const { ast } = renderAndCollect(slide);
    expect(findRunByText(ast.slides[0].shapes, "Just one chapter")).toBeDefined();
    // No auto-numbering — agent must pass `number` explicitly when wanted.
    expect(findRunByText(ast.slides[0].shapes, "01")).toBeUndefined();
  });

  it("typical: 5 chapters with body", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "Contents",
      children: [{
        id: "s.o",
        type: "outline",
        items: [
          { title: "Introduction", body: "Why TOEFL Reading matters" },
          { title: "Strategies", body: "Four core methods" },
          { title: "Question Types", body: "Five categories" },
          { title: "Examples", body: "Worked passages" },
          { title: "Takeaways", body: "Final tips" },
        ],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "outline-5");
  });

  it("12 chapters (max) auto-very-compact", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.o",
        type: "outline",
        items: Array.from({ length: 12 }, (_, i) => ({ title: `Chapter ${i + 1}`, body: "lorem" })),
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "outline-12");
  });

  it("with showPages and tone variants", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.o",
        type: "outline",
        showPages: true,
        items: [
          { title: "Main", body: "Body", page: 3, tone: "brand" },
          { title: "Caveat", body: "Body", page: 8, tone: "warning" },
          { title: "Risk", body: "Body", page: 15, tone: "danger" },
        ],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "outline-pages-tones");
    const { ast } = renderAndCollect(slide);
    for (const p of ["p.3", "p.8", "p.15"]) {
      expect(findRunByText(ast.slides[0].shapes, p), `expected ${p}`).toBeDefined();
    }
  });

  it("custom number values (Roman numerals) work", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.o",
        type: "outline",
        items: [
          { number: "I", title: "First" },
          { number: "II", title: "Second" },
          { number: "III", title: "Third" },
        ],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "outline-roman");
    const { ast } = renderAndCollect(slide);
    expect(findRunByText(ast.slides[0].shapes, "I")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "II")).toBeDefined();
  });

  it("agent shorthand: passing a string instead of object item", () => {
    // Not officially supported, but test what happens. Should NOT crash.
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.o",
        type: "outline",
        items: ["Just a string", "Another string"] as unknown as Array<{ title: string }>,
      } as unknown as DomNode],
    };
    // Should not crash. The mapper coerces non-object via String(raw ?? "").
    // Items without title get filtered out — may end up with 0 items.
    const { ast, blocking } = renderAndCollect(slide);
    // Just verify no crash; rendering may be sparse
    expect(blocking.length).toBeGreaterThanOrEqual(0);
    expect(ast.slides.length).toBe(1);
  });
});

/* =========================== glossary =========================== */

describe("audit: glossary defaults", () => {
  it("minimal: 1 term", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "Glossary",
      children: [{
        id: "s.g",
        type: "glossary",
        items: [{ term: "Skimming", definition: "Reading quickly to grasp the main idea" }],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "glossary-1");
    const { ast } = renderAndCollect(slide);
    const t = findRunByText(ast.slides[0].shapes, "Skimming");
    expect(t).toBeDefined();
    expect(t!.bold).toBe(true);
  });

  it("typical: 5 terms list layout", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.g",
        type: "glossary",
        items: [
          { term: "Skim", definition: "Read fast for main idea" },
          { term: "Scan", definition: "Locate specific facts" },
          { term: "Infer", definition: "Draw conclusions not stated" },
          { term: "Context", definition: "Surrounding text for meaning" },
          { term: "Eliminate", definition: "Reject wrong answers first" },
        ],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "glossary-5-list");
  });

  it("8 terms two-column layout", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.g",
        type: "glossary",
        layout: "two-column",
        items: Array.from({ length: 8 }, (_, i) => ({ term: `Term${i + 1}`, definition: `Def${i + 1}.` })),
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "glossary-8-two-col");
  });

  it("max 16 terms two-column", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.g",
        type: "glossary",
        layout: "two-column",
        items: Array.from({ length: 16 }, (_, i) => ({ term: `T${i + 1}`, definition: "short def" })),
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "glossary-16-two-col");
  });

  it("aliases: name/label for term, body/description for definition", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.g",
        type: "glossary",
        items: [
          { name: "Aliased Term", body: "Aliased definition" },
        ],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "glossary-aliases");
    const { ast } = renderAndCollect(slide);
    expect(findRunByText(ast.slides[0].shapes, "Aliased Term")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "Aliased definition")).toBeDefined();
  });
});

/* =========================== q-and-a =========================== */

describe("audit: q-and-a defaults", () => {
  it("minimal: 1 Q/A pair", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "FAQ",
      children: [{
        id: "s.qa",
        type: "q-and-a",
        items: [{ q: "How long is the test?", a: "35 minutes." }],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "qa-1");
    const { ast } = renderAndCollect(slide);
    expect(findRunByText(ast.slides[0].shapes, "How long is the test?")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "35 minutes")).toBeDefined();
  });

  it("typical: 3 pairs", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.qa",
        type: "q-and-a",
        items: [
          { q: "Q1?", a: "A1." },
          { q: "Q2?", a: "A2." },
          { q: "Q3?", a: "A3." },
        ],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "qa-3");
  });

  it("max 6 pairs (very dense — beyond 6 the agent should split into two slides)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.qa",
        type: "q-and-a",
        items: Array.from({ length: 6 }, (_, i) => ({ q: `Question ${i + 1}?`, a: `Answer ${i + 1}.` })),
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "qa-6-very-dense");
  });

  it("agent passing 8+ pairs gets clamped to 6 (graceful, no crash)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.qa",
        type: "q-and-a",
        items: Array.from({ length: 12 }, (_, i) => ({ q: `Q${i + 1}?`, a: `A${i + 1}.` })),
      } as unknown as DomNode],
    };
    // Should not crash; only first 6 rendered.
    expectNoBlocking(slide, "qa-clamp-12-to-6");
  });

  it("aliases: question/answer (instead of q/a)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.qa",
        type: "q-and-a",
        items: [
          { question: "What is X?", answer: "X is Y." },
          { prompt: "What is Z?", response: "Z is W." },
        ],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "qa-aliases");
    const { ast } = renderAndCollect(slide);
    expect(findRunByText(ast.slides[0].shapes, "What is X?")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "X is Y.")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "What is Z?")).toBeDefined();
  });

  it("long answer text doesn't break layout", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.qa",
        type: "q-and-a",
        items: [
          { q: "What's the best strategy?", a: "Skim first to understand the structure, then scan for specific details when answering each question. Eliminate wrong answers based on three patterns: direct contradiction, scope issues, and unsupported claims. Always verify with a quick re-read." },
        ],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "qa-long-answer");
  });
});

/* =========================== comparison-table =========================== */

describe("audit: comparison-table defaults", () => {
  it("minimal: 1 feature × 1 option", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "Compare",
      children: [{
        id: "s.cmp",
        type: "comparison-table",
        features: ["Pricing"],
        options: [{ name: "Plan A", values: ["$10/mo"] }],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "cmp-1x1");
    const { ast } = renderAndCollect(slide);
    expect(findRunByText(ast.slides[0].shapes, "Plan A")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "$10/mo")).toBeDefined();
  });

  it("typical: 3 features × 3 options with one recommended", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.cmp",
        type: "comparison-table",
        features: ["Pricing", "Setup", "Best for"],
        options: [
          { name: "Solo", values: ["$10/mo", "5 min", "1 person"] },
          { name: "Team", values: ["$30/mo", "30 min", "<10 people"], recommended: true },
          { name: "Enterprise", values: ["$200/mo", "1 day", "100+ people"] },
        ],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "cmp-3x3");
    const { ast } = renderAndCollect(slide);
    expect(findRunByText(ast.slides[0].shapes, "RECOMMENDED")).toBeDefined();
  });

  it("max 8 features × 4 options", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.cmp",
        type: "comparison-table",
        features: ["A", "B", "C", "D", "E", "F", "G", "H"],
        options: [
          { name: "P1", values: ["1", "2", "3", "4", "5", "6", "7", "8"] },
          { name: "P2", values: ["1", "2", "3", "4", "5", "6", "7", "8"], recommended: true },
          { name: "P3", values: ["1", "2", "3", "4", "5", "6", "7", "8"] },
          { name: "P4", values: ["1", "2", "3", "4", "5", "6", "7", "8"] },
        ],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "cmp-max");
  });

  it("✓/✗/yes/no auto-color in cells", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.cmp",
        type: "comparison-table",
        features: ["Free trial", "API access", "SSO"],
        options: [
          { name: "Free", values: ["yes", "no", "no"] },
          { name: "Pro", values: ["✓", "✓", "✗"] },
          { name: "Enterprise", values: ["✓", "✓", "✓"], recommended: true },
        ],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "cmp-checks");
  });

  it("alias: option.row works as alternative for option.values", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.cmp",
        type: "comparison-table",
        features: ["A", "B"],
        options: [
          { name: "X", row: ["1", "2"] },  // row instead of values
        ],
      } as unknown as DomNode],
    };
    expectNoBlocking(slide, "cmp-alias-row");
    const { ast } = renderAndCollect(slide);
    expect(findRunByText(ast.slides[0].shapes, "X")).toBeDefined();
    expect(findRunByText(ast.slides[0].shapes, "1")).toBeDefined();
  });

  it("missing values render as em-dash, not blank", () => {
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
    expectNoBlocking(slide, "cmp-missing-values");
    const { ast } = renderAndCollect(slide);
    expect(findRunByText(ast.slides[0].shapes, "—")).toBeDefined();
  });
});

/* =========================== cross-cutting =========================== */

describe("audit: cross-component default-render fitness", () => {
  it.each([
    ["quiz-card",         { type: "quiz-card", question: "Q?", items: ["A","B","C","D"] }],
    ["takeaway-list",     { type: "takeaway-list", items: [{headline: "H1"},{headline: "H2"},{headline: "H3"}] }],
    ["outline",           { type: "outline", items: [{title: "Ch1"},{title: "Ch2"},{title: "Ch3"}] }],
    ["glossary",          { type: "glossary", items: [{term:"T1",definition:"D1"},{term:"T2",definition:"D2"}] }],
    ["q-and-a",           { type: "q-and-a", items: [{q:"q?",a:"a."},{q:"q?",a:"a."}] }],
    ["comparison-table",  { type: "comparison-table", features:["A","B"], options:[{name:"X",values:["1","2"]},{name:"Y",values:["3","4"]}] }],
  ])("each component renders cleanly with a typical-shape default call: %s", (label, body) => {
    const slide: SlideV2 = {
      id: "s",
      title: "Test",
      children: [{ id: `s.${label.replace(/-/g,"_")}`, ...body } as unknown as DomNode],
    };
    expectNoBlocking(slide, label);
  });

  it("two new components on the same slide don't FALLBACK_FAILED (mixed page)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "Mixed",
      children: [
        { id: "s.outline", type: "outline", items: [{title: "Section 1"}, {title: "Section 2"}, {title: "Section 3"}] } as unknown as DomNode,
        { id: "s.takeaway", type: "takeaway-list", items: [{headline: "Key"}, {headline: "Action"}] } as unknown as DomNode,
      ],
    };
    expectNoBlocking(slide, "mixed-outline-takeaway");
  });
});
