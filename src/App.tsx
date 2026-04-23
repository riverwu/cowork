import { useState, useEffect } from "react";
import { Sidebar } from "./components/layout/sidebar";
import { Home } from "./routes/home";
import { SettingsPage } from "./routes/settings";
import { KnowledgePage } from "./routes/knowledge";
import { initDb } from "./lib/db";
import { useAppStore } from "./stores/app-store";

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
      <div className="flex items-center justify-center h-screen text-red-400 p-8 text-center">
        <div>
          <p className="text-lg font-semibold mb-2">Failed to initialize database</p>
          <p className="text-sm text-[var(--color-text-tertiary)]">{dbError}</p>
        </div>
      </div>
    );
  }

  if (!dbReady) {
    return (
      <div className="flex items-center justify-center h-screen text-[var(--color-text-tertiary)]">
        Starting...
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <main className="flex-1 overflow-hidden">
        {currentPage === "home" && <Home />}
        {currentPage === "knowledge" && <KnowledgePage />}
        {currentPage === "channels" && <PlaceholderPage title="Channels" />}
        {currentPage === "explore" && <PlaceholderPage title="Explore" />}
        {currentPage === "activity" && <PlaceholderPage title="Activity" />}
        {currentPage === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-full text-[var(--color-text-tertiary)]">
      {title} — coming soon
    </div>
  );
}

export default App;
