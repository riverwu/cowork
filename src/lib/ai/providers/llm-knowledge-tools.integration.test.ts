import { describe, it, expect, beforeAll } from "vitest";
import type { LLMMessage, StreamEvent, ToolCall, ToolDefinition } from "./types";

let apiKey: string;
let baseURL: string;
let model: string;
let shouldRun = false;

beforeAll(() => {
  apiKey = process.env.LLM_API_KEY || process.env.MINIMAX_API_KEY || "";
  baseURL = normalizeAnthropicBaseURL(process.env.LLM_API || process.env.MINIMAX_API || "");
  model = process.env.LLM_MODEL || "MiniMax-M2.7-highspeed";
  shouldRun = !!(apiKey && baseURL);
});

const knowledgeTools: ToolDefinition[] = [
  {
    name: "list_knowledge_sources",
    description: "List configured knowledge sources and their capabilities. Use this first when the relevant work data source is not obvious.",
    parameters: {
      type: "object",
      properties: {
        include_capabilities: { type: "boolean" },
      },
      required: ["include_capabilities"],
    },
  },
  {
    name: "get_source_catalog",
    description: "Inspect a specific knowledge source catalog, including documents, sheets, tables, schemas, and recommended access tools.",
    parameters: {
      type: "object",
      properties: {
        source_id: { type: "string" },
        limit: { type: "number" },
      },
      required: ["source_id"],
    },
  },
  {
    name: "search_knowledge",
    description: "Search indexed document excerpts semantically. Use for document text lookup, not for spreadsheet numeric analysis.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        top_k: { type: "number" },
        action: { type: "string", enum: ["search", "stats", "sources"] },
      },
      required: ["query"],
    },
  },
  {
    name: "run_python",
    description: "Run Python to inspect or analyze original local files such as xlsx, csv, docx, pdf, pptx when exact file processing is needed.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string" },
        install_package: { type: "string" },
      },
      required: ["code"],
    },
  },
];

async function* streamChat(params: {
  system: string;
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
}): AsyncGenerator<StreamEvent> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: params.maxTokens ?? 1024,
    system: params.system,
    messages: params.messages.map(toAnthropicMessage),
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
  let toolId = "";
  let toolName = "";
  let toolInput = "";
  let stopReason: "end" | "tool_use" | "max_tokens" = "end";

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
      let ev: AnthropicStreamEvent;
      try {
        ev = JSON.parse(data) as AnthropicStreamEvent;
      } catch {
        continue;
      }

      if (ev.type === "content_block_start") {
        blockType = ev.content_block?.type || null;
        if (blockType === "tool_use") {
          toolId = ev.content_block?.id || "";
          toolName = ev.content_block?.name || "";
          toolInput = "";
        }
      } else if (ev.type === "content_block_delta") {
        if (ev.delta?.type === "text_delta") {
          fullText += ev.delta.text || "";
          yield { type: "text-delta", text: ev.delta.text || "" };
        } else if (ev.delta?.type === "input_json_delta") {
          toolInput += ev.delta.partial_json || "";
        }
      } else if (ev.type === "content_block_stop") {
        if (blockType === "tool_use" && toolName) {
          const input = toolInput ? JSON.parse(toolInput) : {};
          const tc: ToolCall = { id: toolId, name: toolName, input };
          toolCalls.push(tc);
          yield { type: "tool-call", ...tc };
        }
        blockType = null;
        toolName = "";
      } else if (ev.type === "message_delta") {
        if (ev.delta?.stop_reason === "tool_use") stopReason = "tool_use";
        if (ev.delta?.stop_reason === "max_tokens") stopReason = "max_tokens";
      }
    }
  }

  yield { type: "message-done", content: fullText, toolCalls, stopReason };
}

function toAnthropicMessage(message: LLMMessage): Record<string, unknown> {
  if (message.role === "user") return { role: "user", content: message.content };
  if (message.role === "tool") {
    return { role: "user", content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }] };
  }
  const content: Record<string, unknown>[] = [];
  if (message.content) content.push({ type: "text", text: message.content });
  for (const tc of message.toolCalls || []) {
    content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
  }
  return { role: "assistant", content };
}

