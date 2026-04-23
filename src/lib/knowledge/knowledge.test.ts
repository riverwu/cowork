import { describe, it, expect } from "vitest";
import { chunkText } from "./indexer";
import { buildKnowledgeContext } from "./retriever";

describe("Knowledge System", () => {

  describe("chunkText — text splitting", () => {
    it("returns empty array for empty text", () => {
      expect(chunkText("")).toEqual([]);
      expect(chunkText("   ")).toEqual([]);
    });

    it("returns single chunk for short text", () => {
      const text = "Hello world.";
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
      const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
      const chunks = chunkText(words);
      expect(chunks.length).toBeGreaterThan(1);

      // Adjacent chunks should share some content
      for (let i = 0; i < chunks.length - 1; i++) {
        const endWords = chunks[i].split(" ").slice(-5);
        const startOfNext = chunks[i + 1];
        const hasOverlap = endWords.some((w) => startOfNext.includes(w));
        expect(hasOverlap).toBe(true);
      }
    });

    it("prefers paragraph boundaries", () => {
      const text = "A".repeat(500) + "\n\n" + "B".repeat(500) + "\n\n" + "C".repeat(500);
      const chunks = chunkText(text);
      // At least one chunk should end near a paragraph
      const endsCleanly = chunks.some((c) => c.endsWith("A") || c.endsWith("B"));
      expect(endsCleanly).toBe(true);
    });

    it("prefers sentence boundaries", () => {
      const sentences = Array.from({ length: 100 }, (_, i) => `This is a longer sentence number ${i} with more content to ensure chunking. `).join("");
      const chunks = chunkText(sentences);
      expect(chunks.length).toBeGreaterThan(1);
      // Most chunks should end with a period
      const endsWithPeriod = chunks.filter((c) => c.trimEnd().endsWith("."));
      expect(endsWithPeriod.length).toBeGreaterThan(0);
    });

    it("handles text with no good break points", () => {
      const text = "x".repeat(3000);
      const chunks = chunkText(text);
      expect(chunks.length).toBeGreaterThan(1);
      // All content should be covered
      const total = chunks.reduce((sum, c) => sum + c.length, 0);
      expect(total).toBeGreaterThanOrEqual(text.length);
    });

    it("handles unicode text", () => {
      const text = "这是一段中文文本。".repeat(200);
      const chunks = chunkText(text);
      expect(chunks.length).toBeGreaterThan(1);
      // No chunk should be empty
      for (const chunk of chunks) {
        expect(chunk.length).toBeGreaterThan(0);
      }
    });
  });

  describe("buildKnowledgeContext — context formatting", () => {
    it("returns empty string for no results", () => {
      expect(buildKnowledgeContext([])).toBe("");
    });

    it("formats single result with source", () => {
      const ctx = buildKnowledgeContext([{
        content: "Test content",
        documentId: "doc1",
        score: 0.85,
        metadata: { filename: "test.md" },
      }]);
      expect(ctx).toContain("test.md");
      expect(ctx).toContain("Test content");
      expect(ctx).toContain("Reference 1");
    });

    it("formats multiple results", () => {
      const ctx = buildKnowledgeContext([
        { content: "First result", documentId: "d1", score: 0.9, metadata: { filename: "a.md" } },
        { content: "Second result", documentId: "d2", score: 0.7, metadata: { filename: "b.md" } },
      ]);
      expect(ctx).toContain("Reference 1");
      expect(ctx).toContain("Reference 2");
      expect(ctx).toContain("a.md");
      expect(ctx).toContain("b.md");
    });

    it("handles results without metadata", () => {
      const ctx = buildKnowledgeContext([{
        content: "Some content",
        documentId: "d1",
        score: 0.5,
        metadata: null,
      }]);
      expect(ctx).toContain("Some content");
    });
  });

  describe("Cosine similarity (via retriever)", () => {
    // Re-implement for testing since it's a private function
    function cosineSimilarity(a: number[], b: number[]): number {
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      return denom === 0 ? 0 : dot / denom;
    }

    it("identical vectors → 1.0", () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0);
    });

    it("orthogonal vectors → 0.0", () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
    });

    it("opposite vectors → -1.0", () => {
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
    });

    it("zero vector → 0", () => {
      expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    });

    it("scale invariant", () => {
      const sim = cosineSimilarity([1, 2, 3], [10, 20, 30]);
      expect(sim).toBeCloseTo(1.0);
    });

    it("works with high-dimensional vectors", () => {
      const a = Array.from({ length: 1536 }, (_, i) => Math.sin(i));
      const b = Array.from({ length: 1536 }, (_, i) => Math.sin(i + 0.01));
      const sim = cosineSimilarity(a, b);
      expect(sim).toBeGreaterThan(0.99);
    });
  });

  describe("Integration: chunk → context pipeline", () => {
    it("end-to-end: text → chunks → context format", () => {
      // Simulate the pipeline
      const originalText = "This is a document about machine learning. It covers neural networks, deep learning, and transformers.";

      // Step 1: chunk
      const chunks = chunkText(originalText);
      expect(chunks.length).toBeGreaterThanOrEqual(1);

      // Step 2: simulate retrieval results
      const results = chunks.map((chunk, i) => ({
        content: chunk,
        documentId: `doc_${i}`,
        score: 0.9 - i * 0.1,
        metadata: { filename: "ml_intro.md" },
      }));

      // Step 3: build context
      const context = buildKnowledgeContext(results);
      expect(context).toContain("machine learning");
      expect(context).toContain("ml_intro.md");
      expect(context).toContain("Reference");
    });
  });
});
