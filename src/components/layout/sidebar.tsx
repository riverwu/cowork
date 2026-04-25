import { t } from "@/lib/i18n";
import { IconHome, IconPackage, IconBook, IconChannel, IconSettings } from "@/components/icons";
import { WindowDragRegion } from "./window-drag-region";

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
];

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="w-[232px] flex flex-col bg-slate-50 border-r border-[var(--border)] shrink-0">
      {/* Traffic light area — drag region, space for macOS window controls */}
      <WindowDragRegion className="h-[52px] shrink-0" />

      {/* Logo */}
      <WindowDragRegion className="px-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[var(--primary)] text-white flex items-center justify-center text-[11px] font-bold tracking-wide">
            CW
          </div>
          <div>
            <div className="text-[14px] font-semibold leading-tight tracking-tight text-slate-900">Cowork</div>
            <div className="text-[10px] text-slate-400 leading-tight">AI Workspace</div>
          </div>
        </div>
      </WindowDragRegion>

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
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-[11px] font-semibold text-white">
            U
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-slate-800 truncate">User</div>
            <div className="text-[10px] text-slate-400 truncate">Workspace</div>
          </div>
          <button
            onClick={() => onNavigate("settings")}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
              currentPage === "settings"
                ? "bg-blue-50 text-blue-700 ring-1 ring-blue-100"
                : "text-slate-500 hover:bg-slate-200 hover:text-slate-800"
            }`}
            title={t("nav.settings")}
            aria-label={t("nav.settings")}
          >
            <IconSettings size={19} />
          </button>
        </div>
      </div>
    </aside>
  );
}
