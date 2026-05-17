import { describe, expect, it } from "vitest";
import { clearRenderDiagnostics, getRenderDiagnostics } from "./diagnostics.js";
import { layoutDecisionsForSlide, measureDeck } from "./render.js";
import type { RenderedDeck } from "./types.js";

function rectOf(deck: RenderedDeck, id: string) {
  const rect = measureDeck(deck)[0]!.nodes.find((node) => node.id === id)?.rect;
  if (!rect) throw new Error(`Missing measured node ${id}`);
  return rect;
}

function baseDeck(layoutEngine?: string): RenderedDeck {
  return {
    deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
    slides: [{
      id: "s",
      layout: "freeform",
      dom: {
        id: "s.root",
        type: "slide",
        children: [{
          id: "s.stack",
          type: "stack",
          direction: "vertical",
          gap: 0.2,
          at: [1, 1, 8, 5],
          ...(layoutEngine ? { layoutEngine } : {}),
          children: [
            { id: "s.title", type: "text", text: "Title", fixedHeight: 0.6 },
            {
              id: "s.panel",
              type: "stack",
              direction: "vertical",
              fixedHeight: 1.0,
              children: [
                { id: "s.panel.a", type: "text", text: "A", fixedHeight: 1.6 },
                { id: "s.panel.b", type: "text", text: "B", fixedHeight: 1.4 },
              ],
            },
          ],
        }],
      },
    }],
  };
}

describe("render Cassowary layout integration", () => {
  it("uses Cassowary by default while preserving soft fixed-height containers", () => {
    const deck = baseDeck();
    const panel = rectOf(deck, "s.panel");
    const decisions = layoutDecisionsForSlide(deck, "s");

    expect(panel.h).toBeGreaterThan(3.0);
    expect(decisions.get("s.panel")?.notes?.some((note) => note.startsWith("cassowary:vertical"))).toBe(true);
  });

  it("keeps a legacy opt-out for migration diagnostics", () => {
    const deck = baseDeck("legacy");
    measureDeck(deck);
    const decisions = layoutDecisionsForSlide(deck, "s");

    expect(decisions.get("s.panel")?.notes?.some((note) => note.startsWith("cassowary:"))).not.toBe(true);
  });

  it("does not report cross-axis fixed-width pressure that final stack alignment already satisfies", () => {
    const deck: RenderedDeck = {
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "s",
        layout: "freeform",
        dom: {
          id: "s.root",
          type: "slide",
          children: [{
            id: "s.stack",
            type: "stack",
            direction: "vertical",
            gap: 0.2,
            at: [1, 1, 6, 4],
            children: [
              { id: "s.rule", type: "shape", preset: "rect", fixedWidth: 1.4, fixedHeight: 0.08, align: "start" },
              { id: "s.body", type: "text", text: "Body", fixedHeight: 0.7 },
            ],
          }],
        },
      }],
    };

    clearRenderDiagnostics();
    const nodes = measureDeck(deck)[0]!.nodes;
    const rule = nodes.find((node) => node.id === "s.rule")?.rect;

    expect(rule?.w).toBeCloseTo(1.4, 2);
    expect(getRenderDiagnostics().filter((item) => item.code === "OVERFLOW" && item.nodeId === "s.rule")).toHaveLength(0);
  });
});
