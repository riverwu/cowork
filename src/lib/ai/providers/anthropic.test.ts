import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the tauri module before importing the provider
vi.mock("@/lib/tauri", () => ({
  httpStreamPost: vi.fn(),
}));

import { AnthropicProvider } from "./anthropic";
import { httpStreamPost } from "@/lib/tauri";
import type { StreamEvent } from "./types";

const mockHttpStreamPost = vi.mocked(httpStreamPost);

beforeEach(() => {
  mockHttpStreamPost.mockReset();
});

function mockStream(jsonEvents: unknown[]) {
  mockHttpStreamPost.mockImplementation(async function* () {
    for (const event of jsonEvents) {
      yield JSON.stringify(event);
    }
  });
}

describe("AnthropicProvider", () => {
  it("constructs with default model", () => {
    const provider = new AnthropicProvider("test-key");
    expect(provider).toBeDefined();
  });

  it("streams text deltas", async () => {
    mockStream([
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ]);

    const provider = new AnthropicProvider("test-key");
    const events: StreamEvent[] = [];
    for await (const event of provider.stream({ system: "test", messages: [{ role: "user", content: "hi" }] })) {
      events.push(event);
    }

    const textDeltas = events.filter((e) => e.type === "text-delta");
    expect(textDeltas).toHaveLength(2);
    expect(textDeltas[0]).toEqual({ type: "text-delta", text: "Hello" });

    const done = events.find((e) => e.type === "message-done");
    expect(done?.type).toBe("message-done");
    if (done?.type === "message-done") {
      expect(done.content).toBe("Hello world");
      expect(done.stopReason).toBe("end");
    }
  });

  it("handles tool use blocks", async () => {
    mockStream([
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_1", name: "search_knowledge" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":' } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"test"}' } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
    ]);

    const provider = new AnthropicProvider("test-key");
    const events: StreamEvent[] = [];
    for await (const event of provider.stream({
      system: "test",
      messages: [{ role: "user", content: "search" }],
      tools: [{ name: "search_knowledge", description: "Search", parameters: { type: "object", properties: { query: { type: "string" } } } }],
    })) {
      events.push(event);
    }

    const toolCall = events.find((e) => e.type === "tool-call");
    expect(toolCall).toBeDefined();
    if (toolCall?.type === "tool-call") {
      expect(toolCall.name).toBe("search_knowledge");
      expect(toolCall.input).toEqual({ query: "test" });
    }
  });

  it("skips thinking blocks (MiniMax compatibility)", async () => {
    mockStream([
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me think..." } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "abc123" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hi there!" } },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ]);

    const provider = new AnthropicProvider("test-key", "MiniMax-M2.7-highspeed", "https://api.minimaxi.com/anthropic");
    const events: StreamEvent[] = [];
    for await (const event of provider.stream({ system: "test", messages: [{ role: "user", content: "hi" }] })) {
      events.push(event);
    }

    const textDeltas = events.filter((e) => e.type === "text-delta");
    expect(textDeltas).toHaveLength(1);
    expect(textDeltas[0]).toEqual({ type: "text-delta", text: "Hi there!" });

    const toolCalls = events.filter((e) => e.type === "tool-call");
    expect(toolCalls).toHaveLength(0);
  });

  it("passes correct URL and headers", async () => {
    mockStream([
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ]);

    const provider = new AnthropicProvider("my-key", "my-model", "https://custom.api.com");
    for await (const _ of provider.stream({ system: "sys", messages: [{ role: "user", content: "hi" }] })) {
      // consume
    }

    expect(mockHttpStreamPost).toHaveBeenCalledWith(
      "https://custom.api.com/v1/messages",
      { "x-api-key": "my-key", "anthropic-version": "2023-06-01" },
      expect.any(String),
    );

    const body = JSON.parse(mockHttpStreamPost.mock.calls[0][2]);
    expect(body.model).toBe("my-model");
    expect(body.stream).toBe(true);
  });
});
