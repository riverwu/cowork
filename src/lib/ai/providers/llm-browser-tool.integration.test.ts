import { beforeAll, describe, expect, it } from "vitest";
import { browserTool } from "../tools/browser";
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

const browserRoutingSystem = `You are testing Cowork's browser tool routing.
Call exactly one browser tool and do not answer directly.

Rules:
- The only available tool is browser.
- For JavaScript-rendered pages or SPAs, call browser with actions: open, then extract or snapshot. Preserve exact root URLs and hash URLs; do not synthesize path routes.
- For finding text in a large rendered page or DOM, call grep. For reading a large page in chunks, call read with offset and max_chars.
- If the user needs to log in or visually debug, call browser with headed/open or show.
- If the user gives refs from a latest snapshot, use those refs for click/type/select/upload/check/press. Do not invent refs when none are provided.
- For browser state debugging, use cookies, storage, diagnostics, or evaluate only as requested.
- For screenshots, PDFs, or downloads, use screenshot, pdf, or downloads actions.`;

async function* streamChat(params: {
  system: string;
  messages: LLMMessage[];
  tools: ToolDefinition[];
  maxTokens?: number;
}): AsyncGenerator<StreamEvent> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: params.maxTokens ?? 1024,
    system: params.system,
    messages: params.messages.map(toAnthropicMessage),
    stream: true,
    tools: params.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    })),
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

async function firstDone(userContent: string): Promise<Extract<StreamEvent, { type: "message-done" }>> {
  let done: Extract<StreamEvent, { type: "message-done" }> | null = null;
  for await (const event of streamChat({
    system: browserRoutingSystem,
    messages: [{ role: "user", content: userContent }],
    tools: [browserTool.definition],
  })) {
    if (event.type === "message-done") done = event;
  }
  if (!done) throw new Error("No message-done event");
  return done;
}

function firstBrowserInput(done: Extract<StreamEvent, { type: "message-done" }>): BrowserToolInput {
  expect(done.stopReason).toBe("tool_use");
  expect(done.toolCalls[0]?.name).toBe("browser");
  const input = done.toolCalls[0]?.input as BrowserToolInput;
  expect(Array.isArray(input.actions)).toBe(true);
  expect(input.actions.length).toBeGreaterThan(0);
  return input;
}

describe("LLM browser tool routing integration", () => {
  it("routes SPA research to the exact root URL without inventing a path URL", async () => {
    if (!shouldRun) return;

    const input = firstBrowserInput(await firstDone(
      "使用内置 browser 获取 https://ir.youdao.com 的公司介绍信息。这个站点是 SPA，请不要猜测 /company-profile 这样的路径。",
    ));

    expect(input.actions[0]).toMatchObject({ action: "open", url: "https://ir.youdao.com" });
    const urls = input.actions.map((action) => action.url).filter(Boolean).join("\n");
    expect(urls).not.toContain("/company-profile");
  }, 30000);

  it("uses visible browser mode for login handoff", async () => {
    if (!shouldRun) return;

    const input = firstBrowserInput(await firstDone(
      "打开 https://example.com/login。用户需要在受控浏览器里手动登录，所以请让浏览器可见，然后等待页面变化。",
    ));

    expect(input.actions.some((action) => action.action === "show" || action.headed === true)).toBe(true);
  }, 30000);

  it("uses provided refs for form filling instead of selectors", async () => {
    if (!shouldRun) return;

    const input = firstBrowserInput(await firstDone(
      "最新 snapshot 中 email 输入框 ref=3，套餐 select ref=4，文件上传 ref=5，同意条款 checkbox ref=6，提交按钮 ref=7。请填写 river@example.com，选择 enterprise，上传 /Users/river/Documents/Workspace/report.pdf，勾选并提交。",
    ));

    expect(input.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "type", ref: 3, text: "river@example.com" }),
      expect.objectContaining({ action: "select", ref: 4 }),
      expect.objectContaining({ action: "upload", ref: 5 }),
      expect.objectContaining({ action: "check", ref: 6 }),
    ]));
    expect(input.actions.some((action) => action.ref === 7 && (action.action === "click" || action.action === "press"))).toBe(true);
    expect(JSON.stringify(input.actions)).not.toContain("selector");
  }, 30000);

  it("routes large page code search and chunked reading to grep and read", async () => {
    if (!shouldRun) return;

    const input = firstBrowserInput(await firstDone(
      "当前页面很大，不能一次读完。请先在页面 HTML 中查找 Financial 这个词，再从渲染文本 offset=8000 开始分段读取 3000 字符。",
    ));

    expect(input.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "grep" }),
      expect.objectContaining({ action: "read", offset: 8000, max_chars: 3000 }),
    ]));
  }, 30000);

  it("routes debugging requests to storage cookies diagnostics and evaluate", async () => {
    if (!shouldRun) return;

    const input = firstBrowserInput(await firstDone(
      "当前页面已打开。请检查 cookie、localStorage、console/network 错误，并用高级兜底读取 document.title。",
    ));

    const actions = input.actions.map((action) => action.action);
    expect(actions).toEqual(expect.arrayContaining(["cookies", "storage", "diagnostics", "evaluate"]));
  }, 30000);

  it("routes artifact capture to screenshot pdf and downloads actions", async () => {
    if (!shouldRun) return;

    const input = firstBrowserInput(await firstDone(
      "当前页面已打开。请截取整页截图，导出 PDF，并查看最近下载文件。",
    ));

    const actions = input.actions.map((action) => action.action);
    expect(actions).toEqual(expect.arrayContaining(["screenshot", "pdf", "downloads"]));
  }, 30000);
});

interface BrowserToolInput {
  actions: Array<{
    action: string;
    url?: string;
    headed?: boolean;
    ref?: number;
    text?: string;
  }>;
}

interface AnthropicStreamEvent {
  type: string;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
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

function normalizeAnthropicBaseURL(raw: string): string {
  return raw.replace(/\/+$/, "").replace(/\/v1$/, "");
}
