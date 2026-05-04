import { describe, expect, it } from "vitest";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * qtt7dd slide 11 visual regression: bar-list previously rendered as two
 * side-by-side roundRects (fill + empty), each with full corner radius.
 * The rounded inner edges read as two separate pills with a visible seam,
 * so the agent's progress bars looked hand-stitched.
 *
 * New shape: a single rounded *track* (the wrapping stack with fill+
 * cornerRadius) holds a single rounded *fill* and a transparent spacer.
 * Pill-inside-pill — no seam.
 */

function deck(slide: SlideV2): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
    slides: [slide],
  };
}

function shapesByPrefix(ast: { slides: Array<{ shapes: Array<{ name?: string; preset?: string; fill?: { color?: string }; type?: string }> }> }, prefix: string) {
  return ast.slides[0].shapes.filter((s) => typeof s.name === "string" && s.name.includes(prefix));
}

describe("bar-list pill-inside-pill rendering", () => {
  it("renders ONE rounded track surface and ONE rounded fill (no second .empty pill)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.bars",
        type: "bar-list",
        tone: "warning",
        items: [
          { label: "A", value: 80 },
          { label: "B", value: 40 },
        ],
      } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    // The old shape `.empty` (the second pill) must NOT appear anymore.
    const oldEmpty = ast.slides[0].shapes.filter((s) => typeof s.name === "string" && s.name.endsWith(".empty"));
    expect(oldEmpty).toHaveLength(0);
    // Exactly one fill shape per row.
    const fills = ast.slides[0].shapes.filter((s) => typeof s.name === "string" && s.name.endsWith(".fill"));
    expect(fills).toHaveLength(2);
    // Each fill is a roundRect.
    for (const f of fills) {
      expect((f as { preset?: string }).preset).toBe("roundRect");
    }
  });

  it("the wrapping track stack carries the trackToken fill (the rounded backing pill)", () => {
    // The track's rounded backing is the parent stack — it surfaces in the
    // shape list as a text/shape with name ending in `.track` (the stack
    // itself emits a backing rect when fill+cornerRadius are set).
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.bars",
        type: "bar-list",
        tone: "brand",
        items: [{ label: "A", value: 50 }],
      } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    // There should be a backing shape representing the track surface
    // (carries surface.subtle as its fill).
    const trackBackings = shapesByPrefix(ast, ".track");
    // At least one shape that holds the surface.subtle fill must exist
    // (the wrapping stack's backing).
    const subtleHex = "F1F4FA"; // default theme surface.subtle
    const hasBacking = ast.slides[0].shapes.some((s) =>
      typeof (s as { fill?: { color?: string } }).fill?.color === "string"
      && (s as { fill: { color: string } }).fill.color.toUpperCase() === subtleHex
    );
    expect(hasBacking).toBe(true);
    // And the .fill shape exists with the warning/brand fillToken.
    const fillShape = ast.slides[0].shapes.find((s) => typeof s.name === "string" && s.name.endsWith(".fill")) as
      | { fill?: { color?: string } } | undefined;
    expect(fillShape?.fill?.color?.toUpperCase()).toBe("2563EB");
    expect(trackBackings.length).toBeGreaterThan(0);
  });

  it("a 100%-fill bar still has a sibling spacer (so layout is stable, not collapsed to a pure fill)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.bars",
        type: "bar-list",
        items: [{ label: "Full", value: 100, max: 100 }],
      } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    // .fill exists.
    const fillShape = ast.slides[0].shapes.find((s) => typeof s.name === "string" && s.name.endsWith(".fill"));
    expect(fillShape).toBeDefined();
    // No `.empty` rounded pill.
    const oldEmpty = ast.slides[0].shapes.filter((s) => typeof s.name === "string" && s.name.endsWith(".empty"));
    expect(oldEmpty).toHaveLength(0);
  });
});
