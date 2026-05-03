import { describe, expect, it } from "vitest";
import { hasMarkdownMarkers, parseMarkdownInline, splitNumericRun } from "./markdown-inline.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";

function deck(slides: SlideV2[]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
    slides,
  };
}

function findRun(shapes: Array<{ type: string }>, needle: string) {
  for (const sh of shapes) {
    if (sh.type !== "text") continue;
    const t = sh as { paragraphs: Array<{ runs: Array<{ text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; highlight?: string; mono?: boolean; hyperlink?: string; color?: string }> }> };
    for (const p of t.paragraphs || []) {
      for (const r of p.runs || []) {
        if (r.text === needle || r.text.includes(needle)) return r;
      }
    }
  }
  return undefined;
}

describe("PR2: hasMarkdownMarkers detection", () => {
  it.each([
    ["plain text", false],
    ["**bold**", true],
    ["this is *italic*", true],
    ["__underline__", true],
    ["~~struck~~", true],
    ["`code`", true],
    ["==highlight==", true],
    ["{{key:重点}}", true],
    ["[link](https://example.com)", true],
    ["price: $100", false],
    ["5*3=15", false], // word-internal asterisk should not trigger
  ])("hasMarkdownMarkers(%s) → %s", (input, expected) => {
    expect(hasMarkdownMarkers(input)).toBe(expected);
  });
});

describe("PR2: parseMarkdownInline core", () => {
  it("**bold** produces a single bold run", () => {
    const r = parseMarkdownInline("hello **world**");
    expect(r.matched).toBe(true);
    expect(r.runs).toEqual([
      { text: "hello " },
      { text: "world", marks: ["bold"] },
    ]);
  });

  it("*italic* produces a single italic run", () => {
    const r = parseMarkdownInline("a *strong* word");
    expect(r.matched).toBe(true);
    const italic = r.runs.find((x) => x.marks?.includes("italic"));
    expect(italic?.text).toBe("strong");
  });

  it("***bold-italic*** produces a run with both marks", () => {
    const r = parseMarkdownInline("***hello***");
    expect(r.matched).toBe(true);
    expect(r.runs[0]!.marks).toEqual(expect.arrayContaining(["bold", "italic"]));
  });

  it("__underline__ produces an underline run", () => {
    const r = parseMarkdownInline("__under__");
    expect(r.runs[0]!.marks).toEqual(["underline"]);
  });

  it("~~strike~~ produces a strikethrough run", () => {
    const r = parseMarkdownInline("~~gone~~");
    expect(r.runs[0]!.marks).toEqual(["strikethrough"]);
  });

  it("==highlight== produces a highlight run", () => {
    const r = parseMarkdownInline("==重点==");
    expect(r.runs[0]!.highlight).toBeDefined();
  });

  it("`code` produces a mono code run", () => {
    const r = parseMarkdownInline("call `fetch()` now");
    const code = r.runs.find((x) => x.font === "mono");
    expect(code?.text).toBe("fetch()");
  });

  it("{{key:foo}} produces a key-emphasis run", () => {
    const r = parseMarkdownInline("{{key:重点}}");
    expect(r.runs[0]!.emphasis).toBe("key");
  });

  it("{{num:25%}} produces an emphasis+lg run", () => {
    const r = parseMarkdownInline("{{num:25%}}");
    expect(r.runs[0]!.emphasis).toBe("key");
    expect(r.runs[0]!.size).toBe("lg");
  });

  it.each([
    ["lead", "lead"],
    ["muted", "muted"],
    ["danger", "danger"],
    ["success", "success"],
    ["accent", "accent"],
  ])("{{%s:foo}} → emphasis:%s", (name, expected) => {
    const r = parseMarkdownInline(`{{${name}:foo}}`);
    expect(r.runs[0]!.emphasis).toBe(expected);
  });

  it("[text](url) produces a hyperlink run", () => {
    const r = parseMarkdownInline("see [docs](https://example.com)");
    const link = r.runs.find((x) => x.link);
    expect(link?.link).toBe("https://example.com");
    expect(link?.text).toBe("docs");
  });

  it("backslash escapes the next marker", () => {
    const r = parseMarkdownInline("\\*not italic\\*");
    expect(r.matched).toBe(false);
    expect(r.runs[0]!.text).toBe("*not italic*");
  });

  it("unbalanced markers fall back to literal text", () => {
    const r = parseMarkdownInline("**no closer");
    // Unbalanced still produces a run with the input verbatim.
    expect(r.runs[0]!.text).toContain("**no closer");
  });

  it("does not match * inside numbers (5*3)", () => {
    const r = parseMarkdownInline("5*3=15");
    expect(r.matched).toBe(false);
  });

  it("plain text passes through unchanged", () => {
    const r = parseMarkdownInline("纯文本，没有标记。");
    expect(r.matched).toBe(false);
    expect(r.runs[0]!.text).toBe("纯文本，没有标记。");
  });
});

