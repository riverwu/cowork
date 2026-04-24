import { useEffect, useRef, useState } from "react";
import { IconDocument, IconCheck, IconSettings } from "@/components/icons";
import { isContextDivider } from "@/stores/session-store";
import { MarkdownContent } from "./markdown-renderer";
import { t } from "@/lib/i18n";
import type { Message, Artifact } from "@/types";

interface Step {
  skill: string;
  status: "running" | "done";
  input?: unknown;
  result?: unknown;
  durationMs?: number;
  liveOutput?: string;
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
    <div className="space-y-4">
      {messages.map((msg) =>
        isContextDivider(msg) ? (
          <ContextDivider key={msg.id} />
        ) : msg.role === "user" ? (
          <UserBubble key={msg.id} content={msg.content} />
        ) : (
          <AssistantMessage key={msg.id} message={msg} />
        ),
      )}

      {/* Streaming state */}
      {isStreaming && (
        <div className="space-y-3">
          {/* Knowledge refs */}
          {knowledgeRefs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {knowledgeRefs.map((ref, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-[var(--surface-container)] text-[var(--on-surface-secondary)]" title={ref.snippet}>
                  <IconDocument size={10} /> {ref.filename}
                </span>
              ))}
            </div>
          )}

          {/* Live tool steps — full detail */}
          {steps.length > 0 && (
            <div className="space-y-1.5">
              {steps.map((step, i) => (
                <LiveStepItem key={i} step={step} />
              ))}
            </div>
          )}

          {/* Streaming text */}
          {streamingText && (
            <div className="max-w-[90%]">
              <div className="text-[13px] text-[var(--on-surface)] leading-[1.7] markdown-body">
                <MarkdownContent content={streamingText} />
                <span className="inline-block w-[3px] h-[14px] ml-0.5 bg-[var(--primary-accent)] animate-pulse rounded-sm" />
              </div>
            </div>
          )}

          {/* Initial thinking */}
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

// ---- User bubble ----

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] px-4 py-2.5 rounded-2xl bg-[var(--primary)] text-white text-[13px] leading-relaxed whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}

// ---- Assistant message (with collapsed steps) ----

function AssistantMessage({ message }: { message: Message }) {
  const savedSteps = (message.metadata as { steps?: Step[] })?.steps;

  return (
    <div className="space-y-2">
      {/* Collapsed steps summary */}
      {savedSteps && savedSteps.length > 0 && (
        <CollapsedSteps steps={savedSteps} />
      )}

      {/* Message content */}
      <div className="max-w-[90%]">
        <div className="text-[13px] text-[var(--on-surface)] leading-[1.7] markdown-body">
          <MarkdownContent content={message.content} />
        </div>
      </div>
    </div>
  );
}

// ---- Collapsed steps (post-completion) ----

