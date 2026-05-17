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

  it("promotes fixed spacers between content blocks to LayoutGlue rhythm", () => {
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
            gap: 0.6,
            at: [1, 1, 10, 7],
            children: [
              { id: "s.lead", type: "text", text: "Lead copy", fixedHeight: 1.0 },
              { id: "s.break", type: "spacer", fixedHeight: 0.4 },
              {
                id: "s.list",
                type: "stack",
                direction: "vertical",
                gap: 0.25,
                children: [
                  { id: "s.list.a", type: "text", text: "A", fixedHeight: 0.8 },
                  { id: "s.list.b", type: "text", text: "B", fixedHeight: 0.8 },
                ],
              },
            ],
          }],
        },
      }],
    };

    const nodes = measureDeck(deck)[0]!.nodes;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const lead = byId.get("s.lead")!.rect;
    const spacer = byId.get("s.break")!.rect;
    const list = byId.get("s.list")!.rect;
    const decisions = layoutDecisionsForSlide(deck, "s");

    expect(spacer.y).toBeCloseTo(lead.y + lead.h, 3);
    expect(spacer.h).toBeCloseTo(1.0, 2);
    expect(list.y).toBeCloseTo(spacer.y + spacer.h, 3);
    expect(decisions.get("s.break")?.notes?.some((note) => note.startsWith("layout-glue:"))).toBe(true);
  });

  it("keeps explicit spacers after CJK serif flow text based on reserved wrapped height", () => {
    const deck: RenderedDeck = {
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "2563EB" },
        themeOverride: {
          fonts: {
            latin: { text: ["Georgia"], display: ["Georgia"] },
            cjk: { text: ["Noto Serif SC"], display: ["Noto Serif SC"] },
          },
        },
      },
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
            gap: 0,
            at: [1, 1, 9.856, 6],
            children: [
              {
                id: "s.long",
                type: "text",
                text: "克拉芒斯住在运河边，说「水是最好的忏悔室」。在雾里和威士忌中，他对陌生人——也就是我们——不断倾诉和解剖自己。",
                fontFamily: "text",
                fontSize: 11,
                lineSpacing: 1.5,
              },
              { id: "s.break", type: "spacer", fixedHeight: 0.3 },
              {
                id: "s.after",
                type: "text",
                text: "不是在寻求宽恕。只是想让另一个人也看到自己的倒影。",
                fontFamily: "text",
                fontSize: 11,
                lineSpacing: 1.5,
              },
            ],
          }],
        },
      }],
    };

    const nodes = measureDeck(deck)[0]!.nodes;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const long = byId.get("s.long")!;
    const spacer = byId.get("s.break")!;
    const after = byId.get("s.after")!;

    expect(long.rect.h).toBeGreaterThan(1.75);
    expect(spacer.rect.h).toBeCloseTo(0.3, 3);
    expect(after.rect.y).toBeCloseTo(spacer.rect.y + spacer.rect.h, 3);
    expect(after.rect.y - ((long.visualRect?.y ?? long.rect.y) + (long.visualRect?.h ?? long.rect.h))).toBeGreaterThanOrEqual(0.3);
  });
});
