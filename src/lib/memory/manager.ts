import {
  getAllCoreFacts,
  getAllMemoriesWithEmbeddings,
  getAllEpisodesWithEmbeddings,
  touchMemory,
} from "@/lib/db";
import { generateEmbedding } from "@/lib/knowledge/embeddings";
import type { CoreFact, MemoryType } from "@/types";

interface MemoryContext {
  /** Core facts formatted for system prompt injection. */
  coreFacts: string;
  /** Relevant semantic memories found by similarity search. */
  relevantMemories: string;
  /** Relevant past episodes/reflections. */
  relevantEpisodes: string;
}

interface RetrieveMemoryOptions {
  includeCore?: boolean;
  includeSemantic?: boolean;
  includeEpisodes?: boolean;
  /**
   * Optional allow-list for core fact categories. Fresh task/session
   * assembly uses this to keep stable global preferences while excluding
   * task-specific project/entity context from prior work.
   */
  coreCategories?: CoreFact["category"][];
  /** Optional allow-list for vector memories when semantic retrieval is on. */
  memoryTypes?: MemoryType[];
}

/**
 * Retrieve all relevant memory context for a given user query.
 * Called at the start of each agent execution.
 */
export async function retrieveMemoryContext(query: string, options: RetrieveMemoryOptions = {}): Promise<MemoryContext> {
  const includeCore = options.includeCore !== false;
  const includeSemantic = options.includeSemantic !== false;
  const includeEpisodes = options.includeEpisodes !== false;

  // 1. Core facts — normally include all of them (small set). Fresh task
  // boundaries may opt out so task-specific memories cannot leak style or
  // artifact assumptions into the next run.
  const facts = includeCore
    ? filterCoreFacts(await getAllCoreFacts(), options.coreCategories)
    : [];
  const coreFacts = formatCoreFacts(facts);

  // 2. Semantic memories — vector similarity search
  let relevantMemories = "";
  let relevantEpisodes = "";

  try {
    if (!includeSemantic && !includeEpisodes) {
      return { coreFacts, relevantMemories, relevantEpisodes };
    }

    const queryEmbedding = await generateEmbedding(query);

    // Search semantic memories
    const allMemories = includeSemantic
      ? filterMemories(await getAllMemoriesWithEmbeddings(), options.memoryTypes)
      : [];
    if (includeSemantic && allMemories.length > 0) {
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
    const allEpisodes = includeEpisodes ? await getAllEpisodesWithEmbeddings() : [];
    if (includeEpisodes && allEpisodes.length > 0) {
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

function filterCoreFacts(facts: CoreFact[], categories?: CoreFact["category"][]): CoreFact[] {
  if (!categories || categories.length === 0) return facts;
  const allowed = new Set(categories);
  return facts.filter((fact) => allowed.has(fact.category));
}

function filterMemories<T extends { memoryType: string }>(memories: T[], memoryTypes?: MemoryType[]): T[] {
  if (!memoryTypes || memoryTypes.length === 0) return memories;
  const allowed = new Set<string>(memoryTypes);
  return memories.filter((memory) => allowed.has(memory.memoryType));
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
