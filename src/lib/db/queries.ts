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
  SourceCapability,
  SourceEntity,
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
  const modelContextTokensRaw = await getSetting("model_context_tokens");
  const modelContextTokens = modelContextTokensRaw ? Number(modelContextTokensRaw) : undefined;
  const modelMaxOutputTokensRaw = await getSetting("model_max_output_tokens");
  const modelMaxOutputTokens = modelMaxOutputTokensRaw ? Number(modelMaxOutputTokensRaw) : undefined;
  const imageProvider = ((await getSetting("image_provider")) as Settings["imageProvider"]) || undefined;
  const imageApiKey = (await getSetting("image_api_key")) || undefined;
  const imageBaseUrl = (await getSetting("image_base_url")) || undefined;
  const imageModel = (await getSetting("image_model")) || undefined;
  const debugLogRaw = await getSetting("debug_log_enabled");
  const debugLogEnabled = debugLogRaw === "1" || debugLogRaw === "true";
  return {
    llmProvider: provider as Settings["llmProvider"],
    anthropicApiKey,
    anthropicBaseUrl,
    openaiApiKey,
    openaiBaseUrl,
    modelId,
    modelContextTokens: Number.isFinite(modelContextTokens) ? modelContextTokens : undefined,
    modelMaxOutputTokens: Number.isFinite(modelMaxOutputTokens) ? modelMaxOutputTokens : undefined,
    imageProvider,
    imageApiKey,
    imageBaseUrl,
    imageModel,
    debugLogEnabled,
  };
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  if (settings.llmProvider !== undefined) await setSetting("llm_provider", settings.llmProvider);
  if (settings.anthropicApiKey !== undefined) await setSetting("anthropic_api_key", settings.anthropicApiKey);
  if (settings.anthropicBaseUrl !== undefined) await setSetting("anthropic_base_url", settings.anthropicBaseUrl);
  if (settings.openaiApiKey !== undefined) await setSetting("openai_api_key", settings.openaiApiKey);
  if (settings.openaiBaseUrl !== undefined) await setSetting("openai_base_url", settings.openaiBaseUrl);
  if (settings.modelId !== undefined) await setSetting("model_id", settings.modelId);
  if (settings.modelContextTokens !== undefined) await setSetting("model_context_tokens", String(settings.modelContextTokens));
  if (settings.modelMaxOutputTokens !== undefined) await setSetting("model_max_output_tokens", String(settings.modelMaxOutputTokens));
  if (settings.imageProvider !== undefined) await setSetting("image_provider", settings.imageProvider);
  if (settings.imageApiKey !== undefined) await setSetting("image_api_key", settings.imageApiKey);
  if (settings.imageBaseUrl !== undefined) await setSetting("image_base_url", settings.imageBaseUrl);
  if (settings.imageModel !== undefined) await setSetting("image_model", settings.imageModel);
  if (settings.debugLogEnabled !== undefined) await setSetting("debug_log_enabled", settings.debugLogEnabled ? "1" : "0");
}

// ---- Sources ----

