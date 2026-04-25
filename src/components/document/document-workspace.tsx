import { useEffect, useMemo, useState } from "react";
import {
  FileTypeIcon,
  IconClose,
  IconDocument,
  IconFolder,
  IconRedo,
  IconSend,
  IconUndo,
} from "@/components/icons";
import { PresentationSlideView } from "@/components/document/presentation-slide-view";
import {
  applyPresentationCommand,
  inferPresentationCommandFromInstruction,
  type PresentationCommand,
} from "@/lib/document/presentation-commands";
import { buildPresentationDLIR, type ElementIR, type PresentationDLIR } from "@/lib/document/presentation-dlir";
import { importPptxPackage } from "@/lib/document/pptx-importer";
import { parseDocument, readFileText, readPptxPackage, revealInFolder } from "@/lib/tauri";
import { useViewStore, type WorkspaceDocument } from "@/stores/view-store";

interface HistoryItem {
  id: string;
  instruction: string;
  description: string;
  status: "applied" | "undone";
  createdAt: number;
  command?: PresentationCommand;
  inverse?: PresentationCommand;
}

interface PreviewState {
  status: "loading" | "ready" | "error";
  text: string;
  error?: string;
  presentation?: PresentationDLIR;
}

const TEXT_PREVIEW_LIMIT = 18000;
type PreviewTab = "dlir" | "text";
type SlideZoom = "fit" | number;

export function DocumentWorkspace() {
  const document = useViewStore((s) => s.documentWorkspace);
  const closeDocument = useViewStore((s) => s.closeDocument);

  if (!document) return null;

  return (
    <div className="fixed inset-0 z-40 bg-[var(--surface)] pt-7">
      <DocumentWorkspaceContent document={document} onClose={closeDocument} />
    </div>
  );
}

