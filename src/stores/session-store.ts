import { create } from "zustand";
import { runAgent } from "@/lib/ai/agent";
import { DebugLogger } from "@/lib/ai/debug-log";
import { useAppStore } from "@/stores/app-store";
import { skillRegistry } from "@/lib/ai/skill-registry";
import { getTool } from "@/lib/ai/tools/registry";
import type { LLMMessage, ToolCall } from "@/lib/ai/providers/types";
import type { AgentEvent, Artifact, Message } from "@/types";
import {
  createSession, createMessage, listMessages,
  listRecentSessions, getSetting, setSetting,
  resetAllConversationAndMemory,
} from "@/lib/db";
import { now as dbNow, newId } from "@/lib/db";
import { getEnv } from "@/lib/tauri";

/** Per-message tool-history excerpt size (used in the trusted-tool-history
 *  footer appended to each assistant turn for cross-turn recall). The full
 *  conversation is still passed to the agent — token-level budgeting now
 *  happens in `lib/ai/context-budget.ts`. */
const TOOL_HISTORY_RESULT_LIMIT = 300;

/** Special role for context divider markers. */
const CONTEXT_DIVIDER_ROLE = "system" as const;
const CONTEXT_DIVIDER_CONTENT = "__CONTEXT_CLEARED__";

interface KnowledgeRef {
  documentId: string;
  filename: string;
  snippet: string;
}

interface AgentStepRecord {
  skill: string;
  status: "running" | "done";
  input?: unknown;
  result?: unknown;
  durationMs?: number;
  liveOutput?: string;
  success?: boolean;
  /**
   * Unique id of the LLM-emitted tool_use, threaded back into the
   * tool_result on re-ship. Required for native Anthropic / OpenAI
   * tool block pairing in `assembleLlmMessages`. Optional only for
   * legacy steps recorded before this field existed.
   */
  toolCallId?: string;
}

interface LongTaskPhase {
  phase: string;
  status: "pending" | "running" | "done" | "failed";
  summary: string;
  steps: { title: string; status: "pending" | "running" | "done" | "failed" }[];
  outputs: { title: string; path?: string; kind?: "file" | "artifact" | "note" }[];
  updatedAt: number;
}

interface LongTaskState {
  runId: string;
  workspaceDir: string;
  reason: string;
  phases: LongTaskPhase[];
  planSteps?: { title: string; status: LongTaskPhase["status"] }[];
}

interface SessionState {
  sessionId: string | null;
  messages: Message[];
  isStreaming: boolean;
  streamingText: string;
  steps: AgentStepRecord[];
  artifacts: Artifact[];
  knowledgeRefs: KnowledgeRef[];
  error: string | null;
  longTask: LongTaskState | null;
  initialized: boolean;
  planMode: boolean;
  /** Working directory — all tools use this as base. */
  workingDirectory: string;
  /** Queued messages waiting to be sent after current run completes. */
  pendingMessages: string[];
  /** Debug dump of the prepared agent context (system prompt + tools +
   *  fitted messages + budget). When set, the UI shows it in a modal. */
  contextDump: string | null;

  initialize: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  clearContext: () => void;
  togglePlanMode: () => void;
  setWorkingDirectory: (path: string) => void;
  dumpContext: () => Promise<void>;
  closeContextDump: () => void;
  /** Wipe all sessions, messages, artifacts, and memory (core facts,
   *  semantic memories, episodes). Then start a fresh session and clear
   *  all in-memory UI state. Settings and the knowledge base are preserved. */
  resetAll: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessionId: null,
  messages: [],
  isStreaming: false,
  streamingText: "",
  steps: [],
  artifacts: [],
  knowledgeRefs: [],
  error: null,
  longTask: null,
  initialized: false,
  planMode: false,
  workingDirectory: "",
  pendingMessages: [],
  contextDump: null,

  initialize: async () => {
    const recent = await listRecentSessions(1);
    let sessionId: string;
    let messages: Message[] = [];

    if (recent.length > 0 && recent[0].status === "active") {
      sessionId = recent[0].id;
      messages = await listMessages(sessionId);
    } else {
      const session = await createSession("Cowork");
      sessionId = session.id;
    }

    // Load working directory: saved preference → HOME → fallback
    let workingDirectory = await getSetting("working_directory");
    if (!workingDirectory) {
      workingDirectory = await getEnv("HOME") || "/";
    }

    set({
      sessionId,
      messages,
      initialized: true,
      workingDirectory,
      artifacts: [],
      knowledgeRefs: [],
      steps: [],
      error: null,
      longTask: null,
    });
  },

