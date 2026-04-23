import { useEffect } from "react";
import { useAppStore } from "@/stores/app-store";
import { useViewStore } from "@/stores/view-store";
import { CommandBar } from "@/components/chat/command-bar";
import { MessageList } from "@/components/chat/message-list";
import { ViewContainer } from "@/components/views/view-container";
import { useSessionStore } from "@/stores/session-store";
import {
  IconClock, IconChart, IconTaskList, IconMail, IconTrend,
  IconFolder, IconPlus, IconPlay, IconCheck, IconDocument,
} from "@/components/icons";
import { t } from "@/lib/i18n";

export function Home() {
  const { initialized, hasApiKey, sources, load } = useAppStore();
  const { messages, isStreaming, streamingText, steps, artifacts, knowledgeRefs, error } =
    useSessionStore();
  const viewPanels = useViewStore((s) => s.panels);
  const addPanel = useViewStore((s) => s.addPanel);

  useEffect(() => {
    if (!initialized) load();
  }, [initialized, load]);

  useEffect(() => {
    for (const artifact of artifacts) {
      if (!viewPanels.find((p) => p.id === artifact.id)) {
        addPanel(artifact);
      }
    }
  }, [artifacts, viewPanels, addPanel]);

  if (!initialized) return null;

  const hasConversation = messages.length > 0 || isStreaming;
  const hasViews = viewPanels.length > 0;

  return (
    <div className="flex h-full">
      {/* Main area: conversation/dashboard + Command Bar */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto">
          {hasConversation ? (
            /* ---- Conversation mode ---- */
            <div className="max-w-3xl mx-auto px-6 py-5">
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
          ) : (
            /* ---- Dashboard mode ---- */
            <div className="max-w-3xl mx-auto px-6 py-6">
              {/* Greeting */}
              <h1 className="text-[20px] font-bold text-[var(--on-surface)] mb-5">
                {getGreeting()}
              </h1>

              {/* Hints */}
              {!hasApiKey && (
                <div className="mb-5 p-4 rounded-xl bg-[var(--info-light)] border border-blue-100">
                  <p className="text-[13px] text-[var(--info)]">{t("home.configHint")}</p>
                </div>
              )}

              {/* Pending items */}
              <section className="mb-5">
                <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--on-surface)] mb-3">
                  <span className="w-2 h-2 rounded-full bg-[var(--error)]" />
                  {t("home.pending")}
                </h2>
                <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] overflow-hidden shadow-[var(--shadow-sm)]">
                  <div className="px-4 py-4 text-[13px] text-[var(--on-surface-tertiary)] text-center">
                    {t("home.noPending")}
                  </div>
                </div>
              </section>

              {/* Recent outputs */}
              <section>
                <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--on-surface)] mb-3">
                  <IconClock size={14} /> {t("home.recentOutputs")}
                </h2>
                <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] overflow-hidden shadow-[var(--shadow-sm)]">
                  <div className="px-4 py-4 text-[13px] text-[var(--on-surface-tertiary)] text-center">
                    {t("home.noOutputs")}
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>

        {/* Knowledge refs bar */}
        {knowledgeRefs.length > 0 && (
          <div className="px-6 pb-1">
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
        <div className="px-6 pb-4 pt-2">
          <div className="max-w-3xl mx-auto">
            <CommandBar />
          </div>
        </div>
      </div>

      {/* Right panel: App cards (always visible) + artifact views */}
      <RightPanel
        sources={sources}
        hasViews={hasViews}
      />
    </div>
  );
}

/** Right side panel — always visible, shows Apps + artifact views */
function RightPanel({ sources, hasViews }: { sources: { id: string; name: string; status: string }[]; hasViews: boolean }) {
  return (
    <div className="w-[300px] shrink-0 border-l border-[var(--border)] bg-[var(--surface-lowest)] flex flex-col overflow-hidden">
      {/* Apps section */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-semibold text-[var(--on-surface)]">{t("home.myApps")}</h2>
        </div>

        <div className="space-y-2">
          <AppItem icon={<IconChart size={16} />} iconBg="bg-blue-50 text-blue-600" title="每周销售分析" schedule="每周一 08:00" />
          <AppItem icon={<IconTaskList size={16} />} iconBg="bg-indigo-50 text-indigo-600" title="项目进度追踪" schedule="每日运行" />
          <AppItem icon={<IconMail size={16} />} iconBg="bg-teal-50 text-teal-600" title="客户满意度监测" schedule="每日运行" />
          <AppItem icon={<IconTrend size={16} />} iconBg="bg-orange-50 text-orange-600" title="商机线索提醒" schedule="实时监控" />

          {sources.map((s) => (
            <AppItem key={s.id} icon={<IconFolder size={16} />} iconBg="bg-gray-50 text-gray-600" title={s.name} schedule={s.status} />
          ))}

          {/* Create new */}
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-dashed border-[var(--border)] text-[var(--on-surface-tertiary)] hover:bg-[var(--surface-low)] hover:border-[var(--on-surface-tertiary)] hover:text-[var(--on-surface-secondary)] transition-all cursor-pointer">
            <div className="w-8 h-8 rounded-lg bg-[var(--surface-container)] flex items-center justify-center">
              <IconPlus size={14} />
            </div>
            <span className="text-[13px]">{t("home.createApp")}</span>
          </button>
        </div>

        {/* Recent outputs */}
        <div className="mt-6">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--on-surface)] mb-3">
            <IconClock size={13} /> {t("home.recentOutputs")}
          </h2>
          <div className="space-y-1">
            <OutputRow icon={<IconCheck size={12} />} title="周度销售报告" time="09:00" color="text-[var(--success)]" />
            <OutputRow icon={<IconCheck size={12} />} title="CRM数据同步" time="昨天" color="text-[var(--success)]" />
          </div>
        </div>
      </div>

      {/* Artifact views (when present) */}
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
        <div className="flex items-center gap-1 text-[11px] text-[var(--on-surface-tertiary)]">
          <IconClock size={10} /> {schedule}
        </div>
      </div>
      <button className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 text-[var(--primary-accent)] hover:bg-[var(--primary-accent-light)] transition-all cursor-pointer">
        <IconPlay size={12} />
      </button>
    </div>
  );
}

function OutputRow({ icon, title, time, color }: { icon: React.ReactNode; title: string; time: string; color: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px]">
      <span className={color}>{icon}</span>
      <span className="flex-1 truncate text-[var(--on-surface-secondary)]">{title}</span>
      <span className="text-[var(--on-surface-tertiary)]">{time}</span>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return t("home.greeting.morning");
  if (hour < 18) return t("home.greeting.afternoon");
  return t("home.greeting.evening");
}
