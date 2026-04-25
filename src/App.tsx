import { useState, useEffect } from "react";
import { Sidebar } from "./components/layout/sidebar";
import { Home } from "./routes/home";
import { SettingsPage } from "./routes/settings";
import { KnowledgePage } from "./routes/knowledge";
import { AppsPage } from "./routes/apps";
import { initDb } from "./lib/db";
import { useAppStore } from "./stores/app-store";
import { useSessionStore } from "./stores/session-store";
import { mcpManager } from "./lib/mcp";
import { skillRegistry } from "./lib/ai/skill-registry";
import { t } from "./lib/i18n";
import { isDesktopRuntime } from "./lib/tauri";
import { WindowDragRegion } from "./components/layout/window-drag-region";
import { DocumentWorkspace } from "./components/document/document-workspace";

type Page = "home" | "apps" | "knowledge" | "channels" | "settings";

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("home");
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const loadAppState = useAppStore((s) => s.load);
  const refreshMcp = useAppStore((s) => s.refreshMcp);
  const initSession = useSessionStore((s) => s.initialize);
  const sessionReady = useSessionStore((s) => s.initialized);

  useEffect(() => {
    if (!isDesktopRuntime()) {
      setDbError("Cowork 需要在桌面应用中运行。请使用 `pnpm electron:dev` 或 `pnpm tauri dev` 启动；直接在浏览器打开 Vite 地址无法访问本地数据库、文件系统和系统工具。");
      return;
    }

    initDb()
      .then(async () => {
        setDbReady(true);
        await loadAppState();
        await initSession();
        // Initialize skill registry (filesystem scan)
        skillRegistry.initialize().catch((err) => console.error("Skills init:", err));
        // Subscribe to MCP state changes for reactive UI updates
        mcpManager.onChange(() => refreshMcp());
        // Connect MCP servers (non-blocking)
        mcpManager.initialize().catch((err) => console.error("MCP init:", err));
      })
      .catch((err) => setDbError(String(err)));
  }, [loadAppState, initSession]);

  if (dbError) {
    return (
      <div className="flex items-center justify-center h-screen p-8 text-center">
        <div>
          <p className="text-[14px] font-semibold mb-2 text-[var(--error)]">{t("db.error")}</p>
          <p className="text-[12px] text-[var(--on-surface-tertiary)]">{dbError}</p>
        </div>
      </div>
    );
  }

  if (!dbReady || !sessionReady) {
    return (
      <div className="flex items-center justify-center h-screen text-[13px] text-[var(--on-surface-tertiary)]">
        {t("starting")}
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[var(--surface)]">
      <WindowDragRegion className="fixed top-0 left-0 right-0 h-7 z-50" />
      <DocumentWorkspace />
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <main className="flex-1 overflow-hidden relative">
        {currentPage === "home" && <Home />}
        {currentPage === "apps" && <AppsPage />}
        {currentPage === "knowledge" && <KnowledgePage />}
        {currentPage === "channels" && <Placeholder title={t("nav.channels")} />}
        {currentPage === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-full text-[13px] text-[var(--on-surface-tertiary)]">
      {title} — {t("coming_soon")}
    </div>
  );
}

export default App;
