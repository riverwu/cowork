import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpTransport } from "./transport";

// Mock at module level — vi.mock is hoisted
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

// Get mock references after mock setup
const { invoke } = await import("@tauri-apps/api/core");
const { listen } = await import("@tauri-apps/api/event");

const mockInvoke = invoke as ReturnType<typeof vi.fn>;
const mockListen = listen as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockInvoke.mockReset();
  mockListen.mockReset();
});

describe("McpTransport", () => {
  it("connects by spawning process via Rust", async () => {
    mockListen.mockResolvedValue(() => {});
    mockInvoke.mockResolvedValue({ id: "test-server", success: true });

    const transport = new McpTransport({ id: "test-server", command: "echo", args: ["hello"] });
    await transport.connect();

    // Event channel includes a generation suffix for unique identification
    expect(mockListen).toHaveBeenCalledWith(expect.stringContaining("mcp-stdout-test-server_"), expect.any(Function));
    expect(mockInvoke).toHaveBeenCalledWith("mcp_spawn", {
      config: expect.objectContaining({ command: "echo", args: ["hello"] }),
    });
  });

  it("throws on spawn failure", async () => {
    mockListen.mockResolvedValue(() => {});
    mockInvoke.mockResolvedValue({ id: "test", success: false, error: "command not found" });

    const transport = new McpTransport({ id: "test", command: "bad", args: [] });
    await expect(transport.connect()).rejects.toThrow("command not found");
  });

  it("matches responses to pending requests", async () => {
    const callbacks: Array<(event: { payload: string }) => void> = [];
    mockListen.mockImplementation(async (_name: string, cb: (event: { payload: string }) => void) => {
      callbacks.push(cb);
      return () => {};
    });
    mockInvoke.mockResolvedValueOnce({ id: "srv", success: true });
    mockInvoke.mockResolvedValue(undefined);

    const transport = new McpTransport({ id: "srv", command: "x", args: [] });
    await transport.connect();

    const promise = transport.request("tools/list");
    callbacks[0]({ payload: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: ["a", "b"] } }) });

    const result = await promise;
    expect(result).toEqual({ tools: ["a", "b"] });
  });

  it("handles JSON-RPC error responses", async () => {
    const callbacks: Array<(event: { payload: string }) => void> = [];
    mockListen.mockImplementation(async (_name: string, cb: (event: { payload: string }) => void) => {
      callbacks.push(cb);
      return () => {};
    });
    mockInvoke.mockResolvedValueOnce({ id: "srv", success: true });
    mockInvoke.mockResolvedValue(undefined);

    const transport = new McpTransport({ id: "srv", command: "x", args: [] });
    await transport.connect();

    const promise = transport.request("bad/method");
    callbacks[0]({ payload: JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "Method not found" } }) });

    await expect(promise).rejects.toThrow("Method not found");
  });

  it("disconnects and rejects pending", async () => {
    mockListen.mockResolvedValue(() => {});
    mockInvoke.mockResolvedValueOnce({ id: "srv", success: true });
    mockInvoke.mockResolvedValue(undefined);

    const transport = new McpTransport({ id: "srv", command: "x", args: [] });
    await transport.connect();

    const promise = transport.request("test");
    await transport.disconnect();

    await expect(promise).rejects.toThrow("disconnected");
  });
});
