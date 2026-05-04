import { describe, expect, it } from "vitest";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * stat-strip per-item tone regression. The agent's input shape:
 *   items: [
 *     { value: "78%", label: "...", tone: "positive" },
 *     { value: "65%", label: "...", tone: "warning" },
 *     { value: "43%", label: "...", tone: "danger" },
 *   ]
 *
 * Old behavior: per-item tone was silently dropped — every value rendered
 * in brand.primary, killing the good/risk/bad signal in mixed rows.
 */

function deck(slide: SlideV2): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { primary: "1A365D" } },
    slides: [slide],
  };
}

function valueColor(ast: { slides: Array<{ shapes: Array<{ name?: string }> }> }, suffix: string): string | undefined {
  const shape = ast.slides[0].shapes.find((s) => typeof s.name === "string" && s.name.endsWith(suffix)) as
    | { paragraphs?: Array<{ runs: Array<{ color?: string }> }> } | undefined;
  return shape?.paragraphs?.[0]?.runs[0]?.color?.toUpperCase();
}

describe("stat-strip per-item tone (bg.kpi regression)", () => {
  it("each item resolves its own tone independently", () => {
    const slide: SlideV2 = {
      id: "bg",
      title: "Background",
      children: [{
        id: "bg.kpi",
        type: "component",
        component: "stat-strip",
        items: [
          { value: "78%", label: "中学生曾报告学业压力", tone: "positive" },
          { value: "65%", label: "承认有过说谎行为", tone: "warning" },
          { value: "43%", label: "压力情境下说谎频率增加", tone: "danger" },
        ],
      } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    expect(valueColor(ast, "bg.kpi.0.value")).toBe("0E7C3A"); // success
    expect(valueColor(ast, "bg.kpi.1.value")).toBe("B45309"); // warning
    expect(valueColor(ast, "bg.kpi.2.value")).toBe("B42318"); // danger
    // All three values must differ — that was the bug.
    const colors = new Set([
      valueColor(ast, "bg.kpi.0.value"),
      valueColor(ast, "bg.kpi.1.value"),
      valueColor(ast, "bg.kpi.2.value"),
    ]);
    expect(colors.size).toBe(3);
  });

  it("strip-level tone applies when item tone is omitted", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.kpi",
        type: "component",
        component: "stat-strip",
        tone: "warning",
        items: [
          { value: "1", label: "a" },
          { value: "2", label: "b" },
        ],
      } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    expect(valueColor(ast, "s.kpi.0.value")).toBe("B45309");
    expect(valueColor(ast, "s.kpi.1.value")).toBe("B45309");
  });

  it("per-item tone overrides the strip default", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.kpi",
        type: "component",
        component: "stat-strip",
        tone: "brand",
        items: [
          { value: "1", label: "a" },                         // strip default → brand.primary
          { value: "2", label: "b", tone: "danger" },         // override
        ],
      } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    expect(valueColor(ast, "s.kpi.0.value")).toBe("1A365D"); // brand.primary
    expect(valueColor(ast, "s.kpi.1.value")).toBe("B42318"); // danger
  });

  it("unknown tone falls through to strip default (brand) without crashing", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.kpi",
        type: "component",
        component: "stat-strip",
        items: [
          { value: "1", label: "a", tone: "rainbow" }, // not in enum
        ],
      } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    expect(valueColor(ast, "s.kpi.0.value")).toBe("1A365D");
  });

  it("neutral tone resolves to text.primary (no accent)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.kpi",
        type: "component",
        component: "stat-strip",
        items: [{ value: "1", label: "a", tone: "neutral" }],
      } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    // text.primary in default theme is a near-black; just assert it's not
    // any of the chromatic accents.
    const c = valueColor(ast, "s.kpi.0.value");
    expect(c).toBeDefined();
    expect(["0E7C3A", "B45309", "B42318", "1A365D"]).not.toContain(c);
  });
});
