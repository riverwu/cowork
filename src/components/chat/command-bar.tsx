import { useState, useRef, useEffect } from "react";
import { useSessionStore } from "@/stores/session-store";
import { FileTypeIcon, IconSend, IconClose, IconPlus, IconFolder } from "@/components/icons";
import { pickFiles, pickFolder } from "@/lib/tauri";
import { t } from "@/lib/i18n";

interface AttachedFile {
  name: string;
  path: string;
}

function IconPlan({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2H4C3.45 2 3 2.45 3 3V15C3 15.55 3.45 16 4 16H14C14.55 16 15 15.55 15 15V5L12 2Z" />
      <path d="M6 9H12" />
      <path d="M6 12H10" />
      <path d="M12 2V5H15" />
    </svg>
  );
}

function IconEraser({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 6L8 13H4L2.5 11.5C1.8 10.8 1.8 9.7 2.5 9L9 2.5C9.7 1.8 10.8 1.8 11.5 2.5L15 6Z" />
      <path d="M8 13H16" />
    </svg>
  );
}

function IconAttach({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 9.2L8.9 14.8C7.5 16.2 5.3 16.2 3.9 14.8C2.5 13.4 2.5 11.2 3.9 9.8L10.5 3.2C11.3 2.4 12.7 2.4 13.5 3.2C14.3 4 14.3 5.4 13.5 6.2L7.5 12.2C7.1 12.6 6.4 12.6 6 12.2C5.6 11.8 5.6 11.1 6 10.7L11 5.7" />
    </svg>
  );
}

export function CommandBar() {
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const {
    sendMessage, clearContext, planMode, togglePlanMode,
    workingDirectory, setWorkingDirectory, isStreaming, pendingMessages,
  } = useSessionStore();

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!showMenu) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  async function handleSubmit() {
    const text = input.trim();
    if (!text && files.length === 0) return;
    let message = text;
    if (files.length > 0) {
      const fileList = files.map((f) => `[File: ${f.name}](${f.path})`).join("\n");
      message = text ? `${text}\n\nAttached files:\n${fileList}` : `Please analyze these files:\n${fileList}`;
    }
    setInput("");
    setFiles([]);
    await sendMessage(message);
  }

  const [composing, setComposing] = useState(false);

  function handleKeyDown(e: React.KeyboardEvent) {
    // Don't submit during IME composition (Chinese/Japanese input)
    if (composing) return;
    // Cmd+Enter (Mac) or Ctrl+Enter (Windows) to submit
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleAttachFiles() {
    const result = await pickFiles({
      multiple: true,
      filters: [
        { name: "Documents", extensions: ["txt", "md", "pdf", "docx", "xlsx", "csv", "json"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (!result) return;
    const paths = Array.isArray(result) ? result : [result];
    setFiles((prev) => [...prev, ...paths.map((p) => ({ name: p.split("/").pop() || p, path: p }))]);
  }

  function removeFile(index: number) { setFiles((prev) => prev.filter((_, i) => i !== index)); }

  function handleClearContext() { clearContext(); setShowMenu(false); }
  function handleTogglePlan() { togglePlanMode(); setShowMenu(false); }
  async function handleChangeWorkDir() {
    const path = await pickFolder();
    if (path) setWorkingDirectory(path);
  }

  useEffect(() => {
    const el = inputRef.current;
    if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 200) + "px"; }
  }, [input]);

  const hasContent = input.trim() || files.length > 0;

  return (
    <div className={`bg-[var(--surface-lowest)] border rounded-2xl shadow-[var(--shadow-md)] overflow-visible relative ${planMode ? "border-blue-300" : "border-[var(--border)]"}`}>

      {/* Attached files */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3 pb-1">
          {files.map((file, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg bg-[var(--surface-low)] border border-[var(--border)] text-[12px] text-[var(--on-surface-secondary)]">
              <FileTypeIcon filename={file.name} path={file.path} size={22} />
              <span className="max-w-[160px] truncate">{file.name}</span>
              <button onClick={() => removeFile(i)} className="p-0.5 rounded hover:bg-[var(--surface-container)] text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)] cursor-pointer transition-colors">
                <IconClose size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Text input — full width, starts from top-left */}
      <div className="px-4 pt-3 pb-1">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          placeholder={isStreaming ? t("home.input.queueHint") : t("home.input.placeholder")}
          rows={2}
          className="w-full bg-transparent text-[var(--on-surface)] placeholder:text-[var(--on-surface-tertiary)] focus:outline-none text-[14px] leading-relaxed resize-none"
        />
      </div>

      {/* Bottom bar: left actions + right send */}
      <div className="flex items-center justify-between px-3 pb-2.5 pt-0.5">
        {/* Left: +menu, attach, working dir, plan mode */}
        <div className="flex items-center gap-0.5">
          {/* + Menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowMenu(!showMenu)}
              className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                showMenu ? "bg-[var(--surface-container)] text-[var(--on-surface)]" : "text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)]"
              }`}
              title="Menu"
            >
              <IconPlus size={16} />
            </button>
            {showMenu && (
              <div className="absolute bottom-full left-0 mb-2 w-52 bg-[var(--surface-lowest)] border border-[var(--border)] rounded-xl shadow-[var(--shadow-lg)] py-1 z-50">
                <button onClick={handleTogglePlan} className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] cursor-pointer transition-colors text-left">
                  <IconPlan size={15} />
                  <span className="flex-1">{t("home.planMode")}</span>
                  {planMode && <span className="text-[var(--primary-accent)] text-[11px]">ON</span>}
                </button>
                <button onClick={handleClearContext} className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] cursor-pointer transition-colors text-left">
                  <IconEraser size={15} />
                  {t("home.clearContext")}
                </button>
              </div>
            )}
          </div>

          {/* Attach */}
          <button
            onClick={handleAttachFiles}
            className="p-1.5 rounded-lg text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] cursor-pointer transition-colors"
            title="Attach files"
          >
            <IconAttach size={16} />
          </button>

          {/* Separator */}
          <div className="w-px h-4 bg-[var(--border)] mx-1" />

          {/* Working directory */}
          <button
            onClick={handleChangeWorkDir}
            className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] cursor-pointer transition-colors truncate max-w-[220px]"
            title={workingDirectory}
          >
            <IconFolder size={12} />
            <span className="truncate">{shortenPath(workingDirectory)}</span>
          </button>

          {/* Plan mode indicator */}
          {planMode && (
            <>
              <div className="w-px h-4 bg-[var(--border)] mx-1" />
              <span className="flex items-center gap-1 px-1.5 py-1 text-[11px] text-blue-600 font-medium">
                <IconPlan size={11} />
                {t("home.planMode")}
              </span>
            </>
          )}
        </div>

        {/* Right: shortcut hint + send */}
        <div className="flex items-center gap-1.5">
          {/* Queued message count */}
          {pendingMessages.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium">
              {pendingMessages.length} queued
            </span>
          )}
          <span className="text-[10px] text-[var(--on-surface-tertiary)]">⌘↵</span>
          <button
            onClick={handleSubmit}
            disabled={!hasContent}
            className={`p-2 rounded-xl cursor-pointer transition-all ${
              hasContent
                ? isStreaming
                  ? "bg-amber-500 text-white hover:bg-amber-600 shadow-sm"
                  : "bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] shadow-sm"
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

function shortenPath(path: string): string {
  if (!path) return "~";
  const home = path.match(/^\/Users\/[^/]+/)?.[0] || path.match(/^\/home\/[^/]+/)?.[0];
  if (home && path.startsWith(home)) return "~" + path.slice(home.length);
  return path;
}
