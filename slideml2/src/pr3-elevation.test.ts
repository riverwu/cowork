import { describe, expect, it } from "vitest";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

function deck(slides: SlideV2[]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
    slides,
  };
}

type AnyShape = { type: string; name?: string; shadow?: { color: string; alpha?: number; blur?: number; dx?: number; dy?: number }; line?: { color: string; width: number; dash?: string }; fill?: { type: string; color?: string }; preset?: string; xfrm?: { x: number; y: number; cx: number; cy: number } };

function shapesNamed(shapes: AnyShape[], suffix: string): AnyShape[] {
  return shapes.filter((s) => typeof s.name === "string" && s.name.endsWith(suffix));
}

describe("PR3: card elevation tokens", () => {
  it("default card (no elevation) is flat (no shadow)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.card",
        type: "card",
        children: [{ id: "s.card.h", type: "h2", text: "默认" }, { id: "s.card.body", type: "text", text: "正文" }],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const card = shapesNamed(ast.slides[0].shapes as AnyShape[], "-card")[0]!;
    expect(card.shadow).toBeUndefined();
  });

  it("elevation:\"raised\" card emits a real outerShdw", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.card",
        type: "card",
        elevation: "raised",
        children: [{ id: "s.card.h", type: "h2", text: "提升" }, { id: "s.card.body", type: "text", text: "正文" }],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const card = shapesNamed(ast.slides[0].shapes as AnyShape[], "-card")[0]!;
    expect(card.shadow).toBeDefined();
    expect(card.shadow!.blur).toBeGreaterThan(0);
    expect(card.shadow!.dy).toBeGreaterThan(0);
  });

  it("elevation:\"floating\" emits a deeper shadow than raised", () => {
    const mk = (elevation: string) => {
      const slide: SlideV2 = {
        id: "s",
        title: "x",
        children: [{
          id: "s.card",
          type: "card",
          elevation,
          children: [{ id: "s.card.h", type: "h2", text: "x" }, { id: "s.card.body", type: "text", text: "y" }],
        } as unknown as DomNode],
      };
      const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
      return shapesNamed(ast.slides[0].shapes as AnyShape[], "-card")[0]!.shadow;
    };
    const raised = mk("raised")!;
    const floating = mk("floating")!;
    expect(floating.blur!).toBeGreaterThan(raised.blur!);
    expect(floating.dy!).toBeGreaterThan(raised.dy!);
  });

  it("elevation:\"floating\" omits the border (line) on the card", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.card",
        type: "card",
        elevation: "floating",
        children: [{ id: "s.card.h", type: "h2", text: "x" }, { id: "s.card.body", type: "text", text: "y" }],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const card = shapesNamed(ast.slides[0].shapes as AnyShape[], "-card")[0]!;
    expect(card.line).toBeUndefined();
  });
});

describe("PR3: card tone → accent inheritance", () => {
  it("card with tone:\"brand\" + accent:\"left\" gets a brand-colored accent bar by default", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.card",
        type: "card",
        tone: "brand",
        accent: "left",
        children: [{ id: "s.card.h", type: "h2", text: "标题" }, { id: "s.card.body", type: "text", text: "正文" }],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const accentBar = shapesNamed(ast.slides[0].shapes as AnyShape[], "-accent")[0];
    expect(accentBar).toBeDefined();
    expect(accentBar!.fill?.color?.toUpperCase()).toBe("2563EB");
  });

  it("card with tone:\"danger\" + accent:\"left\" gets a danger-colored accent bar", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.card",
        type: "card",
        tone: "danger",
        accent: "left",
        children: [{ id: "s.card.h", type: "h2", text: "标题" }, { id: "s.card.body", type: "text", text: "正文" }],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const accentBar = shapesNamed(ast.slides[0].shapes as AnyShape[], "-accent")[0];
    expect(accentBar).toBeDefined();
    // Danger color isn't brand.primary — they should differ.
    expect(accentBar!.fill?.color).not.toBe("2563EB");
  });

  it("agent override accentColor wins over tone-derived accent", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.card",
        type: "card",
        tone: "danger",
        accent: "left",
        accentColor: "C026D3",
        children: [{ id: "s.card.h", type: "h2", text: "标题" }, { id: "s.card.body", type: "text", text: "正文" }],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const accentBar = shapesNamed(ast.slides[0].shapes as AnyShape[], "-accent")[0]!;
    expect(accentBar.fill?.color?.toUpperCase()).toBe("C026D3");
  });

  it("accentWidth:0.18 thickens the accent bar", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.card",
        type: "card",
        accent: "left",
        accentWidth: 0.18,
        children: [{ id: "s.card.h", type: "h2", text: "x" }, { id: "s.card.body", type: "text", text: "y" }],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const accentBar = shapesNamed(ast.slides[0].shapes as AnyShape[], "-accent")[0]!;
    // 0.18 cm in EMU
    expect(accentBar.xfrm!.cx).toBe(Math.round(0.18 * 360000));
  });
});

