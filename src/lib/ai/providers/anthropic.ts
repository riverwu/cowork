import { httpStreamPost } from "@/lib/tauri";
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
      max_tokens: 16384,
      system: params.system,
      messages,
      stream: true,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const url = `${this.baseURL}/v1/messages`;
    const headers: Record<string, string> = {
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };

    let fullText = "";
    const toolCalls: ToolCall[] = [];
    let currentBlockType: string | null = null;
    let currentToolId = "";
    let currentToolName = "";
    let currentToolInput = "";
    let stopReason: "end" | "tool_use" = "end";

    for await (const data of httpStreamPost(url, headers, JSON.stringify(body))) {
      if (data === "[DONE]") continue;

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
      } else if (event.type === "content_block_stop") {
        if (currentBlockType === "tool_use" && currentToolName) {
          let input: Record<string, unknown> = {};
          try {
            input = currentToolInput ? JSON.parse(currentToolInput) : {};
          } catch {
            // Truncated JSON (likely hit max_tokens). Pass raw string so agent can report it.
            input = { _raw: currentToolInput, _error: "Truncated tool call input" };
          }
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
        } else if (event.delta?.stop_reason === "max_tokens") {
          stopReason = "end"; // Truncated — treat as done, don't try to parse incomplete tool calls
        }
      } else if (event.type === "error") {
        throw new Error(`API error: ${JSON.stringify(event.error)}`);
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
  return {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: msg.toolCallId, content: msg.content }],
  };
}

function toAnthropicTool(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}
