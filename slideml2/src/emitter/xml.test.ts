import { describe, expect, it } from "vitest";
import { assertHex, attr, escapeText, xmlEscape } from "./xml.js";

describe("xml — escape", () => {
  it("escapes structural XML characters", () => {
    expect(xmlEscape("A & B < C > \"D\" 'E'")).toBe("A &amp; B &lt; C &gt; &quot;D&quot; &apos;E&apos;");
  });

  it("leaves plain text untouched", () => {
    expect(xmlEscape("hello world")).toBe("hello world");
    expect(xmlEscape("中文")).toBe("中文");
  });
});

describe("xml — escapeText (smart quotes)", () => {
  it("converts smart quotes to XML numeric entities", () => {
    expect(escapeText("\u201Chello\u201D")).toBe("&#x201C;hello&#x201D;");
    expect(escapeText("It\u2019s fine")).toBe("It&#x2019;s fine");
  });

  it("still escapes XML metacharacters", () => {
    expect(escapeText("<\u201Ctag\u201D>")).toBe("&lt;&#x201C;tag&#x201D;&gt;");
  });
});

describe("xml — assertHex", () => {
  it("accepts valid 6-char hex (any case)", () => {
    expect(() => assertHex("3CC2FF", "test")).not.toThrow();
    expect(() => assertHex("ffffff", "test")).not.toThrow();
    expect(() => assertHex("000000", "test")).not.toThrow();
  });

  it("rejects # prefix with a clear message", () => {
    expect(() => assertHex("#3CC2FF", "test")).toThrow(/must NOT include a leading "#"/);
  });

  it("rejects 8-char (alpha-encoded) form", () => {
    expect(() => assertHex("3CC2FFAA", "test")).toThrow(/8-char/);
  });

  it("rejects non-hex chars", () => {
    expect(() => assertHex("ZZZZZZ", "test")).toThrow(/not a 6-char hex/);
    expect(() => assertHex("3CC2F", "test")).toThrow();
  });

  it("includes the call-site label in the message", () => {
    expect(() => assertHex("xxx", "tokens.brand-primary")).toThrow(/tokens\.brand-primary/);
  });
});

describe("xml — attr", () => {
  it("formats string and number attributes", () => {
    expect(attr("name", "title")).toBe(' name="title"');
    expect(attr("sz", 2400)).toBe(' sz="2400"');
  });

  it("formats boolean attributes as 0/empty", () => {
    expect(attr("b", true)).toBe(' b="1"');
    expect(attr("b", false)).toBe("");
  });

  it("omits undefined attributes", () => {
    expect(attr("name", undefined)).toBe("");
  });

  it("escapes attribute values", () => {
    expect(attr("alt", "A & B")).toBe(' alt="A &amp; B"');
  });
});
