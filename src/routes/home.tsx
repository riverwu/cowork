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
  const { messages, isStreaming, streamingText, steps, artifacts, knowledgeRefs, error, sendMessage, reset } =
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

  function handleBackToHome() {
    reset();
    clearViews();
  }

  // Conversation view
  if (hasConversation) {
    return (
      <div className="flex h-full">
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar with back button */}
          <div className="flex items-center px-5 py-2.5 border-b border-[var(--outline-variant)]/50">
            <button
              onClick={handleBackToHome}
              className="flex items-center gap-1.5 text-[12px] text-[var(--outline)] hover:text-[var(--on-surface)] cursor-pointer transition-colors"
            >
              ← {t("home.backToHome")}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
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
                <div className="mt-3 p-3 rounded-xl bg-[var(--error-container)] text-[var(--error)] text-[13px]">
                  {error}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-[var(--outline-variant)]/50 px-5 py-3">
            <div className={hasViews ? "" : "max-w-3xl mx-auto"}>
              {knowledgeRefs.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  <span className="text-[11px] text-[var(--outline)]">{t("nav.knowledge")}:</span>
                  {knowledgeRefs.map((ref, i) => (
                    <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-container)] text-[var(--on-surface-variant)]">
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

  // Dashboard view
  const greeting = getGreeting();
  const hints: string[] = [];
  if (!hasApiKey) hints.push(t("home.configHint"));
  if (sources.length === 0) hints.push(t("home.knowledgeHint"));

  const suggestions = [
    { label: t("suggestion.summarize"), text: t("suggestion.summarize.text") },
    { label: t("suggestion.draft"), text: t("suggestion.draft.text") },
    { label: t("suggestion.analyze"), text: t("suggestion.analyze.text") },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-8 py-10">
        <h1 className="text-[22px] font-bold text-[var(--on-surface)] mb-6">{greeting}</h1>

        <div className="mb-4">
          <CommandBar />
        </div>

        {/* Suggestion chips */}
        <div className="flex flex-wrap gap-2 mb-8">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => sendMessage(s.text)}
              disabled={!hasApiKey}
              className="px-3 py-1.5 rounded-full text-[12px] bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)] text-[var(--on-surface-variant)] hover:bg-[var(--surface-container)] hover:border-[var(--outline)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Hints */}
        {hints.length > 0 && (
          <div className="mb-6 p-4 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]">
            {hints.map((hint, i) => (
              <p key={i} className="text-[13px] text-[var(--on-surface-variant)] leading-relaxed">
                {hint}
              </p>
            ))}
          </div>
        )}

        {/* Two-column cards */}
        <div className="grid grid-cols-2 gap-5 mb-8">
          <Card title={t("home.pending")} icon="⚡">
            <div className="text-[13px] text-[var(--outline)] py-5 text-center">
              {t("home.noPending")}
            </div>
          </Card>
          <Card title={t("home.recentOutputs")} icon="📄">
            <div className="text-[13px] text-[var(--outline)] py-5 text-center">
              {t("home.noOutputs")}
            </div>
          </Card>
        </div>

        {/* My Apps */}
        <div className="mb-3">
          <h2 className="text-[14px] font-semibold flex items-center gap-2">
            <span>📦</span> {t("home.myApps")}
          </h2>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="border border-dashed border-[var(--outline-variant)] rounded-xl p-5 flex flex-col items-center justify-center text-center min-h-[120px] hover:bg-[var(--surface-container-low)] transition-colors cursor-pointer">
            <span className="text-xl mb-1.5 opacity-40">＋</span>
            <span className="text-[12px] text-[var(--outline)]">{t("home.createApp")}</span>
          </div>

          {sources.map((s) => (
            <div key={s.id} className="bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)] rounded-xl p-5 min-h-[120px]">
              <div className="text-[13px] font-medium mb-1 text-[var(--on-surface)]">📁 {s.name}</div>
              <div className="text-[11px] text-[var(--outline)]">{t("knowledge.knowledgeSource")}</div>
              <div className="mt-3">
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                  s.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                }`}>
                  {s.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)] rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--outline-variant)] flex items-center gap-2">
        <span className="text-[13px]">{icon}</span>
        <span className="text-[13px] font-semibold text-[var(--on-surface)]">{title}</span>
      </div>
      <div className="px-4 py-1">{children}</div>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return t("home.greeting.morning");
  if (hour < 18) return t("home.greeting.afternoon");
  return t("home.greeting.evening");
}
