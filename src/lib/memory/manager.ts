import {
  getAllCoreFacts,
  getAllMemoriesWithEmbeddings,
  getAllEpisodesWithEmbeddings,
  touchMemory,
} from "@/lib/db";
import { generateEmbedding } from "@/lib/knowledge/embeddings";
import type { CoreFact } from "@/types";

interface MemoryContext {
  /** Core facts formatted for system prompt injection. */
  coreFacts: string;
  /** Relevant semantic memories found by similarity search. */
  relevantMemories: string;
  /** Relevant past episodes/reflections. */
  relevantEpisodes: string;
}

/**
 * Retrieve all relevant memory context for a given user query.
 * Called at the start of each agent execution.
 */
export async function retrieveMemoryContext(query: string): Promise<MemoryContext> {
  // 1. Core facts — always include all of them (small set)
  const facts = await getAllCoreFacts();
  const coreFacts = formatCoreFacts(facts);

  // 2. Semantic memories — vector similarity search
  let relevantMemories = "";
  let relevantEpisodes = "";

  try {
    const queryEmbedding = await generateEmbedding(query);

    // Search semantic memories
    const allMemories = await getAllMemoriesWithEmbeddings();
    if (allMemories.length > 0) {
      const scored = allMemories.map((m) => ({
        ...m,
        score: cosineSimilarity(queryEmbedding, m.embedding),
      }));
      const topMemories = scored
        .filter((m) => m.score > 0.3)
        .sort((a, b) => (b.score * b.importance) - (a.score * a.importance))
        .slice(0, 5);

      if (topMemories.length > 0) {
        // Touch accessed memories (update access count)
        for (const m of topMemories) {
          await touchMemory(m.id);
        }
        relevantMemories = formatMemories(topMemories);
      }
    }

    // Search episodic buffer
    const allEpisodes = await getAllEpisodesWithEmbeddings();
    if (allEpisodes.length > 0) {
      const scored = allEpisodes.map((e) => ({
        ...e,
        score: cosineSimilarity(queryEmbedding, e.embedding),
      }));
      const topEpisodes = scored
        .filter((e) => e.score > 0.3 && e.reflection)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      if (topEpisodes.length > 0) {
        relevantEpisodes = formatEpisodes(topEpisodes);
      }
    }
  } catch {
    // Embedding/search failed — continue without semantic memory
    // (happens when no embedding API key is configured)
  }

  return { coreFacts, relevantMemories, relevantEpisodes };
}

/**
 * Build the memory section for the system prompt.
 */
export function buildMemoryPrompt(ctx: MemoryContext): string {
  const sections: string[] = [];

  if (ctx.coreFacts) {
    sections.push(`## What you know about this user\n${ctx.coreFacts}`);
  }

  if (ctx.relevantMemories) {
    sections.push(`## Relevant memories from past interactions\n${ctx.relevantMemories}`);
  }

  if (ctx.relevantEpisodes) {
    sections.push(`## Lessons from past tasks\n${ctx.relevantEpisodes}`);
  }

  if (sections.length === 0) return "";

  return sections.join("\n\n");
}

// ---- Formatting helpers ----

function formatCoreFacts(facts: CoreFact[]): string {
  if (facts.length === 0) return "";

  const grouped: Record<string, string[]> = {};
  for (const f of facts) {
    const cat = f.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(`- ${f.key}: ${f.value}`);
  }

  return Object.entries(grouped)
    .map(([cat, items]) => `[${cat}]\n${items.join("\n")}`)
    .join("\n\n");
}

function formatMemories(memories: Array<{ content: string; memoryType: string; score: number }>): string {
  return memories
    .map((m) => `- [${m.memoryType}] ${m.content}`)
    .join("\n");
}

function formatEpisodes(episodes: Array<{ taskSummary: string; outcome: string; reflection: string | null; score: number }>): string {
  return episodes
    .map((e) => `- Task: "${e.taskSummary}" (${e.outcome})\n  Lesson: ${e.reflection}`)
    .join("\n");
}

// ---- Math ----

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
