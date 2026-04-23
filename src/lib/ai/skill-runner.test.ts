import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  listSkills: vi.fn(),
}));

vi.mock("./providers", () => ({
  getConfiguredProvider: vi.fn(),
}));

import { listSkills } from "@/lib/db";
import { loadSkillTools, buildAppPrompt } from "./skill-runner";
import type { SkillRecord } from "@/types";

const mockListSkills = vi.mocked(listSkills);

const sampleSkill: SkillRecord = {
  id: "s1",
  name: "Image Generator",
  type: "skill",
  version: 1,
  definition: {
    purpose: "Generate images using AI models",
    instructions: [
      "Use the configured image generation API",
      "Return the image URL or save to disk",
    ],
    parameters: {
      prompt: { description: "Image description", default: "" },
    },
  },
  config: {},
  status: "active",
  createdAt: 1000,
  updatedAt: 1000,
};

const sampleApp: SkillRecord = {
  id: "a1",
  name: "Weekly Sales Analysis",
  type: "app",
  version: 1,
  definition: {
    purpose: "Analyze weekly sales anomalies and generate management brief",
    instructions: [
      "Focus on week-over-week changes exceeding 15%",
      "Cross-reference with customer complaints",
    ],
    qualityStandards: ["Exclude seasonal factors"],
    outputRequirements: "Executive brief, conclusions first",
    dataScope: "Shopify + CRM data",
  },
  config: {},
  status: "active",
  createdAt: 1000,
  updatedAt: 1000,
};

describe("loadSkillTools", () => {
  it("converts skill records to agent tools", async () => {
    mockListSkills.mockResolvedValue([sampleSkill]);
    const tools = await loadSkillTools();

    expect(Object.keys(tools)).toEqual(["skill_image_generator"]);
    const tool = tools["skill_image_generator"];
    expect(tool.definition.name).toBe("skill_image_generator");
    expect(tool.definition.description).toBe("Generate images using AI models");
  });

  it("tool description matches purpose (trigger mechanism)", async () => {
    mockListSkills.mockResolvedValue([sampleSkill]);
    const tools = await loadSkillTools();
    const tool = tools["skill_image_generator"];
    // Codex pattern: description IS the trigger — LLM reads this to decide when to call
    expect(tool.definition.description).toBe(sampleSkill.definition.purpose);
  });

  it("includes skill parameters in tool definition", async () => {
    mockListSkills.mockResolvedValue([sampleSkill]);
    const tools = await loadSkillTools();
    const params = tools["skill_image_generator"].definition.parameters as {
      properties: Record<string, unknown>;
    };
    expect(params.properties).toHaveProperty("task");
    expect(params.properties).toHaveProperty("prompt");
  });

  it("execute returns instructions for main agent (not a sub-agent)", async () => {
    mockListSkills.mockResolvedValue([sampleSkill]);
    const tools = await loadSkillTools();
    const result = await tools["skill_image_generator"].execute({
      task: "Generate a logo for my company",
    });

    // Result should contain instructions — returned to main agent
    expect(result).toContain("[Skill: Image Generator]");
    expect(result).toContain("Use the configured image generation API");
    expect(result).toContain("Generate a logo for my company");
    expect(result).toContain("Please execute this task now using your available tools");
  });

  it("returns empty when no skills", async () => {
    mockListSkills.mockResolvedValue([]);
    const tools = await loadSkillTools();
    expect(Object.keys(tools)).toHaveLength(0);
  });

  it("sanitizes skill names for tool IDs", async () => {
    mockListSkills.mockResolvedValue([{
      ...sampleSkill,
      name: "Deep Research (v2)",
    }]);
    const tools = await loadSkillTools();
    expect(Object.keys(tools)).toEqual(["skill_deep_research_v2"]);
  });
});

describe("buildAppPrompt", () => {
  it("includes app name and purpose", () => {
    const prompt = buildAppPrompt(sampleApp);
    expect(prompt).toContain("Weekly Sales Analysis");
    expect(prompt).toContain("Analyze weekly sales anomalies");
  });

  it("includes instructions", () => {
    const prompt = buildAppPrompt(sampleApp);
    expect(prompt).toContain("Focus on week-over-week changes exceeding 15%");
    expect(prompt).toContain("Cross-reference with customer complaints");
  });

  it("includes quality standards", () => {
    const prompt = buildAppPrompt(sampleApp);
    expect(prompt).toContain("Exclude seasonal factors");
  });

  it("includes output requirements", () => {
    const prompt = buildAppPrompt(sampleApp);
    expect(prompt).toContain("Executive brief, conclusions first");
  });

  it("includes data scope", () => {
    const prompt = buildAppPrompt(sampleApp);
    expect(prompt).toContain("Shopify + CRM data");
  });
});
