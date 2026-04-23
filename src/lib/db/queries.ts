import { getDb, newId, now } from "./client";
import type {
  Settings,
  Source,
  Document,
  Session,
  Message,
  MessageRole,
  Artifact,
  ArtifactType,
  SkillRecord,
  SkillDefinition,
  SkillType,
  Run,
  RunStatus,
  RunStep,
} from "@/types";

// ---- Settings ----

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return rows.length > 0 ? rows[0].value : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
    [key, value],
  );
}

export async function getSettings(): Promise<Settings> {
  const provider = (await getSetting("llm_provider")) || "anthropic";
  const anthropicApiKey = (await getSetting("anthropic_api_key")) || undefined;
  const anthropicBaseUrl = (await getSetting("anthropic_base_url")) || undefined;
  const openaiApiKey = (await getSetting("openai_api_key")) || undefined;
  const openaiBaseUrl = (await getSetting("openai_base_url")) || undefined;
  const modelId = (await getSetting("model_id")) || undefined;
  return {
    llmProvider: provider as Settings["llmProvider"],
    anthropicApiKey,
    anthropicBaseUrl,
    openaiApiKey,
    openaiBaseUrl,
    modelId,
  };
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  if (settings.llmProvider !== undefined) await setSetting("llm_provider", settings.llmProvider);
  if (settings.anthropicApiKey !== undefined) await setSetting("anthropic_api_key", settings.anthropicApiKey);
  if (settings.anthropicBaseUrl !== undefined) await setSetting("anthropic_base_url", settings.anthropicBaseUrl);
  if (settings.openaiApiKey !== undefined) await setSetting("openai_api_key", settings.openaiApiKey);
  if (settings.openaiBaseUrl !== undefined) await setSetting("openai_base_url", settings.openaiBaseUrl);
  if (settings.modelId !== undefined) await setSetting("model_id", settings.modelId);
}

// ---- Sources ----

export async function createSource(params: {
  type: Source["type"];
  path: string | null;
  name: string;
}): Promise<Source> {
  const db = await getDb();
  const id = newId();
  const createdAt = now();
  await db.execute(
    "INSERT INTO sources (id, type, path, name, created_at) VALUES ($1, $2, $3, $4, $5)",
    [id, params.type, params.path, params.name, createdAt],
  );
  return { id, ...params, status: "active", privacy: "public", createdAt };
}

export async function listSources(): Promise<Source[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; type: string; path: string | null; name: string;
    status: string; privacy: string; created_at: number;
  }>>("SELECT * FROM sources ORDER BY created_at DESC");
  return rows.map((r) => ({
    id: r.id,
    type: r.type as Source["type"],
    path: r.path,
    name: r.name,
    status: r.status as Source["status"],
    privacy: r.privacy as Source["privacy"],
    createdAt: r.created_at,
  }));
}

export async function updateSourceStatus(id: string, status: Source["status"]): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE sources SET status = $1 WHERE id = $2", [status, id]);
}

// ---- Documents ----

export async function createDocument(params: {
  sourceId: string;
  filename: string;
  filePath: string | null;
  fileModifiedAt: number | null;
}): Promise<Document> {
  const db = await getDb();
  const id = newId();
  const createdAt = now();
  await db.execute(
    "INSERT INTO documents (id, source_id, filename, file_path, file_modified_at, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, params.sourceId, params.filename, params.filePath, params.fileModifiedAt, createdAt],
  );
  return {
    id,
    sourceId: params.sourceId,
    filename: params.filename,
    filePath: params.filePath,
    contentText: null,
    status: "pending",
    fileModifiedAt: params.fileModifiedAt,
    createdAt,
  };
}

export async function listDocuments(sourceId: string): Promise<Document[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; source_id: string; filename: string; file_path: string | null;
    content_text: string | null; status: string; file_modified_at: number | null; created_at: number;
  }>>("SELECT * FROM documents WHERE source_id = $1 ORDER BY filename", [sourceId]);
  return rows.map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    filename: r.filename,
    filePath: r.file_path,
    contentText: r.content_text,
    status: r.status as Document["status"],
    fileModifiedAt: r.file_modified_at,
    createdAt: r.created_at,
  }));
}

