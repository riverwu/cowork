/// <reference types="vite/client" />

interface Window {
  cowork?: {
    runtime: "electron";
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    listen<T>(channel: string, handler: (payload: T) => void): () => void;
  };
}
