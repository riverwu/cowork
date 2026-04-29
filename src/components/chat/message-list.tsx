import { useEffect, useRef, useState } from "react";
import { FileTypeIcon, IconDocument, IconCheck, IconSettings, IconWarning, IconFolder } from "@/components/icons";
import { isContextDivider } from "@/stores/session-store";
import { MarkdownContent } from "./markdown-renderer";
import { openPath, revealInFolder } from "@/lib/tauri";
import { outputsFromSteps, type ProducedOutput } from "@/lib/outputs";
import { t } from "@/lib/i18n";
import type { Message } from "@/types";

interface Step {
  skill: string;
  status: "running" | "done";
  input?: unknown;
  result?: unknown;
  durationMs?: number;
  liveOutput?: string;
  success?: boolean;
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

          {/* Live tool steps */}
          {steps.length > 0 && (
            <div className="space-y-1.5">
              {steps.map((step, i) => (
                <LiveStepItem key={i} step={step} />
              ))}
            </div>
          )}

          {outputsFromSteps(steps).length > 0 && (
            <ProducedOutputs outputs={outputsFromSteps(steps)} />
          )}

          {/* Streaming text */}
          {streamingText && (
            <div className="max-w-[90%]">
            <div className="text-[14.5px] text-[var(--chat-text)] leading-[1.78] font-normal markdown-body">
                <MarkdownContent content={streamingText} />
                <span className="inline-block w-[3px] h-[14px] ml-0.5 bg-[var(--primary-accent)] animate-pulse rounded-sm" />
              </div>
            </div>
          )}

