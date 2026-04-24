import { create } from "zustand";
import { runAgent } from "@/lib/ai/agent";
import { skillRegistry } from "@/lib/ai/skill-registry";
import type { LLMMessage } from "@/lib/ai/providers/types";
import type { AgentEvent, Artifact, Message } from "@/types";
import {
  createSession, createMessage, listMessages,
  listRecentSessions, getSetting, setSetting,
} from "@/lib/db";
import { now as dbNow, newId } from "@/lib/db";
import { getEnv } from "@/lib/tauri";

/** Max messages sent to LLM (context window management). */
const LLM_CONTEXT_WINDOW = 40;
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

  initialize: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  clearContext: () => void;
  togglePlanMode: () => void;
  setWorkingDirectory: (path: string) => void;
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

    // Build LLM context: only messages AFTER the last context divider
    const allMessages = get().messages;
    const lastDividerIndex = findLastDividerIndex(allMessages);
    const contextMessages = allMessages.slice(lastDividerIndex);
    const windowedMessages = contextMessages.slice(-LLM_CONTEXT_WINDOW);

    const llmMessages: LLMMessage[] = windowedMessages
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

  const lines = completedSteps.map((step) => {
    const status = step.success === false ? "failed" : "succeeded";
    const result = summarizeForContext(step.result);
    return `- ${step.skill}: ${status}${result ? `; result: ${result}` : ""}`;
  });

  return `${message.content}\n\n[Trusted tool execution record from this assistant turn]\n${lines.join("\n")}`;
}

function summarizeForContext(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > TOOL_HISTORY_RESULT_LIMIT
    ? `${text.slice(0, TOOL_HISTORY_RESULT_LIMIT)}... (${text.length} chars total)`
    : text;
}
