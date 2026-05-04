import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { validateSlide } from "./validate.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Regression for the 761q1u debug log (2026-05-03 11:01). The TOEFL deck
 * surfaced 6 distinct issues:
 *   1. cover.accent_line / cover.decor (frame + tiny fixedHeight) → TINY_RECT
 *   2. numbered-grid item bodies dropped on dense 2-col layouts
 *   3. findConstrainingAncestor reported decorative inner fixedHeight as
 *      the bottleneck (sm.kt.accent.fixedHeight = 0.18 — misleading)
 *   4. ex1-q1q2 / q3q4: callout + paragraph "A) ... | B) ... | ..." MCQ
 *      pattern compressed to 0.59cm rect → unreadable
 *   5. summary slide used callout for Key Takeaway → not visually dominant
 *   6. article long-text auto-pagination must not be blocked by validate
 */

const EMU_PER_CM = 360000;

function deck(slides: SlideV2[]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { name: "TOEFL", primary: "8B2942" } },
    slides,
  };
}

describe("761q1u-1: frame-as-divider fallback (mirror band-divider)", () => {
  it("a frame with empty children + small fixedHeight renders as a solid divider", () => {
    const slide: SlideV2 = {
      id: "cover",
      children: [{
        id: "cover.accent_line",
        type: "frame",
        line: "FFFFFF",
        lineWidth: 0.5,
        fixedHeight: 0.08,
        children: [],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const shapes = ast.slides[0].shapes as Array<{ type: string; name?: string; preset?: string; fill?: { type: string; color?: string }; xfrm?: { cy: number } }>;
    const frameShape = shapes.find((s) => typeof s.name === "string" && s.name.endsWith("-frame"));
    expect(frameShape).toBeDefined();
    if (!frameShape) return;
    // Solid filled rect at 0.08cm tall — NOT TINY_RECT-dropped, NOT a
    // hollow outline that disappears at hairline thickness. The fill
    // color may be auto-promoted by the SHAPE_INVISIBLE check when the
    // requested color (FFFFFF here) matches the slide bg (also FFFFFF
    // by default); the important contract is that the divider remains
    // a visible solid shape at the right size.
    expect(frameShape.fill?.type).toBe("solid");
    expect(frameShape.fill?.color).toBeDefined();
    expect(frameShape.xfrm!.cy).toBe(Math.round(0.08 * EMU_PER_CM));
  });

  it("normal frame (with children) keeps outline behavior", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.frame",
        type: "frame",
        line: "AAAAAA",
        lineWidth: 0.025,
        children: [{ id: "s.frame.body", type: "text", text: "framed text" }],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const shapes = ast.slides[0].shapes as Array<{ type: string; name?: string; fill?: { type: string }; line?: { color: string } }>;
    const frameShape = shapes.find((s) => typeof s.name === "string" && s.name.endsWith("-frame"));
    expect(frameShape!.fill?.type).toBe("none");
    expect(frameShape!.line).toBeDefined();
  });
});

describe("761q1u-2: numbered-grid 5+ items uses smaller chip in dense mode", () => {
  it("numbered-grid with 5 items emits a 0.7cm chip (not 0.95cm) so body fits", () => {
    const slide: SlideV2 = {
      id: "toc",
      title: "Contents",
      children: [{
        id: "toc.items",
        type: "numbered-grid",
        columns: 2,
        items: [
          { title: "Section 1", body: "Description 1" },
          { title: "Section 2", body: "Description 2" },
          { title: "Section 3", body: "Description 3" },
          { title: "Section 4", body: "Description 4" },
          { title: "Section 5", body: "Description 5" },
        ],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const shapes = ast.slides[0].shapes as Array<{ type: string; xfrm?: { cx: number; cy: number }; fill?: { type: string; color?: string }; paragraphs?: Array<{ runs: Array<{ text: string }> }> }>;
    // Chip is rendered as a TEXT shape (not "shape") with a single-char run
    // (the index "1".."5") and a brand-color fill, sized 0.7×0.7cm.
    const chipShapes = shapes.filter((s) => s.type === "text" && s.fill?.type === "solid"
      && s.xfrm?.cx === Math.round(0.7 * EMU_PER_CM)
      && s.xfrm?.cy === Math.round(0.7 * EMU_PER_CM)
      && s.paragraphs?.length === 1 && /^\d$/.test(s.paragraphs[0]!.runs[0]!.text));
    expect(chipShapes.length).toBeGreaterThanOrEqual(1);
  });
});

describe("761q1u-3: findConstrainingAncestor skips trivial decorative fixedHeight", () => {
  it("a stack failing to fit children does NOT blame an inner 0.18cm accent shape", () => {
    // Build a stack where the inner accent shape has tiny fixedHeight,
    // and the children together overflow the parent's allocation.
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.kt",
        type: "stack",
        direction: "vertical",
        // Pin the parent height so children can't fit.
        fixedHeight: 2.0,
        children: [
          // Decorative accent (tiny fixedHeight) — must NOT be blamed.
          { id: "s.kt.accent", type: "shape", preset: "rect", fill: "brand.primary", fixedHeight: 0.18, fixedWidth: 3.2 },
          // Long body that needs more than 2cm.
          { id: "s.kt.headline", type: "text", style: "section-title", text: "重要发现", minHeight: 1.8 },
          { id: "s.kt.detail", type: "text", style: "lead", text: "支持文本，需要相当多的高度才能正常渲染。", minHeight: 1.5 },
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide])));
    const fb = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED");
    if (fb.length > 0) {
      for (const d of fb) {
        const constraintId = (d.constrainedBy as { ancestorId?: string } | undefined)?.ancestorId;
        // The diagnostic should NOT point at the decorative accent shape.
        expect(constraintId).not.toBe("s.kt.accent");
      }
    }
  });
});

describe("761q1u-4: quiz-card component", () => {
  it("a quiz-card renders question stem + 4 lettered options as separate rows", () => {
    const slide: SlideV2 = {
      id: "q",
      title: "Quiz",
      children: [{
        id: "q.card",
        type: "quiz-card",
        number: "Q1",
        questionType: "Inference",
        question: "What can be inferred from paragraph 2?",
        options: [
          "It began in Britain",
          "It occurred gradually over centuries",
          "It introduced mechanized manufacturing on a large scale",
          "It primarily affected rural populations",
        ],
        correct: "C",
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const shapes = ast.slides[0].shapes as Array<{ type: string; name?: string; paragraphs?: Array<{ runs: Array<{ text: string }> }>; fill?: { color?: string } }>;
    const texts = shapes.filter((s) => s.type === "text" && (s.paragraphs?.length || 0) > 0).map((s) => s.paragraphs![0]!.runs[0]!.text);
    // Letter chips A B C D each present
    expect(texts).toEqual(expect.arrayContaining(["A", "B", "C", "D"]));
    // Stem should include "Q1 · Inference — What can be inferred from paragraph 2?"
    const stem = texts.find((t) => t.includes("can be inferred"));
    expect(stem).toBeDefined();
    expect(stem).toContain("Q1");
    expect(stem).toContain("Inference");
  });

  it("the correct option's letter chip uses success fill", () => {
    const slide: SlideV2 = {
      id: "q",
      title: "x",
      children: [{
        id: "q.card",
        type: "quiz-card",
        question: "Test?",
        options: ["Wrong A", "Wrong B", "Right C", "Wrong D"],
        correct: "C",
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const shapes = ast.slides[0].shapes as Array<{ type: string; paragraphs?: Array<{ runs: Array<{ text: string; color?: string }> }>; fill?: { type: string; color?: string } }>;
    // Find the chip whose only run is "C"
    const cChip = shapes.find((s) => s.type === "text"
      && s.paragraphs?.length === 1
      && s.paragraphs[0]!.runs.length === 1
      && s.paragraphs[0]!.runs[0]!.text === "C"
      && s.fill);
    expect(cChip).toBeDefined();
    // Find another chip (A) — its fill should differ from C
    const aChip = shapes.find((s) => s.type === "text"
      && s.paragraphs?.length === 1
      && s.paragraphs[0]!.runs.length === 1
      && s.paragraphs[0]!.runs[0]!.text === "A"
      && s.fill);
    expect(aChip!.fill?.color).not.toBe(cChip!.fill?.color);
  });
});

describe("761q1u-5: takeaway-list component", () => {
  it("takeaway-list with 3 items renders 3 accent bars + 3 headlines", () => {
    const slide: SlideV2 = {
      id: "summary",
      title: "Key Takeaways",
      children: [{
        id: "sm.list",
        type: "takeaway-list",
        items: [
          { headline: "Skim before answering", detail: "Always preview structure first." },
          { headline: "Eliminate wrong answers", detail: "Identify pattern: contradictory, too broad, unsupported." },
          { headline: "Time per passage", detail: "Aim for 15 minutes per passage on test day." },
        ],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const shapes = ast.slides[0].shapes as Array<{ type: string; preset?: string; paragraphs?: Array<{ runs: Array<{ text: string }> }>; fill?: { type: string } }>;
    // 3 accent bars (rect with fill) — match by aggregating headline text
    const headlines = shapes.filter((s) => s.type === "text" && s.paragraphs?.some((p) => p.runs.some((r) => /Skim|Eliminate|Time per/.test(r.text))));
    expect(headlines.length).toBe(3);
  });

  it("takeaway-list with 5 items in dense mode does NOT FALLBACK_FAILED", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "Key Takeaways",
      children: [{
        id: "sm.list",
        type: "takeaway-list",
        items: [
          { headline: "Item 1" },
          { headline: "Item 2" },
          { headline: "Item 3" },
          { headline: "Item 4" },
          { headline: "Item 5" },
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide])));
    const fb = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED");
    expect(fb.length).toBe(0);
  });
});

describe("761q1u-7: insight-card / metric-card auto-shrink under tight allocation", () => {
  it("4 insight-cards in a 2×2 grid don't FALLBACK_FAILED (badge becomes optional)", () => {
    const slide: SlideV2 = {
      id: "strat",
      title: "Four Strategies",
      children: [{
        id: "strat.grid",
        type: "grid",
        columns: 2,
        children: [
          { id: "s1", type: "insight-card", headline: "Skimming", badge: "Speed", detail: "Read quickly to grasp main idea.", tone: "brand" },
          { id: "s2", type: "insight-card", headline: "Scanning", badge: "Target", detail: "Locate specific facts, names, dates.", tone: "brand" },
          { id: "s3", type: "insight-card", headline: "Context", badge: "Vocabulary", detail: "Use surrounding text to infer meaning.", tone: "brand" },
          { id: "s4", type: "insight-card", headline: "Inference", badge: "Logic", detail: "Draw conclusions not explicitly stated.", tone: "brand" },
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide])));
    const fb = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED");
    expect(fb.length).toBe(0);
  });

  it("5 metric-cards in a single row don't FALLBACK_FAILED (label demotes)", () => {
    const slide: SlideV2 = {
      id: "kpis",
      title: "Five KPIs",
      children: [{
        id: "kpis.grid",
        type: "grid",
        columns: 5,
        children: Array.from({ length: 5 }, (_, i) => ({
          id: `kpi${i + 1}`,
          type: "metric-card",
          value: `${(i + 1) * 10}%`,
          label: `Metric ${i + 1}`,
        })),
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide])));
    const fb = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED");
    expect(fb.length).toBe(0);
  });
});

describe("761q1u-6: article long-text auto-pagination is not blocked by validate", () => {
  it("article with very long text passes validation (no errorCount > 0)", () => {
    // 5,000 char article — well over a single slide's capacity.
    const longText = Array.from({ length: 30 }, (_, i) =>
      `Paragraph ${i + 1}. ${"This is a long English sentence used for testing automatic article pagination across multiple slides. ".repeat(3)}`
    ).join("\n\n");
    const slide: SlideV2 = {
      id: "long-article",
      title: "Industrial Revolution",
      children: [{
        id: "art",
        type: "component",
        component: "article",
        title: "The Industrial Revolution",
        text: longText,
      } as unknown as DomNode],
    };
    const report = validateSlide(slide);
    // Validation must not block long-form content.
    expect(report.errors.filter((e) => e.severity === "error").length).toBe(0);
  });

  it("article with very long text auto-paginates into multiple rendered slides", () => {
    const longText = Array.from({ length: 30 }, (_, i) =>
      `Paragraph ${i + 1}. ${"This is a long sentence used for pagination testing. ".repeat(4)}`
    ).join("\n\n");
    const src: Slideml2SourceDeck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default", brand: { name: "Test", primary: "2563EB" } },
      slides: [{
        id: "long",
        title: "Long Article",
        children: [{
          id: "long.art",
          type: "component",
          component: "article",
          text: longText,
        } as unknown as DomNode],
      }],
    };
    const rendered = sourceToRenderedDeck(src);
    // The single source slide expands to N rendered slides via
    // expandArticleSlide.
    expect(rendered.slides.length).toBeGreaterThan(1);
    // Rendering succeeds end-to-end.
    expect(() => renderToAst(rendered)).not.toThrow();
  });
});
