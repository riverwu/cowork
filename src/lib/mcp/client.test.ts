import { describe, it, expect, vi, beforeEach } from "vitest";

// Create a shared mock transport instance
const mockTransport = {
  connect: vi.fn(),
  request: vi.fn(),
  notify: vi.fn(),
  disconnect: vi.fn(),
  isConnected: vi.fn().mockReturnValue(true),
  getLastStderr: vi.fn().mockReturnValue(""),
};

vi.mock("./transport", () => {
  return {
    McpTransport: class {
      connect = mockTransport.connect;
      request = mockTransport.request;
      notify = mockTransport.notify;
      disconnect = mockTransport.disconnect;
      isConnected = mockTransport.isConnected;
      getLastStderr = mockTransport.getLastStderr;
      onProcessExit = null;
    },
  };
});

import { McpClient, toLlmToolName } from "./client";

beforeEach(() => {
  mockTransport.connect.mockReset();
  mockTransport.request.mockReset();
  mockTransport.notify.mockReset();
  mockTransport.disconnect.mockReset();
});

describe("McpClient", () => {
  it("initializes and discovers tools", async () => {
    mockTransport.request.mockResolvedValueOnce({ protocolVersion: "2025-03-26" });
    mockTransport.request.mockResolvedValueOnce({
      tools: [
        { name: "read", description: "Read a file", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
        { name: "write", description: "Write a file", inputSchema: { type: "object", properties: {} } },
      ],
    });

    const client = new McpClient({ id: "fs", name: "Filesystem", command: "x", args: [] });
    await client.connect();

    expect(client.isConnected()).toBe(true);
    expect(client.getTools()).toHaveLength(2);
    expect(mockTransport.request).toHaveBeenCalledWith("initialize", expect.objectContaining({ protocolVersion: "2025-03-26" }));
    expect(mockTransport.notify).toHaveBeenCalledWith("notifications/initialized");
  });

  it("converts tools to Skills with prefixed names", async () => {
    mockTransport.request.mockResolvedValueOnce({});
    mockTransport.request.mockResolvedValueOnce({
      tools: [{ name: "query", description: "Run SQL", inputSchema: { type: "object", properties: { sql: { type: "string" } } } }],
    });

    const client = new McpClient({ id: "db", name: "Database", command: "x", args: [] });
    await client.connect();

    const skills = client.toTools();
    expect(Object.keys(skills)).toEqual(["mcp__db__query"]);
    expect(skills["mcp__db__query"].definition.description).toContain("[Database]");
  });

  it("sanitizes MCP tool names for LLM providers", async () => {
    mockTransport.request.mockResolvedValueOnce({});
    mockTransport.request.mockResolvedValueOnce({
      tools: [{ name: "browser.navigate/page", description: "Navigate", inputSchema: { type: "object", properties: {} } }],
    });

    const client = new McpClient({ id: "browser use", name: "Browser", command: "x", args: [] });
    await client.connect();

    const skills = client.toTools();
    expect(Object.keys(skills)).toEqual(["mcp__browser_use__browser_navigate_page"]);
  });

  it("keeps sanitized MCP tool names unique", async () => {
    mockTransport.request.mockResolvedValueOnce({});
    mockTransport.request.mockResolvedValueOnce({
      tools: [
        { name: "a/b", description: "Slash", inputSchema: { type: "object", properties: {} } },
        { name: "a.b", description: "Dot", inputSchema: { type: "object", properties: {} } },
      ],
    });

    const client = new McpClient({ id: "server", name: "Server", command: "x", args: [] });
    await client.connect();

    const skillNames = Object.keys(client.toTools());
    expect(skillNames).toHaveLength(2);
    expect(new Set(skillNames).size).toBe(2);
    for (const name of skillNames) {
      expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    }
  });

  it("limits generated LLM tool names to provider-compatible length", () => {
    const name = toLlmToolName("very-long-server-name-with-many-characters", "tool.name/with spaces/and/a/very/long/suffix");
    expect(name).toHaveLength(64);
    expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("calls tools via transport", async () => {
    mockTransport.request.mockResolvedValueOnce({});
    mockTransport.request.mockResolvedValueOnce({ tools: [{ name: "test", description: "t", inputSchema: {} }] });

    const client = new McpClient({ id: "s", command: "x", args: [] });
    await client.connect();

    mockTransport.request.mockResolvedValueOnce({ content: [{ type: "text", text: "result data" }] });
    const result = await client.callTool("test", { key: "value" });

    expect(result).toBe("result data");
    expect(mockTransport.request).toHaveBeenCalledWith("tools/call", { name: "test", arguments: { key: "value" } });
  });

  it("throws when MCP tool result is marked as an error", async () => {
    mockTransport.request.mockResolvedValueOnce({});
    mockTransport.request.mockResolvedValueOnce({ tools: [{ name: "test", description: "t", inputSchema: {} }] });

    const client = new McpClient({ id: "s", command: "x", args: [] });
    await client.connect();

    mockTransport.request.mockResolvedValueOnce({ isError: true, content: [{ type: "text", text: "bad input" }] });
    await expect(client.callTool("test", {})).rejects.toThrow("MCP tool error: bad input");
  });

  it("handles empty tool response", async () => {
    mockTransport.request.mockResolvedValueOnce({});
    mockTransport.request.mockResolvedValueOnce({ tools: [] });

    const client = new McpClient({ id: "s", command: "x", args: [] });
    await client.connect();

    mockTransport.request.mockResolvedValueOnce({ content: [] });
    expect(await client.callTool("test", {})).toBe("(no output)");
  });

  it("disconnects cleanly", async () => {
    mockTransport.request.mockResolvedValueOnce({});
    mockTransport.request.mockResolvedValueOnce({ tools: [{ name: "a", description: "b", inputSchema: {} }] });

    const client = new McpClient({ id: "s", command: "x", args: [] });
    await client.connect();
    expect(client.isConnected()).toBe(true);

    // After disconnect, transport.isConnected returns false
    mockTransport.isConnected.mockReturnValue(false);
    await client.disconnect();
    expect(client.isConnected()).toBe(false);
    expect(client.getTools()).toHaveLength(0);
    // Restore for other tests
    mockTransport.isConnected.mockReturnValue(true);
  });
});
