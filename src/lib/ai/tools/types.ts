import type { ToolDefinition } from "@/lib/ai/providers/types";

/** Called during long-running tool execution to stream partial output. */
export type ProgressCallback = (output: string) => void;

/**
 * Per-tool policy for compressing a recorded result when it appears in
 * older-turn history. The agent runtime keeps the full result in
 * `metadata.steps[]` (storage-layer full fidelity) but inject-time
 * compression saves enormous token volume on assets / chart-bearing decks.
 *
 * Convention:
 *   - Return a SHORT string (≤ ~120 chars) capturing the essential
 *     "what happened" for downstream reasoning.
 *   - For successes: keep paths / counts / IDs (any noun the LLM might
 *     reference in a follow-up turn).
 *   - For failures: KEEP full error text — error context is never
 *     "noise"; the next turn often needs the precise message to fix.
 *   - When omitted, the runtime falls back to a generic 300-char trim.
 */
export type HistorySummarizer = (
  rawResult: string,
  status: "ok" | "fail",
) => string;

/** A Tool is a capability the agent can invoke via function calling. */
export interface Tool {
  /** Tool definition sent to the LLM. */
  definition: ToolDefinition;
  /** Execute the tool with the given input. Returns a string result for the LLM. */
  execute(input: Record<string, unknown>, onProgress?: ProgressCallback): Promise<string>;
  /**
   * Compress this tool's recorded result for older-turn history injection.
   * Live-turn results are formatted by the agent loop before they are sent
   * back to the LLM. Some task-scoped instruction reads, such as SKILL.md,
   * are intentionally kept in full for the current run; older-turn history
   * still uses this summarizer.
   */
  historySummarizer?: HistorySummarizer;
}
