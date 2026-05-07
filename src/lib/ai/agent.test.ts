import { describe, expect, it, vi } from "vitest";
import type { LLMProvider, StreamParams } from "./providers/types";

const mocks = vi.hoisted(() => {
  const streamCalls: StreamParams[] = [];
  const tools: Record<string, {
    definition: { name: string; description: string; parameters: Record<string, unknown> };
    execute: (input: Record<string, unknown>) => Promise<string>;
  }> = {};
  const mockProvider: LLMProvider = {
    async *stream(params: StreamParams) {
      streamCalls.push(params);
      const lastUser = [...params.messages].reverse().find((message) => message.role === "user")?.content ?? "";
      if ((params.tools?.length ?? 0) === 0 && lastUser.includes("CONTEXT CHECKPOINT COMPACTION")) {
        yield { type: "text-delta", text: "Compacted handoff summary." };
        yield {
          type: "message-done",
          content: "Compacted handoff summary.",
          toolCalls: [],
          stopReason: "end",
        };
        return;
      }
      const firstUser = params.messages.find((message) => message.role === "user")?.content ?? "";
      if (params.messages.some((message) => message.role === "user" && message.content.includes("llm failure compact"))) {
        throw new Error("terminated");
      }
      if (firstUser.includes("tool-turn narration")) {
        if (streamCalls.length === 1) {
          yield { type: "text-delta", text: "PPT已生成完成！" };
          yield {
            type: "message-done",
            content: "PPT已生成完成！",
            toolCalls: [{ id: "call-1", name: "noop", input: {} }],
            stopReason: "tool_use",
          };
          return;
        }
        yield { type: "text-delta", text: "最终完成。" };
        yield {
          type: "message-done",
          content: "最终完成。",
          toolCalls: [],
          stopReason: "end",
        };
        return;
      }

      if (firstUser.includes("skill read retention")) {
        if (streamCalls.length === 1) {
          yield {
            type: "message-done",
            content: "",
            toolCalls: [{ id: "call-skill", name: "read_file", input: { path: "/Users/river/.cowork/skills/slideml2/SKILL.md" } }],
            stopReason: "tool_use",
          };
          return;
        }
        yield {
          type: "message-done",
          content: "Skill retained.",
          toolCalls: [],
          stopReason: "end",
        };
        return;
      }

      if (firstUser.includes("slideml validation gate")) {
        if (streamCalls.length === 1) {
          yield {
            type: "message-done",
            content: "",
            toolCalls: [{ id: "call-validate-1", name: "validate_render", input: { deckPath: "/tmp/deck.json", render: true } }],
            stopReason: "tool_use",
          };
          return;
        }
        if (streamCalls.length === 2) {
          yield {
            type: "message-done",
            content: "PPT已成功生成。",
            toolCalls: [],
            stopReason: "end",
          };
          return;
        }
        if (streamCalls.length === 3) {
          yield {
            type: "message-done",
            content: "",
            toolCalls: [{ id: "call-validate-2", name: "validate_render", input: { deckPath: "/tmp/deck.json", render: true } }],
            stopReason: "tool_use",
          };
          return;
        }
        yield {
          type: "message-done",
          content: "PPT已成功生成。",
          toolCalls: [],
          stopReason: "end",
        };
        return;
      }

      if (firstUser.includes("slideml fallback blocked")) {
        if (streamCalls.length === 1) {
          yield {
            type: "message-done",
            content: "",
            toolCalls: [{ id: "call-create", name: "create_deck", input: { deckPath: "/tmp/fallback.json" } }],
            stopReason: "tool_use",
          };
          return;
        }
        if (streamCalls.length === 2) {
          yield {
            type: "message-done",
            content: "",
            toolCalls: [{ id: "call-run-node", name: "run_node", input: { code: "require('pptxgenjs')" } }],
            stopReason: "tool_use",
          };
          return;
        }
        if (streamCalls.length === 4 && params.messages.some((message) => message.role === "user" && message.content.includes("SYSTEM VALIDATION GATE"))) {
          yield {
            type: "message-done",
            content: "",
            toolCalls: [{ id: "call-validate-ok", name: "validate_render", input: { deckPath: "/tmp/fallback.json", render: true } }],
            stopReason: "tool_use",
          };
          return;
        }
        yield {
          type: "message-done",
          content: "SlideML2完成。",
          toolCalls: [],
          stopReason: "end",
        };
        return;
      }

      if (streamCalls.length === 1) {
        yield {
          type: "message-done",
          content: "const hugeScript = `truncated",
          toolCalls: [],
          stopReason: "max_tokens",
        };
        return;
      }

      yield {
        type: "message-done",
        content: "Recovered by using tools.",
        toolCalls: [],
        stopReason: "end",
      };
    },
  };

  return {
    streamCalls,
    mockProvider,
    tools,
  };
});

