import { useEffect } from "react";
import { useAppStore } from "@/stores/app-store";
import { useViewStore } from "@/stores/view-store";
import { CommandBar } from "@/components/chat/command-bar";
import { MessageList } from "@/components/chat/message-list";
import { ViewContainer } from "@/components/views/view-container";
import { useSessionStore } from "@/stores/session-store";
import { t } from "@/lib/i18n";

export function Home() {
  const { initialized, hasApiKey, sources, load } = useAppStore();
  const { messages, isStreaming, streamingText, steps, artifacts, knowledgeRefs, error, reset } =
    useSessionStore();
  const viewPanels = useViewStore((s) => s.panels);
  const addPanel = useViewStore((s) => s.addPanel);
  const clearViews = useViewStore((s) => s.clear);

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

  // ---- Conversation view ----
  if (hasConversation) {
    return (
      <div className="flex h-full">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center px-6 py-2 border-b border-[var(--border)]">
            <button
              onClick={() => { reset(); clearViews(); }}
              className="flex items-center gap-1.5 text-[12px] text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)] cursor-pointer transition-colors"
            >
              ← {t("home.backToHome")}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className={hasViews ? "" : "max-w-3xl mx-auto"}>
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
          </div>
          <div className="border-t border-[var(--border)] px-6 py-3">
            <div className={hasViews ? "" : "max-w-3xl mx-auto"}>
              {knowledgeRefs.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  <span className="text-[11px] text-[var(--on-surface-tertiary)]">{t("nav.knowledge")}:</span>
                  {knowledgeRefs.map((ref, i) => (
                    <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-container)] text-[var(--on-surface-secondary)]">
                      {ref.filename}
                    </span>
                  ))}
                </div>
              )}
              <CommandBar />
            </div>
          </div>
        </div>
        {hasViews && <ViewContainer />}
      </div>
    );
  }

  // ---- Dashboard view ----
  return (
    <div className="h-full overflow-y-auto">
      {/* Top Command Bar */}
      <div className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border)] px-8 py-3">
        <div className="max-w-5xl mx-auto">
          <CommandBar />
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-6">
        {/* Hints */}
        {!hasApiKey && (
          <div className="mb-5 p-4 rounded-xl bg-[var(--info-light)] border border-blue-100">
            <p className="text-[13px] text-[var(--info)]">{t("home.configHint")}</p>
          </div>
        )}

        {/* Two-column layout */}
        <div className="grid grid-cols-[minmax(280px,1fr)_minmax(380px,1.5fr)] gap-6">

          {/* Left column */}
          <div className="space-y-5">
            {/* Attention */}
            <section>
              <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--on-surface)] mb-3">
                <span className="w-2 h-2 rounded-full bg-[var(--error)]"></span>
                {t("home.pending")}
              </h2>
              <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] overflow-hidden shadow-[var(--shadow-sm)]">
                <AttentionItem
                  type="warning"
                  title="客诉升级预警"
                  tag="待审阅"
                  desc="系统检测到本周客诉量上升了 23%，触发阈值预警。建议及时…"
                  action="立即查看"
                />
                <AttentionItem
                  type="error"
                  title="项目周报"
                  desc="上周报告提取 Jira 数据时，连接异常导致数据不完整。"
                  action="查看详情"
                  last
                />
              </div>
            </section>

            {/* Recent outputs */}
            <section>
              <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--on-surface)] mb-3">
                ⏱ {t("home.recentOutputs")}
              </h2>
              <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] overflow-hidden shadow-[var(--shadow-sm)]">
                <OutputItem
                  time="今天 09:00"
                  title="周度销售分析报告"
                  status="报告已生成"
                  statusColor="success"
                />
                <OutputItem
                  time="昨天 14:30"
                  title="CRM数据同步报告"
                  status="已发送至群聊"
                  statusColor="success"
                />
                <OutputItem
                  time="昨天 09:00"
                  title="用户调研数据清洗"
                  status="处理完成"
                  statusColor="success"
                  last
                />
                <div className="px-4 py-2.5 text-center border-t border-[var(--border)]">
                  <button className="text-[12px] text-[var(--primary-accent)] hover:underline cursor-pointer">
                    查看全部产出 →
                  </button>
                </div>
              </div>
            </section>
          </div>

          {/* Right column — My Apps */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--on-surface)]">
                📦 {t("home.myApps")}
              </h2>
              <button className="text-[12px] text-[var(--primary-accent)] hover:underline cursor-pointer">
                管理
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* App cards */}
              <AppCard
                icon="📊"
                iconBg="bg-blue-50 text-blue-600"
                title="每周销售分析"
                desc="自动汇总各品类销售数据，识别异常变化并生成管理层简报。"
                schedule="每周一 08:00"
              />
              <AppCard
                icon="📋"
                iconBg="bg-indigo-50 text-indigo-600"
                title="项目进度追踪"
                desc="提取 Jira 数据，整理 Sprint 进展并以任务优先级排列。"
                schedule="每日自动运行"
              />
              <AppCard
                icon="📧"
                iconBg="bg-teal-50 text-teal-600"
                title="客户满意度监测"
                desc="实时抓取支持工单和客户反馈，进行情感分析并汇总关键指标。"
                schedule="每日自动运行"
              />
              <AppCard
                icon="📈"
                iconBg="bg-orange-50 text-orange-600"
                title="商机线索提醒"
                desc="监控 CRM 中的新增线索，通过 AI 进行商机价值评估和优先…"
                schedule="实时监控"
              />

              {/* Knowledge sources as cards */}
              {sources.map((s) => (
                <AppCard
                  key={s.id}
                  icon="📁"
                  iconBg="bg-gray-50 text-gray-600"
                  title={s.name}
                  desc={t("knowledge.knowledgeSource")}
                  schedule={s.status}
                />
              ))}

              {/* Create new */}
              <div className="border border-dashed border-[var(--border)] rounded-xl p-5 flex flex-col items-center justify-center text-center min-h-[140px] hover:bg-[var(--surface-low)] hover:border-[var(--on-surface-tertiary)] transition-all cursor-pointer group">
                <div className="w-9 h-9 rounded-lg bg-[var(--surface-container)] group-hover:bg-[var(--primary-accent-light)] flex items-center justify-center mb-2 transition-colors">
                  <span className="text-[16px] text-[var(--on-surface-tertiary)] group-hover:text-[var(--primary-accent)]">＋</span>
                </div>
                <span className="text-[12px] text-[var(--on-surface-tertiary)] group-hover:text-[var(--on-surface-secondary)]">
                  {t("home.createApp")}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function AttentionItem({ type, title, tag, desc, action, last }: {
  type: "warning" | "error";
  title: string;
  tag?: string;
  desc: string;
  action: string;
  last?: boolean;
}) {
  return (
    <div className={`px-4 py-3 ${last ? "" : "border-b border-[var(--border)]"}`}>
      <div className="flex items-start gap-2.5">
        <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${type === "warning" ? "bg-[var(--warning)]" : "bg-[var(--error)]"}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[13px] font-medium text-[var(--on-surface)]">{title}</span>
            {tag && (
              <span className={`text-[10px] px-1.5 py-[1px] rounded-full font-medium ${
                type === "warning" ? "bg-[var(--warning-light)] text-[var(--warning)]" : "bg-[var(--error-light)] text-[var(--error)]"
              }`}>{tag}</span>
            )}
          </div>
          <p className="text-[12px] text-[var(--on-surface-secondary)] leading-relaxed line-clamp-2 mb-1.5">{desc}</p>
          <button className="text-[11px] text-[var(--primary-accent)] hover:underline cursor-pointer">{action}</button>
        </div>
      </div>
    </div>
  );
}

