import { useEffect, useState, useCallback } from "react";
import {
  IconFolder, IconDocument, IconReport, IconPlus,
  IconClose, IconSearch, IconSpinner, IconServer,
  IconChart, IconMail, IconPackage, IconPuzzle, IconWarning,
} from "@/components/icons";
import { useAppStore } from "@/stores/app-store";
import {
  listDocuments, countDocuments, updateDocumentStatus,
  listRecentArtifacts, deleteSource,
} from "@/lib/db";
import { indexSource } from "@/lib/knowledge";
import { retrieveRelevant } from "@/lib/knowledge";
import { pickFolder, scanDirectory } from "@/lib/tauri";
import { createSource } from "@/lib/db";
import { t } from "@/lib/i18n";
import type { Source, Document, Artifact } from "@/types";

type AddStep = "closed" | "choose" | Source["type"];

const SOURCE_TYPES: Array<{
  type: Source["type"];
  title: string;
  desc: string;
  enabled: boolean;
}> = [
  { type: "local_folder", title: "文件夹", desc: "索引本机文档目录，支持增删更新。", enabled: true },
  { type: "upload", title: "上传文件", desc: "添加一组固定文件作为资料库。", enabled: false },
  { type: "confluence", title: "Confluence", desc: "连接团队文档空间。", enabled: false },
  { type: "erp", title: "ERP", desc: "连接业务系统和结构化数据。", enabled: false },
  { type: "crm", title: "CRM", desc: "连接客户、商机和销售数据。", enabled: false },
  { type: "im", title: "IM 群组", desc: "连接工作群讨论记录。", enabled: false },
  { type: "database", title: "数据库", desc: "连接 SQL 数据源。", enabled: false },
  { type: "mcp", title: "MCP 服务", desc: "通过 MCP 工具访问外部系统。", enabled: false },
];

