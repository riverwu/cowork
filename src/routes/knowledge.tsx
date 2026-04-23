import { useEffect, useState, useCallback } from "react";
import {
  IconFolder, IconDocument, IconReport, IconPlus,
  IconClose, IconSearch, IconSpinner,
} from "@/components/icons";
import { useAppStore } from "@/stores/app-store";
import {
  listDocuments, countDocuments, updateDocumentStatus,
  listRecentArtifacts, deleteSource, getKnowledgeStats,
  type KnowledgeStats,
} from "@/lib/db";
import { indexSource } from "@/lib/knowledge";
import { retrieveRelevant } from "@/lib/knowledge";
import { pickFolder, scanDirectory } from "@/lib/tauri";
import { createSource } from "@/lib/db";
import { t } from "@/lib/i18n";
import type { Source, Document, Artifact } from "@/types";

export function KnowledgePage() {
  const { sources, refreshSources } = useAppStore();
  const [recentArtifacts, setRecentArtifacts] = useState<Artifact[]>([]);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [adding, setAdding] = useState(false);
  const [addProgress, setAddProgress] = useState("");

  // Search test
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ content: string; score: number; filename: string }> | null>(null);
  const [searching, setSearching] = useState(false);

  const loadStats = useCallback(async () => {
    const [s, a] = await Promise.all([getKnowledgeStats(), listRecentArtifacts(10)]);
    setStats(s);
    setRecentArtifacts(a);
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  async function handleAddFolder() {
    const path = await pickFolder();
    if (!path) return;
    setAdding(true);
    setAddProgress(t("knowledge.scanning"));
    try {
      const files = await scanDirectory(path);
      if (files.length === 0) {
        setAddProgress(t("knowledge.noFiles"));
        setTimeout(() => { setAdding(false); setAddProgress(""); }, 2000);
        return;
      }
      const folderName = path.split("/").pop() || path;
      const source = await createSource({ type: "local_folder", path, name: folderName });
      await indexSource(source.id, files, (current, total, filename) => {
        setAddProgress(`${current}/${total}: ${filename}`);
      });
      await refreshSources();
      await loadStats();
    } catch (err) {
      console.error("Failed to add folder:", err);
    }
    setAdding(false);
    setAddProgress("");
  }

  async function handleDeleteSource(id: string) {
    await deleteSource(id);
    await refreshSources();
    await loadStats();
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
      <div className="max-w-4xl mx-auto py-8 px-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-[18px] font-bold text-[var(--on-surface)]">{t("knowledge.title")}</h1>
          <button
            onClick={handleAddFolder}
            disabled={adding}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] text-white text-[13px] font-medium cursor-pointer transition-colors disabled:opacity-50"
          >
            {adding ? <IconSpinner size={14} /> : <IconPlus size={14} />}
            {adding ? addProgress || t("knowledge.adding") : t("knowledge.addFolder")}
          </button>
        </div>

        {/* Stats overview */}
        {stats && stats.totalDocuments > 0 && (
          <div className="grid grid-cols-4 gap-3 mb-6">
            <StatCard label={t("knowledge.sources")} value={stats.totalSources} />
            <StatCard label={t("knowledge.indexed")} value={stats.indexedDocuments} sub={`/ ${stats.totalDocuments}`} />
            <StatCard label={t("knowledge.chunks")} value={stats.totalChunks} />
            <StatCard label={t("knowledge.embedded")} value={stats.chunksWithEmbeddings} sub={stats.totalChunks > 0 ? `(${Math.round(stats.chunksWithEmbeddings / stats.totalChunks * 100)}%)` : ""} />
          </div>
        )}

        {/* Sources */}
        <section className="mb-8">
          <h2 className="text-[14px] font-semibold text-[var(--on-surface)] mb-3">{t("knowledge.myDocs")}</h2>
          {sources.length === 0 ? (
            <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] p-8 text-center">
              <p className="text-[13px] text-[var(--on-surface-tertiary)] mb-1">{t("knowledge.noSources")}</p>
              <p className="text-[12px] text-[var(--on-surface-tertiary)]">{t("knowledge.addHint")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sources.map((source) => (
                <SourceCard key={source.id} source={source} onDelete={handleDeleteSource} onReindex={loadStats} />
              ))}
            </div>
          )}
        </section>

        {/* Search test */}
        <section className="mb-8">
          <h2 className="text-[14px] font-semibold text-[var(--on-surface)] mb-3">{t("knowledge.searchTest")}</h2>
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
                className="w-full pl-9 pr-3 py-2 bg-[var(--surface-lowest)] border border-[var(--border)] rounded-lg text-[13px] text-[var(--on-surface)] placeholder:text-[var(--on-surface-tertiary)] focus:outline-none focus:border-[var(--primary-accent)]"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={!searchQuery.trim() || searching}
              className="px-4 py-2 rounded-lg text-[13px] bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] cursor-pointer disabled:opacity-40"
            >
              {searching ? "..." : t("knowledge.search")}
            </button>
          </div>
          {searchResults !== null && (
            <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] overflow-hidden">
              {searchResults.length === 0 ? (
                <p className="px-4 py-3 text-[13px] text-[var(--on-surface-tertiary)]">{t("knowledge.noResults")}</p>
              ) : (
                searchResults.map((r, i) => (
                  <div key={i} className={`px-4 py-3 ${i < searchResults.length - 1 ? "border-b border-[var(--border)]" : ""}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <IconDocument size={12} />
                      <span className="text-[12px] font-medium text-[var(--on-surface)]">{r.filename}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600">{(r.score * 100).toFixed(0)}%</span>
                    </div>
                    <p className="text-[12px] text-[var(--on-surface-secondary)] leading-relaxed">{r.content}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        {/* Recent outputs */}
        {recentArtifacts.length > 0 && (
          <section>
            <h2 className="text-[14px] font-semibold text-[var(--on-surface)] mb-3">{t("knowledge.outputs")}</h2>
            <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]">
              {recentArtifacts.map((artifact) => (
                <div key={artifact.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-[var(--on-surface-tertiary)]">
                    {artifact.type === "report" ? <IconReport size={14} /> : <IconDocument size={14} />}
                  </span>
                  <span className="flex-1 truncate text-[13px] text-[var(--on-surface)]">{artifact.title}</span>
                  <span className="text-[11px] text-[var(--on-surface-tertiary)]">{formatDate(artifact.createdAt)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] px-4 py-3 text-center">
      <div className="text-[20px] font-bold text-[var(--on-surface)]">
        {value}{sub && <span className="text-[12px] font-normal text-[var(--on-surface-tertiary)] ml-0.5">{sub}</span>}
      </div>
      <div className="text-[11px] text-[var(--on-surface-tertiary)]">{label}</div>
    </div>
  );
}

function SourceCard({ source, onDelete, onReindex }: { source: Source; onDelete: (id: string) => void; onReindex: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [docCount, setDocCount] = useState<number | null>(null);
  const [reindexing, setReindexing] = useState(false);

  useEffect(() => {
    countDocuments(source.id).then(setDocCount);
  }, [source.id]);

  async function handleExpand() {
    if (!expanded) {
      const docs = await listDocuments(source.id);
      setDocuments(docs);
    }
    setExpanded(!expanded);
  }

  async function handleToggleExclude(doc: Document) {
    const newStatus = doc.status === "excluded" ? "indexed" : "excluded";
    await updateDocumentStatus(doc.id, newStatus);
    setDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, status: newStatus } : d)));
  }

  async function handleReindex() {
    setReindexing(true);
    try {
      const files = await scanDirectory(source.path || "");
      await indexSource(source.id, files);
      const docs = await listDocuments(source.id);
      setDocuments(docs);
      const cnt = await countDocuments(source.id);
      setDocCount(cnt);
      onReindex();
    } catch (err) {
      console.error("Reindex failed:", err);
    }
    setReindexing(false);
  }

  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--surface-lowest)]">
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={handleExpand} className="flex-1 flex items-center gap-3 text-left hover:opacity-80 cursor-pointer transition-opacity min-w-0">
          <span className="text-[var(--on-surface-secondary)]"><IconFolder size={16} /></span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium truncate text-[var(--on-surface)]">{source.name}</p>
            <p className="text-[11px] text-[var(--on-surface-tertiary)] truncate">{source.path}</p>
          </div>
        </button>
        <span className="text-[11px] text-[var(--on-surface-tertiary)]">
          {docCount !== null ? `${docCount} ${t("knowledge.files")}` : "..."}
        </span>
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${
          source.status === "active" ? "bg-emerald-50 text-emerald-700"
          : source.status === "indexing" ? "bg-amber-50 text-amber-700"
          : "bg-red-50 text-red-700"
        }`}>
          {source.status}
        </span>
        <button
          onClick={handleReindex}
          disabled={reindexing}
          className="p-1.5 rounded-lg text-[var(--on-surface-tertiary)] hover:text-[var(--primary-accent)] hover:bg-[var(--surface-low)] cursor-pointer transition-colors disabled:opacity-40"
          title={t("knowledge.reindex")}
        >
          {reindexing ? <IconSpinner size={13} /> : <IconSearch size={13} />}
        </button>
        <button
          onClick={() => onDelete(source.id)}
          className="p-1.5 rounded-lg text-[var(--on-surface-tertiary)] hover:text-[var(--error)] hover:bg-red-50 cursor-pointer transition-colors"
          title={t("knowledge.removeSource")}
        >
          <IconClose size={13} />
        </button>
        <button onClick={handleExpand} className="text-[var(--on-surface-tertiary)] text-[11px] cursor-pointer">
          {expanded ? "▲" : "▼"}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-[var(--border)] max-h-80 overflow-y-auto">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className={`flex items-center gap-3 px-4 py-2 text-[12px] border-b border-[var(--border)]/50 last:border-b-0 ${doc.status === "excluded" ? "opacity-40" : ""}`}
            >
              <span className="text-[var(--on-surface-tertiary)]"><IconDocument size={12} /></span>
              <span className="flex-1 truncate text-[var(--on-surface-secondary)]">{doc.filename}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                doc.status === "indexed" ? "bg-emerald-50 text-emerald-600"
                : doc.status === "pending" ? "bg-amber-50 text-amber-600"
                : "bg-gray-100 text-gray-500"
              }`}>
                {doc.status}
              </span>
              <span className="text-[10px] text-[var(--on-surface-tertiary)]">
                {doc.fileModifiedAt ? formatDate(doc.fileModifiedAt) : ""}
              </span>
              <button
                onClick={() => handleToggleExclude(doc)}
                className="text-[11px] px-2 py-0.5 rounded-lg cursor-pointer hover:bg-[var(--surface-container)] transition-colors"
              >
                {doc.status === "excluded"
                  ? <span className="text-emerald-600">{t("knowledge.include")}</span>
                  : <span className="text-[var(--on-surface-tertiary)]">{t("knowledge.exclude")}</span>}
              </button>
            </div>
          ))}
          {documents.length === 0 && (
            <p className="px-4 py-3 text-[12px] text-[var(--on-surface-tertiary)]">No documents.</p>
          )}
        </div>
      )}
    </div>
  );
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "";
  return new Date(timestamp * 1000).toLocaleDateString();
}
