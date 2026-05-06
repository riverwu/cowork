import { describe, expect, it } from "vitest";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
} from "./diagnostics.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Layered-composition primitives:
 *   layer:"behind"  — child fills parent rect, renders below flow siblings.
 *   layer:"flow"    — default; participates in size solving.
 *   layer:"above"   — child fills parent rect, renders above flow siblings.
 *   anchorTo:"<id>" — slide-level overlay positioned relative to another node's rect.
 */

const EMU = 360000;

function deck(slide: SlideV2): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
    slides: [slide],
  };
}

function shapes(slide: SlideV2) {
  return renderToAst(sourceToRenderedDeck(deck(slide))).slides[0].shapes;
}

function find(list: ReturnType<typeof shapes>, suffix: string) {
  return list.find((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(suffix));
}

describe("layer:behind / above — flow children claim no main-axis space", () => {
  it("a behind child fills the parent's content rect (full width and height)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.row",
        type: "stack",
        direction: "horizontal",
        gap: 0.4,
        children: [
          { id: "s.row.bg", type: "shape", preset: "rect", fill: "brand.tint", layer: "behind" } as never,
          { id: "s.row.a", type: "text", text: "Left", style: "h2", layoutWeight: 1 },
          { id: "s.row.b", type: "text", text: "Right", style: "h2", layoutWeight: 1 },
        ],
      } as never],
    };
    const list = shapes(slide);
    const bg = find(list, "s.row.bg") as { xfrm?: { x: number; y: number; cx: number; cy: number } } | undefined;
    const flowA = find(list, "s.row.a") as { xfrm?: { x: number; cx: number } } | undefined;
    const flowB = find(list, "s.row.b") as { xfrm?: { x: number; cx: number } } | undefined;
    expect(bg).toBeDefined();
    expect(flowA).toBeDefined();
    expect(flowB).toBeDefined();
    // The behind shape spans both flow children and beyond — width >= flowA.cx + flowB.cx.
    const bgCx = bg!.xfrm!.cx / EMU;
    const flowAcx = flowA!.xfrm!.cx / EMU;
    const flowBcx = flowB!.xfrm!.cx / EMU;
    expect(bgCx).toBeGreaterThanOrEqual(flowAcx + flowBcx - 0.5);
    // Flow children are NOT compressed by the behind child — they get their fair half each.
    const tolerance = 0.5;
    expect(Math.abs(flowAcx - flowBcx)).toBeLessThanOrEqual(tolerance);
  });

  it("a behind child renders BEFORE flow children in the shape list (drawn underneath)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.col",
        type: "stack",
        direction: "vertical",
        gap: 0.2,
        children: [
          { id: "s.col.text1", type: "text", text: "Top", style: "h2" },
          { id: "s.col.bg", type: "shape", preset: "rect", fill: "brand.tint", layer: "behind" } as never,
          { id: "s.col.text2", type: "text", text: "Bottom", style: "h2" },
        ],
      } as never],
    };
    const list = shapes(slide);
    const bgIdx = list.findIndex((s) => (s as { name?: string }).name?.endsWith("s.col.bg"));
    const t1Idx = list.findIndex((s) => (s as { name?: string }).name?.endsWith("s.col.text1"));
    const t2Idx = list.findIndex((s) => (s as { name?: string }).name?.endsWith("s.col.text2"));
    expect(bgIdx).toBeGreaterThan(-1);
    expect(t1Idx).toBeGreaterThan(-1);
    expect(t2Idx).toBeGreaterThan(-1);
    // Behind shape comes BEFORE both text shapes regardless of source order.
    expect(bgIdx).toBeLessThan(t1Idx);
    expect(bgIdx).toBeLessThan(t2Idx);
  });

  it("an above child renders AFTER flow children (drawn on top)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.col",
        type: "stack",
        direction: "vertical",
        gap: 0.2,
        children: [
          { id: "s.col.text", type: "text", text: "Body", style: "h2" },
          { id: "s.col.scrim", type: "shape", preset: "rect", fill: "brand.primary", layer: "above" } as never,
        ],
      } as never],
    };
    const list = shapes(slide);
    const scrimIdx = list.findIndex((s) => (s as { name?: string }).name?.endsWith("s.col.scrim"));
    const textIdx = list.findIndex((s) => (s as { name?: string }).name?.endsWith("s.col.text"));
    expect(scrimIdx).toBeGreaterThan(textIdx);
  });

  it("a behind child does NOT trigger COLLISION against flow siblings it overlaps", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.row",
        type: "stack",
        direction: "horizontal",
        gap: 0.4,
        children: [
          { id: "s.row.bg", type: "shape", preset: "rect", fill: "brand.tint", layer: "behind" } as never,
          { id: "s.row.text", type: "text", text: "Hello", style: "h2", layoutWeight: 1 },
        ],
      } as never],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck(slide)));
    const collisions = getRenderDiagnostics().filter((d) => d.code === "COLLISION");
    expect(collisions).toHaveLength(0);
  });

  it("layer:flow (or omitted) preserves existing flow behavior", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.row",
        type: "stack",
        direction: "horizontal",
        gap: 0.4,
        children: [
          { id: "s.row.a", type: "text", text: "A", style: "h2", layoutWeight: 1, layer: "flow" } as never,
          { id: "s.row.b", type: "text", text: "B", style: "h2", layoutWeight: 1 },
        ],
      } as never],
    };
    const list = shapes(slide);
    const a = find(list, "s.row.a") as { xfrm?: { cx: number } } | undefined;
    const b = find(list, "s.row.b") as { xfrm?: { cx: number } } | undefined;
    expect(Math.abs((a!.xfrm!.cx - b!.xfrm!.cx)) / EMU).toBeLessThanOrEqual(0.1);
  });
});

