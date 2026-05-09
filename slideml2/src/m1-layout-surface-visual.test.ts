import { describe, expect, it } from "vitest";
import { clearRenderDiagnostics, getRenderDiagnostics } from "./diagnostics.js";
import { measureDeck, renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { validateDeck } from "./validate.js";
import type { Slideml2SourceDeck } from "./types.js";

const EMU_PER_CM = 360000;

type ShapeLike = {
  type: string;
  name?: string;
  xfrm?: { x: number; y: number; cx: number; cy: number };
  fill?: { type: string; color?: string; alpha?: number; stops?: Array<{ color: string; alpha?: number }> };
  line?: { color: string; alpha?: number; dash?: string; width: number };
  shadow?: { color: string; alpha?: number; blur?: number; dy?: number };
};

function findShape(shapes: ShapeLike[], name: string): ShapeLike {
  const found = shapes.find((shape) => shape.name === name);
  expect(found, `missing shape ${name}`).toBeDefined();
  return found!;
}

function cm(value: number): number {
  return Math.round(value * EMU_PER_CM);
}

describe("M1 layout and surface visual smoke", () => {
  it("renders 4x3 canvas, named areas, and advanced surface fields into the AST", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "4x3",
        theme: "default",
        brand: { primary: "2563EB" },
        themeOverride: {
          layout: {
            areas: {
              leftRail: { x: 1.0, y: 2.0, w: 5.0, h: 14.0 },
              main: { left: 6.5, top: 2.0, right: 24.2, bottom: 18.2 },
            },
          },
        },
      },
      slides: [{
        id: "m1",
        children: [
          {
            id: "m1.left",
            type: "stack",
            area: "leftRail",
            fill: "brand.tint",
            fillOpacity: 0.5,
            line: "brand.primary",
            lineOpacity: 0.4,
            lineWidth: 1,
            lineDash: "dash",
            shadow: { color: "brand.primary", alpha: 0.3, blur: 64000, dy: 32000 },
            padding: 0.3,
            children: [{ id: "m1.left.text", type: "text", text: "Left rail" }],
          },
          {
            id: "m1.main",
            type: "stack",
            area: "main",
            gradient: {
              angle: 90,
              stops: [
                { color: "surface", position: 0 },
                { color: "brand.tint", position: 1, alpha: 0.75 },
              ],
            },
            line: "divider",
            padding: 0.4,
            children: [{ id: "m1.main.text", type: "text", text: "Main evidence area" }],
          },
        ],
      }],
    };

    const report = validateDeck(deck);
    expect(report.errors).toEqual([]);

    clearRenderDiagnostics();
    const rendered = sourceToRenderedDeck(deck);
    const measured = measureDeck(rendered)[0]!.nodes;
    const leftRect = measured.find((node) => node.id === "m1.left")!.rect;
    const mainRect = measured.find((node) => node.id === "m1.main")!.rect;
    expect(leftRect).toMatchObject({ x: 1.0, y: 2.0, w: 5.0, h: 14.0 });
    expect(mainRect).toMatchObject({ x: 6.5, y: 2.0 });

    const ast = renderToAst(rendered);
    expect(ast.size).toBe("4x3");
    const shapes = ast.slides[0]!.shapes as ShapeLike[];
    const left = findShape(shapes, "m1.left-background");
    expect(left.xfrm).toMatchObject({ x: cm(1.0), y: cm(2.0), cx: cm(5.0), cy: cm(14.0) });
    expect(left.fill).toMatchObject({ type: "solid", alpha: 0.5 });
    expect(left.line).toMatchObject({ alpha: 0.4, dash: "dash" });
    expect(left.shadow).toMatchObject({ alpha: 0.3, blur: 64000, dy: 32000 });

    const main = findShape(shapes, "m1.main-background");
    expect(main.fill?.type).toBe("gradient");
    expect(main.fill?.stops).toHaveLength(2);
    expect(main.fill?.stops?.[1]?.alpha).toBe(0.75);

    const blockingDiagnostics = getRenderDiagnostics().filter((diag) => diag.severity === "error");
    expect(blockingDiagnostics).toEqual([]);
  });
});
