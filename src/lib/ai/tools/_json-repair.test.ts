import { describe, it, expect } from "vitest";
import { parseJsonLenient } from "./_json-repair";

describe("parseJsonLenient", () => {
  it("parses well-formed JSON unchanged", () => {
    expect(parseJsonLenient('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLenient('[{"layout":"cover","slots":{"title":"x"}}]')).toEqual([
      { layout: "cover", slots: { title: "x" } },
    ]);
  });

  it("repairs raw newlines inside string values (the common failure)", () => {
    // Real failure from a MiniMax-shape append_slides call: literal newlines
    // inside `body` strings — invalid JSON but recoverable.
    const broken = `[{"layout":"dashboard","slots":{"tl":{"body":"line one
line two
适用：A"}}}]`;
    const result = parseJsonLenient<Array<{ slots: { tl: { body: string } } }>>(broken);
    expect(result[0]!.slots.tl.body).toBe("line one\nline two\n适用：A");
  });

  it("handles tabs and carriage returns inside strings", () => {
    const broken = '{"a":"col1\tcol2","b":"row1\r\nrow2"}';
    const result = parseJsonLenient<{ a: string; b: string }>(broken);
    expect(result.a).toBe("col1\tcol2");
    expect(result.b).toBe("row1\r\nrow2");
  });

  it("respects escaped quotes inside strings (does not falsely exit string state)", () => {
    const broken = '{"q":"she said \\"hi\\"","x":"a\nb"}';
    const result = parseJsonLenient<{ q: string; x: string }>(broken);
    expect(result.q).toBe('she said "hi"');
    expect(result.x).toBe("a\nb");
  });

  it("preserves whitespace OUTSIDE strings (does not mangle pretty-printed JSON)", () => {
    const pretty = '{\n  "a": 1,\n  "b": 2\n}';
    expect(parseJsonLenient(pretty)).toEqual({ a: 1, b: 2 });
  });

  it("includes position + snippet in the thrown error when repair also fails", () => {
    const totallyBroken = '[{"a": 1}, {"b": 2,,,]'; // unrecoverable
    expect(() => parseJsonLenient(totallyBroken)).toThrowError(/position \d+/);
  });
});
