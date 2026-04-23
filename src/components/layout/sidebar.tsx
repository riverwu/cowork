import { t } from "@/lib/i18n";

type Page = "home" | "knowledge" | "channels" | "explore" | "activity" | "settings";

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

const navItems: { id: Page; label: string; icon: string }[] = [
  { id: "home", label: "nav.home", icon: "🏠" },
  { id: "knowledge", label: "nav.knowledge", icon: "📚" },
  { id: "channels", label: "nav.channels", icon: "🔗" },
  { id: "activity", label: "nav.activity", icon: "📊" },
  { id: "settings", label: "nav.settings", icon: "⚙️" },
];

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="w-[220px] flex flex-col bg-[var(--primary)] text-white shrink-0">
      {/* Logo */}
      <div className="h-14 flex items-center gap-2.5 px-5" data-tauri-drag-region>
        <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center text-[13px] font-bold">
          C
        </div>
        <div>
          <div className="text-[13px] font-semibold leading-tight">Cowork</div>
          <div className="text-[10px] opacity-50 leading-tight">AI Workspace</div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-2 space-y-0.5">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] transition-colors cursor-pointer ${
              currentPage === item.id
                ? "bg-white/20 text-white"
                : "text-white/65 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span className="text-[14px] w-5 text-center">{item.icon}</span>
            {t(item.label)}
          </button>
        ))}
      </nav>
    </aside>
  );
}
