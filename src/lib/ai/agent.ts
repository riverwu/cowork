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
import {
  setCurrentLongTask,
  setCurrentWorkingDirectory,
  getCurrentLongTask,
} from "./task-context";
import { isToolResultFailure } from "./tool-result";
import { getSettings } from "@/lib/db";
import {
  computeBudget,
  estimateMessagesTokens,
  estimateTokens,
  estimateToolDefTokens,
  fitMessagesToBudget,
} from "./context-budget";

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

  setCurrentWorkingDirectory(params.workingDirectory || null);
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

  // 3a. Resolve the model's context budget (Codex-style: per-model registry
  // with optional Settings override; effective input ceiling = 95% of window
  // minus reserved output; auto-compact threshold at 90% of window).
  // Without this guard, on smaller-context models the backend silently
  // truncates the request — most often dropping the tools array entirely,
  // which makes the agent look like it "refuses to call tools" when in
  // fact it never received them.
  const settings = await getSettings();
  const budget = computeBudget({
    modelId: settings.modelId,
    contextTokensOverride: settings.modelContextTokens,
    maxOutputTokens: settings.modelMaxOutputTokens,
  });
  const toolBudgetTokens = toolDefs.reduce((sum, def) => sum + estimateToolDefTokens(def), 0);

  let droppedKnowledge = false;
  let droppedMemory = false;

  const buildPrompt = () => buildSystemPrompt({
    tools: toolDefs,
    memoryContext: droppedMemory ? undefined : (memoryContext || undefined),
    knowledgeContext: droppedKnowledge ? undefined : (knowledgeContext || undefined),
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

  let system = buildPrompt();
  let systemTokens = estimateTokens(system);

  // Drop priority (Codex compaction order): knowledge first, then memory,
  // then trim oldest history. Trigger when projected total
  // (system + tools + ALL message tokens) exceeds the 90% auto-compact
  // threshold. Estimating the full message payload — not just user
  // content — matters: on a long conversation, assistant turns and
  // tool_result blocks dominate the cost.
  const messagesTokens = estimateMessagesTokens(params.messages);
  const overhead = () => systemTokens + toolBudgetTokens + messagesTokens;
  if (knowledgeContext && overhead() > budget.autoCompactThreshold) {
    droppedKnowledge = true;
    system = buildPrompt();
    systemTokens = estimateTokens(system);
  }
  if (memoryContext && overhead() > budget.autoCompactThreshold) {
    droppedMemory = true;
    system = buildPrompt();
    systemTokens = estimateTokens(system);
  }

  // 4. Trim history to fit the input budget (oldest first, last 4 always
  // preserved so a tool_use never gets stranded without its tool_result).
  const fit = fitMessagesToBudget({
    systemTokens,
    toolTokens: toolBudgetTokens,
    messages: params.messages,
    inputBudget: budget.inputBudget,
  });
  if (fit.exceedsBudget) {
    yield {
      type: "error",
      error: `Even the most recent messages exceed the model's input budget (~${budget.inputBudget} tokens for a ${budget.contextTokens}-token context). Increase 'Context window' in Settings to match your model, or shorten the latest message.`,
    };
    yield { type: "done" };
    return;
  }
  if (fit.droppedMessages > 0 || droppedKnowledge || droppedMemory) {
    const dropped: string[] = [];
    if (droppedKnowledge) dropped.push("retrieved knowledge");
    if (droppedMemory) dropped.push("memory");
    if (fit.droppedMessages > 0) dropped.push(`${fit.droppedMessages} oldest message(s)`);
    console.log(`[Agent] Context budget: model=${settings.modelId || "default"}, window=${budget.contextTokens}, input_budget=${budget.inputBudget}, max_output=${budget.maxOutputTokens}. Dropped: ${dropped.join(", ")}. Estimated input ~${fit.estimatedInputTokens}.`);
  } else {
    console.log(`[Agent] Context budget: model=${settings.modelId || "default"}, window=${budget.contextTokens}, input_budget=${budget.inputBudget}, max_output=${budget.maxOutputTokens}. Estimated input ~${fit.estimatedInputTokens}.`);
  }

  const currentMessages: LLMMessage[] = [...fit.messages];
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
        maxOutputTokens: budget.maxOutputTokens,
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

    // Loop ends when the model stops calling tools. If it produced neither
    // tool calls NOR text we still need to break, otherwise the next request
    // would carry an empty assistant message that the API will reject.
    if (doneEvent.toolCalls.length === 0) {
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

      // Provider parser stashes a truncated tool input as { _raw, _error }.
      // Executing the tool with that garbage produces misleading errors the
      // LLM then tries to "fix"; short-circuit with a clean recovery hint.
      const rawInput = toolCall.input as { _error?: string; _raw?: string } | undefined;
      if (rawInput && typeof rawInput === "object" && rawInput._error === "Truncated tool call input") {
        const errResult = `Tool call to "${toolCall.name}" was truncated by the model output token limit before its arguments finished streaming, so the tool was not run. Re-issue the call with smaller, complete arguments.`;
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
        // Internal dispatch markers (`__ARTIFACT__:…`, `__TASK_PROGRESS__:…`)
        // are private wire-format between tools and the agent loop. Strip
        // them before pushing the tool result back into the LLM context so
        // the model sees a clean, human-readable confirmation instead of the
        // raw marker + duplicated payload.
        let llmResult = result;
        if (success && result.startsWith("__ARTIFACT__:")) {
          const artifact = parseArtifactMarker(result);
          if (artifact) {
            yield { type: "artifact", artifact };
            llmResult = `Artifact created (${artifact.type}): "${artifact.title}". It is now visible to the user in a dedicated panel; do not paste its contents back into chat.`;
          }
        } else if (success && result.startsWith("__TASK_PROGRESS__:")) {
          const progress = parseTaskProgressMarker(result);
          if (progress) {
            // The tool may have just bootstrapped a long task on the fly
            // (because detectLongTask didn't fire for this prompt). In that
            // case emit a synthetic long-task-start so the UI panel and the
            // session store have a runId/workspaceDir before phases arrive.
            const active = getCurrentLongTask();
            if (active && active.runId === progress.runId && !longTask) {
              yield {
                type: "long-task-start",
                runId: active.runId,
                workspaceDir: active.workspaceDir,
                reason: active.reason,
              };
            }
            yield { type: "long-task-progress", ...progress };
            uiResult = `${progress.phase}: ${progress.status} — ${progress.summary}`;
            const outputsLine = progress.outputs.length > 0
              ? ` Outputs: ${progress.outputs.map((o) => o.path || o.title).join(", ")}.`
              : "";
            llmResult = `Task progress recorded — phase "${progress.phase}", status "${progress.status}". Plan/summary is now visible to the user in the panel.${outputsLine}`;
          }
        }

        currentMessages.push({ role: "tool", toolCallId: toolCall.id, content: truncateToolResultForLlm(toolCall.name, llmResult) });
        yield { type: "skill-done", skill: toolCall.name, result: uiResult, durationMs, success };
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const errResult = `Tool execution error in ${toolCall.name}: ${err instanceof Error ? err.message : String(err)}`;
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

function truncateToolResultForLlm(toolName: string, result: string): string {
  if (result.length <= MAX_TOOL_RESULT_CHARS_FOR_LLM) return result;
  const headSize = Math.floor(MAX_TOOL_RESULT_CHARS_FOR_LLM * 0.65);
  const tailSize = MAX_TOOL_RESULT_CHARS_FOR_LLM - headSize;
  const omitted = result.length - headSize - tailSize;
  return [
    result.slice(0, headSize),
    `\n\n[${toolName} result truncated before sending back to the LLM: ${omitted} middle characters omitted. Head and tail are preserved. Use a narrower query, smaller max_chars, or offset-based reads instead of loading everything.]\n\n`,
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
