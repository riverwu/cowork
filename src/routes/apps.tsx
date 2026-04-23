import { useEffect, useState } from "react";
import { listApps, createApp } from "@/lib/db";
import { mcpManager } from "@/lib/mcp";
import {
  IconPlus, IconPlay, IconClock, IconSettings, IconClose,
  IconChannel, IconWarning,
} from "@/components/icons";
import type { App } from "@/types";
import { t } from "@/lib/i18n";
import type { AppDefinition } from "@/types";

export function AppsPage() {
  const [apps, setApps] = useState<App[]>([]);
  const [mcpStatus, setMcpStatus] = useState<Array<{ id: string; name: string; connected: boolean; toolCount: number }>>([]);
  const [showCreateApp, setShowCreateApp] = useState(false);
  const [showAddConnection, setShowAddConnection] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [appList, status] = await Promise.all([
      listApps(),
      Promise.resolve(mcpManager.getServerStatus()),
    ]);
    setApps(appList);
    setMcpStatus(status);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-8 py-8">
        {/* My Apps Section */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-[18px] font-bold text-[var(--on-surface)]">{t("apps.myApps")}</h1>
            <button
              onClick={() => setShowCreateApp(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] text-white text-[13px] font-medium cursor-pointer transition-colors"
            >
              <IconPlus size={14} /> {t("apps.create")}
            </button>
          </div>

          {apps.length === 0 ? (
            <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] p-8 text-center">
              <p className="text-[13px] text-[var(--on-surface-tertiary)] mb-1">{t("apps.noApps")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {apps.map((app) => (
                <AppCard key={app.id} app={app} />
              ))}
            </div>
          )}
        </section>

        {/* Connections Section (MCP) */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[16px] font-bold text-[var(--on-surface)] flex items-center gap-2">
              <IconChannel size={16} /> {t("connections.title")}
            </h2>
            <button
              onClick={() => setShowAddConnection(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] text-[13px] font-medium cursor-pointer transition-colors"
            >
              <IconPlus size={14} /> {t("connections.add")}
            </button>
          </div>

          {mcpStatus.length === 0 ? (
            <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] p-8 text-center">
              <p className="text-[13px] text-[var(--on-surface-tertiary)] mb-1">{t("connections.noConnections")}</p>
              <p className="text-[12px] text-[var(--on-surface-tertiary)]">{t("connections.noConnectionsHint")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {mcpStatus.map((server) => (
                <ConnectionCard key={server.id} server={server} onRefresh={loadData} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Create App Dialog */}
      {showCreateApp && (
        <CreateAppDialog onClose={() => setShowCreateApp(false)} onCreated={loadData} />
      )}

      {/* Add Connection Dialog */}
      {showAddConnection && (
        <AddConnectionDialog onClose={() => setShowAddConnection(false)} onAdded={loadData} />
      )}
    </div>
  );
}

// ---- App Card ----

function AppCard({ app }: { app: App }) {
  return (
    <div className="bg-[var(--surface-lowest)] border border-[var(--border)] rounded-xl p-4 hover:shadow-[var(--shadow-md)] transition-all group">
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-[14px] font-semibold text-[var(--on-surface)]">{app.name}</h3>
        <button className="p-1.5 rounded-lg text-[var(--primary-accent)] hover:bg-[var(--primary-accent-light)] opacity-0 group-hover:opacity-100 transition-all cursor-pointer">
          <IconPlay size={14} />
        </button>
      </div>
      <p className="text-[12px] text-[var(--on-surface-secondary)] leading-relaxed line-clamp-2 mb-3">
        {app.definition.goal || "No description"}
      </p>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[11px] text-[var(--on-surface-tertiary)]">
          <IconClock size={11} />
          v{app.version}
        </span>
        <span className="text-[11px] text-[var(--on-surface-tertiary)]">
          {t("apps.lastRun")}: {t("apps.never")}
        </span>
      </div>
    </div>
  );
}

// ---- Connection Card ----

function ConnectionCard({ server, onRefresh }: {
  server: { id: string; name: string; connected: boolean; toolCount: number };
  onRefresh: () => void;
}) {
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    setRemoving(true);
    await mcpManager.removeServer(server.id);
    onRefresh();
  }

  async function handleReconnect() {
    await mcpManager.reconnectServer(server.id);
    onRefresh();
  }

  return (
    <div className="bg-[var(--surface-lowest)] border border-[var(--border)] rounded-xl px-4 py-3 flex items-center gap-4">
      <div className="w-9 h-9 rounded-lg bg-[var(--surface-low)] flex items-center justify-center text-[var(--on-surface-secondary)]">
        <IconChannel size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[var(--on-surface)]">{server.name}</div>
        <div className="text-[11px] text-[var(--on-surface-tertiary)]">
          {server.toolCount} {t("connections.tools")}
        </div>
      </div>
      <span className={`text-[11px] px-2 py-0.5 rounded-full ${
        server.connected
          ? "bg-emerald-50 text-emerald-700"
          : "bg-red-50 text-red-600"
      }`}>
        {server.connected ? t("connections.connected") : t("connections.disconnected")}
      </span>
      <div className="flex items-center gap-1">
        {!server.connected && (
          <button onClick={handleReconnect} className="p-1.5 rounded-lg text-[var(--on-surface-tertiary)] hover:text-[var(--primary-accent)] hover:bg-[var(--surface-low)] cursor-pointer transition-colors" title={t("connections.reconnect")}>
            <IconSettings size={13} />
          </button>
        )}
        <button onClick={handleRemove} disabled={removing} className="p-1.5 rounded-lg text-[var(--on-surface-tertiary)] hover:text-[var(--error)] hover:bg-red-50 cursor-pointer transition-colors" title={t("connections.remove")}>
          <IconClose size={13} />
        </button>
      </div>
    </div>
  );
}

// ---- Create App Dialog ----

function CreateAppDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim() || !goal.trim()) return;
    setSaving(true);
    const definition: AppDefinition = { goal: goal.trim() };
    await createApp({ name: name.trim(), definition });
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--surface-lowest)] rounded-2xl border border-[var(--border)] shadow-[var(--shadow-lg)] w-[480px] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[var(--on-surface)]">{t("apps.create")}</h2>
          <button onClick={onClose} className="p-1 rounded-lg text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)] cursor-pointer"><IconClose size={16} /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-[var(--on-surface)] mb-1.5">{t("apps.name")}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("apps.name")}
              className="w-full px-3 py-2 bg-[var(--surface-low)] border border-[var(--border)] rounded-lg text-[13px] text-[var(--on-surface)] placeholder:text-[var(--on-surface-tertiary)] focus:outline-none focus:border-[var(--primary-accent)]"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[var(--on-surface)] mb-1.5">{t("apps.goal")}</label>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={t("apps.goalPlaceholder")}
              rows={4}
              className="w-full px-3 py-2 bg-[var(--surface-low)] border border-[var(--border)] rounded-lg text-[13px] text-[var(--on-surface)] placeholder:text-[var(--on-surface-tertiary)] focus:outline-none focus:border-[var(--primary-accent)] resize-none"
            />
          </div>

          {/* Available tools hint */}
          <div className="bg-[var(--surface-low)] rounded-lg px-3 py-2.5">
            <p className="text-[11px] text-[var(--on-surface-tertiary)] mb-1.5">可用工具：</p>
            <div className="flex flex-wrap gap-1">
              {["search_knowledge", "read_file", "write_file", "grep", "run_python", "create_artifact"].map((tool) => (
                <span key={tool} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-container)] text-[var(--on-surface-secondary)]">{tool}</span>
              ))}
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">+ MCP tools</span>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[var(--border)] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] cursor-pointer transition-colors">
            {t("apps.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !goal.trim() || saving}
            className="px-4 py-2 rounded-lg text-[13px] bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] cursor-pointer transition-colors disabled:opacity-40"
          >
            {saving ? t("settings.saving") : t("apps.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Add Connection Dialog ----

function AddConnectionDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [id, setId] = useState("");
  const [command, setCommand] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preset connections for quick setup
  const presets = [
    { id: "filesystem", label: "File System", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "~"] },
    { id: "memory", label: "Memory", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] },
    { id: "brave-search", label: "Brave Search", command: "npx", args: ["-y", "@modelcontextprotocol/server-brave-search"] },
  ];

  async function handleConnect() {
    if (!id.trim() || !command.trim()) return;
    setConnecting(true);
    setError(null);

    try {
      // Parse command string into command + args
      const parts = command.trim().split(/\s+/);
      const cmd = parts[0];
      const args = parts.slice(1);

      await mcpManager.addServer(id.trim(), { command: cmd, args });
      onAdded();
      onClose();
    } catch (err) {
      setError(String(err));
      setConnecting(false);
    }
  }

  function applyPreset(preset: typeof presets[0]) {
    setId(preset.id);
    setCommand(`${preset.command} ${preset.args.join(" ")}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--surface-lowest)] rounded-2xl border border-[var(--border)] shadow-[var(--shadow-lg)] w-[480px]" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[var(--on-surface)]">{t("connections.add")}</h2>
          <button onClick={onClose} className="p-1 rounded-lg text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)] cursor-pointer"><IconClose size={16} /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Presets */}
          <div>
            <p className="text-[12px] text-[var(--on-surface-tertiary)] mb-2">快速连接：</p>
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => applyPreset(preset)}
                  className="px-3 py-1.5 rounded-lg text-[12px] border border-[var(--border)] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] hover:border-[var(--primary-accent)] cursor-pointer transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[var(--on-surface)] mb-1.5">{t("connections.id")}</label>
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder={t("connections.idPlaceholder")}
              className="w-full px-3 py-2 bg-[var(--surface-low)] border border-[var(--border)] rounded-lg text-[13px] text-[var(--on-surface)] placeholder:text-[var(--on-surface-tertiary)] focus:outline-none focus:border-[var(--primary-accent)]"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[var(--on-surface)] mb-1.5">{t("connections.command")}</label>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t("connections.commandPlaceholder")}
              className="w-full px-3 py-2 bg-[var(--surface-low)] border border-[var(--border)] rounded-lg text-[13px] text-[var(--on-surface)] placeholder:text-[var(--on-surface-tertiary)] focus:outline-none focus:border-[var(--primary-accent)] font-mono"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--error-light)] text-[var(--error)] text-[12px]">
              <IconWarning size={14} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[var(--border)] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] cursor-pointer transition-colors">
            {t("apps.cancel")}
          </button>
          <button
            onClick={handleConnect}
            disabled={!id.trim() || !command.trim() || connecting}
            className="px-4 py-2 rounded-lg text-[13px] bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] cursor-pointer transition-colors disabled:opacity-40"
          >
            {connecting ? "连接中..." : t("connections.add")}
          </button>
        </div>
      </div>
    </div>
  );
}
