import { useState, useRef, useEffect } from "react";
import { useSessionStore } from "@/stores/session-store";

export function CommandBar() {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage, isStreaming } = useSessionStore();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit() {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    await sendMessage(text);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 150) + "px";
    }
  }, [input]);

  return (
    <div className="relative">
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isStreaming ? "Thinking..." : "Tell me what you want to do..."}
        disabled={isStreaming}
        rows={1}
        className="w-full px-4 py-3 pr-12 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-accent)] text-sm resize-none disabled:opacity-50"
      />
      <button
        onClick={handleSubmit}
        disabled={!input.trim() || isStreaming}
        className="absolute right-2 bottom-2 p-1.5 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] disabled:opacity-30 cursor-pointer transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 14L14 8L2 2V6.5L10 8L2 9.5V14Z" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
