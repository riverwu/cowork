import { create } from "zustand";
import type { Artifact } from "@/types";

export interface WorkspaceDocument {
  id: string;
  path: string;
  title: string;
  source: "conversation" | "recent_output" | "artifact" | "knowledge";
}

interface ViewPanel {
  id: string;
  artifact: Artifact;
  pinned: boolean;
  fullscreen: boolean;
}

interface ViewState {
  panels: ViewPanel[];
  documentWorkspace: WorkspaceDocument | null;
  addPanel: (artifact: Artifact) => void;
  removePanel: (id: string) => void;
  togglePin: (id: string) => void;
  toggleFullscreen: (id: string) => void;
  openDocument: (document: Omit<WorkspaceDocument, "id">) => void;
  closeDocument: () => void;
  clear: () => void;
}

export const useViewStore = create<ViewState>((set) => ({
  panels: [],
  documentWorkspace: null,

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

  openDocument: (document) => {
    set({
      documentWorkspace: {
        ...document,
        id: `doc:${document.path}`,
      },
    });
  },

  closeDocument: () => set({ documentWorkspace: null }),

  clear: () => set({ panels: [], documentWorkspace: null }),
}));
