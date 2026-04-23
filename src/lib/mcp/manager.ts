/**
 * MCP Manager — manages multiple MCP server connections.
 *
 * Config file: ~/.cowork/mcp.json
 * Format (compatible with Claude Desktop):
 * {
 *   "mcpServers": {
 *     "filesystem": {
 *       "command": "npx",
 *       "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
 *       "env": {}
 *     }
 *   }
 * }
 */

import { McpClient } from "./client";
import type { Skill } from "@/lib/ai/skills/types";
import { readFileText, writeFile } from "@/lib/tauri";
import { getEnv } from "@/lib/tauri";

interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

interface McpConfig {
  mcpServers: Record<string, McpServerEntry>;
}

class McpManager {
  private clients = new Map<string, McpClient>();
  private config: McpConfig = { mcpServers: {} };
  private configPath: string | null = null;

  /** Load config and connect to all enabled MCP servers. */
  async initialize(): Promise<void> {
    await this.loadConfig();
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
  getServerStatus(): Array<{ id: string; name: string; connected: boolean; toolCount: number }> {
    const status: Array<{ id: string; name: string; connected: boolean; toolCount: number }> = [];

    for (const id of Object.keys(this.config.mcpServers)) {
      const client = this.clients.get(id);
      status.push({
        id,
        name: id,
        connected: client?.isConnected() || false,
        toolCount: client?.getTools().length || 0,
      });
    }

    return status;
  }

  /** Add a new MCP server to config and connect. */
  async addServer(id: string, entry: McpServerEntry): Promise<void> {
    this.config.mcpServers[id] = entry;
    await this.saveConfig();
    await this.connectServer(id, entry);
  }

  /** Remove an MCP server. */
  async removeServer(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      await client.disconnect();
      this.clients.delete(id);
    }
    delete this.config.mcpServers[id];
    await this.saveConfig();
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
      // No config file yet — that's fine
      this.config = { mcpServers: {} };
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
    for (const [id, entry] of entries) {
      if (entry.enabled === false) continue;
      await this.connectServer(id, entry).catch((err) => {
        console.error(`Failed to connect MCP server '${id}':`, err);
      });
    }
  }

  private async connectServer(id: string, entry: McpServerEntry): Promise<void> {
    const client = new McpClient({
      id,
      name: id,
      command: entry.command,
      args: entry.args,
      env: entry.env,
    });

    await client.connect();
    this.clients.set(id, client);
    console.log(`MCP server '${id}' connected: ${client.getTools().length} tools`);
  }
}

/** Singleton MCP manager instance. */
export const mcpManager = new McpManager();
