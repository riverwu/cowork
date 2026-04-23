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

  // Enable WAL mode and set busy timeout first
  try { await conn.execute("PRAGMA journal_mode=WAL", []); } catch { /* ignore if unsupported */ }
  try { await conn.execute("PRAGMA busy_timeout=5000", []); } catch { /* ignore */ }

  // Run migrations sequentially on the single connection
  for (const sql of MIGRATIONS) {
    await conn.execute(sql, []);
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
