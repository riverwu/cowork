import { describe, expect, it } from "vitest";
import { clearRenderDiagnostics, getRenderDiagnostics } from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { buildTheme, flattenColorOverrideAlphas, flattenColorOverrides, resolveFill } from "./theme.js";
import { validateDeck } from "./validate.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

const IMG = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAwIiBoZWlnaHQ9IjkwMCI+PHJlY3Qgd2lkdGg9IjE2MDAiIGhlaWdodD0iOTAwIiBmaWxsPSIjMTExODI3Ii8+PC9zdmc+";

function deck(slides: SlideV2[], themeOverride?: Slideml2SourceDeck["deck"]["themeOverride"]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: "default",
      brand: { name: "Regression", primary: "B8860B" },
      themeOverride,
    },
    slides,
  };
}

describe("yfnf28 magazine layout regressions", () => {
  it("theme color tokens authored as rgba preserve alpha when used as fills", () => {
    const colors = { "scrim.dark": "rgba(20,15,5,0.45)", text: { warm: "rgba(255,255,255,0.82)" } };
    expect(flattenColorOverrides(colors)).toMatchObject({ "scrim.dark": "140F05", "text.warm": "FFFFFF" });
    expect(flattenColorOverrideAlphas(colors)).toMatchObject({ "scrim.dark": 0.45, "text.warm": 0.82 });

    const theme = buildTheme({}, "default", { colors });
    const fill = resolveFill(theme, "scrim.dark", "background");
    expect(fill.type).toBe("solid");
    if (fill.type === "solid") {
      expect(fill.color).toBe("140F05");
      expect(fill.alpha).toBeCloseTo(0.45, 2);
    }
  });

  it("freeform-group infers all-background bg/scrim children as full-slide background layers", () => {
    const slide: SlideV2 = {
      id: "geo",
      children: [{
        id: "geo.bg-layer",
        type: "freeform-group",
        children: [
          { id: "geo.bg", type: "image", src: IMG, fit: "cover" },
          { id: "geo.scrim", type: "shape", preset: "rect", fill: "scrim.dark" },
        ],
      } as unknown as DomNode, {
        id: "geo.title",
        type: "text",
        text: "香格里拉",
        style: "deck-title",
        color: "text.inverse",
        area: "content",
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide], { colors: { "scrim.dark": "rgba(20,15,5,0.45)" } })));
    const shapes = ast.slides[0]!.shapes as Array<{ name?: string; xfrm: { x: number; y: number; cx: number; cy: number }; fill?: { type: string; color?: string; alpha?: number } }>;
    const bg = shapes.find((shape) => shape.name === "geo.bg");
    const scrim = shapes.find((shape) => shape.name === "geo.scrim");
    expect(bg?.xfrm).toMatchObject({ x: 0, y: 0, cx: 9144000, cy: 5143500 });
    expect(scrim?.xfrm).toMatchObject({ x: 0, y: 0, cx: 9144000, cy: 5143500 });
    expect(scrim?.fill).toMatchObject({ type: "solid", color: "140F05", alpha: 0.45 });
  });

  it("freeform-group validates likely background mode so the inference is visible to agents", () => {
    const validation = validateDeck(deck([{
      id: "geo",
      children: [{
        id: "geo.bg-layer",
        type: "freeform-group",
        children: [
          { id: "geo.bg", type: "image", src: IMG },
          { id: "geo.scrim", type: "shape", preset: "rect", fill: "rgba(0,0,0,0.5)" },
        ],
      } as unknown as DomNode],
    }]));
    expect(validation.warnings.some((warning) => warning.code === "FREEFORM_BACKGROUND_MODE_INFERRED")).toBe(true);
  });

  it("scrim/backdrop shapes are not auto-bordered as invisible cards", () => {
    const slide: SlideV2 = {
      id: "hero",
      background: "1A1508",
      children: [{
        id: "hero.scrim",
        type: "shape",
        preset: "rect",
        fill: "1A1508",
        anchor: "top-left",
        fillSlide: true,
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide])));
    const hits = getRenderDiagnostics().filter((d) => d.code === "SHAPE_INVISIBLE_FIXED" && d.nodeId === "hero.scrim");
    expect(hits).toHaveLength(0);
  });

  it("text over a bitmap background is not auto-recolored against the fallback slide background", () => {
    const slide: SlideV2 = {
      id: "cover",
      children: [
        { id: "cover.bg", type: "image", src: IMG, fit: "cover", layer: "behind" } as unknown as DomNode,
        { id: "cover.title", type: "text", text: "香格里拉", style: "deck-title", color: "text.inverse", area: "content" } as unknown as DomNode,
      ],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide], { colors: { background: "FEFEFE" } })));
    const contrastFixes = getRenderDiagnostics().filter((d) => d.code === "LOW_CONTRAST_FIXED" && d.nodeId === "cover.title");
    expect(contrastFixes).toHaveLength(0);
  });
});