function DocumentWorkspaceContent({
  document,
  onClose,
}: {
  document: WorkspaceDocument;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<PreviewState>({ status: "loading", text: "" });
  const [instruction, setInstruction] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [previewTab, setPreviewTab] = useState<PreviewTab>("dlir");
  const [slideZoom, setSlideZoom] = useState<SlideZoom>("fit");
  const fileName = document.title || document.path.split("/").pop() || document.path;
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const activeHistory = history.slice(0, cursor);
  const undoneHistory = history.slice(cursor);
  const documentKind = documentKindLabel(ext);
  const activeSlide = preview.presentation?.slides[activeSlideIndex] || preview.presentation?.slides[0] || null;
  const selectedElement = activeSlide?.elements.find((element) => element.id === selectedElementId) || null;

  useEffect(() => {
    let cancelled = false;
    setPreview({ status: "loading", text: "" });
    loadPreview(document.path, ext)
      .then((loaded) => {
        if (!cancelled) {
          setPreview({
            status: "ready",
            text: trimPreview(loaded.text),
            presentation: loaded.presentation,
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPreview({
            status: "error",
            text: "",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    setInstruction("");
    setHistory([]);
    setCursor(0);
    setSelectedElementId(null);
    setActiveSlideIndex(0);
    setPreviewTab("dlir");
    setSlideZoom("fit");
    return () => { cancelled = true; };
  }, [document.path, ext]);

  const modelSummary = useMemo(() => buildInitialModelSummary(fileName, ext, preview), [fileName, ext, preview]);

  function handleApplyInstruction() {
    const text = instruction.trim();
    if (!text) return;
    if (preview.presentation) {
      const command = inferPresentationCommandFromInstruction(preview.presentation, text);
      if (command) {
        applyCommand(command, text);
        setInstruction("");
        return;
      }
    }
    const next = history.slice(0, cursor);
    next.push({
      id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      instruction: text,
      description: "已记录编辑意图",
      status: "applied",
      createdAt: Date.now(),
    });
    setHistory(next);
    setCursor(next.length);
    setInstruction("");
  }

  function handleUndo() {
    if (cursor <= 0) return;
    const item = history[cursor - 1];
    if (item.inverse) {
      applyCommandWithoutHistory(item.inverse);
    }
    setCursor(cursor - 1);
    setHistory((items) => items.map((item, index) =>
      index === cursor - 1 ? { ...item, status: "undone" } : item,
    ));
  }

  function handleRedo() {
    if (cursor >= history.length) return;
    const item = history[cursor];
    if (item.command) {
      applyCommandWithoutHistory(item.command);
    }
    setCursor(cursor + 1);
    setHistory((items) => items.map((item, index) =>
      index === cursor ? { ...item, status: "applied" } : item,
    ));
  }

  function applyCommand(command: PresentationCommand, label: string) {
    if (!preview.presentation) return;
    const result = applyPresentationCommand(preview.presentation, command);
    setPreview({
      ...preview,
      presentation: result.document,
      text: result.document.slides.map((slide) => `# Slide ${slide.index}: ${slide.title || "Untitled"}\n${slide.summary}`).join("\n\n"),
    });
    const next = history.slice(0, cursor);
    next.push({
      id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      instruction: label,
      description: result.description,
      status: "applied",
      createdAt: Date.now(),
      command,
      inverse: result.inverse,
    });
    setHistory(next);
    setCursor(next.length);
  }

  function applyCommandWithoutHistory(command: PresentationCommand) {
    setPreview((current) => {
      if (!current.presentation) return current;
      const result = applyPresentationCommand(current.presentation, command);
      return {
        ...current,
        presentation: result.document,
        text: result.document.slides.map((slide) => `# Slide ${slide.index}: ${slide.title || "Untitled"}\n${slide.summary}`).join("\n\n"),
      };
    });
  }

  function handleManualTextChange(text: string) {
    if (!activeSlide || !selectedElement || selectedElement.type !== "text") return;
    applyCommand({
      type: "replace_text",
      slideId: activeSlide.id,
      elementId: selectedElement.id,
      text,
    }, `手动修改文本：${selectedElement.id}`);
  }

  function handleNudge(dx: number, dy: number) {
    if (!activeSlide || !selectedElement) return;
    applyCommand({
      type: "move_element",
      slideId: activeSlide.id,
      elementId: selectedElement.id,
      dx,
      dy,
    }, `手动移动元素：${selectedElement.id}`);
  }

  return (
    <div className="h-full flex flex-col">
      <div className="h-14 shrink-0 border-b border-[var(--border)] bg-[var(--surface-lowest)] flex items-center gap-3 px-5">
        <FileTypeIcon filename={fileName} path={document.path} size={32} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-[var(--on-surface)] truncate">{fileName}</div>
          <div className="text-[11px] text-[var(--on-surface-tertiary)] truncate">{document.path}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleUndo}
            disabled={cursor <= 0}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
            title="撤销"
          >
            <IconUndo size={15} />
          </button>
          <button
            onClick={handleRedo}
            disabled={cursor >= history.length}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
            title="重做"
          >
            <IconRedo size={15} />
          </button>
          <button
            onClick={() => revealInFolder(document.path)}
            className="h-8 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[12px] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] cursor-pointer"
          >
            <IconFolder size={13} /> 定位
          </button>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--on-surface-tertiary)] hover:text-[var(--error)] hover:bg-[var(--surface-low)] cursor-pointer"
            title="关闭"
          >
            <IconClose size={15} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[1fr_320px]">
        <main className="min-w-0 min-h-0 flex flex-col bg-[var(--surface)]">
          <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-low)]">
            <div className="flex items-center gap-2">
              <IconDocument size={14} className="text-[var(--primary-accent)]" />
              <span className="text-[13px] font-semibold text-[var(--on-surface)]">Document Workspace</span>
              <span className="text-[11px] text-[var(--on-surface-tertiary)]">{documentKind}</span>
            </div>
            <p className="mt-1 text-[12px] text-[var(--on-surface-secondary)]">
              当前工作区已接入自然语言编辑入口和操作历史。PPTX/DOCX/XLSX 的高保真 DLIR 渲染器会在这里替换文本预览层。
            </p>
          </div>

          <div className="flex-1 min-h-0 overflow-auto p-6">
            <div className="mx-auto max-w-5xl">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-lowest)] shadow-[var(--shadow-sm)] overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
                  <div>
                    <div className="text-[12px] font-semibold text-[var(--on-surface)]">文档信息</div>
                    <div className="text-[11px] text-[var(--on-surface-tertiary)]">DLIR / text preview</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-low)] p-0.5">
                      <button
                        type="button"
                        onClick={() => setPreviewTab("dlir")}
                        className={`h-7 px-2.5 rounded-md text-[11px] font-medium cursor-pointer ${previewTab === "dlir" ? "bg-white text-[var(--on-surface)] shadow-[var(--shadow-sm)]" : "text-[var(--on-surface-secondary)] hover:text-[var(--on-surface)]"}`}
                      >
                        DLIR
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewTab("text")}
                        className={`h-7 px-2.5 rounded-md text-[11px] font-medium cursor-pointer ${previewTab === "text" ? "bg-white text-[var(--on-surface)] shadow-[var(--shadow-sm)]" : "text-[var(--on-surface-secondary)] hover:text-[var(--on-surface)]"}`}
                      >
                        文本
                      </button>
                    </div>
                    <span className="text-[10px] px-2 py-1 rounded-full bg-[var(--surface-low)] text-[var(--on-surface-tertiary)] uppercase">{ext || "file"}</span>
                  </div>
                </div>
                {previewTab === "dlir" ? (
                  <pre className="p-4 max-h-[360px] text-[12px] leading-[1.7] text-[var(--chat-text)] whitespace-pre-wrap overflow-auto font-mono bg-[var(--surface-lowest)]">{modelSummary}</pre>
                ) : (
                  <PreviewPane preview={preview} compact />
                )}
              </div>

              {preview.presentation && activeSlide && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <div className="text-[12px] font-semibold text-[var(--on-surface)]">页面渲染</div>
                      <div className="text-[11px] text-[var(--on-surface-tertiary)]">默认 Fit in，可切换固定缩放比例</div>
                    </div>
                    <ZoomControl value={slideZoom} onChange={setSlideZoom} />
                  </div>
                  <div className="grid grid-cols-[150px_1fr] gap-4">
                  <SlideNavigator
                    slides={preview.presentation.slides}
                    pageSize={preview.presentation.pageSize}
                    activeSlideIndex={activeSlideIndex}
                    onSelect={(index) => {
                      setActiveSlideIndex(index);
                      setSelectedElementId(null);
                    }}
                  />
                  <PresentationSlideView
                    slide={activeSlide}
                    pageSize={preview.presentation.pageSize}
                    zoom={slideZoom}
                    selectedElementId={selectedElementId}
                    onSelectElement={setSelectedElementId}
                  />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-[var(--border)] bg-[var(--surface-lowest)] px-5 py-4">
            <div className="rounded-2xl border border-[var(--border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
              <textarea
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="用自然语言描述你想如何编辑这个文档，例如：把第 3 页标题改短，统一成 Apple 风格，并检查文字溢出。"
                className="w-full min-h-[72px] resize-none px-4 py-3 text-[13px] leading-relaxed outline-none text-[var(--chat-text)] placeholder:text-[var(--on-surface-tertiary)] bg-transparent"
              />
              <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--border)] bg-[var(--surface-low)]">
                <span className="text-[11px] text-[var(--on-surface-tertiary)]">输入会先记录为可撤销的编辑意图，后续接入 DLIR patch 执行器。</span>
                <button
                  onClick={handleApplyInstruction}
                  disabled={!instruction.trim()}
                  className="h-8 px-3 rounded-lg bg-[var(--primary-accent)] text-white text-[12px] font-medium inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <IconSend size={13} /> 应用
                </button>
              </div>
            </div>
          </div>
        </main>

        <aside className="border-l border-[var(--border)] bg-[var(--surface-lowest)] flex flex-col min-h-0">
          <div className="px-4 py-3 border-b border-[var(--border)] space-y-3">
            <div>
              <div className="text-[13px] font-semibold text-[var(--on-surface)]">手动编辑</div>
              <div className="text-[11px] text-[var(--on-surface-tertiary)]">选择页面元素后可直接修改，同样进入撤销历史</div>
            </div>
            <ManualEditPanel
              element={selectedElement}
              onTextChange={handleManualTextChange}
              onNudge={handleNudge}
            />
          </div>
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <div className="text-[13px] font-semibold text-[var(--on-surface)]">操作历史</div>
            <div className="text-[11px] text-[var(--on-surface-tertiary)]">{activeHistory.length} 已应用，{undoneHistory.length} 可重做</div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
            {history.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] px-3 py-8 text-center text-[12px] text-[var(--on-surface-tertiary)]">
                暂无编辑记录
              </div>
            ) : (
              history.map((item, index) => (
                <div
                  key={item.id}
                  className={`rounded-xl border px-3 py-2 ${index < cursor ? "border-[var(--border)] bg-[var(--surface-low)]" : "border-dashed border-[var(--border)] bg-transparent opacity-65"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${index < cursor ? "bg-[var(--primary-accent)]" : "bg-[var(--on-surface-tertiary)]"}`} />
                    <span className="text-[11px] font-medium text-[var(--on-surface-secondary)]">{index < cursor ? "已应用" : "已撤销"}</span>
                    <span className="ml-auto text-[10px] text-[var(--on-surface-tertiary)]">{formatTime(item.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-[var(--chat-text)]">{item.instruction}</p>
                  <p className="mt-1 text-[10.5px] text-[var(--on-surface-tertiary)]">{item.description}</p>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ZoomControl({ value, onChange }: { value: SlideZoom; onChange: (value: SlideZoom) => void }) {
  const options: Array<{ label: string; value: SlideZoom }> = [
    { label: "Fit", value: "fit" },
    { label: "75%", value: 0.75 },
    { label: "100%", value: 1 },
    { label: "125%", value: 1.25 },
  ];
  return (
    <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-lowest)] p-0.5 shadow-[var(--shadow-sm)]">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.label}
            type="button"
            onClick={() => onChange(option.value)}
            className={`h-7 px-2.5 rounded-md text-[11px] font-medium cursor-pointer ${active ? "bg-[var(--primary-accent)] text-white" : "text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] hover:text-[var(--on-surface)]"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SlideNavigator({
  slides,
  pageSize,
  activeSlideIndex,
  onSelect,
}: {
  slides: PresentationDLIR["slides"];
  pageSize: PresentationDLIR["pageSize"];
  activeSlideIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-lowest)] p-2 shadow-[var(--shadow-sm)] max-h-[620px] overflow-y-auto">
      <div className="px-1 pb-2 text-[11px] font-semibold text-[var(--on-surface-secondary)]">Slides</div>
      <div className="space-y-2">
        {slides.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            onClick={() => onSelect(index)}
            className={`w-full rounded-lg border p-2 text-left cursor-pointer transition ${index === activeSlideIndex ? "border-[var(--primary-accent)] bg-[var(--primary-accent)]/[0.06]" : "border-[var(--border)] bg-white hover:bg-[var(--surface-low)]"}`}
          >
            <div className="aspect-video rounded bg-white border border-black/[0.08] overflow-hidden relative">
              {slide.elements.slice(0, 12).map((element) => (
                <span
                  key={element.id}
                  className={`absolute rounded-sm ${element.type === "text" ? "bg-slate-300" : element.type === "image" ? "bg-sky-300" : "bg-slate-200"}`}
                  style={{
                    left: `${Math.max(0, (element.bbox.x / pageSize.w) * 100)}%`,
                    top: `${Math.max(0, (element.bbox.y / pageSize.h) * 100)}%`,
                    width: `${Math.max(2, (element.bbox.w / pageSize.w) * 100)}%`,
                    height: `${Math.max(2, (element.bbox.h / pageSize.h) * 100)}%`,
                  }}
                />
              ))}
            </div>
            <div className="mt-1 text-[11px] font-medium text-[var(--on-surface)] truncate">
              {index + 1}. {slide.title || "Untitled"}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ManualEditPanel({
  element,
  onTextChange,
  onNudge,
}: {
  element: ElementIR | null;
  onTextChange: (text: string) => void;
  onNudge: (dx: number, dy: number) => void;
}) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft(element?.type === "text" ? element.text || "" : "");
  }, [element?.id, element?.text, element?.type]);

  if (!element) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] px-3 py-5 text-center text-[12px] text-[var(--on-surface-tertiary)]">
        在页面预览中选择一个元素
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-low)] p-3 space-y-3">
      <div>
        <div className="text-[12px] font-semibold text-[var(--on-surface)] truncate">{element.id}</div>
        <div className="text-[10.5px] text-[var(--on-surface-tertiary)]">{element.type} · {element.role}</div>
      </div>

      {element.type === "text" && (
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-[var(--on-surface-secondary)]">文本</label>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="w-full min-h-[88px] resize-none rounded-lg border border-[var(--border)] bg-white px-2.5 py-2 text-[12px] leading-relaxed text-[var(--chat-text)] outline-none focus:border-[var(--primary-accent)]"
          />
          <button
            onClick={() => onTextChange(draft)}
            disabled={draft === (element.text || "")}
            className="h-7 px-2.5 rounded-md bg-[var(--primary-accent)] text-white text-[11px] font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            应用文本
          </button>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="text-[11px] font-medium text-[var(--on-surface-secondary)]">位置</div>
        <div className="grid grid-cols-3 gap-1.5 w-[92px]">
          <span />
          <button className="h-7 w-7 rounded-md border border-[var(--border)] bg-white text-[12px] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] cursor-pointer" onClick={() => onNudge(0, -0.1)}>↑</button>
          <span />
          <button className="h-7 w-7 rounded-md border border-[var(--border)] bg-white text-[12px] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] cursor-pointer" onClick={() => onNudge(-0.1, 0)}>←</button>
          <button className="h-7 w-7 rounded-md border border-[var(--border)] bg-white text-[12px] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] cursor-pointer" onClick={() => onNudge(0, 0.1)}>↓</button>
          <button className="h-7 w-7 rounded-md border border-[var(--border)] bg-white text-[12px] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] cursor-pointer" onClick={() => onNudge(0.1, 0)}>→</button>
        </div>
        <div className="text-[10.5px] text-[var(--on-surface-tertiary)]">
          x {element.bbox.x.toFixed(2)} · y {element.bbox.y.toFixed(2)} · w {element.bbox.w.toFixed(2)} · h {element.bbox.h.toFixed(2)}
        </div>
      </div>
    </div>
  );
}

function PreviewPane({ preview, compact = false }: { preview: PreviewState; compact?: boolean }) {
  if (preview.status === "loading") {
    return <div className="p-6 text-[13px] text-[var(--on-surface-tertiary)]">正在解析文档...</div>;
  }
  if (preview.status === "error") {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-[var(--error-light)] text-[var(--error)] px-3 py-2 text-[12px]">
          {preview.error || "文档解析失败"}
        </div>
      </div>
    );
  }
  return (
    <pre className={`p-4 overflow-auto text-[12.5px] leading-[1.75] text-[var(--chat-text)] whitespace-pre-wrap ${compact ? "max-h-[360px]" : "max-h-[520px]"}`}>
      {preview.text || "没有可展示的文本内容。"}
    </pre>
  );
}

async function loadPreview(path: string, ext: string): Promise<{ text: string; presentation?: PresentationDLIR }> {
  if (ext === "pptx") {
    const pkg = await readPptxPackage(path);
    const model = importPptxPackage(pkg, path.split("/").pop() || "Presentation");
    const presentation = buildPresentationDLIR(model);
    return {
      presentation,
      text: presentation.slides.map((slide) => `# Slide ${slide.index}: ${slide.title || "Untitled"}\n${slide.summary}`).join("\n\n"),
    };
  }
  if (["txt", "md", "json", "csv", "xml", "html", "css", "js", "ts", "py", "rs", "go", "sql", "yaml", "yml", "toml"].includes(ext)) {
    return { text: await readFileText(path) };
  }
  return { text: await parseDocument(path) };
}

function trimPreview(text: string): string {
  if (text.length <= TEXT_PREVIEW_LIMIT) return text;
  return `${text.slice(0, TEXT_PREVIEW_LIMIT)}\n\n... 文本预览已截断，完整内容会通过分段读取和 DLIR 工具处理。`;
}

function buildInitialModelSummary(fileName: string, ext: string, preview: PreviewState): string {
  const base = {
    document: {
      title: fileName,
      extension: ext || "unknown",
      mode: documentKindLabel(ext),
    },
    workspace: {
      model: "DLIR placeholder",
      editable: true,
      operations: ["natural_language_instruction", "undo", "redo", "history"],
    },
    extraction: {
      status: preview.status,
      previewChars: preview.text.length,
      slides: preview.presentation?.slides.length || null,
      renderedElements: preview.presentation?.slides.reduce((sum, slide) => sum + slide.elements.length, 0) || null,
      images: preview.presentation?.slides.reduce((sum, slide) => sum + slide.elements.filter((element) => element.type === "image").length, 0) || null,
      error: preview.error || null,
    },
  };
  return JSON.stringify(base, null, 2);
}

function documentKindLabel(ext: string): string {
  if (["ppt", "pptx"].includes(ext)) return "Presentation";
  if (["doc", "docx"].includes(ext)) return "Document";
  if (["xls", "xlsx", "csv"].includes(ext)) return "Spreadsheet";
  if (ext === "pdf") return "PDF";
  return "File";
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
