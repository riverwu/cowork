/** SQLite schema for Cowork. All tables created via migrations on app startup. */

export const MIGRATIONS = [
  // v1: Initial schema
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('local_folder', 'upload')),
    path TEXT,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'indexing', 'error')),
    privacy TEXT NOT NULL DEFAULT 'public' CHECK(privacy IN ('public', 'personal')),
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_path TEXT,
    content_text TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'indexed', 'excluded')),
    file_modified_at INTEGER,
    created_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status)`,

  `CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id)`,

  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    metadata TEXT,
    created_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    app_id TEXT,
    run_id TEXT,
    type TEXT NOT NULL CHECK(type IN ('report', 'table', 'email', 'action_list')),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    created_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id)`,

  `CREATE TABLE IF NOT EXISTS apps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'app' CHECK(type IN ('app', 'skill')),
    version INTEGER NOT NULL DEFAULT 1,
    definition TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    app_id TEXT REFERENCES apps(id),
    session_id TEXT REFERENCES sessions(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'needs_review')),
    steps TEXT,
    trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK(trigger_type IN ('manual', 'schedule', 'channel')),
    started_at INTEGER,
    completed_at INTEGER
  )`,

  `CREATE INDEX IF NOT EXISTS idx_runs_app ON runs(app_id)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id)`,

  // v2: Memory system

  // Core Facts — always loaded into system prompt
  `CREATE TABLE IF NOT EXISTS core_facts (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general' CHECK(category IN ('preference', 'context', 'entity', 'general')),
    source TEXT DEFAULT 'auto' CHECK(source IN ('auto', 'user', 'reflection')),
    updated_at INTEGER NOT NULL
  )`,

  // Semantic Memories — vector-searchable extracted insights
  `CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    memory_type TEXT NOT NULL CHECK(memory_type IN ('insight', 'preference', 'pattern', 'entity', 'correction')),
    embedding TEXT,
    importance REAL NOT NULL DEFAULT 0.5,
    access_count INTEGER NOT NULL DEFAULT 0,
    session_id TEXT,
    created_at INTEGER NOT NULL,
    last_accessed_at INTEGER
  )`,

  `CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC)`,

  // Episodic Buffer — task outcomes + reflections for learning
  `CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    task_summary TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK(outcome IN ('success', 'partial', 'failure', 'cancelled')),
    reflection TEXT,
    skills_used TEXT,
    embedding TEXT,
    created_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_episodes_outcome ON episodes(outcome)`,
  `CREATE INDEX IF NOT EXISTS idx_episodes_created ON episodes(created_at DESC)`,
];
