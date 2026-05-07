import { describe, expect, it } from "vitest";
import { buildTheme, preferredFont, resolveFontWeight } from "./theme.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck } from "./types.js";

function deckWith(slideChildren: unknown[], themeOverride?: Slideml2SourceDeck["deck"]["themeOverride"]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: "default",
      brand: { primary: "0F4C81" },
      ...(themeOverride ? { themeOverride } : {}),
    },
    slides: [
      {
        id: "s1",
        title: "Hello",
        children: slideChildren as never[],
      },
    ],
  };
}

function findRun(ast: ReturnType<typeof renderToAst>, predicate: (text: string) => boolean) {
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) {
      if (shape.type !== "text") continue;
      for (const para of shape.paragraphs) {
        for (const run of para.runs) {
          if (predicate(run.text)) return run;
        }
      }
    }
  }
  return undefined;
}

function findTableRun(ast: ReturnType<typeof renderToAst>, predicate: (text: string) => boolean) {
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) {
      if (shape.type !== "table") continue;
      for (const row of shape.cells) {
        for (const cell of row) {
          for (const run of cell.runs) {
            if (predicate(run.text)) return run;
          }
        }
      }
    }
  }
  return undefined;
}

describe("typography — numeric weight axis", () => {
  it("resolveFontWeight maps 'bold' / 'normal' / numeric to (numeric,bold)", () => {
    expect(resolveFontWeight("normal")).toEqual({ numeric: 400, bold: false });
    expect(resolveFontWeight("bold")).toEqual({ numeric: 700, bold: true });
    expect(resolveFontWeight(500)).toEqual({ numeric: 500, bold: false });
    expect(resolveFontWeight(600)).toEqual({ numeric: 600, bold: true });
    expect(resolveFontWeight(900)).toEqual({ numeric: 900, bold: true });
  });

  it("appends typeface-name suffix for known numeric weights", () => {
    const theme = buildTheme({}, "default", { fonts: { latin: ["Inter"] } });
    expect(preferredFont(theme, "latin", "text", 300)).toBe("Inter Light");
    expect(preferredFont(theme, "latin", "text", 600)).toBe("Inter SemiBold");
    expect(preferredFont(theme, "latin", "text", 700)).toBe("Inter Bold");
    expect(preferredFont(theme, "latin", "text", 900)).toBe("Inter Black");
  });

  it("maps semibold to installed-safe variants for common system fonts", () => {
    const arial = buildTheme({}, "default", { fonts: { latin: ["Arial"] } });
    const helvetica = buildTheme({}, "default", { fonts: { latin: ["Helvetica Neue"] } });
    expect(preferredFont(arial, "latin", "text", 600)).toBe("Arial Bold");
    expect(preferredFont(helvetica, "latin", "text", 600)).toBe("Helvetica Neue Bold");
  });

  it("does not double-suffix when the head font already names a weight", () => {
    const theme = buildTheme({}, "default", { fonts: { latin: ["Inter Bold"] } });
    expect(preferredFont(theme, "latin", "text", 700)).toBe("Inter Bold");
  });

  it("does not invent weight-suffixed CJK font names", () => {
    const theme = buildTheme({}, "default", { fonts: { cjk: { display: ["Hiragino Sans W6"], text: ["Hiragino Sans W3"] } } });
    expect(preferredFont(theme, "cjk", "display", 700)).toBe("Hiragino Sans W6");
    expect(preferredFont(theme, "cjk", "text", 700)).toBe("Hiragino Sans W3");
  });

  it("themeOverride numeric weight on slide-title sets b='1' on the title run", () => {
    const deck = deckWith([], { text: { "slide-title": { weight: 800 } } });
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const titleRun = findRun(ast, (t) => t === "Hello");
    expect(titleRun).toBeDefined();
    expect(titleRun!.bold).toBe(true);
  });
});

