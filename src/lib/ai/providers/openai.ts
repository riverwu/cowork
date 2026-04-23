import { httpStreamPost } from "@/lib/tauri";
import type { LLMProvider, StreamParams, StreamEvent, ToolCall, LLMMessage, ToolDefinition } from "./types";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private baseURL: string;
  private model: string;

  constructor(apiKey: string, model?: string, baseURL?: string) {
    this.apiKey = apiKey;
    this.baseURL = (baseURL || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.model = model || "gpt-4o";
  }

  async *stream(params: StreamParams): AsyncIterable<StreamEvent> {
    const messages = [
      { role: "system", content: params.system },
      ...params.messages.map((m) => toOpenAIMessage(m)),
    ];

    const tools = params.tools?.map((t) => toOpenAITool(t));

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const url = `${this.baseURL}/chat/completions`;
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.apiKey}`,
    };

    let fullText = "";
    const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const data of httpStreamPost(url, headers, JSON.stringify(body))) {
      if (data === "[DONE]") continue;

      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        fullText += delta.content;
        yield { type: "text-delta", text: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallsMap.has(idx)) {
            toolCallsMap.set(idx, { id: tc.id || "", name: tc.function?.name || "", arguments: "" });
          }
          const entry = toolCallsMap.get(idx)!;
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = tc.function.name;
          if (tc.function?.arguments) entry.arguments += tc.function.arguments;
        }
      }

      const finish = chunk.choices?.[0]?.finish_reason;
      if (finish) {
        const toolCalls: ToolCall[] = [];
        for (const [, entry] of toolCallsMap) {
          const input = entry.arguments ? JSON.parse(entry.arguments) : {};
          const tc: ToolCall = { id: entry.id, name: entry.name, input };
          toolCalls.push(tc);
          yield { type: "tool-call", ...tc };
        }

        yield {
          type: "message-done",
          content: fullText,
          toolCalls,
          stopReason: finish === "tool_calls" ? "tool_use" : "end",
        };
      }
    }
  }
}

function toOpenAIMessage(msg: LLMMessage) {
  if (msg.role === "user") return { role: "user", content: msg.content };
  if (msg.role === "assistant") {
    const toolCalls = msg.toolCalls?.map((tc) => ({
      id: tc.id, type: "function" as const,
      function: { name: tc.name, arguments: JSON.stringify(tc.input) },
    }));
    return { role: "assistant", content: msg.content || null, ...(toolCalls?.length ? { tool_calls: toolCalls } : {}) };
  }
  return { role: "tool", tool_call_id: msg.toolCallId, content: msg.content };
}

function toOpenAITool(tool: ToolDefinition) {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}
