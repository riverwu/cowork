/**
 * MCP Client — handles protocol-level operations (initialize, list tools, call tool).
 */

import { McpTransport, type McpServerConfig } from "./transport";
import type { Skill } from "@/lib/ai/skills/types";
import type { ToolDefinition } from "@/lib/ai/providers/types";

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
}

export class McpClient {
  private transport: McpTransport;
  private serverId: string;
  private serverName: string;
  private tools: McpToolInfo[] = [];
  private initialized = false;

  constructor(config: McpServerConfig & { name?: string }) {
    this.transport = new McpTransport(config);
    this.serverId = config.id;
    this.serverName = config.name || config.id;
  }

  async connect(): Promise<void> {
    await this.transport.connect();

    // Step 1: MCP initialize handshake (must be first message)
    const initResult = await this.transport.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {
        roots: { listChanged: true },
      },
      clientInfo: { name: "cowork", version: "0.1.0" },
    }) as {
      protocolVersion?: string;
      capabilities?: { tools?: { listChanged?: boolean } };
      serverInfo?: { name?: string; version?: string };
    };

    console.log(`[MCP:${this.serverId}] Server: ${initResult.serverInfo?.name || "unknown"} v${initResult.serverInfo?.version || "?"}, protocol: ${initResult.protocolVersion || "?"}`);

    // Step 2: Send initialized notification (signals handshake complete)
    await this.transport.notify("notifications/initialized");

    // Step 3: Discover tools (only if server has tools capability)
    try {
      const result = await this.transport.request("tools/list") as { tools: McpToolInfo[] };
      this.tools = (result.tools || []).map((t) => ({
        ...t,
        serverId: this.serverId,
      }));
    } catch {
      // Server may not support tools — that's OK
      this.tools = [];
    }

    console.log(`[MCP:${this.serverId}] Discovered ${this.tools.length} tools`);
    this.initialized = true;
  }

  /** Get all tools exposed by this MCP server. */
  getTools(): McpToolInfo[] {
    return this.tools;
  }

  /** Call a tool on this MCP server. */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.transport.request("tools/call", {
      name,
      arguments: args,
    }) as { content: Array<{ type: string; text?: string }> };

    // Extract text content from response
    const textParts = (result.content || [])
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!);

    return textParts.join("\n") || "(no output)";
  }

  async disconnect(): Promise<void> {
    this.initialized = false;
    this.tools = [];
    await this.transport.disconnect();
  }

  isConnected(): boolean {
    return this.initialized;
  }

  getId(): string {
    return this.serverId;
  }

  getName(): string {
    return this.serverName;
  }

  /** Convert MCP tools to our Skill interface for the agent. */
  toSkills(): Record<string, Skill> {
    const skills: Record<string, Skill> = {};

    for (const tool of this.tools) {
      // Prefix MCP tools with server id to avoid name collisions
      const skillName = `mcp_${this.serverId}_${tool.name}`;

      skills[skillName] = {
        definition: {
          name: skillName,
          description: `[${this.serverName}] ${tool.description || tool.name}`,
          parameters: (tool.inputSchema as ToolDefinition["parameters"]) || {
            type: "object",
            properties: {},
          },
        },
        execute: async (input: Record<string, unknown>) => {
          return this.callTool(tool.name, input);
        },
      };
    }

    return skills;
  }
}
