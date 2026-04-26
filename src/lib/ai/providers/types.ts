/** Unified types for LLM provider abstraction. */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface StreamParams {
  system: string;
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  /** Cap on tokens the model may generate. Forwarded to the underlying API.
   *  When omitted, providers fall back to a conservative default. */
  maxOutputTokens?: number;
}

export type LLMMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export type StreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; id: string; name: string; input: unknown }
  | { type: "message-done"; content: string; toolCalls: ToolCall[]; stopReason: "end" | "tool_use" | "max_tokens" };

export interface LLMProvider {
  stream(params: StreamParams): AsyncIterable<StreamEvent>;
}