describe("runAgent skill read retention", () => {
  it("keeps SKILL.md read results intact for the current task run", async () => {
    mocks.streamCalls.length = 0;
    const largeSkill = "SlideML2 skill\n" + "component-purpose ".repeat(1200);
    mocks.tools.read_file = {
      definition: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: {}, required: ["path"] } },
      execute: vi.fn().mockResolvedValue(largeSkill),
    };

    for await (const _event of runAgent({
      sessionId: "session-1",
      workingDirectory: "/Users/river/Documents/Workspace",
      messages: [{ role: "user", content: "skill read retention" }],
    })) {
      // drain
    }

    expect(mocks.streamCalls).toHaveLength(2);
    const secondCallToolResult = mocks.streamCalls[1].messages.find((message) => message.role === "tool");
    expect(secondCallToolResult?.content).toContain("SlideML2 skill");
    expect(secondCallToolResult?.content).toContain("component-purpose");
    expect(secondCallToolResult?.content).not.toContain("result truncated for the LLM");
    delete mocks.tools.read_file;
  });
});

vi.mock("./providers", () => ({
  getConfiguredProvider: vi.fn().mockResolvedValue(mocks.mockProvider),
}));

vi.mock("./tools/registry", () => ({
  getTools: vi.fn().mockReturnValue(mocks.tools),
}));

vi.mock("./skill-registry", () => ({
  skillRegistry: {
    isLoaded: vi.fn().mockReturnValue(true),
    initialize: vi.fn(),
    getAvailableSkillsPrompt: vi.fn().mockReturnValue(""),
  },
}));

vi.mock("./skill-loader", () => ({
  getSkillsDir: vi.fn().mockResolvedValue("/Users/river/.cowork/skills"),
}));

