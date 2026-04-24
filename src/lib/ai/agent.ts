import { getConfiguredProvider } from "./providers";
import type { LLMMessage, StreamEvent } from "./providers/types";
import { getTools } from "./tools/registry";
import { skillRegistry } from "./skill-registry";
import { getSkillsDir } from "./skill-loader";
import { buildSystemPrompt } from "./system-prompt";
import { retrieveRelevant, buildKnowledgeContext } from "@/lib/knowledge";
import { retrieveMemoryContext, buildMemoryPrompt, extractMemories } from "@/lib/memory";
import { mcpManager } from "@/lib/mcp";
import type { AgentEvent } from "@/types";
import { buildLongTaskPrompt, detectLongTask } from "./long-task";
import { setCurrentLongTask } from "./task-context";
import { isToolResultFailure } from "./tool-result";

const MAX_STEPS = 25;
const MAX_TRUNCATION_RECOVERIES = 3;
const MAX_TOOL_RESULT_CHARS_FOR_LLM = 12000;

export interface AgentParams {
  messages: LLMMessage[];
  sessionId: string;
  skipKnowledge?: boolean;
  planMode?: boolean;
  /** Working directory — tools use this as default cwd. */
  workingDirectory?: string;
  /** Called when a skill produces streaming output (e.g., shell command output). */
  onProgress?: (skill: string, output: string) => void;
}

/**
 * Core agent loop. Async generator that yields events for the UI to consume.
 *
 * Flow:
 *   1. Retrieve memory context (core facts + semantic memories + episodes)
 *   2. Retrieve relevant knowledge (RAG)
 *   3. Build system prompt with memory + knowledge
 *   4. Loop: call LLM → yield streaming events → execute tool calls → repeat
 *   5. Until LLM stops calling tools (task complete)
 *   6. After completion: extract memories from conversation (async, non-blocking)
 */
