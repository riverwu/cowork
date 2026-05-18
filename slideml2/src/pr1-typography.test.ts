import { describe, expect, it } from "vitest";
import { resolveEmphasis, resolveFontWeight } from "./theme.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * PR1 — typography baseline. Tests cover:
 *   - Named CSS weights resolve to numeric and bold-flag.
 *   - emphasis:"key|muted|danger|..." applies a coherent (color+weight) bundle.
 *   - tracking words resolve to letter-spacing.
 *   - autoFit:"shrink" auto-enables on display-tier styles when the agent omits it.
 */

function deck(slides: SlideV2[]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
    slides,
  };
}

type AstTextShape = { type: "text"; paragraphs: Array<{ runs: Array<{ text: string; letterSpacing?: number; highlight?: string; bold?: boolean; color?: string; italic?: boolean }> }>; autoFit?: string };

function findRunByText(shapes: Array<{ type: string }>, needle: string) {
  const normalizedNeedle = needle.replace(/\u2060/g, "");
  for (const sh of shapes) {
    if (sh.type !== "text") continue;
    const t = sh as AstTextShape;
    for (const p of t.paragraphs || []) {
      for (const r of p.runs || []) {
        const normalizedText = r.text.replace(/\u2060/g, "");
        if (normalizedText === normalizedNeedle || normalizedText.includes(normalizedNeedle)) return r;
      }
    }
  }
  return undefined;
}

function findShapeByRunText(shapes: Array<{ type: string }>, needle: string): AstTextShape | undefined {
  for (const sh of shapes) {
    if (sh.type !== "text") continue;
    const t = sh as AstTextShape;
    if ((t.paragraphs || []).some((p) => (p.runs || []).some((r) => r.text === needle || r.text.includes(needle)))) return t;
  }
  return undefined;
}

describe("PR1: named CSS font weights resolve correctly", () => {
  it.each([
    ["thin", 100, false],
    ["extralight", 200, false],
    ["light", 300, false],
    ["regular", 400, false],
    ["normal", 400, false],
    ["medium", 500, false],
    ["semibold", 600, true],
    ["bold", 700, true],
    ["extrabold", 800, true],
    ["black", 900, true],
  ])("%s -> numeric=%i, bold=%s", (name, expectedNumeric, expectedBold) => {
    const r = resolveFontWeight(name as never);
    expect(r.numeric).toBe(expectedNumeric);
    expect(r.bold).toBe(expectedBold);
  });

  it("numeric weights round to nearest 100", () => {
    expect(resolveFontWeight(450).numeric).toBe(500);
    expect(resolveFontWeight(550).numeric).toBe(600);
    expect(resolveFontWeight(650).numeric).toBe(700);
  });

  it("invalid string fallbacks to 400 / not bold", () => {
    const r = resolveFontWeight("blueish" as never);
    expect(r.numeric).toBe(400);
    expect(r.bold).toBe(false);
  });
});

describe("PR1: emphasis lexicon", () => {
  it("emphasis:\"key\" returns semibold + text.primary", () => {
    const e = resolveEmphasis("key");
    expect(e?.weight).toBe("semibold");
    expect(e?.color).toBe("text.primary");
  });

  it("emphasis:\"muted\" returns text.muted color, no weight bump", () => {
    const e = resolveEmphasis("muted");
    expect(e?.color).toBe("text.muted");
    expect(e?.weight).toBeUndefined();
  });

  it.each(["lead", "key", "strong", "muted", "subtle", "accent", "danger", "warning", "success", "info"] as const)(
    "%s is registered",
    (name) => {
      expect(resolveEmphasis(name)).toBeDefined();
    },
  );

  it("unknown emphasis is ignored (returns undefined, not a fallback)", () => {
    expect(resolveEmphasis("nonsense")).toBeUndefined();
    expect(resolveEmphasis(undefined)).toBeUndefined();
  });
});

