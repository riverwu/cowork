import { describe, it, expect } from "vitest";
import { getSkills, getSkill, getToolDefinitions } from "./registry";

describe("Skill Registry", () => {
  it("has all Phase 1 skills registered", () => {
    const skills = getSkills();
    expect(Object.keys(skills)).toContain("search_knowledge");
    expect(Object.keys(skills)).toContain("read_document");
    expect(Object.keys(skills)).toContain("analyze_data");
    expect(Object.keys(skills)).toContain("generate_report");
  });

  it("returns skill by name", () => {
    const skill = getSkill("search_knowledge");
    expect(skill).toBeDefined();
    expect(skill?.definition.name).toBe("search_knowledge");
  });

  it("returns undefined for unknown skill", () => {
    expect(getSkill("nonexistent")).toBeUndefined();
  });

  it("generates valid tool definitions", () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBe(4);

    for (const def of defs) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.parameters).toBeDefined();
      expect(def.parameters.type).toBe("object");
      expect(def.parameters.properties).toBeDefined();
    }
  });

  it("all skills have required parameters specified", () => {
    const defs = getToolDefinitions();
    for (const def of defs) {
      const params = def.parameters as { required?: string[] };
      expect(params.required).toBeDefined();
      expect(params.required!.length).toBeGreaterThan(0);
    }
  });
});