describe("anchorTo — relative slide-level overlays", () => {
  it("an anchorTo overlay positions relative to its target's rect, not the slide canvas", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [
        // Flow card at a known location
        {
          id: "s.card",
          type: "card",
          fixedWidth: 8,
          fixedHeight: 4,
          children: [{ id: "s.card.t", type: "text", text: "Card" }],
        },
        // Slide-level overlay anchored to the card's top-right corner
        {
          id: "s.badge",
          type: "shape",
          preset: "rect",
          fill: "brand.primary",
          width: 1.5,
          height: 0.6,
          anchorTo: "s.card",
          anchor: "top-right",
          offsetX: 0,
          offsetY: 0,
        } as never,
      ],
    };
    const list = shapes(slide);
    const card = find(list, "s.card-card") as { xfrm?: { x: number; y: number; cx: number; cy: number } } | undefined;
    const badge = find(list, "s.badge") as { xfrm?: { x: number; y: number; cx: number; cy: number } } | undefined;
    expect(card).toBeDefined();
    expect(badge).toBeDefined();
    // Badge sits at the card's top-right: badge.x + badge.cx ≈ card.x + card.cx,
    // badge.y ≈ card.y.
    const cardRight = (card!.xfrm!.x + card!.xfrm!.cx) / EMU;
    const badgeRight = (badge!.xfrm!.x + badge!.xfrm!.cx) / EMU;
    expect(Math.abs(cardRight - badgeRight)).toBeLessThanOrEqual(0.05);
    const cardTop = card!.xfrm!.y / EMU;
    const badgeTop = badge!.xfrm!.y / EMU;
    expect(Math.abs(cardTop - badgeTop)).toBeLessThanOrEqual(0.05);
  });

  it("anchorTo with a missing target id is silently dropped (no crash)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.orphan",
        type: "shape",
        preset: "rect",
        fill: "brand.primary",
        width: 1,
        height: 1,
        anchorTo: "nonexistent",
        anchor: "top-right",
      } as never],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const orphan = find(ast.slides[0].shapes, "s.orphan");
    expect(orphan).toBeUndefined();
  });

  it("an anchorTo overlay inherits 'top-right' anchor when omitted", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [
        { id: "s.card", type: "card", fixedWidth: 6, fixedHeight: 3, children: [{ id: "s.card.t", type: "text", text: "C" }] },
        { id: "s.b", type: "shape", preset: "rect", fill: "brand.primary", width: 1, height: 0.4, anchorTo: "s.card" } as never,
      ],
    };
    const list = shapes(slide);
    const card = find(list, "s.card-card") as { xfrm?: { x: number; cx: number; y: number } } | undefined;
    const b = find(list, "s.b") as { xfrm?: { x: number; cx: number; y: number } } | undefined;
    // Default top-right: badge.x + badge.cx ≈ card.x + card.cx, badge.y ≈ card.y.
    const cardRight = (card!.xfrm!.x + card!.xfrm!.cx) / EMU;
    const bRight = (b!.xfrm!.x + b!.xfrm!.cx) / EMU;
    expect(Math.abs(cardRight - bRight)).toBeLessThanOrEqual(0.05);
  });
});

describe("layered image inherits container's cornerRadius for clipping", () => {
  it("a behind image inside a roundRect stack inherits clip:rounded + parent's cornerRadius", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.card",
        type: "stack",
        direction: "vertical",
        gap: 0,
        cornerRadius: 0.18,
        fill: "surface",
        children: [
          { id: "s.card.bg", type: "image", src: "/tmp/none.png", fit: "cover", layer: "behind" } as never,
          { id: "s.card.title", type: "text", text: "Hero", style: "h1" },
        ],
      } as never],
    };
    const list = shapes(slide);
    const img = list.find((sh) => (sh as { name?: string }).name?.endsWith("s.card.bg")) as
      | { type?: string; clip?: string; cornerRadius?: number } | undefined;
    expect(img).toBeDefined();
    expect(img!.type).toBe("image");
    expect(img!.clip).toBe("rounded");
    expect(img!.cornerRadius).toBeCloseTo(0.18, 5);
  });

  it("an explicit clip on the layered image is preserved (no override)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.card",
        type: "stack",
        direction: "vertical",
        gap: 0,
        cornerRadius: 0.2,
        fill: "surface",
        children: [
          { id: "s.card.bg", type: "image", src: "/tmp/none.png", fit: "cover", clip: "circle", layer: "behind" } as never,
          { id: "s.card.title", type: "text", text: "Hero", style: "h1" },
        ],
      } as never],
    };
    const list = shapes(slide);
    const img = list.find((sh) => (sh as { name?: string }).name?.endsWith("s.card.bg")) as
      | { clip?: string } | undefined;
    expect(img!.clip).toBe("circle");
  });
});

