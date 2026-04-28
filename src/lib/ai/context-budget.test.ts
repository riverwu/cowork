import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONTEXT_TOKENS,
  computeBudget,
  estimateMessageTokens,
  estimateTokens,
  fitMessagesToBudget,
  lookupContextWindow,
  resolveContextWindow,
} from "./context-budget";

describe("context budget — model registry", () => {
  it("resolves Claude 4 family to 200K", () => {
    expect(lookupContextWindow("claude-sonnet-4-20250514")).toBe(200_000);
    expect(lookupContextWindow("claude-opus-4-7")).toBe(200_000);
    expect(lookupContextWindow("claude-haiku-4-5-20251001")).toBe(200_000);
  });

  it("resolves MiniMax — M1 keeps 1M, M2 / M2.7 reverted to 200K", () => {
    expect(lookupContextWindow("minimax-m1")).toBe(1_000_000);
    expect(lookupContextWindow("minimax-m2")).toBe(200_000);
    expect(lookupContextWindow("minimax-m2.7")).toBe(200_000);
    expect(lookupContextWindow("minimax-m2.7-highspeed")).toBe(200_000);
    expect(lookupContextWindow("minimax-text-01")).toBe(245_760);
    expect(lookupContextWindow("minimax-abab6.5")).toBe(200_000);
    expect(lookupContextWindow("abab6.5-chat")).toBe(245_760);
  });

  it("resolves GPT-4o family with mini matched first", () => {
    expect(lookupContextWindow("gpt-4o-mini")).toBe(128_000);
    expect(lookupContextWindow("gpt-4o-2024-08-06")).toBe(128_000);
    expect(lookupContextWindow("gpt-4-turbo")).toBe(128_000);
    expect(lookupContextWindow("gpt-4")).toBe(8_192);
  });

  it("resolves Doubao with size-suffixed models matched first", () => {
    expect(lookupContextWindow("doubao-1-5-pro-256k")).toBe(256_000);
    expect(lookupContextWindow("doubao-pro-32k")).toBe(32_000);
    expect(lookupContextWindow("doubao-seedream-4-0-250828")).toBe(32_000);
  });

  it("returns null for unknown model id", () => {
    expect(lookupContextWindow("acme-megamind-9000")).toBeNull();
    expect(lookupContextWindow(undefined)).toBeNull();
  });

  it("falls back to 200K default when model id is unknown", () => {
    expect(resolveContextWindow({ modelId: "acme-megamind" })).toBe(DEFAULT_CONTEXT_TOKENS);
    expect(DEFAULT_CONTEXT_TOKENS).toBe(200_000);
  });

  it("override beats both registry and default", () => {
    expect(resolveContextWindow({ override: 64_000, modelId: "claude-sonnet-4" })).toBe(64_000);
  });
});

describe("context budget — token estimation", () => {
  it("estimates ASCII at ~4 bytes per token", () => {
    expect(estimateTokens("hello")).toBe(Math.ceil(5 / 4)); // 2
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });

  it("estimates CJK at ~2 bytes per token (no longer the 4-byte under-estimate)", () => {
    // 经营分析 = 12 UTF-8 bytes; old bytes/4 → 3 tokens (under-counts vs ~8 actual).
    // New mixed estimator → 12 / 2 = 6 tokens. Closer to truth, never under.
    expect(estimateTokens("经营分析")).toBe(6);
    expect(estimateTokens("你好")).toBe(3);
    // Long Chinese document — 100 chars × 3 bytes = 300 bytes → 150 tokens.
    expect(estimateTokens("中".repeat(100))).toBe(150);
  });

  it("handles mixed CJK + ASCII content correctly", () => {
    // "硬件3月经营分析会.pdf" — 8 CJK chars (24 UTF-8 bytes) + 5 ASCII chars (5 bytes)
    // Expected: ceil(5/4 + 24/2) = ceil(1.25 + 12) = 14 tokens.
    expect(estimateTokens("硬件3月经营分析会.pdf")).toBe(14);
  });

  it("never under-estimates plain ASCII vs the simpler bytes/4 heuristic", () => {
    const ascii = "the quick brown fox jumps over the lazy dog";
    const bytes = new TextEncoder().encode(ascii).length;
    expect(estimateTokens(ascii)).toBeGreaterThanOrEqual(Math.ceil(bytes / 4));
  });

  it("handles empty / null input safely", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
    expect(estimateTokens(null)).toBe(0);
  });

  it("estimates assistant tool calls including arguments and envelope overhead", () => {
    const baseline = estimateTokens("running search");
    const cost = estimateMessageTokens({
      role: "assistant",
      content: "running search",
      toolCalls: [{ id: "t1", name: "search_knowledge", input: { query: "Q1 revenue" } }],
    });
    // Should include text + tool name + serialized input + tool_use envelope + msg envelope.
    expect(cost).toBeGreaterThan(baseline + 20);
  });

  it("counts tool_result envelope on tool messages", () => {
    const result = "Found 3 matching documents.";
    const cost = estimateMessageTokens({ role: "tool", toolCallId: "t1", content: result });
    expect(cost).toBeGreaterThan(estimateTokens(result));
    expect(cost).toBeLessThan(estimateTokens(result) + 50);
  });
});

