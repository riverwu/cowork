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

/** Special role for context divider markers. */
const CONTEXT_DIVIDER_ROLE = "system" as const;
const CONTEXT_DIVIDER_CONTENT = "__CONTEXT_CLEARED__";

interface KnowledgeRef {
  documentId: string;
  filename: string;
  snippet: string;
}

interface SessionState {
  sessionId: string | null;
  messages: Message[];
  isStreaming: boolean;
  streamingText: string;
  steps: Array<{ skill: string; status: "running" | "done"; input?: unknown; result?: unknown; durationMs?: number }>;
  artifacts: Artifact[];
  knowledgeRefs: KnowledgeRef[];
  error: string | null;
  initialized: boolean;
  planMode: boolean;
  /** Working directory — all tools use this as base. */
  workingDirectory: string;

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
  initialized: false,
  planMode: false,
  workingDirectory: "",

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
    });
  },

  sendMessage: async (content: string) => {
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
        content: m.content,
      }));

    set({ isStreaming: true, streamingText: "", steps: [], error: null, knowledgeRefs: [] });

    let fullText = "";

    try {
      const { planMode, workingDirectory } = get();
      for await (const event of runAgent({ messages: llmMessages, sessionId, planMode, workingDirectory })) {
        handleEvent(event, set);
        if (event.type === "text-delta") {
          fullText += event.text;
        }
      }

      if (fullText) {
        const completedSteps = get().steps;
        const assistantMsg = await createMessage({
          sessionId,
          role: "assistant",
          content: fullText,
          metadata: completedSteps.length > 0 ? { steps: completedSteps } : undefined,
        });
        set((s) => ({
          messages: [...s.messages, assistantMsg],
          isStreaming: false,
          streamingText: "",
          steps: [], // Clear steps after saving to message
        }));
      } else {
        set({ isStreaming: false });
      }
    } catch (err) {
      set({ isStreaming: false, error: String(err) });
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
    case "skill-start":
      set((s) => ({
        steps: [...s.steps, { skill: event.skill, status: "running", input: event.input }],
      }));
      break;
    case "skill-done":
      set((s) => ({
        steps: s.steps.map((step) =>
          step.skill === event.skill && step.status === "running"
            ? { ...step, status: "done", result: event.result, durationMs: event.durationMs }
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
