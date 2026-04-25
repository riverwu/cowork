import Database from "@tauri-apps/plugin-sql";
import { MIGRATIONS } from "./schema";
import { invokeDesktop, isDesktopRuntime, isElectronRuntime } from "@/lib/tauri";

type DbConnection = {
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
};

let db: DbConnection | null = null;
let initPromise: Promise<DbConnection> | null = null;

/** Get the singleton database connection. */
export async function getDb(): Promise<DbConnection> {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!isDesktopRuntime()) {
      throw new Error(
        "Cowork must run inside the desktop app. Start it with `pnpm electron:dev` or `pnpm tauri dev`; opening the Vite URL in a browser cannot access the local database.",
      );
    }
    if (isElectronRuntime()) {
      const conn: DbConnection = {
        execute: (sql: string, params?: unknown[]) => invokeDesktop<void>("db_execute", { sql, params: params || [] }),
        select: <T>(sql: string, params?: unknown[]) => invokeDesktop<T>("db_select", { sql, params: params || [] }),
      };
      db = conn;
      return conn;
    }
    const conn = await Database.load("sqlite:cowork.db");
    db = conn;
    return conn;
  })();

  return initPromise;
}

/** Run all migrations on startup. Idempotent (uses IF NOT EXISTS). */
export async function initDb(): Promise<void> {
  const conn = await getDb();

  // Enable WAL mode and set busy timeout
  try { await conn.execute("PRAGMA journal_mode=WAL", []); } catch { /* ignore */ }
  try { await conn.execute("PRAGMA busy_timeout=5000", []); } catch { /* ignore */ }

  // Run migrations
  for (const sql of MIGRATIONS) {
    await conn.execute(sql, []);
  }
  await ensureKnowledgeSchema(conn);

  // Auto-populate settings from environment variables if not already set
  await populateDefaultsFromEnv(conn);
}

async function ensureKnowledgeSchema(conn: DbConnection): Promise<void> {
  const rebuiltSources = await ensureSourcesSchema(conn);
  if (rebuiltSources) {
    await rebuildCatalogTables(conn);
  }
  await ensureDocumentsSchema(conn, rebuiltSources);
  await ensureColumn(conn, "sources", "connector_id", "TEXT");
  await ensureColumn(conn, "sources", "external_id", "TEXT");
  await ensureColumn(conn, "sources", "sync_policy", "TEXT NOT NULL DEFAULT 'manual'");
  await ensureColumn(conn, "sources", "last_synced_at", "INTEGER");
  await ensureColumn(conn, "sources", "metadata", "TEXT");
  await ensureColumn(conn, "documents", "embedding_status", "TEXT NOT NULL DEFAULT 'pending'");
  await ensureColumn(conn, "documents", "content_hash", "TEXT");
  await ensureColumn(conn, "documents", "size", "INTEGER");
  await ensureColumn(conn, "documents", "error_message", "TEXT");
  await ensureColumn(conn, "documents", "last_indexed_at", "INTEGER");
  await conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_source_path ON documents(source_id, file_path) WHERE file_path IS NOT NULL", []);
  await purgeKnowledgePayloadsFromDb(conn);
}

