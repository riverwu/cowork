import Database from "@tauri-apps/plugin-sql";
import { MIGRATIONS } from "./schema";

let db: Database | null = null;
let initPromise: Promise<Database> | null = null;

/** Get the singleton database connection. Uses a single init promise to prevent race conditions. */
export async function getDb(): Promise<Database> {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const conn = await Database.load("sqlite:cowork.db");
    // Enable WAL mode for better concurrent access
    await conn.execute("PRAGMA journal_mode=WAL", []);
    await conn.execute("PRAGMA busy_timeout=5000", []);
    db = conn;
    return conn;
  })();

  return initPromise;
}

/** Run all migrations on startup. Idempotent (uses IF NOT EXISTS). */
export async function initDb(): Promise<void> {
  const conn = await getDb();

  // Run all migrations in a single transaction to avoid lock contention
  await conn.execute("BEGIN", []);
  try {
    for (const sql of MIGRATIONS) {
      await conn.execute(sql, []);
    }
    await conn.execute("COMMIT", []);
  } catch (err) {
    await conn.execute("ROLLBACK", []);
    throw err;
  }
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
