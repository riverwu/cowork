import { create } from "zustand";
import { runAgent } from "@/lib/ai/agent";
import { skillRegistry } from "@/lib/ai/skill-registry";
import type { LLMMessage } from "@/lib/ai/providers/types";
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
}

interface LongTaskPhase {
  phase: string;
  status: "pending" | "running" | "done" | "failed";
  summary: string;
  outputs: { title: string; path?: string; kind?: "file" | "artifact" | "note" }[];
  updatedAt: number;
}

interface LongTaskState {
  runId: string;
  workspaceDir: string;
  reason: string;
  phases: LongTaskPhase[];
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

    const llmMessages: LLMMessage[] = contextMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role === "user" ? "user" as const : "assistant" as const,
        content: m.role === "assistant" ? appendTrustedToolHistory(m) : m.content,
      }));

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
      for await (const event of runAgent({ messages: llmMessages, sessionId, planMode, workingDirectory, onProgress })) {
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
          error: agentError,
        }));
      } else {
        set({ isStreaming: false });
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
    const llmMessages: LLMMessage[] = contextMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role === "user" ? "user" as const : "assistant" as const,
        content: m.role === "assistant" ? appendTrustedToolHistory(m) : m.content,
      }));

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
          outputs: event.outputs,
          updatedAt: event.updatedAt,
        };
        const existingIndex = current.phases.findIndex((p) => p.phase === event.phase);
        const phases = existingIndex >= 0
          ? current.phases.map((p, i) => i === existingIndex ? phase : p)
          : [...current.phases, phase];
        return { longTask: { ...current, phases } };
      });
      break;
    case "skill-start":
      set((s) => ({
        steps: [...s.steps, { skill: event.skill, status: "running", input: event.input }],
      }));
      break;
    case "skill-done":
      set((s) => ({
        steps: s.steps.map((step) =>
          step.skill === event.skill && step.status === "running"
            ? { ...step, status: "done", result: event.result, durationMs: event.durationMs, success: event.success }
            : step,
        ),
      }));
      break;
    case "artifact":
      set((s) => ({ artifacts: [...s.artifacts, event.artifact] }));
      break;
    case "knowledge-ref":
      set(() => ({ knowledgeRefs: event.refs }));
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

function appendTrustedToolHistory(message: Message): string {
  const steps = (message.metadata as { steps?: AgentStepRecord[] } | null)?.steps;
  const completedSteps = steps?.filter((step) => step.skill !== "__thinking__" && step.status === "done");
  if (!completedSteps?.length) return message.content;

  // Lead with [OK] / [FAIL] tags so a model skimming this section can't
  // collapse "1 of 23 calls failed" into "all good". Use fenced delimiters
  // that the LLM is told never to reproduce — past turns showed the model
  // mimicking the old `[Trusted tool execution record …]` heading inside
  // its own assistant text, which then contaminated the next turn's
  // history. The fenced markers here are easier to spot and to refuse.
  const lines = completedSteps.map((step) => {
    const tag = step.success === false ? "[FAIL]" : "[OK]";
    const result = summarizeForContext(step.result);
    return `${tag} ${step.skill}${result ? ` :: ${result}` : ""}`;
  });

  return [
    message.content,
    "",
    "<<<TURN_TOOL_HISTORY (system-generated; do NOT reproduce this section in your own assistant text — the user already sees it)>>>",
    ...lines,
    "<<<END_TURN_TOOL_HISTORY>>>",
  ].join("\n");
}

function summarizeForContext(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > TOOL_HISTORY_RESULT_LIMIT
    ? `${text.slice(0, TOOL_HISTORY_RESULT_LIMIT)}... (${text.length} chars total)`
    : text;
}
