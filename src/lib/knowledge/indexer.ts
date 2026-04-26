import { deleteFile, extractDocumentTextToCache, parseDocument, type NativeIndexedFile } from "@/lib/tauri";
import {
  createDocument,
  getDocumentBySourcePath,
  updateDocumentContent,
  deleteChunksByDocument,
  deleteDocumentsMissingFromPaths,
  updateSourceStatus,
  updateDocumentIndexFailure,
  updateDocumentIndexWarning,
  replaceSourceCapabilities,
  replaceSourceEntitiesByExternalPrefix,
} from "@/lib/db";
import type { Document, FileInfo, SourceEntity } from "@/types";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const CONTENT_INDEXABLE_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "json", "xml", "html", "htm",
  "pdf", "doc", "docx", "xlsx", "xls",
  "py", "js", "ts", "rs", "go", "java", "rb", "sh", "yaml", "yml", "toml",
]);
const SPREADSHEET_EXTENSIONS = new Set(["csv", "xlsx", "xls"]);
const PRESENTATION_EXTENSIONS = new Set(["pptx", "ppt"]);
const CATALOG_PREVIEW_CHARS = 24_000;

/** Split text into overlapping chunks. */
export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + CHUNK_SIZE;

    // Try to break at a paragraph or sentence boundary
    if (end < text.length) {
      const slice = text.slice(start, end + 100);
      const paragraphBreak = slice.lastIndexOf("\n\n");
      const sentenceBreak = slice.lastIndexOf(". ");
      const lineBreak = slice.lastIndexOf("\n");

      if (paragraphBreak > CHUNK_SIZE * 0.5) {
        end = start + paragraphBreak + 2;
      } else if (sentenceBreak > CHUNK_SIZE * 0.5) {
        end = start + sentenceBreak + 2;
      } else if (lineBreak > CHUNK_SIZE * 0.5) {
        end = start + lineBreak + 1;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
    // Avoid infinite loop on very small texts
    if (end >= text.length) break;
  }

  return chunks;
}

export function isContentIndexable(file: Pick<FileInfo, "extension">): boolean {
  return CONTENT_INDEXABLE_EXTENSIONS.has(file.extension.toLowerCase());
}

