import { getAllChunksWithEmbeddings } from "@/lib/db";
import { generateEmbedding } from "./embeddings";

interface RetrievalResult {
  content: string;
  documentId: string;
  score: number;
  metadata: Record<string, unknown> | null;
}

/** Cosine similarity between two vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

/** Retrieve the most relevant document chunks for a query.
 *
 *  Phase 1 implementation: loads all chunks into memory and computes
 *  cosine similarity in JS. This is fine for <10K chunks (typical personal
 *  document set). For larger scale, switch to sqlite-vec.
 */
export async function retrieveRelevant(
  query: string,
  topK = 5,
  minScore = 0.3,
): Promise<RetrievalResult[]> {
  // 1. Embed the query
  const queryEmbedding = await generateEmbedding(query);

  // 2. Get all chunks with embeddings from DB
  const allChunks = await getAllChunksWithEmbeddings();

  if (allChunks.length === 0) {
    return [];
  }

  // 3. Score each chunk
  const scored = allChunks.map((chunk) => ({
    content: chunk.content,
    documentId: chunk.documentId,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
    metadata: chunk.metadata,
  }));

  // 4. Sort by score descending, filter by min score, take top K
  return scored
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Build a knowledge context string from retrieval results.
 *  This gets injected into the system prompt. */
export function buildKnowledgeContext(results: RetrievalResult[]): string {
  if (results.length === 0) {
    return "";
  }

  const sections = results.map((r, i) => {
    const source = r.metadata?.filename ? ` (from ${r.metadata.filename})` : "";
    return `[Reference ${i + 1}${source}]\n${r.content}`;
  });

  return (
    "The following are relevant excerpts from the user's knowledge base. " +
    "Use them as context when helpful, and mention which documents you referenced.\n\n" +
    sections.join("\n\n---\n\n")
  );
}