export async function createSource(params: {
  type: Source["type"];
  path: string | null;
  name: string;
  connectorId?: string | null;
  externalId?: string | null;
  syncPolicy?: Source["syncPolicy"];
  metadata?: Record<string, unknown> | null;
}): Promise<Source> {
  const db = await getDb();
  const id = newId();
  const createdAt = now();
  await db.execute(
    `INSERT INTO sources (
      id, type, path, name, connector_id, external_id, sync_policy, metadata, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      params.type,
      params.path,
      params.name,
      params.connectorId || null,
      params.externalId || null,
      params.syncPolicy || "manual",
      params.metadata ? JSON.stringify(params.metadata) : null,
      createdAt,
    ],
  );
  return {
    id,
    type: params.type,
    path: params.path,
    name: params.name,
    status: "active",
    privacy: "public",
    connectorId: params.connectorId || null,
    externalId: params.externalId || null,
    syncPolicy: params.syncPolicy || "manual",
    lastSyncedAt: null,
    metadata: params.metadata || null,
    createdAt,
  };
}

export async function listSources(): Promise<Source[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; type: string; path: string | null; name: string;
    status: string; privacy: string; connector_id?: string | null; external_id?: string | null;
    sync_policy?: string | null; last_synced_at?: number | null; metadata?: string | null; created_at: number;
  }>>("SELECT * FROM sources ORDER BY created_at DESC");
  return rows.map((r) => ({
    id: r.id,
    type: r.type as Source["type"],
    path: r.path,
    name: r.name,
    status: r.status as Source["status"],
    privacy: r.privacy as Source["privacy"],
    connectorId: r.connector_id ?? null,
    externalId: r.external_id ?? null,
    syncPolicy: (r.sync_policy || "manual") as Source["syncPolicy"],
    lastSyncedAt: r.last_synced_at ?? null,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    createdAt: r.created_at,
  }));
}

export async function updateSourceStatus(id: string, status: Source["status"]): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE sources SET status = $1 WHERE id = $2", [status, id]);
}

export async function deleteSource(id: string): Promise<void> {
  const db = await getDb();
  // Cascading deletes: documents → chunks
  await db.execute("DELETE FROM source_entities WHERE source_id = $1", [id]);
  await db.execute("DELETE FROM source_capabilities WHERE source_id = $1", [id]);
  await db.execute("DELETE FROM sync_jobs WHERE source_id = $1", [id]);
  await db.execute("DELETE FROM chunks WHERE document_id IN (SELECT id FROM documents WHERE source_id = $1)", [id]);
  await db.execute("DELETE FROM documents WHERE source_id = $1", [id]);
  await db.execute("DELETE FROM sources WHERE id = $1", [id]);
}

// ---- Source Catalog ----

export async function replaceSourceCapabilities(
  sourceId: string,
  capabilities: Array<{
    capabilityType: SourceCapability["capabilityType"];
    toolName?: string | null;
    description?: string | null;
    inputSchema?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  }>,
): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM source_capabilities WHERE source_id = $1", [sourceId]);
  for (const capability of capabilities) {
    await db.execute(
      `INSERT INTO source_capabilities (
        id, source_id, capability_type, tool_name, description, input_schema, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        newId(),
        sourceId,
        capability.capabilityType,
        capability.toolName || null,
        capability.description || null,
        capability.inputSchema ? JSON.stringify(capability.inputSchema) : null,
        capability.metadata ? JSON.stringify(capability.metadata) : null,
        now(),
      ],
    );
  }
}

export async function listSourceCapabilities(sourceId: string): Promise<SourceCapability[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; source_id: string; capability_type: string; tool_name: string | null;
    description: string | null; input_schema: string | null; metadata: string | null; created_at: number;
  }>>("SELECT * FROM source_capabilities WHERE source_id = $1 ORDER BY capability_type, tool_name", [sourceId]);
  return rows.map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    capabilityType: r.capability_type as SourceCapability["capabilityType"],
    toolName: r.tool_name,
    description: r.description,
    inputSchema: r.input_schema ? JSON.parse(r.input_schema) : null,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    createdAt: r.created_at,
  }));
}

