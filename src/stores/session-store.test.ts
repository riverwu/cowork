import { describe, it, expect } from "vitest";
import { assembleLlmMessages, sanitizeMessageSequence } from "./session-store";
import type { Message } from "@/types";
import type { LLMMessage } from "@/lib/ai/providers/types";

function userMsg(content: string, id = `u-${content.slice(0, 4)}`): Message {
  return { id, sessionId: "s", role: "user", content, metadata: null, createdAt: 0 };
}
function assistantMsg(content: string, steps: unknown[] = []): Message {
  return {
    id: `a-${Math.random()}`,
    sessionId: "s",
    role: "assistant",
    content,
    metadata: { steps },
    createdAt: 0,
  };
}

describe("assembleLlmMessages — native tool-block sequence", () => {
  it("emits user → assistant (with toolCalls) → tool messages", () => {
    const out = assembleLlmMessages([
      userMsg("hi"),
      assistantMsg("done", [
        { skill: "read_file", status: "done", input: { path: "/x" }, result: "OK", success: true, toolCallId: "tu_1" },
      ]),
    ]);
    expect(out).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "done", toolCalls: [{ id: "tu_1", name: "read_file", input: { path: "/x" } }] },
      { role: "tool", toolCallId: "tu_1", content: "OK" },
    ]);
  });

  it("does NOT bake tool history into assistant content (mimicry-prevention)", () => {
    const out = assembleLlmMessages([
      userMsg("write report"),
      assistantMsg("Report written.", [
        { skill: "write_file", status: "done", input: { path: "/r.md" }, result: "wrote 1234 bytes", success: true, toolCallId: "tu_a" },
      ]),
      userMsg("now make a deck"),
    ]);
    // Assistant content stays exactly as the model produced it.
    const assistant = out.find((m) => m.role === "assistant")!;
    expect(assistant.content).toBe("Report written.");
    expect(assistant.content).not.toMatch(/TURN_TOOL_HISTORY|system-observation|\[OK\]/);
    // Next user content is also untouched.
    const userTwo = out[3];
    expect(userTwo).toEqual({ role: "user", content: "now make a deck" });
  });

  it("skips legacy steps without a toolCallId (back-compat)", () => {
    const out = assembleLlmMessages([
      userMsg("hi"),
      assistantMsg("done", [
        { skill: "read_file", status: "done", result: "OK", success: true /* no toolCallId */ },
      ]),
    ]);
    expect(out).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "done" },
    ]);
  });

  it("skips internal steps (__thinking__, __compact__)", () => {
    const out = assembleLlmMessages([
      userMsg("hi"),
      assistantMsg("ok", [
        { skill: "__thinking__", status: "done", toolCallId: "x" },
        { skill: "__compact__", status: "done", toolCallId: "y" },
        { skill: "real_tool", status: "done", toolCallId: "z", input: {}, result: "result text", success: true },
      ]),
    ]);
    const tools = out.filter((m) => m.role === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ toolCallId: "z" });
  });
});

describe("sanitizeMessageSequence — orphan repair", () => {
  it("injects [cancelled] for tool_use without a matching tool result", () => {
    const input: LLMMessage[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "running",
        toolCalls: [
          { id: "tu_1", name: "x", input: {} },
          { id: "tu_2", name: "y", input: {} },
        ],
      },
      { role: "tool", toolCallId: "tu_1", content: "ok" },
      // tu_2 missing — session restart / cancel
      { role: "user", content: "next" },
    ];
    const out = sanitizeMessageSequence(input);
    const cancelled = out.find((m) => m.role === "tool" && m.toolCallId === "tu_2");
    expect(cancelled).toEqual({ role: "tool", toolCallId: "tu_2", content: "[cancelled]" });
    // Order: assistant → tu_1 → tu_2 (cancelled) → user
    const idxAssistant = out.findIndex((m) => m.role === "assistant");
    const idxUser2 = out.findIndex((m, i) => m.role === "user" && i > idxAssistant);
    expect(idxUser2 - idxAssistant).toBe(3); // assistant, tu_1, tu_2-cancelled, then user
  });

  it("drops orphan tool messages that don't match any prior tool_use", () => {
    const input: LLMMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "ok" },
      { role: "tool", toolCallId: "ghost", content: "stale" },
      { role: "user", content: "go on" },
    ];
    const out = sanitizeMessageSequence(input);
    expect(out.find((m) => m.role === "tool" && m.toolCallId === "ghost")).toBeUndefined();
  });

  it("flushes any unmatched tool_use at end-of-stream", () => {
    const input: LLMMessage[] = [
      { role: "user", content: "go" },
      { role: "assistant", content: "running…", toolCalls: [{ id: "tail", name: "x", input: {} }] },
    ];
    const out = sanitizeMessageSequence(input);
    expect(out[out.length - 1]).toEqual({ role: "tool", toolCallId: "tail", content: "[cancelled]" });
  });
});
