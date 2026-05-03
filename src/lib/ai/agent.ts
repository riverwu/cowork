import { getConfiguredProvider } from "./providers";
import type { LLMMessage, StreamEvent, ToolDefinition } from "./providers/types";
import { getTools } from "./tools/registry";
import { skillRegistry } from "./skill-registry";
import { getSkillsDir } from "./skill-loader";
import { buildSystemPrompt } from "./system-prompt";
import { retrieveMemoryContext, buildMemoryPrompt, extractMemories } from "@/lib/memory";
import { mcpManager } from "@/lib/mcp";
import type { AgentEvent } from "@/types";
import { buildLongTaskPrompt, detectLongTask } from "./long-task";
import {
  setCurrentLongTask,
  setCurrentWorkingDirectory,
  getCurrentLongTask,
} from "./task-context";
import { isToolResultFailure, extractFailureSnippet } from "./tool-result";
import { getSettings } from "@/lib/db";
import {
  computeBudget,
  estimateMessagesTokens,
  estimateTokens,
  estimateToolDefTokens,
  fitMessagesToBudget,
} from "./context-budget";
import { runInlineCompaction } from "./compact";
import type { DebugLogger } from "./debug-log";

// Slide-deck builds easily run many tool calls (list_themes → describe_theme
// → list_layouts → describe_layout × N picks → image_gen × N → validate →
// render → audit → edit follow-ups). Keep the ceiling generous enough that
// a long deck doesn't trip it before the agent finishes verification.
const MAX_STEPS = 120;
const MAX_TRUNCATION_RECOVERIES = 3;
const MAX_TOOL_RESULT_CHARS_FOR_LLM = 12000;

export interface AgentParams {
  messages: LLMMessage[];
  sessionId: string;
  planMode?: boolean;
  /** Working directory — tools use this as default cwd. */
  workingDirectory?: string;
  /** Called when a skill produces streaming output (e.g., shell command output). */
  onProgress?: (skill: string, output: string) => void;
  /** Debug: build the full context (system prompt, tools, fitted messages,
   *  budget summary) and yield it as a single `context-dump` event instead
   *  of calling the LLM. The yielded content is what would actually be sent
   *  to the provider, so this is the source of truth for "what does the
   *  model see". */
  dumpOnly?: boolean;
  /** Optional per-request debug logger. When supplied, the agent loop
   *  records every send/receive/tool start/tool done/error to a JSONL
   *  file and copies any artifact files referenced in tool results into
   *  the same directory. Off by default; controlled by the chat
   *  composer's `+` menu toggle. */
  debugLog?: DebugLogger;
}

