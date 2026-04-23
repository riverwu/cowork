/**
 * MCP Manager — manages multiple MCP server connections.
 *
 * Config file: ~/.cowork/mcp.json
 * Format (compatible with Claude Desktop):
 * {
 *   "mcpServers": {
 *     "browser": {
 *       "command": "uvx",
 *       "args": ["--from", "browser-use[cli]", "browser-use", "--mcp"]
 *     }
 *   }
 * }
 *
 * Default servers are auto-configured on first startup.
 */

import { McpClient } from "./client";
import type { Skill } from "@/lib/ai/skills/types";
import { readFileText, writeFile, ensureUvInstalled } from "@/lib/tauri";
import { getEnv } from "@/lib/tauri";

interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  /** Whether this is a built-in default server. */
  builtin?: boolean;
}

interface McpConfig {
  mcpServers: Record<string, McpServerEntry>;
}

/**
 * Default MCP servers — pre-configured and auto-installed on first startup.
 * These provide core network capabilities without user configuration.
 */
const DEFAULT_SERVERS: Record<string, McpServerEntry> = {
  browser: {
    command: "uvx",
    args: ["--from", "browser-use[cli]", "browser-use", "--mcp"],
    builtin: true,
  },
  fetch: {
    command: "uvx",
    args: ["@anthropic/mcp-server-fetch"],
    builtin: true,
  },
};

/**
 * Preset servers available in the "Add Connection" UI.
 * These are NOT auto-installed — user chooses to add them.
 */
export const MCP_PRESETS = [
  {
    id: "brave-search",
    label: "Brave Search",
    description: "Web search via Brave Search API",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    requiresEnv: "BRAVE_API_KEY",
  },
  {
    id: "filesystem",
    label: "File System",
    description: "Enhanced file system operations",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "~"],
  },
  {
    id: "memory",
    label: "Memory Server",
    description: "Knowledge graph memory",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
  },
  {
    id: "github",
    label: "GitHub",
    description: "GitHub repositories, issues, PRs",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    requiresEnv: "GITHUB_PERSONAL_ACCESS_TOKEN",
  },
  {
    id: "postgres",
    label: "PostgreSQL",
    description: "Query PostgreSQL databases",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
  },
];

interface ServerState {
  status: "connecting" | "connected" | "error" | "disabled";
  error?: string;
}

class McpManager {
  private clients = new Map<string, McpClient>();
  private config: McpConfig = { mcpServers: {} };
  private configPath: string | null = null;
  private serverStates = new Map<string, ServerState>();
  private onChangeCallbacks: Array<() => void> = [];

  /** Register a callback for state changes (for UI reactivity). */
  onChange(cb: () => void): () => void {
    this.onChangeCallbacks.push(cb);
    return () => { this.onChangeCallbacks = this.onChangeCallbacks.filter((c) => c !== cb); };
  }

  private notifyChange() {
    for (const cb of this.onChangeCallbacks) cb();
  }

  /** Load config (with defaults on first run) and connect to all enabled servers. */
  async initialize(): Promise<void> {
    await this.loadConfig();
    await this.ensureDefaults();

    // Auto-install uv/uvx if any server needs it
    const needsUv = Object.values(this.config.mcpServers).some(
      (s) => s.enabled !== false && s.command === "uvx",
    );
    if (needsUv) {
      try {
        await ensureUvInstalled();
      } catch (err) {
        console.warn("Failed to ensure uv installed:", err);
      }
    }

    await this.connectAll();
  }

  /** Get all tools from all connected MCP servers as Skills. */
  getAllSkills(): Record<string, Skill> {
    const allSkills: Record<string, Skill> = {};
    for (const client of this.clients.values()) {
      if (client.isConnected()) {
        Object.assign(allSkills, client.toSkills());
      }
    }
    return allSkills;
  }