/** Index a single document: parse → chunk → local text cache → metadata catalog. */
export async function indexDocument(
  sourceId: string,
  file: FileInfo,
): Promise<void> {
  const contentHash = fileFingerprint(file);
  const existing = await getDocumentBySourcePath(sourceId, file.path);
  if (existing?.status === "excluded") {
    return;
  }
  if (
    existing &&
    existing.contentHash === contentHash &&
    existing.status === "indexed" &&
    existing.embeddingStatus === "none"
  ) {
    return;
  }

  // 1. Create or update document record
  const doc = await createDocument({
    sourceId,
    filename: file.name,
    filePath: file.path,
    fileModifiedAt: file.modified_at,
    size: file.size,
    contentHash,
  });

  try {
    await deleteChunksByDocument(doc.id);

    if (!isContentIndexable(file)) {
      await updateDocumentContent(doc.id, "", "none");
      await updateDocumentCatalog(sourceId, doc, file, "");
      return;
    }

    // 2. Parse document to text. If extraction fails, keep the file cataloged
    // as metadata-only instead of making the whole import fail.
    let text: string;
    try {
      text = await extractTextPreviewToCache(doc, file.path);
    } catch (err) {
      await updateDocumentContent(doc.id, "", "none");
      await updateDocumentIndexWarning(
        doc.id,
        `Text extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      await updateDocumentCatalog(sourceId, doc, file, "");
      return;
    }

    if (!text || text.trim().length === 0) {
      await updateDocumentContent(doc.id, "", "none");
      await updateDocumentCatalog(sourceId, doc, file, "");
      return;
    }

    await updateDocumentContent(doc.id, "", "none");

    await updateDocumentCatalog(sourceId, doc, file, text);
  } catch (err) {
    await updateDocumentIndexFailure(doc.id, err instanceof Error ? err.message : String(err));
    console.error(`Failed to index ${file.name}:`, err);
  }
}

/** Index all files from a source. Updates source status during the process. */
export async function indexSource(
  sourceId: string,
  files: FileInfo[],
  onProgress?: (current: number, total: number, filename: string) => void,
): Promise<void> {
  await updateSourceStatus(sourceId, "indexing");

  try {
    await replaceSourceCapabilities(sourceId, sourceCapabilities());
    const deletedDocs = await deleteDocumentsMissingFromPaths(sourceId, files.map((f) => f.path));
    await Promise.all(deletedDocs.map((doc) => deleteExtractedTextCache(doc)));
    for (let i = 0; i < files.length; i++) {
      onProgress?.(i + 1, files.length, files[i].name);
      await indexDocument(sourceId, files[i]);
      await yieldToUi();
    }
    await updateSourceStatus(sourceId, "active");
  } catch (err) {
    await updateSourceStatus(sourceId, "error");
    throw err;
  }
}

export async function prepareNativeIndexSource(sourceId: string): Promise<void> {
  await updateSourceStatus(sourceId, "indexing");
  await replaceSourceCapabilities(sourceId, sourceCapabilities());
}

export async function indexNativeFile(sourceId: string, file: NativeIndexedFile): Promise<void> {
  const contentHash = fileFingerprint(file);
  const existing = await getDocumentBySourcePath(sourceId, file.path);
  if (existing?.status === "excluded") return;
  if (
    file.unchanged
    && existing
    && existing.contentHash === contentHash
    && existing.status === "indexed"
    && existing.embeddingStatus === "none"
  ) {
    return;
  }

  const doc = await createDocument({
    sourceId,
    filename: file.name,
    filePath: file.path,
    fileModifiedAt: file.modified_at,
    size: file.size,
    contentHash,
  });

  try {
    await deleteChunksByDocument(doc.id);
    await updateDocumentContent(doc.id, "", "none");
    if (file.error) {
      await updateDocumentIndexWarning(doc.id, file.error);
    }
    await updateDocumentCatalog(sourceId, doc, file, file.preview || "", file.cachePath || null);
  } catch (err) {
    await updateDocumentIndexFailure(doc.id, err instanceof Error ? err.message : String(err));
    console.error(`Failed to catalog ${file.name}:`, err);
  }
}

export async function completeNativeIndexSource(sourceId: string, files: Pick<FileInfo, "path">[]): Promise<void> {
  const deletedDocs = await deleteDocumentsMissingFromPaths(sourceId, files.map((f) => f.path));
  await Promise.all(deletedDocs.map((doc) => deleteExtractedTextCache(doc)));
  await updateSourceStatus(sourceId, "active");
}

export async function failNativeIndexSource(sourceId: string): Promise<void> {
  await updateSourceStatus(sourceId, "error");
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function sourceCapabilities() {
  return [
    {
      capabilityType: "search" as const,
      toolName: "search_knowledge",
      description: "Find relevant text excerpts from local extracted text cache and file catalog metadata.",
    },
    {
      capabilityType: "read" as const,
      toolName: "read_file",
      description: "Read a specific file by absolute path when exact source content is needed.",
    },
    {
      capabilityType: "analyze" as const,
      toolName: "run_python",
      description: "Analyze CSV/XLSX files with pandas/openpyxl and PPT/PPTX files with markitdown/python-pptx by opening the original file instead of relying on cached text.",
    },
    {
      capabilityType: "sync" as const,
      toolName: "list_directory",
      description: "Scan the local folder to refresh file inventory and detect additions/deletions.",
    },
  ];
}

function fileFingerprint(file: FileInfo): string {
  return `${file.path}:${file.size}:${file.modified_at}`;
}

function getCacheRootForPath(filePath: string | null): string | null {
  if (!filePath) return null;
  const idx = filePath.lastIndexOf("/");
  if (idx <= 0) return null;
  return `${filePath.slice(0, idx)}/.cowork-text-cache`;
}

function getExtractedTextPath(doc: Pick<Document, "id" | "filePath">): string | null {
  const cacheRoot = getCacheRootForPath(doc.filePath);
  return cacheRoot ? `${cacheRoot}/${doc.id}.txt` : null;
}

async function extractTextPreviewToCache(doc: Document, filePath: string): Promise<string> {
  const cachePath = getExtractedTextPath(doc);
  if (!cachePath) {
    return parseDocument(filePath);
  }
  const result = await extractDocumentTextToCache(filePath, cachePath, CATALOG_PREVIEW_CHARS);
  return result.preview;
}

async function deleteExtractedTextCache(doc: Document): Promise<void> {
  const cachePath = getExtractedTextPath(doc);
  if (!cachePath) return;
  await deleteFile(cachePath);
}

async function updateDocumentCatalog(
  sourceId: string,
  doc: Document,
  file: FileInfo,
  text: string,
  extractedTextPath?: string | null,
): Promise<void> {
  const prefix = `${doc.id}:`;
  const entities = buildCatalogEntities(doc, file, text, extractedTextPath);
  await replaceSourceEntitiesByExternalPrefix(sourceId, prefix, entities);
}

export function buildCatalogEntities(
  doc: Document,
  file: FileInfo,
  text: string,
  extractedTextPath?: string | null,
): Parameters<typeof replaceSourceEntitiesByExternalPrefix>[2] {
  const entities: Parameters<typeof replaceSourceEntitiesByExternalPrefix>[2] = [
    buildDocumentEntity(doc, file, text, extractedTextPath),
  ];

  if (file.extension === "csv") {
    const csvEntity = buildCsvEntity(doc, file, text);
    if (csvEntity) entities.push(csvEntity);
  } else if (file.extension === "xlsx" || file.extension === "xls") {
    entities.push(...buildWorkbookEntities(doc, file, text));
  } else if (PRESENTATION_EXTENSIONS.has(file.extension)) {
    entities.push(buildPresentationEntity(doc, file));
  }

  return entities;
}

function buildDocumentEntity(
  doc: Document,
  file: FileInfo,
  text: string,
  extractedTextPath?: string | null,
): Omit<SourceEntity, "id" | "sourceId" | "createdAt"> {
  return {
    entityType: isContentIndexable(file) ? "document" : "file",
    name: file.name,
    externalId: `${doc.id}:document`,
    summary: summarizeText(text) || metadataSummary(file),
    schema: {
      extension: file.extension,
      size: file.size,
      path: file.path,
      contentIndexable: isContentIndexable(file),
    },
    sample: null,
    metadata: {
      documentId: doc.id,
      filePath: file.path,
      filename: file.name,
      extension: file.extension,
      extractedTextPath: extractedTextPath ?? getExtractedTextPath(doc),
      accessStrategy: accessStrategyForFile(file),
    },
    updatedAt: file.modified_at,
  };
}

function summarizeText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function buildCsvEntity(
  doc: Document,
  file: FileInfo,
  text: string,
): Omit<SourceEntity, "id" | "sourceId" | "createdAt"> | null {
  const rows = parseDelimitedRows(text, 6);
  if (rows.length === 0) return null;
  const headers = rows[0];
  if (headers.length === 0) return null;
  return {
    entityType: "table",
    name: file.name,
    externalId: `${doc.id}:table:csv`,
    summary: `CSV table with ${headers.length} columns: ${headers.slice(0, 12).join(", ")}`,
    schema: {
      format: "csv",
      columns: headers.map((name, index) => ({ name, index })),
    },
    sample: {
      rows: rows.slice(1, 6),
    },
    metadata: {
      documentId: doc.id,
      filePath: file.path,
      filename: file.name,
      accessStrategy: "load_original_file",
    },
    updatedAt: file.modified_at,
  };
}

function buildWorkbookEntities(
  doc: Document,
  file: FileInfo,
  text: string,
): Array<Omit<SourceEntity, "id" | "sourceId" | "createdAt">> {
  const sections = text.split(/^## Sheet: /m).slice(1);
  return sections.slice(0, 50).map((section) => {
    const lines = section.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const sheetName = (lines.shift() || "Sheet").trim();
    const rows = lines.slice(0, 6).map((line) => line.split("\t").map((cell) => cell.trim()));
    const headers = inferHeaders(rows);
    return {
      entityType: "sheet",
      name: `${file.name} / ${sheetName}`,
      externalId: `${doc.id}:sheet:${sheetName}`,
      summary: `Workbook sheet "${sheetName}" with ${headers.length || "unknown"} detected columns${headers.length ? `: ${headers.slice(0, 12).join(", ")}` : ""}`,
      schema: {
        format: "xlsx",
        sheetName,
        columns: headers.map((name, index) => ({ name, index })),
      },
      sample: {
        rows: rows.slice(headers.length > 0 ? 1 : 0, 6),
      },
      metadata: {
        documentId: doc.id,
        filePath: file.path,
        filename: file.name,
        sheetName,
        accessStrategy: "load_original_file",
      },
      updatedAt: file.modified_at,
    };
  });
}

function buildPresentationEntity(
  doc: Document,
  file: FileInfo,
): Omit<SourceEntity, "id" | "sourceId" | "createdAt"> {
  return {
    entityType: "presentation",
    name: file.name,
    externalId: `${doc.id}:presentation`,
    summary: `Presentation file indexed as metadata.`,
    schema: {
      format: file.extension,
      contentIndexable: false,
    },
    sample: null,
    metadata: {
      documentId: doc.id,
      filePath: file.path,
      filename: file.name,
      extension: file.extension,
      accessStrategy: "presentation_parser",
    },
    updatedAt: file.modified_at,
  };
}

function metadataSummary(file: FileInfo): string {
  return `${file.extension || "unknown"} file, ${file.size} bytes, modified ${new Date(file.modified_at * 1000).toISOString()}`;
}

function accessStrategyForFile(file: Pick<FileInfo, "extension">): string {
  const ext = file.extension.toLowerCase();
  if (SPREADSHEET_EXTENSIONS.has(ext)) return "load_original_file";
  if (PRESENTATION_EXTENSIONS.has(ext)) return "presentation_parser";
  if (isContentIndexable({ extension: ext })) return "text_extraction";
  return "metadata_only";
}

function parseDelimitedRows(text: string, maxRows: number): string[][] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, maxRows);
  if (lines.length === 0) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  return lines.map((line) => line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, "")));
}

function inferHeaders(rows: string[][]): string[] {
  if (rows.length === 0) return [];
  const first = rows[0];
  const nonEmpty = first.filter(Boolean);
  if (nonEmpty.length === 0) return [];
  const mostlyText = nonEmpty.filter((cell) => Number.isNaN(Number(cell))).length >= Math.ceil(nonEmpty.length / 2);
  return mostlyText ? first : first.map((_, index) => `Column ${index + 1}`);
}

/** Re-index a single document (delete old chunks, re-parse, refresh text cache and catalog). */
export async function reindexDocument(
  documentId: string,
  sourceId: string,
  file: FileInfo,
): Promise<void> {
  await deleteChunksByDocument(documentId);
  const doc: Document = {
    id: documentId,
    sourceId,
    filename: file.name,
    filePath: file.path,
    contentText: null,
    status: "pending",
    embeddingStatus: "pending",
    contentHash: fileFingerprint(file),
    size: file.size,
    errorMessage: null,
    lastIndexedAt: null,
    fileModifiedAt: file.modified_at,
    createdAt: file.modified_at,
  };
  try {
    if (!isContentIndexable(file)) {
      await updateDocumentContent(documentId, "", "none");
      await updateDocumentCatalog(sourceId, doc, file, "");
      return;
    }

    let text: string;
    try {
      text = await extractTextPreviewToCache(doc, file.path);
    } catch (err) {
      await updateDocumentContent(documentId, "", "none");
      await updateDocumentIndexWarning(
        documentId,
        `Text extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      await updateDocumentCatalog(sourceId, doc, file, "");
      return;
    }

    if (!text || text.trim().length === 0) {
      await updateDocumentContent(documentId, "", "none");
      await updateDocumentCatalog(sourceId, doc, file, "");
      return;
    }

    await updateDocumentContent(documentId, "", "none");
    await updateDocumentCatalog(sourceId, doc, file, text);
  } catch (err) {
    await updateDocumentIndexFailure(documentId, err instanceof Error ? err.message : String(err));
    console.error(`Failed to reindex document ${documentId}:`, err);
  }
}
