import { describe, expect, it } from "vitest";
import { clearRenderDiagnostics, getRenderDiagnostics } from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

function buildDeck(slide: SlideV2): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { name: "Test", primary: "2563EB" } },
    slides: [slide],
  };
}

function renderSlide(slide: SlideV2) {
  clearRenderDiagnostics();
  const rendered = sourceToRenderedDeck(buildDeck(slide));
  const ast = renderToAst(rendered);
  return { ast, diagnostics: getRenderDiagnostics() };
}

describe("layer cascade (M3)", () => {
  it("depth 1: a single key-takeaway panel keeps its surface chrome", () => {
    const { ast, diagnostics } = renderSlide({
      id: "lc-single",
      children: [{
        id: "lc-single.k",
        type: "key-takeaway",
        variant: "panel",
        headline: "结论",
        detail: "支撑句",
      } as unknown as DomNode],
    });
    expect(diagnostics.some((d) => d.code === "LAYER_DEPTH_EXCEEDED")).toBe(false);
    // panel paints a tinted card; verify the card-background shape exists.
    const cardBg = ast.slides[0]!.shapes.find((s) => (s.name || "").endsWith("lc-single.k-card") || (s.name || "").endsWith("lc-single.k-background"));
    expect(cardBg).toBeDefined();
  });

  it("depth 2: key-takeaway panel inside a comparison-list paired card is allowed (≤ MAX_LAYER_DEPTH)", () => {
    const { diagnostics } = renderSlide({
      id: "lc-two",
      children: [{
        id: "lc-two.c",
        type: "comparison-list",
        variant: "paired",
        items: [
          { title: "Old", body: "旧方案", tone: "warning" },
          {
            title: "New",
            body: "推荐方案",
            recommended: true,
            // depth-2 surface — embed a key-takeaway inside the card slot
            content: {
              id: "lc-two.k",
              type: "key-takeaway",
              variant: "panel",
              headline: "升级要点",
            },
          },
        ],
      } as unknown as DomNode],
    });
    // Two levels of surface chrome is still within budget — no warning expected.
    expect(diagnostics.filter((d) => d.code === "LAYER_DEPTH_EXCEEDED")).toEqual([]);
  });

  it("depth 3: explicitly stacking tinted stacks triggers LAYER_DEPTH_EXCEEDED and strips inner chrome", () => {
    const { ast, diagnostics } = renderSlide({
      id: "lc-three",
      children: [{
        id: "lc-three.outer",
        type: "stack",
        fill: "surface.subtle",   // layer 1
        cornerRadius: 0.14,
        padding: 0.4,
        children: [{
          id: "lc-three.middle",
          type: "stack",
          fill: "brand.tint",   // layer 2
          cornerRadius: 0.1,
          padding: 0.3,
          children: [{
            id: "lc-three.inner",
            type: "stack",
            fill: "surface.subtle",   // layer 3 → should be demoted
            cornerRadius: 0.08,
            padding: 0.2,
            children: [{
              id: "lc-three.inner.text",
              type: "text",
              text: "深嵌套",
              style: "paragraph",
            }],
          }],
        }],
      } as unknown as DomNode],
    });
    const warning = diagnostics.find((d) => d.code === "LAYER_DEPTH_EXCEEDED");
    expect(warning).toBeDefined();
    expect(warning?.nodeId).toBe("lc-three.inner");

    // The inner stack should have lost its tinted background — verify no shape
    // named with the inner id carries the tinted fill anymore.
    const innerBgShapes = ast.slides[0]!.shapes.filter((s) => {
      const name = String(s.name || "");
      return name.includes("lc-three.inner") && name.endsWith("-background");
    });
    // Either no background shape, or the surface-fill chrome was stripped.
    for (const shape of innerBgShapes) {
      const color = (shape as { fill?: { type?: string; color?: string } }).fill?.color;
      // No tinted brand/subtle surface color should be present.
      expect(color).not.toMatch(/^(EEF2FF|F1F4FA|E6F6EC|FFF6E6|FEECEB|DBEAFE)$/i);
    }
  });
});