async function rebuildCatalogTables(conn: DbConnection): Promise<void> {
  await conn.execute("DROP TABLE IF EXISTS source_capabilities", []);
  await conn.execute("DROP TABLE IF EXISTS source_entities", []);
  await conn.execute("DROP TABLE IF EXISTS sync_jobs", []);
  await conn.execute(
    `CREATE TABLE source_capabilities (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      capability_type TEXT NOT NULL CHECK(capability_type IN ('search', 'read', 'query', 'analyze', 'sync', 'write')),
      tool_name TEXT,
      description TEXT,
      input_schema TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )`,
    [],
  );
  await conn.execute("CREATE INDEX IF NOT EXISTS idx_source_capabilities_source ON source_capabilities(source_id)", []);
  await conn.execute(
    `CREATE TABLE source_entities (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      name TEXT NOT NULL,
      external_id TEXT,
      summary TEXT,
      schema_json TEXT,
      sample_json TEXT,
      metadata TEXT,
      updated_at INTEGER,
      created_at INTEGER NOT NULL
    )`,
    [],
  );
  await conn.execute("CREATE INDEX IF NOT EXISTS idx_source_entities_source ON source_entities(source_id)", []);
  await conn.execute("CREATE INDEX IF NOT EXISTS idx_source_entities_type ON source_entities(entity_type)", []);
  await conn.execute(
    `CREATE TABLE sync_jobs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed')),
      started_at INTEGER,
      completed_at INTEGER,
      error TEXT,
      stats TEXT
    )`,
    [],
  );
  await conn.execute("CREATE INDEX IF NOT EXISTS idx_sync_jobs_source ON sync_jobs(source_id, started_at DESC)", []);
}

async function ensureSourcesSchema(conn: DbConnection): Promise<boolean> {
  const rows = await conn.select<Array<{ sql: string | null }>>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sources'",
    [],
  );
  const sql = rows[0]?.sql || "";
  if (sql.includes("'confluence'")) return false;

  await conn.execute("PRAGMA foreign_keys=OFF", []);
  try {
    await conn.execute("ALTER TABLE sources RENAME TO sources_old", []);
    await conn.execute(
      `CREATE TABLE sources (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('local_folder', 'upload', 'confluence', 'erp', 'crm', 'im', 'mcp', 'database', 'api')),
        path TEXT,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'indexing', 'error')),
        privacy TEXT NOT NULL DEFAULT 'public' CHECK(privacy IN ('public', 'personal')),
        connector_id TEXT,
        external_id TEXT,
        sync_policy TEXT NOT NULL DEFAULT 'manual' CHECK(sync_policy IN ('manual', 'periodic', 'realtime')),
        last_synced_at INTEGER,
        metadata TEXT,
        created_at INTEGER NOT NULL
      )`,
      [],
    );
    await conn.execute(
      `INSERT INTO sources (id, type, path, name, status, privacy, created_at)
       SELECT id, type, path, name, status, privacy, created_at FROM sources_old`,
      [],
    );
    await conn.execute("DROP TABLE sources_old", []);
  } finally {
    await conn.execute("PRAGMA foreign_keys=ON", []);
  }
  return true;
}

async function ensureDocumentsSchema(conn: DbConnection, forceRebuild = false): Promise<void> {
  const rows = await conn.select<Array<{ sql: string | null }>>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'documents'",
    [],
  );
  const sql = rows[0]?.sql || "";
  if (!forceRebuild && sql.includes("'deleted'") && sql.includes("embedding_status")) return;

  await conn.execute("PRAGMA foreign_keys=OFF", []);
  try {
    await conn.execute("ALTER TABLE documents RENAME TO documents_old", []);
    await conn.execute(
      `CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        file_path TEXT,
        content_text TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'indexed', 'excluded', 'error', 'deleted')),
        embedding_status TEXT NOT NULL DEFAULT 'pending' CHECK(embedding_status IN ('pending', 'embedded', 'partial', 'failed', 'none')),
        content_hash TEXT,
        size INTEGER,
        error_message TEXT,
        last_indexed_at INTEGER,
        file_modified_at INTEGER,
        created_at INTEGER NOT NULL
      )`,
      [],
    );
    await conn.execute(
      `INSERT INTO documents (
        id, source_id, filename, file_path, content_text, status, embedding_status,
        file_modified_at, created_at
      )
       SELECT id, source_id, filename, file_path, content_text, status,
        CASE WHEN status = 'indexed' THEN 'embedded' ELSE 'pending' END,
        file_modified_at, created_at
       FROM documents_old`,
      [],
    );
    await conn.execute("DROP TABLE documents_old", []);
    await rebuildChunksTable(conn);
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source_id)", []);
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status)", []);
  } finally {
    await conn.execute("PRAGMA foreign_keys=ON", []);
  }
}

