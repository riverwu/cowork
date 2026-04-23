import { describe, it, expect, vi, beforeEach } from "vitest";

// Create a shared mock transport instance
const mockTransport = {
  connect: vi.fn(),
  request: vi.fn(),
  notify: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock("./transport", () => {
  return {
    McpTransport: class {
      connect = mockTransport.connect;
      request = mockTransport.request;
      notify = mockTransport.notify;
      disconnect = mockTransport.disconnect;
    },
  };
});

import { McpClient } from "./client";

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

    const skills = client.toSkills();
    expect(Object.keys(skills)).toEqual(["mcp_db_query"]);
    expect(skills["mcp_db_query"].definition.description).toContain("[Database]");
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

    await client.disconnect();
    expect(client.isConnected()).toBe(false);
    expect(client.getTools()).toHaveLength(0);
  });
});
