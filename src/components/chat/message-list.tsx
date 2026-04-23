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
  artifacts,
  knowledgeRefs,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, steps]);

  return (
    <div className="space-y-4">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
      ))}

      {/* Streaming state */}
      {isStreaming && (
        <div className="space-y-3">
          {/* Knowledge references */}
          {knowledgeRefs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {knowledgeRefs.map((ref, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-2 py-0.5 text-xs rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]"
                  title={ref.snippet}
                >
                  📄 {ref.filename}
                </span>
              ))}
            </div>
          )}

          {/* Execution steps */}
          {steps.length > 0 && (
            <div className="space-y-1">
              {steps.map((step, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]"
                >
                  {step.status === "running" ? (
                    <span className="inline-block w-3 h-3 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span className="text-green-400">✓</span>
                  )}
                  <span>{formatSkillName(step.skill)}</span>
                  {step.durationMs !== undefined && (
                    <span className="text-[var(--color-text-tertiary)]">
                      {(step.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Streaming text */}
          {streamingText && (
            <MessageBubble role="assistant" content={streamingText} isStreaming />
          )}

          {/* Loading indicator when no text yet */}
          {!streamingText && steps.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-[var(--color-text-tertiary)]">
              <span className="inline-block w-3 h-3 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
              Thinking...
            </div>
          )}
        </div>
      )}

      {/* Artifacts */}
      {artifacts.map((artifact) => (
        <ArtifactCard key={artifact.id} artifact={artifact} />
      ))}

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
        <div className="max-w-[80%] px-4 py-2.5 rounded-2xl bg-[var(--color-accent)] text-white text-sm whitespace-pre-wrap">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[90%]">
      <div className="text-sm text-[var(--color-text)] whitespace-pre-wrap leading-relaxed">
        {content}
        {isStreaming && <span className="inline-block w-1.5 h-4 ml-0.5 bg-[var(--color-accent)] animate-pulse" />}
      </div>
    </div>
  );
}

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] flex items-center gap-2">
        <span className="text-sm">📄</span>
        <span className="text-sm font-medium">{artifact.title}</span>
        <span className="text-xs text-[var(--color-text-tertiary)] ml-auto">{artifact.type}</span>
      </div>
      <div className="px-4 py-3 text-sm text-[var(--color-text-secondary)] max-h-60 overflow-y-auto whitespace-pre-wrap">
        {artifact.content.slice(0, 500)}
        {artifact.content.length > 500 && "..."}
      </div>
    </div>
  );
}

function formatSkillName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
