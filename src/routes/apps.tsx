import { useEffect, useState } from "react";
import { listSkills, createSkill, deleteSkill } from "@/lib/db";
import { mcpManager, MCP_PRESETS } from "@/lib/mcp";
import {
  IconPlus, IconPlay, IconClock, IconClose,
  IconServer, IconWarning, IconSpinner, IconSettings,
} from "@/components/icons";
import { t } from "@/lib/i18n";
import type { SkillRecord, SkillDefinition, SkillType } from "@/types";

export function AppsPage() {
  const [apps, setApps] = useState<SkillRecord[]>([]);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [mcpStatus, setMcpStatus] = useState<Array<{
    id: string; name: string; connected: boolean; toolCount: number;
    builtin: boolean; enabled: boolean;
    status: "connecting" | "connected" | "error" | "disabled";
    error?: string;
  }>>([]);
  const [showCreate, setShowCreate] = useState<SkillType | null>(null);
  const [showAddMcp, setShowAddMcp] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const [allSkills, status] = await Promise.all([
      listSkills(),
      Promise.resolve(mcpManager.getServerStatus()),
    ]);
    setApps(allSkills.filter((s) => s.type === "app"));
    setSkills(allSkills.filter((s) => s.type === "skill"));
    setMcpStatus(status);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-8 py-8">
        {/* Section 1: Apps */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-[18px] font-bold text-[var(--on-surface)]">{t("apps.myApps")}</h1>
            <button onClick={() => setShowCreate("app")} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] text-white text-[13px] font-medium cursor-pointer transition-colors">
              <IconPlus size={14} /> {t("apps.create")}
            </button>
          </div>
          {apps.length === 0 ? (
            <EmptyState text={t("apps.noApps")} />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {apps.map((app) => <SkillCard key={app.id} record={app} onRefresh={loadData} />)}
            </div>
          )}
        </section>

        {/* Section 2: Skills */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[16px] font-bold text-[var(--on-surface)]">{t("skills.title")}</h2>
            <button onClick={() => setShowCreate("skill")} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] text-[13px] font-medium cursor-pointer transition-colors">
              <IconPlus size={14} /> {t("skills.add")}
            </button>
          </div>
          {skills.length === 0 ? (
            <EmptyState text={t("skills.noSkills")} />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {skills.map((skill) => <SkillCard key={skill.id} record={skill} onRefresh={loadData} />)}
            </div>
          )}
        </section>

        {/* Section 3: MCP Connections */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[16px] font-bold text-[var(--on-surface)] flex items-center gap-2">
              <IconServer size={16} /> {t("connections.title")}
            </h2>
            <button onClick={() => setShowAddMcp(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] text-[13px] font-medium cursor-pointer transition-colors">
              <IconPlus size={14} /> {t("connections.add")}
            </button>
          </div>
          <div className="space-y-2">
            {mcpStatus.map((s) => <McpCard key={s.id} server={s} onRefresh={loadData} />)}
            {mcpStatus.length === 0 && <EmptyState text={t("connections.noConnections")} />}
          </div>
        </section>
      </div>

      {showCreate && <CreateSkillDialog type={showCreate} onClose={() => setShowCreate(null)} onCreated={loadData} />}
      {showAddMcp && <AddMcpDialog onClose={() => setShowAddMcp(false)} onAdded={loadData} />}
    </div>
  );
}

// ---- Shared Components ----

function EmptyState({ text }: { text: string }) {
  return (
    <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] p-8 text-center">
      <p className="text-[13px] text-[var(--on-surface-tertiary)]">{text}</p>
    </div>
  );
}

function SkillCard({ record, onRefresh }: { record: SkillRecord; onRefresh: () => void }) {
  const isApp = record.type === "app";

  async function handleDelete() {
    await deleteSkill(record.id);
    onRefresh();
  }

  return (
    <div className="bg-[var(--surface-lowest)] border border-[var(--border)] rounded-xl p-4 hover:shadow-[var(--shadow-md)] transition-all group">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[14px] font-semibold text-[var(--on-surface)]">{record.name}</h3>
          <span className={`text-[10px] px-1.5 py-[1px] rounded-full font-medium ${isApp ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"}`}>
            {isApp ? "App" : "Skill"}
          </span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {isApp && (
            <button className="p-1.5 rounded-lg text-[var(--primary-accent)] hover:bg-[var(--primary-accent-light)] cursor-pointer">
              <IconPlay size={14} />
            </button>
          )}
          <button onClick={handleDelete} className="p-1.5 rounded-lg text-[var(--on-surface-tertiary)] hover:text-[var(--error)] hover:bg-red-50 cursor-pointer">
            <IconClose size={12} />
          </button>
        </div>
      </div>
      <p className="text-[12px] text-[var(--on-surface-secondary)] leading-relaxed line-clamp-2 mb-2">
        {record.definition.purpose || "—"}
      </p>
      <div className="flex items-center gap-2 text-[11px] text-[var(--on-surface-tertiary)]">
        <IconClock size={11} />
        <span>v{record.version}</span>
        {record.definition.requiredConfig && Object.keys(record.definition.requiredConfig).length > 0 && (
          <span className="flex items-center gap-1 text-amber-600">
            <IconSettings size={10} /> Config
          </span>
        )}
      </div>
    </div>
  );
}

