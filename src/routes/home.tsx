import { useEffect, useRef } from "react";
import { useAppStore } from "@/stores/app-store";
import { useViewStore } from "@/stores/view-store";
import { CommandBar } from "@/components/chat/command-bar";
import { MessageList } from "@/components/chat/message-list";
import { ViewContainer } from "@/components/views/view-container";
import { useSessionStore } from "@/stores/session-store";
import {
  IconClock, IconChart, IconTaskList, IconMail, IconTrend,
  IconFolder, IconPlus, IconPlay, IconCheck, IconDocument, IconClose, IconChannel,
} from "@/components/icons";
import { t } from "@/lib/i18n";

export function Home() {
  const { initialized, hasApiKey, sources, mcpServers, load } = useAppStore();
  const {
    messages, isStreaming, streamingText, steps, artifacts,
    knowledgeRefs, error, clearConversation,
  } = useSessionStore();
  const viewPanels = useViewStore((s) => s.panels);
  const addPanel = useViewStore((s) => s.addPanel);
  const clearViews = useViewStore((s) => s.clear);
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

  return (
    <div className="flex h-full">
      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Scrollable content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6">

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
                    <p className="text-[13px] text-[var(--on-surface-tertiary)] py-3 text-center">
                      {t("home.noOutputs")}
                    </p>
                  </DashboardCard>
                </div>
              )}
            </div>

            {/* Conversation history */}
            {hasConversation && (
              <div className="pb-4">
                {/* Clear conversation button */}
                {messages.length > 0 && !isStreaming && (
                  <div className="flex justify-center mb-4">
                    <button
                      onClick={() => { clearConversation(); clearViews(); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface-secondary)] bg-[var(--surface-low)] hover:bg-[var(--surface-container)] transition-colors cursor-pointer"
                    >
                      <IconClose size={10} />
                      {t("home.clearConversation")}
                    </button>
                  </div>
                )}

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

      {/* Right panel: Apps + artifact views */}
      <RightPanel sources={sources} mcpServers={mcpServers} hasViews={hasViews} />
    </div>
  );
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

function RightPanel({ sources, mcpServers, hasViews }: {
  sources: { id: string; name: string; status: string }[];
  mcpServers: { id: string; name: string; connected: boolean; toolCount: number }[];
  hasViews: boolean;
}) {
  return (
    <div className="w-[300px] shrink-0 border-l border-[var(--border)] bg-[var(--surface-lowest)] flex flex-col overflow-hidden">
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
            <OutputRow icon={<IconCheck size={12} />} title="周度销售报告" time="09:00" color="text-[var(--success)]" />
            <OutputRow icon={<IconCheck size={12} />} title="CRM数据同步" time="昨天" color="text-[var(--success)]" />
          </div>
        </div>

        {/* MCP Connections status */}
        {mcpServers.length > 0 && (
          <div className="mt-6">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--on-surface)] mb-3">
              <IconChannel size={13} /> {t("connections.title")}
            </h2>
            <div className="space-y-1">
              {mcpServers.map((s) => (
                <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px]">
                  <span className={`w-1.5 h-1.5 rounded-full ${s.connected ? "bg-[var(--success)]" : "bg-[var(--on-surface-tertiary)]"}`} />
                  <span className="flex-1 truncate text-[var(--on-surface-secondary)]">{s.name}</span>
                  <span className="text-[var(--on-surface-tertiary)]">
                    {s.connected ? `${s.toolCount} tools` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
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
