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
    "browser",
    "shell",
    "apply_patch",
    "update_task_progress",
    "image_gen",
    "list_themes",
    "describe_theme",
    "list_slide_layouts",
    "describe_slide_layout",
    "validate_slideml",
    "render_slideml",
    "append_slides",
    "read_slide",
    "replace_slide",
    "edit_slideml",
    "audit_pptx",
  ];

  it("has exactly 29 built-in tools", () => {
    const skills = getTools();
    expect(Object.keys(skills)).toHaveLength(29);
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
    expect(defs).toHaveLength(29);

    for (const def of defs) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.description.length).toBeGreaterThan(20); // Meaningful description
      expect(def.parameters).toBeDefined();
      expect(def.parameters.type).toBe("object");
      expect(def.parameters.properties).toBeDefined();
    }
  });

  it("all skills declare a required array (may be empty for purely-optional tools)", () => {
    const defs = getToolDefinitions();
    // A few tools (e.g. list_slide_layouts) take only optional parameters
    // because their behavior is fully defaulted. Declaring `required: []`
    // is still mandatory so the JSON schema is well-formed.
    // Tools whose runtime requires "at-least-one-of" semantics that
    // JSON Schema can't express directly — runtime checks in execute()
    // enforce the constraint, so `required: []` is intentional.
    const ALLOW_EMPTY_REQUIRED = new Set([
      "list_slide_layouts",
      "list_themes",
      "validate_slideml",  // accepts `path` OR `slideml`; runtime requires one
    ]);
    for (const def of defs) {
      const params = def.parameters as { required?: string[] };
      expect(params.required, `${def.name} must declare a required array`).toBeDefined();
      if (!ALLOW_EMPTY_REQUIRED.has(def.name)) {
        expect(params.required!.length, `${def.name} should have at least one required param`).toBeGreaterThan(0);
      }
    }
  });

  it("no duplicate skill names", () => {
    const defs = getToolDefinitions();
    const names = defs.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
