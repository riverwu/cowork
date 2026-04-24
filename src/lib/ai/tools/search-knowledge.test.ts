import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  retrieveRelevant: vi.fn(),
  getKnowledgeStats: vi.fn(),
  listSources: vi.fn(),
}));

vi.mock("@/lib/knowledge", () => ({
  retrieveRelevant: mocks.retrieveRelevant,
}));

vi.mock("@/lib/db", () => ({
  getKnowledgeStats: mocks.getKnowledgeStats,
  listSources: mocks.listSources,
}));

import { searchKnowledge } from "./search-knowledge";

describe("search_knowledge tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.retrieveRelevant.mockResolvedValue([
      {
        documentId: "doc1",
        score: 0.92,
        content: "这是一段很长的命中内容。".repeat(80),
        metadata: {
          filename: "人力资源分析.xlsx",
          filePath: "/docs/人力资源分析.xlsx",
          matchedTerms: ["人力资源", "招聘", "薪酬"],
        },
      },
    ]);
  });

  it("returns document candidates by default without large excerpts", async () => {
    const result = await searchKnowledge.execute({ query: "人力资源 招聘 薪酬", top_k: 10 });

    expect(result).toContain("Found 1 relevant documents");
    expect(result).toContain("人力资源分析.xlsx");
    expect(result).toContain("Returned document candidates only");
    expect(result).toContain("preview:");
    expect(result.length).toBeLessThan(1200);
  });

  it("returns snippets when explicitly requested", async () => {
    const result = await searchKnowledge.execute({ query: "人力资源 招聘 薪酬", mode: "snippets" });

    expect(result).toContain("Found 1 relevant excerpts");
    expect(result).toContain("这是一段很长的命中内容。");
    expect(result).not.toContain("Returned document candidates only");
  });
});
