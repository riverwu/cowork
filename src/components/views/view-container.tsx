import { useViewStore } from "@/stores/view-store";
import { ReportView } from "./report-view";
import { DataTableView } from "./data-table-view";

export function ViewContainer() {
  const { panels, removePanel, togglePin, toggleFullscreen } = useViewStore();

  if (panels.length === 0) return null;

  // If any panel is fullscreen, show only that one
  const fullscreenPanel = panels.find((p) => p.fullscreen);
  if (fullscreenPanel) {
    return (
      <div className="fixed inset-0 z-50 bg-[var(--color-bg)] p-4">
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
    <div className="w-[45%] min-w-[350px] border-l border-[var(--color-border)] flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
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
    <div className={`flex flex-col border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-bg-secondary)] ${panel.fullscreen ? "h-full" : ""}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)]">
        <span className="text-xs">📄</span>
        <span className="text-sm font-medium flex-1 truncate">{panel.artifact.title}</span>
        <button
          onClick={onTogglePin}
          className={`p-1 rounded text-xs cursor-pointer transition-colors ${panel.pinned ? "text-[var(--color-accent)]" : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text)]"}`}
          title={panel.pinned ? "Unpin" : "Pin"}
        >
          📌
        </button>
        <button
          onClick={onToggleFullscreen}
          className="p-1 rounded text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] cursor-pointer transition-colors"
          title={panel.fullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {panel.fullscreen ? "⊡" : "⊞"}
        </button>
        <button
          onClick={onClose}
          className="p-1 rounded text-xs text-[var(--color-text-tertiary)] hover:text-red-400 cursor-pointer transition-colors"
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className={`overflow-y-auto ${panel.fullscreen ? "flex-1" : "max-h-[500px]"}`}>
        {panel.artifact.type === "report" ? (
          <ReportView content={panel.artifact.content} />
        ) : panel.artifact.type === "table" ? (
          <DataTableView content={panel.artifact.content} />
        ) : (
          <div className="p-3 text-sm whitespace-pre-wrap text-[var(--color-text-secondary)]">
            {panel.artifact.content}
          </div>
        )}
      </div>
    </div>
  );
}
