import type { LLMProvider, StreamParams, StreamEvent, ToolCall, LLMMessage, ToolDefinition } from "./types";

const DEFAULT_BASE_URL = "https://api.anthropic.com";

export class AnthropicProvider implements LLMProvider {
  private apiKey: string;
  private baseURL: string;
  private model: string;

  constructor(apiKey: string, model?: string, baseURL?: string) {
    this.apiKey = apiKey;
    this.baseURL = (baseURL || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.model = model || "claude-sonnet-4-20250514";
  }

  async *stream(params: StreamParams): AsyncIterable<StreamEvent> {
    const messages = params.messages.map((m) => toAnthropicMessage(m));
    const tools = params.tools?.map((t) => toAnthropicTool(t));

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4096,
      system: params.system,
      messages,
      stream: true,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch(`${this.baseURL}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error ${response.status}: ${errText}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    let fullText = "";
    const toolCalls: ToolCall[] = [];
    let currentBlockType: string | null = null;
    let currentToolId = "";
    let currentToolName = "";
    let currentToolInput = "";
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

        let event;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        if (event.type === "content_block_start") {
          currentBlockType = event.content_block?.type || null;
          if (currentBlockType === "tool_use") {
            currentToolId = event.content_block.id;
            currentToolName = event.content_block.name;
            currentToolInput = "";
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta?.type === "text_delta") {
            fullText += event.delta.text;
            yield { type: "text-delta", text: event.delta.text };
          } else if (event.delta?.type === "input_json_delta") {
            currentToolInput += event.delta.partial_json;
          }
          // Skip thinking_delta, signature_delta
        } else if (event.type === "content_block_stop") {
          if (currentBlockType === "tool_use" && currentToolName) {
            const input = currentToolInput ? JSON.parse(currentToolInput) : {};
            const tc: ToolCall = { id: currentToolId, name: currentToolName, input };
            toolCalls.push(tc);
            yield { type: "tool-call", ...tc };
          }
          currentBlockType = null;
          currentToolName = "";
          currentToolInput = "";
        } else if (event.type === "message_delta") {
          if (event.delta?.stop_reason === "tool_use") {
            stopReason = "tool_use";
          }
        }
      }
    }

    yield {
      type: "message-done",
      content: fullText,
      toolCalls,
      stopReason,
    };
  }
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContent[];
}

type AnthropicContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

function toAnthropicMessage(msg: LLMMessage): AnthropicMessage {
  if (msg.role === "user") {
    return { role: "user", content: msg.content };
  }
  if (msg.role === "assistant") {
    const content: AnthropicContent[] = [];
    if (msg.content) {
      content.push({ type: "text", text: msg.content });
    }
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
      }
    }
    return { role: "assistant", content };
  }
  // tool result → wrapped in user message
  return {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: msg.toolCallId, content: msg.content }],
  };
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function toAnthropicTool(tool: ToolDefinition): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}
