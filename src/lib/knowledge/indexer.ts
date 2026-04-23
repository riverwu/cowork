import { parseDocument } from "@/lib/tauri";
import {
  createDocument,
  updateDocumentContent,
  createChunk,
  deleteChunksByDocument,
  updateSourceStatus,
} from "@/lib/db";
import { generateEmbeddings } from "./embeddings";
import type { FileInfo } from "@/types";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const EMBEDDING_BATCH_SIZE = 20;

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

/** Index a single document: parse → chunk → embed → store. */
export async function indexDocument(
  sourceId: string,
  file: FileInfo,
): Promise<void> {
  // 1. Create document record
  const doc = await createDocument({
    sourceId,
    filename: file.name,
    filePath: file.path,
    fileModifiedAt: file.modified_at,
  });

  try {
    // 2. Parse document to text
    const text = await parseDocument(file.path);
    if (!text || text.trim().length === 0) {
      await updateDocumentContent(doc.id, "");
      return;
    }

    await updateDocumentContent(doc.id, text);

    // 3. Chunk text
    const chunks = chunkText(text);
    if (chunks.length === 0) return;

    // 4. Generate embeddings in batches
    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);

      let embeddings: number[][] | null = null;
      try {
        embeddings = await generateEmbeddings(batch);
      } catch {
        // If embedding fails (no API key yet), store chunks without embeddings
        // They can be embedded later
      }

      for (let j = 0; j < batch.length; j++) {
        await createChunk({
          documentId: doc.id,
          content: batch[j],
          embedding: embeddings ? embeddings[j] : null,
          metadata: {
            chunkIndex: i + j,
            filename: file.name,
            sourceId,
          },
        });
      }
    }
  } catch (err) {
    // Document stays in 'pending' status if parsing fails
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
    for (let i = 0; i < files.length; i++) {
      onProgress?.(i + 1, files.length, files[i].name);
      await indexDocument(sourceId, files[i]);
    }
    await updateSourceStatus(sourceId, "active");
  } catch (err) {
    await updateSourceStatus(sourceId, "error");
    throw err;
  }
}

/** Re-index a single document (delete old chunks, re-parse, re-embed). */
export async function reindexDocument(
  documentId: string,
  sourceId: string,
  file: FileInfo,
): Promise<void> {
  await deleteChunksByDocument(documentId);
  // indexDocument creates a new doc record; for re-index we should update existing
  // For simplicity in Phase 1, we just create new chunks for the existing doc
  try {
    const text = await parseDocument(file.path);
    if (!text || text.trim().length === 0) return;

    await updateDocumentContent(documentId, text);

    const chunks = chunkText(text);
    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
      let embeddings: number[][] | null = null;
      try {
        embeddings = await generateEmbeddings(batch);
      } catch {
        // Continue without embeddings
      }
      for (let j = 0; j < batch.length; j++) {
        await createChunk({
          documentId,
          content: batch[j],
          embedding: embeddings ? embeddings[j] : null,
          metadata: { chunkIndex: i + j, sourceId },
        });
      }
    }
  } catch (err) {
    console.error(`Failed to reindex document ${documentId}:`, err);
  }
}
