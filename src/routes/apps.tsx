import { useEffect, useState } from "react";
import { createSkill } from "@/lib/db";
import { skillRegistry } from "@/lib/ai/skill-registry";
import { mcpManager, MCP_PRESETS } from "@/lib/mcp";
import {
  IconPlus, IconPlay, IconClose,
  IconServer, IconWarning, IconSpinner, IconPuzzle, IconFolder,
} from "@/components/icons";
import { t } from "@/lib/i18n";
import type { SkillRecord, SkillDefinition } from "@/types";

/** Unified tool item — either a skill or an MCP server. */
interface ToolItem {
  id: string;
  name: string;
  kind: "skill" | "mcp";
  description: string;
  status: "active" | "connecting" | "connected" | "error" | "disabled";
  error?: string;
  // Skill-specific
  skillRecord?: SkillRecord;
  dirPath?: string;
  hasScripts?: boolean;
  // MCP-specific
  toolCount?: number;
  builtin?: boolean;
}

export function AppsPage() {
  const [apps, setApps] = useState<SkillRecord[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [showCreateApp, setShowCreateApp] = useState(false);
  const [showAddTool, setShowAddTool] = useState(false);
  const [selectedTool, setSelectedTool] = useState<ToolItem | null>(null);

  useEffect(() => {
    loadData();
    const unsub = skillRegistry.onChange(loadData);
    const unsub2 = mcpManager.onChange(loadData);
    return () => { unsub(); unsub2(); };
  }, []);

  function loadData() {
    // Apps
    const allSkills = skillRegistry.getAll();
    setApps(allSkills.filter((s) => s.record.type === "app").map((s) => s.record));

    // Unified tools: skills + MCP
    const toolItems: ToolItem[] = [];

    // Add skill-type
    for (const loaded of allSkills.filter((s) => s.record.type === "skill")) {
      toolItems.push({
        id: loaded.record.id,
        name: loaded.record.name,
        kind: "skill",
        description: loaded.record.definition.purpose,
        status: "active",
        skillRecord: loaded.record,
        dirPath: loaded.dirPath,
        hasScripts: loaded.hasScripts,
      });
    }

    // Add MCP servers
    for (const server of mcpManager.getServerStatus()) {
      toolItems.push({
        id: `mcp_${server.id}`,
        name: server.name,
        kind: "mcp",
        description: server.connected ? `${server.toolCount} ${t("tools.providedTools")}` : "",
        status: server.status as ToolItem["status"],
        error: server.error,
        toolCount: server.toolCount,
        builtin: server.builtin,
      });
    }

    setTools(toolItems);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-8 py-8">
        {/* Apps Section */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-[18px] font-bold text-[var(--on-surface)]">{t("apps.myApps")}</h1>
            <button onClick={() => setShowCreateApp(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] text-white text-[13px] font-medium cursor-pointer transition-colors">
              <IconPlus size={14} /> {t("apps.create")}
            </button>
          </div>
          {apps.length === 0 ? (
            <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] p-8 text-center">
              <p className="text-[13px] text-[var(--on-surface-tertiary)]">{t("apps.noApps")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {apps.map((app) => (
                <div key={app.id} className="bg-[var(--surface-lowest)] border border-[var(--border)] rounded-xl p-4 hover:shadow-[var(--shadow-md)] transition-all group">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-[14px] font-semibold text-[var(--on-surface)]">{app.name}</h3>
                    <button className="p-1.5 rounded-lg text-[var(--primary-accent)] hover:bg-[var(--primary-accent-light)] opacity-0 group-hover:opacity-100 transition-all cursor-pointer">
                      <IconPlay size={14} />
                    </button>
                  </div>
                  <p className="text-[12px] text-[var(--on-surface-secondary)] leading-relaxed line-clamp-2">{app.definition.purpose || "—"}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Tools Section (unified: skills + MCP) */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[16px] font-bold text-[var(--on-surface)]">{t("tools.title")}</h2>
            <button onClick={() => setShowAddTool(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] text-[13px] font-medium cursor-pointer transition-colors">
              <IconPlus size={14} /> {t("tools.add")}
            </button>
          </div>
          {tools.length === 0 ? (
            <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] p-8 text-center">
              <p className="text-[13px] text-[var(--on-surface-tertiary)]">{t("tools.noTools")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tools.map((tool) => (
                <ToolCard key={tool.id} tool={tool} onClick={() => setSelectedTool(tool)} />
              ))}
            </div>
          )}
        </section>
      </div>

      {showCreateApp && <CreateAppDialog onClose={() => setShowCreateApp(false)} onCreated={loadData} />}
      {showAddTool && <AddToolDialog onClose={() => setShowAddTool(false)} onAdded={loadData} />}
      {selectedTool && <ToolDetailDialog tool={selectedTool} onClose={() => setSelectedTool(null)} onRefresh={loadData} />}
    </div>
  );
}

// ---- Tool Card ----

function ToolCard({ tool, onClick }: { tool: ToolItem; onClick: () => void }) {
  const isSkill = tool.kind === "skill";
  const statusColors: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-600",
    connected: "bg-emerald-50 text-emerald-600",
    connecting: "bg-amber-50 text-amber-600",
    error: "bg-red-50 text-red-500",
    disabled: "bg-[var(--surface-low)] text-[var(--on-surface-tertiary)]",
  };
  const iconBg = statusColors[tool.status] || statusColors.active;

  return (
    <button
      onClick={onClick}
      className="w-full bg-[var(--surface-lowest)] border border-[var(--border)] rounded-xl px-4 py-3 flex items-center gap-4 hover:shadow-[var(--shadow-sm)] hover:border-[var(--on-surface-tertiary)] transition-all cursor-pointer text-left"
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
        {tool.status === "connecting" ? <IconSpinner size={16} />
          : isSkill ? <IconPuzzle size={16} />
          : <IconServer size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-[var(--on-surface)]">{tool.name}</span>
          <span className={`text-[10px] px-1.5 py-[1px] rounded-full font-medium ${isSkill ? "bg-purple-50 text-purple-600" : "bg-blue-50 text-blue-600"}`}>
            {isSkill ? t("tools.type.skill") : t("tools.type.mcp")}
          </span>
          {tool.builtin && <span className="text-[10px] px-1.5 py-[1px] rounded-full bg-gray-100 text-gray-500">{t("connections.builtin")}</span>}
        </div>
        <div className="text-[11px] text-[var(--on-surface-tertiary)] truncate">
          {tool.description || (tool.status === "error" ? t("connections.error") : tool.status === "connecting" ? t("connections.connecting") : t("connections.disabled"))}
        </div>
      </div>
      {tool.status === "error" && <IconWarning size={14} className="text-[var(--error)] shrink-0" />}
    </button>
  );
}

// ---- Tool Detail Dialog ----

function ToolDetailDialog({ tool, onClose, onRefresh }: { tool: ToolItem; onClose: () => void; onRefresh: () => void }) {
  const isSkill = tool.kind === "skill";

  async function handleMcpToggle() {
    const mcpId = tool.id.replace("mcp_", "");
    if (tool.status === "disabled") await mcpManager.enableServer(mcpId);
    else await mcpManager.removeServer(mcpId);
    onRefresh();
  }

  async function handleMcpReconnect() {
    await mcpManager.reconnectServer(tool.id.replace("mcp_", ""));
    onRefresh();
  }

  return (
    <DialogOverlay onClose={onClose}>
      <div className="px-6 py-4 border-b border-[var(--border)] flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isSkill ? "bg-purple-50 text-purple-600" : "bg-blue-50 text-blue-600"}`}>
          {isSkill ? <IconPuzzle size={16} /> : <IconServer size={16} />}
        </div>
        <div className="flex-1">
          <h2 className="text-[15px] font-semibold text-[var(--on-surface)]">{tool.name}</h2>
          <span className={`text-[10px] px-1.5 py-[1px] rounded-full font-medium ${isSkill ? "bg-purple-50 text-purple-600" : "bg-blue-50 text-blue-600"}`}>
            {isSkill ? t("tools.type.skill") : t("tools.type.mcp")}
          </span>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)] cursor-pointer"><IconClose size={16} /></button>
      </div>

      <div className="px-6 py-5 space-y-4">
        {/* Description */}
        {tool.skillRecord?.definition.purpose && (
          <div>
            <label className="text-[12px] font-medium text-[var(--on-surface-tertiary)] uppercase tracking-wider">{t("skills.purpose")}</label>
            <p className="text-[13px] text-[var(--on-surface)] mt-1">{tool.skillRecord.definition.purpose}</p>
          </div>
        )}

        {/* Instructions */}
        {tool.skillRecord?.definition.instructions && tool.skillRecord.definition.instructions.length > 0 && (
          <div>
            <label className="text-[12px] font-medium text-[var(--on-surface-tertiary)] uppercase tracking-wider">{t("skills.instructions")}</label>
            <ul className="mt-1 space-y-0.5">
              {tool.skillRecord.definition.instructions.map((inst, i) => (
                <li key={i} className="text-[12px] text-[var(--on-surface-secondary)] flex items-start gap-1.5">
                  <span className="text-[var(--on-surface-tertiary)] mt-0.5">-</span>
                  {inst}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Directory (skill) */}
        {tool.dirPath && (
          <div>
            <label className="text-[12px] font-medium text-[var(--on-surface-tertiary)] uppercase tracking-wider">{t("tools.directory")}</label>
            <div className="flex items-center gap-1.5 mt-1 text-[12px] text-[var(--on-surface-secondary)]">
              <IconFolder size={12} />
              <span className="font-mono">{tool.dirPath}</span>
            </div>
          </div>
        )}

        {/* Scripts */}
        {tool.hasScripts && (
          <div>
            <label className="text-[12px] font-medium text-[var(--on-surface-tertiary)] uppercase tracking-wider">{t("tools.scripts")}</label>
            <p className="text-[12px] text-[var(--on-surface-secondary)] mt-1">{tool.dirPath}/scripts/</p>
          </div>
        )}

        {/* MCP: tool count */}
        {!isSkill && tool.toolCount !== undefined && tool.toolCount > 0 && (
          <div>
            <label className="text-[12px] font-medium text-[var(--on-surface-tertiary)] uppercase tracking-wider">{t("tools.providedTools")}</label>
            <p className="text-[13px] text-[var(--on-surface)] mt-1">{tool.toolCount} tools</p>
          </div>
        )}

        {/* Status */}
        <div>
          <label className="text-[12px] font-medium text-[var(--on-surface-tertiary)] uppercase tracking-wider">{t("tools.status")}</label>
          <div className="flex items-center gap-2 mt-1">
            <span className={`w-2 h-2 rounded-full ${tool.status === "active" || tool.status === "connected" ? "bg-emerald-500" : tool.status === "error" ? "bg-red-500" : tool.status === "connecting" ? "bg-amber-500" : "bg-gray-400"}`} />
            <span className="text-[13px] text-[var(--on-surface)]">{tool.status}</span>
          </div>
          {tool.error && <p className="text-[12px] text-[var(--error)] mt-1">{tool.error}</p>}
        </div>

        {/* MCP actions */}
        {!isSkill && (
          <div className="flex gap-2 pt-2">
            {tool.status === "error" && (
              <button onClick={handleMcpReconnect} className="px-3 py-1.5 rounded-lg text-[12px] bg-[var(--primary-accent)] text-white hover:bg-[var(--primary)] cursor-pointer">{t("connections.reconnect")}</button>
            )}
            <button onClick={handleMcpToggle} className={`px-3 py-1.5 rounded-lg text-[12px] cursor-pointer ${tool.status === "disabled" ? "bg-[var(--surface-low)] text-[var(--primary-accent)]" : "bg-red-50 text-[var(--error)]"}`}>
              {tool.status === "disabled" ? t("connections.enable") : t("connections.disable")}
            </button>
          </div>
        )}
      </div>
    </DialogOverlay>
  );
}

// ---- Dialogs ----

function CreateAppDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim() || !purpose.trim()) return;
    setSaving(true);
    const definition: SkillDefinition = {
      purpose: purpose.trim(),
      instructions: instructions.trim() ? instructions.split("\n").filter(Boolean) : undefined,
    };
    await createSkill({ name: name.trim(), type: "app", definition });
    onCreated(); onClose();
  }

  return (
    <DialogOverlay onClose={onClose}>
      <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">{t("apps.create")}</h2>
        <button onClick={onClose} className="p-1 rounded-lg text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)] cursor-pointer"><IconClose size={16} /></button>
      </div>
      <div className="px-6 py-5 space-y-4">
        <Field label={t("apps.name")}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly Sales Analysis" className={inputClass} /></Field>
        <Field label={t("apps.goal")}><textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t("apps.goalPlaceholder")} rows={3} className={`${inputClass} resize-none`} /></Field>
        <Field label={t("skills.instructions")}><textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={t("skills.instructionsPlaceholder")} rows={4} className={`${inputClass} resize-none`} /></Field>
      </div>
      <div className="px-6 py-4 border-t border-[var(--border)] flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-low)] cursor-pointer">{t("apps.cancel")}</button>
        <button onClick={handleSave} disabled={!name.trim() || !purpose.trim() || saving} className="px-4 py-2 rounded-lg text-[13px] bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] cursor-pointer disabled:opacity-40">{saving ? "..." : t("apps.save")}</button>
      </div>
    </DialogOverlay>
  );
}

function AddToolDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [tab, setTab] = useState<"service" | "skill">("service");
  const [id, setId] = useState("");
  const [command, setCommand] = useState("");
  const [skillName, setSkillName] = useState("");
  const [skillPurpose, setSkillPurpose] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePreset(p: typeof MCP_PRESETS[0]) {
    setConnecting(true); setError(null);
    try { await mcpManager.addServer(p.id, { command: p.command, args: p.args }); onAdded(); onClose(); }
    catch (e) { setError(String(e)); setConnecting(false); }
  }

  async function handleCustomMcp() {
    if (!id.trim() || !command.trim()) return;
    setConnecting(true); setError(null);
    try { const parts = command.trim().split(/\s+/); await mcpManager.addServer(id.trim(), { command: parts[0], args: parts.slice(1) }); onAdded(); onClose(); }
    catch (e) { setError(String(e)); setConnecting(false); }
  }

  async function handleCreateSkill() {
    if (!skillName.trim() || !skillPurpose.trim()) return;
    setConnecting(true); setError(null);
    try {
      await createSkill({ name: skillName.trim(), type: "skill", definition: { purpose: skillPurpose.trim() } });
      onAdded(); onClose();
    } catch (e) { setError(String(e)); setConnecting(false); }
  }

  return (
    <DialogOverlay onClose={onClose}>
      <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">{t("tools.add")}</h2>
        <button onClick={onClose} className="p-1 rounded-lg text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)] cursor-pointer"><IconClose size={16} /></button>
      </div>
      <div className="px-6 py-5">
        <div className="flex gap-1 mb-4 p-1 rounded-lg bg-[var(--surface-low)]">
          {([["service", t("tools.addService")], ["skill", t("tools.installSkill")]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} className={`flex-1 py-1.5 rounded-md text-[12px] font-medium cursor-pointer transition-colors ${tab === key ? "bg-[var(--surface-lowest)] text-[var(--on-surface)] shadow-sm" : "text-[var(--on-surface-tertiary)]"}`}>{label}</button>
          ))}
        </div>

        {tab === "service" ? (
          <div className="space-y-3">
            {MCP_PRESETS.map((p) => (
              <button key={p.id} onClick={() => handlePreset(p)} disabled={connecting} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-low)] text-left cursor-pointer transition-all disabled:opacity-40">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center"><IconServer size={15} /></div>
                <div className="flex-1"><div className="text-[13px] font-medium text-[var(--on-surface)]">{p.label}</div><div className="text-[11px] text-[var(--on-surface-tertiary)]">{p.description}</div></div>
              </button>
            ))}
            <div className="pt-2 space-y-3">
              <Field label={t("connections.id")}><input value={id} onChange={(e) => setId(e.target.value)} placeholder={t("connections.idPlaceholder")} className={inputClass} /></Field>
              <Field label={t("connections.command")}><input value={command} onChange={(e) => setCommand(e.target.value)} placeholder={t("connections.commandPlaceholder")} className={`${inputClass} font-mono`} /></Field>
              <button onClick={handleCustomMcp} disabled={!id.trim() || !command.trim() || connecting} className="px-4 py-2 rounded-lg text-[13px] bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] cursor-pointer disabled:opacity-40">{t("connections.add")}</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] text-[var(--on-surface-tertiary)] mb-2">
              在对话中告诉 AI "从 GitHub 安装 xxx skill"，或手动创建：
            </p>
            <Field label={t("apps.name")}><input value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder="deep-research" className={inputClass} /></Field>
            <Field label={t("skills.purpose")}><input value={skillPurpose} onChange={(e) => setSkillPurpose(e.target.value)} placeholder={t("skills.purposePlaceholder")} className={inputClass} /></Field>
            <button onClick={handleCreateSkill} disabled={!skillName.trim() || !skillPurpose.trim() || connecting} className="px-4 py-2 rounded-lg text-[13px] bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] cursor-pointer disabled:opacity-40">{t("skills.add")}</button>
          </div>
        )}

        {error && <div className="mt-3 p-3 rounded-lg bg-[var(--error-light)] text-[var(--error)] text-[12px]">{error}</div>}
      </div>
    </DialogOverlay>
  );
}

function DialogOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--surface-lowest)] rounded-2xl border border-[var(--border)] shadow-[var(--shadow-lg)] w-[500px] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-[13px] font-medium text-[var(--on-surface)] mb-1.5">{label}</label>{children}</div>;
}

const inputClass = "w-full px-3 py-2 bg-[var(--surface-low)] border border-[var(--border)] rounded-lg text-[13px] text-[var(--on-surface)] placeholder:text-[var(--on-surface-tertiary)] focus:outline-none focus:border-[var(--primary-accent)]";
