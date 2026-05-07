import { describe, expect, it } from "vitest";
import { clearRenderDiagnostics, getRenderDiagnostics } from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

const EMU_PER_CM = 360000;

type AnyShape = {
  type: string;
  name?: string;
  preset?: string;
  xfrm?: { x: number; cx: number; cy: number };
  fill?: { type: string; color?: string; alpha?: number };
  line?: { color: string; width: number; alpha?: number };
};

function deck(child: DomNode): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
    slides: [{ id: "s", title: "Markers", children: [child] } as SlideV2],
  };
}

function renderShapes(child: DomNode): AnyShape[] {
  clearRenderDiagnostics();
  return renderToAst(sourceToRenderedDeck(deck(child))).slides[0]!.shapes as AnyShape[];
}

function byName(shapes: AnyShape[], name: string): AnyShape | undefined {
  return shapes.find((s) => s.name === name);
}

function cm(value: number | undefined): number {
  return (value || 0) / EMU_PER_CM;
}

describe("item-marker rendering", () => {
  it("keeps role:item-marker shapes small even when the authored rect is large", () => {
    const shapes = renderShapes({
      id: "s.big",
      type: "shape",
      role: "item-marker",
      preset: "rect",
      fill: "brand.primary",
      fixedWidth: 4,
      fixedHeight: 2,
    } as unknown as DomNode);

    const marker = byName(shapes, "s.big");
    expect(marker?.preset).toBe("rect");
    expect(cm(marker?.xfrm?.cx)).toBeLessThanOrEqual(0.45);
    expect(cm(marker?.xfrm?.cy)).toBeLessThanOrEqual(0.45);
  });

  it("renders semantic marker variants with stable geometry and opacity", () => {
    const shapes = renderShapes({
      id: "s.row",
      type: "stack",
      direction: "horizontal",
      gap: 0.2,
      children: [
        { id: "s.row.marker", type: "shape", role: "item-marker", marker: { shape: "rounded-square", variant: "ghost", tone: "brand", size: "sm" } },
        { id: "s.row.text", type: "text", text: "Decorated item", style: "card-title" },
      ],
    } as unknown as DomNode);

    const marker = byName(shapes, "s.row.marker");
    expect(marker?.preset).toBe("roundRect");
    expect(cm(marker?.xfrm?.cx)).toBeCloseTo(0.28, 1);
    expect(cm(marker?.xfrm?.cy)).toBeCloseTo(0.28, 1);
    expect(marker?.fill?.alpha).toBeCloseTo(0.14, 2);
    expect(marker?.line?.alpha).toBeCloseTo(0.38, 2);
  });

  it("feature-card marker replaces the large icon with a title-row marker", () => {
    const shapes = renderShapes({
      id: "s.feature",
      type: "feature-card",
      title: "Task isolation",
      body: "Reset style anchors before new work.",
      marker: { shape: "diamond", variant: "tint", tone: "brand", size: "sm" },
      variant: "card",
    } as unknown as DomNode);

    const marker = byName(shapes, "s.feature.marker");
    expect(marker?.preset).toBe("diamond");
    expect(cm(marker?.xfrm?.cx)).toBeLessThanOrEqual(0.35);
    expect(shapes.some((s) => s.name === "s.feature.icon")).toBe(false);
  });

  it("takeaway-list marker replaces the default accent bar per item", () => {
    const shapes = renderShapes({
      id: "s.takeaways",
      type: "takeaway-list",
      marker: { shape: "ring", variant: "outline", tone: "brand", size: "sm" },
      items: [
        { headline: "Skim first", detail: "Preview the structure.", tone: "brand" },
        { headline: "Eliminate", detail: "Drop unsupported answers.", tone: "positive" },
      ],
    } as unknown as DomNode);

    expect(byName(shapes, "s.takeaways.0.marker")?.preset).toBe("ellipse");
    expect(byName(shapes, "s.takeaways.1.marker")?.preset).toBe("ellipse");
    expect(shapes.some((s) => s.name === "s.takeaways.0.bar")).toBe(false);
    expect(getRenderDiagnostics().filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("takeaway-list side-bar marker does not reserve a wide empty column", () => {
    const shapes = renderShapes({
      id: "s.takeaways",
      type: "takeaway-list",
      marker: { shape: "side-bar", variant: "solid", tone: "brand", size: "md" },
      items: [
        { headline: "One", detail: "Detail" },
        { headline: "Two", detail: "Detail" },
        { headline: "Three", detail: "Detail" },
        { headline: "Four", detail: "Detail" },
      ],
    } as unknown as DomNode);

    const marker = byName(shapes, "s.takeaways.0.marker");
    const headline = byName(shapes, "s.takeaways.0.headline");
    const gap = cm(headline?.xfrm?.x) - (cm(marker?.xfrm?.x) + cm(marker?.xfrm?.cx));
    expect(cm(marker?.xfrm?.cx)).toBeLessThan(0.12);
    expect(gap).toBeGreaterThanOrEqual(0.15);
    expect(gap).toBeLessThan(0.45);
  });

  it("numbered-grid can add item title markers without changing number chips", () => {
    const shapes = renderShapes({
      id: "s.grid",
      type: "numbered-grid",
      marker: { shape: "dot", variant: "solid", tone: "brand", size: "xs" },
      items: [
        { title: "Reset", body: "Clear old task anchors." },
        { title: "Reload", body: "Load only current skills." },
      ],
    } as unknown as DomNode);

    expect(byName(shapes, "s.grid.0.marker")?.preset).toBe("ellipse");
    expect(byName(shapes, "s.grid.1.marker")?.preset).toBe("ellipse");
    expect(shapes.some((s) => s.name === "s.grid.0.num")).toBe(true);
  });
});
