import { useState } from "react";
import { Sidebar } from "./components/layout/sidebar";
import { Home } from "./routes/home";

type Page = "home" | "knowledge" | "channels" | "explore" | "activity" | "settings";

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("home");

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <main className="flex-1 overflow-hidden">
        {currentPage === "home" && <Home />}
        {currentPage === "knowledge" && <PlaceholderPage title="Knowledge" />}
        {currentPage === "channels" && <PlaceholderPage title="Channels" />}
        {currentPage === "explore" && <PlaceholderPage title="Explore" />}
        {currentPage === "activity" && <PlaceholderPage title="Activity" />}
        {currentPage === "settings" && <PlaceholderPage title="Settings" />}
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
