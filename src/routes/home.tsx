import { useEffect, useRef } from "react";
import { useAppStore } from "@/stores/app-store";
import { useViewStore } from "@/stores/view-store";
import { CommandBar } from "@/components/chat/command-bar";
import { MessageList } from "@/components/chat/message-list";
import { ViewContainer } from "@/components/views/view-container";
import { useSessionStore } from "@/stores/session-store";
import { isMeaningfulProducedFilePath, outputsFromArtifacts, outputsFromSteps, outputsFromText, type ProducedOutput, type StepLike } from "@/lib/outputs";
import {
  IconClock, IconChart, IconTaskList, IconMail, IconTrend,
  IconFolder, IconPlus, IconPlay, IconDocument, FileTypeIcon,
} from "@/components/icons";
import { t } from "@/lib/i18n";

export function Home() {
  const { initialized, hasApiKey, sources, load } = useAppStore();
  const {
    messages, isStreaming, streamingText, steps, artifacts,
    knowledgeRefs, error, longTask,
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
                {longTask && <LongTaskPanel task={longTask} />}
                <MessageList
                  messages={messages}
                  isStreaming={isStreaming}
                  streamingText={streamingText}
                  steps={steps}
                  artifacts={artifacts}
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
          <div className="max-w-3xl mx-auto">
            <CommandBar />
          </div>
        </div>
      </div>

      {/* Right panel: Apps + artifact views */}
      <RightPanel sources={sources} hasViews={hasViews} recentOutputs={recentOutputs} />
    </div>
  );
}

type LongTaskView = NonNullable<ReturnType<typeof useSessionStore.getState>["longTask"]>;

function LongTaskPanel({ task }: { task: LongTaskView }) {
  const openDocument = useViewStore((s) => s.openDocument);
  const current = [...task.phases].reverse().find((p) => p.status === "running")
    || [...task.phases].reverse()[0];

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-lowest)] shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--surface-low)]">
        <div className="flex items-center gap-2">
          <IconClock size={13} className="text-[var(--primary-accent)]" />
          <span className="text-[12px] font-semibold text-[var(--on-surface)]">长任务执行</span>
          <span className="ml-auto text-[10px] text-[var(--on-surface-tertiary)]">{task.runId}</span>
        </div>
        <div className="mt-1 text-[11px] text-[var(--on-surface-tertiary)] truncate" title={task.workspaceDir}>
          工作目录：{task.workspaceDir}
        </div>
      </div>
      <div className="p-3 space-y-2">
        {current && (
          <div className="rounded-lg bg-[var(--surface-low)] px-3 py-2">
            <div className="flex items-center gap-2">
              <StatusDot status={current.status} />
              <span className="text-[12px] font-medium text-[var(--on-surface)]">{formatPhase(current.phase)}</span>
              <span className="text-[11px] text-[var(--on-surface-tertiary)]">{formatStatus(current.status)}</span>
            </div>
            <p className="mt-1 text-[12px] text-[var(--on-surface-secondary)] leading-relaxed">{current.summary}</p>
          </div>
        )}
        {task.phases.length > 0 && (
          <div className="space-y-1">
            {task.phases.map((phase) => (
              <div key={phase.phase} className="flex items-center gap-2 text-[12px] px-1 py-0.5">
                <StatusDot status={phase.status} />
                <span className="w-24 truncate text-[var(--on-surface-secondary)]">{formatPhase(phase.phase)}</span>
                <span className="flex-1 truncate text-[var(--on-surface-tertiary)]">{phase.summary}</span>
              </div>
            ))}
          </div>
        )}
        {task.phases.flatMap((p) => p.outputs).length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {task.phases.flatMap((p) => p.outputs).map((output, index) => (
              output.path ? (
                <button
                  key={`${output.path}-${index}`}
                  onClick={() => openDocument({
                    path: output.path!,
                    title: output.title,
                    source: "recent_output",
                  })}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--surface-container)] text-[11px] text-[var(--on-surface-secondary)] hover:text-[var(--primary-accent)] cursor-pointer"
                >
                  <FileTypeIcon filename={output.title} path={output.path} size={20} /> {output.title}
                </button>
              ) : (
                <span key={`${output.title}-${index}`} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--surface-container)] text-[11px] text-[var(--on-surface-secondary)]">
                  <IconDocument size={11} /> {output.title}
                </span>
              )
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: "pending" | "running" | "done" | "failed" }) {
  const cls = status === "done"
    ? "bg-[var(--success)]"
    : status === "failed"
      ? "bg-[var(--error)]"
      : status === "running"
        ? "bg-[var(--primary-accent)] animate-pulse"
        : "bg-[var(--on-surface-tertiary)]";
  return <span className={`w-2 h-2 rounded-full shrink-0 ${cls}`} />;
}

function formatPhase(phase: string): string {
  return phase.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatStatus(status: string): string {
  if (status === "running") return "进行中";
  if (status === "done") return "完成";
  if (status === "failed") return "失败";
  return "等待";
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
  const openDocument = useViewStore((s) => s.openDocument);
  const icon = output.kind === "artifact"
    ? <IconDocument size={13} />
    : <FileTypeIcon filename={output.title} path={output.path} size={compact ? 22 : 26} />;
  const label = output.kind === "artifact" ? "面板" : "文件";
  const content = (
    <>
      <span className="text-[var(--primary-accent)] shrink-0">{icon}</span>
      <span className="flex-1 truncate text-[var(--on-surface)] font-medium">{output.title}</span>
      <span className="text-[var(--on-surface-tertiary)] font-medium">{label}</span>
    </>
  );

  if (output.kind === "file" && output.path) {
    return (
      <button
        onClick={() => openDocument({
          path: output.path!,
          title: output.title,
          source: "recent_output",
        })}
        className={`w-full flex items-center gap-2 px-2 ${compact ? "py-1" : "py-1.5"} rounded-lg text-[12px] hover:bg-[var(--surface-low)] cursor-pointer text-left`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={`flex items-center gap-2 px-2 ${compact ? "py-1" : "py-1.5"} rounded-lg text-[12px]`}>
      {content}
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
    if (message.role === "assistant") outputs.push(...outputsFromText(message.content));
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
