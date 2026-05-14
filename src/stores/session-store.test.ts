import { describe, it, expect } from "vitest";
import {
  activeContextMessages,
  assembleLlmMessages,
  isContextSummary,
  isSessionArchive,
  parseCompactCommand,
  parseNewSessionCommand,
  sanitizeMessageSequence,
} from "./session-store";
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
function systemMsg(content: string): Message {
  return { id: `s-${content.slice(0, 4)}`, sessionId: "s", role: "system", content, metadata: null, createdAt: 0 };
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

  it("does not carry old skill instruction markdown reads into later LLM turns", () => {
    const out = assembleLlmMessages([
      userMsg("make a deck"),
      assistantMsg("I loaded the skill.", [
        {
          skill: "read_file",
          status: "done",
          input: { path: "/Users/river/.cowork/skills/slideml2/SKILL.md" },
          result: "full SlideML2 skill body",
          success: true,
          toolCallId: "tu_skill",
        },
        {
          skill: "read_file",
          status: "done",
          input: { path: "/Users/river/.cowork/skills/slideml2/business.md" },
          result: "full business style body",
          success: true,
          toolCallId: "tu_business",
        },
        {
          skill: "read_file",
          status: "done",
          input: { path: "/Users/river/Documents/source.md" },
          result: "source body",
          success: true,
          toolCallId: "tu_source",
        },
      ]),
      userMsg("continue"),
    ]);

    expect(out.find((m) => m.role === "tool" && m.toolCallId === "tu_skill")).toBeUndefined();
    expect(out.find((m) => m.role === "tool" && m.toolCallId === "tu_business")).toBeUndefined();
    expect(out.find((m) => m.role === "tool" && m.toolCallId === "tu_source")).toMatchObject({
      role: "tool",
      toolCallId: "tu_source",
    });
  });

  it("ships hidden context summaries as user handoff messages", () => {
    const summary = systemMsg("__CONTEXT_SUMMARY__\nCompacted after LLM request failure.");
    expect(isContextSummary(summary)).toBe(true);

    const out = assembleLlmMessages([
      systemMsg("__CONTEXT_CLEARED__"),
      summary,
      assistantMsg("[Error: LLM request failed: terminated]"),
      userMsg("继续"),
    ]);

    expect(out).toEqual([
      { role: "user", content: "Compacted after LLM request failure." },
      { role: "assistant", content: "[Error: LLM request failed: terminated]" },
      { role: "user", content: "继续" },
    ]);
  });

  it("does not ship completed-session archives to the LLM", () => {
    const archive = systemMsg("__SESSION_ARCHIVE__\n{\"type\":\"session-archive\"}");
    expect(isSessionArchive(archive)).toBe(true);

    const out = assembleLlmMessages([
      archive,
      systemMsg("__CONTEXT_CLEARED__"),
      userMsg("start fresh"),
    ]);

    expect(out).toEqual([{ role: "user", content: "start fresh" }]);
  });
});

describe("new-session slash command", () => {
  it("recognizes /new and strips the command from follow-up content", () => {
    expect(parseNewSessionCommand("/new")).toEqual({ isNewSession: true, remainingContent: "" });
    expect(parseNewSessionCommand("/new make a different deck")).toEqual({
      isNewSession: true,
      remainingContent: "make a different deck",
    });
    expect(parseNewSessionCommand("/new-session research a new topic")).toEqual({
      isNewSession: true,
      remainingContent: "research a new topic",
    });
  });

  it("leaves normal messages untouched", () => {
    expect(parseNewSessionCommand("please create a new slide")).toEqual({
      isNewSession: false,
      remainingContent: "please create a new slide",
    });
  });
});

describe("/new context boundary", () => {
  it("keeps visible history available while limiting LLM context to messages after the divider", () => {
    const oldUser = userMsg("old request", "u-old");
    const oldAssistant = assistantMsg("old output", []);
    const divider = systemMsg("__CONTEXT_CLEARED__");
    const newUser = userMsg("new request", "u-new");

    const visibleHistory = [oldUser, oldAssistant, divider, newUser];
    expect(visibleHistory).toHaveLength(4);
    expect(activeContextMessages(visibleHistory)).toEqual([newUser]);
    expect(assembleLlmMessages(activeContextMessages(visibleHistory))).toEqual([
      { role: "user", content: "new request" },
    ]);
  });
});

describe("compact slash command", () => {
  it("recognizes /compact and strips follow-up content", () => {
    expect(parseCompactCommand("/compact")).toEqual({ isCompact: true, remainingContent: "" });
    expect(parseCompactCommand("/compact 继续修第 4 页")).toEqual({
      isCompact: true,
      remainingContent: "继续修第 4 页",
    });
  });

  it("leaves normal messages untouched", () => {
    expect(parseCompactCommand("please compact this layout")).toEqual({
      isCompact: false,
      remainingContent: "please compact this layout",
    });
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
