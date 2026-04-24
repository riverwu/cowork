import { describe, it, expect } from "vitest";
import { getSkills, getSkill, getToolDefinitions } from "./registry";

describe("Skill Registry", () => {
  const EXPECTED_SKILLS = [
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
  ];

  it("has exactly 13 built-in skills", () => {
    const skills = getSkills();
    expect(Object.keys(skills)).toHaveLength(13);
  });

  it("has all expected skills registered", () => {
    const skills = getSkills();
    for (const name of EXPECTED_SKILLS) {
      expect(skills[name]).toBeDefined();
    }
  });

  it("returns skill by name", () => {
    const skill = getSkill("search_knowledge");
    expect(skill).toBeDefined();
    expect(skill?.definition.name).toBe("search_knowledge");
  });

  it("returns undefined for unknown skill", () => {
    expect(getSkill("nonexistent")).toBeUndefined();
  });

  it("generates valid tool definitions for all skills", () => {
    const defs = getToolDefinitions();
    expect(defs).toHaveLength(13);

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
