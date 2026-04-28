import type { LLMMessage, ToolDefinition } from "./providers/types";

/**
 * Context-budget strategy adapted from OpenAI Codex CLI.
 *
 * Codex references:
 *   - codex-rs/protocol/src/openai_models.rs — `effective_context_window_percent`
 *     (default 95) and `auto_compact_token_limit = context_window * 9/10`.
 *   - codex-rs/utils/string/src/truncate.rs — `APPROX_BYTES_PER_TOKEN = 4`.
 *   - codex-rs/core/src/context_manager/history.rs — pre-send estimation, drop
 *     oldest items when summary still overflows.
 *
 * The strategy here mirrors Codex's percentage layout:
 *   - input_budget        = context_window * 95% - max_output_tokens
 *   - auto_compact_limit  = context_window * 90%   (when crossed, drop knowledge → memory → oldest history)
 * Future work: LLM-based summary compaction (Codex `compact.rs`).
 */

/**
 * Token estimation calibration.
 *
 * Codex uses a single `APPROX_BYTES_PER_TOKEN = 4` for everything because
 * its corpus is English-coding. That ratio matches BPE tokenizers
 * (`cl100k_base`, Anthropic's tokenizer) for ASCII content (≈4 chars/token).
 *
 * It under-estimates badly for CJK: a Chinese character is 3 UTF-8 bytes but
 * 2–3 BPE tokens. `bytes / 4` would estimate `经营分析` (12 bytes) at 3
 * tokens; the true tokenizer count is ~8. For a Chinese knowledge-worker
 * audience that's a 60% under-estimate — the agent thinks the request fits,
 * the provider silently truncates tools, the model can no longer call them.
 *
 * Mixed-content estimator: count ASCII and non-ASCII bytes separately.
 *   - ASCII bytes / 4   (English / code in BPE: ~4 chars/token)
 *   - Non-ASCII bytes / 2 (CJK: 3 bytes/char ≈ 1.5 tokens/byte; this also
 *     over-estimates Cyrillic / Greek / Arabic slightly, which is fine —
 *     we'd rather leave headroom than overshoot the model's window).
 */
const ASCII_BYTES_PER_TOKEN = 4;
const NON_ASCII_BYTES_PER_TOKEN = 2;

/** Fallback when the model id isn't in the registry. */
export const DEFAULT_CONTEXT_TOKENS = 200_000;

/** Reserved for the assistant's reply. Kept modest so tool definitions and
 *  history have room. Codex doesn't set this explicitly; we expose it because
 *  not every provider streams indefinitely without a cap. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;

/** Codex: `effective_context_window_percent = 95` (5% reserve for tokenizer
 *  slack, output overhead, server-side wrapping). */
const EFFECTIVE_CONTEXT_PERCENT = 95;

/**
 * Registry of model id prefix → context window in tokens. First matching
 * prefix wins. Keep prefixes specific-first so e.g. `gpt-4o-mini` matches
 * before `gpt-4`.
 */
const MODEL_CONTEXT_REGISTRY: Array<[string, number]> = [
  // Claude 4 family — 200K
  ["claude-opus-4", 200_000],
  ["claude-sonnet-4", 200_000],
  ["claude-haiku-4", 200_000],
  // Claude 3.5/3.7 — 200K
  ["claude-3-7", 200_000],
  ["claude-3-5", 200_000],
  ["claude-3", 200_000],
  // OpenAI
  ["gpt-4o-mini", 128_000],
  ["gpt-4o", 128_000],
  ["gpt-4-turbo", 128_000],
  ["gpt-4.1", 1_000_000],
  ["gpt-4", 8_192],
  ["o1", 200_000],
  ["o3", 200_000],
  ["o4", 200_000],
  // MiniMax. M1 was 1M but M2 / M2.7 reverted to 200K (server-side).
  // ORDER MATTERS — longest prefix first so M2/M2.7 don't fall into M1.
  ["minimax-m1", 1_000_000],
  ["minimax-m2.7", 200_000],
  ["minimax-m2", 200_000],
  ["minimax-m", 200_000],
  ["minimax-text", 245_760],
  ["minimax", 200_000],
  ["abab", 245_760],
  // Doubao
  ["doubao-pro-256k", 256_000],
  ["doubao-1-5-pro", 256_000],
  ["doubao-pro-128k", 128_000],
  ["doubao-pro-32k", 32_000],
  ["doubao-lite-32k", 32_000],
  ["doubao", 32_000],
  // Qwen
  ["qwen3", 128_000],
  ["qwen2.5", 128_000],
  ["qwen-max", 32_000],
  ["qwen", 32_000],
  // DeepSeek
  ["deepseek-r1", 64_000],
  ["deepseek-v3", 64_000],
  ["deepseek", 64_000],
];

