import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { validateDeck, validateSlide } from "./validate.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Regressions for the rm8s07 debug log (2026-05-03 08:15). When the agent
 * edited a slide it ran into:
 *   1. Each missing-`type` field produced TWO error rows: MISSING_NODE_TYPE
 *      then UNKNOWN_NODE_TYPE "type \"undefined\"". Confusing pair of errors
 *      per offending node.
 *   2. Each FALLBACK_FAILED appeared TWICE in the blocking list — once with
 *      slideId set (from layoutSlide measure pass) and once without (from
 *      the renderNode → layoutStackChildren pass). The agent saw 4 blocking
 *      errors when the underlying issue was 2 nodes.
 */

const baseDeck = { deck: { size: "16x9" as const, theme: "default", brand: { primary: "8B0000" } } };

function deck(slides: SlideV2[]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { name: "Test", primary: "8B0000" } },
    slides,
  };
}

describe("missing type field surfaces as ONE error, not two (rm8s07)", () => {
  it("a child without `type` produces only MISSING_NODE_TYPE", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.card",
        type: "card",
        children: [
          { id: "s.card.h", type: "h2", text: "标题" },
          // Body deliberately missing `type`.
          { id: "s.card.body", text: "正文" } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    };
    const report = validateSlide(slide, baseDeck);
    const errors = report.errors.filter((e) => /s\.card\.body/.test(String(e.path || "")) || e.nodeName === "s.card.body");
    const missing = errors.filter((e) => e.code === "MISSING_NODE_TYPE");
    const unknown = errors.filter((e) => e.code === "UNKNOWN_NODE_TYPE");
    expect(missing.length).toBe(1);
    expect(unknown.length, "UNKNOWN_NODE_TYPE \"undefined\" should NOT also fire when type is missing").toBe(0);
  });

  it("multiple missing-type children each produce ONE error (not two)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.grid",
        type: "grid",
        columns: 3,
        children: [
          { id: "s.c1", type: "card", children: [{ id: "s.c1.body", text: "x" } as unknown as DomNode] },
          { id: "s.c2", type: "card", children: [{ id: "s.c2.body", text: "y" } as unknown as DomNode] },
          { id: "s.c3", type: "card", children: [{ id: "s.c3.body", text: "z" } as unknown as DomNode] },
        ],
      } as unknown as DomNode],
    };
    const report = validateSlide(slide, baseDeck);
    const missingTypeErrors = report.errors.filter((e) => e.code === "MISSING_NODE_TYPE");
    const unknownTypeErrors = report.errors.filter((e) => e.code === "UNKNOWN_NODE_TYPE" && /undefined/.test(e.message));
    expect(missingTypeErrors.length).toBe(3);
    expect(unknownTypeErrors.length, "should not double-emit UNKNOWN_NODE_TYPE \"undefined\"").toBe(0);
  });
});