          {/* Initial loading — before any steps arrive */}
          {!streamingText && steps.length === 0 && (
            <div className="flex items-center gap-2 text-[13px] text-[var(--on-surface-tertiary)]">
              <span className="inline-block w-3 h-3 border-[1.5px] border-[var(--primary-accent)] border-t-transparent rounded-full animate-spin" />
              Starting...
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
      <div className="max-w-[75%] px-4 py-2.5 rounded-2xl bg-[var(--surface-lowest)] text-[var(--chat-text)] text-[13.5px] leading-[1.65] font-normal ring-1 ring-black/[0.04] shadow-[var(--shadow-sm)] markdown-body">
        <MarkdownContent content={content} />
      </div>
    </div>
  );
}

// ---- Assistant message (with collapsed steps) ----

function AssistantMessage({ message }: { message: Message }) {
  const savedSteps = (message.metadata as { steps?: Step[] })?.steps;
  const outputs = mergeOutputs([
    ...(savedSteps ? outputsFromSteps(savedSteps) : []),
  ]);

  return (
    <div className="space-y-2">
      {savedSteps && savedSteps.length > 0 && (
        <CollapsedSteps steps={savedSteps} />
      )}
      {outputs.length > 0 && (
        <ProducedOutputs outputs={outputs} />
      )}
      <div className="max-w-[90%]">
        <div className="text-[14.5px] text-[var(--chat-text)] leading-[1.78] font-normal markdown-body">
          <MarkdownContent content={message.content} />
        </div>
      </div>
    </div>
  );
}

function mergeOutputs(outputs: ProducedOutput[]): ProducedOutput[] {
  const seen = new Set<string>();
  return outputs.filter((output) => {
    const key = output.path || output.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---- Collapsed steps (post-completion) ----

function CollapsedSteps({ steps: allSteps }: { steps: Step[] }) {
  const [expanded, setExpanded] = useState(false);
  // Filter out thinking steps for display
  const steps = allSteps.filter((s) => s.skill !== "__thinking__");
  if (steps.length === 0) return null;
  const totalTime = steps.reduce((sum, s) => sum + (s.durationMs || 0), 0);
  const toolNames = [...new Set(steps.map((s) => formatSkillName(s.skill)))];
  const failCount = steps.filter((s) => s.success === false).length;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-low)] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer hover:bg-[var(--surface-container)] transition-colors"
      >
        <IconSettings size={12} className="text-[var(--on-surface-tertiary)]" />
        <span className="text-[11px] text-[var(--on-surface-secondary)] flex-1">
          {steps.length} tool{steps.length > 1 ? "s" : ""}: {toolNames.join(", ")}
          {failCount > 0 && <span className="text-[var(--error)] ml-1">({failCount} failed)</span>}
        </span>
        <span className="text-[10px] text-[var(--on-surface-tertiary)]">
          {totalTime > 0 ? `${(totalTime / 1000).toFixed(1)}s` : ""}
        </span>
        <span className="text-[10px] text-[var(--on-surface-tertiary)]">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

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

// ---- Completed step detail ----

function CompletedStepDetail({ step }: { step: Step }) {
  const [showDetail, setShowDetail] = useState(false);
  const failed = step.success === false;

  return (
    <div className="px-3 py-2">
      <button
        onClick={() => setShowDetail(!showDetail)}
        className="w-full flex items-center gap-2 text-left cursor-pointer"
      >
        {failed
          ? <span className="text-[var(--error)]"><IconWarning size={12} /></span>
          : <span className="text-[var(--success)]"><IconCheck size={12} /></span>
        }
        <span className={`text-[12px] font-medium ${failed ? "text-[var(--error)]" : "text-[var(--on-surface)]"}`}>
          {formatSkillName(step.skill)}
        </span>
        {step.durationMs !== undefined && (
          <span className="text-[10px] text-[var(--on-surface-tertiary)]">{(step.durationMs / 1000).toFixed(1)}s</span>
        )}
        <span className="text-[10px] text-[var(--on-surface-tertiary)] ml-auto">{showDetail ? "−" : "+"}</span>
      </button>

      {showDetail && (
        <div className="mt-1.5 space-y-1.5 pl-5">
          {step.input != null && (
            <div>
              <span className="text-[10px] font-medium text-[var(--on-surface-tertiary)] uppercase">Input</span>
              <pre className="text-[11px] text-[var(--on-surface-secondary)] bg-[var(--surface-container)] rounded-lg px-2.5 py-1.5 mt-0.5 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-[120px] overflow-y-auto">
                {formatValue(step.input)}
              </pre>
            </div>
          )}
          {step.result != null && (
            <div>
              <span className="text-[10px] font-medium text-[var(--on-surface-tertiary)] uppercase">Output</span>
              <StepResultContent result={formatValue(step.result)} failed={failed} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Live step (during streaming) ----

function LiveStepItem({ step }: { step: Step }) {
  // Thinking step — compact display
  if (step.skill === "__thinking__") {
    if (step.status === "done") return null; // Hide completed thinking steps
    return (
      <div className="flex items-center gap-2 py-1 text-[var(--on-surface-tertiary)]">
        <span className="inline-block w-3 h-3 border-[1.5px] border-[var(--primary-accent)] border-t-transparent rounded-full animate-spin shrink-0" />
        <span className="text-[12px]">Thinking...</span>
        <LiveTimer />
      </div>
    );
  }

  const failed = step.status === "done" && step.success === false;

  return (
    <div className={`rounded-lg border px-3 py-2 ${failed ? "border-[var(--error)]/30 bg-red-50/30" : "border-[var(--border)] bg-[var(--surface-lowest)]"}`}>
      <div className="flex items-center gap-2">
        <StepStatusIcon status={step.status} success={step.success} />
        <span className={`text-[12px] font-medium ${failed ? "text-[var(--error)]" : "text-[var(--on-surface)]"}`}>
          {formatSkillName(step.skill)}
        </span>
        {step.status === "running" && <LiveTimer />}
        {step.status === "done" && step.durationMs !== undefined && (
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
          <StepResultContent result={truncate(formatValue(step.result), 300)} failed={failed} />
        </div>
      )}
    </div>
  );
}

// ---- Step status icon: spinner / check / error ----

function StepStatusIcon({ status, success }: { status: "running" | "done"; success?: boolean }) {
  if (status === "running") {
    return <span className="inline-block w-3 h-3 border-[1.5px] border-[var(--primary-accent)] border-t-transparent rounded-full animate-spin shrink-0" />;
  }
  if (success === false) {
    return <span className="text-[var(--error)] shrink-0"><IconWarning size={13} /></span>;
  }
  return <span className="text-[var(--success)] shrink-0"><IconCheck size={13} /></span>;
}

// ---- Live timer (counts up while running) ----

function LiveTimer() {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="text-[10px] text-[var(--on-surface-tertiary)] tabular-nums">
      {elapsed}s
    </span>
  );
}

// ---- Step result ----

function StepResultContent({ result, failed }: { result: string; failed: boolean }) {
  return (
    <div className="space-y-1.5 mt-0.5">
      <pre className={`text-[11px] ${failed ? "text-[var(--error)]" : "text-[var(--on-surface-tertiary)]"} bg-[var(--surface-low)] rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-[120px] overflow-y-auto`}>
        {result}
      </pre>
    </div>
  );
}

function ProducedOutputs({ outputs }: { outputs: ProducedOutput[] }) {
  if (outputs.length === 0) return null;
  return (
    <div className="max-w-[90%] rounded-xl border border-[var(--border)] bg-[var(--surface-lowest)] shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--surface-low)] flex items-center gap-2">
        <IconDocument size={13} className="text-[var(--primary-accent)]" />
        <span className="text-[12px] font-semibold text-[var(--on-surface)]">任务产出</span>
      </div>
      <div className="p-2 space-y-1">
        {outputs.map((output) => (
          <ProducedOutputRow key={output.id} output={output} />
        ))}
      </div>
    </div>
  );
}

function ProducedOutputRow({ output }: { output: ProducedOutput }) {
  if (output.kind === "file" && output.path) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--surface-low)]">
        <FileTypeIcon filename={output.title} path={output.path} size={24} />
        <button
          onClick={() => openPath(output.path!)}
          className="flex-1 min-w-0 text-left text-[12px] font-medium text-[var(--on-surface)] hover:text-[var(--primary-accent)] truncate cursor-pointer"
          title={`Open ${output.path}`}
        >
          {output.title}
        </button>
        <button
          onClick={() => openPath(output.path!)}
          className="p-1 rounded-md text-[var(--on-surface-tertiary)] hover:text-[var(--primary-accent)] hover:bg-[var(--surface-container)] cursor-pointer"
          title={`Open ${output.path}`}
          aria-label="Open file"
        >
          <IconDocument size={12} />
        </button>
        <button
          onClick={() => revealInFolder(output.path!)}
          className="p-1 rounded-md text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container)] cursor-pointer"
          title={`Reveal ${output.path}`}
          aria-label="Reveal in folder"
        >
          <IconFolder size={12} />
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg">
      <IconDocument size={13} className="text-[var(--primary-accent)] shrink-0" />
      <span className="flex-1 min-w-0 text-[12px] font-medium text-[var(--on-surface)] truncate">{output.title}</span>
      <span className="text-[11px] text-[var(--on-surface-tertiary)]">Artifact</span>
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
