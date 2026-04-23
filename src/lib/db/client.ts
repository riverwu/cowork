import Database from "@tauri-apps/plugin-sql";
import { MIGRATIONS } from "./schema";

let db: Database | null = null;
let initPromise: Promise<Database> | null = null;

/** Get the singleton database connection. */
export async function getDb(): Promise<Database> {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
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

  // Auto-populate settings from environment variables if not already set
  await populateDefaultsFromEnv(conn);
}

/** Read env vars via Tauri command and set defaults if settings are empty. */
async function populateDefaultsFromEnv(conn: Database): Promise<void> {
  try {
    const { getEnv } = await import("@/lib/tauri");

    // Check if settings already exist
    const existing = await conn.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key = 'llm_provider'", [],
    );
    if (existing.length > 0) return; // Settings already configured, don't overwrite

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

async function setDefault(conn: Database, key: string, value: string): Promise<void> {
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