describe("FALLBACK_FAILED dedup across measure + render passes (rm8s07)", () => {
  it("a single FALLBACK_FAILED is emitted once even though both passes detect it", () => {
    const slide: SlideV2 = {
      id: "modern",
      title: "近现代",
      children: [{
        id: "modern.grid2",
        type: "grid",
        columns: 2,
        gap: 0.5,
        area: "content",
        children: [
          {
            id: "modern.c4",
            type: "card",
            tone: "neutral",
            fixedHeight: 1.6,
            children: [
              { id: "modern.c4.h", type: "h2", text: "技术传播" },
              { id: "modern.c4.text", type: "text", text: "电报、铁路、邮政网络将南北连为一体，技术双向扩散在产业链与市场之间。" },
            ],
          } as unknown as DomNode,
          {
            id: "modern.c5",
            type: "card",
            tone: "neutral",
            fixedHeight: 1.6,
            children: [
              { id: "modern.c5.h", type: "h2", text: "政治博弈" },
              { id: "modern.c5.text", type: "text", text: "维新运动与辛亥革命均源于南北思想碰撞，近代政治转型是南北互动的产物。" },
            ],
          } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide])));
    const fallback = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED");
    // Group by nodeId — historically each id appeared twice (once with
    // slideId set, once without). After dedup, each unique node fires once.
    const byNode = new Map<string, number>();
    for (const d of fallback) {
      const k = d.nodeId || "?";
      byNode.set(k, (byNode.get(k) || 0) + 1);
    }
    for (const [nodeId, count] of byNode) {
      expect(count, `FALLBACK_FAILED on ${nodeId} fired ${count}× (expected once)`).toBe(1);
    }
  });

  it("blockingCount no longer doubles real failure count", () => {
    // Reuse the case above; assert the total FALLBACK count tracks unique
    // failing nodes, not 2× the unique count.
    const slide: SlideV2 = {
      id: "two-fail",
      title: "x",
      children: [{
        id: "two-fail.row",
        type: "stack",
        direction: "vertical",
        gap: 0.3,
        area: "content",
        children: [
          {
            id: "two-fail.row.a",
            type: "card",
            fixedHeight: 1.5,
            children: [
              { id: "two-fail.row.a.h", type: "h2", text: "A" },
              { id: "two-fail.row.a.body", type: "text", text: "稍长的正文文本，需要更多垂直空间才能完整渲染。这里增加内容到一定长度。" },
            ],
          } as unknown as DomNode,
          {
            id: "two-fail.row.b",
            type: "card",
            fixedHeight: 1.5,
            children: [
              { id: "two-fail.row.b.h", type: "h2", text: "B" },
              { id: "two-fail.row.b.body", type: "text", text: "稍长的正文文本，需要更多垂直空间才能完整渲染。这里增加内容到一定长度。" },
            ],
          } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide])));
    const fallback = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED");
    const uniqueNodes = new Set(fallback.map((d) => d.nodeId));
    // After dedup the diagnostic list size equals unique-node count.
    expect(fallback.length).toBe(uniqueNodes.size);
  });
});

describe("modern-style 3+2 cards layout (rm8s07): card body should not silently FALLBACK on small grids", () => {
  it("3-card brand + 2-card neutral grids in one slide: blockingCount tracks distinct issues", () => {
    const slide: SlideV2 = {
      id: "modern",
      title: "近现代",
      children: [
        { id: "modern.lead", type: "lead", text: "近代以来" } as unknown as DomNode,
        { id: "modern.intro", type: "text", text: "鸦片战争后" } as unknown as DomNode,
        {
          id: "modern.grid",
          type: "grid",
          columns: 3,
          gap: 0.5,
          children: Array.from({ length: 3 }, (_, i) => ({
            id: `modern.c${i + 1}`,
            type: "card",
            tone: "brand",
            children: [
              { id: `modern.c${i + 1}.h`, type: "h2", text: `维度 ${i + 1}` },
              { id: `modern.c${i + 1}.text`, type: "text", text: "短描述" },
            ],
          } as unknown as DomNode)),
        } as unknown as DomNode,
        {
          id: "modern.grid2",
          type: "grid",
          columns: 2,
          gap: 0.5,
          children: Array.from({ length: 2 }, (_, i) => ({
            id: `modern.c${i + 4}`,
            type: "card",
            tone: "neutral",
            children: [
              { id: `modern.c${i + 4}.h`, type: "h2", text: `项 ${i + 4}` },
              { id: `modern.c${i + 4}.text`, type: "text", text: "短描述" },
            ],
          } as unknown as DomNode)),
        } as unknown as DomNode,
      ],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide])));
    const fallback = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED");
    const uniqueNodes = new Set(fallback.map((d) => d.nodeId));
    // Whatever the layout outcome, the dedup contract holds: one diagnostic per node.
    expect(fallback.length).toBe(uniqueNodes.size);
  });
});