async function firstDone(params: Parameters<typeof streamChat>[0]): Promise<Extract<StreamEvent, { type: "message-done" }>> {
  let done: Extract<StreamEvent, { type: "message-done" }> | null = null;
  for await (const event of streamChat(params)) {
    if (event.type === "message-done") done = event;
  }
  if (!done) throw new Error("No message-done event");
  return done;
}

const routingSystem = `You are testing knowledge-base tool routing.
Call exactly one tool and do not answer directly.
Rules:
- If the relevant work data source is unknown, call list_knowledge_sources.
- If a source id is known but its structure or file list is needed, call get_source_catalog.
- For semantic text lookup in indexed documents, call search_knowledge.
- For spreadsheet, CSV, PDF, DOCX, or PPTX exact analysis after a file path is known, call run_python on the original file.`;

describe("LLM knowledge tool routing integration", () => {
  it("discovers knowledge sources before searching unknown work data", async () => {
    if (!shouldRun) return;
    const done = await firstDone({
      system: routingSystem,
      messages: [{ role: "user", content: "根据我工作资料里的历史项目和文档，帮我找出销售线索。先判断应该看哪些知识源。" }],
      tools: knowledgeTools,
    });

    expect(done.stopReason).toBe("tool_use");
    expect(done.toolCalls[0]?.name).toBe("list_knowledge_sources");
  }, 30000);

  it("inspects a known source catalog before choosing file access", async () => {
    if (!shouldRun) return;
    const done = await firstDone({
      system: routingSystem,
      messages: [{ role: "user", content: "知识源 id 是 docs_source_1。请先查看这个源里有哪些文件、表格、能力，再决定怎么分析。" }],
      tools: knowledgeTools,
    });

    expect(done.stopReason).toBe("tool_use");
    expect(done.toolCalls[0]?.name).toBe("get_source_catalog");
    expect(done.toolCalls[0]?.input).toMatchObject({ source_id: "docs_source_1" });
  }, 30000);

  it("uses semantic knowledge search for document text questions", async () => {
    if (!shouldRun) return;
    const done = await firstDone({
      system: routingSystem,
      messages: [{ role: "user", content: "在已索引文档里搜索 wearable hardware 的失败案例和关键原因，返回相关片段。" }],
      tools: knowledgeTools,
    });

    expect(done.stopReason).toBe("tool_use");
    expect(done.toolCalls[0]?.name).toBe("search_knowledge");
  }, 30000);

  it("uses original file analysis for spreadsheet-style tasks after catalog gives a path", async () => {
    if (!shouldRun) return;
    const done = await firstDone({
      system: routingSystem,
      messages: [{
        role: "user",
        content:
          "Catalog says source sales_source has an entity [spreadsheet_sheet] Revenue, path: /Users/river/Documents/Workspace/revenue.xlsx, columns: month, product, revenue. 请计算每个产品的收入总和。",
      }],
      tools: knowledgeTools,
    });

    expect(done.stopReason).toBe("tool_use");
    expect(done.toolCalls[0]?.name).toBe("run_python");
    expect(JSON.stringify(done.toolCalls[0]?.input)).toContain("revenue.xlsx");
  }, 30000);

  it("can continue from a knowledge tool result and cite the source", async () => {
    if (!shouldRun) return;
    const toolCall: ToolCall = {
      id: "toolu_test_knowledge_1",
      name: "search_knowledge",
      input: { query: "AI Pin failure reasons", top_k: 3 },
    };
    const done = await firstDone({
      system: "You are in final-answer phase. The previous search_knowledge tool result is sufficient. Do not call any tools. Answer briefly in Chinese and include the source filename.",
      messages: [
        { role: "user", content: "总结 Humane AI Pin 失败原因。" },
        { role: "assistant", content: "", toolCalls: [toolCall] },
        { role: "tool", toolCallId: toolCall.id, content: "[1] (from AI_Agent时代可穿戴硬件发展趋势调研报告.md)\n失败原因：定价高、技术问题、缺乏生态系统。" },
      ],
      tools: knowledgeTools,
    });

    expect(done.stopReason).toBe("end");
    expect(done.content).toContain("AI_Agent时代可穿戴硬件发展趋势调研报告.md");
  }, 30000);
});

interface AnthropicStreamEvent {
  type: string;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
}

function normalizeAnthropicBaseURL(raw: string): string {
  return raw.replace(/\/+$/, "").replace(/\/v1$/, "");
}
