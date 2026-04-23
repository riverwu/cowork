type Page = "home" | "knowledge" | "channels" | "explore" | "activity" | "settings";

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

const navItems: { id: Page; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "🏠" },
  { id: "knowledge", label: "Knowledge", icon: "🧠" },
  { id: "channels", label: "Channels", icon: "🔗" },
  { id: "explore", label: "Explore", icon: "🔍" },
  { id: "activity", label: "Activity", icon: "📊" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="w-52 flex flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      <div
        className="h-12 flex items-center px-4 font-semibold text-lg tracking-tight border-b border-[var(--color-border)]"
        data-tauri-drag-region
      >
        Cowork
      </div>
      <nav className="flex-1 py-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors cursor-pointer ${
              currentPage === item.id
                ? "bg-[var(--color-bg-tertiary)] text-[var(--color-text)]"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text)]"
            }`}
          >
            <span className="text-base">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