export async function* runAgent(params: AgentParams): AsyncGenerator<AgentEvent> {
  const provider = await getConfiguredProvider();

  // Wait for MCP servers to finish connecting (with timeout)
  await mcpManager.waitForReady();
  if (!skillRegistry.isLoaded()) {
    await skillRegistry.initialize().catch((err) => {
      console.warn("[Agent] Skill registry failed to initialize:", err);
    });
  }

  // Merge built-in tools + MCP tools
  // Note: user-installed skills (SKILL.md) are NOT tools — they're injected
  // into the system prompt as a list. The LLM reads them on-demand via read_file.
  const builtinTools = getTools();
  const mcpTools = mcpManager.getAllTools();
  const allTools = { ...builtinTools, ...mcpTools };
  const toolDefs = Object.values(allTools).map((t) => t.definition);

  console.log(`[Agent] Tools: ${toolDefs.length} total (${Object.keys(builtinTools).length} built-in + ${Object.keys(mcpTools).length} MCP)`);
  if (Object.keys(mcpTools).length > 0) {
    console.log(`[Agent] MCP tools:`, Object.keys(mcpTools));
  }

  const lastUserMsg = [...params.messages].reverse().find((m) => m.role === "user");
  const query = lastUserMsg?.content || "";

  // 1. Retrieve memory context
  let memoryContext = "";
  try {
    const memCtx = await retrieveMemoryContext(query);
    memoryContext = buildMemoryPrompt(memCtx);
  } catch {
    // Memory retrieval failed — continue without
  }

  // 2. Retrieve knowledge context
  let knowledgeContext = "";
  if (!params.skipKnowledge && query && !isKnowledgeDiscoveryRequest(query)) {
    try {
      const results = await retrieveRelevant(query, 5);
      if (results.length > 0) {
        knowledgeContext = buildKnowledgeContext(results);
        yield {
          type: "knowledge-ref",
          refs: results.map((r) => ({
            documentId: r.documentId,
            filename: (r.metadata?.filename as string) || "unknown",
            snippet: r.content.slice(0, 100),
          })),
        };
      }
    } catch {
      // Knowledge retrieval failed — continue without
    }
  }

  // 3. Build system prompt with system paths + MCP status
  let skillsDir = "";
  try { skillsDir = await getSkillsDir(); } catch { /* ignore */ }
  const home = skillsDir.replace(/\/\.cowork\/skills$/, "");

  // Gather MCP server status for system prompt
  const mcpStatuses = mcpManager.getServerStatus();
  const mcpSummary = mcpStatuses
    .filter((s) => s.enabled)
    .map((s) => {
      if (s.status === "available") return `- ✓ ${s.name}: available (${s.toolCount} tools)`;
      if (s.status === "needs_config") return `- ✗ ${s.name}: needs configuration`;
      if (s.status === "error") return `- ✗ ${s.name}: error (${s.error || "unknown"})`;
      return `- ${s.name}: ${s.status}`;
    })
    .join("\n");

  // Skills are injected as a list (name + description + path) — not as tools.
  // LLM reads SKILL.md on-demand via read_file (progressive disclosure).
  const availableSkillsPrompt = skillRegistry.getAvailableSkillsPrompt();

  const longTask = detectLongTask(params.messages, params.workingDirectory);
  setCurrentLongTask(longTask);
  if (longTask) {
    yield {
      type: "long-task-start",
      runId: longTask.runId,
      workspaceDir: longTask.workspaceDir,
      reason: longTask.reason,
    };
  }

  const system = buildSystemPrompt({
    tools: toolDefs,
    memoryContext: memoryContext || undefined,
    knowledgeContext: knowledgeContext || undefined,
    longTaskContext: longTask ? buildLongTaskPrompt(longTask) : undefined,
    planMode: params.planMode,
    workingDirectory: params.workingDirectory,
    availableSkillsPrompt: availableSkillsPrompt || undefined,
    systemPaths: {
      skills: skillsDir,
      mcp: `${home}/.cowork/mcps/`,
      mcpSummary: mcpSummary || undefined,
    },
  });

  // 4. Agent loop
  const currentMessages: LLMMessage[] = [...params.messages];
  let fullAssistantText = "";
  let hitStepLimit = true;
  let truncationRecoveries = 0;

  try {
  for (let step = 0; step < MAX_STEPS; step++) {
    let doneEvent: StreamEvent | null = null;

    // Signal LLM is thinking (waiting for response)
    yield { type: "thinking", active: true };

    try {
      for await (const event of provider.stream({
        system,
        messages: currentMessages,
        tools: toolDefs,
      })) {
        if (event.type === "text-delta") {
          yield { type: "text-delta", text: event.text };
        } else if (event.type === "message-done") {
          doneEvent = event;
        }
      }
    } catch (err) {
      yield { type: "thinking", active: false };
      yield { type: "error", error: `LLM request failed: ${err instanceof Error ? err.message : String(err)}` };
      hitStepLimit = false;
      break;
    }

    yield { type: "thinking", active: false };

    if (!doneEvent || doneEvent.type !== "message-done") {
      yield { type: "error", error: "Unexpected end of stream" };
      break;
    }

    fullAssistantText += doneEvent.content;

    if (doneEvent.stopReason === "max_tokens" && doneEvent.toolCalls.length === 0) {
      if (longTask && truncationRecoveries < MAX_TRUNCATION_RECOVERIES) {
        truncationRecoveries++;
        currentMessages.push({
          role: "user",
          content: buildTruncationRecoveryMessage(longTask.workspaceDir, truncationRecoveries),
        });
        yield {
          type: "long-task-progress",
          runId: longTask.runId,
          workspaceDir: longTask.workspaceDir,
          phase: "recover",
          status: "running",
          summary: "LLM output hit the token limit; continuing with tool-based chunked file generation.",
          outputs: [],
          updatedAt: Date.now(),
        };
        continue;
      }

      yield {
        type: "error",
        error: "LLM output was truncated because it hit the model output token limit. For large deliverables, the agent should create files with tools in smaller chunks instead of writing the entire implementation in chat.",
      };
      hitStepLimit = false;
      break;
    }

    if (doneEvent.stopReason !== "tool_use" && doneEvent.toolCalls.length === 0) {
      hitStepLimit = false;
      break;
    }

    currentMessages.push({
      role: "assistant",
      content: doneEvent.content,
      toolCalls: doneEvent.toolCalls,
    });

    for (const toolCall of doneEvent.toolCalls) {
      const tool = allTools[toolCall.name];
      if (!tool) {
        const errResult = `Unknown tool: ${toolCall.name}`;
        currentMessages.push({ role: "tool", toolCallId: toolCall.id, content: errResult });
        yield { type: "skill-done", skill: toolCall.name, result: errResult, durationMs: 0, success: false };
        continue;
      }

      // Yield start event right before execution (not during LLM streaming)
      // so tools appear one at a time in UI, not all at once.
      yield { type: "skill-start", skill: toolCall.name, input: toolCall.input };

      const startTime = Date.now();
      try {
        // Progress callback — updates store directly for live output display
        const onProgress = params.onProgress
          ? (output: string) => params.onProgress!(toolCall.name, output)
          : undefined;

        const result = await tool.execute(toolCall.input as Record<string, unknown>, onProgress);
        const durationMs = Date.now() - startTime;
        const success = !isToolResultFailure(result);

        let uiResult: unknown = summarizeResult(result);
        if (success && result.startsWith("__ARTIFACT__:")) {
          const artifact = parseArtifactMarker(result);
          if (artifact) {
            yield { type: "artifact", artifact };
          }
        } else if (success && result.startsWith("__TASK_PROGRESS__:")) {
          const progress = parseTaskProgressMarker(result);
          if (progress) {
            yield { type: "long-task-progress", ...progress };
            uiResult = `${progress.phase}: ${progress.status} — ${progress.summary}`;
          }
        }

        currentMessages.push({ role: "tool", toolCallId: toolCall.id, content: truncateToolResultForLlm(result) });
        yield { type: "skill-done", skill: toolCall.name, result: uiResult, durationMs, success };
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const errResult = `Tool execution error: ${err}`;
        currentMessages.push({ role: "tool", toolCallId: toolCall.id, content: errResult });
        yield { type: "skill-done", skill: toolCall.name, result: errResult, durationMs, success: false };
      }
    }
  }

  if (hitStepLimit) {
    yield { type: "error", error: `Agent stopped after reaching the maximum of ${MAX_STEPS} tool/LLM steps.` };
  }
  } finally {
    setCurrentLongTask(null);
  }

  yield { type: "done" };

  // 5. Post-completion: extract memories asynchronously
  // Don't block the UI — fire and forget
  if (params.messages.length >= 2) {
    const allMessages: LLMMessage[] = [
      ...params.messages,
      ...(fullAssistantText ? [{ role: "assistant" as const, content: fullAssistantText }] : []),
    ];
    extractMemories(allMessages, params.sessionId).catch((err) => {
      console.error("Memory extraction failed:", err);
    });
  }
}

