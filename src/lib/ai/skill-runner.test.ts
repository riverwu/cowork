import { describe, it, expect, vi } from "vitest";

// Mock the filesystem-based skill loader
vi.mock("./skill-loader", () => ({
  loadSkillsFromFilesystem: vi.fn(),
  getSkillsDir: vi.fn().mockResolvedValue("/Users/test/.cowork/skills"),
}));

import { loadSkillsFromFilesystem } from "./skill-loader";
import { loadSkillTools, buildAppPrompt } from "./skill-runner";
import type { SkillRecord } from "@/types";

// Need to define LoadedSkill type for mock
interface MockLoadedSkill {
  record: SkillRecord;
  dirPath: string;
  skillMdPath: string;
  hasScripts: boolean;
}

const mockLoadFs = vi.mocked(loadSkillsFromFilesystem);

const sampleSkill: MockLoadedSkill = {
  record: {
    id: "fs_image-generator",
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
    createdAt: 0,
    updatedAt: 0,
  },
  dirPath: "/Users/test/.cowork/skills/image-generator",
  skillMdPath: "/Users/test/.cowork/skills/image-generator/SKILL.md",
  hasScripts: true,
};

const sampleApp: SkillRecord = {
  id: "fs_weekly-sales",
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
  },
  config: {},
  status: "active",
  createdAt: 0,
  updatedAt: 0,
};

describe("loadSkillTools", () => {
  it("converts filesystem skill records to agent tools", async () => {
    mockLoadFs.mockResolvedValue([sampleSkill as any]);
    const tools = await loadSkillTools();
    expect(Object.keys(tools)).toEqual(["skill_image_generator"]);
  });

  it("tool description matches purpose (trigger mechanism)", async () => {
    mockLoadFs.mockResolvedValue([sampleSkill as any]);
    const tools = await loadSkillTools();
    expect(tools["skill_image_generator"].definition.description).toBe("Generate images using AI models");
  });

  it("execute returns instructions with skill directory path", async () => {
    mockLoadFs.mockResolvedValue([sampleSkill as any]);
    const tools = await loadSkillTools();
    const result = await tools["skill_image_generator"].execute({ task: "Create a logo" });

    expect(result).toContain("[Skill: Image Generator]");
    expect(result).toContain("Use the configured image generation API");
    expect(result).toContain("/Users/test/.cowork/skills/image-generator");
    expect(result).toContain("Create a logo");
  });

  it("includes scripts info when skill has scripts/", async () => {
    mockLoadFs.mockResolvedValue([sampleSkill as any]);
    const tools = await loadSkillTools();
    const result = await tools["skill_image_generator"].execute({ task: "test" });
    expect(result).toContain("scripts");
    expect(result).toContain("shell tool");
  });

  it("skips app-type records (only skills become tools)", async () => {
    const appLoaded = { ...sampleSkill, record: { ...sampleSkill.record, type: "app" as const } };
    mockLoadFs.mockResolvedValue([appLoaded as any]);
    const tools = await loadSkillTools();
    expect(Object.keys(tools)).toHaveLength(0);
  });

  it("returns empty when no filesystem skills", async () => {
    mockLoadFs.mockResolvedValue([]);
    const tools = await loadSkillTools();
    expect(Object.keys(tools)).toHaveLength(0);
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
  });

  it("includes quality standards", () => {
    const prompt = buildAppPrompt(sampleApp);
    expect(prompt).toContain("Exclude seasonal factors");
  });

  it("includes output requirements", () => {
    const prompt = buildAppPrompt(sampleApp);
    expect(prompt).toContain("Executive brief, conclusions first");
  });
});
