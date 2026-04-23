import { describe, it, expect, vi } from "vitest";
import { AnthropicProvider } from "./anthropic";
import type { StreamEvent } from "./types";

// Helper: create a ReadableStream from SSE lines
function createSSEStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = events.map((e) => `event: message\ndata: ${e}\n\n`).join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

describe("AnthropicProvider", () => {
  it("constructs with default model", () => {
    const provider = new AnthropicProvider("test-key");
    expect(provider).toBeDefined();
  });

  it("constructs with custom model and baseURL", () => {
    const provider = new AnthropicProvider("test-key", "my-model", "https://custom.api.com");
    expect(provider).toBeDefined();
  });

  it("streams text deltas from SSE response", async () => {
    const sseEvents = [
      JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: " world" },
      }),
      JSON.stringify({
        type: "content_block_stop",
        index: 0,
      }),
      JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
      }),
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: createSSEStream(sseEvents),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new AnthropicProvider("test-key");
    const events: StreamEvent[] = [];

    for await (const event of provider.stream({
      system: "test",
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(event);
    }

    // Should have text deltas and a done event
    const textDeltas = events.filter((e) => e.type === "text-delta");
    expect(textDeltas).toHaveLength(2);
    expect(textDeltas[0]).toEqual({ type: "text-delta", text: "Hello" });
    expect(textDeltas[1]).toEqual({ type: "text-delta", text: " world" });

    const doneEvent = events.find((e) => e.type === "message-done");
    expect(doneEvent).toBeDefined();
    if (doneEvent?.type === "message-done") {
      expect(doneEvent.content).toBe("Hello world");
      expect(doneEvent.stopReason).toBe("end");
    }

    vi.unstubAllGlobals();
  });

  it("handles tool use blocks", async () => {
    const sseEvents = [
      JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tool_1", name: "search_knowledge" },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"query":' },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '"test"}' },
      }),
      JSON.stringify({
        type: "content_block_stop",
        index: 0,
      }),
      JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
      }),
    ];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: createSSEStream(sseEvents),
    }));

    const provider = new AnthropicProvider("test-key");
    const events: StreamEvent[] = [];

    for await (const event of provider.stream({
      system: "test",
      messages: [{ role: "user", content: "search" }],
      tools: [{
        name: "search_knowledge",
        description: "Search",
        parameters: { type: "object", properties: { query: { type: "string" } } },
      }],
    })) {
      events.push(event);
    }

    const toolCall = events.find((e) => e.type === "tool-call");
    expect(toolCall).toBeDefined();
    if (toolCall?.type === "tool-call") {
      expect(toolCall.name).toBe("search_knowledge");
      expect(toolCall.input).toEqual({ query: "test" });
    }

    const done = events.find((e) => e.type === "message-done");
    if (done?.type === "message-done") {
      expect(done.stopReason).toBe("tool_use");
    }

    vi.unstubAllGlobals();
  });

  it("skips thinking blocks (MiniMax compatibility)", async () => {
    const sseEvents = [
      JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Let me think..." },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "abc123" },
      }),
      JSON.stringify({
        type: "content_block_stop",
        index: 0,
      }),
      JSON.stringify({
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "Hi there!" },
      }),
      JSON.stringify({
        type: "content_block_stop",
        index: 1,
      }),
      JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
      }),
    ];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: createSSEStream(sseEvents),
    }));

    const provider = new AnthropicProvider("test-key", "MiniMax-M2.7-highspeed", "https://api.minimaxi.com/anthropic");
    const events: StreamEvent[] = [];

    for await (const event of provider.stream({
      system: "test",
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(event);
    }

    // Should only have the text delta, not thinking
    const textDeltas = events.filter((e) => e.type === "text-delta");
    expect(textDeltas).toHaveLength(1);
    expect(textDeltas[0]).toEqual({ type: "text-delta", text: "Hi there!" });

    // No tool calls from thinking blocks
    const toolCalls = events.filter((e) => e.type === "tool-call");
    expect(toolCalls).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it("throws on non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    }));

    const provider = new AnthropicProvider("bad-key");
    await expect(async () => {
      for await (const _ of provider.stream({
        system: "test",
        messages: [{ role: "user", content: "hi" }],
      })) {
        // consume
      }
    }).rejects.toThrow("API error 401");

    vi.unstubAllGlobals();
  });
});
