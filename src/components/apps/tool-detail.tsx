/**
 * Tool Detail Page — rich detail view for skills and MCP tools.
 * Matches Codex's plugin/skill detail page pattern.
 */

import { useState, useEffect } from "react";
import {
  IconPuzzle, IconServer, IconArrowLeft,
  IconDocument, IconWarning,
} from "@/components/icons";
import { mcpManager } from "@/lib/mcp";
import { readFileText } from "@/lib/tauri";
import { getMcpEnvConfig, setMcpEnvVar } from "@/lib/db";
import { uninstallSkill } from "@/lib/catalog-installer";
import { skillRegistry } from "@/lib/ai/skill-registry";
import { t } from "@/lib/i18n";
import type { SkillRecord } from "@/types";

interface ToolDetailProps {
  tool: {
    id: string;
    name: string;
    kind: "skill" | "mcp";
    description: string;
    status: string;
    error?: string;
    missingEnv?: string[];
    skillRecord?: SkillRecord;
    dirPath?: string;
    hasScripts?: boolean;
    toolCount?: number;
    builtin?: boolean;
    requiredEnv?: Record<string, string>;
  };
  onBack: () => void;
  onRefresh: () => void;
}

export function ToolDetail({ tool, onBack, onRefresh }: ToolDetailProps) {
  const isSkill = tool.kind === "skill";
  const [skillMdContent, setSkillMdContent] = useState<string | null>(null);
  const [mcpConfigContent, setMcpConfigContent] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [scriptFiles, setScriptFiles] = useState<string[]>([]);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [envSaving, setEnvSaving] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallError, setUninstallError] = useState<string | null>(null);

  useEffect(() => {
    // Load SKILL.md content for skills
    if (isSkill && tool.dirPath) {
      readFileText(`${tool.dirPath}/SKILL.md`).then(setSkillMdContent).catch(() => {});
      // List scripts
      if (tool.hasScripts) {
        import("@/lib/tauri").then(({ listDirectory }) => {
          listDirectory(`${tool.dirPath}/scripts`).then((files) => {
            setScriptFiles(files.filter((f) => !f.is_dir).map((f) => f.name));
          }).catch(() => {});
        });
      }
    }
    // Load MCP config from per-directory MCP.json
    if (!isSkill && tool.dirPath) {
      readFileText(`${tool.dirPath}/MCP.json`).then(setMcpConfigContent).catch(() => {});
      // Load user's env config
      const mcpId = tool.id.replace("mcp_", "");
      getMcpEnvConfig(mcpId).then(setEnvValues).catch(() => {});
    }
  }, [tool, isSkill]);

  const instructions = tool.skillRecord?.definition.instructions || [];
  const purpose = tool.skillRecord?.definition.purpose || tool.description;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-6">
        {/* Back button */}
        <button onClick={onBack} className="flex items-center gap-1.5 text-[12px] text-[var(--on-surface-tertiary)] hover:text-[var(--on-surface)] cursor-pointer transition-colors mb-6">
          <IconArrowLeft size={14} />
          {t("home.backToHome")}
        </button>

        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isSkill ? "bg-purple-50 text-purple-600" : "bg-blue-50 text-blue-600"}`}>
            {isSkill ? <IconPuzzle size={24} /> : <IconServer size={24} />}
          </div>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-[var(--on-surface)]">{tool.name}</h1>
            <p className="text-[14px] text-[var(--on-surface-secondary)] mt-0.5">{purpose}</p>
          </div>
          {/* Status badge */}
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${tool.status === "active" || tool.status === "available" ? "bg-emerald-500" : tool.status === "error" ? "bg-red-500" : "bg-gray-400"}`} />
            <span className="text-[12px] text-[var(--on-surface-tertiary)]">{tool.status}</span>
          </div>
        </div>

        {/* Example usage cards */}
        {instructions.length > 0 && (
          <div className="mb-8 p-5 rounded-2xl bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
            <div className="space-y-2.5">
              {instructions.slice(0, 3).map((inst, i) => (
                <div key={i} className="flex items-start gap-2 text-[13px]">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/80 text-[11px] font-medium text-[var(--primary-accent)] shrink-0 mt-0.5">
                    {tool.name}
                  </span>
                  <span className="text-[var(--on-surface-secondary)]">{inst}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Description — full purpose text */}
        {purpose && (
          <div className="mb-8">
            <p className="text-[13px] text-[var(--on-surface-secondary)] leading-relaxed">{purpose}</p>
          </div>
        )}

        {/* Error */}
        {tool.error && (
          <div className="mb-6 p-4 rounded-xl bg-[var(--error-light)] flex items-start gap-2">
            <IconWarning size={16} className="text-[var(--error)] mt-0.5 shrink-0" />
            <p className="text-[13px] text-[var(--error)]">{tool.error}</p>
          </div>
        )}

        {/* Env configuration (for MCP with required env vars) */}
        {!isSkill && tool.requiredEnv && Object.keys(tool.requiredEnv).length > 0 && (
          <section className="mb-8">
            <h2 className="text-[14px] font-semibold text-[var(--on-surface)] mb-3">{t("tools.config")}</h2>
            <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] p-4 space-y-3">
              {Object.entries(tool.requiredEnv).map(([varName]) => (
                <div key={varName}>
                  <label className="block text-[12px] font-medium text-[var(--on-surface-secondary)] mb-1">
                    {varName}
                    {tool.missingEnv?.includes(varName) && (
                      <span className="ml-2 text-[10px] text-[var(--error)]">required</span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={envValues[varName] || ""}
                    onChange={(e) => setEnvValues((prev) => ({ ...prev, [varName]: e.target.value }))}
                    placeholder={`Enter ${varName}`}
                    className="w-full px-3 py-2 bg-[var(--surface-low)] border border-[var(--border)] rounded-lg text-[13px] font-mono text-[var(--on-surface)] placeholder:text-[var(--on-surface-tertiary)] focus:outline-none focus:border-[var(--primary-accent)]"
                  />
                </div>
              ))}
              <button
                onClick={async () => {
                  setEnvSaving(true);
                  const mcpId = tool.id.replace("mcp_", "");
                  for (const [varName, value] of Object.entries(envValues)) {
                    if (value) await setMcpEnvVar(mcpId, varName, value);
                  }
                  // Reconnect with new env
                  await mcpManager.reconnectServer(mcpId);
                  setEnvSaving(false);
                  onRefresh();
                }}
                disabled={envSaving}
                className="px-4 py-2 rounded-lg text-[13px] bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] cursor-pointer transition-colors disabled:opacity-40"
              >
                {envSaving ? "..." : t("apps.save")}
              </button>
            </div>
          </section>
        )}

        {/* Contains — sub-tools list (for MCP with connected tools) */}
        {!isSkill && tool.toolCount !== undefined && tool.toolCount > 0 && (
          <section className="mb-8">
            <h2 className="text-[14px] font-semibold text-[var(--on-surface)] mb-3">{t("tools.contains")}</h2>
            <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]">
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center"><IconServer size={14} /></div>
                <div>
                  <div className="text-[13px] font-medium text-[var(--on-surface)]">{tool.name}</div>
                  <div className="text-[11px] text-[var(--on-surface-tertiary)]">{tool.toolCount} tools provided</div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Contains — scripts list (for skills) */}
        {isSkill && scriptFiles.length > 0 && (
          <section className="mb-8">
            <h2 className="text-[14px] font-semibold text-[var(--on-surface)] mb-3">{t("tools.scripts")}</h2>
            <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]">
              {scriptFiles.map((file, i) => (
                <div key={i} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-50 text-gray-600 flex items-center justify-center"><IconDocument size={14} /></div>
                  <div>
                    <div className="text-[13px] font-medium text-[var(--on-surface)] font-mono">{file}</div>
                    <div className="text-[11px] text-[var(--on-surface-tertiary)]">{tool.dirPath}/scripts/{file}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Source file viewer */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[14px] font-semibold text-[var(--on-surface)]">
              {isSkill ? t("tools.sourceFile") : t("tools.configFile")}
            </h2>
            <button
              onClick={() => setShowSource(!showSource)}
              className="text-[12px] text-[var(--primary-accent)] hover:underline cursor-pointer"
            >
              {showSource ? "Hide" : t("tools.viewSource")}
            </button>
          </div>
          {showSource && (
            <div className="bg-[var(--surface-container)] rounded-xl p-4 overflow-x-auto">
              <pre className="text-[12px] font-mono text-[var(--on-surface-secondary)] leading-relaxed whitespace-pre-wrap">
                {isSkill ? (skillMdContent || "Loading...") : (mcpConfigContent || "Loading...")}
              </pre>
            </div>
          )}
          {!showSource && (
            <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] px-4 py-3">
              <span className="text-[12px] font-mono text-[var(--on-surface-tertiary)]">
                {isSkill ? `${tool.dirPath}/SKILL.md` : `${tool.dirPath}/MCP.json`}
              </span>
            </div>
          )}
        </section>

        {/* Info table */}
        <section className="mb-8">
          <h2 className="text-[14px] font-semibold text-[var(--on-surface)] mb-3">{t("tools.info")}</h2>
          <div className="bg-[var(--surface-lowest)] rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]">
            <InfoRow label={t("tools.info.type")} value={isSkill ? t("tools.type.skill") : t("tools.type.mcp")} />
            {isSkill && tool.dirPath && (
              <InfoRow label={t("tools.info.directory")} value={tool.dirPath} mono />
            )}
            {!isSkill && tool.builtin && (
              <InfoRow label={t("tools.info.source")} value={t("connections.builtin")} />
            )}
            {tool.skillRecord?.definition.requiredConfig && Object.keys(tool.skillRecord.definition.requiredConfig).length > 0 && (
              <InfoRow
                label={t("tools.config")}
                value={Object.entries(tool.skillRecord.definition.requiredConfig).map(([k, v]) => `${k}: ${v}`).join(", ")}
              />
            )}
          </div>
        </section>

        {/* Skill actions */}
        {isSkill && tool.dirPath && (
          <div className="flex flex-col gap-2">
            <button
              onClick={async () => {
                if (!tool.dirPath) return;
                if (!confirm(t("tools.uninstallConfirm").replace("{name}", tool.name))) return;
                setUninstalling(true);
                setUninstallError(null);
                try {
                  await uninstallSkill(tool.dirPath);
                  await skillRegistry.reload();
                  onRefresh();
                } catch (err) {
                  setUninstallError(String(err));
                  setUninstalling(false);
                }
              }}
              disabled={uninstalling}
              className="self-start px-4 py-2 rounded-lg text-[13px] bg-red-50 text-[var(--error)] cursor-pointer disabled:opacity-50"
            >
              {uninstalling ? t("tools.uninstalling") : t("tools.uninstall")}
            </button>
            {uninstallError && (
              <p className="text-[12px] text-[var(--error)]">{uninstallError}</p>
            )}
          </div>
        )}

        {/* MCP actions */}
        {!isSkill && (
          <div className="flex gap-2">
            {tool.status === "error" && (
              <button
                onClick={async () => { await mcpManager.reconnectServer(tool.id.replace("mcp_", "")); onRefresh(); }}
                className="px-4 py-2 rounded-lg text-[13px] bg-[var(--primary-accent)] text-white hover:bg-[var(--primary)] cursor-pointer"
              >
                {t("connections.reconnect")}
              </button>
            )}
            <button
              onClick={async () => {
                const mcpId = tool.id.replace("mcp_", "");
                if (tool.status === "disabled") await mcpManager.enableServer(mcpId);
                else await mcpManager.removeServer(mcpId);
                onRefresh();
              }}
              className={`px-4 py-2 rounded-lg text-[13px] cursor-pointer ${tool.status === "disabled" ? "bg-[var(--surface-low)] text-[var(--primary-accent)]" : "bg-red-50 text-[var(--error)]"}`}
            >
              {tool.status === "disabled" ? t("connections.enable") : t("connections.disable")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center px-4 py-3">
      <span className="text-[13px] text-[var(--on-surface-tertiary)] w-[100px] shrink-0">{label}</span>
      <span className={`text-[13px] text-[var(--on-surface)] ${mono ? "font-mono text-[12px]" : ""}`}>{value}</span>
    </div>
  );
}
