import { useState, useRef, useEffect } from "react";
import { useSessionStore } from "@/stores/session-store";
import { IconSearch, IconSend } from "@/components/icons";
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
      <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--on-surface-tertiary)]">
        <IconSearch size={14} />
      </div>
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isStreaming ? t("home.input.thinking") : t("home.input.placeholder")}
        disabled={isStreaming}
        rows={1}
        className="w-full pl-9 pr-11 py-2.5 bg-[var(--surface-lowest)] border border-[var(--border)] rounded-xl text-[var(--on-surface)] placeholder:text-[var(--on-surface-tertiary)] focus:outline-none focus:border-[var(--primary-accent)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] text-[13px] resize-none disabled:opacity-50 shadow-[var(--shadow-sm)] transition-all"
      />
      <button
        onClick={handleSubmit}
        disabled={!input.trim() || isStreaming}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-[var(--on-surface-tertiary)] hover:text-[var(--primary-accent)] hover:bg-[var(--surface-container)] disabled:opacity-20 cursor-pointer transition-colors"
      >
        <IconSend size={14} />
      </button>
    </div>
  );
}
