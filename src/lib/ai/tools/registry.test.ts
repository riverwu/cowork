import { describe, it, expect } from "vitest";
import { getTools, getTool, getToolDefinitions } from "./registry";

describe("Tool Registry", () => {
  const EXPECTED_SKILLS = [
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
    "shell",
    "apply_patch",
    "update_task_progress",
    "image_gen",
  ];

  it("has exactly 17 built-in tools", () => {
    const skills = getTools();
    expect(Object.keys(skills)).toHaveLength(17);
  });

  it("has all expected skills registered", () => {
    const skills = getTools();
    for (const name of EXPECTED_SKILLS) {
      expect(skills[name]).toBeDefined();
    }
  });

  it("returns skill by name", () => {
    const skill = getTool("search_knowledge");
    expect(skill).toBeDefined();
    expect(skill?.definition.name).toBe("search_knowledge");
  });

  it("returns undefined for unknown skill", () => {
    expect(getTool("nonexistent")).toBeUndefined();
  });

  it("generates valid tool definitions for all skills", () => {
    const defs = getToolDefinitions();
    expect(defs).toHaveLength(17);

    for (const def of defs) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.description.length).toBeGreaterThan(20); // Meaningful description
      expect(def.parameters).toBeDefined();
      expect(def.parameters.type).toBe("object");
      expect(def.parameters.properties).toBeDefined();
    }
  });

  it("all skills have required parameters", () => {
    const defs = getToolDefinitions();
    for (const def of defs) {
      const params = def.parameters as { required?: string[] };
      expect(params.required).toBeDefined();
      expect(params.required!.length).toBeGreaterThan(0);
    }
  });

  it("no duplicate skill names", () => {
    const defs = getToolDefinitions();
    const names = defs.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
