import { describe, expect, it } from "vitest";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Bullet markers as shape glyphs. Lets agents decorate bullet lists with
 * familiar shape vocabulary (●, ■, ▶, ◆, →, ✓, ★) instead of the default
 * unicode dot. Backed by OOXML's native `<a:buChar>` + `<a:buClr>` +
 * `<a:buSzPct>`, so list indentation, alignment, and accessibility all
 * still work.
 */

function deck(slides: SlideV2[]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { primary: "1A365D" } },
    slides,
  };
}

function bullets(slide: SlideV2) {
  const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
  return ast.slides[0].shapes.find((s) => (s as { name?: string }).name?.endsWith(".list")) as
    | { paragraphs?: Array<{ bullet?: { char?: string; color?: string; sizePct?: number; auto?: boolean; number?: boolean }; marginLeft?: number; hanging?: number }> }
    | undefined;
}

describe("bullets.marker → shape-glyph bullets", () => {
  it("string shorthand 'disc' produces a filled-circle glyph (●)", () => {
    const shape = bullets({
      id: "s",
      title: "x",
      children: [{ id: "s.list", type: "bullets", items: ["A", "B"], marker: "disc" }],
    });
    expect(shape).toBeDefined();
    const para = shape!.paragraphs!.find((p) => p.bullet && "char" in p.bullet)!;
    expect(para.bullet!.char).toBe("\u25CF");
  });

  it("each preset maps to its expected glyph", () => {
    const cases: Array<[string, string]> = [
      ["circle", "\u25CB"],
      ["square", "\u25A0"],
      ["square-outline", "\u25A1"],
      ["triangle", "\u25B6"],
      ["diamond", "\u25C6"],
      ["arrow", "\u2192"],
      ["check", "\u2713"],
      ["star", "\u2605"],
      ["dash", "\u2013"],
      ["chevron", "\u203A"],
    ];
    for (const [token, glyph] of cases) {
      const shape = bullets({
        id: `s-${token}`,
        title: "x",
        children: [{ id: `s.list`, type: "bullets", items: ["a"], marker: token } as never],
      });
      expect(shape, `marker=${token}`).toBeDefined();
      const para = shape!.paragraphs!.find((p) => p.bullet && "char" in p.bullet)!;
      expect(para.bullet!.char, `marker=${token}`).toBe(glyph);
    }
  });

  it("unknown marker token falls back to the default auto bullet", () => {
    const shape = bullets({
      id: "s",
      title: "x",
      children: [{ id: "s.list", type: "bullets", items: ["a"], marker: "moonbeam" } as never],
    });
    const para = shape!.paragraphs!.find((p) => p.bullet)!;
    expect((para.bullet as { auto?: boolean }).auto).toBe(true);
  });

  it("markerColor resolves theme tokens into the bullet's color", () => {
    const shape = bullets({
      id: "s",
      title: "x",
      children: [{
        id: "s.list",
        type: "bullets",
        items: ["a"],
        marker: "disc",
        markerColor: "brand.primary",
      } as never],
    });
    const para = shape!.paragraphs!.find((p) => p.bullet && "char" in p.bullet)!;
    expect(para.bullet!.color?.toUpperCase()).toBe("1A365D");
  });

  it("markerColor accepts raw hex too", () => {
    const shape = bullets({
      id: "s",
      title: "x",
      children: [{
        id: "s.list",
        type: "bullets",
        items: ["a"],
        marker: "square",
        markerColor: "C4622D",
      } as never],
    });
    const para = shape!.paragraphs!.find((p) => p.bullet && "char" in p.bullet)!;
    expect(para.bullet!.color?.toUpperCase()).toBe("C4622D");
  });

  it("markerSize is clamped to [0.5, 2.0]", () => {
    const shapeBig = bullets({
      id: "s",
      title: "x",
      children: [{
        id: "s.list", type: "bullets", items: ["a"],
        marker: "disc", markerSize: 5,
      } as never],
    });
    const shapeSmall = bullets({
      id: "s2",
      title: "x",
      children: [{
        id: "s.list", type: "bullets", items: ["a"],
        marker: "disc", markerSize: 0.1,
      } as never],
    });
    const big = shapeBig!.paragraphs!.find((p) => p.bullet && "char" in p.bullet)!;
    const small = shapeSmall!.paragraphs!.find((p) => p.bullet && "char" in p.bullet)!;
    expect(big.bullet!.sizePct).toBe(2.0);
    expect(small.bullet!.sizePct).toBe(0.5);
  });

  it("object form { shape, color, size } works equivalently to flat fields", () => {
    const shape = bullets({
      id: "s",
      title: "x",
      children: [{
        id: "s.list", type: "bullets", items: ["a"],
        marker: { shape: "triangle", color: "brand.primary", size: 0.85 },
      } as never],
    });
    const para = shape!.paragraphs!.find((p) => p.bullet && "char" in p.bullet)!;
    expect(para.bullet!.char).toBe("\u25B6");
    expect(para.bullet!.color?.toUpperCase()).toBe("1A365D");
    expect(para.bullet!.sizePct).toBeCloseTo(0.85, 5);
  });

  it("numbered:true wins over marker (markers are silenced for numbered lists)", () => {
    const shape = bullets({
      id: "s",
      title: "x",
      children: [{
        id: "s.list", type: "bullets", items: ["a"], numbered: true, marker: "disc",
      } as never],
    });
    const para = shape!.paragraphs!.find((p) => p.bullet)!;
    expect((para.bullet as { number?: boolean }).number).toBe(true);
  });

  it("a bullets node with no marker still gets the default auto bullet", () => {
    const shape = bullets({
      id: "s",
      title: "x",
      children: [{ id: "s.list", type: "bullets", items: ["a", "b"] }],
    });
    const para = shape!.paragraphs!.find((p) => p.bullet)!;
    expect((para.bullet as { auto?: boolean }).auto).toBe(true);
  });

  it("compact bullets carry explicit hanging indent so marker and text do not touch", () => {
    const shape = bullets({
      id: "s",
      title: "x",
      children: [{ id: "s.list", type: "bullets", density: "compact", items: ["Proof point"] } as never],
    });
    const para = shape!.paragraphs!.find((p) => p.bullet)!;
    expect(para.marginLeft).toBeGreaterThan(0);
    expect(para.hanging).toBeLessThan(0);
    expect(para.marginLeft! + para.hanging!).toBeGreaterThan(0);
    // Text starts at marL, bullet at marL+indent; keep at least ~0.2cm gap.
    expect(Math.abs(para.hanging!) / 360000).toBeGreaterThanOrEqual(0.2);
  });
});