vi.mock("@/lib/mcp", () => ({
  mcpManager: {
    waitForReady: vi.fn().mockResolvedValue(undefined),
    getAllTools: vi.fn().mockReturnValue({}),
    getServerStatus: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("@/lib/memory", () => ({
  retrieveMemoryContext: vi.fn().mockResolvedValue({ coreFacts: "", relevantMemories: "", relevantEpisodes: "" }),
  buildMemoryPrompt: vi.fn().mockReturnValue(""),
  extractMemories: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db", () => ({
  getSettings: vi.fn().mockResolvedValue({
    llmProvider: "anthropic",
    modelId: "claude-sonnet-4-20250514",
  }),
}));

import { runAgent } from "./agent";

describe("runAgent truncation recovery", () => {
  it("continues long tasks after a max_tokens response instead of failing immediately", async () => {
    mocks.streamCalls.length = 0;

    const events = [];
    for await (const event of runAgent({
      sessionId: "session-1",
      workingDirectory: "/Users/river/Documents/Workspace",
      messages: [{
        role: "user",
        content: `根据这个文件的内容生成一个Apple Design Guidelines风格的PPT。

Attached files:
[File: report.md](/Users/river/Documents/Workspace/report.md)`,
      }],
    })) {
      events.push(event);
    }

    expect(mocks.streamCalls).toHaveLength(2);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.some((event) => event.type === "long-task-progress" && event.phase === "recover")).toBe(true);

    const secondCallMessages = mocks.streamCalls[1].messages;
    const lastMessage = secondCallMessages[secondCallMessages.length - 1];
    expect(lastMessage?.role).toBe("user");
    expect(lastMessage?.content).toContain("Your previous response was truncated");
    expect(lastMessage?.content).toContain("tool calls only");
    expect(lastMessage?.content).toContain("under 12,000 characters");
    expect(lastMessage?.content).toContain("write_file mode \"overwrite\"");
    expect(lastMessage?.content).toContain("run_node");
  });

  it("does not surface or save assistant narration from turns that call tools", async () => {
    mocks.streamCalls.length = 0;
    mocks.tools.noop = {
      definition: {
        name: "noop",
        description: "No-op test tool",
        parameters: { type: "object", properties: {} },
      },
      execute: vi.fn().mockResolvedValue("ok"),
    };

    const events = [];
    for await (const event of runAgent({
      sessionId: "session-1",
      workingDirectory: "/Users/river/Documents/Workspace",
      messages: [{ role: "user", content: "tool-turn narration" }],
    })) {
      events.push(event);
    }

    const streamedText = events
      .filter((event): event is { type: "text-delta"; text: string } => event.type === "text-delta")
      .map((event) => event.text)
      .join("");

    expect(streamedText).not.toContain("PPT已生成完成");
    expect(streamedText).toContain("最终完成");
    expect(events.some((event) => event.type === "skill-start" && event.skill === "noop")).toBe(true);
  });

  it("emits a compaction event after an LLM request failure", async () => {
    mocks.streamCalls.length = 0;

    const events = [];
    for await (const event of runAgent({
      sessionId: "session-1",
      workingDirectory: "/Users/river/Documents/Workspace",
      messages: [
        { role: "user", content: "old deck task" },
        { role: "assistant", content: "large prior work" },
        { role: "user", content: "llm failure compact" },
      ],
    })) {
      events.push(event);
    }

    expect(events).toContainEqual(expect.objectContaining({
      type: "compacted",
      reason: "llm-request-failed",
      summary: "Compacted handoff summary.",
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "error",
      error: "LLM request failed: terminated",
    }));
    expect(mocks.streamCalls).toHaveLength(2);
    expect(mocks.streamCalls[1].tools).toEqual([]);
  });

  it("adds a non-blocking notice when a SlideML2 deck is still unvalidated", async () => {
    mocks.streamCalls.length = 0;
    mocks.tools.validate_render = {
      definition: {
        name: "validate_render",
        description: "Validate SlideML2 deck",
        parameters: { type: "object", properties: {}, required: ["deckPath"] },
      },
      execute: vi.fn()
        .mockResolvedValueOnce(JSON.stringify({
          ok: false,
          error: "2 blocking render diagnostic(s) remain.",
          diagnostics: { blockingCount: 2 },
        }))
        .mockResolvedValueOnce(JSON.stringify({
          ok: true,
          outputPath: "/tmp/deck.pptx",
          diagnostics: { blockingCount: 0 },
        })),
    };

    const events = [];
    for await (const event of runAgent({
      sessionId: "session-1",
      workingDirectory: "/Users/river/Documents/Workspace",
      messages: [{ role: "user", content: "slideml validation gate" }],
    })) {
      events.push(event);
    }

    expect(mocks.streamCalls).toHaveLength(2);

    const streamedText = events
      .filter((event): event is { type: "text-delta"; text: string } => event.type === "text-delta")
      .map((event) => event.text)
      .join("");
    expect(streamedText).toContain("PPT已成功生成。");
    expect(streamedText).toContain("[SlideML2 validation notice]");
    expect(streamedText).toContain("does not block other tools");
    expect(events.some((event) => event.type === "error")).toBe(false);

    delete mocks.tools.validate_render;
  });

  it("does not block generic tools while a SlideML2 deck is dirty", async () => {
    mocks.streamCalls.length = 0;
    const runNodeExecute = vi.fn().mockResolvedValue("PPTX saved");
    mocks.tools.create_deck = {
      definition: {
        name: "create_deck",
        description: "Create deck",
        parameters: { type: "object", properties: {}, required: ["deckPath"] },
      },
      execute: vi.fn().mockResolvedValue("Deck created at /tmp/fallback.json. Add slides via replace_slide."),
    };
    mocks.tools.run_node = {
      definition: {
        name: "run_node",
        description: "Run node",
        parameters: { type: "object", properties: {}, required: ["code"] },
      },
      execute: runNodeExecute,
    };
    mocks.tools.validate_render = {
      definition: {
        name: "validate_render",
        description: "Validate SlideML2 deck",
        parameters: { type: "object", properties: {}, required: ["deckPath"] },
      },
      execute: vi.fn().mockResolvedValue(JSON.stringify({ ok: true, diagnostics: { blockingCount: 0 } })),
    };

    const events = [];
    for await (const event of runAgent({
      sessionId: "session-1",
      workingDirectory: "/Users/river/Documents/Workspace",
      messages: [{ role: "user", content: "slideml fallback blocked" }],
    })) {
      events.push(event);
    }

    expect(runNodeExecute).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(expect.objectContaining({
      type: "skill-done",
      skill: "run_node",
      success: true,
    }));

    delete mocks.tools.create_deck;
    delete mocks.tools.run_node;
    delete mocks.tools.validate_render;
  });
});