/** Look up the context window for a model id from the registry. */
export function lookupContextWindow(modelId: string | undefined | null): number | null {
  if (!modelId) return null;
  const id = modelId.toLowerCase();
  for (const [prefix, tokens] of MODEL_CONTEXT_REGISTRY) {
    if (id.startsWith(prefix)) return tokens;
  }
  return null;
}

/**
 * Resolve the effective context window for a model. Priority:
 *   1. Explicit user override from settings (`modelContextTokens`).
 *   2. Registry lookup by model id.
 *   3. DEFAULT_CONTEXT_TOKENS (200K — matches Anthropic/MiniMax defaults).
 */
export function resolveContextWindow(opts: {
  override?: number;
  modelId?: string | null;
}): number {
  if (opts.override && opts.override > 0) return opts.override;
  return lookupContextWindow(opts.modelId) ?? DEFAULT_CONTEXT_TOKENS;
}

/** Mixed-content byte-based estimator. ASCII bytes contribute ~0.25 tokens
 *  each; non-ASCII bytes contribute ~0.5 tokens each. Conservative for both
 *  English and CJK — never under-estimates the canonical BPE tokenizers. */
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  const bytes = new TextEncoder().encode(text);
  let ascii = 0;
  let nonAscii = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] < 0x80) ascii++;
    else nonAscii++;
  }
  return Math.ceil(ascii / ASCII_BYTES_PER_TOKEN + nonAscii / NON_ASCII_BYTES_PER_TOKEN);
}

export function estimateToolDefTokens(def: ToolDefinition): number {
  return estimateTokens(JSON.stringify(def));
}

/**
 * Per-message envelope overhead constants (calibrated against Anthropic's
 * JSON wire format — role headers, content-block wrapping, tool_use_id
 * fields). Tokens, not bytes. Slightly conservative.
 *   - 12 per message (role + content envelope)
 *   - 24 per tool_use block (id + name + input wrapping, plus stop-sequence overhead)
 *   - 20 per tool_result block (tool_use_id + type wrapping)
 */
const MESSAGE_ENVELOPE_TOKENS = 12;
const TOOL_USE_ENVELOPE_TOKENS = 24;
const TOOL_RESULT_ENVELOPE_TOKENS = 20;

export function estimateMessageTokens(message: LLMMessage): number {
  if (message.role === "tool") {
    return estimateTokens(message.content) + TOOL_RESULT_ENVELOPE_TOKENS;
  }
  let total = estimateTokens(message.content || "");
  if (message.role === "assistant" && message.toolCalls) {
    for (const tc of message.toolCalls) {
      total += estimateTokens(tc.name)
        + estimateTokens(JSON.stringify(tc.input))
        + TOOL_USE_ENVELOPE_TOKENS;
    }
  }
  return total + MESSAGE_ENVELOPE_TOKENS;
}

export function estimateMessagesTokens(messages: LLMMessage[]): number {
  let total = 0;
  for (const msg of messages) total += estimateMessageTokens(msg);
  return total;
}