  sendMessage: async (content: string) => {
    // If currently streaming, queue the message for later
    if (get().isStreaming) {
      set((s) => ({ pendingMessages: [...s.pendingMessages, content] }));
      return;
    }

    // Handle slash commands
    if (content.trim() === "/reset") {
      await get().resetAll();
      return;
    }
    if (content.trim() === "/reload-skills") {
      try {
        const result = await skillRegistry.reload();
        const msg: Message = {
          id: newId(), sessionId: get().sessionId || "", role: "assistant",
          content: `Skills reloaded: ${result.total} total` +
            (result.added.length ? `, added: ${result.added.join(", ")}` : "") +
            (result.removed.length ? `, removed: ${result.removed.join(", ")}` : ""),
          metadata: null, createdAt: dbNow(),
        };
        set((s) => ({ messages: [...s.messages, msg] }));
      } catch (err) {
        set({ error: `Reload failed: ${err}` });
      }
      return;
    }

    let { sessionId } = get();

    if (!sessionId) {
      const session = await createSession("Cowork");
      sessionId = session.id;
      set({ sessionId });
    }

    const userMsg = await createMessage({ sessionId, role: "user", content });
    set((s) => ({ messages: [...s.messages, userMsg] }));

    // Build LLM context: only messages AFTER the last context divider.
    // Token-level fitting is delegated to the agent (context-budget.ts) so
    // we don't truncate twice and we keep semantic shape (tool_use/tool_result
    // pairing) intact.
    const allMessages = get().messages;
    const lastDividerIndex = findLastDividerIndex(allMessages);
    const contextMessages = allMessages.slice(lastDividerIndex);

    const llmMessages: LLMMessage[] = assembleLlmMessages(contextMessages);

    set({ isStreaming: true, streamingText: "", steps: [], error: null, knowledgeRefs: [], longTask: null });

    let fullText = "";
    let agentError: string | null = null;

    try {
      const { planMode, workingDirectory } = get();
      // Progress callback: update the running step's output in real-time
      const onProgress = (skill: string, output: string) => {
        set((s) => ({
          steps: s.steps.map((step) =>
            step.skill === skill && step.status === "running"
              ? { ...step, liveOutput: (step.liveOutput || "") + output + "\n" }
              : step,
          ),
        }));
      };
      // Per-request debug logger — only created when the toggle in the
      // `+` menu is on. Init failures are swallowed by DebugLogger itself.
      let debugLog: DebugLogger | undefined;
      const debugEnabled = useAppStore.getState().settings?.debugLogEnabled === true;
      if (debugEnabled) {
        debugLog = new DebugLogger(DebugLogger.newRequestId());
        await debugLog.init({
          sessionId,
          query: content.slice(0, 4000),
          planMode,
          workingDirectory,
        });
      }

      for await (const event of runAgent({ messages: llmMessages, sessionId, planMode, workingDirectory, onProgress, debugLog })) {
        handleEvent(event, set);
        if (event.type === "text-delta") {
          fullText += event.text;
        } else if (event.type === "error") {
          agentError = event.error;
        }
      }

      // Save message with steps — even if fullText is empty, steps may have useful info
      const completedSteps = get().steps.filter((s) => s.skill !== "__thinking__");
      if (fullText || completedSteps.length > 0 || agentError) {
        const assistantContent = agentError
          ? `${fullText ? `${fullText}\n\n` : ""}[Error: ${agentError}]`
          : fullText || "(No text output)";
        const assistantMsg = await createMessage({
          sessionId,
          role: "assistant",
          content: assistantContent,
          metadata: completedSteps.length > 0 ? { steps: completedSteps } : undefined,
        });
        set((s) => ({
          messages: [...s.messages, assistantMsg],
          isStreaming: false,
          streamingText: "",
          steps: [],
          longTask: null,
          error: agentError,
        }));
      } else {
        set({ isStreaming: false, longTask: null });
      }
    } catch (err) {
      // Save partial progress even on error — don't lose intermediate steps
      const errorSteps = get().steps.filter((s) => s.skill !== "__thinking__");
      const errorContent = fullText
        ? `${fullText}\n\n[Error: ${err}]`
        : `[Error: ${err}]`;
      const errorMsg = await createMessage({
        sessionId,
        role: "assistant",
        content: errorContent,
        metadata: errorSteps.length > 0 ? { steps: errorSteps } : undefined,
      });
      set((s) => ({
        messages: [...s.messages, errorMsg],
        isStreaming: false,
        streamingText: "",
        steps: [],
        longTask: null,
        error: String(err),
      }));
    }

    // Drain pending message queue — send the next queued message
    const pending = get().pendingMessages;
    if (pending.length > 0) {
      const [next, ...rest] = pending;
      set({ pendingMessages: rest });
      // Use setTimeout to let the state settle before the next sendMessage
      setTimeout(() => get().sendMessage(next), 50);
    }
  },

