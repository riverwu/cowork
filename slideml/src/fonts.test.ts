import { describe, expect, it } from "vitest";
import {
  FONT_STACKS,
  cjkHintForLanguage,
  fontStackFor,
  primaryFontFace,
} from "./fonts.js";

describe("fonts — fontStackFor", () => {
  it("returns the latin stack starting with Inter", () => {
    expect(fontStackFor("latin")[0]).toBe("Inter");
  });

  it("returns a CJK chain that covers macOS, Windows and Linux", () => {
    const stack = fontStackFor("cjk-zh");
    expect(stack).toContain("PingFang SC");        // macOS
    expect(stack).toContain("Microsoft YaHei");    // Windows
    expect(stack).toContain("Source Han Sans CN"); // cross-platform
    expect(stack).toContain("Noto Sans SC");       // Google fallback
    expect(stack[stack.length - 1]).toBe("sans-serif");
  });

  it("returns a CJK-TW chain distinct from CJK-zh", () => {
    expect(fontStackFor("cjk-zh-tw")[0]).toBe("PingFang TC");
  });

  it("returns the Japanese chain", () => {
    expect(fontStackFor("cjk-ja")[0]).toBe("Hiragino Sans");
  });

  it("returns the Korean chain", () => {
    expect(fontStackFor("cjk-ko")[0]).toBe("Apple SD Gothic Neo");
  });

  it("returns the mono chain", () => {
    expect(fontStackFor("mono")[0]).toBe("JetBrains Mono");
    expect(fontStackFor("mono")).toContain("Menlo");
  });

  it("returns a fresh array each call", () => {
    const a = fontStackFor("cjk-zh");
    a.push("Tampered");
    expect(fontStackFor("cjk-zh")).not.toContain("Tampered");
  });
});

describe("fonts — cjkHintForLanguage", () => {
  it("maps zh-CN to cjk-zh", () => {
    expect(cjkHintForLanguage("zh-CN")).toBe("cjk-zh");
    expect(cjkHintForLanguage("zh-Hans")).toBe("cjk-zh");
    expect(cjkHintForLanguage("zh")).toBe("cjk-zh");
  });

  it("maps zh-TW / zh-Hant to cjk-zh-tw", () => {
    expect(cjkHintForLanguage("zh-TW")).toBe("cjk-zh-tw");
    expect(cjkHintForLanguage("zh-Hant")).toBe("cjk-zh-tw");
  });

  it("maps Japanese and Korean correctly", () => {
    expect(cjkHintForLanguage("ja-JP")).toBe("cjk-ja");
    expect(cjkHintForLanguage("ko-KR")).toBe("cjk-ko");
  });

  it("returns null for non-CJK languages", () => {
    expect(cjkHintForLanguage("en-US")).toBeNull();
    expect(cjkHintForLanguage("fr")).toBeNull();
    expect(cjkHintForLanguage(undefined)).toBeNull();
  });
});

describe("fonts — primaryFontFace", () => {
  it("returns the first family of each chain", () => {
    expect(primaryFontFace("latin")).toBe("Inter");
    expect(primaryFontFace("cjk-zh")).toBe("PingFang SC");
    expect(primaryFontFace("mono")).toBe("JetBrains Mono");
  });
});

describe("fonts — FONT_STACKS shape", () => {
  it("declares exactly the six expected hints", () => {
    expect(Object.keys(FONT_STACKS).sort()).toEqual([
      "cjk-ja",
      "cjk-ko",
      "cjk-zh",
      "cjk-zh-tw",
      "latin",
      "mono",
    ]);
  });

  it("every chain is non-empty", () => {
    for (const [hint, stack] of Object.entries(FONT_STACKS)) {
      expect(stack.length, `${hint} must have at least one entry`).toBeGreaterThan(0);
    }
  });
});
