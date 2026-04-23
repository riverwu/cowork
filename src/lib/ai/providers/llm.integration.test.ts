import { describe, it, expect, beforeAll } from "vitest";
import { AnthropicProvider } from "./anthropic";
import type { StreamEvent } from "./types";

/**
 * Integration tests for LLM API calls.
 * Uses MINIMAX_API and MINIMAX_API_KEY from environment.
 * These tests make real API calls — they are skipped if env vars are not set.
 */

let provider: AnthropicProvider;
let shouldRun = false;

beforeAll(() => {
  const apiKey = process.env.MINIMAX_API_KEY;
  const baseURL = process.env.MINIMAX_API;

  if (apiKey && baseURL) {
    provider = new AnthropicProvider(apiKey, "MiniMax-M2.7-highspeed", baseURL);
    shouldRun = true;
  }
});

async function collectEvents(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of iter) {
    events.push(event);
  }
  return events;
}

describe("LLM Integration", () => {
  it("can stream a simple text response", async () => {
    if (!shouldRun) return;

    const events = await collectEvents(
      provider.stream({
        system: "You are a helpful assistant. Respond in one short sentence.",
        messages: [{ role: "user", content: "Say hello." }],
      }),
    );

    // Should have text deltas
    const textDeltas = events.filter((e) => e.type === "text-delta");
    expect(textDeltas.length).toBeGreaterThan(0);

    // Should have a message-done event
    const done = events.find((e) => e.type === "message-done");
    expect(done).toBeDefined();
    if (done?.type === "message-done") {
      expect(done.content.length).toBeGreaterThan(0);
      expect(done.stopReason).toBe("end");
      expect(done.toolCalls).toHaveLength(0);
    }

    // Full text should be non-empty and coherent
    const fullText = textDeltas
      .filter((e): e is Extract<StreamEvent, { type: "text-delta" }> => e.type === "text-delta")
      .map((e) => e.text)
      .join("");
    expect(fullText.length).toBeGreaterThan(3);
    console.log("  Response:", fullText);
  }, 30000);

  it("can call a tool", async () => {
    if (!shouldRun) return;

    const events = await collectEvents(
      provider.stream({
        system: "You are a helpful assistant. When asked about weather, use the get_weather tool.",
        messages: [{ role: "user", content: "What is the weather in Beijing?" }],
        tools: [
          {
            name: "get_weather",
            description: "Get current weather for a city",
            parameters: {
              type: "object",
              properties: {
                city: { type: "string", description: "City name" },
              },
              required: ["city"],
            },
          },
        ],
      }),
    );

    const done = events.find((e) => e.type === "message-done");
    expect(done).toBeDefined();

    if (done?.type === "message-done") {
      // The model should either call the tool or respond with text
      if (done.stopReason === "tool_use") {
        expect(done.toolCalls.length).toBeGreaterThan(0);
        const call = done.toolCalls[0];
        expect(call.name).toBe("get_weather");
        expect(call.id).toBeTruthy();
        expect(call.input).toBeDefined();
        console.log("  Tool call:", call.name, call.input);
      } else {
        // Some models may respond without calling tools
        expect(done.content.length).toBeGreaterThan(0);
        console.log("  Text response (no tool call):", done.content.slice(0, 100));
      }
    }
  }, 30000);

  it("can handle multi-turn conversation", async () => {
    if (!shouldRun) return;

    // Turn 1
    const events1 = await collectEvents(
      provider.stream({
        system: "You are a helpful assistant. Be very brief.",
        messages: [{ role: "user", content: "My name is Alice." }],
      }),
    );

    const done1 = events1.find((e) => e.type === "message-done");
    expect(done1?.type).toBe("message-done");
    const reply1 = done1?.type === "message-done" ? done1.content : "";
    console.log("  Turn 1:", reply1.slice(0, 80));

    // Turn 2 — should remember the name
    const events2 = await collectEvents(
      provider.stream({
        system: "You are a helpful assistant. Be very brief.",
        messages: [
          { role: "user", content: "My name is Alice." },
          { role: "assistant", content: reply1 },
          { role: "user", content: "What is my name?" },
        ],
      }),
    );

    const done2 = events2.find((e) => e.type === "message-done");
    expect(done2?.type).toBe("message-done");
    if (done2?.type === "message-done") {
      expect(done2.content.toLowerCase()).toContain("alice");
      console.log("  Turn 2:", done2.content.slice(0, 80));
    }
  }, 60000);

  it("can handle tool result and continue", async () => {
    if (!shouldRun) return;

    // First call — expect tool use
    const events1 = await collectEvents(
      provider.stream({
        system: "You must use the calculate tool to answer math questions. Always use the tool, never calculate yourself.",
        messages: [{ role: "user", content: "What is 42 * 17?" }],
        tools: [
          {
            name: "calculate",
            description: "Calculate a math expression and return the result",
            parameters: {
              type: "object",
              properties: {
                expression: { type: "string", description: "Math expression to evaluate" },
              },
              required: ["expression"],
            },
          },
        ],
      }),
    );

    const done1 = events1.find((e) => e.type === "message-done");
    expect(done1?.type).toBe("message-done");

    if (done1?.type === "message-done" && done1.stopReason === "tool_use") {
      const toolCall = done1.toolCalls[0];
      console.log("  Tool call:", toolCall.name, toolCall.input);

      // Second call — provide tool result
      const events2 = await collectEvents(
        provider.stream({
          system: "You must use the calculate tool to answer math questions.",
          messages: [
            { role: "user", content: "What is 42 * 17?" },
            { role: "assistant", content: done1.content, toolCalls: done1.toolCalls },
            { role: "tool", toolCallId: toolCall.id, content: "714" },
          ],
          tools: [
            {
              name: "calculate",
              description: "Calculate a math expression and return the result",
              parameters: {
                type: "object",
                properties: {
                  expression: { type: "string", description: "Math expression to evaluate" },
                },
                required: ["expression"],
              },
            },
          ],
        }),
      );

      const done2 = events2.find((e) => e.type === "message-done");
      expect(done2?.type).toBe("message-done");
      if (done2?.type === "message-done") {
        expect(done2.content).toContain("714");
        expect(done2.stopReason).toBe("end");
        console.log("  Final response:", done2.content.slice(0, 100));
      }
    } else {
      console.log("  Model did not call tool, skipping continuation test");
    }
  }, 60000);

  it("handles streaming events in correct order", async () => {
    if (!shouldRun) return;

    const events = await collectEvents(
      provider.stream({
        system: "Respond with exactly two sentences.",
        messages: [{ role: "user", content: "Tell me a fun fact." }],
      }),
    );

    // message-done should be the last event
    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe("message-done");

    // All text-delta events should come before message-done
    let seenDone = false;
    for (const event of events) {
      if (event.type === "message-done") seenDone = true;
      if (event.type === "text-delta" && seenDone) {
        throw new Error("text-delta after message-done");
      }
    }

    // Concatenated text deltas should equal message-done content
    const deltaText = events
      .filter((e): e is Extract<StreamEvent, { type: "text-delta" }> => e.type === "text-delta")
      .map((e) => e.text)
      .join("");
    if (lastEvent.type === "message-done") {
      expect(deltaText).toBe(lastEvent.content);
    }
  }, 30000);
});
