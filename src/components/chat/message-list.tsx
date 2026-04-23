import { useEffect, useRef } from "react";
import { IconDocument, IconCheck } from "@/components/icons";
import { isContextDivider } from "@/stores/session-store";
import { MarkdownContent } from "./markdown-renderer";
import { t } from "@/lib/i18n";
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
      {messages.map((msg) =>
        isContextDivider(msg) ? (
          <div key={msg.id} className="flex items-center gap-3 py-2">
            <div className="flex-1 h-px bg-[var(--border)]" />
            <span className="text-[11px] text-[var(--on-surface-tertiary)] whitespace-nowrap">
              {t("home.clearContextDone")}
            </span>
            <div className="flex-1 h-px bg-[var(--border)]" />
          </div>
        ) : (
          <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
        ),
      )}

      {isStreaming && (
        <div className="space-y-3">
          {knowledgeRefs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {knowledgeRefs.map((ref, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-2 py-0.5 text-[11px] rounded-full bg-[var(--surface-container)] text-[var(--on-surface-secondary)]"
                  title={ref.snippet}
                >
                  <IconDocument size={12} /> {ref.filename}
                </span>
              ))}
            </div>
          )}

          {steps.length > 0 && (
            <div className="space-y-1.5 pl-1">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px] text-[var(--on-surface-secondary)]">
                  {step.status === "running" ? (
                    <span className="inline-block w-3 h-3 border-[1.5px] border-[var(--primary-accent)] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span className="text-[var(--success)]"><IconCheck size={13} /></span>
                  )}
                  <span>{formatSkillName(step.skill)}</span>
                  {step.durationMs !== undefined && (
                    <span className="text-[var(--on-surface-tertiary)]">{(step.durationMs / 1000).toFixed(1)}s</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {streamingText && (
            <MessageBubble role="assistant" content={streamingText} isStreaming />
          )}

          {!streamingText && steps.length === 0 && (
            <div className="flex items-center gap-2 text-[13px] text-[var(--on-surface-tertiary)]">
              <span className="inline-block w-3 h-3 border-[1.5px] border-[var(--primary-accent)] border-t-transparent rounded-full animate-spin" />
              Thinking...
            </div>
          )}
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}

function MessageBubble({ role, content, isStreaming }: {
  role: string;
  content: string;
  isStreaming?: boolean;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] px-4 py-2.5 rounded-2xl bg-[var(--primary)] text-white text-[13px] leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[90%]">
      <div className="text-[13px] text-[var(--on-surface)] leading-[1.7] markdown-body">
        <MarkdownContent content={content} />
        {isStreaming && <span className="inline-block w-[3px] h-[14px] ml-0.5 bg-[var(--primary-accent)] animate-pulse rounded-sm" />}
      </div>
    </div>
  );
}

function formatSkillName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
