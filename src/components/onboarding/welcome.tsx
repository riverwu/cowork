import { useState } from "react";
import { FileTypeIcon } from "@/components/icons";
import { pickFolder, scanDirectory } from "@/lib/tauri";
import { createSource } from "@/lib/db";
import { indexSource } from "@/lib/knowledge";
import { useAppStore } from "@/stores/app-store";
import type { FileInfo } from "@/types";

export function Welcome() {
  const [status, setStatus] = useState<"idle" | "scanning" | "indexing" | "done">("idle");
  const [scannedFiles, setScannedFiles] = useState<FileInfo[]>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refreshSources = useAppStore((s) => s.refreshSources);

  async function handlePickFolder() {
    setError(null);
    const path = await pickFolder();
    if (!path) return;

    setStatus("scanning");
    setProgress("Scanning files...");

    try {
      const files = await scanDirectory(path);
      setScannedFiles(files);

      if (files.length === 0) {
        setError("No supported documents found in this folder.");
        setStatus("idle");
        return;
      }

      setProgress(`Found ${files.length} files. Indexing...`);
      setStatus("indexing");

      const folderName = path.split("/").pop() || path;
      const source = await createSource({ type: "local_folder", path, name: folderName });

      await indexSource(source.id, files, (current, total, filename) => {
        setProgress(`Indexing ${current}/${total}: ${filename}`);
      });

      setStatus("done");
      setProgress(`Done! ${files.length} files indexed.`);
      await refreshSources();
    } catch (err) {
      setError(String(err));
      setStatus("idle");
    }
  }

  if (status === "done") {
    const recentFiles = scannedFiles.slice(0, 5);
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <div className="max-w-lg w-full text-center">
          <p className="text-lg font-semibold mb-2 text-[var(--on-surface)]">Knowledge base ready</p>
          <p className="text-[var(--on-surface-secondary)] text-sm mb-6">
            {scannedFiles.length} files indexed. Here's what I found:
          </p>
          <div className="text-left mb-6 space-y-1">
            {recentFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm py-2 px-3 rounded-lg bg-[var(--surface-lowest)] border border-[var(--border)]">
                <FileTypeIcon filename={f.name} size={24} />
                <span className="flex-1 truncate text-[var(--on-surface)]">{f.name}</span>
                <span className="text-xs text-[var(--on-surface-tertiary)]">{formatDate(f.modified_at)}</span>
              </div>
            ))}
            {scannedFiles.length > 5 && (
              <p className="text-xs text-[var(--on-surface-tertiary)] pl-3">
                and {scannedFiles.length - 5} more...
              </p>
            )}
          </div>
          <p className="text-[var(--on-surface-secondary)] text-sm">
            Now tell me what you want to do. I'll use these documents as context.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8">
      <div className="max-w-md w-full text-center">
        <h1 className="text-2xl font-semibold mb-2 text-[var(--on-surface)]">Welcome to Cowork</h1>
        <p className="text-[var(--on-surface-secondary)] text-sm mb-8 leading-relaxed">
          Point me to your work folder, and I'll understand what you're working on.
          Then I can help you get things done.
        </p>

        <button
          onClick={handlePickFolder}
          disabled={status !== "idle"}
          className="px-6 py-3 bg-[var(--primary-light)] hover:bg-[var(--primary)] text-white rounded-xl text-sm font-medium cursor-pointer transition-colors disabled:opacity-50 mb-4"
        >
          {status === "idle" ? "Choose Work Folder" : "Working..."}
        </button>

        {progress && (
          <p className="text-sm text-[var(--on-surface-tertiary)] mt-2">{progress}</p>
        )}

        {error && (
          <p className="text-sm text-[var(--error)] mt-2">{error}</p>
        )}

        <p className="text-xs text-[var(--on-surface-tertiary)] mt-6">
          You can also skip this and start using Cowork directly.
          <br />
          Go to Settings to configure your AI provider first.
        </p>
      </div>
    </div>
  );
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}