export async function updateDocumentContent(id: string, contentText: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE documents SET content_text = $1, status = 'indexed' WHERE id = $2",
    [contentText, id],
  );
}

export async function updateDocumentStatus(id: string, status: Document["status"]): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE documents SET status = $1 WHERE id = $2", [status, id]);
}

export async function countDocuments(sourceId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ cnt: number }[]>(
    "SELECT COUNT(*) as cnt FROM documents WHERE source_id = $1 AND status != 'excluded'",
    [sourceId],
  );
  return rows[0].cnt;
}

// ---- Chunks ----

export async function createChunk(params: {
  documentId: string;
  content: string;
  embedding: number[] | null;
  metadata: Record<string, unknown> | null;
}): Promise<void> {
  const db = await getDb();
  const id = newId();
  await db.execute(
    "INSERT INTO chunks (id, document_id, content, embedding, metadata, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      id,
      params.documentId,
      params.content,
      params.embedding ? JSON.stringify(params.embedding) : null,
      params.metadata ? JSON.stringify(params.metadata) : null,
      now(),
    ],
  );
}

export async function deleteChunksByDocument(documentId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM chunks WHERE document_id = $1", [documentId]);
}

export async function getAllChunksWithEmbeddings(): Promise<
  Array<{ id: string; documentId: string; content: string; embedding: number[]; metadata: Record<string, unknown> | null }>
> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; document_id: string; content: string; embedding: string; metadata: string | null;
  }>>("SELECT id, document_id, content, embedding, metadata FROM chunks WHERE embedding IS NOT NULL");
  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    content: r.content,
    embedding: JSON.parse(r.embedding),
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
  }));
}

// ---- Sessions ----

export async function createSession(title?: string): Promise<Session> {
  const db = await getDb();
  const id = newId();
  const createdAt = now();
  await db.execute(
    "INSERT INTO sessions (id, title, created_at) VALUES ($1, $2, $3)",
    [id, title || null, createdAt],
  );
  return { id, title: title || null, status: "active", createdAt };
}

export async function getSession(id: string): Promise<Session | null> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; title: string | null; status: string; created_at: number;
  }>>("SELECT * FROM sessions WHERE id = $1", [id]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, title: r.title, status: r.status as Session["status"], createdAt: r.created_at };
}

export async function updateSessionTitle(id: string, title: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE sessions SET title = $1 WHERE id = $2", [title, id]);
}

export async function listRecentSessions(limit = 20): Promise<Session[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; title: string | null; status: string; created_at: number;
  }>>("SELECT * FROM sessions ORDER BY created_at DESC LIMIT $1", [limit]);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status as Session["status"],
    createdAt: r.created_at,
  }));
}

// ---- Messages ----

export async function createMessage(params: {
  sessionId: string;
  role: MessageRole;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<Message> {
  const db = await getDb();
  const id = newId();
  const createdAt = now();
  await db.execute(
    "INSERT INTO messages (id, session_id, role, content, metadata, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, params.sessionId, params.role, params.content, params.metadata ? JSON.stringify(params.metadata) : null, createdAt],
  );
  return {
    id,
    sessionId: params.sessionId,
    role: params.role,
    content: params.content,
    metadata: params.metadata || null,
    createdAt,
  };
}

export async function listMessages(sessionId: string): Promise<Message[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; session_id: string; role: string; content: string; metadata: string | null; created_at: number;
  }>>("SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at", [sessionId]);
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    role: r.role as MessageRole,
    content: r.content,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    createdAt: r.created_at,
  }));
}

// ---- Artifacts ----

