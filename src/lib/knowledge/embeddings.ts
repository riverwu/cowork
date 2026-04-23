import { getSettings } from "@/lib/db";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

/** Generate embeddings for one or more texts using the configured provider's embedding API.
 *  Currently uses OpenAI's embedding API regardless of LLM provider choice
 *  (Anthropic doesn't have an embedding API). Falls back to OpenAI key or Anthropic key's
 *  associated OpenAI key. */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const settings = await getSettings();

  // Use OpenAI API for embeddings (even if LLM provider is Anthropic)
  const apiKey = settings.openaiApiKey || settings.anthropicApiKey;
  if (!apiKey) {
    throw new Error("No API key available for embeddings. Configure an OpenAI API key in Settings.");
  }

  // If using Anthropic as LLM but no OpenAI key, we can't do embeddings
  if (settings.llmProvider === "anthropic" && !settings.openaiApiKey) {
    throw new Error(
      "Embeddings require an OpenAI API key. Add one in Settings (used only for embeddings).",
    );
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API error: ${response.status} ${err}`);
  }

  const data = await response.json();
  return data.data.map((item: { embedding: number[] }) => item.embedding);
}

/** Generate embedding for a single text. */
export async function generateEmbedding(text: string): Promise<number[]> {
  const [embedding] = await generateEmbeddings([text]);
  return embedding;
}

export { EMBEDDING_DIMENSIONS };