describe("typography — display / text font roles", () => {
  it("legacy string[] override populates both display and text", () => {
    const theme = buildTheme({}, "default", { fonts: { latin: ["Bodoni"] } });
    expect(theme.fonts.latin.text).toEqual(["Bodoni"]);
    expect(theme.fonts.latin.display).toEqual(["Bodoni"]);
  });

  it("structured override keeps display and text separate", () => {
    const theme = buildTheme({}, "default", { fonts: { latin: { display: ["Bodoni"], text: ["Inter"] } } });
    expect(theme.fonts.latin.display).toEqual(["Bodoni"]);
    expect(theme.fonts.latin.text).toEqual(["Inter"]);
  });

  it("text style with fontFamily:'display' picks the display chain (with weight suffix)", () => {
    const deck = deckWith([], {
      fonts: { latin: { display: ["Bodoni"], text: ["Inter"] } },
      text: { "slide-title": { fontFamily: "display" } },
    });
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const titleRun = findRun(ast, (t) => t === "Hello");
    // slide-title is bold by default so the display face acquires the
    // "Bold" suffix per the typeface-naming convention.
    expect(titleRun?.fontFace).toBe("Bodoni Bold");
  });

  it("default style falls back to text chain", () => {
    const deck = deckWith([
      { id: "s1.body", type: "stack", area: "content", direction: "vertical", gap: 0.4, children: [
        { id: "s1.lead", type: "lead", text: "Body line." },
      ] },
    ], { fonts: { latin: { display: ["Bodoni"], text: ["Inter"] } } });
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const lead = findRun(ast, (t) => t === "Body line.");
    expect(lead?.fontFace).toBe("Inter");
  });

  it("mixed Latin/CJK text emits separate latin and east-asian typefaces", () => {
    const deck = deckWith([
      { id: "s1.body", type: "stack", area: "content", direction: "vertical", gap: 0.4, children: [
        { id: "s1.mixed", type: "text", style: "section-title", text: "增长 API-first" },
      ] },
    ], {
      fonts: {
        latin: { display: ["Bodoni"], text: ["Inter"] },
        cjk: { display: ["Songti SC"], text: ["PingFang SC"] },
      },
      text: { "section-title": { fontFamily: "display" } },
    });
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const mixed = findRun(ast, (t) => t === "增长 API-first");
    expect(mixed?.fontFace).toBe("Bodoni Bold");
    expect(mixed?.eastAsianFontFace).toBe("Songti SC");
    expect(mixed?.cjk).toBe(true);
  });

  it("table cells keep latin and CJK font chains separate", () => {
    const deck = deckWith([
      { id: "s1.body", type: "stack", area: "content", direction: "vertical", gap: 0.4, children: [
        {
          id: "s1.table",
          type: "table",
          headers: ["公司", "定位"],
          rows: [["合合信息", "AI-Native IDP"]],
        },
      ] },
    ], {
      fonts: {
        latin: { display: ["Bodoni"], text: ["Inter"] },
        cjk: { display: ["Songti SC"], text: ["PingFang SC"] },
      },
    });
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const chineseCell = findTableRun(ast, (t) => t === "合合信息");
    const latinCell = findTableRun(ast, (t) => t === "AI-Native IDP");
    expect(chineseCell?.fontFace).toBe("Inter");
    expect(chineseCell?.eastAsianFontFace).toBe("PingFang SC");
    expect(latinCell?.fontFace).toBe("Inter");
    expect(latinCell?.eastAsianFontFace).toBe("PingFang SC");
  });

  it("text styles with fontFamily:'mono' use the mono chain", () => {
    const deck = deckWith([
      { id: "s1.body", type: "stack", area: "content", direction: "vertical", gap: 0.4, children: [
        { id: "s1.codeish", type: "text", style: "paragraph", text: "状态 code", fontFamily: "mono" },
      ] },
    ], { fonts: { mono: ["JetBrains Mono"], latin: { text: ["Inter"], display: ["Bodoni"] }, cjk: { text: ["PingFang SC"], display: ["Songti SC"] } } });
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const run = findRun(ast, (t) => t === "状态 code");
    expect(run?.fontFace).toBe("JetBrains Mono");
    expect(run?.eastAsianFontFace).toBe("JetBrains Mono");
    expect(run?.mono).toBe(true);
  });
});

describe("typography — RichTextRun expressiveness", () => {
  it("per-run size override re-scales the half-points", () => {
    const deck = deckWith([
      { id: "s1.body", type: "stack", area: "content", direction: "vertical", gap: 0.4, children: [
        { id: "s1.t", type: "text", style: "lead", content: [
          { text: "calm " },
          { text: "BIG", size: "2xl", weight: 800 },
          { text: " ending." },
        ] },
      ] },
    ]);
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const big = findRun(ast, (t) => t === "BIG");
    const calm = findRun(ast, (t) => t === "calm ");
    expect(big).toBeDefined();
    expect(calm).toBeDefined();
    // 2xl multiplier in default sizeScale = 1.7×
    expect(big!.sizeHalfPt!).toBeCloseTo(calm!.sizeHalfPt! * 1.7, 0);
    expect(big!.bold).toBe(true);
  });

  it("strikethrough mark emits strike attr", () => {
    const deck = deckWith([
      { id: "s1.body", type: "stack", area: "content", direction: "vertical", gap: 0.4, children: [
        { id: "s1.t", type: "text", style: "paragraph", content: [
          { text: "old", marks: ["strikethrough"] },
          { text: " new" },
        ] },
      ] },
    ]);
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const old = findRun(ast, (t) => t === "old");
    expect(old?.strike).toBe(true);
  });

  it("superscript / subscript marks set baseline percent", () => {
    const deck = deckWith([
      { id: "s1.body", type: "stack", area: "content", direction: "vertical", gap: 0.4, children: [
        { id: "s1.t", type: "text", style: "paragraph", content: [
          { text: "H" },
          { text: "2", marks: ["subscript"] },
          { text: "O baseline shift" },
        ] },
      ] },
    ]);
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const sub = findRun(ast, (t) => t === "2");
    expect(sub?.baseline).toBe(-25);
  });

  it("font:'mono' override forces the mono chain", () => {
    const deck = deckWith([
      { id: "s1.body", type: "stack", area: "content", direction: "vertical", gap: 0.4, children: [
        { id: "s1.t", type: "text", style: "paragraph", content: [
          { text: "look " },
          { text: "code", font: "mono" },
        ] },
      ] },
    ]);
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const mono = findRun(ast, (t) => t === "code");
    expect(mono?.mono).toBe(true);
    expect(mono?.fontFace).toBe("Menlo");
  });
});
