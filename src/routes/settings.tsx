import { useState, useEffect } from "react";
import { getSettings, saveSettings } from "@/lib/db";
import { useAppStore } from "@/stores/app-store";
import { t } from "@/lib/i18n";
import type { Settings } from "@/types";

const ANTHROPIC_MODELS = [
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { id: "claude-opus-4-20250514", label: "Claude Opus 4" },
  { id: "claude-haiku-4-20250514", label: "Claude Haiku 4" },
];

const OPENAI_MODELS = [
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "o3-mini", label: "o3 Mini" },
];

const inputClass = "w-full px-3 py-2 bg-[var(--surface-lowest)] border border-[var(--border)] rounded-lg text-[13px] text-[var(--on-surface)] placeholder:text-[var(--on-surface-tertiary)] focus:outline-none focus:border-[var(--primary-light)] focus:ring-2 focus:ring-[var(--primary-accent)]/20";

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [customModel, setCustomModel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const loadAppState = useAppStore((s) => s.load);

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      const presets = s.llmProvider === "anthropic" ? ANTHROPIC_MODELS : OPENAI_MODELS;
      if (s.modelId && !presets.find((m) => m.id === s.modelId)) {
        setCustomModel(true);
      }
    });
  }, []);

  if (!settings) return null;

  const models = settings.llmProvider === "anthropic" ? ANTHROPIC_MODELS : OPENAI_MODELS;
  const currentKey = settings.llmProvider === "anthropic" ? settings.anthropicApiKey : settings.openaiApiKey;
  const currentBaseUrl = settings.llmProvider === "anthropic" ? settings.anthropicBaseUrl : settings.openaiBaseUrl;

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    await saveSettings(settings);
    await loadAppState();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function updateField<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      if (key === "llmProvider") {
        const presets = value === "anthropic" ? ANTHROPIC_MODELS : OPENAI_MODELS;
        next.modelId = presets[0].id;
        setCustomModel(false);
      }
      return next;
    });
    setSaved(false);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto py-10 px-6">
        <h1 className="text-[18px] font-semibold mb-6 text-[var(--on-surface)]">{t("settings.title")}</h1>

        <section className="mb-6">
          <label className="block text-[13px] font-medium mb-2 text-[var(--on-surface)]">{t("settings.provider")}</label>
          <div className="flex gap-2">
            {(["anthropic", "openai"] as const).map((p) => (
              <button
                key={p}
                onClick={() => updateField("llmProvider", p)}
                className={`px-4 py-[7px] rounded-lg text-[13px] cursor-pointer transition-colors ${
                  settings.llmProvider === p
                    ? "bg-[var(--primary-light)] text-white"
                    : "bg-[var(--surface-container)] text-[var(--on-surface-secondary)] hover:bg-[var(--surface-high)]"
                }`}
              >
                {p === "anthropic" ? "Anthropic (Claude)" : "OpenAI"}
              </button>
            ))}
          </div>
        </section>

        <section className="mb-6">
          <label className="block text-[13px] font-medium mb-2 text-[var(--on-surface)]">{t("settings.apiKey")}</label>
          <input
            type="password"
            value={currentKey || ""}
            onChange={(e) => {
              const key = settings.llmProvider === "anthropic" ? "anthropicApiKey" : "openaiApiKey";
              updateField(key, e.target.value);
            }}
            placeholder="sk-..."
            className={inputClass}
          />
        </section>

        <section className="mb-6">
          <label className="block text-[13px] font-medium mb-2 text-[var(--on-surface)]">
            {t("settings.baseUrl")}
            <span className="text-[var(--on-surface-tertiary)] font-normal ml-1">{t("settings.baseUrl.optional")}</span>
          </label>
          <input
            type="text"
            value={currentBaseUrl || ""}
            onChange={(e) => {
              const key = settings.llmProvider === "anthropic" ? "anthropicBaseUrl" : "openaiBaseUrl";
              updateField(key, e.target.value || undefined);
            }}
            placeholder={settings.llmProvider === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"}
            className={inputClass}
          />
          <p className="text-[11px] text-[var(--on-surface-tertiary)] mt-1.5">{t("settings.baseUrl.hint")}</p>
        </section>

        <section className="mb-8">
          <label className="block text-[13px] font-medium mb-2 text-[var(--on-surface)]">{t("settings.model")}</label>
          {!customModel ? (
            <>
              <select
                value={settings.modelId || models[0].id}
                onChange={(e) => updateField("modelId", e.target.value)}
                className={inputClass}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              <button onClick={() => setCustomModel(true)} className="text-[11px] text-[var(--primary-light)] mt-1.5 cursor-pointer hover:underline">
                {t("settings.customModel")}
              </button>
            </>
          ) : (
            <>
              <input
                type="text"
                value={settings.modelId || ""}
                onChange={(e) => updateField("modelId", e.target.value)}
                placeholder="model-id"
                className={inputClass}
              />
              <button onClick={() => { setCustomModel(false); updateField("modelId", models[0].id); }} className="text-[11px] text-[var(--primary-light)] mt-1.5 cursor-pointer hover:underline">
                {t("settings.presetModel")}
              </button>
            </>
          )}
        </section>

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-[var(--primary-light)] hover:bg-[var(--primary)] text-white rounded-lg text-[13px] cursor-pointer transition-colors disabled:opacity-50"
        >
          {saving ? t("settings.saving") : saved ? t("settings.saved") : t("settings.save")}
        </button>
      </div>
    </div>
  );
}
