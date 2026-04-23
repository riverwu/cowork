import { useState, useRef, useEffect } from "react";
import { useSessionStore } from "@/stores/session-store";
import { IconSend, IconDocument, IconClose } from "@/components/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { t } from "@/lib/i18n";

interface AttachedFile {
  name: string;
  path: string;
}

export function CommandBar() {
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage, isStreaming } = useSessionStore();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit() {
    const text = input.trim();
    if ((!text && files.length === 0) || isStreaming) return;

    // Build message with file references
    let message = text;
    if (files.length > 0) {
      const fileList = files.map((f) => `[File: ${f.name}](${f.path})`).join("\n");
      message = files.length > 0 && text
        ? `${text}\n\nAttached files:\n${fileList}`
        : text || `Please analyze these files:\n${fileList}`;
    }

    setInput("");
    setFiles([]);
    await sendMessage(message);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleAttachFiles() {
    const result = await open({
      multiple: true,
      filters: [
        { name: "Documents", extensions: ["txt", "md", "pdf", "docx", "xlsx", "csv", "json"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (!result) return;

    const paths = Array.isArray(result) ? result : [result];
    const newFiles: AttachedFile[] = paths.map((p) => ({
      name: p.split("/").pop() || p,
      path: p,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  }, [input]);

  const hasContent = input.trim() || files.length > 0;

  return (
    <div className="bg-[var(--surface-lowest)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-md)] overflow-hidden">
      {/* Attached files */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3 pb-1">
          {files.map((file, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg bg-[var(--surface-low)] border border-[var(--border)] text-[12px] text-[var(--on-surface-secondary)]"
            >
              <IconDocument size={12} />
              <span className="max-w-[160px] truncate">{file.name}</span>
              <button
                onClick={() => removeFile(i)}
                className="p-0.5 rounded hover:bg-[var(--surface-container)] text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)] cursor-pointer transition-colors"
              >
                <IconClose size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2 px-4 py-3">
        {/* Attach button */}
        <div className="flex items-center gap-1 pb-0.5">
          <button
            onClick={handleAttachFiles}
            disabled={isStreaming}
            className="p-1.5 rounded-lg text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] cursor-pointer transition-colors disabled:opacity-30"
            title="Attach files"
          >
            <IconAttach size={18} />
          </button>
        </div>

        {/* Text input */}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? t("home.input.thinking") : t("home.input.placeholder")}
          disabled={isStreaming}
          rows={2}
          className="flex-1 py-1 bg-transparent text-[var(--on-surface)] placeholder:text-[var(--on-surface-tertiary)] focus:outline-none text-[14px] leading-relaxed resize-none disabled:opacity-50"
        />

        {/* Send button */}
        <div className="pb-0.5">
          <button
            onClick={handleSubmit}
            disabled={!hasContent || isStreaming}
            className={`p-2 rounded-xl cursor-pointer transition-all ${
              hasContent && !isStreaming
                ? "bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] shadow-sm"
                : "bg-[var(--surface-low)] text-[var(--on-surface-tertiary)]"
            } disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            <IconSend size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// Paperclip / attach icon
function IconAttach({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 9.2L8.9 14.8C7.5 16.2 5.3 16.2 3.9 14.8C2.5 13.4 2.5 11.2 3.9 9.8L10.5 3.2C11.3 2.4 12.7 2.4 13.5 3.2C14.3 4 14.3 5.4 13.5 6.2L7.5 12.2C7.1 12.6 6.4 12.6 6 12.2C5.6 11.8 5.6 11.1 6 10.7L11 5.7" />
    </svg>
  );
}