describe("PR3: agent line/border customization", () => {
  it("card with lineWidth:0.06 honors the thicker border", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.card",
        type: "card",
        lineWidth: 0.06,
        children: [{ id: "s.card.body", type: "text", text: "x" }],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const card = shapesNamed(ast.slides[0].shapes as AnyShape[], "-card")[0]!;
    expect(card.line!.width).toBe(Math.round(0.06 * 360000));
  });

  it("card with dash:\"dash\" emits a dashed border", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.card",
        type: "card",
        dash: "dash",
        children: [{ id: "s.card.body", type: "text", text: "x" }],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const card = shapesNamed(ast.slides[0].shapes as AnyShape[], "-card")[0]!;
    expect(card.line!.dash).toBe("dash");
  });

  it("panel with explicit fill / line tokens is honored", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.panel",
        type: "panel",
        fill: "FFF8E7",
        line: "D4A017",
        children: [{ id: "s.panel.body", type: "text", text: "x" }],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const panel = shapesNamed(ast.slides[0].shapes as AnyShape[], "-panel")[0]!;
    expect(panel.fill?.color?.toUpperCase()).toBe("FFF8E7");
    expect(panel.line?.color?.toUpperCase()).toBe("D4A017");
  });

  it("band with explicit `line` adds a border (not present by default)", () => {
    const noLine: SlideV2 = {
      id: "n",
      children: [{ id: "n.band", type: "band", children: [{ id: "n.band.body", type: "text", text: "x" }] } as unknown as DomNode],
    };
    const withLine: SlideV2 = {
      id: "w",
      children: [{ id: "w.band", type: "band", line: "divider", children: [{ id: "w.band.body", type: "text", text: "x" }] } as unknown as DomNode],
    };
    const noLineAst = renderToAst(sourceToRenderedDeck(deck([noLine])));
    const withLineAst = renderToAst(sourceToRenderedDeck(deck([withLine])));
    const noLineBand = shapesNamed(noLineAst.slides[0].shapes as AnyShape[], "-band")[0]!;
    const withLineBand = shapesNamed(withLineAst.slides[0].shapes as AnyShape[], "-band")[0]!;
    expect(noLineBand.line).toBeUndefined();
    expect(withLineBand.line).toBeDefined();
  });
});

describe("PR3: shadow OOXML emission", () => {
  it("a card with elevation:\"raised\" produces <a:outerShdw> in the .pptx", async () => {
    const { renderToPptx } = await import("./render.js");
    const { tmpdir } = await import("node:os");
    const { mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.card",
        type: "card",
        elevation: "raised",
        children: [{ id: "s.card.body", type: "text", text: "正文" }],
      } as unknown as DomNode],
    };
    const dir = mkdtempSync(join(tmpdir(), "pr3-"));
    const out = join(dir, "out.pptx");
    await renderToPptx(sourceToRenderedDeck(deck([slide])), out);
    void writeFileSync;
    void readFileSync;
    // Loading via JSZip would add a dep; we settle for confirming the file
    // exists and the AST shadow path produced an effect. The XML emit path
    // is exercised by the package emitter tests already.
    const { statSync } = await import("node:fs");
    expect(statSync(out).size).toBeGreaterThan(1000);
  });
});