function OutputItem({ time, title, status, statusColor, last }: {
  time: string;
  title: string;
  status: string;
  statusColor: "success" | "warning" | "error";
  last?: boolean;
}) {
  const colors = {
    success: "text-[var(--success)]",
    warning: "text-[var(--warning)]",
    error: "text-[var(--error)]",
  };
  return (
    <div className={`px-4 py-3 flex items-center gap-3 ${last ? "" : "border-b border-[var(--border)]"}`}>
      <span className="text-[11px] text-[var(--on-surface-tertiary)] w-[72px] shrink-0">{time}</span>
      <span className="text-[13px] text-[var(--on-surface)] flex-1 truncate">{title}</span>
      <span className={`text-[11px] ${colors[statusColor]}`}>→ {status}</span>
    </div>
  );
}

function AppCard({ icon, iconBg, title, desc, schedule }: {
  icon: string;
  iconBg: string;
  title: string;
  desc: string;
  schedule: string;
}) {
  return (
    <div className="bg-[var(--surface-lowest)] border border-[var(--border)] rounded-xl p-4 hover:shadow-[var(--shadow-md)] hover:border-[var(--surface-high)] transition-all cursor-pointer group">
      <div className="flex items-start gap-3 mb-2.5">
        <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center text-[16px] shrink-0`}>
          {icon}
        </div>
        <div className="min-w-0 pt-0.5">
          <h3 className="text-[13px] font-semibold text-[var(--on-surface)] mb-0.5 truncate group-hover:text-[var(--primary-accent)]">{title}</h3>
        </div>
      </div>
      <p className="text-[12px] text-[var(--on-surface-secondary)] leading-relaxed line-clamp-2 mb-3">{desc}</p>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--on-surface-tertiary)]">🕐 {schedule}</span>
        <button className="text-[11px] text-[var(--primary-accent)] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
          ▶ 运行
        </button>
      </div>
    </div>
  );
}
