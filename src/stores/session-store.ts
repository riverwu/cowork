import { create } from "zustand";
import { runAgent } from "@/lib/ai/agent";
import type { LLMMessage } from "@/lib/ai/providers/types";
import type { AgentEvent, Artifact, Message } from "@/types";
import {
  createSession, createMessage, listMessages,
  listRecentSessions,
} from "@/lib/db";

/** Max messages sent to LLM (context window management).
 *  UI shows all messages, but only recent ones go to the model. */
const LLM_CONTEXT_WINDOW = 40;

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
  steps: Array<{ skill: string; status: "running" | "done"; result?: unknown; durationMs?: number }>;
  artifacts: Artifact[];
  knowledgeRefs: KnowledgeRef[];
  error: string | null;
  /** Whether the session has been loaded from DB on startup. */
  initialized: boolean;

  /** Load the persistent session on app startup. Creates one if none exists. */
  initialize: () => Promise<void>;
  /** Send a user message and run the agent. */
  sendMessage: (content: string) => Promise<void>;
  /** Clear conversation display (start fresh visually, but history remains in DB). */
  clearConversation: () => Promise<void>;
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

  initialize: async () => {
    // Try to resume the most recent active session
    const recent = await listRecentSessions(1);
    let sessionId: string;
    let messages: Message[] = [];

    if (recent.length > 0 && recent[0].status === "active") {
      // Resume existing session
      sessionId = recent[0].id;
      messages = await listMessages(sessionId);
    } else {
      // Create a new session
      const session = await createSession("Cowork");
      sessionId = session.id;
    }

    set({
      sessionId,
      messages,
      initialized: true,
      artifacts: [],
      knowledgeRefs: [],
      steps: [],
      error: null,
    });
  },

  sendMessage: async (content: string) => {
    let { sessionId } = get();

    // Ensure session exists
    if (!sessionId) {
      const session = await createSession("Cowork");
      sessionId = session.id;
      set({ sessionId });
    }

    // Persist user message immediately
    const userMsg = await createMessage({ sessionId, role: "user", content });
    set((s) => ({ messages: [...s.messages, userMsg] }));

    // Build LLM message history (windowed for context management)
    const allMessages = get().messages;
    const windowedMessages = allMessages.slice(-LLM_CONTEXT_WINDOW);
    const llmMessages: LLMMessage[] = windowedMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role === "user" ? "user" as const : "assistant" as const,
        content: m.content,
      }));

    // Start streaming
    set({ isStreaming: true, streamingText: "", steps: [], error: null, knowledgeRefs: [] });

    let fullText = "";

    try {
      for await (const event of runAgent({ messages: llmMessages, sessionId })) {
        handleEvent(event, set);
        if (event.type === "text-delta") {
          fullText += event.text;
        }
      }

      // Persist assistant message
      if (fullText) {
        const assistantMsg = await createMessage({
          sessionId,
          role: "assistant",
          content: fullText,
        });
        set((s) => ({
          messages: [...s.messages, assistantMsg],
          isStreaming: false,
          streamingText: "",
        }));
      } else {
        set({ isStreaming: false });
      }
    } catch (err) {
      set({ isStreaming: false, error: String(err) });
    }
  },

  clearConversation: async () => {
    // Create a new session for a fresh start
    // Old messages remain in DB (accessible via memory system)
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
    });
  },
}));

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
        steps: [...s.steps, { skill: event.skill, status: "running" }],
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
