import { useState, useEffect } from "react";
import { getSettings, saveSettings } from "@/lib/db";
import { useAppStore } from "@/stores/app-store";
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

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [customModel, setCustomModel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const loadAppState = useAppStore((s) => s.load);

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      // Check if model ID is not in presets — enable custom input
      const presets = s.llmProvider === "anthropic" ? ANTHROPIC_MODELS : OPENAI_MODELS;
      if (s.modelId && !presets.find((m) => m.id === s.modelId)) {
        setCustomModel(true);
      }
    });
  }, []);

  if (!settings) return null;

  const models = settings.llmProvider === "anthropic" ? ANTHROPIC_MODELS : OPENAI_MODELS;
  const currentKey =
    settings.llmProvider === "anthropic" ? settings.anthropicApiKey : settings.openaiApiKey;
  const currentBaseUrl =
    settings.llmProvider === "anthropic" ? settings.anthropicBaseUrl : settings.openaiBaseUrl;

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    await saveSettings(settings);
    await loadAppState(); // Refresh app state (hasApiKey etc.)
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
        <h1 className="text-xl font-semibold mb-6">Settings</h1>

        {/* Provider */}
        <section className="mb-6">
          <label className="block text-sm font-medium mb-2">LLM Provider</label>
          <div className="flex gap-2">
            {(["anthropic", "openai"] as const).map((p) => (
              <button
                key={p}
                onClick={() => updateField("llmProvider", p)}
                className={`px-4 py-2 rounded text-sm cursor-pointer transition-colors ${
                  settings.llmProvider === p
                    ? "bg-[var(--color-accent)] text-white"
                    : "bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
                }`}
              >
                {p === "anthropic" ? "Anthropic (Claude)" : "OpenAI"}
              </button>
            ))}
          </div>
        </section>

        {/* API Key */}
        <section className="mb-6">
          <label className="block text-sm font-medium mb-2">API Key</label>
          <input
            type="password"
            value={currentKey || ""}
            onChange={(e) => {
              const key = settings.llmProvider === "anthropic" ? "anthropicApiKey" : "openaiApiKey";
              updateField(key, e.target.value);
            }}
            placeholder={`Enter your ${settings.llmProvider === "anthropic" ? "Anthropic" : "OpenAI"} API key`}
            className="w-full px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-accent)]"
          />
        </section>

        {/* API Base URL */}
        <section className="mb-6">
          <label className="block text-sm font-medium mb-2">
            API Base URL
            <span className="text-[var(--color-text-tertiary)] font-normal ml-1">(optional)</span>
          </label>
          <input
            type="text"
            value={currentBaseUrl || ""}
            onChange={(e) => {
              const key = settings.llmProvider === "anthropic" ? "anthropicBaseUrl" : "openaiBaseUrl";
              updateField(key, e.target.value || undefined);
            }}
            placeholder={
              settings.llmProvider === "anthropic"
                ? "https://api.anthropic.com (default)"
                : "https://api.openai.com/v1 (default)"
            }
            className="w-full px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
            Custom endpoint for proxies or compatible services (e.g. Ollama, vLLM, Azure OpenAI).
          </p>
        </section>

        {/* Model */}
        <section className="mb-6">
          <label className="block text-sm font-medium mb-2">Model</label>
          {!customModel ? (
            <>
              <select
                value={settings.modelId || models[0].id}
                onChange={(e) => updateField("modelId", e.target.value)}
                className="w-full px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setCustomModel(true)}
                className="text-xs text-[var(--color-accent)] mt-1 cursor-pointer hover:underline"
              >
                Use custom model ID
              </button>
            </>
          ) : (
            <>
              <input
                type="text"
                value={settings.modelId || ""}
                onChange={(e) => updateField("modelId", e.target.value)}
                placeholder="Enter model ID (e.g. claude-sonnet-4-20250514)"
                className="w-full px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-accent)]"
              />
              <button
                onClick={() => {
                  setCustomModel(false);
                  updateField("modelId", models[0].id);
                }}
                className="text-xs text-[var(--color-accent)] mt-1 cursor-pointer hover:underline"
              >
                Choose from presets
              </button>
            </>
          )}
        </section>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white rounded text-sm cursor-pointer transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : saved ? "Saved" : "Save"}
        </button>
      </div>
    </div>
  );
}
