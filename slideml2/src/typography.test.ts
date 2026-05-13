import { describe, expect, it } from "vitest";
import { buildTheme, preferredFont, resolveFontWeight } from "./theme.js";
import { readFileSync } from "node:fs";
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

  it("normalizes single-string theme font chains", () => {
    const theme = buildTheme("default", undefined, {
      fonts: {
        latin: { display: "Arial", text: "Arial" },
        cjk: { display: "Microsoft YaHei", text: "Microsoft YaHei" },
        mono: "Consolas",
      },
    });

    expect(theme.fonts.latin.display).toEqual(["Arial"]);
    expect(theme.fonts.cjk.text).toEqual(["Microsoft YaHei"]);
    expect(theme.fonts.mono).toEqual(["Consolas"]);
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

describe("typography — themeOverride derived component styles", () => {
  it("derives key component text styles from the authored core text contract", () => {
    const theme = buildTheme({}, "default", {
      fonts: {
        latin: { display: ["Bodoni"], text: ["Inter"] },
        cjk: { display: ["Songti SC"], text: ["PingFang SC"] },
      },
      text: {
        "slide-title": { fontSize: 31, fontWeight: 700, lineHeight: 1.12, fontFamily: "display" },
        "section-title": { fontSize: 21, fontWeight: 700, lineHeight: 1.18, fontFamily: "display" },
        paragraph: { fontSize: 12, lineHeight: 1.35, fontFamily: "text" },
        caption: { fontSize: 9, lineHeight: 1.25 },
        "metric-value": { fontSize: 34, fontWeight: 700, lineHeight: 1, fontFamily: "display" },
      },
    });

    expect(theme.text["card-title"]?.fontSize).toBeCloseTo(15.3, 1);
    expect(theme.text["card-title"]?.fontFamily).toBe("display");
    expect(theme.text.label?.fontSize).toBeCloseTo(9.4, 1);
    expect(theme.text.label?.fontFamily).toBe("text");
    expect(theme.text["table-cell"]?.fontSize).toBeCloseTo(10.6, 1);
    expect(theme.text["table-cell"]?.fontFamily).toBe("text");
    expect(theme.text["table-header"]?.fontSize).toBeCloseTo(11.2, 1);
    expect(theme.text["metric-label"]?.fontSize).toBeCloseTo(12.5, 1);
  });

  it("derives timeline component typography from label/caption tokens", () => {
    const theme = buildTheme({}, "default", {
      text: {
        label: { fontSize: 10.5, lineHeight: 1.1, fontFamily: "text" },
        caption: { fontSize: 9.5, lineHeight: 1.22, fontFamily: "text" },
      },
    });

    expect(theme.text["timeline-time"]?.fontSize).toBe(10.5);
    expect(theme.text["timeline-time"]?.lineHeight).toBe(1.1);
    expect(theme.text["timeline-time"]?.color).toBe("text.primary");
    expect(theme.text["timeline-body"]?.fontSize).toBe(9.5);
    expect(theme.text["timeline-body"]?.lineHeight).toBe(1.22);
    expect(theme.text["timeline-body"]?.color).toBe("text.primary");
    expect(theme.text["timeline-title"]?.fontSize).toBe(theme.text["card-title"]?.fontSize);
  });

  it("keeps explicit timeline typography overrides stronger than derived defaults", () => {
    const theme = buildTheme({}, "default", {
      text: {
        caption: { fontSize: 9.5 },
        "timeline-body": { fontSize: 11, color: "danger" },
      },
    });

    expect(theme.text["timeline-body"]?.fontSize).toBe(11);
    expect(theme.text["timeline-body"]?.color).toBe("danger");
    expect(theme.text["timeline-body"]?.lineHeight).toBe(theme.text.caption?.lineHeight);
  });

  it("keeps explicit component text overrides stronger than derived defaults", () => {
    const theme = buildTheme({}, "default", {
      text: {
        "section-title": { fontFamily: "display" },
        paragraph: { fontSize: 12, fontFamily: "text" },
        "card-title": { fontSize: 18, fontFamily: "text" },
      },
    });

    expect(theme.text["card-title"]?.fontSize).toBe(18);
    expect(theme.text["card-title"]?.fontFamily).toBe("text");
  });
});

describe("typography — component factory policy", () => {
  it("timeline factory uses semantic typography tokens rather than local font defaults", () => {
    const source = readFileSync(new URL("./components.ts", import.meta.url), "utf8");
    const start = source.indexOf("function timelineStep(");
    const end = source.indexOf("function estimateTimelineBodyMinHeight", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const timelineStep = source.slice(start, end);

    expect(timelineStep).toContain('style: "timeline-time"');
    expect(timelineStep).toContain('style: "timeline-title"');
    expect(timelineStep).toContain('style: "timeline-body"');
    expect(timelineStep).not.toMatch(/\bfontSize\s*:/);
    expect(timelineStep).not.toMatch(/\blineHeight\s*:/);
    expect(timelineStep).not.toMatch(/\bfontFamily\s*:/);
    expect(timelineStep).not.toMatch(/\bsize\s*:\s*["'](?:xs|sm|md|lg|xl|2xl)["']/);
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