  clearContext: () => {
    // Insert a local divider marker — messages before it won't be sent to LLM
    const divider: Message = {
      id: newId(),
      sessionId: get().sessionId || "",
      role: CONTEXT_DIVIDER_ROLE,
      content: CONTEXT_DIVIDER_CONTENT,
      metadata: null,
      createdAt: dbNow(),
    };
    set((s) => ({
      messages: [...s.messages, divider],
      steps: [],
      knowledgeRefs: [],
      error: null,
      longTask: null,
    }));
  },

  togglePlanMode: () => {
    set((s) => ({ planMode: !s.planMode }));
  },

  setWorkingDirectory: (path: string) => {
    set({ workingDirectory: path });
    // Persist for next session
    setSetting("working_directory", path);
  },

  dumpContext: async () => {
    let { sessionId } = get();
    if (!sessionId) {
      const session = await createSession("Cowork");
      sessionId = session.id;
      set({ sessionId });
    }

    // Build llmMessages exactly the way sendMessage would, so the dump reflects
    // what the next LLM call would actually receive.
    const allMessages = get().messages;
    const lastDividerIndex = findLastDividerIndex(allMessages);
    const contextMessages = allMessages.slice(lastDividerIndex);
    const llmMessages: LLMMessage[] = assembleLlmMessages(contextMessages);

    const { planMode, workingDirectory } = get();
    let dump = "";
    try {
      for await (const event of runAgent({
        messages: llmMessages,
        sessionId,
        planMode,
        workingDirectory,
        dumpOnly: true,
      })) {
        if (event.type === "context-dump") dump = event.content;
      }
      set({ contextDump: dump || "(empty dump)" });
    } catch (err) {
      set({ contextDump: `Failed to build context dump: ${err}` });
    }
  },

  closeContextDump: () => set({ contextDump: null }),

  resetAll: async () => {
    try {
      await resetAllConversationAndMemory();
    } catch (err) {
      set({ error: `Reset failed: ${err}` });
      return;
    }
    const session = await createSession("Cowork");
    set({
      sessionId: session.id,
      messages: [],
      isStreaming: false,
      streamingText: "",
      steps: [],
      artifacts: [],
      knowledgeRefs: [],
      error: null,
      longTask: null,
      pendingMessages: [],
      contextDump: null,
    });
    const ack: Message = {
      id: newId(),
      sessionId: session.id,
      role: "assistant",
      content: "Reset complete. All sessions, messages, and memory have been cleared.",
      metadata: null,
      createdAt: dbNow(),
    };
    set((s) => ({ messages: [...s.messages, ack] }));
  },
}));

/** Find the index after the last context divider. Returns 0 if no divider. */
function findLastDividerIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === CONTEXT_DIVIDER_ROLE && messages[i].content === CONTEXT_DIVIDER_CONTENT) {
      return i + 1;
    }
  }
  return 0;
}

