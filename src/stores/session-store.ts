import { create } from "zustand";
import { runAgent } from "@/lib/ai/agent";
import type { LLMMessage } from "@/lib/ai/providers/types";
import type { AgentEvent, Artifact, Message } from "@/types";
import { createSession, createMessage, listMessages, updateSessionTitle } from "@/lib/db";

interface KnowledgeRef {
  documentId: string;
  filename: string;
  snippet: string;
}

interface SessionState {
  // Current session
  sessionId: string | null;
  messages: Message[];
  isStreaming: boolean;
  streamingText: string;
  steps: Array<{ skill: string; status: "running" | "done"; result?: unknown; durationMs?: number }>;
  artifacts: Artifact[];
  knowledgeRefs: KnowledgeRef[];
  error: string | null;

  // Actions
  startNewSession: () => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  reset: () => void;
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

  startNewSession: async () => {
    const session = await createSession();
    set({
      sessionId: session.id,
      messages: [],
      artifacts: [],
      knowledgeRefs: [],
      steps: [],
      error: null,
    });
  },

  loadSession: async (sessionId: string) => {
    const messages = await listMessages(sessionId);
    set({ sessionId, messages, artifacts: [], knowledgeRefs: [], steps: [], error: null });
  },

  sendMessage: async (content: string) => {
    const state = get();
    let sessionId = state.sessionId;

    // Auto-create session if needed
    if (!sessionId) {
      const session = await createSession();
      sessionId = session.id;
      set({ sessionId });
    }

    // Save user message
    const userMsg = await createMessage({ sessionId, role: "user", content });
    set((s) => ({ messages: [...s.messages, userMsg] }));

    // Auto-title session from first message
    if (state.messages.length === 0) {
      const title = content.length > 50 ? content.slice(0, 50) + "..." : content;
      await updateSessionTitle(sessionId, title);
    }

    // Build LLM message history
    const llmMessages: LLMMessage[] = get().messages.map((m) => ({
      role: m.role === "user" ? "user" as const : "assistant" as const,
      content: m.content,
    }));

    // Start streaming
    set({ isStreaming: true, streamingText: "", steps: [], error: null });

    let fullText = "";

    try {
      for await (const event of runAgent({ messages: llmMessages, sessionId })) {
        handleEvent(event, set, get);
        if (event.type === "text-delta") {
          fullText += event.text;
        }
      }

      // Save assistant message
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

  reset: () => {
    set({
      sessionId: null,
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
  _get: () => SessionState,
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