export function KnowledgePage() {
  const { sources, refreshSources } = useAppStore();
  const [recentArtifacts, setRecentArtifacts] = useState<Artifact[]>([]);
  const [addStep, setAddStep] = useState<AddStep>("closed");
  const [adding, setAdding] = useState(false);
  const [indexJobs, setIndexJobs] = useState<Record<string, string>>({});
  const [sourceToRemove, setSourceToRemove] = useState<Source | null>(null);
  const [removingSource, setRemovingSource] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ content: string; score: number; filename: string }> | null>(null);
  const [searching, setSearching] = useState(false);

  const loadPageData = useCallback(async () => {
    const artifacts = await listRecentArtifacts(10);
    setRecentArtifacts(artifacts);
  }, []);

  useEffect(() => { loadPageData(); }, [loadPageData]);

  useEffect(() => {
    if (!sources.some((source) => source.status === "indexing") && Object.keys(indexJobs).length === 0) return;
    const timer = window.setInterval(() => {
      refreshSources();
      loadPageData();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [indexJobs, loadPageData, refreshSources, sources]);

  function startBackgroundIndex(source: Source, path: string) {
    setIndexJobs((prev) => ({ ...prev, [source.id]: t("knowledge.scanning") }));
    void (async () => {
      try {
        const files = await scanDirectory(path);
        if (files.length === 0) {
          setIndexJobs((prev) => ({ ...prev, [source.id]: t("knowledge.noFiles") }));
          window.setTimeout(() => {
            setIndexJobs((prev) => removeJob(prev, source.id));
          }, 2000);
          return;
        }
        await indexSource(source.id, files, (current, total, filename) => {
          setIndexJobs((prev) => ({ ...prev, [source.id]: `${current}/${total}: ${filename}` }));
        });
      } catch (err) {
        console.error("Knowledge indexing failed:", err);
        setIndexJobs((prev) => ({ ...prev, [source.id]: t("knowledge.indexError") }));
      } finally {
        await refreshSources();
        await loadPageData();
        window.setTimeout(() => {
          setIndexJobs((prev) => removeJob(prev, source.id));
        }, 1000);
      }
    })();
  }

  async function handleCreateFolderLibrary() {
    const path = await pickFolder();
    if (!path) return;
    setAdding(true);
    try {
      const folderName = path.split("/").pop() || path;
      const source = await createSource({ type: "local_folder", path, name: folderName });
      await refreshSources();
      setAddStep("closed");
      startBackgroundIndex(source, path);
    } catch (err) {
      console.error("Failed to add folder:", err);
    } finally {
      setAdding(false);
    }
  }

  async function confirmDeleteSource() {
    if (!sourceToRemove || removingSource) return;
    setRemovingSource(true);
    try {
      await deleteSource(sourceToRemove.id);
      await refreshSources();
      await loadPageData();
      setSourceToRemove(null);
    } finally {
      setRemovingSource(false);
    }
  }

  function handleReindexSource(source: Source) {
    if (!source.path) return;
    startBackgroundIndex(source, source.path);
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await retrieveRelevant(searchQuery, 5);
      setSearchResults(results.map((r) => ({
        content: r.content.slice(0, 300),
        score: r.score,
        filename: (r.metadata?.filename as string) || "unknown",
      })));
    } catch {
      setSearchResults([]);
    }
    setSearching(false);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto py-8 px-8">
        <div className="mb-6">
          <h1 className="text-[18px] font-bold text-[var(--on-surface)]">{t("knowledge.title")}</h1>
          <p className="mt-1 text-[12px] text-[var(--on-surface-tertiary)]">{t("knowledge.libraryHint")}</p>
        </div>

        <section className="mb-8">
          <div className="flex gap-2 mb-3">
            <div className="flex-1 relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--on-surface-tertiary)]">
                <IconSearch size={14} />
              </div>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder={t("knowledge.searchPlaceholder")}
                className="w-full pl-9 pr-3 py-2.5 bg-white border border-[var(--border)] rounded-xl text-[13px] text-[var(--on-surface)] placeholder:text-[var(--on-surface-tertiary)] focus:outline-none focus:border-[var(--primary-accent)]"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={!searchQuery.trim() || searching}
              className="h-[38px] px-4 rounded-xl text-[13px] bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] cursor-pointer disabled:opacity-40 self-start"
            >
              {searching ? "..." : t("knowledge.search")}
            </button>
          </div>
          {searchResults !== null && (
            <div className="mb-5 bg-white rounded-xl border border-[var(--border)] overflow-hidden shadow-sm">
              <div className="px-4 py-2 border-b border-[var(--border)] flex items-center justify-between gap-3">
                <span className="text-[11px] font-medium text-[var(--on-surface-secondary)]">
                  {searchResults.length > 0 ? `${searchResults.length} ${t("knowledge.searchResults")}` : t("knowledge.noResults")}
                </span>
                <button
                  onClick={() => setSearchResults(null)}
                  className="p-1 rounded-md text-[var(--on-surface-secondary)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-low)] cursor-pointer"
                  aria-label={t("knowledge.closeResults")}
                >
                  <IconClose size={12} />
                </button>
              </div>
              {searchResults.length > 0 && (
                <div className="max-h-72 overflow-y-auto">
                  {searchResults.map((r, i) => (
                    <div key={i} className={`px-4 py-3 ${i < searchResults.length - 1 ? "border-b border-[var(--border)]/70" : ""}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <IconDocument size={12} />
                        <span className="text-[12px] font-medium text-[var(--on-surface)] truncate">{r.filename}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600">{(r.score * 100).toFixed(0)}%</span>
                      </div>
                      <p className="text-[12px] text-[var(--on-surface)] leading-relaxed">{r.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
            {sources.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                indexJob={indexJobs[source.id]}
                onDelete={setSourceToRemove}
                onReindex={handleReindexSource}
                onStatsChanged={loadPageData}
              />
            ))}
            <AddLibraryTile onClick={() => setAddStep("choose")} />
          </div>
        </section>

        {recentArtifacts.length > 0 && (
          <section>
            <h2 className="text-[14px] font-semibold text-[var(--on-surface)] mb-3">{t("knowledge.outputs")}</h2>
            <div className="bg-white rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]">
              {recentArtifacts.map((artifact) => (
                <div key={artifact.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-[var(--on-surface-secondary)]">
                    {artifact.type === "report" ? <IconReport size={14} /> : <IconDocument size={14} />}
                  </span>
                  <span className="flex-1 truncate text-[13px] text-[var(--on-surface)]">{artifact.title}</span>
                  <span className="text-[11px] text-[var(--on-surface-secondary)]">{formatDate(artifact.createdAt)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {addStep !== "closed" && (
        <AddLibraryModal
          step={addStep}
          adding={adding}
          onClose={() => !adding && setAddStep("closed")}
          onSelect={(type) => setAddStep(type)}
          onBack={() => setAddStep("choose")}
          onCreateFolder={handleCreateFolderLibrary}
        />
      )}

      {sourceToRemove && (
        <ConfirmRemoveSourceModal
          source={sourceToRemove}
          removing={removingSource}
          onCancel={() => !removingSource && setSourceToRemove(null)}
          onConfirm={confirmDeleteSource}
        />
      )}
    </div>
  );
}

function removeJob(jobs: Record<string, string>, sourceId: string): Record<string, string> {
  const next = { ...jobs };
  delete next[sourceId];
  return next;
}

function AddLibraryTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="min-h-[150px] rounded-xl border border-dashed border-[var(--border)] bg-white hover:bg-[var(--surface-low)] hover:border-[var(--primary-accent)] cursor-pointer transition-colors flex items-center justify-center"
      aria-label={t("knowledge.addLibrary")}
    >
      <span className="w-11 h-11 rounded-xl border border-[var(--border)] bg-white text-[var(--on-surface-secondary)] flex items-center justify-center">
        <IconPlus size={20} />
      </span>
    </button>
  );
}

function AddLibraryModal({
  step,
  adding,
  onClose,
  onSelect,
  onBack,
  onCreateFolder,
}: {
  step: AddStep;
  adding: boolean;
  onClose: () => void;
  onSelect: (type: Source["type"]) => void;
  onBack: () => void;
  onCreateFolder: () => void;
}) {
  const selected = SOURCE_TYPES.find((item) => item.type === step);
  const selectedType = step as Source["type"];

  return (
    <div className="fixed inset-0 z-50 bg-black/20 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-xl border border-[var(--border)] bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--on-surface)]">{t("knowledge.addLibrary")}</h2>
            <p className="mt-0.5 text-[12px] text-[var(--on-surface-secondary)]">
              {step === "choose" ? t("knowledge.chooseType") : selected?.title}
            </p>
          </div>
          <button onClick={onClose} disabled={adding} className="p-1.5 rounded-lg text-[var(--on-surface-tertiary)] hover:bg-[var(--surface-low)] disabled:opacity-40">
            <IconClose size={14} />
          </button>
        </div>

        {step === "choose" ? (
          <div className="p-5 grid grid-cols-2 gap-3">
            {SOURCE_TYPES.map((item) => (
              <button
                key={item.type}
                onClick={() => item.enabled && onSelect(item.type)}
                disabled={!item.enabled}
                className="text-left rounded-xl border border-[var(--border)] bg-white px-4 py-3 hover:border-[var(--primary-accent)] hover:bg-[var(--surface-low)] disabled:opacity-45 disabled:hover:border-[var(--border)] disabled:hover:bg-white cursor-pointer disabled:cursor-default transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-lg bg-[var(--surface-low)] text-[var(--on-surface-secondary)] flex items-center justify-center">
                    <SourceIcon type={item.type} size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-[var(--on-surface)]">{item.title}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--on-surface-secondary)]">{item.desc}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-5">
            {step === "local_folder" ? (
              <div className="rounded-xl border border-[var(--border)] bg-white p-4">
                <div className="flex items-start gap-3">
                  <span className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                    <IconFolder size={18} />
                  </span>
                  <div className="flex-1">
                    <h3 className="text-[14px] font-medium text-[var(--on-surface)]">{t("knowledge.folderLibrary")}</h3>
                    <p className="mt-1 text-[12px] leading-relaxed text-[var(--on-surface-secondary)]">{t("knowledge.folderLibraryDesc")}</p>
                    <button
                      onClick={onCreateFolder}
                      disabled={adding}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-[13px] hover:bg-[var(--primary-dark)] disabled:opacity-50 cursor-pointer"
                    >
                      {adding ? <IconSpinner size={14} /> : <IconFolder size={14} />}
                      {adding ? t("knowledge.adding") : t("knowledge.chooseFolder")}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--border)] bg-white p-4">
                <div className="flex items-center gap-3 text-[var(--on-surface-secondary)]">
                  <SourceIcon type={selectedType} size={18} />
                  <span className="text-[13px]">{t("coming_soon")}</span>
                </div>
              </div>
            )}
            <button onClick={onBack} disabled={adding} className="mt-4 text-[12px] text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)] disabled:opacity-40">
              {t("knowledge.backToTypes")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmRemoveSourceModal({
  source,
  removing,
  onCancel,
  onConfirm,
}: {
  source: Source;
  removing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/20 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-white shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-[15px] font-semibold text-[var(--on-surface)]">{t("knowledge.removeSource")}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--on-surface-secondary)]">
            {t("knowledge.confirmRemoveSource")}
          </p>
          <p className="mt-3 text-[12px] font-medium text-[var(--on-surface)] truncate">{source.name}</p>
          {source.path && (
            <p className="mt-1 text-[11px] text-[var(--on-surface-secondary)] truncate">{source.path}</p>
          )}
        </div>
        <div className="px-5 py-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={removing}
            className="px-4 py-2 rounded-lg border border-[var(--border)] bg-white text-[13px] text-[var(--on-surface)] hover:bg-[var(--surface-low)] disabled:opacity-50 cursor-pointer"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={removing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-[13px] hover:bg-red-700 disabled:opacity-50 cursor-pointer"
          >
            {removing && <IconSpinner size={13} />}
            {t("knowledge.removeSource")}
          </button>
        </div>
      </div>
    </div>
  );
}

function SourceCard({
  source,
  indexJob,
  onDelete,
  onReindex,
  onStatsChanged,
}: {
  source: Source;
  indexJob?: string;
  onDelete: (source: Source) => void;
  onReindex: (source: Source) => void;
  onStatsChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [docCount, setDocCount] = useState<number | null>(null);

  const refreshDocuments = useCallback(async () => {
    const [docs, cnt] = await Promise.all([listDocuments(source.id), countDocuments(source.id)]);
    setDocuments(docs);
    setDocCount(cnt);
  }, [source.id]);

  useEffect(() => {
    countDocuments(source.id).then(setDocCount);
  }, [source.id]);

  useEffect(() => {
    if (!expanded && !indexJob && source.status !== "indexing") return;
    refreshDocuments();
    if (!indexJob && source.status !== "indexing") return;
    const timer = window.setInterval(refreshDocuments, 1500);
    return () => window.clearInterval(timer);
  }, [expanded, indexJob, refreshDocuments, source.status]);

  async function handleExpand() {
    if (!expanded) await refreshDocuments();
    setExpanded(!expanded);
  }

  async function handleToggleExclude(doc: Document) {
    const newStatus = doc.status === "excluded" ? "indexed" : "excluded";
    await updateDocumentStatus(doc.id, newStatus);
    setDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, status: newStatus } : d)));
    onStatsChanged();
  }

  const indexing = Boolean(indexJob) || source.status === "indexing";

  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-white">
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <button onClick={handleExpand} className="w-10 h-10 rounded-xl bg-[var(--surface-low)] text-[var(--on-surface)] flex items-center justify-center shrink-0 cursor-pointer">
            <SourceIcon type={source.type} size={18} />
          </button>
          <button onClick={handleExpand} className="flex-1 min-w-0 text-left cursor-pointer">
            <p className="text-[13px] font-semibold truncate text-[var(--on-surface)]">{source.name}</p>
            <p className="mt-0.5 text-[11px] text-[var(--on-surface-secondary)] truncate">{source.path || source.connectorId || source.type}</p>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--on-surface-secondary)]">
              <span>{docCount !== null ? `${docCount} ${t("knowledge.files")}` : "..."}</span>
              <span>·</span>
              <span>{sourceTypeLabel(source.type)}</span>
            </div>
          </button>
        </div>

        {indexing && (
          <div className="mt-3 flex items-center gap-2 text-[11px] text-amber-700">
            <IconSpinner size={12} />
            <span className="truncate">{indexJob || t("knowledge.indexing")}</span>
          </div>
        )}
      </div>

      {expanded && (
        <div className="border-t border-[var(--border)] max-h-96 overflow-y-auto">
          <div className="sticky top-0 z-10 bg-white border-b border-[var(--border)] px-4 py-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onReindex(source)}
                disabled={!source.path || indexing}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[var(--primary)] text-white text-[12px] font-medium hover:bg-[var(--primary-dark)] cursor-pointer disabled:opacity-45 disabled:cursor-default"
              >
                {indexing ? <IconSpinner size={13} /> : <IconSearch size={13} />}
                {t("knowledge.reindex")}
              </button>
              <button
                onClick={() => onDelete(source)}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-red-100 bg-red-50 text-red-700 text-[12px] font-medium hover:bg-red-100 cursor-pointer"
              >
                <IconClose size={13} />
                {t("knowledge.removeSource")}
              </button>
            </div>
          </div>
          {documents.map((doc) => (
            <div
              key={doc.id}
              className={`px-4 py-2.5 text-[12px] border-b border-[var(--border)]/50 last:border-b-0 ${doc.status === "excluded" ? "opacity-40" : ""}`}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-[var(--on-surface-secondary)]"><FileIcon doc={doc} /></span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate font-medium text-[var(--on-surface)]">{doc.filename}</span>
                    {doc.errorMessage && <span className="text-amber-600"><IconWarning size={11} /></span>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--on-surface-secondary)]">
                    <span>{fileExtension(doc.filename) || t("knowledge.unknownType")}</span>
                    <span>{formatBytes(doc.size)}</span>
                    {doc.fileModifiedAt && <span>{t("knowledge.modified")} {formatDate(doc.fileModifiedAt)}</span>}
                    {relativeDocumentPath(source, doc) && (
                      <span className="max-w-full truncate">{relativeDocumentPath(source, doc)}</span>
                    )}
                  </div>
                  {doc.errorMessage && (
                    <p className="mt-1 text-[10px] text-amber-700 truncate">{doc.errorMessage}</p>
                  )}
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                  doc.status === "indexed" ? "bg-emerald-50 text-emerald-600"
                  : doc.status === "pending" ? "bg-amber-50 text-amber-600"
                  : doc.status === "error" ? "bg-red-50 text-red-600"
                  : "bg-gray-100 text-gray-500"
                }`}>
                  {doc.status}{doc.errorMessage ? " / meta" : ""}
                </span>
                <button
                  onClick={() => handleToggleExclude(doc)}
                  className="text-[11px] px-2 py-0.5 rounded-lg cursor-pointer hover:bg-[var(--surface-container)] transition-colors shrink-0"
                >
                  {doc.status === "excluded"
                    ? <span className="text-emerald-600">{t("knowledge.include")}</span>
                    : <span className="text-[var(--on-surface-tertiary)]">{t("knowledge.exclude")}</span>}
                </button>
              </div>
            </div>
          ))}
          {documents.length === 0 && (
            <p className="px-4 py-3 text-[12px] text-[var(--on-surface-secondary)]">{t("knowledge.noDocuments")}</p>
          )}
        </div>
      )}
    </div>
  );
}

function SourceIcon({ type, size }: { type: Source["type"]; size: number }) {
  if (type === "local_folder") return <IconFolder size={size} />;
  if (type === "upload") return <IconPackage size={size} />;
  if (type === "confluence" || type === "mcp" || type === "api") return <IconPuzzle size={size} />;
  if (type === "erp" || type === "database") return <IconServer size={size} />;
  if (type === "crm") return <IconChart size={size} />;
  if (type === "im") return <IconMail size={size} />;
  return <IconDocument size={size} />;
}

function FileIcon({ doc }: { doc: Document }) {
  const ext = fileExtension(doc.filename);
  if (ext === "xlsx" || ext === "xls" || ext === "csv") return <IconChart size={12} />;
  if (ext === "pptx" || ext === "ppt") return <IconReport size={12} />;
  return <IconDocument size={12} />;
}

function sourceTypeLabel(type: Source["type"]): string {
  return SOURCE_TYPES.find((item) => item.type === type)?.title || type;
}

function relativeDocumentPath(source: Source, doc: Document): string {
  if (!source.path || !doc.filePath) return "";
  const sourcePrefix = source.path.endsWith("/") ? source.path : `${source.path}/`;
  if (!doc.filePath.startsWith(sourcePrefix)) return "";
  const relative = doc.filePath.slice(sourcePrefix.length);
  const slash = relative.lastIndexOf("/");
  return slash <= 0 ? "" : relative.slice(0, slash);
}

function fileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx + 1).toLowerCase();
}

function formatBytes(size?: number | null): string {
  if (!size) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "";
  return new Date(timestamp * 1000).toLocaleDateString();
}