function handleEvent(
  event: AgentEvent,
  set: (fn: (s: SessionState) => Partial<SessionState>) => void,
) {
  switch (event.type) {
    case "text-delta":
      set((s) => ({ streamingText: s.streamingText + event.text }));
      break;
    case "thinking":
      if (event.active) {
        // Add a thinking step
        set((s) => ({
          steps: [...s.steps, { skill: "__thinking__", status: "running" }],
        }));
      } else {
        // Mark thinking step as done
        set((s) => ({
          steps: s.steps.map((step) =>
            step.skill === "__thinking__" && step.status === "running"
              ? { ...step, status: "done", success: true }
              : step,
          ),
        }));
      }
      break;
    case "long-task-start":
      set(() => ({
        longTask: {
          runId: event.runId,
          workspaceDir: event.workspaceDir,
          reason: event.reason,
          phases: [],
        },
      }));
      break;
    case "long-task-progress":
      set((s) => {
        const current = s.longTask || {
          runId: event.runId,
          workspaceDir: event.workspaceDir,
          reason: "",
          phases: [],
        };
        const phase: LongTaskPhase = {
          phase: event.phase,
          status: event.status,
          summary: event.summary,
          steps: event.steps || [],
          outputs: event.outputs,
          updatedAt: event.updatedAt,
        };
        const existingIndex = current.phases.findIndex((p) => p.phase === event.phase);
        const phases = existingIndex >= 0
          ? current.phases.map((p, i) => i === existingIndex ? phase : p)
          : [...current.phases, phase];
        const nextTask = { ...current, phases, planSteps: event.steps || [] };
        return { longTask: nextTask };
      });
      break;
    case "skill-start":
      set((s) => ({
        steps: [...s.steps, { skill: event.skill, status: "running", input: event.input, toolCallId: event.toolCallId }],
      }));
      break;
    case "skill-done":
      set((s) => {
        // Match the running step by toolCallId. Names alone could collide
        // when the LLM calls the same tool twice in one turn.
        const idx = s.steps.findIndex(
          (step) =>
            step.toolCallId === event.toolCallId ||
            (step.skill === event.skill && step.status === "running" && !step.toolCallId),
        );
        if (idx >= 0) {
          const next = s.steps.slice();
          next[idx] = {
            ...next[idx]!,
            status: "done",
            result: event.result,
            durationMs: event.durationMs,
            success: event.success,
            toolCallId: event.toolCallId,
          };
          return { steps: next };
        }
        // No matching skill-start. Some agent error paths (unknown tool,
        // truncated input) emit `skill-done` without a paired start —
        // append a synthetic completed step so the result still surfaces
        // in the UI panel AND lands in metadata.steps for re-ship.
        return {
          steps: [
            ...s.steps,
            {
              skill: event.skill,
              status: "done",
              result: event.result,
              durationMs: event.durationMs,
              success: event.success,
              toolCallId: event.toolCallId,
            },
          ],
        };
      });
      break;
    case "artifact":
      set((s) => ({ artifacts: [...s.artifacts, event.artifact] }));
      break;
    case "knowledge-ref":
      set(() => ({ knowledgeRefs: event.refs }));
      break;
    case "compacted":
      // Surface compaction as a synthetic step so users see what happened.
      // Past silent drop-oldest looked like the agent "forgot" — making the
      // summary turn visible kills that confusion.
      set((s) => ({
        steps: [
          ...s.steps,
          {
            skill: "__compact__",
            status: "done",
            success: true,
            result: `Conversation summarized to fit context window (preserved ${event.preservedUserMessages} user message${event.preservedUserMessages === 1 ? "" : "s"}, ~${event.estimatedTokens} tokens):\n\n${event.summary}`,
          },
        ],
      }));
      break;
    case "error":
      set(() => ({ error: event.error }));
      break;
  }
}

/** Check if a message is a context divider (for UI rendering). */
export function isContextDivider(message: Message): boolean {
  return message.role === CONTEXT_DIVIDER_ROLE && message.content === CONTEXT_DIVIDER_CONTENT;
}

/**
 * Assemble messages for the LLM as a NATIVE tool-block sequence —
 * `assistant.toolCalls[]` paired with `role: "tool"` entries. This
 * matches the Anthropic / OpenAI native protocols (the providers
 * convert these to `tool_use` / `tool_result` blocks respectively),
 * and crucially keeps system-generated tool history OUT of the
 * assistant message's `content` string.
 *
 * Past architecture used `appendTrustedToolHistory` to concatenate a
 * fenced `<<<TURN_TOOL_HISTORY>>>` block into the assistant content.
 * The model saw its own past responses formatted that way and started
 * mimicking the structure (printing fake tool-history blocks in new
 * responses, and asserting work was done without any tool calls). The
 * mimicry pathway is structurally closed here because tool history is
 * delivered as separate role:tool messages — content the model never
 * produces and so cannot accidentally imitate.
 *
 * Layout:
 *   user_1
 *   assistant_1 { content: "...", toolCalls: [{ id, name, input }, ...] }
 *   tool      { toolCallId, content: <summarized result> }   ← per call
 *   tool      { toolCallId, content: <summarized result> }
 *   user_2
 *   ...
 *
 * Steps without a `toolCallId` (legacy DB rows from before the field
 * was added) are skipped from the tool sequence — they degrade to a
 * pure-text assistant turn rather than break the assistant→tool pairing
 * contract that the providers / API enforce.
 */
