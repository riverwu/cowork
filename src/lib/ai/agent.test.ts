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
      const firstUser = params.messages.find((message) => message.role === "user")?.content ?? "";
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
});
