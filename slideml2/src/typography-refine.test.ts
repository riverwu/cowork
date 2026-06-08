import { describe, expect, it } from "vitest";
import { refineTypography, smartDashes, smartQuotes } from "./typography.js";

describe("typography refinement (M6.P0a)", () => {
  it("converts ASCII double quotes to curly quotes", () => {
    expect(smartQuotes('He said "hello" to her.')).toBe('He said “hello” to her.');
  });

  it("converts ASCII single quotes to apostrophe inside words", () => {
    expect(smartQuotes("it's a test")).toBe("it’s a test");
  });

  it("leaves already-curly quotes unchanged (idempotent)", () => {
    const already = "She said “fine” to him.";
    expect(smartQuotes(already)).toBe(already);
  });

  it("preserves CJK 「」 unchanged", () => {
    expect(smartQuotes("他说「你好」。")).toBe("他说「你好」。");
  });

  it("converts -- to em-dash", () => {
    expect(smartDashes("first -- second")).toBe("first — second");
  });

  it("converts word - word to en-dash with thin-space surround (editorial)", () => {
    // U+2009 thin space + U+2013 en-dash + U+2009 thin space — classic
    // editorial range form ("2024–2025" with optical breathing room).
    expect(smartDashes("2024 - 2025")).toBe("2024 – 2025");
  });

  it("leaves single hyphen in compound words alone", () => {
    expect(smartDashes("data-driven")).toBe("data-driven");
  });

  it("refineTypography composes both passes", () => {
    expect(refineTypography('He said "first -- second" yesterday.'))
      .toBe('He said “first — second” yesterday.');
  });

  it("handles empty input safely", () => {
    expect(refineTypography("")).toBe("");
  });
});
