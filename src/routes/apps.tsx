import { useEffect, useState } from "react";
import { createSkill } from "@/lib/db";
import { skillRegistry } from "@/lib/ai/skill-registry";
import { mcpManager } from "@/lib/mcp";
import { CATALOG_SKILLS, CATALOG_MCPS } from "@/lib/catalog";
import { installCatalogSkill, installCatalogMcp, getSkillInstallStatus, getMcpInstallStatus, type InstallStatus } from "@/lib/catalog-installer";
import {
  IconPlus, IconPlay, IconClose,
  IconServer, IconWarning, IconPuzzle,
} from "@/components/icons";
import { ToolDetail } from "@/components/apps/tool-detail";
import { t } from "@/lib/i18n";
import type { SkillRecord, SkillDefinition } from "@/types";

/** Unified tool item — either a skill or an MCP server. */
interface ToolItem {
  id: string;
  name: string;
  kind: "skill" | "mcp";
  description: string;
  status: "active" | "available" | "error" | "disabled" | "needs_config";
  error?: string;
  missingEnv?: string[];
  // Skill-specific
  skillRecord?: SkillRecord;
  dirPath?: string;
  hasScripts?: boolean;
  // MCP-specific
  toolCount?: number;
  builtin?: boolean;
  requiredEnv?: Record<string, string>;
  callTimeoutMs?: number;
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
        description: server.description || (server.toolCount > 0 ? `${server.toolCount} ${t("tools.providedTools")}` : ""),
        status: server.status as ToolItem["status"],
        error: server.error,
        missingEnv: server.missingEnv,
        toolCount: server.toolCount,
        builtin: false,
        dirPath: server.dirPath,
        requiredEnv: server.requiredEnv,
        callTimeoutMs: server.callTimeoutMs,
      });
    }

    setTools(toolItems);
  }

  // Show detail page when a tool is selected
  if (selectedTool) {
    return <ToolDetail tool={selectedTool} onBack={() => setSelectedTool(null)} onRefresh={() => { loadData(); setSelectedTool(null); }} />;
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
    </div>
  );
}

// ---- Tool Card ----