export async function replaceSourceEntitiesByExternalPrefix(
  sourceId: string,
  externalIdPrefix: string,
  entities: Array<{
    entityType: string;
    name: string;
    externalId?: string | null;
    summary?: string | null;
    schema?: Record<string, unknown> | null;
    sample?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    updatedAt?: number | null;
  }>,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM source_entities WHERE source_id = $1 AND external_id LIKE $2",
    [sourceId, `${externalIdPrefix}%`],
  );
  for (const entity of entities) {
    await db.execute(
      `INSERT INTO source_entities (
        id, source_id, entity_type, name, external_id, summary, schema_json, sample_json, metadata, updated_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        newId(),
        sourceId,
        entity.entityType,
        entity.name,
        entity.externalId || null,
        entity.summary || null,
        entity.schema ? JSON.stringify(entity.schema) : null,
        entity.sample ? JSON.stringify(entity.sample) : null,
        entity.metadata ? JSON.stringify(entity.metadata) : null,
        entity.updatedAt ?? null,
        now(),
      ],
    );
  }
}

export async function listSourceEntities(sourceId: string, limit = 100): Promise<SourceEntity[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; source_id: string; entity_type: string; name: string; external_id: string | null;
    summary: string | null; schema_json: string | null; sample_json: string | null;
    metadata: string | null; updated_at: number | null; created_at: number;
  }>>(
    "SELECT * FROM source_entities WHERE source_id = $1 ORDER BY entity_type, updated_at DESC, name LIMIT $2",
    [sourceId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    entityType: r.entity_type,
    name: r.name,
    externalId: r.external_id,
    summary: r.summary,
    schema: r.schema_json ? JSON.parse(r.schema_json) : null,
    sample: r.sample_json ? JSON.parse(r.sample_json) : null,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
  }));
}

export interface KnowledgeStats {
  totalSources: number;
  totalDocuments: number;
  indexedDocuments: number;
  pendingDocuments: number;
  excludedDocuments: number;
  totalChunks: number;
  chunksWithEmbeddings: number;
}

export async function getKnowledgeStats(): Promise<KnowledgeStats> {
  const db = await getDb();
  const sources = await db.select<{ cnt: number }[]>("SELECT COUNT(*) as cnt FROM sources");
  const docs = await db.select<{ cnt: number }[]>("SELECT COUNT(*) as cnt FROM documents");
  const indexed = await db.select<{ cnt: number }[]>("SELECT COUNT(*) as cnt FROM documents WHERE status = 'indexed'");
  const pending = await db.select<{ cnt: number }[]>("SELECT COUNT(*) as cnt FROM documents WHERE status = 'pending'");
  const excluded = await db.select<{ cnt: number }[]>("SELECT COUNT(*) as cnt FROM documents WHERE status = 'excluded'");

  return {
    totalSources: sources[0]?.cnt || 0,
    totalDocuments: docs[0]?.cnt || 0,
    indexedDocuments: indexed[0]?.cnt || 0,
    pendingDocuments: pending[0]?.cnt || 0,
    excludedDocuments: excluded[0]?.cnt || 0,
    totalChunks: 0,
    chunksWithEmbeddings: 0,
  };
}

// ---- Documents ----

export async function createDocument(params: {
  sourceId: string;
  filename: string;
  filePath: string | null;
  fileModifiedAt: number | null;
  size?: number | null;
  contentHash?: string | null;
}): Promise<Document> {
  const db = await getDb();
  const createdAt = now();
  let id = newId();
  if (params.filePath) {
    const existing = await db.select<Array<{ id: string }>>(
      "SELECT id FROM documents WHERE source_id = $1 AND file_path = $2 LIMIT 1",
      [params.sourceId, params.filePath],
    );
    if (existing[0]?.id) {
      id = existing[0].id;
      await db.execute(
        `UPDATE documents SET
          filename = $1,
          file_modified_at = $2,
          size = $3,
          content_hash = $4,
          status = CASE WHEN status = 'excluded' THEN 'excluded' ELSE 'pending' END,
          embedding_status = CASE WHEN status = 'excluded' THEN embedding_status ELSE 'pending' END,
          error_message = NULL
        WHERE id = $5`,
        [params.filename, params.fileModifiedAt, params.size ?? null, params.contentHash ?? null, id],
      );
      return getDocumentById(id);
    }
  }

  await db.execute(
    `INSERT INTO documents (
      id, source_id, filename, file_path, file_modified_at, size, content_hash, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, params.sourceId, params.filename, params.filePath, params.fileModifiedAt, params.size ?? null, params.contentHash ?? null, createdAt],
  );
  return {
    id,
    sourceId: params.sourceId,
    filename: params.filename,
    filePath: params.filePath,
    contentText: null,
    status: "pending",
    embeddingStatus: "pending",
    contentHash: params.contentHash ?? null,
    size: params.size ?? null,
    errorMessage: null,
    lastIndexedAt: null,
    fileModifiedAt: params.fileModifiedAt,
    createdAt,
  };
}

