/**
 * MCP Manager — manages MCP server lifecycle.
 *
 * Design principles (informed by Codex CLI patterns):
 *
 * 1. **Eager init, resilient startup**: Connect all servers at startup,
 *    but failures don't block the app. Tool definitions are cached so
 *    they survive process crashes.
 *
 * 2. **Transparent reconnection**: If a process dies, auto-reconnect on
 *    next tool call. The user never sees "disconnected" — only
 *    "available", "needs_config", or "disabled".
 *
 * 3. **Connection is an implementation detail**: MCP tools are local
 *    processes (stdio). Whether the process is running right now is
 *    irrelevant to the user. What matters is: "can I use this tool?"
 *
 * Each MCP server is a directory: ~/.cowork/mcps/<name>/MCP.json
 * Filesystem is source of truth (like skills).
 */

import { McpClient } from "./client";
import type { Tool } from "@/lib/ai/tools/types";
import { loadMcpsFromFilesystem, installMcpToFilesystem, getMcpsDir, type LoadedMcp, type McpDefinition } from "./loader";
import { ensureUvInstalled } from "@/lib/tauri";
import { deleteDirectory } from "@/lib/tauri";
import { getMcpEnvConfig } from "@/lib/db";

/** User-facing status — no "connecting"/"connected" distinction. */
type McpStatus = "available" | "needs_config" | "disabled" | "error";

interface ServerInfo {
  status: McpStatus;
  error?: string;
  missingEnv?: string[];
  /** Cached tool count (survives process crash). */
  toolCount: number;
}

class McpManager {
  private clients = new Map<string, McpClient>();
  private loadedMcps: LoadedMcp[] = [];
  private serverInfo = new Map<string, ServerInfo>();
  private onChangeCallbacks: Array<() => void> = [];
  private initPromise: Promise<void> | null = null;
  /** Cached tool definitions per server — survive process crashes. */
  private cachedToolDefs = new Map<string, Tool[]>();
  /** Resolved env per server (cached so reconnect doesn't re-query DB). */
  private resolvedEnv = new Map<string, Record<string, string>>();

  onChange(cb: () => void): () => void {
    this.onChangeCallbacks.push(cb);
    return () => { this.onChangeCallbacks = this.onChangeCallbacks.filter((c) => c !== cb); };
  }

  private notifyChange() {
    for (const cb of this.onChangeCallbacks) cb();
  }

  /** Load MCP configs and connect all enabled servers. */
  async initialize(): Promise<void> {
    this.initPromise = this.reload();
    await this.initPromise;
  }

