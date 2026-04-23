import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, StreamParams, StreamEvent, ToolCall, LLMMessage, ToolDefinition } from "./types";

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true, // Desktop app — no server
    });
    this.model = model || "claude-sonnet-4-20250514";
  }

  async *stream(params: StreamParams): AsyncIterable<StreamEvent> {
    const messages = params.messages.map((m) => toAnthropicMessage(m));
    const tools = params.tools?.map((t) => toAnthropicTool(t));

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      system: params.system,
      messages,
      ...(tools && tools.length > 0 ? { tools } : {}),
    });

    let fullText = "";
    const toolCalls: ToolCall[] = [];
    let currentToolId = "";
    let currentToolName = "";
    let currentToolInput = "";

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          currentToolId = event.content_block.id;
          currentToolName = event.content_block.name;
          currentToolInput = "";
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          fullText += event.delta.text;
          yield { type: "text-delta", text: event.delta.text };
        } else if (event.delta.type === "input_json_delta") {
          currentToolInput += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        if (currentToolName) {
          const input = currentToolInput ? JSON.parse(currentToolInput) : {};
          const tc: ToolCall = { id: currentToolId, name: currentToolName, input };
          toolCalls.push(tc);
          yield { type: "tool-call", ...tc };
          currentToolName = "";
          currentToolInput = "";
        }
      } else if (event.type === "message_stop") {
        // handled after loop
      }
    }

    const finalMessage = await stream.finalMessage();
    const stopReason = finalMessage.stop_reason === "tool_use" ? "tool_use" : "end";

    yield {
      type: "message-done",
      content: fullText,
      toolCalls,
      stopReason,
    };
  }
}

function toAnthropicMessage(msg: LLMMessage): Anthropic.MessageParam {
  if (msg.role === "user") {
    return { role: "user", content: msg.content };
  }
  if (msg.role === "assistant") {
    const content: Anthropic.ContentBlockParam[] = [];
    if (msg.content) {
      content.push({ type: "text", text: msg.content });
    }
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.input as Record<string, unknown>,
        });
      }
    }
    return { role: "assistant", content };
  }
  // tool result
  return {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: msg.toolCallId,
        content: msg.content,
      },
    ],
  };
}

function toAnthropicTool(tool: ToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool["input_schema"],
  };
}
