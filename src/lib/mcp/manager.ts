/**
 * MCP Manager — manages MCP server connections.
 *
 * Each MCP server is a directory: ~/.cowork/mcps/<name>/MCP.json
 * Filesystem is source of truth (like skills).
 */

import { McpClient } from "./client";
import type { Skill } from "@/lib/ai/skills/types";
import { loadMcpsFromFilesystem, installMcpToFilesystem, getMcpsDir, type LoadedMcp, type McpDefinition } from "./loader";
import { ensureUvInstalled } from "@/lib/tauri";

interface ServerState {
  status: "connecting" | "connected" | "error" | "disabled";
  error?: string;
}

class McpManager {
  private clients = new Map<string, McpClient>();
  private loadedMcps: LoadedMcp[] = [];
  private serverStates = new Map<string, ServerState>();
  private onChangeCallbacks: Array<() => void> = [];

  onChange(cb: () => void): () => void {
    this.onChangeCallbacks.push(cb);
    return () => { this.onChangeCallbacks = this.onChangeCallbacks.filter((c) => c !== cb); };
  }

  private notifyChange() {
    for (const cb of this.onChangeCallbacks) cb();
  }

  /** Load MCP configs from filesystem and connect all enabled servers. */
  async initialize(): Promise<void> {
    await this.reload();
  }

  /** Reload configs from filesystem and reconnect. */
  async reload(): Promise<void> {
    // Disconnect existing
    for (const client of this.clients.values()) {
      await client.disconnect().catch(() => {});
    }
    this.clients.clear();
    this.serverStates.clear();

    // Load from filesystem
    this.loadedMcps = await loadMcpsFromFilesystem();

    // Check if uv needed
    const needsUv = this.loadedMcps.some(
      (m) => m.definition.enabled !== false && m.definition.command === "uvx",
    );
    if (needsUv) {
      try { await ensureUvInstalled(); } catch (err) { console.warn("uv install:", err); }
    }

    // Connect all enabled
    await Promise.allSettled(
      this.loadedMcps
        .filter((m) => m.definition.enabled !== false)
        .map((m) => this.connectServer(m)),
    );
  }

  /** Get all tools from connected MCP servers as Skills. */
  getAllSkills(): Record<string, Skill> {
    const allSkills: Record<string, Skill> = {};
    for (const client of this.clients.values()) {
      if (client.isConnected()) {
        Object.assign(allSkills, client.toSkills());
      }
    }
    return allSkills;
  }

  /** Get server status for UI display. */
  getServerStatus(): Array<{
    id: string; name: string; connected: boolean; toolCount: number;
    builtin: boolean; enabled: boolean;
    status: "connecting" | "connected" | "error" | "disabled";
    error?: string;
    version: string; description: string; dirPath: string;
  }> {
    return this.loadedMcps.map((m) => {
      const client = this.clients.get(m.id);
      const state = this.serverStates.get(m.id);
      const enabled = m.definition.enabled !== false;
      return {
        id: m.id,
        name: m.definition.name,
        connected: client?.isConnected() || false,
        toolCount: client?.getTools().length || 0,
        builtin: false,
        enabled,
        status: !enabled ? "disabled" : (state?.status || "connecting"),
        error: state?.error,
        version: m.definition.version,
        description: m.definition.description || "",
        dirPath: m.dirPath,
      };
    });
  }

  /** Get loaded MCP definitions (for catalog comparison). */
  getLoadedMcps(): LoadedMcp[] {
    return this.loadedMcps;
  }

  /** Install a new MCP server from definition. */
  async addServer(id: string, definition: McpDefinition): Promise<void> {
    await installMcpToFilesystem(id, definition);
    // Reload to pick up the new server
    const newMcps = await loadMcpsFromFilesystem();
    const newMcp = newMcps.find((m) => m.id === id);
    if (newMcp) {
      this.loadedMcps = newMcps;
      await this.connectServer(newMcp);
    }
  }

  /** Remove (disable) an MCP server. */
  async removeServer(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      await client.disconnect();
      this.clients.delete(id);
    }
    // Update MCP.json to set enabled=false
    const mcp = this.loadedMcps.find((m) => m.id === id);
    if (mcp) {
      mcp.definition.enabled = false;
      await installMcpToFilesystem(id, mcp.definition);
      this.serverStates.set(id, { status: "disabled" });
    }
    this.notifyChange();
  }

  /** Enable a disabled server. */
  async enableServer(id: string): Promise<void> {
    const mcp = this.loadedMcps.find((m) => m.id === id);
    if (!mcp) return;
    mcp.definition.enabled = true;
    await installMcpToFilesystem(id, mcp.definition);
    await this.connectServer(mcp);
  }

  /** Reconnect a specific server. */
  async reconnectServer(id: string): Promise<void> {
    const existing = this.clients.get(id);
    if (existing) { await existing.disconnect(); this.clients.delete(id); }
    const mcp = this.loadedMcps.find((m) => m.id === id);
    if (mcp) await this.connectServer(mcp);
  }

  /** Disconnect all servers. */
  async shutdown(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.disconnect().catch(() => {});
    }
    this.clients.clear();
  }

  private async connectServer(mcp: LoadedMcp): Promise<void> {
    this.serverStates.set(mcp.id, { status: "connecting" });
    this.notifyChange();

    try {
      const client = new McpClient({
        id: mcp.id,
        name: mcp.definition.name,
        command: mcp.definition.command,
        args: mcp.definition.args,
        env: mcp.definition.env,
      });
      await client.connect();
      this.clients.set(mcp.id, client);
      this.serverStates.set(mcp.id, { status: "connected" });
      console.log(`MCP '${mcp.id}' connected: ${client.getTools().length} tools`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.serverStates.set(mcp.id, { status: "error", error: errorMsg });
      console.warn(`MCP '${mcp.id}' failed:`, errorMsg);
    }

    this.notifyChange();
  }
}

export { getMcpsDir };
export const mcpManager = new McpManager();
