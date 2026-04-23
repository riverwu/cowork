import { getSettings } from "@/lib/db";
import { httpPost } from "@/lib/tauri";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

/**
 * Generate embeddings via OpenAI embedding API (routed through Rust HTTP layer).
 * Uses OpenAI API regardless of LLM provider choice.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const settings = await getSettings();

  const apiKey = settings.openaiApiKey;
  if (!apiKey) {
    throw new Error(
      "Embeddings require an OpenAI API key. Add one in Settings.",
    );
  }

  const baseUrl = (settings.openaiBaseUrl || "https://api.openai.com/v1").replace(/\/$/, "");

  const response = await httpPost(
    `${baseUrl}/embeddings`,
    { "Authorization": `Bearer ${apiKey}` },
    JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  );

  if (response.status !== 200) {
    throw new Error(`Embedding API error: ${response.status} ${response.body}`);
  }

  const data = JSON.parse(response.body);
  return data.data.map((item: { embedding: number[] }) => item.embedding);
}

/** Generate embedding for a single text. */
export async function generateEmbedding(text: string): Promise<number[]> {
  const [embedding] = await generateEmbeddings([text]);
  return embedding;
}

export { EMBEDDING_DIMENSIONS };
