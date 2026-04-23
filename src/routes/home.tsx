import { useEffect } from "react";
import { useAppStore } from "@/stores/app-store";
import { Welcome } from "@/components/onboarding/welcome";
import { CommandBar } from "@/components/chat/command-bar";
import { MessageList } from "@/components/chat/message-list";
import { useSessionStore } from "@/stores/session-store";

export function Home() {
  const { initialized, isFirstTime, hasApiKey, load } = useAppStore();
  const { messages, isStreaming, streamingText, steps, artifacts, knowledgeRefs, error } =
    useSessionStore();

  useEffect(() => {
    if (!initialized) load();
  }, [initialized, load]);

  if (!initialized) return null;

  // First-time user: show onboarding
  if (isFirstTime) {
    return <Welcome />;
  }

  // Need API key configured
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

  return (
    <div className="flex flex-col h-full">
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
            <div className="max-w-3xl mx-auto">
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
          <div className="px-4 pb-4">
            <div className="max-w-3xl mx-auto">
              <CommandBar />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
