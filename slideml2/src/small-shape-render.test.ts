import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Small decorative shapes — dots, ticks, accent rules, bullet markers —
 * must survive the full layout/render pipeline. Without these guarantees,
 * agents drawing tiny circles or thin rules would silently lose them.
 *
 * What we lock in here:
 *   1. Sub-cm fixed-size shapes are NOT TINY_RECT-dropped.
 *   2. EMU rounding never collapses cx/cy to 0.
 *   3. fixedWidth/fixedHeight is honored exactly (no layout-solver squish).
 *   4. SHAPE_INVISIBLE auto-promote does NOT change the rect — only color.
 *   5. Inside a stack with siblings, fixed-sized shapes preserve their size.
 */

const EMU_PER_CM = 360000;

function deck(slides: SlideV2[]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { primary: "1A365D" } },
    slides,
  };
}

function findShape(ast: { slides: Array<{ shapes: Array<{ name?: string }> }> }, suffix: string) {
  return ast.slides[0].shapes.find((s) => typeof s.name === "string" && s.name.endsWith(suffix)) as
    | { type?: string; preset?: string; xfrm: { x: number; y: number; cx: number; cy: number }; fill?: { type: string; color?: string }; line?: unknown }
    | undefined;
}

describe("small shapes survive render", () => {
  it("0.3cm filled circle keeps its size after layout (cx=cy=108000 EMU)", () => {
    clearRenderDiagnostics();
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.dot",
        type: "shape",
        preset: "ellipse",
        fill: "brand.primary",
        line: "brand.primary",
        fixedWidth: 0.3,
        fixedHeight: 0.3,
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const dot = findShape(ast, "s.dot");
    expect(dot).toBeDefined();
    expect(dot!.preset).toBe("ellipse");
    expect(dot!.xfrm.cx).toBe(Math.round(0.3 * EMU_PER_CM));
    expect(dot!.xfrm.cy).toBe(Math.round(0.3 * EMU_PER_CM));
    // Not TINY_RECT-dropped.
    const dropped = getRenderDiagnostics().filter((d) => d.code === "TINY_RECT");
    expect(dropped).toHaveLength(0);
  });

  it("0.15cm dot (the lower bound) still renders, not TINY_RECT'd", () => {
    clearRenderDiagnostics();
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.tick",
        type: "shape",
        preset: "ellipse",
        fill: "brand.primary",
        fixedWidth: 0.15,
        fixedHeight: 0.15,
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const tick = findShape(ast, "s.tick");
    expect(tick).toBeDefined();
    expect(tick!.xfrm.cx).toBe(Math.round(0.15 * EMU_PER_CM));
    expect(tick!.xfrm.cy).toBe(Math.round(0.15 * EMU_PER_CM));
    const dropped = getRenderDiagnostics().filter((d) => d.code === "TINY_RECT");
    expect(dropped).toHaveLength(0);
  });

  it("0.06cm-tall accent rule preserves height (21600 EMU, not zero)", () => {
    clearRenderDiagnostics();
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.rule",
        type: "shape",
        preset: "rect",
        fill: "brand.primary",
        line: "brand.primary",
        fixedWidth: 4,
        fixedHeight: 0.06,
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const rule = findShape(ast, "s.rule");
    expect(rule).toBeDefined();
    expect(rule!.xfrm.cy).toBe(Math.round(0.06 * EMU_PER_CM));
    expect(rule!.xfrm.cy).toBeGreaterThan(0);
    // Width is honored exactly (4cm = 1440000 EMU).
    expect(rule!.xfrm.cx).toBe(Math.round(4 * EMU_PER_CM));
  });

  it("a small dot inside a stack with text siblings keeps its fixed size", () => {
    clearRenderDiagnostics();
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.row",
        type: "stack",
        direction: "horizontal",
        gap: 0.3,
        children: [
          {
            id: "s.row.dot",
            type: "shape",
            preset: "ellipse",
            fill: "brand.primary",
            fixedWidth: 0.4,
            fixedHeight: 0.4,
          } as unknown as DomNode,
          { id: "s.row.label", type: "text", text: "Active", style: "paragraph" } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const dot = findShape(ast, "s.row.dot");
    expect(dot).toBeDefined();
    // Dot stays exactly 0.4cm × 0.4cm, even though it's flowing in a stack
    // alongside an arbitrary-width text sibling.
    expect(dot!.xfrm.cx).toBe(Math.round(0.4 * EMU_PER_CM));
    expect(dot!.xfrm.cy).toBe(Math.round(0.4 * EMU_PER_CM));
    // No TINY_RECT or SQUASHED on the dot.
    const issues = getRenderDiagnostics().filter((d) =>
      (d.code === "TINY_RECT" || d.code === "SQUASHED") && d.nodeId === "s.row.dot"
    );
    expect(issues).toHaveLength(0);
  });

  it("a 0.4cm circle whose fill matches the surface gets auto-promoted but keeps its size", () => {
    // Regression for the SHAPE_INVISIBLE auto-fix path: the renderer must
    // change the *color* without touching the *rect*. A tiny dot that gets
    // resized to nothing is no better than an invisible dot.
    clearRenderDiagnostics();
    const slide: SlideV2 = {
      id: "s",
      background: "brand.primary",
      children: [{
        id: "s.tinydot",
        type: "shape",
        preset: "ellipse",
        fill: "brand.primary",  // same as bg → invisible
        line: "brand.primary",
        fixedWidth: 0.4,
        fixedHeight: 0.4,
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const dot = findShape(ast, "s.tinydot");
    expect(dot).toBeDefined();
    // Size preserved.
    expect(dot!.xfrm.cx).toBe(Math.round(0.4 * EMU_PER_CM));
    expect(dot!.xfrm.cy).toBe(Math.round(0.4 * EMU_PER_CM));
    // Color was promoted away from brand.primary.
    expect(dot!.fill?.color?.toUpperCase()).not.toBe("1A365D");
    const fixed = getRenderDiagnostics().filter((d) => d.code === "SHAPE_INVISIBLE_FIXED");
    expect(fixed.length).toBeGreaterThan(0);
  });

  it("multiple small dots in a horizontal stack each render at their fixed size", () => {
    clearRenderDiagnostics();
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.dots",
        type: "stack",
        direction: "horizontal",
        gap: 0.2,
        children: [0, 1, 2, 3, 4].map((i) => ({
          id: `s.dots.${i}`,
          type: "shape",
          preset: "ellipse",
          fill: i < 3 ? "brand.primary" : "divider",
          fixedWidth: 0.35,
          fixedHeight: 0.35,
        } as unknown as DomNode)),
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    for (const i of [0, 1, 2, 3, 4]) {
      const dot = findShape(ast, `s.dots.${i}`);
      expect(dot, `dot ${i}`).toBeDefined();
      expect(dot!.xfrm.cx).toBe(Math.round(0.35 * EMU_PER_CM));
      expect(dot!.xfrm.cy).toBe(Math.round(0.35 * EMU_PER_CM));
    }
  });

  it("a thin (0.04cm) line shape renders without dropping", () => {
    clearRenderDiagnostics();
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.hairline",
        type: "shape",
        preset: "line",
        line: "divider",
        lineWidth: 0.04,
        fixedWidth: 8,
        fixedHeight: 0.04,
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const hair = findShape(ast, "s.hairline");
    expect(hair).toBeDefined();
    expect(hair!.xfrm.cy).toBe(Math.round(0.04 * EMU_PER_CM));
    const dropped = getRenderDiagnostics().filter((d) => d.code === "TINY_RECT");
    expect(dropped).toHaveLength(0);
  });

  it("OOXML emission preserves small shape geometry (cx/cy survive the wire format)", async () => {
    const { shapeXml } = await import("./emitter/shapes.js");
    const xml = shapeXml({
      type: "shape",
      id: 1,
      name: "tiny",
      preset: "ellipse",
      xfrm: {
        x: Math.round(2 * EMU_PER_CM),
        y: Math.round(2 * EMU_PER_CM),
        cx: Math.round(0.3 * EMU_PER_CM),
        cy: Math.round(0.3 * EMU_PER_CM),
      },
      fill: { type: "solid", color: "1A365D" },
    } as never, "/ppt/slides/slide1.xml", { entries: [], nextRId: 1 } as never);
    // cx="108000" cy="108000" must appear literally in the wire format —
    // PowerPoint reads these directly. A renderer that filtered them out
    // would silently drop the shape.
    expect(xml).toContain('cx="108000"');
    expect(xml).toContain('cy="108000"');
    expect(xml).toContain('<a:prstGeom prst="ellipse"');
    expect(xml).toContain('<a:srgbClr val="1A365D">');
  });
});