describe("PR1: emphasis applied to runs at render time", () => {
  it("a content run with emphasis:\"key\" emits bold + text.primary color", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.t",
        type: "text",
        content: [
          { text: "正常文本，" },
          { text: "重点段落", emphasis: "key" },
        ],
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const keyRun = findRunByText(ast.slides[0].shapes, "重点段落");
    expect(keyRun?.bold).toBe(true);
  });

  it("emphasis:\"muted\" colors only that run (others stay default)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.t",
        type: "text",
        content: [
          { text: "强调正文", emphasis: "key" },
          { text: "(说明)", emphasis: "muted" },
        ],
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const main = findRunByText(ast.slides[0].shapes, "强调正文")!;
    const muted = findRunByText(ast.slides[0].shapes, "(说明)")!;
    expect(main.color).not.toBe(muted.color);
  });
});

describe("PR1: tracking words → letter-spacing", () => {
  it("run with tracking:\"wide\" resolves to positive letter-spacing", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.t",
        type: "text",
        content: [{ text: "EYEBROW", tracking: "wide" }],
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const run = findRunByText(ast.slides[0].shapes, "EYEBROW")!;
    expect(run.letterSpacing).toBeGreaterThan(0);
  });

  it("run with tracking:\"tight\" resolves to negative letter-spacing", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.t",
        type: "text",
        content: [{ text: "Tight Headline", tracking: "tight" }],
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const run = findRunByText(ast.slides[0].shapes, "Tight Headline")!;
    expect(run.letterSpacing).toBeLessThan(0);
  });
});

describe("PR1: highlight without explicit marks now applies", () => {
  it("a content run with `highlight:\"yellow\"` paints highlight (no marks needed)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.t",
        type: "text",
        content: [{ text: "突出", highlight: "yellow" }],
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const run = findRunByText(ast.slides[0].shapes, "突出")!;
    expect(run.highlight).toBeDefined();
  });
});

describe("PR1: autoFit defaults for display-tier styles", () => {
  it("a hero text node without explicit autoFit emits autoFit:\"shrink\"", () => {
    const slide: SlideV2 = {
      id: "s",
      children: [{
        id: "s.hero",
        type: "text",
        style: "hero",
        text: "An overly long hero headline that probably needs auto shrink to fit on one line",
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const heroShape = findShapeByRunText(ast.slides[0].shapes, "An overly long hero");
    expect(heroShape?.autoFit).toBe("shrink");
  });

  it("paragraph / body styles do NOT auto-enable shrink", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{ id: "s.p", type: "text", style: "paragraph", text: "Body content stays as-is." }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const bodyShape = findShapeByRunText(ast.slides[0].shapes, "Body content stays as-is.");
    expect(bodyShape?.autoFit).toBeUndefined();
  });

  it("explicit autoFit:\"none\" by-passes default", () => {
    const slide: SlideV2 = {
      id: "s",
      children: [{
        id: "s.hero",
        type: "text",
        style: "hero",
        autoFit: "none",
        text: "Hero",
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const shape = findShapeByRunText(ast.slides[0].shapes, "Hero");
    expect(shape?.autoFit).toBeUndefined();
  });
});

describe("PR1: node-level emphasis", () => {
  it("a text node with emphasis:\"accent\" colors the whole shape", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{ id: "s.label", type: "text", emphasis: "accent", text: "重点提示" }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const run = findRunByText(ast.slides[0].shapes, "重点提示")!;
    expect(run.bold).toBe(true);
  });

  it("a text node with weight:\"medium\" is NOT bold (medium=500, bold cutoff is 600)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{ id: "s.t", type: "text", weight: "medium", text: "中等字重" }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const run = findRunByText(ast.slides[0].shapes, "中等字重")!;
    expect(run.bold).toBe(false);
  });

  it("a text node with weight:\"semibold\" IS bold (semibold=600 ≥ cutoff)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{ id: "s.t", type: "text", weight: "semibold", text: "半粗" }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const run = findRunByText(ast.slides[0].shapes, "半粗")!;
    expect(run.bold).toBe(true);
  });
});
