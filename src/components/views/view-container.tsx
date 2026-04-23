import { useViewStore } from "@/stores/view-store";
import { ReportView } from "./report-view";
import { DataTableView } from "./data-table-view";
import { IconDocument, IconPin, IconExpand, IconClose } from "@/components/icons";

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
    <div className="overflow-y-auto p-3 space-y-3">
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
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--surface-low)]">
        <span className="text-[var(--on-surface-secondary)]"><IconDocument size={13} /></span>
        <span className="text-[12px] font-medium flex-1 truncate text-[var(--on-surface)]">{panel.artifact.title}</span>
        <button onClick={onTogglePin} className={`p-1 rounded cursor-pointer ${panel.pinned ? "text-[var(--primary-accent)]" : "text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)]"}`}><IconPin size={11} /></button>
        <button onClick={onToggleFullscreen} className="p-1 rounded text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)] cursor-pointer"><IconExpand size={11} /></button>
        <button onClick={onClose} className="p-1 rounded text-[var(--on-surface-tertiary)] hover:text-[var(--error)] cursor-pointer"><IconClose size={11} /></button>
      </div>
      <div className={`overflow-y-auto ${panel.fullscreen ? "flex-1" : "max-h-[400px]"}`}>
        {panel.artifact.type === "report" ? (
          <ReportView content={panel.artifact.content} />
        ) : panel.artifact.type === "table" ? (
          <DataTableView content={panel.artifact.content} />
        ) : (
          <div className="p-3 text-[13px] whitespace-pre-wrap text-[var(--on-surface-secondary)]">{panel.artifact.content}</div>
        )}
      </div>
    </div>
  );
}
