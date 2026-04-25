import { describe, expect, it, vi, beforeEach } from "vitest";
import { statSync } from "node:fs";
import path from "node:path";
import type { FileInfo } from "@/types";

const mocks = vi.hoisted(() => ({
  parseDocument: vi.fn(),
  extractDocumentTextToCache: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  createDocument: vi.fn(),
  getDocumentBySourcePath: vi.fn(),
  updateDocumentContent: vi.fn(),
  deleteChunksByDocument: vi.fn(),
  deleteDocumentsMissingFromPaths: vi.fn(),
  updateSourceStatus: vi.fn(),
  updateDocumentIndexFailure: vi.fn(),
  updateDocumentIndexWarning: vi.fn(),
  replaceSourceCapabilities: vi.fn(),
  replaceSourceEntities: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  parseDocument: mocks.parseDocument,
  extractDocumentTextToCache: mocks.extractDocumentTextToCache,
  writeFile: mocks.writeFile,
  deleteFile: mocks.deleteFile,
}));

vi.mock("@/lib/db", () => ({
  createDocument: mocks.createDocument,
  getDocumentBySourcePath: mocks.getDocumentBySourcePath,
  updateDocumentContent: mocks.updateDocumentContent,
  deleteChunksByDocument: mocks.deleteChunksByDocument,
  deleteDocumentsMissingFromPaths: mocks.deleteDocumentsMissingFromPaths,
  updateSourceStatus: mocks.updateSourceStatus,
  updateDocumentIndexFailure: mocks.updateDocumentIndexFailure,
  updateDocumentIndexWarning: mocks.updateDocumentIndexWarning,
  replaceSourceCapabilities: mocks.replaceSourceCapabilities,
  replaceSourceEntitiesByExternalPrefix: mocks.replaceSourceEntities,
}));

import { indexDocument, indexSource } from "./indexer";

