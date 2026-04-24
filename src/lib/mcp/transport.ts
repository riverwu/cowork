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

/** Global counter to make event channels unique across reconnects. */
let transportGeneration = 0;

export class McpTransport {
  /** Unique ID for this transport instance (serverId_generation). Used for Rust IPC. */
  private processId: string;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }>();
  private nextRequestId = 1;
  private unlisten: (() => void) | null = null;
  private unlistenStderr: (() => void) | null = null;
  private connected = false;
  /** Last stderr lines for diagnostics. */
  private stderrLines: string[] = [];
  /** Called when the MCP process exits unexpectedly. */
  onProcessExit: (() => void) | null = null;

  constructor(private config: McpServerConfig) {
    this.processId = `${config.id}_${++transportGeneration}`;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Get recent stderr output (for error diagnostics). */
  getLastStderr(): string {
    return this.stderrLines.slice(-5).join("\n");
  }

  async connect(): Promise<void> {
    // Listen for stdout lines from Rust.
    // Uses processId (unique per transport instance) to prevent
    // old process's __MCP_EXIT__ from killing a new connection.
    this.unlisten = await listen<string>(`mcp-stdout-${this.processId}`, (event) => {
      this.handleLine(event.payload);
    });

    // Listen for stderr lines (diagnostics)
    this.unlistenStderr = await listen<string>(`mcp-stderr-${this.processId}`, (event) => {
      this.stderrLines.push(event.payload);
      if (this.stderrLines.length > 20) this.stderrLines.shift();
    });

    // Spawn the subprocess via Rust — use processId for unique event channels
    const result = await invoke<{ id: string; success: boolean; error?: string }>("mcp_spawn", {
      config: { ...this.config, id: this.processId },
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to spawn MCP server");
    }

    this.connected = true;
  }

  /** Send a JSON-RPC request and wait for the response. */
  async request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    if (!this.connected) throw new Error("Transport not connected");

    const id = this.nextRequestId++;
    const message = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: params || {},
    });

    // tools/call can be very slow (web search, browser navigation, deep research)
    const timeout = timeoutMs ?? (method === "tools/call" ? 300000 : 30000);

    return new Promise((resolve, reject) => {
      // Set timeout
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request timeout: ${method} (${timeout / 1000}s)`));
      }, timeout);

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
      invoke("mcp_send", { serverId: this.processId, message }).catch((err) => {
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

    await invoke("mcp_send", { serverId: this.processId, message });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.unlisten?.();
    this.unlisten = null;
    this.unlistenStderr?.();
    this.unlistenStderr = null;

    // Reject pending requests
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error("Transport disconnected"));
    }
    this.pendingRequests.clear();

    await invoke("mcp_stop", { serverId: this.processId });
  }

  private handleLine(line: string) {
    if (line === "__MCP_EXIT__") {
      this.connected = false;
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error("MCP server process exited"));
      }
      this.pendingRequests.clear();
      this.onProcessExit?.();
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