export interface ContextBudget {
  /** Whole context window (tokens) of the configured model. */
  contextTokens: number;
  /** Tokens reserved for the assistant's reply, forwarded as `max_tokens`. */
  maxOutputTokens: number;
  /** Effective input ceiling: `context * 95% - max_output_tokens`.
   *  Mirrors Codex's `effective_context_window_percent = 95`. */
  inputBudget: number;
  /** Auto-compact threshold (~90% of context). When projected input exceeds
   *  this, the agent should shed knowledge/memory/history. Codex uses the
   *  same 90% point to trigger LLM-summary compaction. */
  autoCompactThreshold: number;
}

export function computeBudget(opts: {
  modelId?: string | null;
  contextTokensOverride?: number;
  maxOutputTokens?: number;
}): ContextBudget {
  const contextTokens = resolveContextWindow({
    override: opts.contextTokensOverride,
    modelId: opts.modelId,
  });
  const requestedOutput = opts.maxOutputTokens && opts.maxOutputTokens > 0
    ? opts.maxOutputTokens
    : DEFAULT_MAX_OUTPUT_TOKENS;
  // Cap output at the 5% reserve so tool defs + system prompt always fit.
  const maxOutputTokens = Math.min(
    requestedOutput,
    Math.floor(contextTokens * (100 - EFFECTIVE_CONTEXT_PERCENT) / 100) +
      Math.floor(contextTokens * 0.4),
  );
  const effectiveContext = Math.floor(contextTokens * EFFECTIVE_CONTEXT_PERCENT / 100);
  const inputBudget = Math.max(2_000, effectiveContext - maxOutputTokens);
  const autoCompactThreshold = Math.floor(contextTokens * 0.9);
  return { contextTokens, maxOutputTokens, inputBudget, autoCompactThreshold };
}

export interface FitOptions {
  systemTokens: number;
  toolTokens: number;
  messages: LLMMessage[];
  inputBudget: number;
  /** Always keep this many trailing messages, regardless of budget. */
  minTailMessages?: number;
}

export interface FitResult {
  messages: LLMMessage[];
  droppedMessages: number;
  estimatedInputTokens: number;
  /** True iff even the minimum tail does not fit — caller should warn. */
  exceedsBudget: boolean;
}

/**
 * Drop oldest messages until the conversation fits the input budget.
 * Mirrors Codex's `history.remove_first_item()` retry loop in compact.rs.
 *
 * Always preserves the last `minTailMessages` messages so we never strand a
 * tool_use without its matching tool_result (providers reject that shape).
 */
export function fitMessagesToBudget(opts: FitOptions): FitResult {
  const minTail = Math.max(2, opts.minTailMessages ?? 4);
  const overhead = opts.systemTokens + opts.toolTokens;

  const messages = opts.messages;
  let kept = 0;
  let used = overhead;
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateMessageTokens(messages[i]);
    if (kept >= minTail && used + cost > opts.inputBudget) break;
    used += cost;
    kept++;
  }

  let trimmed: LLMMessage[];
  if (kept >= minTail || kept >= messages.length) {
    trimmed = messages.slice(messages.length - kept);
  } else {
    trimmed = messages.slice(Math.max(0, messages.length - minTail));
  }

  // Don't lead with a tool_result block — providers reject that.
  while (trimmed.length > 0 && trimmed[0].role === "tool") {
    trimmed.shift();
  }

  const estimatedInputTokens = overhead + estimateMessagesTokens(trimmed);
  // Flag overflow whenever the kept payload still exceeds the input budget,
  // either because we couldn't drop below the minimum tail or because the
  // tail itself is oversized (one giant user message, etc.).
  const exceedsBudget = estimatedInputTokens > opts.inputBudget;

  return {
    messages: trimmed,
    droppedMessages: messages.length - trimmed.length,
    estimatedInputTokens,
    exceedsBudget,
  };
}
