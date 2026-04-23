import { useEffect } from "react";
import { useAppStore } from "@/stores/app-store";
import { useViewStore } from "@/stores/view-store";
import { CommandBar } from "@/components/chat/command-bar";
import { MessageList } from "@/components/chat/message-list";
import { ViewContainer } from "@/components/views/view-container";
import { useSessionStore } from "@/stores/session-store";

export function Home() {
  const { initialized, hasApiKey, sources, load } = useAppStore();
  const { messages, isStreaming, streamingText, steps, artifacts, knowledgeRefs, error, sendMessage } =
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

  if (hasConversation) {
    return (
      <div className="flex h-full">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-6 py-4">
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
                <div className="mt-2 p-3 rounded-lg bg-[var(--error-container)] text-[var(--error)] text-sm">
                  {error}
                </div>
              )}
            </div>
          </div>
          <div className="border-t border-[var(--outline-variant)] px-6 py-3">
            <div className={hasViews ? "" : "max-w-3xl mx-auto"}>
              {knowledgeRefs.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  <span className="text-xs text-[var(--outline)]">Knowledge:</span>
                  {knowledgeRefs.map((ref, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-[var(--surface-container)] text-[var(--on-surface-variant)]">
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

  // Empty state — dashboard layout matching design reference
  const greeting = getGreeting();

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-8 py-10">
        {/* Greeting */}
        <h1 className="text-2xl font-bold text-[var(--on-surface)] mb-6">
          {greeting}
        </h1>

        {/* Command Bar */}
        <div className="mb-4">
          <CommandBar />
        </div>

        {/* Quick suggestion chips */}
        <div className="flex flex-wrap gap-2 mb-8">
          {SUGGESTIONS.map((s, i) => (
            <button
              key={i}
              onClick={() => sendMessage(s.text)}
              disabled={!hasApiKey}
              className="px-3 py-1.5 rounded-full text-xs bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)] text-[var(--on-surface-variant)] hover:bg-[var(--surface-container)] hover:border-[var(--outline)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Hints */}
        {!hasApiKey && (
          <div className="mb-6 p-4 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]">
            <p className="text-sm text-[var(--on-surface-variant)]">
              👋 Go to <strong>Settings</strong> to configure your LLM API key and start working.
            </p>
          </div>
        )}

        {/* Two-column layout: Attention + Recent */}
        <div className="grid grid-cols-2 gap-5 mb-8">
          {/* Left: Attention items */}
          <Card title="Pending" icon="⚡">
            <div className="text-sm text-[var(--outline)] py-6 text-center">
              No pending items
            </div>
          </Card>

          {/* Right: Recent outputs */}
          <Card title="Recent Outputs" icon="📄">
            <div className="text-sm text-[var(--outline)] py-6 text-center">
              No recent outputs yet
            </div>
          </Card>
        </div>

        {/* My Apps */}
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <span>📦</span> My Apps
          </h2>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {/* Placeholder app cards */}
          <div className="border border-dashed border-[var(--outline-variant)] rounded-xl p-5 flex flex-col items-center justify-center text-center min-h-[140px] hover:bg-[var(--surface-container-low)] transition-colors cursor-pointer">
            <span className="text-2xl mb-2 opacity-40">＋</span>
            <span className="text-sm text-[var(--outline)]">Create App</span>
          </div>

          {/* Show connected sources as context */}
          {sources.map((s) => (
            <div key={s.id} className="bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)] rounded-xl p-5 min-h-[140px]">
              <div className="text-sm font-medium mb-1">📁 {s.name}</div>
              <div className="text-xs text-[var(--outline)]">Knowledge source</div>
              <div className="mt-3">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  s.status === "active"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
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
      <div className="px-4 py-3 border-b border-[var(--outline-variant)] flex items-center gap-2">
        <span className="text-sm">{icon}</span>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="px-4 py-1">
        {children}
      </div>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning, what do you need today?";
  if (hour < 18) return "Good afternoon, what can I help with?";
  return "Good evening, what are you working on?";
}

const SUGGESTIONS = [
  { label: "Summarize recent docs", text: "Summarize the most recent documents in my knowledge base" },
  { label: "Draft a report", text: "Help me draft a report based on my recent work" },
  { label: "Analyze data", text: "Help me analyze some data" },
];
