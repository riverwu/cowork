import { describe, expect, it } from "vitest";
import { measureDeck } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck } from "./types.js";

const TINY_PNG = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MDAiIGhlaWdodD0iNDUwIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjQ1MCIgZmlsbD0iIzExMTgyNyIvPjwvc3ZnPg==";

function deckWithRatio(ratio: [number, number]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { name: "Test", primary: "2563EB" } },
    slides: [{
      id: "s",
      title: "Split Ratio",
      children: [{
        id: "s.split",
        type: "split",
        direction: "horizontal",
        ratio,
        gap: 0.4,
        children: [
          { id: "s.img", type: "image-card", src: TINY_PNG, fit: "contain", caption: "" },
          {
            id: "s.right",
            type: "stack",
            gap: 0.2,
            children: [
              { id: "s.h1", type: "text", text: "sin A = opposite / hypotenuse", style: "body" },
              { id: "s.h2", type: "text", text: "cos A = adjacent / hypotenuse", style: "body" },
              { id: "s.h3", type: "text", text: "tan A = opposite / adjacent", style: "body" },
            ],
          },
        ],
      }],
    }],
  };
}

function measuredWidths(ratio: [number, number]): { left: number; right: number } {
  const measured = measureDeck(sourceToRenderedDeck(deckWithRatio(ratio)))[0]!.nodes;
  const rect = (id: string) => measured.find((node) => node.id === id)?.rect;
  const left = rect("s.img");
  const right = rect("s.right");
  if (!left || !right) throw new Error("missing split children");
  return { left: left.w, right: right.w };
}

describe("split layout", () => {
  it("honors explicit ratio as a target size even when intrinsic widths exceed the row", () => {
    const balanced = measuredWidths([0.25, 0.75]);
    const narrowImage = measuredWidths([0.18, 0.82]);
    const narrowTotal = narrowImage.left + narrowImage.right;

    expect(narrowImage.left).toBeLessThan(balanced.left - 1);
    expect(narrowImage.right).toBeGreaterThan(balanced.right + 1);
    expect(narrowImage.left / narrowTotal).toBeCloseTo(0.18, 1);
  });
});
