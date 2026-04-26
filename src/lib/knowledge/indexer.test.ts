import { describe, it, expect } from "vitest";
import { buildCatalogEntities, chunkText, isContentIndexable } from "./indexer";
import type { Document, FileInfo } from "@/types";

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

describe("filesystem catalog planning", () => {
  const baseDoc: Document = {
    id: "doc1",
    sourceId: "source1",
    filename: "file",
    filePath: "/tmp/file",
    contentText: null,
    status: "indexed",
    embeddingStatus: "none",
    fileModifiedAt: 1_700_000_000,
    createdAt: 1_700_000_000,
  };

  function file(name: string, extension: string): FileInfo {
    return {
      name,
      path: `/tmp/${name}`,
      is_dir: false,
      size: 1234,
      modified_at: 1_700_000_000,
      extension,
    };
  }

  it("distinguishes content-indexable files from metadata-only files", () => {
    expect(isContentIndexable(file("notes.md", "md"))).toBe(true);
    expect(isContentIndexable(file("notes.markdown", "markdown"))).toBe(true);
    expect(isContentIndexable(file("legacy.doc", "doc"))).toBe(true);
    expect(isContentIndexable(file("proposal.docx", "docx"))).toBe(true);
    expect(isContentIndexable(file("paper.pdf", "pdf"))).toBe(true);
    expect(isContentIndexable(file("book.xlsx", "xlsx"))).toBe(true);
    expect(isContentIndexable(file("slides.pptx", "pptx"))).toBe(false);
    expect(isContentIndexable(file("image.png", "png"))).toBe(false);
  });

  it("keeps unsupported files as metadata-only catalog entries", () => {
    const entities = buildCatalogEntities(baseDoc, file("photo.png", "png"), "");
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({
      entityType: "file",
      name: "photo.png",
      schema: expect.objectContaining({ contentIndexable: false, extension: "png" }),
      metadata: expect.objectContaining({
        accessStrategy: "metadata_only",
      }),
    });
  });

  it("adds table schema hints for CSV files", () => {
    const entities = buildCatalogEntities(
      baseDoc,
      file("sales.csv", "csv"),
      "month,revenue,cost\nJan,100,40\nFeb,120,50",
    );
    expect(entities.map((e) => e.entityType)).toEqual(["document", "table"]);
    expect(entities[1]).toMatchObject({
      schema: {
        format: "csv",
        columns: [
          { name: "month", index: 0 },
          { name: "revenue", index: 1 },
          { name: "cost", index: 2 },
        ],
      },
      sample: { rows: [["Jan", "100", "40"], ["Feb", "120", "50"]] },
      metadata: expect.objectContaining({
        accessStrategy: "load_original_file",
      }),
    });
  });

  it("adds sheet schema hints for XLSX extracted text", () => {
    const entities = buildCatalogEntities(
      baseDoc,
      file("finance.xlsx", "xlsx"),
      "## Sheet: Revenue\nmonth\trevenue\tcost\nJan\t100\t40\n\n## Sheet: Users\nid\tname\n1\tA",
    );
    const sheets = entities.filter((e) => e.entityType === "sheet");
    expect(sheets).toHaveLength(2);
    expect(sheets[0]).toMatchObject({
      name: "finance.xlsx / Revenue",
      schema: expect.objectContaining({
        format: "xlsx",
        sheetName: "Revenue",
        columns: [
          { name: "month", index: 0 },
          { name: "revenue", index: 1 },
          { name: "cost", index: 2 },
        ],
      }),
      metadata: expect.objectContaining({ accessStrategy: "load_original_file" }),
    });
  });

  it("adds presentation access hints for PPTX files without pretending content is indexed", () => {
    const entities = buildCatalogEntities(baseDoc, file("strategy.pptx", "pptx"), "");
    expect(entities.map((e) => e.entityType)).toEqual(["file", "presentation"]);
    expect(entities[1]).toMatchObject({
      schema: expect.objectContaining({ format: "pptx", contentIndexable: false }),
      metadata: expect.objectContaining({
        accessStrategy: "presentation_parser",
      }),
    });
  });
});
