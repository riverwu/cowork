import { create } from "zustand";
import { listSources, getSettings } from "@/lib/db";
import type { Source, Settings } from "@/types";

interface AppState {
  initialized: boolean;
  sources: Source[];
  settings: Settings | null;
  hasApiKey: boolean;

  /** Check if user has gone through setup. */
  isFirstTime: boolean;

  load: () => Promise<void>;
  refreshSources: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  initialized: false,
  sources: [],
  settings: null,
  hasApiKey: false,
  isFirstTime: true,

  load: async () => {
    const [sources, settings] = await Promise.all([listSources(), getSettings()]);
    const hasApiKey = !!(settings.anthropicApiKey || settings.openaiApiKey);
    set({
      initialized: true,
      sources,
      settings,
      hasApiKey,
      isFirstTime: sources.length === 0,
    });
  },

  refreshSources: async () => {
    const sources = await listSources();
    set({ sources, isFirstTime: sources.length === 0 });
  },
}));
