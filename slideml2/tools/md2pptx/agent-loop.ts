/**
 * Anthropic Messages API agent loop with tool use.
 *
 * Implements the standard tool-use protocol:
 *   1. Send messages + tools to /v1/messages.
 *   2. If response contains tool_use blocks, execute each handler and reply
 *      with a single user message containing tool_result blocks.
 *   3. Repeat until stop_reason !== "tool_use" or the agent calls `stop`.
 *
 * Loop is bounded by `maxSteps` so a misbehaving model can't run forever.
 */

import { handleToolCall, tools, type ToolContext } from "./tools.js";

interface MessagesAPIResponse {
  id: string;
  stop_reason: string;
  content: ContentBlock[];
  usage?: { input_tokens: number; output_tokens: number };
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

interface UserContentBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[] | UserContentBlock[];
}

export interface AgentLoopOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  maxTokens?: number;
  maxSteps?: number;
  systemPrompt: string;
  userPrompt: string;
  context: ToolContext;
  onEvent?: (event: AgentEvent) => void;
}

export type AgentEvent =
  | { kind: "start"; step: number }
  | { kind: "assistant_text"; text: string }
  | { kind: "tool_call"; name: string; input: Record<string, unknown> }
  | { kind: "tool_result"; name: string; ok: boolean; sample?: string }
  | { kind: "stop"; summary: string }
  | { kind: "done"; reason: string; steps: number };

export interface AgentLoopResult {
  steps: number;
  stopReason: string;
  finalSummary: string;
  inputTokens: number;
  outputTokens: number;
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const messages: Message[] = [
    { role: "user", content: opts.userPrompt },
  ];
  const maxSteps = opts.maxSteps ?? 30;
  let inputTokens = 0;
  let outputTokens = 0;
  let finalSummary = "";

  for (let step = 0; step < maxSteps; step++) {
    opts.onEvent?.({ kind: "start", step });
    const response = await callMessagesAPI(opts, messages);
    inputTokens += response.usage?.input_tokens || 0;
    outputTokens += response.usage?.output_tokens || 0;

    // Surface assistant text immediately for visibility.
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        opts.onEvent?.({ kind: "assistant_text", text: block.text });
      }
    }

    // Add assistant message to transcript regardless.
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const text = response.content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();
      finalSummary = text;
      opts.onEvent?.({ kind: "done", reason: response.stop_reason, steps: step + 1 });
      return { steps: step + 1, stopReason: response.stop_reason, finalSummary, inputTokens, outputTokens };
    }

    // Execute every tool_use block and reply with tool_result blocks.
    const toolUses = response.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
    const results: UserContentBlock[] = [];
    let stopRequested = false;

    for (const call of toolUses) {
      opts.onEvent?.({ kind: "tool_call", name: call.name, input: call.input });
      const result = await handleToolCall(call.name, call.input, opts.context);
      const sample = sampleResult(result);
      opts.onEvent?.({ kind: "tool_result", name: call.name, ok: result.ok, sample });
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify(result, null, 2).slice(0, 18_000),
        is_error: result.ok ? undefined : true,
      });
      if (call.name === "stop" && result.ok) {
        const summary = (result.data && typeof result.data === "object" && "summary" in result.data) ? String((result.data as { summary?: unknown }).summary || "") : "";
        finalSummary = summary;
        stopRequested = true;
        opts.onEvent?.({ kind: "stop", summary });
      }
    }

    messages.push({ role: "user", content: results });

    if (stopRequested) {
      opts.onEvent?.({ kind: "done", reason: "stop_tool", steps: step + 1 });
      return { steps: step + 1, stopReason: "stop_tool", finalSummary, inputTokens, outputTokens };
    }
  }

  opts.onEvent?.({ kind: "done", reason: "max_steps", steps: maxSteps });
  return { steps: maxSteps, stopReason: "max_steps", finalSummary, inputTokens, outputTokens };
}

async function callMessagesAPI(opts: AgentLoopOptions, messages: Message[]): Promise<MessagesAPIResponse> {
  const url = `${normalizeBase(opts.baseURL)}/v1/messages`;
  const body = JSON.stringify({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.systemPrompt,
    tools,
    messages,
    stream: false,
  });
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body,
    });
    if (response.ok) return await response.json() as MessagesAPIResponse;
    const text = await response.text();
    lastError = `Messages API ${response.status}: ${text.slice(0, 600)}`;
    if (!isRetryableStatus(response.status)) throw new Error(lastError);
    await sleep(1000 * Math.pow(2, attempt));
  }
  throw new Error(lastError);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 520 || status === 529;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sampleResult(result: { ok: boolean; data?: unknown; error?: string }): string {
  if (!result.ok) return result.error ? result.error.slice(0, 120) : "(error)";
  if (result.data === undefined) return "ok";
  try {
    const json = JSON.stringify(result.data);
    return json.slice(0, 160);
  } catch {
    return String(result.data).slice(0, 160);
  }
}

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/v1$/, "");
}