/**
 * Core agent loop. Async generator that yields events for the UI to consume.
 *
 * Flow:
 *   1. Retrieve memory context (core facts + semantic memories + episodes)
 *   2. Build system prompt with memory
 *   3. Loop: call LLM → yield streaming events → execute tool calls → repeat
 *   4. Until LLM stops calling tools (task complete)
 *   5. After completion: extract memories from conversation (async, non-blocking)
 *
 * Knowledge base lookup is agent-driven: the model calls `search_knowledge`
 * (or related tools) when it decides retrieval is needed. We do not
 * auto-inject retrieval results into the prompt — past auto-injection
 * could push the request past the input budget and cause the provider to
 * silently drop the tools array, which made the agent reply with text
 * only and look like it was "refusing" to call tools.
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

  // 2. Build system prompt with system paths + MCP status
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

  // 2a. Resolve the model's context budget (Codex-style: per-model registry
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

  let droppedMemory = false;

  const buildPrompt = () => buildSystemPrompt({
    tools: toolDefs,
    memoryContext: droppedMemory ? undefined : (memoryContext || undefined),
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

  // Drop priority: memory first, then LLM-summary compaction, then drop
  // oldest history as last resort. Trigger when projected total
  // (system + tools + ALL message tokens) exceeds the 90% auto-compact
  // threshold. Estimating the full message payload — not just user content —
  // matters: on a long conversation, assistant turns and tool_result blocks
  // dominate the cost.
  let messagesTokens = estimateMessagesTokens(params.messages);
  const overhead = () => systemTokens + toolBudgetTokens + messagesTokens;
  if (memoryContext && overhead() > budget.autoCompactThreshold) {
    droppedMemory = true;
    system = buildPrompt();
    systemTokens = estimateTokens(system);
  }

  // LLM-summary compaction (Codex-style). Triggered when even after
  // dropping memory the projected input still exceeds the 90% threshold.
  // Runs ONE summary turn over the full history, then replaces the agent's
  // message list with [preserved user messages] + [summary as final user
  // turn]. Skipped when dumpOnly so context dumps reflect the un-compacted
  // state (debug clarity > token efficiency).
  let workingMessages = params.messages;
  if (!params.dumpOnly && overhead() > budget.autoCompactThreshold && workingMessages.length >= 4) {
    const compacted = await runInlineCompaction({
      provider,
      messages: workingMessages,
      maxOutputTokens: Math.min(4_000, budget.maxOutputTokens),
      baseSystem: "You are a concise technical summarizer producing a handoff for another LLM. Be specific about file paths, function names, decisions, and pending work.",
    });
    if (compacted) {
      workingMessages = compacted.messages;
      messagesTokens = estimateMessagesTokens(workingMessages);
      yield {
        type: "compacted",
        summary: compacted.summary,
        preservedUserMessages: workingMessages.length - 1,
        estimatedTokens: compacted.estimatedTokens,
      };
      console.log(
        `[Agent] Compacted history: ${params.messages.length} → ${workingMessages.length} messages, ~${compacted.estimatedTokens} tokens.`,
      );
      params.debugLog?.recordCompacted({
        summary: compacted.summary,
        preservedUserMessages: workingMessages.length - 1,
        estimatedTokens: compacted.estimatedTokens,
      });
    }
  }

  // 4. Trim history to fit the input budget (oldest first, last 4 always
  // preserved so a tool_use never gets stranded without its tool_result).
  // Compaction runs first; this is the safety net if the summary still
  // doesn't fit.
  const fit = fitMessagesToBudget({
    systemTokens,
    toolTokens: toolBudgetTokens,
    messages: workingMessages,
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
  if (fit.droppedMessages > 0 || droppedMemory) {
    const dropped: string[] = [];
    if (droppedMemory) dropped.push("memory");
    if (fit.droppedMessages > 0) dropped.push(`${fit.droppedMessages} oldest message(s)`);
    console.log(`[Agent] Context budget: model=${settings.modelId || "default"}, window=${budget.contextTokens}, input_budget=${budget.inputBudget}, max_output=${budget.maxOutputTokens}. Dropped: ${dropped.join(", ")}. Estimated input ~${fit.estimatedInputTokens}.`);
  } else {
    console.log(`[Agent] Context budget: model=${settings.modelId || "default"}, window=${budget.contextTokens}, input_budget=${budget.inputBudget}, max_output=${budget.maxOutputTokens}. Estimated input ~${fit.estimatedInputTokens}.`);
  }

  const currentMessages: LLMMessage[] = [...fit.messages];

  if (params.dumpOnly) {
    yield {
      type: "context-dump",
      content: formatContextDump({
        modelId: settings.modelId,
        budget,
        systemTokens,
        toolBudgetTokens,
        estimatedInputTokens: fit.estimatedInputTokens,
        droppedMemory,
        droppedMessages: fit.droppedMessages,
        builtinToolCount: Object.keys(builtinTools).length,
        mcpToolCount: Object.keys(mcpTools).length,
        toolDefs,
        system,
        messages: currentMessages,
      }),
    };
    setCurrentLongTask(null);
    yield { type: "done" };
    return;
  }

  let fullAssistantText = "";
  let hitStepLimit = true;
  let truncationRecoveries = 0;

  try {
  for (let step = 0; step < MAX_STEPS; step++) {
    let doneEvent: StreamEvent | null = null;
    let turnText = "";

    // Signal LLM is thinking (waiting for response)
    yield { type: "thinking", active: true };

    params.debugLog?.recordSend({
      step,
      system,
      tools: toolDefs,
      messages: currentMessages,
      estimatedInputTokens: fit.estimatedInputTokens,
      modelId: settings.modelId,
    });

    try {
      for await (const event of provider.stream({
        system,
        messages: currentMessages,
        tools: toolDefs,
        maxOutputTokens: budget.maxOutputTokens,
      })) {
        if (event.type === "text-delta") {
          turnText += event.text;
        } else if (event.type === "message-done") {
          doneEvent = event;
        }
      }
    } catch (err) {
      yield { type: "thinking", active: false };
      const message = `LLM request failed: ${err instanceof Error ? err.message : String(err)}`;
      params.debugLog?.recordError({ step, error: message, phase: "llm-request" });
      yield { type: "error", error: message };
      hitStepLimit = false;
      break;
    }

    yield { type: "thinking", active: false };

    if (doneEvent && doneEvent.type === "message-done") {
      params.debugLog?.recordResponse({
        step,
        text: turnText || doneEvent.content || "",
        toolCalls: doneEvent.toolCalls,
        stopReason: doneEvent.stopReason,
        usage: (doneEvent as { usage?: unknown }).usage,
      });
    }

    if (!doneEvent || doneEvent.type !== "message-done") {
      yield { type: "error", error: "Unexpected end of stream" };
      break;
    }

    if (!turnText && doneEvent.content) turnText = doneEvent.content;

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
      if (turnText) {
        yield { type: "text-delta", text: turnText };
        fullAssistantText += turnText;
      }
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
        currentMessages.push({ role: "tool", toolCallId: toolCall.id, content: formatToolResultForLlm(toolCall.name, errResult, false, toolCall.input) });
        yield { type: "skill-done", skill: toolCall.name, result: errResult, durationMs: 0, success: false, toolCallId: toolCall.id };
        continue;
      }

      // Provider parser stashes a truncated tool input as { _raw, _error }.
      // Executing the tool with that garbage produces misleading errors the
      // LLM then tries to "fix"; short-circuit with a clean recovery hint.
      const rawInput = toolCall.input as { _error?: string; _raw?: string } | undefined;
      if (rawInput && typeof rawInput === "object" && rawInput._error === "Truncated tool call input") {
        const errResult = `Tool call to "${toolCall.name}" was truncated by the model output token limit before its arguments finished streaming, so the tool was not run. Re-issue the call with smaller, complete arguments.`;
        currentMessages.push({ role: "tool", toolCallId: toolCall.id, content: formatToolResultForLlm(toolCall.name, errResult, false, toolCall.input) });
        yield { type: "skill-done", skill: toolCall.name, result: errResult, durationMs: 0, success: false, toolCallId: toolCall.id };
        continue;
      }

      // Yield start event right before execution (not during LLM streaming)
      // so tools appear one at a time in UI, not all at once.
      yield { type: "skill-start", skill: toolCall.name, input: toolCall.input, toolCallId: toolCall.id };

      params.debugLog?.recordToolStart({
        step,
        name: toolCall.name,
        input: toolCall.input,
        toolCallId: toolCall.id,
      });

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

        currentMessages.push({ role: "tool", toolCallId: toolCall.id, content: formatToolResultForLlm(toolCall.name, llmResult, success, toolCall.input) });
        await params.debugLog?.recordToolDone({
          step,
          name: toolCall.name,
          toolCallId: toolCall.id,
          result,
          success,
          durationMs,
        });
        yield { type: "skill-done", skill: toolCall.name, result: uiResult, durationMs, success, toolCallId: toolCall.id };
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const errResult = `Tool execution error in ${toolCall.name}: ${err instanceof Error ? err.message : String(err)}`;
        currentMessages.push({ role: "tool", toolCallId: toolCall.id, content: formatToolResultForLlm(toolCall.name, errResult, false, toolCall.input) });
        params.debugLog?.recordToolDone({
          step,
          name: toolCall.name,
          toolCallId: toolCall.id,
          result: errResult,
          success: false,
          durationMs,
        });
        yield { type: "skill-done", skill: toolCall.name, result: errResult, durationMs, success: false, toolCallId: toolCall.id };
      }
    }
  }

  if (hitStepLimit) {
    // Hard-stop: append an explicit incompletion notice so the saved
    // assistant message can't read like a successful completion. Earlier
    // streamed text from inside the loop almost always contains optimistic
    // "PPT制作完成" / "Task done" claims, because the model writes those
    // before the next tool call rather than only at the end. Replacing
    // (not appending to) the saved text avoids the historical pattern of
    // the next turn reading a confident "已完成" and acting on it.
    const incompletion = [
      "[TASK INCOMPLETE — agent stopped at the step limit]",
      `The agent ran out of tool/LLM steps (${MAX_STEPS}) before the task finished. Any "完成 / 已生成 / 已渲染 / audit通过" wording earlier in this turn was premature: the final verification step never ran. Treat the deliverable as NOT confirmed; verify file existence before reusing it in a later turn.`,
    ].join("\n\n");
    yield { type: "text-delta", text: `\n\n${incompletion}` };
    fullAssistantText = incompletion;
    yield { type: "error", error: `Agent stopped after reaching the maximum of ${MAX_STEPS} tool/LLM steps.` };
  }
  } finally {
    setCurrentLongTask(null);
    params.debugLog?.recordCompleted({
      totalSteps: 0,
      hitStepLimit,
      finalText: fullAssistantText,
    });
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

/** Format a tool result for the LLM context.
 *
 *  Two changes vs. the naive "head + tail" approach:
 *  1. Every result is tagged with an explicit `[TOOL OK]` / `[TOOL FAILED]`
 *     prefix on its own line, so a model skimming the first tokens of the
 *     tool message can't miss the success/failure verdict.
 *  2. On failures, we promote the most informative error line to the very
 *     top via {@link extractFailureSnippet} and bias the visible window
 *     toward the *tail* (where stack traces and the actual error usually
 *     live), instead of the default head-heavy window. This kills the
 *     pattern where an agent reads "Validation failed: Validation failed:"
 *     once at the top of a long error and then writes "渲染成功" anyway. */
