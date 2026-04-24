import { create } from "zustand";
import { listSources, getSettings } from "@/lib/db";
import { mcpManager } from "@/lib/mcp";
import type { Source, Settings } from "@/types";

interface McpServerInfo {
  id: string;
  name: string;
  status: string;
  toolCount: number;
}

interface AppState {
  initialized: boolean;
  sources: Source[];
  settings: Settings | null;
  hasApiKey: boolean;
  isFirstTime: boolean;
  mcpServers: McpServerInfo[];

  load: () => Promise<void>;
  refreshSources: () => Promise<void>;
  refreshMcp: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  initialized: false,
  sources: [],
  settings: null,
  hasApiKey: false,
  isFirstTime: true,
  mcpServers: [],

  load: async () => {
    const [sources, settings] = await Promise.all([listSources(), getSettings()]);
    const hasApiKey = !!(settings.anthropicApiKey || settings.openaiApiKey);
    const mcpServers = mcpManager.getServerStatus().map((s) => ({
      id: s.id, name: s.name, status: s.status, toolCount: s.toolCount,
    }));
    set({
      initialized: true,
      sources,
      settings,
      hasApiKey,
      isFirstTime: sources.length === 0,
      mcpServers,
    });
  },

  refreshSources: async () => {
    const sources = await listSources();
    set({ sources, isFirstTime: sources.length === 0 });
  },

  refreshMcp: () => {
    const mcpServers = mcpManager.getServerStatus().map((s) => ({
      id: s.id, name: s.name, status: s.status, toolCount: s.toolCount,
    }));
    set({ mcpServers });
  },
}));