export async function getDocumentBySourcePath(sourceId: string, filePath: string): Promise<Document | null> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; source_id: string; filename: string; file_path: string | null;
    content_text: string | null; status: string; embedding_status?: string | null;
    content_hash?: string | null; size?: number | null; error_message?: string | null;
    last_indexed_at?: number | null; file_modified_at: number | null; created_at: number;
  }>>("SELECT * FROM documents WHERE source_id = $1 AND file_path = $2 LIMIT 1", [sourceId, filePath]);
  return rows[0] ? mapDocumentRow(rows[0]) : null;
}

export async function listSearchableDocuments(): Promise<Array<Document & {
  sourceName: string;
  sourcePath: string | null;
  entitySummary: string | null;
  extractedTextPath: string | null;
}>> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; source_id: string; filename: string; file_path: string | null;
    content_text: string | null; status: string; embedding_status?: string | null;
    content_hash?: string | null; size?: number | null; error_message?: string | null;
    last_indexed_at?: number | null; file_modified_at: number | null; created_at: number;
    source_name: string; source_path: string | null; entity_summary: string | null; document_metadata: string | null;
  }>>(
    `SELECT
       d.id, d.source_id, d.filename, d.file_path, NULL AS content_text,
       d.status, d.embedding_status, d.content_hash, d.size, d.error_message,
       d.last_indexed_at, d.file_modified_at, d.created_at,
       s.name AS source_name,
       s.path AS source_path,
       GROUP_CONCAT(COALESCE(e.name, '') || ' ' || COALESCE(e.summary, ''), '\n') AS entity_summary,
       MAX(CASE WHEN e.external_id = d.id || ':document' THEN e.metadata ELSE NULL END) AS document_metadata
     FROM documents d
     JOIN sources s ON s.id = d.source_id
     LEFT JOIN source_entities e ON e.source_id = d.source_id AND e.external_id LIKE d.id || ':%'
     WHERE d.status = 'indexed'
       AND s.status IN ('active', 'indexing')
     GROUP BY d.id
     ORDER BY d.last_indexed_at DESC, d.filename`,
  );
  return rows.map((r) => ({
    ...mapDocumentRow(r),
    sourceName: r.source_name,
    sourcePath: r.source_path,
    entitySummary: r.entity_summary,
    extractedTextPath: extractTextPathFromMetadata(r.document_metadata),
  }));
}

async function getDocumentById(id: string): Promise<Document> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; source_id: string; filename: string; file_path: string | null;
    content_text: string | null; status: string; embedding_status?: string | null;
    content_hash?: string | null; size?: number | null; error_message?: string | null;
    last_indexed_at?: number | null; file_modified_at: number | null; created_at: number;
  }>>("SELECT * FROM documents WHERE id = $1", [id]);
  if (!rows[0]) throw new Error(`Document not found: ${id}`);
  return mapDocumentRow(rows[0]);
}

export async function listDocuments(sourceId: string): Promise<Document[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string; source_id: string; filename: string; file_path: string | null;
    content_text: string | null; status: string; embedding_status?: string | null;
    content_hash?: string | null; size?: number | null; error_message?: string | null;
    last_indexed_at?: number | null; file_modified_at: number | null; created_at: number;
  }>>("SELECT * FROM documents WHERE source_id = $1 ORDER BY filename", [sourceId]);
  return rows.map(mapDocumentRow);
}

function mapDocumentRow(r: {
  id: string; source_id: string; filename: string; file_path: string | null;
  content_text: string | null; status: string; embedding_status?: string | null;
  content_hash?: string | null; size?: number | null; error_message?: string | null;
  last_indexed_at?: number | null; file_modified_at: number | null; created_at: number;
}): Document {
  return {
    id: r.id,
    sourceId: r.source_id,
    filename: r.filename,
    filePath: r.file_path,
    contentText: r.content_text,
    status: r.status as Document["status"],
    embeddingStatus: (r.embedding_status || "pending") as Document["embeddingStatus"],
    contentHash: r.content_hash ?? null,
    size: r.size ?? null,
    errorMessage: r.error_message ?? null,
    lastIndexedAt: r.last_indexed_at ?? null,
    fileModifiedAt: r.file_modified_at,
    createdAt: r.created_at,
  };
}