describe("context budget — computeBudget", () => {
  it("derives input budget from window minus output reserve and 5% safety", () => {
    const b = computeBudget({ modelId: "claude-sonnet-4", maxOutputTokens: 8_192 });
    expect(b.contextTokens).toBe(200_000);
    expect(b.maxOutputTokens).toBe(8_192);
    // 200000 * 0.95 - 8192 = 181808
    expect(b.inputBudget).toBe(181_808);
    // auto-compact threshold = 90% of context
    expect(b.autoCompactThreshold).toBe(180_000);
  });

  it("falls back to default 200K when no model id and no override", () => {
    const b = computeBudget({});
    expect(b.contextTokens).toBe(200_000);
  });

  it("never lets output reservation eat the input below 2K", () => {
    const b = computeBudget({ contextTokensOverride: 4_000, maxOutputTokens: 100_000 });
    expect(b.inputBudget).toBeGreaterThanOrEqual(2_000);
  });
});

describe("context budget — fitMessagesToBudget", () => {
  it("returns all messages when within budget", () => {
    const msgs = [
      { role: "user" as const, content: "hi" },
      { role: "assistant" as const, content: "hello" },
      { role: "user" as const, content: "help" },
    ];
    const result = fitMessagesToBudget({
      systemTokens: 100,
      toolTokens: 50,
      messages: msgs,
      inputBudget: 10_000,
    });
    expect(result.droppedMessages).toBe(0);
    expect(result.messages).toHaveLength(3);
    expect(result.exceedsBudget).toBe(false);
  });

  it("trims oldest messages when over budget but keeps minimum tail", () => {
    const msgs = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: "x".repeat(2_000),
    }));
    const result = fitMessagesToBudget({
      systemTokens: 100,
      toolTokens: 100,
      messages: msgs,
      inputBudget: 5_000,
      minTailMessages: 4,
    });
    expect(result.messages.length).toBeLessThan(20);
    expect(result.messages.length).toBeGreaterThanOrEqual(4);
    expect(result.droppedMessages).toBe(20 - result.messages.length);
  });

  it("flags exceedsBudget when even the tail does not fit", () => {
    const msgs = Array.from({ length: 6 }, () => ({
      role: "user" as const,
      content: "x".repeat(40_000), // ~10K tokens each
    }));
    const result = fitMessagesToBudget({
      systemTokens: 0,
      toolTokens: 0,
      messages: msgs,
      inputBudget: 5_000,
      minTailMessages: 4,
    });
    expect(result.exceedsBudget).toBe(true);
  });

  it("never leads with a tool message after trimming", () => {
    const msgs = [
      { role: "user" as const, content: "old user" },
      { role: "tool" as const, toolCallId: "t1", content: "result" },
      { role: "user" as const, content: "new user" },
      { role: "assistant" as const, content: "ok" },
    ];
    const result = fitMessagesToBudget({
      systemTokens: 0,
      toolTokens: 0,
      messages: msgs,
      inputBudget: 30,
      minTailMessages: 2,
    });
    expect(result.messages[0]?.role).not.toBe("tool");
  });
});
