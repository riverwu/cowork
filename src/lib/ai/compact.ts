import type { LLMMessage, LLMProvider } from "./providers/types";
import { estimateTokens } from "./context-budget";

/**
 * LLM-summary compaction — port of Codex CLI's compact.rs strategy.
 *
 * Codex references:
 *   - codex-rs/core/src/compact.rs — `run_inline_auto_compact_task`,
 *     `build_compacted_history`.
 *   - codex-rs/core/templates/compact/prompt.md (SUMMARIZATION_PROMPT)
 *   - codex-rs/core/templates/compact/summary_prefix.md (SUMMARY_PREFIX)
 *
 * Triggered when projected input tokens exceed the auto-compact threshold
 * (90% of the model's context window). Replaces the prior naive drop-oldest
 * behavior in agent.ts so the agent never silently loses early-conversation
 * context — the LLM summary preserves the salient bits.
 *
 * Strategy (mirrors Codex):
 *   1. Take a snapshot of the full conversation history.
 *   2. Append a synthetic user message with the SUMMARIZATION_PROMPT.
 *   3. Run the LLM (no tools) to produce a handoff summary of the work so far.
 *   4. Build new compacted history:
 *      - Verbatim copies of the last ~20K tokens of USER messages (so the
 *        next turn can still see what was actually asked, not just what the
 *        previous LLM thought it heard).
 *      - A final user message: SUMMARY_PREFIX + the LLM's summary.
 *   5. Caller swaps the new history into the agent loop.
 *
 * Why user messages and not full transcript? Tool results and assistant
 * monologue are recoverable from the summary; the user's original asks are
 * the source of truth — losing them risks the agent inventing its own goal.
 */

/** Codex SUMMARIZATION_PROMPT — verbatim from compact/prompt.md.  */
export const SUMMARIZATION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`;

/** Codex SUMMARY_PREFIX — verbatim from compact/summary_prefix.md.  */
export const SUMMARY_PREFIX =
  "Another language model started to solve this problem and produced a summary of its thinking process. " +
  "You also have access to the state of the tools that were used by that language model. " +
  "Use this to build on the work that has already been done and avoid duplicating work. " +
  "Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:";

/** Codex `COMPACT_USER_MESSAGE_MAX_TOKENS = 20_000`. */
const COMPACT_USER_MESSAGE_MAX_TOKENS = 20_000;

/** Sentinel prefix on the summary user-message so a subsequent compaction
 *  can detect and skip prior summaries (Codex's `is_summary_message`). */
export function isSummaryMessage(text: string): boolean {
  return text.startsWith(`${SUMMARY_PREFIX}\n`);
}

export interface CompactInput {
  /** Provider used to run the summary turn. Same provider as the main agent. */
  provider: LLMProvider;
  /** Full message history (will be summarized).  */
  messages: LLMMessage[];
  /** Token cap on output for the summary call.  */
  maxOutputTokens: number;
  /** Optional system prompt to bias the summarizer toward the project's
   *  domain (e.g. "you are summarizing a SlideML build agent's work"). */
  baseSystem?: string;
}

export interface CompactResult {
  /** Replacement history — preserved user messages + summary as final turn. */
  messages: LLMMessage[];
  /** The summary text the LLM produced (without the SUMMARY_PREFIX). */
  summary: string;
  /** Estimated token count of the new history (for telemetry / dump). */
  estimatedTokens: number;
}

/**
 * Run an inline compaction. Returns the replacement history.
 *
 * Mirrors Codex's `run_inline_auto_compact_task` minus the
 * analytics/remote-compaction fork. On any failure (network, provider
 * truncation, empty summary) returns null so the caller can fall back to
 * drop-oldest.
 */
export async function runInlineCompaction(input: CompactInput): Promise<CompactResult | null> {
  const { provider, messages, maxOutputTokens, baseSystem } = input;
  if (messages.length === 0) return null;

  // Strip prior tool_calls / tool_results from the snapshot we send to the
  // summarizer — many providers reject a tool_use without a matching
  // tool_result, and we don't need those blocks for summarization anyway.
  // Keep just the role + text content.
  const flatHistory: LLMMessage[] = messages
    .map((m) => {
      if (m.role === "tool") {
        // Re-encode tool results as assistant text so they survive the strip.
        return { role: "assistant" as const, content: `[prior tool result] ${m.content}` };
      }
      if (m.role === "assistant") return { role: "assistant" as const, content: m.content || "" };
      return { role: "user" as const, content: m.content };
    })
    .filter((m) => m.content);

  const compactionTurn: LLMMessage[] = [
    ...flatHistory,
    { role: "user", content: SUMMARIZATION_PROMPT },
  ];

  let summary = "";
  try {
    for await (const event of provider.stream({
      system: baseSystem || "You are a concise technical summarizer.",
      messages: compactionTurn,
      tools: [],
      maxOutputTokens,
    })) {
      if (event.type === "text-delta") summary += event.text;
      else if (event.type === "message-done") summary += event.content.slice(summary.length);
    }
  } catch (err) {
    console.warn("[Compact] Summarization LLM call failed:", err);
    return null;
  }

  summary = summary.trim();
  if (!summary) return null;

  // Preserve the last ~20K tokens of *user* messages verbatim. Walk
  // backwards (newest first) until budget exhausted, then reverse so we
  // emit them in chronological order.
  const userMessages = messages.filter((m) => m.role === "user").map((m) => m.content);
  const preserved: string[] = [];
  let remaining = COMPACT_USER_MESSAGE_MAX_TOKENS;
  for (let i = userMessages.length - 1; i >= 0; i--) {
    const msg = userMessages[i];
    if (isSummaryMessage(msg)) continue; // skip prior summary turns
    const tokens = estimateTokens(msg);
    if (tokens <= remaining) {
      preserved.push(msg);
      remaining -= tokens;
    } else {
      // Best-effort partial retention of the oldest preserved message.
      // We slice by characters proportional to the token budget.
      const ratio = remaining / Math.max(tokens, 1);
      const cutChars = Math.max(0, Math.floor(msg.length * ratio));
      if (cutChars > 0) preserved.push(msg.slice(msg.length - cutChars));
      break;
    }
  }
  preserved.reverse();

  const summaryMessage: LLMMessage = {
    role: "user",
    content: `${SUMMARY_PREFIX}\n${summary}`,
  };

  const newMessages: LLMMessage[] = [
    ...preserved.map((c): LLMMessage => ({ role: "user", content: c })),
    summaryMessage,
  ];

  let estimatedTokens = 0;
  for (const m of newMessages) estimatedTokens += estimateTokens(m.content);

  return { messages: newMessages, summary, estimatedTokens };
}