export function assembleLlmMessages(messages: Message[]): LLMMessage[] {
  const conversational = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const out: LLMMessage[] = [];
  for (const m of conversational) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    // assistant — extract paired tool steps from metadata
    const steps = (m.metadata as { steps?: AgentStepRecord[] } | null)?.steps ?? [];
    const completed = steps.filter(
      (s) => s.skill !== "__thinking__" && s.skill !== "__compact__" && s.status === "done" && s.toolCallId,
    );
    const toolCalls: ToolCall[] = completed.map((s) => ({
      id: s.toolCallId!,
      name: s.skill,
      input: s.input ?? {},
    }));
    out.push({
      role: "assistant",
      content: m.content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });
    for (const s of completed) {
      out.push({
        role: "tool",
        toolCallId: s.toolCallId!,
        content: summarizeStepResult(s) || (s.success === false ? "[failed without result text]" : "[ok]"),
      });
    }
  }
  return sanitizeMessageSequence(out);
}

/**
 * Pre-send sanitizer — fixes structural issues that would cause API
 * rejections (Anthropic strictly requires `tool_use` ↔ `tool_result`
 * pairing in adjacent turns; OpenAI requires `tool_calls` followed by
 * matching `role: "tool"` messages). Mirrors massistant's approach.
 *
 * Three repairs:
 * 1. Inject `[cancelled]` tool result for any orphan `assistant.toolCalls`
 *    entry that has no matching following `role:tool` message. Happens
 *    when a session is cut short mid-tool, a tool is cancelled, or a
 *    legacy step is missing its result.
 * 2. Drop orphan `role:tool` messages that don't have a preceding
 *    `assistant.toolCalls` entry pointing at them.
 * 3. (Future: merge consecutive same-role messages — currently we don't
 *    produce that pattern, so omitted for now.)
 */
export function sanitizeMessageSequence(messages: LLMMessage[]): LLMMessage[] {
  const out: LLMMessage[] = [];
  // Track which toolCallIds were declared by the immediately-preceding
  // assistant message and still need a matching tool result.
  let pendingIds = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role === "assistant") {
      // If the previous assistant declared tool calls that never got
      // results (no role:tool messages followed), inject [cancelled]
      // for each before this new assistant turn starts.
      for (const id of pendingIds) {
        out.push({ role: "tool", toolCallId: id, content: "[cancelled]" });
      }
      pendingIds = new Set((m.toolCalls ?? []).map((tc) => tc.id));
      out.push(m);
      continue;
    }
    if (m.role === "tool") {
      // Drop orphan tool messages — keep only those whose toolCallId was
      // declared by a recent assistant.
      if (pendingIds.has(m.toolCallId)) {
        out.push(m);
        pendingIds.delete(m.toolCallId);
      }
      continue;
    }
    // user — flush pending [cancelled] before transitioning to user turn.
    for (const id of pendingIds) {
      out.push({ role: "tool", toolCallId: id, content: "[cancelled]" });
    }
    pendingIds = new Set();
    out.push(m);
  }
  // End-of-stream: any pending tool_use entries become [cancelled].
  for (const id of pendingIds) {
    out.push({ role: "tool", toolCallId: id, content: "[cancelled]" });
  }
  return out;
}

function summarizeStepResult(step: AgentStepRecord): string {
  if (step.result === undefined || step.result === null) return "";
  const raw = typeof step.result === "string" ? step.result : JSON.stringify(step.result);
  if (!raw) return "";
  const tool = getTool(step.skill);
  if (tool?.historySummarizer) {
    try {
      return tool.historySummarizer(raw, step.success === false ? "fail" : "ok");
    } catch {
      // Fall through to generic truncate if a summarizer throws.
    }
  }
  return summarizeForContext(raw);
}

function summarizeForContext(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > TOOL_HISTORY_RESULT_LIMIT
    ? `${text.slice(0, TOOL_HISTORY_RESULT_LIMIT)}... (${text.length} chars total)`
    : text;
}