describe("PR2: splitNumericRun for metric-aware bolding", () => {
  it("splits \"25%\" + label", () => {
    const r = splitNumericRun("25% increase YoY");
    expect(r).toBeDefined();
    expect(r![0]!.text).toBe("25%");
    expect(r![0]!.weight).toBe("bold");
    expect(r![1]!.text).toContain("increase YoY");
  });

  it("splits \"¥1,250\" + label", () => {
    const r = splitNumericRun("¥1,250 GMV");
    expect(r).toBeDefined();
    expect(r![0]!.text).toBe("¥1,250");
  });

  it("returns null when the number stands alone (no label)", () => {
    expect(splitNumericRun("100")).toBeNull();
    expect(splitNumericRun("25%")).toBeNull();
  });

  it("returns null when no number is present", () => {
    expect(splitNumericRun("plain label")).toBeNull();
  });
});

describe("PR2: render-time markdown expansion", () => {
  it("text node with **bold** in the text field expands to multiple runs", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{ id: "s.t", type: "text", text: "前面 **重点** 后面" }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const boldRun = findRun(ast.slides[0].shapes, "重点");
    expect(boldRun).toBeDefined();
    expect(boldRun!.bold).toBe(true);
  });

  it("text node with `code` in the text field swaps to mono font", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{ id: "s.t", type: "text", text: "调用 `fetch()` 即可" }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const codeRun = findRun(ast.slides[0].shapes, "fetch()");
    expect(codeRun).toBeDefined();
  });

  it("markdown:false on the node disables expansion (literal text)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{ id: "s.t", type: "text", markdown: false, text: "literal **stars**" } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const literal = findRun(ast.slides[0].shapes, "literal **stars**");
    expect(literal).toBeDefined();
  });

  it("metric-value with \"25% YoY\" auto-bolds the numeric portion", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{ id: "s.metric", type: "text", style: "metric-value", text: "25% YoY" }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const numRun = findRun(ast.slides[0].shapes, "25%");
    const labelRun = findRun(ast.slides[0].shapes, "YoY");
    expect(numRun?.bold).toBe(true);
    expect(labelRun?.color).toBeDefined();
  });

  it("hero with \"¥1.2亿 营收\" auto-bolds ¥1.2亿", () => {
    const slide: SlideV2 = {
      id: "s",
      children: [{ id: "s.hero", type: "text", style: "hero", text: "¥1.2亿 营收" }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const numRun = findRun(ast.slides[0].shapes, "¥1.2亿");
    expect(numRun?.bold).toBe(true);
  });

  it("paragraph text inside a paragraphs[] array also expands", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.t",
        type: "text",
        paragraphs: [{ text: "请关注 **关键指标** 的变化" }],
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const boldRun = findRun(ast.slides[0].shapes, "关键指标");
    expect(boldRun?.bold).toBe(true);
  });

  it("bullet item text with **bold** also expands", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.b",
        type: "bullets",
        items: ["第一条**重要**", "第二条普通"],
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const boldRun = findRun(ast.slides[0].shapes, "重要");
    expect(boldRun?.bold).toBe(true);
  });
});

describe("PR2: hyperlink markdown produces a real hyperlink run", () => {
  it("[text](https://...) sets hyperlink + underline", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{ id: "s.t", type: "text", text: "see [docs](https://example.com) please" }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const linkRun = findRun(ast.slides[0].shapes, "docs");
    expect(linkRun?.hyperlink).toBe("https://example.com");
    expect(linkRun?.underline).toBe(true);
  });
});
