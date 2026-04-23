import { useState, useRef, useEffect } from "react";
import { useSessionStore } from "@/stores/session-store";
import { t } from "@/lib/i18n";

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
        placeholder={isStreaming ? t("home.input.thinking") : t("home.input.placeholder")}
        disabled={isStreaming}
        rows={1}
        className="w-full px-4 py-2.5 pr-11 bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)] rounded-xl text-[var(--on-surface)] placeholder:text-[var(--outline)] focus:outline-none focus:border-[var(--primary-container)] focus:ring-2 focus:ring-[var(--primary-fixed-dim)]/20 text-[13px] resize-none disabled:opacity-50 shadow-sm"
      />
      <button
        onClick={handleSubmit}
        disabled={!input.trim() || isStreaming}
        className="absolute right-2.5 bottom-2 p-1.5 rounded-lg text-[var(--outline)] hover:text-[var(--primary)] hover:bg-[var(--surface-container)] disabled:opacity-30 cursor-pointer transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M2 14L14 8L2 2V6.5L10 8L2 9.5V14Z" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
