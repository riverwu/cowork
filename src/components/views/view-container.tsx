import { useViewStore } from "@/stores/view-store";
import { ReportView } from "./report-view";
import { DataTableView } from "./data-table-view";

export function ViewContainer() {
  const { panels, removePanel, togglePin, toggleFullscreen } = useViewStore();

  if (panels.length === 0) return null;

  const fullscreenPanel = panels.find((p) => p.fullscreen);
  if (fullscreenPanel) {
    return (
      <div className="fixed inset-0 z-50 bg-[var(--surface)] p-6">
        <ViewPanel
          panel={fullscreenPanel}
          onClose={() => removePanel(fullscreenPanel.id)}
          onTogglePin={() => togglePin(fullscreenPanel.id)}
          onToggleFullscreen={() => toggleFullscreen(fullscreenPanel.id)}
        />
      </div>
    );
  }

  return (
    <div className="w-[45%] min-w-[350px] border-l border-[var(--border)] bg-[var(--surface-low)] flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {panels.map((panel) => (
          <ViewPanel
            key={panel.id}
            panel={panel}
            onClose={() => removePanel(panel.id)}
            onTogglePin={() => togglePin(panel.id)}
            onToggleFullscreen={() => toggleFullscreen(panel.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ViewPanel({
  panel,
  onClose,
  onTogglePin,
  onToggleFullscreen,
}: {
  panel: { id: string; artifact: { type: string; title: string; content: string }; pinned: boolean; fullscreen: boolean };
  onClose: () => void;
  onTogglePin: () => void;
  onToggleFullscreen: () => void;
}) {
  return (
    <div className={`flex flex-col bg-[var(--surface-lowest)] border border-[var(--border)] rounded-xl overflow-hidden shadow-[var(--shadow-sm)] ${panel.fullscreen ? "h-full" : ""}`}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-low)]">
        <span className="text-[13px]">📄</span>
        <span className="text-[13px] font-medium flex-1 truncate text-[var(--on-surface)]">{panel.artifact.title}</span>
        <button onClick={onTogglePin} className={`p-1 rounded text-[11px] cursor-pointer ${panel.pinned ? "text-[var(--primary-accent)]" : "text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)]"}`}>📌</button>
        <button onClick={onToggleFullscreen} className="p-1 rounded text-[11px] text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)] cursor-pointer">{panel.fullscreen ? "⊡" : "⊞"}</button>
        <button onClick={onClose} className="p-1 rounded text-[11px] text-[var(--on-surface-tertiary)] hover:text-[var(--error)] cursor-pointer">✕</button>
      </div>
      <div className={`overflow-y-auto ${panel.fullscreen ? "flex-1" : "max-h-[500px]"}`}>
        {panel.artifact.type === "report" ? (
          <ReportView content={panel.artifact.content} />
        ) : panel.artifact.type === "table" ? (
          <DataTableView content={panel.artifact.content} />
        ) : (
          <div className="p-4 text-[13px] whitespace-pre-wrap text-[var(--on-surface-secondary)]">{panel.artifact.content}</div>
        )}
      </div>
    </div>
  );
}