  /** Get connected server info for UI display. */
  getServerStatus(): Array<{
    id: string; name: string; connected: boolean; toolCount: number;
    builtin: boolean; enabled: boolean;
    status: "connecting" | "connected" | "error" | "disabled";
    error?: string;
  }> {
    return Object.entries(this.config.mcpServers).map(([id, entry]) => {
      const client = this.clients.get(id);
      const state = this.serverStates.get(id);
      const enabled = entry.enabled !== false;
      return {
        id,
        name: id,
        connected: client?.isConnected() || false,
        toolCount: client?.getTools().length || 0,
        builtin: entry.builtin || false,
        enabled,
        status: !enabled ? "disabled" : (state?.status || "connecting"),
        error: state?.error,
      };
    });
  }

  /** Add a new MCP server to config and connect. */
  async addServer(id: string, entry: McpServerEntry): Promise<void> {
    this.config.mcpServers[id] = entry;
    await this.saveConfig();
    await this.connectServer(id, entry);
  }

  /** Remove an MCP server (cannot remove built-in, only disable). */
  async removeServer(id: string): Promise<void> {
    const entry = this.config.mcpServers[id];

    const client = this.clients.get(id);
    if (client) {
      await client.disconnect();
      this.clients.delete(id);
    }

    if (entry?.builtin) {
      this.config.mcpServers[id] = { ...entry, enabled: false };
      this.serverStates.set(id, { status: "disabled" });
    } else {
      delete this.config.mcpServers[id];
      this.serverStates.delete(id);
    }
    await this.saveConfig();
    this.notifyChange();
  }

  /** Enable a disabled server. */
  async enableServer(id: string): Promise<void> {
    const entry = this.config.mcpServers[id];
    if (!entry) return;
    entry.enabled = true;
    await this.saveConfig();
    await this.connectServer(id, entry);
  }

  /** Reconnect a specific server. */
  async reconnectServer(id: string): Promise<void> {
    const entry = this.config.mcpServers[id];
    if (!entry) return;

    const existing = this.clients.get(id);
    if (existing) {
      await existing.disconnect();
      this.clients.delete(id);
    }

    await this.connectServer(id, entry);
  }

  /** Disconnect all servers. */
  async shutdown(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.disconnect().catch(() => {});
    }
    this.clients.clear();
  }

  private async loadConfig(): Promise<void> {
    try {
      const home = await getEnv("HOME");
      if (!home) return;

      this.configPath = `${home}/.cowork/mcp.json`;
      const content = await readFileText(this.configPath);
      this.config = JSON.parse(content);
    } catch {
      this.config = { mcpServers: {} };
    }
  }

  /** Ensure default servers are in config. Only runs on first startup. */
  private async ensureDefaults(): Promise<void> {
    let changed = false;

    for (const [id, entry] of Object.entries(DEFAULT_SERVERS)) {
      if (!(id in this.config.mcpServers)) {
        this.config.mcpServers[id] = { ...entry };
        changed = true;
      }
    }

    if (changed) {
      await this.saveConfig();
    }
  }

  private async saveConfig(): Promise<void> {
    if (!this.configPath) {
      const home = await getEnv("HOME");
      if (!home) return;
      this.configPath = `${home}/.cowork/mcp.json`;
    }
    await writeFile(this.configPath, JSON.stringify(this.config, null, 2));
  }

  private async connectAll(): Promise<void> {
    const entries = Object.entries(this.config.mcpServers);
    // Connect in parallel, don't let one failure block others
    await Promise.allSettled(
      entries
        .filter(([, entry]) => entry.enabled !== false)
        .map(([id, entry]) =>
          this.connectServer(id, entry).catch((err) => {
            console.warn(`MCP '${id}' failed to connect:`, err);
          }),
        ),
    );
  }

  private async connectServer(id: string, entry: McpServerEntry): Promise<void> {
    this.serverStates.set(id, { status: "connecting" });
    this.notifyChange();

    try {
      const client = new McpClient({
        id,
        name: id,
        command: entry.command,
        args: entry.args,
        env: entry.env,
      });

      await client.connect();
      this.clients.set(id, client);
      this.serverStates.set(id, { status: "connected" });
      console.log(`MCP '${id}' connected: ${client.getTools().length} tools`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.serverStates.set(id, { status: "error", error: errorMsg });
      console.warn(`MCP '${id}' failed:`, errorMsg);
    }

    this.notifyChange();
  }
}

/** Singleton MCP manager instance. */
export const mcpManager = new McpManager();
