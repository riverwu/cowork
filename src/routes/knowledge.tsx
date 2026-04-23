import { useEffect, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { listDocuments, countDocuments, updateDocumentStatus, listRecentArtifacts } from "@/lib/db";
import { indexSource } from "@/lib/knowledge";
import { pickFolder, scanDirectory } from "@/lib/tauri";
import { createSource } from "@/lib/db";
import type { Source, Document, Artifact } from "@/types";

export function KnowledgePage() {
  const { sources, refreshSources } = useAppStore();
  const [recentArtifacts, setRecentArtifacts] = useState<Artifact[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    listRecentArtifacts(10).then(setRecentArtifacts);
  }, []);

  async function handleAddFolder() {
    const path = await pickFolder();
    if (!path) return;

    setAdding(true);
    try {
      const files = await scanDirectory(path);
      const folderName = path.split("/").pop() || path;
      const source = await createSource({ type: "local_folder", path, name: folderName });
      await indexSource(source.id, files);
      await refreshSources();
    } catch (err) {
      console.error("Failed to add folder:", err);
    }
    setAdding(false);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto py-8 px-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold">Knowledge</h1>
          <button
            onClick={handleAddFolder}
            disabled={adding}
            className="px-4 py-2 text-sm bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white rounded cursor-pointer transition-colors disabled:opacity-50"
          >
            {adding ? "Adding..." : "+ Add Folder"}
          </button>
        </div>

        {/* Sources */}
        {sources.length === 0 ? (
          <div className="text-center py-12 text-[var(--color-text-tertiary)]">
            <p className="mb-2">No knowledge sources yet.</p>
            <p className="text-sm">Add a work folder to get started.</p>
          </div>
        ) : (
          <section className="mb-8">
            <h2 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">My Documents</h2>
            <div className="space-y-2">
              {sources.map((source) => (
                <SourceCard key={source.id} source={source} />
              ))}
            </div>
          </section>
        )}

        {/* Cowork outputs */}
        {recentArtifacts.length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">
              Cowork Outputs
            </h2>
            <div className="space-y-1">
              {recentArtifacts.map((artifact) => (
                <div
                  key={artifact.id}
                  className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--color-bg-secondary)] text-sm"
                >
                  <span className="text-[var(--color-text-tertiary)]">
                    {artifact.type === "report" ? "📊" : "📄"}
                  </span>
                  <span className="flex-1 truncate">{artifact.title}</span>
                  <span className="text-xs text-[var(--color-text-tertiary)]">
                    {formatDate(artifact.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function SourceCard({ source }: { source: Source }) {
  const [expanded, setExpanded] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [docCount, setDocCount] = useState<number | null>(null);

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
    setDocuments((prev) =>
      prev.map((d) => (d.id === doc.id ? { ...d, status: newStatus } : d)),
    );
  }

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button
        onClick={handleExpand}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-bg-secondary)] cursor-pointer transition-colors"
      >
        <span>📁</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{source.name}</p>
          <p className="text-xs text-[var(--color-text-tertiary)] truncate">{source.path}</p>
        </div>
        <span className="text-xs text-[var(--color-text-tertiary)]">
          {docCount !== null ? `${docCount} files` : "..."}
        </span>
        <span
          className={`text-xs px-1.5 py-0.5 rounded ${
            source.status === "active"
              ? "bg-green-500/10 text-green-400"
              : source.status === "indexing"
                ? "bg-yellow-500/10 text-yellow-400"
                : "bg-red-500/10 text-red-400"
          }`}
        >
          {source.status}
        </span>
        <span className="text-[var(--color-text-tertiary)] text-xs">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--color-border)] max-h-80 overflow-y-auto">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className={`flex items-center gap-3 px-4 py-2 text-sm border-b border-[var(--color-border)] last:border-b-0 ${
                doc.status === "excluded" ? "opacity-40" : ""
              }`}
            >
              <span className="text-[var(--color-text-tertiary)]">📄</span>
              <span className="flex-1 truncate">{doc.filename}</span>
              <span className="text-xs text-[var(--color-text-tertiary)]">
                {doc.fileModifiedAt ? formatDate(doc.fileModifiedAt) : ""}
              </span>
              <button
                onClick={() => handleToggleExclude(doc)}
                className="text-xs px-2 py-0.5 rounded cursor-pointer transition-colors hover:bg-[var(--color-bg-tertiary)]"
              >
                {doc.status === "excluded" ? (
                  <span className="text-green-400">Include</span>
                ) : (
                  <span className="text-[var(--color-text-tertiary)]">Exclude</span>
                )}
              </button>
            </div>
          ))}
          {documents.length === 0 && (
            <p className="px-4 py-3 text-sm text-[var(--color-text-tertiary)]">No documents.</p>
          )}
        </div>
      )}
    </div>
  );
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString();
}
