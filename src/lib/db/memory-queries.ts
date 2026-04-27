import { getDb, newId, now } from "./client";
import type { CoreFact, Memory, MemoryType, Episode, EpisodeOutcome } from "@/types";

// ---- Core Facts ----

export async function getAllCoreFacts(): Promise<CoreFact[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    key: string; value: string; category: string; source: string; updated_at: number;
  }>>("SELECT * FROM core_facts ORDER BY category, key");
  return rows.map((r) => ({
    key: r.key,
    value: r.value,
    category: r.category as CoreFact["category"],
    source: r.source as CoreFact["source"],
    updatedAt: r.updated_at,
  }));
}

export async function upsertCoreFact(
  key: string,
  value: string,
  category: CoreFact["category"] = "general",
  source: CoreFact["source"] = "auto",
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO core_facts (key, value, category, source, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(key) DO UPDATE SET value = $2, category = $3, source = $4, updated_at = $5`,
    [key, value, category, source, now()],
  );
}

export async function deleteCoreFact(key: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM core_facts WHERE key = $1", [key]);
}

// ---- Semantic Memories ----

export async function createMemory(params: {
  content: string;
  memoryType: MemoryType;
  embedding?: number[];
  importance?: number;
  sessionId?: string;
}): Promise<Memory> {
  const db = await getDb();
  const id = newId();
  const createdAt = now();
  await db.execute(
    `INSERT INTO memories (id, content, memory_type, embedding, importance, session_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      params.content,
      params.memoryType,
      params.embedding ? JSON.stringify(params.embedding) : null,
      params.importance ?? 0.5,
      params.sessionId || null,
      createdAt,
    ],
  );
  return {
    id,
    content: params.content,
    memoryType: params.memoryType,
    embedding: params.embedding || null,
    importance: params.importance ?? 0.5,
    accessCount: 0,
    sessionId: params.sessionId || null,
    createdAt,
    lastAccessedAt: null,
  };
}

export async function getAllMemoriesWithEmbeddings(): Promise<
  Array<{ id: string; content: string; memoryType: MemoryType; embedding: number[]; importance: number }>
> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; content: string; memory_type: string; embedding: string; importance: number;
  }>>("SELECT id, content, memory_type, embedding, importance FROM memories WHERE embedding IS NOT NULL");
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    memoryType: r.memory_type as MemoryType,
    embedding: JSON.parse(r.embedding),
    importance: r.importance,
  }));
}

export async function touchMemory(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE memories SET access_count = access_count + 1, last_accessed_at = $1 WHERE id = $2",
    [now(), id],
  );
}

export async function getRecentMemories(limit = 10): Promise<Memory[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; content: string; memory_type: string; embedding: string | null;
    importance: number; access_count: number; session_id: string | null;
    created_at: number; last_accessed_at: number | null;
  }>>("SELECT * FROM memories ORDER BY created_at DESC LIMIT $1", [limit]);
  return rows.map(mapMemoryRow);
}

export async function deleteMemory(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM memories WHERE id = $1", [id]);
}

export async function updateMemoryImportance(id: string, importance: number): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE memories SET importance = $1 WHERE id = $2", [importance, id]);
}

function mapMemoryRow(r: {
  id: string; content: string; memory_type: string; embedding: string | null;
  importance: number; access_count: number; session_id: string | null;
  created_at: number; last_accessed_at: number | null;
}): Memory {
  return {
    id: r.id,
    content: r.content,
    memoryType: r.memory_type as MemoryType,
    embedding: r.embedding ? JSON.parse(r.embedding) : null,
    importance: r.importance,
    accessCount: r.access_count,
    sessionId: r.session_id,
    createdAt: r.created_at,
    lastAccessedAt: r.last_accessed_at,
  };
}

// ---- Episodic Buffer ----

export async function createEpisode(params: {
  sessionId?: string;
  taskSummary: string;
  outcome: EpisodeOutcome;
  reflection?: string;
  skillsUsed?: string[];
  embedding?: number[];
}): Promise<Episode> {
  const db = await getDb();
  const id = newId();
  const createdAt = now();
  await db.execute(
    `INSERT INTO episodes (id, session_id, task_summary, outcome, reflection, skills_used, embedding, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      params.sessionId || null,
      params.taskSummary,
      params.outcome,
      params.reflection || null,
      params.skillsUsed ? JSON.stringify(params.skillsUsed) : null,
      params.embedding ? JSON.stringify(params.embedding) : null,
      createdAt,
    ],
  );
  return {
    id,
    sessionId: params.sessionId || null,
    taskSummary: params.taskSummary,
    outcome: params.outcome,
    reflection: params.reflection || null,
    skillsUsed: params.skillsUsed || null,
    createdAt,
  };
}

export async function getRecentEpisodes(limit = 10): Promise<Episode[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; session_id: string | null; task_summary: string;
    outcome: string; reflection: string | null; skills_used: string | null; created_at: number;
  }>>("SELECT id, session_id, task_summary, outcome, reflection, skills_used, created_at FROM episodes ORDER BY created_at DESC LIMIT $1", [limit]);
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    taskSummary: r.task_summary,
    outcome: r.outcome as EpisodeOutcome,
    reflection: r.reflection,
    skillsUsed: r.skills_used ? JSON.parse(r.skills_used) : null,
    createdAt: r.created_at,
  }));
}

export async function getAllEpisodesWithEmbeddings(): Promise<
  Array<{ id: string; taskSummary: string; outcome: string; reflection: string | null; embedding: number[] }>
> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; task_summary: string; outcome: string; reflection: string | null; embedding: string;
  }>>("SELECT id, task_summary, outcome, reflection, embedding FROM episodes WHERE embedding IS NOT NULL");
  return rows.map((r) => ({
    id: r.id,
    taskSummary: r.task_summary,
    outcome: r.outcome,
    reflection: r.reflection,
    embedding: JSON.parse(r.embedding),
  }));
}

// ---- Full reset ----

/** Wipe all conversational + memory state: sessions, messages, artifacts,
 *  core facts, semantic memories, and episodes. Does NOT touch settings,
 *  knowledge sources/documents/chunks, apps, or runs. */
export async function resetAllConversationAndMemory(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM messages");
  await db.execute("DELETE FROM artifacts");
  await db.execute("DELETE FROM sessions");
  await db.execute("DELETE FROM core_facts");
  await db.execute("DELETE FROM memories");
  await db.execute("DELETE FROM episodes");
}
