/**
 * MCP Client — handles protocol-level operations (initialize, list tools, call tool).
 */

import { McpTransport, type McpServerConfig } from "./transport";
import type { Tool } from "@/lib/ai/tools/types";
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
  /** Called when the underlying process exits unexpectedly. */
  onProcessExit: ((serverId: string) => void) | null = null;

  constructor(config: McpServerConfig & { name?: string }) {
    this.transport = new McpTransport(config);
    this.serverId = config.id;
    this.serverName = config.name || config.id;

    // Propagate transport exit event
    this.transport.onProcessExit = () => {
      this.initialized = false;
      const stderr = this.transport.getLastStderr();
      console.warn(`[MCP:${this.serverId}] Process exited unexpectedly${stderr ? `\nstderr: ${stderr}` : ""}`);
      this.onProcessExit?.(this.serverId);
    };
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
    }) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    // Extract text content from response
    const textParts = (result.content || [])
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!);

    const output = textParts.join("\n") || "(no output)";
    if (result.isError) {
      throw new Error(`MCP tool error: ${output}`);
    }
    return output;
  }

  async disconnect(): Promise<void> {
    this.initialized = false;
    this.tools = [];
    await this.transport.disconnect();
  }

  isConnected(): boolean {
    return this.initialized && this.transport.isConnected();
  }

  getId(): string {
    return this.serverId;
  }

  getName(): string {
    return this.serverName;
  }

  /** Get recent stderr output for diagnostics. */
  getLastStderr(): string {
    return this.transport.getLastStderr();
  }

  /** Convert MCP tools to our Tool interface for the agent. */
  toTools(): Record<string, Tool> {
    const result: Record<string, Tool> = {};

    for (const mcpTool of this.tools) {
      // Prefix MCP tools with server id to avoid name collisions.
      // Uses double underscore as delimiter (like Codex CLI) so names
      // with single underscores don't cause ambiguity.
      let toolName = toLlmToolName(this.serverId, mcpTool.name);
      if (result[toolName]) {
        toolName = withProviderSafeSuffix(toolName, stableHash(`${this.serverId}:${mcpTool.name}`));
      }

      result[toolName] = {
        definition: {
          name: toolName,
          description: `[${this.serverName}] ${mcpTool.description || mcpTool.name}`,
          parameters: (mcpTool.inputSchema as ToolDefinition["parameters"]) || {
            type: "object",
            properties: {},
          },
        },
        execute: async (input: Record<string, unknown>) => {
          if (!this.initialized) {
            throw new Error(`MCP server '${this.serverName}' is not connected. Check server status in Tools page.`);
          }
          return this.callTool(mcpTool.name, input);
        },
      };
    }

    return result;
  }
}

/**
 * LLM providers restrict tool/function names more tightly than MCP does.
 * Keep the public tool name deterministic while preserving the original MCP
 * tool name inside the execute closure.
 */
export function toLlmToolName(serverId: string, mcpToolName: string): string {
  const raw = `mcp__${serverId}__${mcpToolName}`;
  const sanitized = raw.replace(/[^A-Za-z0-9_-]/g, "_");
  if (sanitized.length <= 64) return sanitized;

  const suffix = stableHash(raw);
  return `${sanitized.slice(0, 55)}_${suffix}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function withProviderSafeSuffix(name: string, suffix: string): string {
  return `${name.slice(0, 55)}_${suffix}`;
}
