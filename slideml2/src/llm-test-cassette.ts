import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tiny VCR-style cassette layer for LLM tests. The real fetch goes out only
 * when SLIDEML2_LLM_RECORD=1 (cassette miss writes a fresh entry); otherwise
 * cassettes/<key>.json is replayed deterministically. CI runs without keys
 * still cover the LLM path.
 */

export interface LlmCallSignature {
  baseURL: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  // Free-form tag to disambiguate identical prompts in different scenarios.
  tag?: string;
}

const HERE_DIR = dirname(fileURLToPath(import.meta.url));
const CASSETTE_ROOT = join(HERE_DIR, "..", "test", "llm-cassettes");

function cassetteKey(call: LlmCallSignature): string {
  const payload = JSON.stringify({
    baseURL: call.baseURL.replace(/\/$/, ""),
    model: call.model,
    system: call.system,
    user: call.user,
    maxTokens: call.maxTokens,
    tag: call.tag,
  });
  return createHash("sha1").update(payload).digest("hex").slice(0, 16);
}

function cassettePath(call: LlmCallSignature): string {
  const key = cassetteKey(call);
  const tag = (call.tag || "untagged").replace(/[^a-z0-9-]/gi, "_");
  return join(CASSETTE_ROOT, `${tag}.${key}.json`);
}

function isRecording(): boolean {
  return process.env.SLIDEML2_LLM_RECORD === "1";
}

export function shouldUseRealLlm(): boolean {
  if (!process.env.LLM_API || !process.env.LLM_API_KEY || !process.env.LLM_MODEL) return false;
  return process.env.RUN_SLIDEML2_REAL_LLM === "1" || isRecording();
}

export function readCassette(call: LlmCallSignature): string | null {
  const path = cassettePath(call);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { response?: string };
    return typeof parsed.response === "string" ? parsed.response : null;
  } catch {
    return null;
  }
}

export function writeCassette(call: LlmCallSignature, response: string): void {
  if (!isRecording()) return;
  const path = cassettePath(call);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({
    request: {
      baseURL: call.baseURL,
      model: call.model,
      system: call.system,
      user: call.user,
      maxTokens: call.maxTokens,
      tag: call.tag,
    },
    response,
  }, null, 2)}\n`);
}

/**
 * Resolve a call against the cassette + (optionally) the live LLM.
 * Order: cassette hit → live call (when recording or RUN_SLIDEML2_REAL_LLM=1) →
 * null. Cassette writes happen only in record mode.
 */
export async function resolveCassettedLlm(
  call: LlmCallSignature,
  invokeLive: () => Promise<string>,
): Promise<string | null> {
  const cached = readCassette(call);
  if (cached !== null && !isRecording()) return cached;
  if (!shouldUseRealLlm()) return cached;
  const live = await invokeLive();
  writeCassette(call, live);
  return live;
}
