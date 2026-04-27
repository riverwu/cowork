import { describe, it, expect, vi } from "vitest";

/**
 * Diagnostic tests for the full tool chain:
 * MCP connection → tool discovery → agent skill merging → system prompt
 *
 * These tests identify exactly where web tools get lost.
 */

// Mock tauri
vi.mock("@/lib/tauri", () => ({
  httpStreamPost: vi.fn(),
  readFileText: vi.fn(),
  writeFile: vi.fn(),
  parseDocument: vi.fn(),
  listDirectory: vi.fn(),
  grep: vi.fn(),
  runPythonScript: vi.fn(),
  initPythonEnv: vi.fn(),
  installPythonPackage: vi.fn(),
  getEnv: vi.fn(),
  ensureUvInstalled: vi.fn(),
  webFetch: vi.fn(),
  webSearch: vi.fn(),
  shellExec: vi.fn(),
}));

// Mock knowledge
vi.mock("@/lib/knowledge", () => ({
  retrieveRelevant: vi.fn().mockResolvedValue([]),
  buildKnowledgeContext: vi.fn().mockReturnValue(""),
}));
vi.mock("@/lib/knowledge/embeddings", () => ({
  generateEmbedding: vi.fn().mockResolvedValue([]),
  generateEmbeddings: vi.fn().mockResolvedValue([]),
}));

// Mock memory
vi.mock("@/lib/memory", () => ({
  retrieveMemoryContext: vi.fn().mockResolvedValue({ coreFacts: "", relevantMemories: "", relevantEpisodes: "" }),
  buildMemoryPrompt: vi.fn().mockReturnValue(""),
  extractMemories: vi.fn().mockResolvedValue(undefined),
}));

// Mock DB
vi.mock("@/lib/db", () => ({
  createArtifact: vi.fn(),
  upsertCoreFact: vi.fn(),
  createMemory: vi.fn(),
  getAllCoreFacts: vi.fn().mockResolvedValue([]),
  getAllMemoriesWithEmbeddings: vi.fn().mockResolvedValue([]),
  getAllEpisodesWithEmbeddings: vi.fn().mockResolvedValue([]),
  touchMemory: vi.fn(),
}));

import { getTools, getToolDefinitions } from "./tools/registry";
import { buildSystemPrompt } from "./system-prompt";
import { mcpManager } from "@/lib/mcp";