function ToolCard({ tool, onClick }: { tool: ToolItem; onClick: () => void }) {
  const isSkill = tool.kind === "skill";
  const statusColors: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-600",
    available: "bg-emerald-50 text-emerald-600",
    error: "bg-red-50 text-red-500",
    needs_config: "bg-amber-50 text-amber-600",
    disabled: "bg-[var(--surface-low)] text-[var(--on-surface-tertiary)]",
  };
  const iconBg = statusColors[tool.status] || statusColors.active;

  // Status label for MCP
  const statusLabel = isSkill ? null
    : tool.status === "available" ? `${tool.toolCount || 0} tools`
    : tool.status === "error" ? t("connections.error")
    : tool.status === "needs_config" ? t("tools.needsConfig")
    : tool.status === "disabled" ? t("connections.disabled")
    : null;

  return (
    <button
      onClick={onClick}
      className="w-full bg-[var(--surface-lowest)] border border-[var(--border)] rounded-xl px-4 py-3 flex items-center gap-4 hover:shadow-[var(--shadow-sm)] hover:border-[var(--on-surface-tertiary)] transition-all cursor-pointer text-left"
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
        {isSkill ? <IconPuzzle size={16} /> : <IconServer size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-[var(--on-surface)]">{tool.name}</span>
          <span className={`text-[10px] px-1.5 py-[1px] rounded-full font-medium ${isSkill ? "bg-purple-50 text-purple-600" : "bg-blue-50 text-blue-600"}`}>
            {isSkill ? t("tools.type.skill") : t("tools.type.mcp")}
          </span>
        </div>
        <div className="text-[11px] text-[var(--on-surface-tertiary)] truncate">
          {tool.description}
        </div>
      </div>
      {/* Right side: status for MCP, error icon for errors */}
      <div className="flex items-center gap-2 shrink-0">
        {statusLabel && (
          <span className={`text-[11px] px-2 py-0.5 rounded-full ${
            tool.status === "available" ? "bg-emerald-50 text-emerald-600"
            : tool.status === "error" ? "bg-red-50 text-red-500"
            : "bg-gray-100 text-gray-500"
          }`}>
            {statusLabel}
          </span>
        )}
        {tool.status === "error" && <IconWarning size={14} className="text-[var(--error)]" />}
      </div>
    </button>
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
  const [tab, setTab] = useState<"skills" | "mcps">("skills");
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skillStatuses, setSkillStatuses] = useState<InstallStatus[]>([]);
  const [mcpStatuses, setMcpStatuses] = useState<InstallStatus[]>([]);

  useEffect(() => {
    getSkillInstallStatus().then(setSkillStatuses);
    getMcpInstallStatus().then(setMcpStatuses);
  }, []);

  async function handleInstallSkill(id: string) {
    setInstalling(id); setError(null);
    try {
      await installCatalogSkill(id);
      await skillRegistry.reload();
      const s = await getSkillInstallStatus();
      setSkillStatuses(s);
      onAdded();
    } catch (e) { setError(String(e)); }
    setInstalling(null);
  }

  async function handleInstallMcp(id: string) {
    setInstalling(id); setError(null);
    try {
      await installCatalogMcp(id);
      await mcpManager.reload();
      const s = await getMcpInstallStatus();
      setMcpStatuses(s);
      onAdded();
    } catch (e) { setError(String(e)); }
    setInstalling(null);
  }

  return (
    <DialogOverlay onClose={onClose}>
      <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">{t("tools.add")}</h2>
        <button onClick={onClose} className="p-1 rounded-lg text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)] cursor-pointer"><IconClose size={16} /></button>
      </div>
      <div className="px-6 py-5">
        <div className="flex gap-1 mb-4 p-1 rounded-lg bg-[var(--surface-low)]">
          {([["skills", t("tools.installSkill")], ["mcps", t("tools.addService")]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} className={`flex-1 py-1.5 rounded-md text-[12px] font-medium cursor-pointer transition-colors ${tab === key ? "bg-[var(--surface-lowest)] text-[var(--on-surface)] shadow-sm" : "text-[var(--on-surface-tertiary)]"}`}>{label}</button>
          ))}
        </div>

        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {tab === "skills" ? (
            CATALOG_SKILLS.map((skill) => {
              const status = skillStatuses.find((s) => s.id === skill.id);
              return (
                <CatalogItem
                  key={skill.id}
                  name={skill.name}
                  description={skill.description}
                  version={skill.version}
                  icon={<IconPuzzle size={16} />}
                  iconBg="bg-purple-50 text-purple-600"
                  installed={status?.installed || false}
                  needsUpdate={status?.needsUpdate || false}
                  installedVersion={status?.installedVersion || null}
                  installing={installing === skill.id}
                  onInstall={() => handleInstallSkill(skill.id)}
                />
              );
            })
          ) : (
            CATALOG_MCPS.map((mcp) => {
              const status = mcpStatuses.find((s) => s.id === mcp.id);
              return (
                <CatalogItem
                  key={mcp.id}
                  name={mcp.name}
                  description={mcp.description}
                  version={mcp.version}
                  icon={<IconServer size={16} />}
                  iconBg="bg-blue-50 text-blue-600"
                  installed={status?.installed || false}
                  needsUpdate={status?.needsUpdate || false}
                  installedVersion={status?.installedVersion || null}
                  installing={installing === mcp.id}
                  onInstall={() => handleInstallMcp(mcp.id)}
                />
              );
            })
          )}
        </div>

        {error && <div className="mt-3 p-3 rounded-lg bg-[var(--error-light)] text-[var(--error)] text-[12px]">{error}</div>}
      </div>
    </DialogOverlay>
  );
}

function CatalogItem({ name, description, version, icon, iconBg, installed, needsUpdate, installedVersion, installing, onInstall }: {
  name: string; description: string; version: string;
  icon: React.ReactNode; iconBg: string;
  installed: boolean; needsUpdate: boolean; installedVersion: string | null;
  installing: boolean; onInstall: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--surface-lowest)]">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-[var(--on-surface)]">{name}</span>
          <span className="text-[10px] text-[var(--on-surface-tertiary)]">v{version}</span>
        </div>
        <div className="text-[11px] text-[var(--on-surface-tertiary)] truncate">{description}</div>
      </div>
      {installed && !needsUpdate ? (
        <span className="text-[11px] text-emerald-600 px-2 py-1 rounded-lg bg-emerald-50">
          v{installedVersion}
        </span>
      ) : (
        <button
          onClick={onInstall}
          disabled={installing}
          className="px-3 py-1.5 rounded-lg text-[12px] bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] cursor-pointer disabled:opacity-40 transition-colors shrink-0"
        >
          {installing ? "..." : needsUpdate ? `Update → v${version}` : "Install"}
        </button>
      )}
    </div>
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