function extractTextPathFromMetadata(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { extractedTextPath?: unknown };
    return typeof parsed.extractedTextPath === "string" ? parsed.extractedTextPath : null;
  } catch {
    return null;
  }
}

export async function updateDocumentContent(
  id: string,
  _contentText: string,
  embeddingStatus: NonNullable<Document["embeddingStatus"]> = "pending",
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE documents SET content_text = NULL, status = 'indexed', embedding_status = $1, error_message = NULL, last_indexed_at = $2 WHERE id = $3",
    [embeddingStatus, now(), id],
  );
}

export async function updateDocumentIndexFailure(id: string, error: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE documents SET status = 'error', embedding_status = 'failed', error_message = $1, last_indexed_at = $2 WHERE id = $3",
    [error, now(), id],
  );
}

export async function updateDocumentIndexWarning(id: string, warning: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE documents SET error_message = $1, last_indexed_at = $2 WHERE id = $3",
    [warning, now(), id],
  );
}

export async function updateDocumentEmbeddingStatus(
  id: string,
  embeddingStatus: NonNullable<Document["embeddingStatus"]>,
): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE documents SET embedding_status = $1, last_indexed_at = $2 WHERE id = $3", [embeddingStatus, now(), id]);
}

export async function updateDocumentStatus(id: string, status: Document["status"]): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE documents SET status = $1 WHERE id = $2", [status, id]);
}

export async function countDocuments(sourceId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ cnt: number }[]>(
    "SELECT COUNT(*) as cnt FROM documents WHERE source_id = $1 AND status NOT IN ('excluded', 'deleted')",
    [sourceId],
  );
  return rows[0].cnt;
}

export async function deleteDocumentsMissingFromPaths(sourceId: string, paths: string[]): Promise<Document[]> {
  const db = await getDb();
  const missingWhere = paths.length === 0
    ? "source_id = $1 AND status != 'excluded'"
    : `source_id = $1 AND file_path IS NOT NULL AND file_path NOT IN (${paths.map((_, i) => `$${i + 2}`).join(", ")}) AND status != 'excluded'`;
  const missingParams = [sourceId, ...paths];
  const rows = await db.select<Array<{
    id: string; source_id: string; filename: string; file_path: string | null;
    content_text: string | null; status: string; embedding_status?: string | null;
    content_hash?: string | null; size?: number | null; error_message?: string | null;
    last_indexed_at?: number | null; file_modified_at: number | null; created_at: number;
  }>>(`SELECT * FROM documents WHERE ${missingWhere}`, missingParams);

  if (paths.length === 0) {
    await db.execute("UPDATE documents SET status = 'deleted' WHERE source_id = $1 AND status != 'excluded'", [sourceId]);
    return rows.map(mapDocumentRow);
  }
  const placeholders = paths.map((_, i) => `$${i + 2}`).join(", ");
  await db.execute(
    `UPDATE documents SET status = 'deleted' WHERE source_id = $1 AND file_path IS NOT NULL AND file_path NOT IN (${placeholders}) AND status != 'excluded'`,
    [sourceId, ...paths],
  );
  return rows.map(mapDocumentRow);
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
  }>>(
    `SELECT c.id, c.document_id, c.content, c.embedding, c.metadata
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     JOIN sources s ON s.id = d.source_id
     WHERE c.embedding IS NOT NULL
       AND d.status = 'indexed'
       AND d.embedding_status IN ('embedded', 'partial')
       AND s.status = 'active'`,
  );
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
  }>>("SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at, rowid", [sessionId]);
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

// ---- MCP Env Config ----

export async function getMcpEnvConfig(mcpId: string): Promise<Record<string, string>> {
  const db = await getDb();
  const prefix = `mcp_env_${mcpId}_`;
  const rows = await db.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM settings WHERE key LIKE $1",
    [`${prefix}%`],
  );
  const env: Record<string, string> = {};
  for (const row of rows) {
    env[row.key.slice(prefix.length)] = row.value;
  }
  return env;
}

export async function setMcpEnvVar(mcpId: string, varName: string, value: string): Promise<void> {
  await setSetting(`mcp_env_${mcpId}_${varName}`, value);
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
