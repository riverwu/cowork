import { describe, it, expect, beforeAll } from "vitest";
import type { StreamEvent, ToolCall, LLMMessage } from "./types";

/**
 * Integration tests for LLM API using raw fetch (Node environment).
 * Uses MINIMAX_API and MINIMAX_API_KEY from environment.
 * Skipped if env vars are not set.
 */

let apiKey: string;
let baseURL: string;
const model = "MiniMax-M2.7-highspeed";
let shouldRun = false;

beforeAll(() => {
  apiKey = process.env.MINIMAX_API_KEY || "";
  baseURL = (process.env.MINIMAX_API || "").replace(/\/$/, "");
  shouldRun = !!(apiKey && baseURL);
});

/** Raw fetch streaming — same protocol as AnthropicProvider but using Node fetch. */
async function* streamChat(params: {
  system: string;
  messages: LLMMessage[];
  tools?: { name: string; description: string; parameters: Record<string, unknown> }[];
}): AsyncGenerator<StreamEvent> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    system: params.system,
    messages: params.messages.map((m) => {
      if (m.role === "user") return { role: "user", content: m.content };
      if (m.role === "assistant") {
        const content: unknown[] = [];
        if (m.content) content.push({ type: "text", text: m.content });
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
          }
        }
        return { role: "assistant", content };
      }
      return { role: "user", content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }] };
    }),
    stream: true,
    ...(params.tools?.length ? { tools: params.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
  };

  const response = await fetch(`${baseURL}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`API error ${response.status}: ${await response.text()}`);
  if (!response.body) throw new Error("No body");

  let fullText = "";
  const toolCalls: ToolCall[] = [];
  let blockType: string | null = null;
  let toolId = "", toolName = "", toolInput = "";
  let stopReason: "end" | "tool_use" = "end";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") continue;
      let ev;
      try { ev = JSON.parse(data); } catch { continue; }

      if (ev.type === "content_block_start") {
        blockType = ev.content_block?.type;
        if (blockType === "tool_use") { toolId = ev.content_block.id; toolName = ev.content_block.name; toolInput = ""; }
      } else if (ev.type === "content_block_delta") {
        if (ev.delta?.type === "text_delta") { fullText += ev.delta.text; yield { type: "text-delta", text: ev.delta.text }; }
        else if (ev.delta?.type === "input_json_delta") { toolInput += ev.delta.partial_json; }
      } else if (ev.type === "content_block_stop") {
        if (blockType === "tool_use" && toolName) {
          const tc: ToolCall = { id: toolId, name: toolName, input: toolInput ? JSON.parse(toolInput) : {} };
          toolCalls.push(tc);
          yield { type: "tool-call", ...tc };
        }
        blockType = null; toolName = "";
      } else if (ev.type === "message_delta") {
        if (ev.delta?.stop_reason === "tool_use") stopReason = "tool_use";
      }
    }
  }

  yield { type: "message-done", content: fullText, toolCalls, stopReason };
}

async function collectEvents(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const e of iter) events.push(e);
  return events;
}

describe("LLM Integration", () => {
  it("can stream a simple text response", async () => {
    if (!shouldRun) return;
    const events = await collectEvents(streamChat({ system: "Respond in one short sentence.", messages: [{ role: "user", content: "Say hello." }] }));
    const textDeltas = events.filter((e) => e.type === "text-delta");
    expect(textDeltas.length).toBeGreaterThan(0);
    const done = events.find((e) => e.type === "message-done");
    expect(done?.type).toBe("message-done");
    if (done?.type === "message-done") { expect(done.content.length).toBeGreaterThan(0); expect(done.stopReason).toBe("end"); }
  }, 30000);

  it("can call a tool", async () => {
    if (!shouldRun) return;
    const events = await collectEvents(streamChat({
      system: "When asked about weather, use the get_weather tool.",
      messages: [{ role: "user", content: "What is the weather in Beijing?" }],
      tools: [{ name: "get_weather", description: "Get weather for a city", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }],
    }));
    const done = events.find((e) => e.type === "message-done");
    expect(done).toBeDefined();
    if (done?.type === "message-done" && done.stopReason === "tool_use") {
      expect(done.toolCalls[0].name).toBe("get_weather");
    }
  }, 30000);

  it("can handle multi-turn conversation", async () => {
    if (!shouldRun) return;
    const events1 = await collectEvents(streamChat({ system: "Be brief.", messages: [{ role: "user", content: "My name is Alice." }] }));
    const reply1 = (events1.find((e) => e.type === "message-done") as Extract<StreamEvent, { type: "message-done" }>)?.content || "";
    const events2 = await collectEvents(streamChat({
      system: "Be brief.",
      messages: [{ role: "user", content: "My name is Alice." }, { role: "assistant", content: reply1 }, { role: "user", content: "What is my name?" }],
    }));
    const done2 = events2.find((e) => e.type === "message-done");
    if (done2?.type === "message-done") expect(done2.content.toLowerCase()).toContain("alice");
  }, 60000);

  it("can handle tool result and continue", async () => {
    if (!shouldRun) return;
    const events1 = await collectEvents(streamChat({
      system: "You must use the calculate tool for math. Always use the tool.",
      messages: [{ role: "user", content: "What is 42 * 17?" }],
      tools: [{ name: "calculate", description: "Calculate a math expression", parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] } }],
    }));
    const done1 = events1.find((e) => e.type === "message-done");
    if (done1?.type === "message-done" && done1.stopReason === "tool_use") {
      const tc = done1.toolCalls[0];
      const events2 = await collectEvents(streamChat({
        system: "You must use the calculate tool for math.",
        messages: [
          { role: "user", content: "What is 42 * 17?" },
          { role: "assistant", content: done1.content, toolCalls: done1.toolCalls },
          { role: "tool", toolCallId: tc.id, content: "714" },
        ],
        tools: [{ name: "calculate", description: "Calculate a math expression", parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] } }],
      }));
      const done2 = events2.find((e) => e.type === "message-done");
      if (done2?.type === "message-done") { expect(done2.content).toContain("714"); expect(done2.stopReason).toBe("end"); }
    }
  }, 60000);

  it("handles streaming events in correct order", async () => {
    if (!shouldRun) return;
    const events = await collectEvents(streamChat({ system: "Respond with two sentences.", messages: [{ role: "user", content: "Tell me a fun fact." }] }));
    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe("message-done");
    let seenDone = false;
    for (const e of events) { if (e.type === "message-done") seenDone = true; if (e.type === "text-delta" && seenDone) throw new Error("text-delta after done"); }
    const deltaText = events.filter((e): e is Extract<StreamEvent, { type: "text-delta" }> => e.type === "text-delta").map((e) => e.text).join("");
    if (lastEvent.type === "message-done") expect(deltaText).toBe(lastEvent.content);
  }, 30000);
});