export async function createArtifact(params: {
  sessionId?: string;
  appId?: string;
  runId?: string;
  type: ArtifactType;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<Artifact> {
  const db = await getDb();
  const id = newId();
  const createdAt = now();
  await db.execute(
    "INSERT INTO artifacts (id, session_id, app_id, run_id, type, title, content, metadata, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      id,
      params.sessionId || null,
      params.appId || null,
      params.runId || null,
      params.type,
      params.title,
      params.content,
      params.metadata ? JSON.stringify(params.metadata) : null,
      createdAt,
    ],
  );
  return {
    id,
    sessionId: params.sessionId || null,
    appId: params.appId || null,
    runId: params.runId || null,
    type: params.type,
    title: params.title,
    content: params.content,
    metadata: params.metadata || null,
    createdAt,
  };
}

export async function listRecentArtifacts(limit = 20): Promise<Artifact[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; session_id: string | null; app_id: string | null; run_id: string | null;
    type: string; title: string; content: string; metadata: string | null; created_at: number;
  }>>("SELECT * FROM artifacts ORDER BY created_at DESC LIMIT $1", [limit]);
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    appId: r.app_id,
    runId: r.run_id,
    type: r.type as ArtifactType,
    title: r.title,
    content: r.content,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    createdAt: r.created_at,
  }));
}

// ---- Skills (unified: apps + tool-skills) ----

export async function createSkill(params: {
  name: string;
  type: SkillType;
  definition: SkillDefinition;
  config?: Record<string, string>;
}): Promise<SkillRecord> {
  const db = await getDb();
  const id = newId();
  const createdAt = now();
  await db.execute(
    "INSERT INTO apps (id, name, type, definition, config, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [id, params.name, params.type, JSON.stringify(params.definition), JSON.stringify(params.config || {}), createdAt, createdAt],
  );
  return {
    id, name: params.name, type: params.type, version: 1,
    definition: params.definition, config: params.config || {},
    status: "active", createdAt, updatedAt: createdAt,
  };
}

export async function listSkills(type?: SkillType): Promise<SkillRecord[]> {
  const db = await getDb();
  const query = type
    ? "SELECT * FROM apps WHERE status = 'active' AND type = $1 ORDER BY updated_at DESC"
    : "SELECT * FROM apps WHERE status = 'active' ORDER BY updated_at DESC";
  const params = type ? [type] : [];
  const rows = await db.select<Array<{
    id: string; name: string; type: string; version: number; definition: string;
    config: string; status: string; created_at: number; updated_at: number;
  }>>(query, params);
  return rows.map((r) => ({
    id: r.id, name: r.name, type: r.type as SkillType, version: r.version,
    definition: JSON.parse(r.definition), config: r.config ? JSON.parse(r.config) : {},
    status: r.status as SkillRecord["status"],
    createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

export async function updateSkillConfig(id: string, config: Record<string, string>): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE apps SET config = $1, updated_at = $2 WHERE id = $3", [JSON.stringify(config), now(), id]);
}

export async function deleteSkill(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE apps SET status = 'archived' WHERE id = $1", [id]);
}

/** @deprecated Use createSkill with type='app' */
export async function createApp(params: { name: string; definition: SkillDefinition }): Promise<SkillRecord> {
  return createSkill({ ...params, type: "app" });
}

/** @deprecated Use listSkills() */
export async function listApps(): Promise<SkillRecord[]> {
  return listSkills();
}

// ---- Runs ----

export async function createRun(params: {
  appId?: string;
  sessionId?: string;
  triggerType?: Run["triggerType"];
}): Promise<Run> {
  const db = await getDb();
  const id = newId();
  const startedAt = now();
  await db.execute(
    "INSERT INTO runs (id, app_id, session_id, status, trigger_type, started_at) VALUES ($1, $2, $3, 'running', $4, $5)",
    [id, params.appId || null, params.sessionId || null, params.triggerType || "manual", startedAt],
  );
  return {
    id,
    appId: params.appId || null,
    sessionId: params.sessionId || null,
    status: "running",
    steps: [],
    triggerType: params.triggerType || "manual",
    startedAt,
    completedAt: null,
  };
}

export async function updateRunStatus(id: string, status: RunStatus, steps?: RunStep[]): Promise<void> {
  const db = await getDb();
  const completedAt = status === "completed" || status === "failed" ? now() : null;
  await db.execute(
    "UPDATE runs SET status = $1, steps = $2, completed_at = $3 WHERE id = $4",
    [status, steps ? JSON.stringify(steps) : null, completedAt, id],
  );
}
