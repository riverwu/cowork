/**
 * MCP stdio transport via Rust subprocess management.
 * Rust handles process lifecycle + stdio I/O.
 * TypeScript handles JSON-RPC protocol.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface McpServerConfig {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export class McpTransport {
  private serverId: string;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }>();
  private nextRequestId = 1;
  private unlisten: (() => void) | null = null;
  private connected = false;

  constructor(private config: McpServerConfig) {
    this.serverId = config.id;
  }

  async connect(): Promise<void> {
    // Listen for stdout lines from Rust
    this.unlisten = await listen<string>(`mcp-stdout-${this.serverId}`, (event) => {
      this.handleLine(event.payload);
    });

    // Spawn the subprocess via Rust
    const result = await invoke<{ id: string; success: boolean; error?: string }>("mcp_spawn", {
      config: this.config,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to spawn MCP server");
    }

    this.connected = true;
  }

  /** Send a JSON-RPC request and wait for the response. */
  async request(method: string, params?: unknown): Promise<unknown> {
    if (!this.connected) throw new Error("Transport not connected");

    const id = this.nextRequestId++;
    const message = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: params || {},
    });

    return new Promise((resolve, reject) => {
      // Set timeout
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      // Send via Rust
      invoke("mcp_send", { serverId: this.serverId, message }).catch((err) => {
        this.pendingRequests.delete(id);
        clearTimeout(timer);
        reject(new Error(`Failed to send: ${err}`));
      });
    });
  }

  /** Send a JSON-RPC notification (no response expected). */
  async notify(method: string, params?: unknown): Promise<void> {
    if (!this.connected) throw new Error("Transport not connected");

    const message = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params: params || {},
    });

    await invoke("mcp_send", { serverId: this.serverId, message });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.unlisten?.();
    this.unlisten = null;

    // Reject pending requests
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error("Transport disconnected"));
    }
    this.pendingRequests.clear();

    await invoke("mcp_stop", { serverId: this.serverId });
  }

  private handleLine(line: string) {
    if (line === "__MCP_EXIT__") {
      this.connected = false;
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error("MCP server process exited"));
      }
      this.pendingRequests.clear();
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return; // Skip non-JSON lines
    }

    // JSON-RPC response
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const pending = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);

      if (message.error) {
        pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
    }
  }
}