async function rebuildChunksTable(conn: DbConnection): Promise<void> {
  const rows = await conn.select<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chunks'",
    [],
  );
  if (!rows[0]) return;
  await conn.execute("ALTER TABLE chunks RENAME TO chunks_old", []);
  await conn.execute(
    `CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      embedding TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )`,
    [],
  );
  await conn.execute(
    `INSERT INTO chunks (id, document_id, content, embedding, metadata, created_at)
     SELECT id, document_id, content, embedding, metadata, created_at FROM chunks_old`,
    [],
  );
  await conn.execute("DROP TABLE chunks_old", []);
  await conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id)", []);
}

async function ensureColumn(conn: DbConnection, table: string, column: string, definition: string): Promise<void> {
  const cols = await conn.select<Array<{ name: string }>>(`PRAGMA table_info(${table})`, []);
  if (cols.some((c) => c.name === column)) return;
  await conn.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, []);
}

async function purgeKnowledgePayloadsFromDb(conn: DbConnection): Promise<void> {
  await conn.execute("UPDATE documents SET content_text = NULL WHERE content_text IS NOT NULL", []);
  await conn.execute("DELETE FROM chunks", []);
}

/** Read env vars via Tauri command and set defaults if settings are empty. */
async function populateDefaultsFromEnv(conn: DbConnection): Promise<void> {
  try {
    const { getEnv } = await import("@/lib/tauri");

    // Check if settings already exist
    const existing = await conn.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key = 'llm_provider'", [],
    );
    if (existing.length > 0) return; // Settings already configured, don't overwrite

    // Check for generic Anthropic-compatible env vars
    const llmApi = await getEnv("LLM_API");
    const llmKey = await getEnv("LLM_API_KEY");
    const llmModel = await getEnv("LLM_MODEL");

    if (llmApi && llmKey) {
      await setDefault(conn, "llm_provider", "anthropic");
      await setDefault(conn, "anthropic_api_key", llmKey);
      await setDefault(conn, "anthropic_base_url", llmApi);
      if (llmModel) await setDefault(conn, "model_id", llmModel);
      return;
    }

    // Check for MINIMAX env vars
    const minimaxApi = await getEnv("MINIMAX_API");
    const minimaxKey = await getEnv("MINIMAX_API_KEY");

    if (minimaxApi && minimaxKey) {
      await setDefault(conn, "llm_provider", "anthropic");
      await setDefault(conn, "anthropic_api_key", minimaxKey);
      await setDefault(conn, "anthropic_base_url", minimaxApi);
      await setDefault(conn, "model_id", "MiniMax-M2.7-highspeed");
      return;
    }

    // Check for standard env vars
    const anthropicKey = await getEnv("ANTHROPIC_API_KEY");
    if (anthropicKey) {
      await setDefault(conn, "llm_provider", "anthropic");
      await setDefault(conn, "anthropic_api_key", anthropicKey);
      const anthropicBase = await getEnv("ANTHROPIC_BASE_URL");
      if (anthropicBase) await setDefault(conn, "anthropic_base_url", anthropicBase);
      return;
    }

    const openaiKey = await getEnv("OPENAI_API_KEY");
    if (openaiKey) {
      await setDefault(conn, "llm_provider", "openai");
      await setDefault(conn, "openai_api_key", openaiKey);
      const openaiBase = await getEnv("OPENAI_BASE_URL");
      if (openaiBase) await setDefault(conn, "openai_base_url", openaiBase);
    }
  } catch {
    // Env var reading failed — not critical, user can configure manually
  }
}

async function setDefault(conn: DbConnection, key: string, value: string): Promise<void> {
  await conn.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO NOTHING",
    [key, value],
  );
}

/** Generate a random ID (nanoid-style, 21 chars). */
export function newId(): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(21));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** Current unix timestamp in seconds. */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}