function formatToolResultForLlm(toolName: string, result: string, success: boolean, input?: unknown): string {
  if (success && isSkillMarkdownRead(toolName, input)) {
    return formatFullToolResult(toolName, result, [
      "This SKILL.md is pinned for the current task run.",
      "Do not truncate, omit, or replace it with a summary while this task is running.",
      "It will not be re-pinned automatically in later user tasks unless the skill is read again.",
    ]);
  }
  return truncateToolResultForLlm(toolName, result, success);
}

function formatFullToolResult(toolName: string, result: string, notes: string[]): string {
  return [
    `[TOOL OK] ${toolName}`,
    ...notes.map((note) => `Note: ${note}`),
    "---",
    result,
  ].join("\n");
}

function isSkillMarkdownRead(toolName: string, input: unknown): boolean {
  if (toolName !== "read_file" || !input || typeof input !== "object") return false;
  const path = (input as { path?: unknown }).path;
  return typeof path === "string" && /(^|\/)SKILL\.md$/i.test(path);
}

function truncateToolResultForLlm(toolName: string, result: string, success: boolean): string {
  const verdict = success ? "[TOOL OK]" : "[TOOL FAILED]";
  const failureSnippet = success ? null : extractFailureSnippet(result);
  const header = failureSnippet
    ? `${verdict} ${toolName}\nFailure summary: ${failureSnippet}\n---`
    : `${verdict} ${toolName}\n---`;

  // Reserve some chars for the header itself.
  const bodyBudget = MAX_TOOL_RESULT_CHARS_FOR_LLM - header.length - 4;
  if (result.length <= bodyBudget) return `${header}\n${result}`;

  // For failures, bias toward the tail (errors usually appear there).
  // For successes, keep the existing head-heavy split.
  const headRatio = success ? 0.65 : 0.3;
  const headSize = Math.floor(bodyBudget * headRatio);
  const tailSize = bodyBudget - headSize;
  const omitted = result.length - headSize - tailSize;
  const body = [
    result.slice(0, headSize),
    `\n\n[${toolName} result truncated for the LLM: ${omitted} middle characters omitted. Tail preserved (errors usually appear there). Re-call with a narrower query / smaller max_chars / explicit offset for full content.]\n\n`,
    result.slice(result.length - tailSize),
  ].join("");
  return `${header}\n${body}`;
}

