import { describe, expect, it } from "vitest";
import { CHIP_KINDS, INLINE_ICONS, INLINE_ICON_NAMES, parseInline, parseInlineParagraphs } from "./markdown-inline.js";

describe("markdown-inline parser", () => {
  it("returns a single plain run when no markdown tokens", () => {
    const runs = parseInline("just plain text", { sizeHalfPt: 28, color: "F5F9FC" });
    expect(runs).toEqual([{ text: "just plain text", sizeHalfPt: 28, color: "F5F9FC", fontFace: undefined, cjk: undefined }]);
  });

  it("splits **bold** into a bold run sandwiched in plain runs", () => {
    const runs = parseInline("hello **world** here", { sizeHalfPt: 28 });
    expect(runs.map((r) => ({ text: r.text, bold: r.bold ?? false }))).toEqual([
      { text: "hello ", bold: false },
      { text: "world", bold: true },
      { text: " here", bold: false },
    ]);
  });

  it("splits *italic* into italic", () => {
    const runs = parseInline("show *me* the way", { sizeHalfPt: 28 });
    expect(runs.find((r) => r.text === "me")?.italic).toBe(true);
  });

  it("splits `code` into mono", () => {
    const runs = parseInline("call `compile()` first", { sizeHalfPt: 28 });
    expect(runs.find((r) => r.text === "compile()")?.mono).toBe(true);
  });

  it("handles three token types in one line", () => {
    const runs = parseInline("**A** plus *B* and `C`", { sizeHalfPt: 28 });
    expect(runs.find((r) => r.text === "A")?.bold).toBe(true);
    expect(runs.find((r) => r.text === "B")?.italic).toBe(true);
    expect(runs.find((r) => r.text === "C")?.mono).toBe(true);
  });

  it("preserves base styling on every run", () => {
    const runs = parseInline("hi **world**", {
      sizeHalfPt: 56,
      color: "3CC2FF",
      fontFace: "PingFang SC",
      cjk: true,
    });
    for (const r of runs) {
      expect(r.sizeHalfPt).toBe(56);
      expect(r.color).toBe("3CC2FF");
      expect(r.fontFace).toBe("PingFang SC");
      expect(r.cjk).toBe(true);
    }
  });

  it("CJK content survives", () => {
    const runs = parseInline("AI 同传超过**人工同传** 1.7×", { sizeHalfPt: 28, cjk: true });
    expect(runs.find((r) => r.bold)?.text).toBe("人工同传");
  });

  it("parseInlineParagraphs splits on blank lines", () => {
    const paras = parseInlineParagraphs("para **one**.\n\npara two.", { sizeHalfPt: 28 });
    expect(paras).toHaveLength(2);
    expect(paras[0]?.find((r) => r.bold)?.text).toBe("one");
    expect(paras[1]?.[0]?.text).toBe("para two.");
  });

  it("ignores non-supported markdown (links, headers, lists)", () => {
    const runs = parseInline("# heading [link](http://x) - bullet", { sizeHalfPt: 28 });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.text).toBe("# heading [link](http://x) - bullet");
  });

  it("handles empty input", () => {
    expect(parseInline("", { sizeHalfPt: 28 })).toEqual([]);
  });

  describe("chips", () => {
    it("expands {up:+12% YoY} into glyph + value, both bold and chip-coloured", () => {
      const runs = parseInline("Revenue {up:+12% YoY}", {
        sizeHalfPt: 28,
        color: "111111",
        resolveChipColor: (k) => (k === "up" ? "00AA66" : undefined),
      });
      // ["Revenue ", "▲ ", "+12% YoY"]
      expect(runs).toHaveLength(3);
      expect(runs[1]?.text.startsWith("\u25B2")).toBe(true);
      expect(runs[1]?.color).toBe("00AA66");
      expect(runs[1]?.bold).toBe(true);
      expect(runs[2]?.text).toBe("+12% YoY");
      expect(runs[2]?.color).toBe("00AA66");
      expect(runs[2]?.bold).toBe(true);
    });

    it("falls back to base color when no chip resolver is supplied", () => {
      const runs = parseInline("OK {ok:done}", { sizeHalfPt: 28, color: "111111" });
      const valueRun = runs.find((r) => r.text === "done");
      expect(valueRun?.color).toBe("111111");
    });

    it("recognises every chip kind in CHIP_KINDS", () => {
      for (const kind of CHIP_KINDS) {
        const runs = parseInline(`{${kind}:value}`, { sizeHalfPt: 28 });
        expect(runs.find((r) => r.text === "value")).toBeTruthy();
      }
    });

    it("ignores unknown chip kinds (rendered literally)", () => {
      const runs = parseInline("{notreal:x}", { sizeHalfPt: 28 });
      // No alternative matched → entire text is one plain run.
      expect(runs).toHaveLength(1);
      expect(runs[0]?.text).toBe("{notreal:x}");
    });
  });

  describe("icons", () => {
    it("substitutes :check: with the corresponding glyph", () => {
      const runs = parseInline("step :check: done", { sizeHalfPt: 28 });
      const glyph = runs.find((r) => r.text === INLINE_ICONS.check);
      expect(glyph).toBeTruthy();
    });

    it("supports every icon name in INLINE_ICON_NAMES", () => {
      for (const name of INLINE_ICON_NAMES) {
        const runs = parseInline(`:${name}:`, { sizeHalfPt: 28 });
        expect(runs.find((r) => r.text === INLINE_ICONS[name])).toBeTruthy();
      }
    });

    it("emits an unknown :foo: token literally so authors notice typos", () => {
      const runs = parseInline(":notanicon:", { sizeHalfPt: 28 });
      expect(runs).toHaveLength(1);
      expect(runs[0]?.text).toBe(":notanicon:");
    });
  });

  it("composes chip + icon + bold in one line", () => {
    const runs = parseInline(":check: **Q3** revenue {up:+12%}", {
      sizeHalfPt: 28,
      resolveChipColor: () => "00AA66",
    });
    expect(runs.find((r) => r.text === "Q3")?.bold).toBe(true);
    expect(runs.find((r) => r.text === INLINE_ICONS.check)).toBeTruthy();
    expect(runs.find((r) => r.text === "+12%")?.color).toBe("00AA66");
  });
});