  /** Wait for initial load to complete (with timeout). */
  async waitForReady(timeoutMs = 15000): Promise<void> {
    if (!this.initPromise) return;
    await Promise.race([
      this.initPromise,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  /** Reload configs from filesystem and reconnect all. */
  async reload(): Promise<void> {
    // Disconnect existing
    for (const client of this.clients.values()) {
      await client.disconnect().catch(() => {});
    }
    this.clients.clear();
    this.serverInfo.clear();
    this.cachedToolDefs.clear();
    this.resolvedEnv.clear();

    // Load from filesystem
    this.loadedMcps = await loadMcpsFromFilesystem();

    // Check if uv needed
    const needsUv = this.loadedMcps.some(
      (m) => m.definition.enabled !== false && m.definition.command === "uvx",
    );
    if (needsUv) {
      try { await ensureUvInstalled(); } catch (err) { console.warn("uv install:", err); }
    }

    // Resolve env + validate config for each server
    for (const mcp of this.loadedMcps) {
      if (mcp.definition.enabled === false) {
        this.serverInfo.set(mcp.id, { status: "disabled", toolCount: 0 });
        continue;
      }
      await this.resolveEnv(mcp);
    }

    // Connect all that are ready (non-blocking, errors don't propagate)
    await Promise.allSettled(
      this.loadedMcps
        .filter((m) => this.serverInfo.get(m.id)?.status !== "disabled" && this.serverInfo.get(m.id)?.status !== "needs_config")
        .map((m) => this.connectServer(m)),
    );

    this.notifyChange();
  }

  /**
   * Get all MCP tools as Skills for the agent.
   *
   * Key design: returns ALL tools from configured+available servers,
   * using cached definitions if the process isn't running.
   * The tool's execute() handles reconnection transparently.
   */
  getAllTools(): Record<string, Tool> {
    const allTools: Record<string, Tool> = {};

    for (const mcp of this.loadedMcps) {
      const info = this.serverInfo.get(mcp.id);
      if (!info || info.status === "disabled" || info.status === "needs_config") continue;

      const client = this.clients.get(mcp.id);
      if (client?.isConnected()) {
        // Live client — use real skills
        Object.assign(allTools, client.toTools());
      } else {
        // Process not running — wrap cached tool defs with auto-reconnect execute
        const cached = this.cachedToolDefs.get(mcp.id);
        if (cached) {
          for (const entry of cached) {
            allTools[entry.definition.name] = {
              definition: entry.definition,
              execute: async (input: Record<string, unknown>) => {
                // Reconnect transparently, then call
                await this.ensureConnected(mcp.id);
                const freshClient = this.clients.get(mcp.id)!;
                const freshTools = freshClient.toTools();
                const freshTool = freshTools[entry.definition.name];
                if (!freshTool) throw new Error(`Tool '${entry.definition.name}' no longer available after reconnect`);
                return freshTool.execute(input);
              },
            };
          }
        }
      }
    }

    return allTools;
  }

  /** Get server status for UI display. */
  getServerStatus(): Array<{
    id: string; name: string; toolCount: number;
    builtin: boolean; enabled: boolean;
    status: McpStatus;
    error?: string; missingEnv?: string[];
    version: string; description: string; dirPath: string;
    requiredEnv: Record<string, string>;
    callTimeoutMs?: number;
  }> {
    return this.loadedMcps.map((m) => {
      const info = this.serverInfo.get(m.id) || { status: "error" as McpStatus, toolCount: 0 };
      const enabled = m.definition.enabled !== false;
      return {
        id: m.id,
        name: m.definition.name,
        toolCount: info.toolCount,
        builtin: false,
        enabled,
        status: info.status,
        error: info.error,
        missingEnv: info.missingEnv,
        version: m.definition.version,
        description: m.definition.description || "",
        dirPath: m.dirPath,
        requiredEnv: m.definition.env || {},
        callTimeoutMs: m.definition.callTimeoutMs,
      };
    });
  }

  /** Persist a per-server tool-call timeout to MCP.json and reconnect so
   *  the new value takes effect for subsequent calls. Pass `undefined` to
   *  clear and fall back to the transport default. */
  async setCallTimeout(id: string, callTimeoutMs: number | undefined): Promise<void> {
    const mcp = this.loadedMcps.find((m) => m.id === id);
    if (!mcp) return;
    if (callTimeoutMs === undefined) {
      delete mcp.definition.callTimeoutMs;
    } else {
      mcp.definition.callTimeoutMs = callTimeoutMs;
    }
    await installMcpToFilesystem(id, mcp.definition);
    await this.reconnectServer(id);
  }

  /** Get loaded MCP definitions (for catalog comparison). */
  getLoadedMcps(): LoadedMcp[] {
    return this.loadedMcps;
  }

  /** Install a new MCP server from definition. */
  async addServer(id: string, definition: McpDefinition): Promise<void> {
    await installMcpToFilesystem(id, definition);
    const newMcps = await loadMcpsFromFilesystem();
    const newMcp = newMcps.find((m) => m.id === id);
    if (newMcp) {
      this.loadedMcps = newMcps;
      await this.resolveEnv(newMcp);
      if (this.serverInfo.get(newMcp.id)?.status !== "needs_config") {
        await this.connectServer(newMcp);
      }
    }
    this.notifyChange();
  }

  /** Disable an MCP server. */
  async removeServer(id: string): Promise<void> {
    await this.disconnectClient(id);
    const mcp = this.loadedMcps.find((m) => m.id === id);
    if (mcp) {
      mcp.definition.enabled = false;
      await installMcpToFilesystem(id, mcp.definition);
      this.serverInfo.set(id, { status: "disabled", toolCount: 0 });
    }
    this.notifyChange();
  }

  /** Uninstall an MCP server by removing its installed directory. */
  async uninstallServer(id: string): Promise<void> {
    await this.disconnectClient(id);
    const mcp = this.loadedMcps.find((m) => m.id === id);
    const dirPath = mcp?.dirPath || `${await getMcpsDir()}/${id}`;
    await deleteDirectory(dirPath);
    this.loadedMcps = this.loadedMcps.filter((entry) => entry.id !== id);
    this.serverInfo.delete(id);
    this.cachedToolDefs.delete(id);
    this.resolvedEnv.delete(id);
    this.notifyChange();
  }

  /** Enable a disabled server. */
  async enableServer(id: string): Promise<void> {
    const mcp = this.loadedMcps.find((m) => m.id === id);
    if (!mcp) return;
    mcp.definition.enabled = true;
    await installMcpToFilesystem(id, mcp.definition);
    await this.resolveEnv(mcp);
    if (this.serverInfo.get(id)?.status !== "needs_config") {
      await this.connectServer(mcp);
    }
    this.notifyChange();
  }

  /** Force reconnect a specific server (user-triggered from UI). */
  async reconnectServer(id: string): Promise<void> {
    await this.disconnectClient(id);
    const mcp = this.loadedMcps.find((m) => m.id === id);
    if (mcp) {
      await this.resolveEnv(mcp);
      if (this.serverInfo.get(id)?.status !== "needs_config") {
        await this.connectServer(mcp);
      }
    }
    this.notifyChange();
  }

  /** Disconnect all servers (app shutdown). */
  async shutdown(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.disconnect().catch(() => {});
    }
    this.clients.clear();
  }

  // ---- Internal ----

  /** Resolve env vars: check which are missing, merge defaults + user config. */
  private async resolveEnv(mcp: LoadedMcp): Promise<void> {
    const userEnv = await getMcpEnvConfig(mcp.id);
    const definedEnv = mcp.definition.env || {};

    // Only vars with empty defaults require user config
    const missingVars = Object.entries(definedEnv)
      .filter(([, defaultVal]) => !defaultVal)
      .filter(([key]) => !userEnv[key])
      .map(([key]) => key);

    if (missingVars.length > 0) {
      this.serverInfo.set(mcp.id, {
        status: "needs_config",
        missingEnv: missingVars,
        error: `Missing: ${missingVars.join(", ")}`,
        toolCount: 0,
      });
      return;
    }

    const mergedEnv = { ...definedEnv, ...userEnv };
    this.resolvedEnv.set(mcp.id, mergedEnv);

    // If not yet tracked, mark as available (will connect next)
    if (!this.serverInfo.has(mcp.id)) {
      this.serverInfo.set(mcp.id, { status: "available", toolCount: 0 });
    }
  }

  /** Ensure a server is connected. Auto-reconnects if process died. Throws on failure. */
  private async ensureConnected(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client?.isConnected()) return;

    // Clean up dead client
    if (client) {
      await client.disconnect().catch(() => {});
      this.clients.delete(id);
    }

    const mcp = this.loadedMcps.find((m) => m.id === id);
    if (!mcp) throw new Error(`MCP server '${id}' not found`);

    // connectServer catches errors internally; check result via serverInfo
    await this.connectServer(mcp);

    // If still not connected, throw with the actual error
    const freshClient = this.clients.get(id);
    if (!freshClient?.isConnected()) {
      const info = this.serverInfo.get(id);
      throw new Error(info?.error || `Failed to start MCP server '${mcp.definition.name}'`);
    }
  }

  /** Connect to an MCP server. Updates serverInfo + caches tools. */
  private async connectServer(mcp: LoadedMcp): Promise<void> {
    const env = this.resolvedEnv.get(mcp.id);
    if (!env) {
      // Env not resolved — try resolving now
      await this.resolveEnv(mcp);
      if (this.serverInfo.get(mcp.id)?.status === "needs_config") return;
    }

    try {
      const mergedEnv = this.resolvedEnv.get(mcp.id) || {};

      const client = new McpClient({
        id: mcp.id,
        name: mcp.definition.name,
        command: mcp.definition.command,
        args: mcp.definition.args,
        env: mergedEnv,
        callTimeoutMs: mcp.definition.callTimeoutMs,
      });

      // On unexpected exit: clean up, mark as available (not error).
      // The tool is still "available" — it just needs a new process,
      // which will happen transparently on next call.
      client.onProcessExit = (serverId) => {
        console.warn(`[MCP:${serverId}] Process exited — will reconnect on next use`);
        this.clients.delete(serverId);
        // Keep status as "available" — process restart is transparent
        const info = this.serverInfo.get(serverId);
        if (info && info.status !== "disabled" && info.status !== "needs_config") {
          this.serverInfo.set(serverId, { ...info, status: "available" });
        }
        // Don't notifyChange for process exit — user doesn't need to know
      };

      console.log(`[MCP:${mcp.id}] Starting: ${mcp.definition.command} ${mcp.definition.args.join(" ")}`);
      await client.connect();
      this.clients.set(mcp.id, client);

      // Cache tool definitions (survive process crashes)
      const toolEntries = Object.values(client.toTools());
      this.cachedToolDefs.set(mcp.id, toolEntries);

      this.serverInfo.set(mcp.id, {
        status: "available",
        toolCount: client.getTools().length,
      });

      console.log(`[MCP:${mcp.id}] Ready: ${client.getTools().length} tools`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[MCP:${mcp.id}] Failed to start:`, errorMsg);

      // If we have cached tools, stay "available" — reconnect will be tried on use
      const cached = this.cachedToolDefs.get(mcp.id);
      if (cached && cached.length > 0) {
        this.serverInfo.set(mcp.id, {
          status: "available",
          toolCount: cached.length,
          error: errorMsg,
        });
      } else {
        this.serverInfo.set(mcp.id, {
          status: "error",
          error: errorMsg,
          toolCount: 0,
        });
      }
    }
  }

  private async disconnectClient(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      await client.disconnect().catch(() => {});
      this.clients.delete(id);
    }
  }
}

export { getMcpsDir };
export const mcpManager = new McpManager();