function CollapsedSteps({ steps }: { steps: Step[] }) {
  const [expanded, setExpanded] = useState(false);
  const totalTime = steps.reduce((sum, s) => sum + (s.durationMs || 0), 0);
  const toolNames = [...new Set(steps.map((s) => formatSkillName(s.skill)))];

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-low)] overflow-hidden">
      {/* Summary bar — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer hover:bg-[var(--surface-container)] transition-colors"
      >
        <IconSettings size={12} className="text-[var(--on-surface-tertiary)]" />
        <span className="text-[11px] text-[var(--on-surface-secondary)] flex-1">
          {steps.length} tool{steps.length > 1 ? "s" : ""}: {toolNames.join(", ")}
        </span>
        <span className="text-[10px] text-[var(--on-surface-tertiary)]">
          {totalTime > 0 ? `${(totalTime / 1000).toFixed(1)}s` : ""}
        </span>
        <span className="text-[10px] text-[var(--on-surface-tertiary)]">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]/50">
          {steps.map((step, i) => (
            <CompletedStepDetail key={i} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Completed step detail (in collapsed panel) ----

function CompletedStepDetail({ step }: { step: Step }) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="px-3 py-2">
      <button
        onClick={() => setShowDetail(!showDetail)}
        className="w-full flex items-center gap-2 text-left cursor-pointer"
      >
        <span className="text-[var(--success)]"><IconCheck size={12} /></span>
        <span className="text-[12px] font-medium text-[var(--on-surface)]">{formatSkillName(step.skill)}</span>
        {step.durationMs !== undefined && (
          <span className="text-[10px] text-[var(--on-surface-tertiary)]">{(step.durationMs / 1000).toFixed(1)}s</span>
        )}
        <span className="text-[10px] text-[var(--on-surface-tertiary)] ml-auto">{showDetail ? "−" : "+"}</span>
      </button>

      {showDetail && (
        <div className="mt-1.5 space-y-1.5 pl-5">
          {/* Input */}
          {step.input != null && (
            <div>
              <span className="text-[10px] font-medium text-[var(--on-surface-tertiary)] uppercase">Input</span>
              <pre className="text-[11px] text-[var(--on-surface-secondary)] bg-[var(--surface-container)] rounded-lg px-2.5 py-1.5 mt-0.5 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-[120px] overflow-y-auto">
                {formatValue(step.input)}
              </pre>
            </div>
          )}
          {/* Output */}
          {step.result != null && (
            <div>
              <span className="text-[10px] font-medium text-[var(--on-surface-tertiary)] uppercase">Output</span>
              <pre className="text-[11px] text-[var(--on-surface-secondary)] bg-[var(--surface-container)] rounded-lg px-2.5 py-1.5 mt-0.5 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-[120px] overflow-y-auto">
                {formatValue(step.result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Live step (during streaming) — show full detail ----

function LiveStepItem({ step }: { step: Step }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-lowest)] px-3 py-2">
      <div className="flex items-center gap-2">
        {step.status === "running" ? (
          <span className="inline-block w-3 h-3 border-[1.5px] border-[var(--primary-accent)] border-t-transparent rounded-full animate-spin shrink-0" />
        ) : (
          <span className="text-[var(--success)] shrink-0"><IconCheck size={13} /></span>
        )}
        <span className="text-[12px] font-medium text-[var(--on-surface)]">{formatSkillName(step.skill)}</span>
        {step.durationMs !== undefined && (
          <span className="text-[10px] text-[var(--on-surface-tertiary)]">{(step.durationMs / 1000).toFixed(1)}s</span>
        )}
      </div>

      {/* Input params */}
      {step.input != null && (
        <div className="mt-1.5 pl-5">
          <pre className="text-[11px] text-[var(--on-surface-secondary)] bg-[var(--surface-low)] rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-[80px] overflow-y-auto">
            {formatValue(step.input)}
          </pre>
        </div>
      )}

      {/* Live output (while running) */}
      {step.status === "running" && step.liveOutput && (
        <div className="mt-1 pl-5">
          <pre className="text-[11px] text-[var(--on-surface-tertiary)] bg-[var(--surface-low)] rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-[100px] overflow-y-auto">
            {truncate(step.liveOutput, 500)}
          </pre>
        </div>
      )}

      {/* Output (when done) */}
      {step.status === "done" && step.result != null && (
        <div className="mt-1 pl-5">
          <pre className="text-[11px] text-[var(--on-surface-tertiary)] bg-[var(--surface-low)] rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-[60px] overflow-y-auto">
            {truncate(formatValue(step.result), 200)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---- Context divider ----

function ContextDivider() {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-[var(--border)]" />
      <span className="text-[11px] text-[var(--on-surface-tertiary)] whitespace-nowrap">
        {t("home.clearContextDone")}
      </span>
      <div className="flex-1 h-px bg-[var(--border)]" />
    </div>
  );
}

// ---- Helpers ----

function formatSkillName(name: string): string {
  return name.replace(/^skill_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}
