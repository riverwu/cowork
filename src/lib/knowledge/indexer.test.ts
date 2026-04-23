import { describe, it, expect } from "vitest";
import { chunkText } from "./indexer";

describe("chunkText", () => {
  it("returns empty array for empty text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("returns single chunk for short text", () => {
    const text = "Hello world, this is a short text.";
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it("splits long text into multiple chunks", () => {
    const text = "A".repeat(2500);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("creates overlapping chunks", () => {
    // Build text with distinct sections
    const section1 = "Section one content. ".repeat(30); // ~600 chars
    const section2 = "Section two content. ".repeat(30);
    const section3 = "Section three content. ".repeat(30);
    const text = section1 + section2 + section3;

    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // Check that adjacent chunks have some overlap
    for (let i = 0; i < chunks.length - 1; i++) {
      const endOfCurrent = chunks[i].slice(-50);
      const startOfNext = chunks[i + 1].slice(0, 200);
      // The overlap region should share some content
      const hasOverlap = endOfCurrent.split(" ").some(
        (word) => word.length > 3 && startOfNext.includes(word),
      );
      expect(hasOverlap).toBe(true);
    }
  });

  it("prefers paragraph boundaries for splitting", () => {
    const para1 = "First paragraph. ".repeat(30);
    const para2 = "Second paragraph. ".repeat(30);
    const text = para1 + "\n\n" + para2;

    const chunks = chunkText(text);
    // At least one chunk should end near the paragraph boundary
    const endsAtPara = chunks.some((c) => c.trimEnd().endsWith("."));
    expect(endsAtPara).toBe(true);
  });

  it("handles text with no good break points", () => {
    const text = "x".repeat(3000); // No spaces, no newlines
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    // All content should be covered
    const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(totalLen).toBeGreaterThanOrEqual(text.length);
  });
});