function formatContextDump(input: {
  modelId: string | undefined;
  budget: { contextTokens: number; inputBudget: number; maxOutputTokens: number; autoCompactThreshold: number };
  systemTokens: number;
  toolBudgetTokens: number;
  estimatedInputTokens: number;
  droppedMemory: boolean;
  droppedMessages: number;
  builtinToolCount: number;
  mcpToolCount: number;
  toolDefs: ToolDefinition[];
  system: string;
  messages: LLMMessage[];
}): string {
  const lines: string[] = [];
  lines.push(`# Agent Context Dump`);
  lines.push(`generated: ${new Date().toISOString()}`);
  lines.push(``);
  lines.push(`## Model & Budget`);
  lines.push(`- model: ${input.modelId || "(default)"}`);
  lines.push(`- context window: ${input.budget.contextTokens}`);
  lines.push(`- input budget: ${input.budget.inputBudget}`);
  lines.push(`- max output: ${input.budget.maxOutputTokens}`);
  lines.push(`- auto-compact threshold: ${input.budget.autoCompactThreshold}`);
  lines.push(`- estimated input tokens: ${input.estimatedInputTokens}`);
  lines.push(`- system prompt tokens: ~${input.systemTokens}`);
  lines.push(`- tool definition tokens: ~${input.toolBudgetTokens}`);
  lines.push(`- dropped memory: ${input.droppedMemory}`);
  lines.push(`- dropped oldest messages: ${input.droppedMessages}`);
  lines.push(``);
  lines.push(`## Tools (${input.toolDefs.length}: ${input.builtinToolCount} built-in + ${input.mcpToolCount} MCP)`);
  for (const def of input.toolDefs) {
    const desc = (def.description || "").split("\n")[0].slice(0, 200);
    lines.push(`- **${def.name}** — ${desc}`);
  }
  lines.push(``);
  lines.push(`## System Prompt`);
  lines.push("```");
  lines.push(input.system);
  lines.push("```");
  lines.push(``);
  lines.push(`## Messages (${input.messages.length})`);
  input.messages.forEach((msg, i) => {
    lines.push(``);
    if (msg.role === "user") {
      lines.push(`### [${i + 1}] user`);
      lines.push("```");
      lines.push(msg.content);
      lines.push("```");
    } else if (msg.role === "assistant") {
      lines.push(`### [${i + 1}] assistant`);
      lines.push("```");
      lines.push(msg.content || "(no text)");
      lines.push("```");
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        lines.push(`tool_calls:`);
        for (const tc of msg.toolCalls) {
          lines.push(`- ${tc.name} (${tc.id})`);
          lines.push("  ```json");
          lines.push("  " + JSON.stringify(tc.input, null, 2).split("\n").join("\n  "));
          lines.push("  ```");
        }
      }
    } else if (msg.role === "tool") {
      lines.push(`### [${i + 1}] tool result (${msg.toolCallId})`);
      lines.push("```");
      lines.push(msg.content);
      lines.push("```");
    }
  });
  return lines.join("\n");
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
      steps?: { title: string; status: "pending" | "running" | "done" | "failed" }[];
      outputs?: { title: string; path?: string; kind?: "file" | "artifact" | "note" }[];
      updatedAt: number;
    };
    return {
      runId: parsed.runId,
      workspaceDir: parsed.workspaceDir,
      phase: parsed.phase,
      status: parsed.status,
      summary: parsed.summary,
      steps: Array.isArray(parsed.steps) ? parsed.steps : undefined,
      outputs: parsed.outputs || [],
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}