describe("layer in grid containers", () => {
  it("a behind child in a grid fills the grid's content rect, not a single cell", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.g",
        type: "grid",
        columns: 3,
        gap: 0.3,
        children: [
          { id: "s.g.bg", type: "shape", preset: "rect", fill: "brand.tint", layer: "behind" } as never,
          { id: "s.g.c1", type: "text", text: "1", style: "h2" },
          { id: "s.g.c2", type: "text", text: "2", style: "h2" },
          { id: "s.g.c3", type: "text", text: "3", style: "h2" },
        ],
      } as never],
    };
    const list = shapes(slide);
    const bg = find(list, "s.g.bg") as { xfrm?: { cx: number } } | undefined;
    const c1 = find(list, "s.g.c1") as { xfrm?: { cx: number } } | undefined;
    const c3 = find(list, "s.g.c3") as { xfrm?: { cx: number } } | undefined;
    expect(bg).toBeDefined();
    // Behind spans all 3 cells: width >= 3× single cell width.
    expect((bg!.xfrm!.cx) / EMU).toBeGreaterThan((c1!.xfrm!.cx + c3!.xfrm!.cx) / EMU);
  });
});

describe("at: [x, y, w, h] — slide-relative absolute positioning", () => {
  it("a node with at=[x,y,w,h] renders at exactly those coordinates", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.headline",
        type: "shape",
        preset: "rect",
        fill: "brand.primary",
        at: [1.8, 6.4, 18, 4.2],
      } as never],
    };
    const list = shapes(slide);
    const headline = find(list, "s.headline") as { xfrm?: { x: number; y: number; cx: number; cy: number } } | undefined;
    expect(headline).toBeDefined();
    expect(headline!.xfrm!.x / EMU).toBeCloseTo(1.8, 2);
    expect(headline!.xfrm!.y / EMU).toBeCloseTo(6.4, 2);
    expect(headline!.xfrm!.cx / EMU).toBeCloseTo(18, 2);
    expect(headline!.xfrm!.cy / EMU).toBeCloseTo(4.2, 2);
  });

  it("at-positioned text honors `rotation` (passes through to OOXML xfrm.rot)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.tilted",
        type: "text",
        text: "Bench → Bedside",
        style: "deck-title",
        at: [2, 5, 21, 3],
        rotation: -4,
      } as never],
    };
    const list = shapes(slide);
    const tilted = find(list, "s.tilted") as { xfrm?: { rot?: number } } | undefined;
    expect(tilted).toBeDefined();
    // rotation in xfrm is degrees × 60000 (OOXML 1/60000-degree units).
    expect(tilted!.xfrm!.rot).toBe(-4 * 60000);
  });

  it("at-positioned children skip flow layout (don't compress siblings)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [
        // Flow content
        { id: "s.body", type: "text", text: "Body text", style: "paragraph" },
        // Absolute overlay
        { id: "s.stamp", type: "shape", preset: "rect", fill: "danger", at: [20, 0.5, 4, 1.2] } as never,
      ],
    };
    const list = shapes(slide);
    const stamp = find(list, "s.stamp") as { xfrm?: { x: number; y: number } } | undefined;
    expect(stamp).toBeDefined();
    expect(stamp!.xfrm!.x / EMU).toBeCloseTo(20, 2);
    expect(stamp!.xfrm!.y / EMU).toBeCloseTo(0.5, 2);
    // Body text is in flow and not displaced by the absolute stamp.
    const body = find(list, "s.body") as { xfrm?: { x: number; y: number } } | undefined;
    expect(body).toBeDefined();
    expect(body!.xfrm!.x / EMU).toBeLessThan(2); // standard pageMarginX (1.8)
  });

  it("at with non-array or wrong-length value is silently ignored (falls through to flow)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.bad",
        type: "text",
        text: "Should flow",
        style: "h2",
        at: [1.8, 6.4], // wrong length
      } as never],
    };
    const list = shapes(slide);
    const node = find(list, "s.bad") as { xfrm?: { x: number; y: number } } | undefined;
    expect(node).toBeDefined();
    // Treated as flow — x is within content area, not the malformed at[0].
    expect(node!.xfrm!.x / EMU).toBeGreaterThanOrEqual(0.5);
  });

  it("at with w/h ≤ 0 is clamped to a tiny floor (no crash)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.zero",
        type: "shape",
        preset: "rect",
        fill: "brand.primary",
        at: [5, 5, 0, 0],
      } as never],
    };
    const list = shapes(slide);
    const zero = find(list, "s.zero") as { xfrm?: { cx: number; cy: number } } | undefined;
    expect(zero).toBeDefined();
    expect(zero!.xfrm!.cx / EMU).toBeGreaterThan(0);
    expect(zero!.xfrm!.cy / EMU).toBeGreaterThan(0);
  });
});