function buildTruncationRecoveryMessage(workspaceDir: string, attempt: number): string {
  return `Your previous response was truncated by the model output token limit. Do not repeat or continue the truncated prose/code in assistant text.

Continue from the last successful tool result using tool calls only.

Required recovery behavior:
1. If you need to create a large script, write it under ${workspaceDir}/scripts/ with write_file.
2. Keep each write_file content payload under 12,000 characters.
3. Use write_file mode "overwrite" for the first chunk and mode "append" for later chunks.
4. Keep the next tool call small enough to fit comfortably; write only the next coherent chunk.
5. For PPTX generation, do not use shell for node. After the script is complete, run it with run_node using a short loader: require("/absolute/path/to/script.js").
6. Do not claim completion until a tool confirms the final output file exists or was created.

Recovery attempt: ${attempt}/${MAX_TRUNCATION_RECOVERIES}.`;
}

/** Parse artifact marker from create_artifact skill output.
 *  The skill already saved to DB — we just need the data for the UI event. */
function parseArtifactMarker(result: string) {
  const firstNewline = result.indexOf("\n");
  if (firstNewline < 0) return null;
  const header = result.slice(0, firstNewline);
  const content = result.slice(firstNewline + 1);
  const parts = header.split(":");
  if (parts.length < 3) return null;
  return {
    id: `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId: null,
    appId: null,
    runId: null,
    type: parts[1] as "report" | "table" | "action_list",
    title: parts.slice(2).join(":"),
    content,
    metadata: null,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

function summarizeResult(result: string): unknown {
  if (result.length <= 200) return result;
  return result.slice(0, 200) + `... (${result.length} chars total)`;
}

function truncateToolResultForLlm(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_CHARS_FOR_LLM) return result;
  const headSize = Math.floor(MAX_TOOL_RESULT_CHARS_FOR_LLM * 0.65);
  const tailSize = MAX_TOOL_RESULT_CHARS_FOR_LLM - headSize;
  const omitted = result.length - headSize - tailSize;
  return [
    result.slice(0, headSize),
    `\n\n[Tool result truncated before sending back to the LLM: ${omitted} middle characters omitted. Head and tail are preserved. Use a narrower query, smaller max_chars, or offset-based reads instead of loading everything.]\n\n`,
    result.slice(result.length - tailSize),
  ].join("");
}

function isKnowledgeDiscoveryRequest(query: string): boolean {
  return /(找|找到|查找|搜索|列出|有哪些|相关).*(文档|文件|资料|报告)|find.*(document|file|report)/i.test(query);
}

function parseTaskProgressMarker(result: string) {
  const marker = "__TASK_PROGRESS__:";
  if (!result.startsWith(marker)) return null;
  try {
    const parsed = JSON.parse(result.slice(marker.length)) as {
      runId: string;
      workspaceDir: string;
      phase: string;
      status: "pending" | "running" | "done" | "failed";
      summary: string;
      outputs?: { title: string; path?: string; kind?: "file" | "artifact" | "note" }[];
      updatedAt: number;
    };
    return {
      runId: parsed.runId,
      workspaceDir: parsed.workspaceDir,
      phase: parsed.phase,
      status: parsed.status,
      summary: parsed.summary,
      outputs: parsed.outputs || [],
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}
