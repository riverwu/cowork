import Database from "@tauri-apps/plugin-sql";
import { MIGRATIONS } from "./schema";

let db: Database | null = null;

/** Get the singleton database connection. */
export async function getDb(): Promise<Database> {
  if (db) return db;
  db = await Database.load("sqlite:cowork.db");
  return db;
}

/** Run all migrations on startup. Idempotent (uses IF NOT EXISTS). */
export async function initDb(): Promise<void> {
  const conn = await getDb();
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
