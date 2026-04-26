import { create } from "zustand";
import type { Artifact } from "@/types";

interface ViewPanel {
  id: string;
  artifact: Artifact;
  pinned: boolean;
  fullscreen: boolean;
}

interface ViewState {
  panels: ViewPanel[];
  addPanel: (artifact: Artifact) => void;
  removePanel: (id: string) => void;
  togglePin: (id: string) => void;
  toggleFullscreen: (id: string) => void;
  clear: () => void;
}

export const useViewStore = create<ViewState>((set) => ({
  panels: [],

  addPanel: (artifact) => {
    set((s) => ({
      panels: [
        ...s.panels,
        { id: artifact.id, artifact, pinned: false, fullscreen: false },
      ],
    }));
  },

  removePanel: (id) => {
    set((s) => ({ panels: s.panels.filter((p) => p.id !== id) }));
  },

  togglePin: (id) => {
    set((s) => ({
      panels: s.panels.map((p) =>
        p.id === id ? { ...p, pinned: !p.pinned } : p,
      ),
    }));
  },

  toggleFullscreen: (id) => {
    set((s) => ({
      panels: s.panels.map((p) =>
        p.id === id ? { ...p, fullscreen: !p.fullscreen } : p,
      ),
    }));
  },

  clear: () => set({ panels: [] }),
}));
