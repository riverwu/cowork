import { useState, useEffect } from "react";
import { getSettings, saveSettings } from "@/lib/db";
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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  if (!settings) return null;

  const models = settings.llmProvider === "anthropic" ? ANTHROPIC_MODELS : OPENAI_MODELS;
  const currentKey =
    settings.llmProvider === "anthropic" ? settings.anthropicApiKey : settings.openaiApiKey;

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    await saveSettings(settings);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function updateField<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      // Reset model when switching provider
      if (key === "llmProvider") {
        next.modelId = value === "anthropic" ? ANTHROPIC_MODELS[0].id : OPENAI_MODELS[0].id;
      }
      return next;
    });
    setSaved(false);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto py-10 px-6">
        <h1 className="text-xl font-semibold mb-6">Settings</h1>

        {/* Provider selection */}
        <section className="mb-8">
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
        <section className="mb-8">
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

        {/* Model selection */}
        <section className="mb-8">
          <label className="block text-sm font-medium mb-2">Model</label>
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
        </section>

        {/* Save button */}
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
