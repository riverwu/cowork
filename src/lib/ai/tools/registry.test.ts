import { describe, it, expect } from "vitest";
import { getTools, getTool, getToolDefinitions } from "./registry";

describe("Tool Registry", () => {
  const EXPECTED_TOOLS = [
    "list_knowledge_sources",
    "get_source_catalog",
    "search_knowledge",
    "read_file",
    "write_file",
    "list_directory",
    "grep",
    "run_python",
    "run_node",
    "save_memory",
    "create_artifact",
    "web_search",
    "web_fetch",
    "browser",
    "shell",
    "apply_patch",
    "update_task_progress",
    "image_gen",
    "describe_schema",
    "create_deck",
    "read_deck",
    "replace_slide",
    "patch_deck",
    "validate_render",
  ];

  it(`has exactly ${EXPECTED_TOOLS.length} built-in tools`, () => {
    const tools = getTools();
    expect(Object.keys(tools)).toHaveLength(EXPECTED_TOOLS.length);
  });

  it("has all expected tools registered", () => {
    const tools = getTools();
    for (const name of EXPECTED_TOOLS) {
      expect(tools[name]).toBeDefined();
    }
  });

  it("returns tool by name", () => {
    const tool = getTool("search_knowledge");
    expect(tool).toBeDefined();
    expect(tool?.definition.name).toBe("search_knowledge");
  });

  it("returns undefined for unknown tool", () => {
    expect(getTool("nonexistent")).toBeUndefined();
  });

  it("generates valid tool definitions for all tools", () => {
    const defs = getToolDefinitions();
    expect(defs).toHaveLength(EXPECTED_TOOLS.length);

    for (const def of defs) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.description.length).toBeGreaterThan(20);
      expect(def.parameters).toBeDefined();
      expect(def.parameters.type).toBe("object");
      expect(def.parameters.properties).toBeDefined();
    }
  });

  it("all tools declare a required array (may be empty for purely-optional tools)", () => {
    const defs = getToolDefinitions();
    const ALLOW_EMPTY_REQUIRED = new Set<string>([
      "describe_schema",
    ]);
    for (const def of defs) {
      const params = def.parameters as { required?: string[] };
      expect(params.required, `${def.name} must declare a required array`).toBeDefined();
      if (!ALLOW_EMPTY_REQUIRED.has(def.name)) {
        expect(params.required!.length, `${def.name} should have at least one required param`).toBeGreaterThan(0);
      }
    }
  });

  it("no duplicate tool names", () => {
    const defs = getToolDefinitions();
    const names = defs.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