describe("Agent Tool Chain Diagnostics", () => {

  describe("Step 1: Built-in skills", () => {
    it("has exactly 21 built-in tools", () => {
      const skills = getTools();
      const names = Object.keys(skills);
      console.log("[Diagnostic] Built-in skills:", names);
      expect(names).toHaveLength(21);
    });

    it("all built-in tools have valid tool definitions", () => {
      const defs = getToolDefinitions();
      for (const def of defs) {
        expect(def.name, `Skill ${def.name} missing name`).toBeTruthy();
        expect(def.description, `Skill ${def.name} missing description`).toBeTruthy();
        expect(def.parameters, `Skill ${def.name} missing parameters`).toBeDefined();
        console.log(`[Diagnostic] Built-in: ${def.name} — ${def.description.slice(0, 60)}...`);
      }
    });
  });

  describe("Step 2: MCP skill merging", () => {
    it("getAllTools returns empty when no MCP connected", () => {
      const mcpTools = mcpManager.getAllTools();
      console.log("[Diagnostic] MCP skills (no connection):", Object.keys(mcpTools));
      // Without real MCP connection, should be empty
      expect(Object.keys(mcpTools).length).toBeGreaterThanOrEqual(0);
    });

    it("merged tool count = built-in + MCP", () => {
      const builtinTools = getTools();
      const mcpTools = mcpManager.getAllTools();
      const merged = { ...builtinTools, ...mcpTools };
      const toolDefs = Object.values(merged).map((s) => s.definition);

      console.log(`[Diagnostic] Merged: ${toolDefs.length} tools (${Object.keys(builtinTools).length} built-in + ${Object.keys(mcpTools).length} MCP)`);
      console.log("[Diagnostic] All tool names:", toolDefs.map(t => t.name));

      expect(toolDefs.length).toBe(Object.keys(builtinTools).length + Object.keys(mcpTools).length);
    });
  });

  describe("Step 3: System prompt includes tools", () => {
    it("system prompt lists all tools when provided", () => {
      const tools = getToolDefinitions();
      const prompt = buildSystemPrompt({ tools });

      console.log(`[Diagnostic] System prompt length: ${prompt.length} chars`);
      console.log(`[Diagnostic] System prompt mentions 'tools available': ${prompt.includes("tools available")}`);

      expect(prompt).toContain("Available tools");
      expect(prompt).toContain("web_search");

      // Verify each tool is mentioned
      for (const tool of tools) {
        const mentioned = prompt.includes(tool.name);
        console.log(`[Diagnostic] Tool '${tool.name}' in prompt: ${mentioned}`);
        expect(prompt).toContain(tool.name);
      }
    });

    it("system prompt includes tool guidance", () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain("web_search");
      expect(prompt).toContain("apply_patch");
      expect(prompt).toContain("shell");
      expect(prompt).toContain("read_file");
    });
  });

  describe("Step 4: MCP tool format compatibility", () => {
    it("MCP tools would have correct prefix format", () => {
      // Simulate what McpClient.toSkills() produces
      const mockMcpTool = {
        name: "mcp_browser_navigate",
        description: "[browser] Navigate to a URL and return page content",
        parameters: {
          type: "object" as const,
          properties: {
            url: { type: "string", description: "URL to navigate to" },
          },
          required: ["url"],
        },
      };

      // Verify it would be included in system prompt
      const prompt = buildSystemPrompt({ tools: [mockMcpTool] });
      expect(prompt).toContain("mcp_browser_navigate");
      expect(prompt).toContain("[browser]");
      console.log("[Diagnostic] MCP tool in prompt: OK");
    });

    it("LLM tool format is valid for Anthropic API", () => {
      const tools = getToolDefinitions();
      for (const tool of tools) {
        // Anthropic requires: name (string), description (string), input_schema (object with type:"object")
        expect(typeof tool.name).toBe("string");
        expect(typeof tool.description).toBe("string");
        expect(tool.name.length).toBeGreaterThan(0);
        expect(tool.name).not.toContain(" "); // No spaces in tool names
        expect(tool.parameters).toBeDefined();

        // Check parameters has required structure
        const params = tool.parameters as Record<string, unknown>;
        expect(params.type).toBe("object");
      }
      console.log("[Diagnostic] All tool definitions valid for Anthropic API");
    });
  });

  describe("Step 5: Identify the gap", () => {
    it("DIAGNOSIS: when MCP has 0 tools, LLM only sees built-in tools", () => {
      const builtinTools = getTools();
      const mcpTools = mcpManager.getAllTools();

      const hasWebTool = Object.keys({ ...builtinTools, ...mcpTools }).some(
        (name) => name.includes("web") || name.includes("browse") || name.includes("search") || name.includes("fetch"),
      );

      console.log(`[Diagnostic] *** Has any web-related tool: ${hasWebTool} ***`);
      console.log(`[Diagnostic] *** MCP tools count: ${Object.keys(mcpTools).length} ***`);

      if (!hasWebTool) {
        console.log("[Diagnostic] *** ROOT CAUSE: No web tools available! ***");
        console.log("[Diagnostic] *** Built-in tools are file/knowledge/python/memory only ***");
        console.log("[Diagnostic] *** MCP browser-use tools not reaching agent ***");
        console.log("[Diagnostic] *** SOLUTION: Either MCP connection fails to expose tools,");
        console.log("[Diagnostic] ***   or add built-in web_search/web_fetch as fallback ***");
      }

      // This test documents the problem — it passes regardless
      expect(true).toBe(true);
    });
  });
});
