import { describe, expect, it } from "vitest";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * qyectb log slide 13 (conclusion): takeaway-list received four items with
 * tones [brand, positive, warning, neutral]. The 'neutral' value was
 * silently coerced to brand by the registry normalizer, so the agent's
 * intended visual hierarchy (3 chromatic findings + 1 muted caveat) was
 * lost — all four bars rendered as either brand or warning, with no
 * de-emphasized item.
 *
 * Fix: 'neutral' is now a first-class takeaway tone that maps to a
 * divider-gray accent bar.
 */

function deck(slide: SlideV2): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { primary: "2D5F8A" } },
    slides: [slide],
  };
}

function barFill(ast: { slides: Array<{ shapes: Array<{ name?: string; fill?: { color?: string } }> }> }, suffix: string): string | undefined {
  return ast.slides[0].shapes.find((s) => typeof s.name === "string" && s.name.endsWith(suffix))?.fill?.color?.toUpperCase();
}

describe("takeaway-list neutral tone (qyectb regression)", () => {
  it("the 4-item conclusion slide produces 4 distinct bar colors when tones are [brand, positive, warning, neutral]", () => {
    const slide: SlideV2 = {
      id: "conclusion",
      title: "结论与建议",
      children: [{
        id: "conc.takeaway",
        type: "takeaway-list",
        items: [
          { headline: "压力是说谎的重要预测因素", detail: "...", tone: "brand" },
          { headline: "认知负荷揭示中介机制", detail: "...", tone: "positive" },
          { headline: "存在显著的性别差异", detail: "...", tone: "warning" },
          { headline: "需关注学生压力管理", detail: "...", tone: "neutral" },
        ],
      } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const bars = [
      barFill(ast, "conc.takeaway.0.bar"),
      barFill(ast, "conc.takeaway.1.bar"),
      barFill(ast, "conc.takeaway.2.bar"),
      barFill(ast, "conc.takeaway.3.bar"),
    ];
    // No two bars share a color — the agent's intent of 4 distinct emphases survives.
    expect(new Set(bars).size).toBe(4);
    // Brand item retains brand.primary.
    expect(bars[0]).toBe("2D5F8A");
    // Neutral resolves to a divider/gray, NOT brand.primary.
    expect(bars[3]).not.toBe("2D5F8A");
  });

  it("strip-level tone='neutral' applies to all items lacking their own tone", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.t",
        type: "takeaway-list",
        tone: "neutral",
        items: [
          { headline: "a" },
          { headline: "b" },
        ],
      } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const c0 = barFill(ast, "s.t.0.bar");
    const c1 = barFill(ast, "s.t.1.bar");
    expect(c0).toBeDefined();
    expect(c0).toBe(c1);
    // Not brand.primary.
    expect(c0).not.toBe("2D5F8A");
  });

  it("an unknown tone still falls back to brand (does NOT silently become danger)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.t",
        type: "takeaway-list",
        items: [{ headline: "a", tone: "rainbow" }],
      } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    expect(barFill(ast, "s.t.0.bar")).toBe("2D5F8A");
  });

  it("mixed-tone hierarchy {brand, neutral} produces a clear emphasis split", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.t",
        type: "takeaway-list",
        items: [
          { headline: "Major finding", tone: "brand" },
          { headline: "Caveat", tone: "neutral" },
        ],
      } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const a = barFill(ast, "s.t.0.bar");
    const b = barFill(ast, "s.t.1.bar");
    expect(a).toBe("2D5F8A");
    expect(b).not.toBe(a);
  });
});
