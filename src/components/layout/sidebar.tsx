type Page = "home" | "knowledge" | "channels" | "explore" | "activity" | "settings";

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

const navItems: { id: Page; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "🏠" },
  { id: "knowledge", label: "Knowledge", icon: "📚" },
  { id: "channels", label: "Channels", icon: "🔗" },
  { id: "activity", label: "Activity", icon: "📊" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="w-[220px] flex flex-col bg-[var(--primary)] text-white shrink-0">
      {/* Logo */}
      <div
        className="h-14 flex items-center gap-2.5 px-5"
        data-tauri-drag-region
      >
        <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center text-sm font-bold">
          C
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">Cowork</div>
          <div className="text-[10px] opacity-60 leading-tight">AI Workspace</div>
        </div>
      </div>

      {/* New workspace button */}
      <div className="px-3 mb-2">
        <button
          onClick={() => onNavigate("home")}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm cursor-pointer transition-colors"
        >
          <span className="text-xs">＋</span>
          New Session
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-1 space-y-0.5">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
              currentPage === item.id
                ? "bg-white/20 text-white"
                : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span className="text-base w-5 text-center">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
