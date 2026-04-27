import { describe, expect, it } from "vitest";
import { parseInline, parseInlineParagraphs } from "./markdown-inline.js";

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
});
