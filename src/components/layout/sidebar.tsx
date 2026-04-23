import { t } from "@/lib/i18n";

type Page = "home" | "knowledge" | "channels" | "explore" | "activity" | "settings";

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

const navItems: { id: Page; label: string; icon: (active: boolean) => React.ReactNode }[] = [
  { id: "home", label: "nav.home", icon: (a) => <IconHome active={a} /> },
  { id: "knowledge", label: "nav.knowledge", icon: (a) => <IconBook active={a} /> },
  { id: "channels", label: "nav.channels", icon: (a) => <IconChannel active={a} /> },
  { id: "activity", label: "nav.activity", icon: (a) => <IconActivity active={a} /> },
  { id: "settings", label: "nav.settings", icon: (a) => <IconSettings active={a} /> },
];

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="w-[232px] flex flex-col bg-slate-50 border-r border-[var(--border)] shrink-0">
      {/* Logo */}
      <div className="px-5 pt-5 pb-4" data-tauri-drag-region>
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
        {navItems.map((item) => {
          const active = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-[9px] rounded-lg text-[14px] transition-colors cursor-pointer ${
                active
                  ? "bg-blue-50 text-blue-700 font-semibold"
                  : "text-slate-600 font-medium hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <span className="w-5 flex items-center justify-center">{item.icon(active)}</span>
              {t(item.label)}
            </button>
          );
        })}
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

// ---- SVG Icons (18px, stroke-based, matching mainview.png style) ----

function IconHome({ active }: { active: boolean }) {
  const color = active ? "currentColor" : "currentColor";
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7.5L9 2.5L15 7.5V14.5C15 15.05 14.55 15.5 14 15.5H4C3.45 15.5 3 15.05 3 14.5V7.5Z" />
      <path d="M7 15.5V10H11V15.5" />
    </svg>
  );
}

function IconBook({ active }: { active: boolean }) {
  const color = active ? "currentColor" : "currentColor";
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 13.5V4C2.5 3.17 3.17 2.5 4 2.5H7.5C8.33 2.5 9 3.17 9 4V15" />
      <path d="M15.5 13.5V4C15.5 3.17 14.83 2.5 14 2.5H10.5C9.67 2.5 9 3.17 9 4" />
      <path d="M2.5 13.5C2.5 14.33 3.17 15 4 15H14C14.83 15 15.5 14.33 15.5 13.5" />
    </svg>
  );
}

function IconChannel({ active }: { active: boolean }) {
  const color = active ? "currentColor" : "currentColor";
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 2.5V15.5" />
      <path d="M11.5 2.5V15.5" />
      <path d="M2.5 6.5H15.5" />
      <path d="M2.5 11.5H15.5" />
    </svg>
  );
}

function IconActivity({ active }: { active: boolean }) {
  const color = active ? "currentColor" : "currentColor";
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.5 9H12.5L10.5 15L7.5 3L5.5 9H2.5" />
    </svg>
  );
}

function IconSettings({ active }: { active: boolean }) {
  const color = active ? "currentColor" : "currentColor";
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="2.5" />
      <path d="M14.7 11.1C14.6 11.35 14.65 11.65 14.85 11.85L14.9 11.9C15.06 12.06 15.15 12.28 15.15 12.5C15.15 12.72 15.06 12.94 14.9 13.1C14.74 13.26 14.52 13.35 14.3 13.35C14.08 13.35 13.86 13.26 13.7 13.1L13.65 13.05C13.45 12.85 13.15 12.8 12.9 12.9C12.66 13 12.5 13.23 12.5 13.5V13.65C12.5 14.1 12.15 14.45 11.7 14.45H11.3C10.85 14.45 10.5 14.1 10.5 13.65V13.5C10.5 13.23 10.34 13 10.1 12.9C9.85 12.8 9.55 12.85 9.35 13.05L9.3 13.1C9.14 13.26 8.92 13.35 8.7 13.35C8.48 13.35 8.26 13.26 8.1 13.1C7.94 12.94 7.85 12.72 7.85 12.5C7.85 12.28 7.94 12.06 8.1 11.9L8.15 11.85C8.35 11.65 8.4 11.35 8.3 11.1C8.2 10.86 7.97 10.7 7.7 10.7H7.55C7.1 10.7 6.75 10.35 6.75 9.9V9.5C6.75 9.05 7.1 8.7 7.55 8.7H7.7C7.97 8.7 8.2 8.54 8.3 8.3C8.4 8.05 8.35 7.75 8.15 7.55L8.1 7.5C7.94 7.34 7.85 7.12 7.85 6.9C7.85 6.68 7.94 6.46 8.1 6.3C8.26 6.14 8.48 6.05 8.7 6.05C8.92 6.05 9.14 6.14 9.3 6.3L9.35 6.35C9.55 6.55 9.85 6.6 10.1 6.5H10.15C10.38 6.4 10.5 6.17 10.5 5.9V5.75C10.5 5.3 10.85 4.95 11.3 4.95H11.7C12.15 4.95 12.5 5.3 12.5 5.75V5.9C12.5 6.17 12.66 6.4 12.9 6.5C13.15 6.6 13.45 6.55 13.65 6.35L13.7 6.3C13.86 6.14 14.08 6.05 14.3 6.05C14.52 6.05 14.74 6.14 14.9 6.3C15.06 6.46 15.15 6.68 15.15 6.9C15.15 7.12 15.06 7.34 14.9 7.5L14.85 7.55C14.65 7.75 14.6 8.05 14.7 8.3V8.35C14.8 8.58 15.03 8.7 15.3 8.7H15.45C15.9 8.7 16.25 9.05 16.25 9.5V9.9C16.25 10.35 15.9 10.7 15.45 10.7H15.3C15.03 10.7 14.8 10.86 14.7 11.1Z" />
    </svg>
  );
}