describe("bullet-marker OOXML emission", () => {
  it("a glyph bullet emits <a:buClr>, <a:buSzPct>, and <a:buChar> in the right order", async () => {
    const { txBody } = await import("./emitter/text.js");
    const xml = txBody({
      type: "text",
      id: 1,
      xfrm: { x: 0, y: 0, cx: 100, cy: 100 },
      paragraphs: [{
        runs: [{ text: "alpha", sizeHalfPt: 24, color: "333333" }],
        bullet: { char: "\u25C6", color: "1A365D", sizePct: 1.2 },
      }],
    });
    expect(xml).toContain('<a:buClr><a:srgbClr val="1A365D"/></a:buClr>');
    expect(xml).toContain('<a:buSzPct val="120000"/>');
    expect(xml).toContain('<a:buChar char="\u25C6"/>');
    // buClr must come before buChar (OOXML schema order).
    expect(xml.indexOf('<a:buClr')).toBeLessThan(xml.indexOf('<a:buChar'));
    expect(xml.indexOf('<a:buSzPct')).toBeLessThan(xml.indexOf('<a:buChar'));
  });

  it("auto-bullet (no shape glyph) still emits buChar with default •", async () => {
    const { txBody } = await import("./emitter/text.js");
    const xml = txBody({
      type: "text",
      id: 1,
      xfrm: { x: 0, y: 0, cx: 100, cy: 100 },
      paragraphs: [{
        runs: [{ text: "alpha", sizeHalfPt: 24 }],
        bullet: { auto: true },
      }],
    });
    expect(xml).toContain('<a:buChar char="\u2022"/>');
    expect(xml).not.toContain('<a:buClr');
  });

  it("a glyph with XML-special characters is escaped", async () => {
    const { txBody } = await import("./emitter/text.js");
    const xml = txBody({
      type: "text",
      id: 1,
      xfrm: { x: 0, y: 0, cx: 100, cy: 100 },
      paragraphs: [{
        runs: [{ text: "alpha", sizeHalfPt: 24 }],
        bullet: { char: "<&>" },
      }],
    });
    // Special chars escaped, not raw.
    expect(xml).toContain('char="&lt;&amp;&gt;"');
  });
});
