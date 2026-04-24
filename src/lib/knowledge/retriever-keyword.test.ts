import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listSearchableDocuments: vi.fn(),
  readFileText: vi.fn(),
  ripgrepSearch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  listSearchableDocuments: mocks.listSearchableDocuments,
}));

vi.mock("@/lib/tauri", () => ({
  readFileText: mocks.readFileText,
  ripgrepSearch: mocks.ripgrepSearch,
}));

import { expandQueryTerms, retrieveRelevant, type KnowledgeSearchPlan } from "./retriever";

describe("keyword knowledge retrieval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readFileText.mockImplementation(async (filePath: string) => {
      if (filePath === "/cache/doc1.txt") return "渠道转化率下降，退款率上升，导致销售下滑。";
      if (filePath === "/cache/doc2.txt") return "招聘预算和面试流程。";
      return "";
    });
    mocks.ripgrepSearch.mockRejectedValue(new Error("rg unavailable in unit test"));
  });

  it("expands Chinese queries into searchable terms", () => {
    const terms = expandQueryTerms("销售下滑原因");

    expect(terms).toContain("销售下滑原因");
    expect(terms).toContain("销售");
    expect(terms).toContain("下滑");
    expect(terms).toContain("原因");
  });

  it("matches file metadata and extracted text without embeddings", async () => {
    mocks.listSearchableDocuments.mockResolvedValue([
      {
        id: "doc1",
        sourceId: "source1",
        filename: "销售复盘.md",
        filePath: "/docs/sales.md",
        status: "indexed",
        embeddingStatus: "none",
        sourceName: "work docs",
        sourcePath: "/docs",
        entitySummary: "销售复盘 分析渠道、退款、转化率",
        extractedTextPath: "/cache/doc1.txt",
      },
      {
        id: "doc2",
        sourceId: "source1",
        filename: "招聘计划.md",
        filePath: "/docs/hiring.md",
        status: "indexed",
        embeddingStatus: "none",
        sourceName: "work docs",
        sourcePath: "/docs",
        entitySummary: "人力计划",
        extractedTextPath: "/cache/doc2.txt",
      },
    ]);

    const results = await retrieveRelevant("销售 下滑 转化率", 5);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      documentId: "doc1",
      metadata: expect.objectContaining({
        filename: "销售复盘.md",
        retrieval: "target-keyword",
      }),
    });
    expect(results[0].content).toContain("销售下滑");
  });

  it("finds a target document from natural language with month and intent expansion", async () => {
    mocks.listSearchableDocuments.mockResolvedValue([
      {
        id: "doc1",
        sourceId: "source1",
        filename: "硬件3月经营分析会.pdf",
        filePath: "/docs/硬件3月经营分析会.pdf",
        status: "indexed",
        embeddingStatus: "none",
        sourceName: "work docs",
        sourcePath: "/docs",
        entitySummary: "硬件 3月 经营分析 利润 收入",
        extractedTextPath: "/cache/doc3.txt",
      },
      {
        id: "doc2",
        sourceId: "source1",
        filename: "软件4月项目计划.pdf",
        filePath: "/docs/软件4月项目计划.pdf",
        status: "indexed",
        embeddingStatus: "none",
        sourceName: "work docs",
        sourcePath: "/docs",
        entitySummary: "软件 项目 计划 排期",
        extractedTextPath: "/cache/doc4.txt",
      },
    ]);
    mocks.readFileText.mockImplementation(async (filePath: string) => {
      if (filePath === "/cache/doc3.txt") return "3月硬件利润承压，但收入保持增长。";
      if (filePath === "/cache/doc4.txt") return "软件项目计划。";
      return "";
    });

    const results = await retrieveRelevant("硬件3月份的经营情况怎么样", 5);

    expect(results[0]).toMatchObject({
      documentId: "doc1",
      metadata: expect.objectContaining({
        filename: "硬件3月经营分析会.pdf",
        retrieval: "target-keyword",
      }),
    });
    expect(results[0].metadata?.matchedTerms).toEqual(expect.arrayContaining(["硬件", "3月", "经营"]));
  });

  it("uses structured search plans with OR should terms and must filtering", async () => {
    mocks.listSearchableDocuments.mockResolvedValue([
      {
        id: "doc1",
        sourceId: "source1",
        filename: "25年上半年人力数据分析-V1.xlsx",
        filePath: "/docs/hr.xlsx",
        status: "indexed",
        embeddingStatus: "none",
        sourceName: "work docs",
        sourcePath: "/docs",
        entitySummary: "Excel workbook: 员工 招聘 薪酬 绩效",
        extractedTextPath: "/cache/doc1.txt",
      },
      {
        id: "doc2",
        sourceId: "source1",
        filename: "销售复盘.md",
        filePath: "/docs/sales.md",
        status: "indexed",
        embeddingStatus: "none",
        sourceName: "work docs",
        sourcePath: "/docs",
        entitySummary: "销售 数据",
        extractedTextPath: "/cache/doc2.txt",
      },
    ]);
    mocks.ripgrepSearch.mockResolvedValue([
      { path: "/cache/doc1.txt", line_number: 2, line: "招聘计划和薪酬预算" },
    ]);

    const plan: KnowledgeSearchPlan = {
      should: ["人力资源", "人力", "员工", "招聘", "绩效", "薪酬", "组织"],
      strategy: "broad_or_then_rank",
    };
    const results = await retrieveRelevant(plan, 5);

    expect(mocks.ripgrepSearch).toHaveBeenCalledWith(
      "/cache",
      expect.stringContaining("人力资源|"),
      expect.any(Number),
    );
    expect(results[0]).toMatchObject({
      documentId: "doc1",
      metadata: expect.objectContaining({
        filename: "25年上半年人力数据分析-V1.xlsx",
        searchStrategy: "broad_or_then_rank",
      }),
    });
    expect(results[0].metadata?.matchedTerms).toEqual(expect.arrayContaining(["招聘", "薪酬"]));
  });
});