function McpCard({ server, onRefresh }: {
  server: { id: string; name: string; connected: boolean; toolCount: number; builtin: boolean; enabled: boolean; status: string; error?: string };
  onRefresh: () => void;
}) {
  async function handleToggle() {
    if (server.enabled) await mcpManager.removeServer(server.id);
    else await mcpManager.enableServer(server.id);
    onRefresh();
  }
  async function handleReconnect() { await mcpManager.reconnectServer(server.id); onRefresh(); }

  const cfg: Record<string, { bg: string; icon: React.ReactNode }> = {
    connecting: { bg: "bg-amber-50 text-amber-600", icon: <IconSpinner size={14} /> },
    connected: { bg: "bg-emerald-50 text-emerald-600", icon: <IconServer size={16} /> },
    error: { bg: "bg-red-50 text-red-500", icon: <IconWarning size={16} /> },
    disabled: { bg: "bg-[var(--surface-low)] text-[var(--on-surface-tertiary)]", icon: <IconServer size={16} /> },
  };
  const c = cfg[server.status] || cfg.disabled;

  return (
    <div className="bg-[var(--surface-lowest)] border border-[var(--border)] rounded-xl px-4 py-3">
      <div className="flex items-center gap-4">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${c.bg}`}>{c.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-[var(--on-surface)]">{server.name}</span>
            {server.builtin && <span className="text-[10px] px-1.5 py-[1px] rounded-full bg-blue-50 text-blue-600 font-medium">{t("connections.builtin")}</span>}
          </div>
          <div className="text-[11px] text-[var(--on-surface-tertiary)]">
            {server.connected ? `${server.toolCount} ${t("connections.tools")}` : server.status === "error" ? t("connections.error") : server.enabled ? t("connections.connecting") : t("connections.disabled")}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {server.status === "error" && <button onClick={handleReconnect} className="px-2.5 py-1 rounded-lg text-[11px] text-[var(--primary-accent)] hover:bg-[var(--surface-low)] cursor-pointer">{t("connections.reconnect")}</button>}
          <button onClick={handleToggle} className={`px-2.5 py-1 rounded-lg text-[11px] cursor-pointer ${server.enabled ? "text-[var(--on-surface-tertiary)] hover:text-[var(--error)] hover:bg-red-50" : "text-[var(--primary-accent)] hover:bg-[var(--surface-low)]"}`}>
            {server.enabled ? t("connections.disable") : t("connections.enable")}
          </button>
        </div>
      </div>
      {server.status === "error" && server.error && (
        <div className="mt-2 px-3 py-2 rounded-lg bg-red-50 text-[11px] text-red-600">{server.error}</div>
      )}
    </div>
  );
}

// ---- Dialogs ----

function CreateSkillDialog({ type, onClose, onCreated }: { type: SkillType; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);

  const isApp = type === "app";
  const title = isApp ? t("apps.create") : t("skills.add");

  async function handleSave() {
    if (!name.trim() || !purpose.trim()) return;
    setSaving(true);
    const definition: SkillDefinition = {
      purpose: purpose.trim(),
      instructions: instructions.trim() ? instructions.split("\n").filter(Boolean) : undefined,
    };
    await createSkill({ name: name.trim(), type, definition });
    onCreated();
    onClose();
  }

  return (
    <DialogOverlay onClose={onClose}>
      <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-[var(--on-surface)]">{title}</h2>
        <button onClick={onClose} className="p-1 rounded-lg text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)] cursor-pointer"><IconClose size={16} /></button>
      </div>
      <div className="px-6 py-5 space-y-4">
        <Field label={t("apps.name")}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={isApp ? "Weekly Sales Analysis" : "Image Generator"} className={inputClass} />
        </Field>
        <Field label={isApp ? t("apps.goal") : t("skills.purpose")}>
          <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={isApp ? t("apps.goalPlaceholder") : t("skills.purposePlaceholder")} rows={3} className={`${inputClass} resize-none`} />
        </Field>
        <Field label={t("skills.instructions")}>
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={t("skills.instructionsPlaceholder")} rows={4} className={`${inputClass} resize-none`} />
        </Field>
      </div>
      <div className="px-6 py-4 border-t border-[var(--border)] flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] cursor-pointer">{t("apps.cancel")}</button>
        <button onClick={handleSave} disabled={!name.trim() || !purpose.trim() || saving} className="px-4 py-2 rounded-lg text-[13px] bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] cursor-pointer disabled:opacity-40">
          {saving ? "..." : t("apps.save")}
        </button>
      </div>
    </DialogOverlay>
  );
}

function AddMcpDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [mode, setMode] = useState<"presets" | "custom">("presets");
  const [id, setId] = useState("");
  const [command, setCommand] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePreset(p: typeof MCP_PRESETS[0]) {
    setConnecting(true); setError(null);
    try { await mcpManager.addServer(p.id, { command: p.command, args: p.args }); onAdded(); onClose(); }
    catch (e) { setError(String(e)); setConnecting(false); }
  }
  async function handleCustom() {
    if (!id.trim() || !command.trim()) return;
    setConnecting(true); setError(null);
    try { const parts = command.trim().split(/\s+/); await mcpManager.addServer(id.trim(), { command: parts[0], args: parts.slice(1) }); onAdded(); onClose(); }
    catch (e) { setError(String(e)); setConnecting(false); }
  }

  return (
    <DialogOverlay onClose={onClose}>
      <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">{t("connections.add")}</h2>
        <button onClick={onClose} className="p-1 rounded-lg text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)] cursor-pointer"><IconClose size={16} /></button>
      </div>
      <div className="px-6 py-5">
        <div className="flex gap-1 mb-4 p-1 rounded-lg bg-[var(--surface-low)]">
          {(["presets", "custom"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`flex-1 py-1.5 rounded-md text-[12px] font-medium cursor-pointer transition-colors ${mode === m ? "bg-[var(--surface-lowest)] text-[var(--on-surface)] shadow-sm" : "text-[var(--on-surface-tertiary)]"}`}>
              {m === "presets" ? t("connections.presets") : t("connections.custom")}
            </button>
          ))}
        </div>
        {mode === "presets" ? (
          <div className="space-y-2">
            {MCP_PRESETS.map((p) => (
              <button key={p.id} onClick={() => handlePreset(p)} disabled={connecting} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-low)] text-left cursor-pointer transition-all disabled:opacity-40">
                <div className="w-8 h-8 rounded-lg bg-[var(--surface-container)] flex items-center justify-center text-[var(--on-surface-secondary)]"><IconServer size={15} /></div>
                <div className="flex-1">
                  <div className="text-[13px] font-medium text-[var(--on-surface)]">{p.label}</div>
                  <div className="text-[11px] text-[var(--on-surface-tertiary)]">{p.description}</div>
                </div>
                {p.requiresEnv && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">API Key</span>}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <Field label={t("connections.id")}><input value={id} onChange={(e) => setId(e.target.value)} placeholder={t("connections.idPlaceholder")} className={inputClass} /></Field>
            <Field label={t("connections.command")}><input value={command} onChange={(e) => setCommand(e.target.value)} placeholder={t("connections.commandPlaceholder")} className={`${inputClass} font-mono`} /></Field>
            <div className="flex justify-end"><button onClick={handleCustom} disabled={!id.trim() || !command.trim() || connecting} className="px-4 py-2 rounded-lg text-[13px] bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] cursor-pointer disabled:opacity-40">{connecting ? "..." : t("connections.add")}</button></div>
          </div>
        )}
        {error && <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-[var(--error-light)] text-[var(--error)] text-[12px]"><IconWarning size={14} /><span>{error}</span></div>}
      </div>
    </DialogOverlay>
  );
}

function DialogOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--surface-lowest)] rounded-2xl border border-[var(--border)] shadow-[var(--shadow-lg)] w-[480px] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-[13px] font-medium text-[var(--on-surface)] mb-1.5">{label}</label>{children}</div>;
}

const inputClass = "w-full px-3 py-2 bg-[var(--surface-low)] border border-[var(--border)] rounded-lg text-[13px] text-[var(--on-surface)] placeholder:text-[var(--on-surface-tertiary)] focus:outline-none focus:border-[var(--primary-accent)]";
