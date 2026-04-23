import { t } from "@/lib/i18n";
import { IconHome, IconPackage, IconBook, IconChannel, IconSettings } from "@/components/icons";

type Page = "home" | "apps" | "knowledge" | "channels" | "settings";

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

const navItems: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: "home", label: "nav.home", icon: <IconHome /> },
  { id: "apps", label: "nav.apps", icon: <IconPackage /> },
  { id: "knowledge", label: "nav.knowledge", icon: <IconBook /> },
  { id: "channels", label: "nav.channels", icon: <IconChannel /> },
  { id: "settings", label: "nav.settings", icon: <IconSettings /> },
];

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="w-[232px] flex flex-col bg-slate-50 border-r border-[var(--border)] shrink-0">
      {/* Traffic light area — drag region, space for macOS window controls */}
      <div className="h-[52px] shrink-0" data-tauri-drag-region />

      {/* Logo */}
      <div className="px-5 pb-4" data-tauri-drag-region>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[var(--primary)] text-white flex items-center justify-center text-[11px] font-bold tracking-wide">
            CW
          </div>
          <div>
            <div className="text-[14px] font-semibold leading-tight tracking-tight text-slate-900">Cowork</div>
            <div className="text-[10px] text-slate-400 leading-tight">AI Workspace</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-1 space-y-[2px]">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-[9px] rounded-lg text-[14px] transition-colors cursor-pointer ${
              currentPage === item.id
                ? "bg-blue-50 text-blue-700 font-semibold"
                : "text-slate-600 font-medium hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <span className="w-5 flex items-center justify-center">{item.icon}</span>
            {t(item.label)}
          </button>
        ))}
      </nav>

      {/* User area */}
      <div className="px-4 pb-4 border-t border-[var(--border)] pt-3">
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-100 cursor-pointer transition-colors">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-[11px] font-semibold text-white">
            U
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-slate-800 truncate">User</div>
            <div className="text-[10px] text-slate-400 truncate">Workspace</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