describe("indexDocument filesystem behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDocumentBySourcePath.mockResolvedValue(null);
    mocks.parseDocument.mockResolvedValue("Extracted document text");
    mocks.extractDocumentTextToCache.mockResolvedValue({
      cachePath: "/tmp/.cowork-text-cache/doc1.txt",
      preview: "Extracted document text",
      charCount: 23,
      byteCount: 23,
    });
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.deleteFile.mockResolvedValue(undefined);
    mocks.deleteDocumentsMissingFromPaths.mockResolvedValue([]);
    mocks.createDocument.mockResolvedValue({
      id: "doc1",
      sourceId: "source1",
      filename: "image.png",
      filePath: "/tmp/image.png",
      contentText: null,
      status: "pending",
      embeddingStatus: "pending",
      fileModifiedAt: 1,
      createdAt: 1,
    });
  });

  function file(name: string, extension: string): FileInfo {
    return {
      name,
      path: `/tmp/${name}`,
      is_dir: false,
      size: 100,
      modified_at: 1,
      extension,
    };
  }

  it("does not parse unsupported files and indexes metadata only", async () => {
    await indexDocument("source1", file("image.png", "png"));

    expect(mocks.parseDocument).not.toHaveBeenCalled();
    expect(mocks.deleteChunksByDocument).toHaveBeenCalledWith("doc1");
    expect(mocks.updateDocumentContent).toHaveBeenCalledWith("doc1", "", "none");
    expect(mocks.replaceSourceEntities).toHaveBeenCalledWith(
      "source1",
      "doc1:",
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "file",
          name: "image.png",
          metadata: expect.objectContaining({ accessStrategy: "metadata_only" }),
        }),
      ]),
    );
  });

  it("does not reindex excluded documents", async () => {
    mocks.getDocumentBySourcePath.mockResolvedValue({
      id: "doc1",
      status: "excluded",
    });

    await indexDocument("source1", file("secret.pdf", "pdf"));

    expect(mocks.createDocument).not.toHaveBeenCalled();
    expect(mocks.parseDocument).not.toHaveBeenCalled();
    expect(mocks.extractDocumentTextToCache).not.toHaveBeenCalled();
    expect(mocks.updateDocumentContent).not.toHaveBeenCalled();
  });

  it("keeps parsed documents indexed without embeddings and writes extracted text cache in native code", async () => {
    mocks.extractDocumentTextToCache.mockResolvedValue({
      cachePath: "/tmp/.cowork-text-cache/doc1.txt",
      preview: "Important report content",
      charCount: 24,
      byteCount: 24,
    });

    await indexDocument("source1", file("report.pdf", "pdf"));

    expect(mocks.updateDocumentContent).toHaveBeenCalledWith("doc1", "", "none");
    expect(mocks.updateDocumentIndexFailure).not.toHaveBeenCalled();
    expect(mocks.updateDocumentIndexWarning).not.toHaveBeenCalled();
    expect(mocks.extractDocumentTextToCache).toHaveBeenCalledWith(
      "/tmp/report.pdf",
      "/tmp/.cowork-text-cache/doc1.txt",
      24000,
    );
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("keeps files cataloged when text extraction fails", async () => {
    mocks.extractDocumentTextToCache.mockRejectedValue(new Error("scanned PDF"));

    await indexDocument("source1", file("scan.pdf", "pdf"));

    expect(mocks.updateDocumentContent).toHaveBeenCalledWith("doc1", "", "none");
    expect(mocks.updateDocumentIndexWarning).toHaveBeenCalledWith("doc1", "Text extraction failed: scanned PDF");
    expect(mocks.updateDocumentIndexFailure).not.toHaveBeenCalled();
    expect(mocks.replaceSourceEntities).toHaveBeenCalledWith(
      "source1",
      "doc1:",
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "document",
          name: "scan.pdf",
          metadata: expect.objectContaining({ accessStrategy: "text_extraction" }),
        }),
      ]),
    );
  });

  it("refreshes source inventory so added files are indexed and missing files are marked deleted", async () => {
    const files = [file("new-report.md", "md"), file("sales.xlsx", "xlsx")];

    await indexSource("source1", files);

    expect(mocks.updateSourceStatus).toHaveBeenNthCalledWith(1, "source1", "indexing");
    expect(mocks.deleteDocumentsMissingFromPaths).toHaveBeenCalledWith("source1", files.map((f) => f.path));
    expect(mocks.createDocument).toHaveBeenCalledTimes(2);
    expect(mocks.createDocument).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sourceId: "source1",
      filename: "new-report.md",
      filePath: "/tmp/new-report.md",
    }));
    expect(mocks.createDocument).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sourceId: "source1",
      filename: "sales.xlsx",
      filePath: "/tmp/sales.xlsx",
    }));
    expect(mocks.updateSourceStatus).toHaveBeenLastCalledWith("source1", "active");
  });

  it("handles an empty source scan by marking previous non-excluded documents deleted", async () => {
    await indexSource("source1", []);

    expect(mocks.deleteDocumentsMissingFromPaths).toHaveBeenCalledWith("source1", []);
    expect(mocks.createDocument).not.toHaveBeenCalled();
    expect(mocks.updateSourceStatus).toHaveBeenLastCalledWith("source1", "active");
  });

  it("does not treat actual test_docs samples as document errors when embeddings are unavailable", async () => {
    const sampleFiles = [
      "硬件3月经营分析会.pdf",
      "有道词典APP同传翻译重度用户定性报告 260305 V1.pdf",
      "25年上半年人力数据分析-V1.xlsx",
    ].map((name) => testDocFile(name));

    for (const sample of sampleFiles) {
      mocks.createDocument.mockResolvedValueOnce({
        id: `doc-${sample.name}`,
        sourceId: "source1",
        filename: sample.name,
        filePath: sample.path,
        contentText: null,
        status: "pending",
        embeddingStatus: "pending",
        fileModifiedAt: sample.modified_at,
        createdAt: sample.modified_at,
      });
      mocks.parseDocument.mockResolvedValueOnce(`Extracted text for ${sample.name}`);
      mocks.extractDocumentTextToCache.mockResolvedValueOnce({
        cachePath: `/tmp/.cowork-text-cache/doc-${sample.name}.txt`,
        preview: `Extracted text for ${sample.name}`,
        charCount: 100,
        byteCount: 100,
      });

      await indexDocument("source1", sample);
    }

    expect(mocks.updateDocumentIndexFailure).not.toHaveBeenCalled();
    expect(mocks.updateDocumentIndexWarning).not.toHaveBeenCalled();
    expect(mocks.updateDocumentContent).toHaveBeenCalledWith(`doc-${sampleFiles[0].name}`, "", "none");
    expect(mocks.updateDocumentContent).toHaveBeenCalledWith(`doc-${sampleFiles[1].name}`, "", "none");
    expect(mocks.updateDocumentContent).toHaveBeenCalledWith(`doc-${sampleFiles[2].name}`, "", "none");
    expect(mocks.extractDocumentTextToCache).toHaveBeenCalledTimes(sampleFiles.length);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});

function testDocFile(name: string): FileInfo {
  const absolutePath = path.resolve(process.cwd(), "test_docs", name);
  const stat = statSync(absolutePath);
  const extension = path.extname(name).slice(1).toLowerCase();
  return {
    name,
    path: absolutePath,
    is_dir: false,
    size: stat.size,
    modified_at: Math.floor(stat.mtimeMs / 1000),
    extension,
  };
}
