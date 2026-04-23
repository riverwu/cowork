import { useState, useEffect } from "react";
import { Sidebar } from "./components/layout/sidebar";
import { Home } from "./routes/home";
import { SettingsPage } from "./routes/settings";
import { KnowledgePage } from "./routes/knowledge";
import { initDb } from "./lib/db";
import { useAppStore } from "./stores/app-store";
import { t } from "./lib/i18n";

type Page = "home" | "knowledge" | "channels" | "explore" | "activity" | "settings";

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("home");
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const loadAppState = useAppStore((s) => s.load);

  useEffect(() => {
    initDb()
      .then(() => {
        setDbReady(true);
        return loadAppState();
      })
      .catch((err) => setDbError(String(err)));
  }, [loadAppState]);

  if (dbError) {
    return (
      <div className="flex items-center justify-center h-screen p-8 text-center">
        <div>
          <p className="text-[15px] font-semibold mb-2 text-[var(--error)]">{t("db.error")}</p>
          <p className="text-[12px] text-[var(--outline)]">{dbError}</p>
        </div>
      </div>
    );
  }

  if (!dbReady) {
    return (
      <div className="flex items-center justify-center h-screen text-[13px] text-[var(--outline)]">
        {t("starting")}
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[var(--surface)]">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <main className="flex-1 overflow-hidden">
        {currentPage === "home" && <Home />}
        {currentPage === "knowledge" && <KnowledgePage />}
        {currentPage === "channels" && <PlaceholderPage title={t("nav.channels")} />}
        {currentPage === "explore" && <PlaceholderPage title="Explore" />}
        {currentPage === "activity" && <PlaceholderPage title={t("nav.activity")} />}
        {currentPage === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-full text-[13px] text-[var(--outline)]">
      {title} — {t("coming_soon")}
    </div>
  );
}

export default App;
