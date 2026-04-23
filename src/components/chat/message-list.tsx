import { useEffect, useRef } from "react";
import type { Message, Artifact } from "@/types";

interface Step {
  skill: string;
  status: "running" | "done";
  result?: unknown;
  durationMs?: number;
}

interface KnowledgeRef {
  documentId: string;
  filename: string;
  snippet: string;
}

interface MessageListProps {
  messages: Message[];
  isStreaming: boolean;
  streamingText: string;
  steps: Step[];
  artifacts: Artifact[];
  knowledgeRefs: KnowledgeRef[];
}

export function MessageList({
  messages,
  isStreaming,
  streamingText,
  steps,
  knowledgeRefs,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, steps]);

  return (
    <div className="space-y-5">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
      ))}

      {isStreaming && (
        <div className="space-y-3">
          {knowledgeRefs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {knowledgeRefs.map((ref, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-2 py-0.5 text-xs rounded-full bg-[var(--surface-container)] text-[var(--on-surface-variant)]"
                  title={ref.snippet}
                >
                  📄 {ref.filename}
                </span>
              ))}
            </div>
          )}

          {steps.length > 0 && (
            <div className="space-y-1.5">
              {steps.map((step, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs text-[var(--on-surface-variant)]"
                >
                  {step.status === "running" ? (
                    <span className="inline-block w-3 h-3 border-2 border-[var(--secondary)] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span className="text-emerald-600">✓</span>
                  )}
                  <span>{formatSkillName(step.skill)}</span>
                  {step.durationMs !== undefined && (
                    <span className="text-[var(--outline)]">
                      {(step.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {streamingText && (
            <MessageBubble role="assistant" content={streamingText} isStreaming />
          )}

          {!streamingText && steps.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-[var(--outline)]">
              <span className="inline-block w-3 h-3 border-2 border-[var(--secondary)] border-t-transparent rounded-full animate-spin" />
              Thinking...
            </div>
          )}
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}

function MessageBubble({
  role,
  content,
  isStreaming,
}: {
  role: string;
  content: string;
  isStreaming?: boolean;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] px-4 py-2.5 rounded-2xl bg-[var(--primary-container)] text-white text-sm whitespace-pre-wrap">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[90%]">
      <div className="text-sm text-[var(--on-surface)] whitespace-pre-wrap leading-relaxed">
        {content}
        {isStreaming && <span className="inline-block w-1.5 h-4 ml-0.5 bg-[var(--secondary)] animate-pulse rounded-sm" />}
      </div>
    </div>
  );
}

function formatSkillName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
