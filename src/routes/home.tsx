import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useViewStore } from "@/stores/view-store";
import { CommandBar } from "@/components/chat/command-bar";
import { MessageList } from "@/components/chat/message-list";
import { ViewContainer } from "@/components/views/view-container";
import { useSessionStore } from "@/stores/session-store";
import { isMeaningfulProducedFilePath, outputsFromArtifacts, outputsFromSteps, type ProducedOutput, type StepLike } from "@/lib/outputs";
import { openPath, revealInFolder } from "@/lib/tauri";
import {
  IconClock, IconChart, IconTaskList, IconMail, IconTrend,
  IconFolder, IconPlus, IconPlay, IconDocument, FileTypeIcon,
} from "@/components/icons";
import { t } from "@/lib/i18n";

export function Home() {
  const { initialized, hasApiKey, sources, load } = useAppStore();
  const {
    messages, isStreaming, streamingText, steps, artifacts,
    knowledgeRefs, error, longTask, contextDump, closeContextDump,
  } = useSessionStore();
  const viewPanels = useViewStore((s) => s.panels);
  const addPanel = useViewStore((s) => s.addPanel);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initialized) load();
  }, [initialized, load]);

  // Auto-add new artifacts to view panels
  useEffect(() => {
    for (const artifact of artifacts) {
      if (!viewPanels.find((p) => p.id === artifact.id)) {
        addPanel(artifact);
      }
    }
  }, [artifacts, viewPanels, addPanel]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamingText]);

  if (!initialized) return null;

  const hasConversation = messages.length > 0 || isStreaming;
  const hasViews = viewPanels.length > 0;
  const recentOutputs = getRecentOutputs(messages, artifacts, steps, longTask);

  return (
    <div className="flex h-full">
      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 pt-7">

        {/* Scrollable content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-8 lg:px-10">

            {/* Dashboard section — always visible at top */}
            <div className="py-6">
              <h1 className="text-[20px] font-bold text-[var(--on-surface)] mb-4">
                {getGreeting()}
              </h1>

              {!hasApiKey && (
                <div className="mb-4 p-3 rounded-xl bg-[var(--info-light)] border border-blue-100">
                  <p className="text-[13px] text-[var(--info)]">{t("home.configHint")}</p>
                </div>
              )}

              {/* Pending + Recent (collapsed when conversation is active) */}
              {!hasConversation && (
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <DashboardCard title={t("home.pending")} icon={<span className="w-2 h-2 rounded-full bg-[var(--error)]" />}>
                    <p className="text-[13px] text-[var(--on-surface-tertiary)] py-3 text-center">
                      {t("home.noPending")}
                    </p>
                  </DashboardCard>
                  <DashboardCard title={t("home.recentOutputs")} icon={<IconClock size={13} />}>
                    {recentOutputs.length > 0 ? (
                      <div className="py-2 space-y-1">
                        {recentOutputs.slice(0, 3).map((output) => (
                          <RecentOutputRow key={output.id} output={output} compact />
                        ))}
                      </div>
                    ) : (
                      <p className="text-[13px] text-[var(--on-surface-tertiary)] py-3 text-center">
                        {t("home.noOutputs")}
                      </p>
                    )}
                  </DashboardCard>
                </div>
              )}
            </div>

            {/* Conversation history */}
            {hasConversation && (
              <div className="pb-4 space-y-4">
                <MessageList
                  messages={messages}
                  isStreaming={isStreaming}
                  streamingText={streamingText}
                  steps={steps}
                  knowledgeRefs={knowledgeRefs}
                />
                {error && (
                  <div className="mt-3 p-3 rounded-lg bg-[var(--error-light)] text-[var(--error)] text-[13px]">
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Knowledge refs */}
        {knowledgeRefs.length > 0 && (
          <div className="px-8 lg:px-10 pb-1">
            <div className="max-w-3xl mx-auto flex flex-wrap gap-1">
              <span className="text-[11px] text-[var(--on-surface-tertiary)]">{t("nav.knowledge")}:</span>
              {knowledgeRefs.map((ref, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-container)] text-[var(--on-surface-secondary)]">
                  <IconDocument size={10} /> {ref.filename}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Command Bar — always at bottom */}
        <div className="px-8 lg:px-10 pb-5 pt-2">
          <div className="max-w-3xl mx-auto space-y-2">
            {isStreaming && longTask && <TaskProgressDock task={longTask} />}
            <CommandBar />
          </div>
        </div>
      </div>

      {/* Right panel: Apps + artifact views */}
      <RightPanel sources={sources} hasViews={hasViews} recentOutputs={recentOutputs} />

      {contextDump !== null && (
        <ContextDumpModal content={contextDump} onClose={closeContextDump} />
      )}
    </div>
  );
}

function ContextDumpModal({ content, onClose }: { content: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — user can still select and copy manually
    }
  }
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-[var(--surface-lowest)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-lg)] w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-[14px] font-semibold text-[var(--on-surface)]">Agent Context Dump</h2>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleCopy}
              title="复制全部内容到剪贴板"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-colors ${
                copied
                  ? "bg-[var(--success-light,#dcfce7)] text-[var(--success)]"
                  : "bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)]"
              }`}
            >
              <IconCopy size={13} />
              {copied ? "已复制" : "复制"}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-[12px] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] cursor-pointer transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
        <pre className="flex-1 overflow-auto px-4 py-3 text-[12px] leading-relaxed text-[var(--on-surface)] whitespace-pre-wrap break-words font-mono">
          {content}
        </pre>
      </div>
    </div>
  );
}

function IconCopy({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5C11 2.95 10.55 2.5 10 2.5H3.5C2.95 2.5 2.5 2.95 2.5 3.5V10C2.5 10.55 2.95 11 3.5 11H5" />
    </svg>
  );
}

type LongTaskView = NonNullable<ReturnType<typeof useSessionStore.getState>["longTask"]>;
type PhaseStatus = "pending" | "running" | "done" | "failed";

function TaskProgressDock({ task }: { task: LongTaskView }) {
  const items = buildTaskItems(task);
  if (items.length === 0) return null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-lowest)] shadow-[var(--shadow-sm)] px-3 py-2">
      <div className="flex items-center gap-2 mb-1.5">
        <IconTaskList size={13} className="text-[var(--primary-accent)]" />
        <span className="text-[12px] font-semibold text-[var(--on-surface)]">执行进度</span>
        <span className="ml-auto text-[10px] text-[var(--on-surface-tertiary)]">{summarizeTaskProgress(items)}</span>
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.key} className={`flex items-start gap-2 rounded-lg px-1.5 py-1 ${item.status === "running" ? "bg-[var(--surface-low)]" : ""}`}>
            <span className="mt-[2px]"><StatusCheckbox status={item.status} size={13} /></span>
            <span className={`flex-1 min-w-0 text-[12px] leading-relaxed break-words ${item.status === "done" ? "text-[var(--on-surface-tertiary)]" : "text-[var(--on-surface-secondary)]"}`}>
              {item.title}
            </span>
            {item.status === "running" && <span className="mt-0.5 shrink-0 text-[10px] text-[var(--error)]">进行中</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function buildTaskItems(task: LongTaskView): { key: string; title: string; status: PhaseStatus }[] {
  if (task.planSteps && task.planSteps.length > 0) {
    return task.planSteps.map((step, index) => ({
      key: `plan-step-${index}`,
      title: step.title,
      status: step.status,
    }));
  }

  const nonPlan = task.phases.filter((phase) => phase.phase !== "plan");
  if (nonPlan.length > 0) {
    return nonPlan.map((phase) => ({
      key: phase.phase,
      title: phase.summary.trim() || formatPhase(phase.phase),
      status: phase.status,
    }));
  }

  const plan = task.phases.find((phase) => phase.phase === "plan");
  return plan
    ? [{ key: "plan", title: plan.summary.trim() || "制定执行计划", status: plan.status }]
    : [];
}

function summarizeTaskProgress(items: { status: PhaseStatus }[]): string {
  const done = items.filter((item) => item.status === "done").length;
  return `${done}/${items.length}`;
}

function StatusCheckbox({ status, size = 14 }: { status: PhaseStatus; size?: number }) {
  const title = status === "done" ? "完成" : status === "failed" ? "失败" : status === "running" ? "进行中" : "等待";
  const stroke = "1.6";
  if (status === "done") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0" aria-label={title}>
        <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="var(--success)" />
        <path d="M4.5 8.2L7 10.5L11.5 5.5" fill="none" stroke="white" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "running") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0 animate-pulse" aria-label={title}>
        <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="var(--error)" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0" aria-label={title}>
        <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="var(--error)" strokeWidth={stroke} />
        <path d="M5 5L11 11M11 5L5 11" fill="none" stroke="var(--error)" strokeWidth={stroke} strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0" aria-label={title}>
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="var(--on-surface-tertiary)" strokeWidth={stroke} />
    </svg>
  );
}

function formatPhase(phase: string): string {
  return phase.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function DashboardCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] overflow-hidden shadow-[var(--shadow-sm)]">
      <div className="px-3 py-2 border-b border-[var(--border)] flex items-center gap-2">
        {icon}
        <span className="text-[12px] font-semibold text-[var(--on-surface)]">{title}</span>
      </div>
      <div className="px-3">{children}</div>
    </div>
  );
}

function RightPanel({ sources, hasViews, recentOutputs }: {
  sources: { id: string; name: string; status: string }[];
  hasViews: boolean;
  recentOutputs: ProducedOutput[];
}) {
  return (
    <div className="w-[300px] shrink-0 border-l border-[var(--border)] bg-[var(--surface-lowest)] flex flex-col overflow-hidden pt-7">
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <h2 className="text-[13px] font-semibold text-[var(--on-surface)] mb-3">{t("home.myApps")}</h2>
        <div className="space-y-2">
          <AppItem icon={<IconChart size={16} />} iconBg="bg-blue-50 text-blue-600" title="每周销售分析" schedule="每周一 08:00" />
          <AppItem icon={<IconTaskList size={16} />} iconBg="bg-indigo-50 text-indigo-600" title="项目进度追踪" schedule="每日运行" />
          <AppItem icon={<IconMail size={16} />} iconBg="bg-teal-50 text-teal-600" title="客户满意度监测" schedule="每日运行" />
          <AppItem icon={<IconTrend size={16} />} iconBg="bg-orange-50 text-orange-600" title="商机线索提醒" schedule="实时监控" />
          {sources.map((s) => (
            <AppItem key={s.id} icon={<IconFolder size={16} />} iconBg="bg-gray-50 text-gray-600" title={s.name} schedule={s.status} />
          ))}
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-dashed border-[var(--border)] text-[var(--on-surface-tertiary)] hover:bg-[var(--surface-low)] hover:text-[var(--on-surface-secondary)] transition-all cursor-pointer">
            <div className="w-8 h-8 rounded-lg bg-[var(--surface-container)] flex items-center justify-center"><IconPlus size={14} /></div>
            <span className="text-[13px]">{t("home.createApp")}</span>
          </button>
        </div>

        <div className="mt-6">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--on-surface)] mb-3">
            <IconClock size={13} /> {t("home.recentOutputs")}
          </h2>
          <div className="space-y-1">
            {recentOutputs.length > 0 ? (
              recentOutputs.slice(0, 8).map((output) => (
                <RecentOutputRow key={output.id} output={output} />
              ))
            ) : (
              <p className="px-2 py-2 text-[12px] text-[var(--on-surface-tertiary)]">{t("home.noOutputs")}</p>
            )}
          </div>
        </div>
      </div>
      {hasViews && (
        <div className="border-t border-[var(--border)]">
          <ViewContainer />
        </div>
      )}
    </div>
  );
}

function AppItem({ icon, iconBg, title, schedule }: { icon: React.ReactNode; iconBg: string; title: string; schedule: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--surface-low)] transition-colors cursor-pointer group">
      <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[var(--on-surface)] truncate">{title}</div>
        <div className="flex items-center gap-1 text-[11px] text-[var(--on-surface-tertiary)]"><IconClock size={10} /> {schedule}</div>
      </div>
      <button className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 text-[var(--primary-accent)] hover:bg-[var(--primary-accent-light)] transition-all cursor-pointer">
        <IconPlay size={12} />
      </button>
    </div>
  );
}

function RecentOutputRow({ output, compact = false }: { output: ProducedOutput; compact?: boolean }) {
  const icon = output.kind === "artifact"
    ? <IconDocument size={13} />
    : <FileTypeIcon filename={output.title} path={output.path} size={compact ? 22 : 26} />;
  const label = output.kind === "artifact" ? "面板" : "文件";
  if (output.kind === "file" && output.path) {
    return (
      <div className={`w-full flex items-center gap-2 px-2 ${compact ? "py-1" : "py-1.5"} rounded-lg text-[12px] hover:bg-[var(--surface-low)]`}>
        <span className="text-[var(--primary-accent)] shrink-0">{icon}</span>
        <button
          onClick={() => openPath(output.path!)}
          className="flex-1 min-w-0 truncate text-left text-[var(--on-surface)] font-medium hover:text-[var(--primary-accent)] cursor-pointer"
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
    <div className={`flex items-center gap-2 px-2 ${compact ? "py-1" : "py-1.5"} rounded-lg text-[12px]`}>
      <span className="text-[var(--primary-accent)] shrink-0">{icon}</span>
      <span className="flex-1 truncate text-[var(--on-surface)] font-medium">{output.title}</span>
      <span className="text-[var(--on-surface-tertiary)] font-medium">{label}</span>
    </div>
  );
}

function getRecentOutputs(
  messages: ReturnType<typeof useSessionStore.getState>["messages"],
  artifacts: ReturnType<typeof useSessionStore.getState>["artifacts"],
  currentSteps: StepLike[],
  longTask: ReturnType<typeof useSessionStore.getState>["longTask"],
): ProducedOutput[] {
  const outputs: ProducedOutput[] = [
    ...outputsFromArtifacts(artifacts),
    ...outputsFromSteps(currentSteps),
    ...(longTask?.phases.flatMap((phase) =>
      phase.outputs
        .filter((output) => output.path && isMeaningfulProducedFilePath(output.path))
        .map((output) => ({
          id: `file:${output.path}`,
          title: output.title,
          kind: "file" as const,
          path: output.path,
        })),
    ) || []),
  ];

  for (const message of [...messages].reverse()) {
    const steps = (message.metadata as { steps?: StepLike[] } | null)?.steps;
    if (steps?.length) outputs.push(...outputsFromSteps(steps));
  }

  const seen = new Set<string>();
  return outputs.filter((output) => {
    const key = output.path || output.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return t("home.greeting.morning");
  if (hour < 18) return t("home.greeting.afternoon");
  return t("home.greeting.evening");
}
