import { describe, it, expect } from "vitest";
import { runInlineCompaction, SUMMARY_PREFIX, isSummaryMessage } from "./compact";
import type { LLMMessage, LLMProvider, StreamEvent } from "./providers/types";

function fakeProvider(summaryText: string): LLMProvider {
  return {
    async *stream(): AsyncIterable<StreamEvent> {
      // Stream the summary as a single text-delta then message-done.
      yield { type: "text-delta", text: summaryText };
      yield { type: "message-done", content: summaryText, toolCalls: [], stopReason: "end" };
    },
  };
}

describe("runInlineCompaction", () => {
  it("returns null on empty history", async () => {
    const result = await runInlineCompaction({
      provider: fakeProvider("anything"),
      messages: [],
      maxOutputTokens: 1000,
    });
    expect(result).toBeNull();
  });

  it("returns null when summary is empty", async () => {
    const result = await runInlineCompaction({
      provider: fakeProvider("   \n  "),
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 1000,
    });
    expect(result).toBeNull();
  });

  it("emits preserved user messages followed by SUMMARY_PREFIX turn", async () => {
    const messages: LLMMessage[] = [
      { role: "user", content: "first ask" },
      { role: "assistant", content: "did stuff" },
      { role: "user", content: "second ask" },
      { role: "assistant", content: "did more stuff", toolCalls: [{ id: "t1", name: "x", input: {} }] },
      { role: "tool", toolCallId: "t1", content: "tool output" },
      { role: "user", content: "third ask" },
    ];
    const result = await runInlineCompaction({
      provider: fakeProvider("Handoff summary: did A, B, C. Next: D."),
      messages,
      maxOutputTokens: 1000,
    });
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("Handoff summary: did A, B, C. Next: D.");
    // Last message must be the summary turn with SUMMARY_PREFIX.
    const last = result!.messages[result!.messages.length - 1];
    expect(last.role).toBe("user");
    expect(isSummaryMessage(last.content)).toBe(true);
    expect(last.content.startsWith(SUMMARY_PREFIX)).toBe(true);
    // All preserved messages are user messages, in chronological order.
    const preserved = result!.messages.slice(0, -1);
    expect(preserved.every((m) => m.role === "user")).toBe(true);
    expect(preserved.map((m) => m.content)).toEqual(["first ask", "second ask", "third ask"]);
  });

  it("skips prior summary messages when re-compacting", async () => {
    const priorSummary = `${SUMMARY_PREFIX}\nan old summary that should NOT be re-preserved`;
    const messages: LLMMessage[] = [
      { role: "user", content: "real first ask" },
      { role: "user", content: priorSummary },
      { role: "assistant", content: "did stuff" },
      { role: "user", content: "real second ask" },
    ];
    const result = await runInlineCompaction({
      provider: fakeProvider("new summary"),
      messages,
      maxOutputTokens: 1000,
    });
    expect(result).not.toBeNull();
    const preserved = result!.messages.slice(0, -1).map((m) => m.content);
    expect(preserved).toEqual(["real first ask", "real second ask"]);
  });
});
