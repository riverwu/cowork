import { useEffect } from "react";
import { useAppStore } from "@/stores/app-store";
import { useViewStore } from "@/stores/view-store";
import { Welcome } from "@/components/onboarding/welcome";
import { CommandBar } from "@/components/chat/command-bar";
import { MessageList } from "@/components/chat/message-list";
import { ViewContainer } from "@/components/views/view-container";
import { useSessionStore } from "@/stores/session-store";

export function Home() {
  const { initialized, isFirstTime, hasApiKey, load } = useAppStore();
  const { messages, isStreaming, streamingText, steps, artifacts, knowledgeRefs, error } =
    useSessionStore();
  const viewPanels = useViewStore((s) => s.panels);
  const addPanel = useViewStore((s) => s.addPanel);

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

  if (!initialized) return null;

  if (isFirstTime) {
    return <Welcome />;
  }

  if (!hasApiKey) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8 text-center">
        <p className="text-[var(--color-text-secondary)] mb-2">
          Configure your LLM API key in Settings to get started.
        </p>
        <p className="text-[var(--color-text-tertiary)] text-sm">
          Go to Settings → add your Anthropic or OpenAI API key.
        </p>
      </div>
    );
  }

  const hasConversation = messages.length > 0 || isStreaming;
  const hasViews = viewPanels.length > 0;

  return (
    <div className="flex h-full">
      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {!hasConversation ? (
          // Empty state: centered Command Bar
          <div className="flex-1 flex flex-col items-center justify-center px-8">
            <div className="max-w-2xl w-full">
              <h2 className="text-2xl font-semibold mb-2 text-center">
                What can I help you with?
              </h2>
              <p className="text-[var(--color-text-tertiary)] mb-6 text-sm text-center">
                Describe a task, and I'll use your knowledge base to help.
              </p>
              <CommandBar />
            </div>
          </div>
        ) : (
          // Active conversation
          <>
            <div className="flex-1 overflow-y-auto px-4 py-4">
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
                  <div className="mt-2 p-3 rounded bg-red-500/10 text-red-400 text-sm">
                    {error}
                  </div>
                )}
              </div>
            </div>

            {/* Bottom bar: Command Bar + status */}
            <div className="border-t border-[var(--color-border)] px-4 py-3">
              <div className={hasViews ? "" : "max-w-3xl mx-auto"}>
                {/* Knowledge refs status bar */}
                {knowledgeRefs.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    <span className="text-xs text-[var(--color-text-tertiary)]">Knowledge:</span>
                    {knowledgeRefs.map((ref, i) => (
                      <span
                        key={i}
                        className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]"
                      >
                        {ref.filename}
                      </span>
                    ))}
                  </div>
                )}
                <CommandBar />
              </div>
            </div>
          </>
        )}
      </div>

      {/* View panels (right side) — only when artifacts exist */}
      {hasViews && <ViewContainer />}
    </div>
  );
}
