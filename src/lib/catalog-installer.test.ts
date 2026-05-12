import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./tauri", () => ({
  readFileText: vi.fn(),
  writeFile: vi.fn(),
  deleteDirectory: vi.fn(),
}));

vi.mock("./ai/skill-loader", () => ({
  getSkillsDir: vi.fn().mockResolvedValue("/skills"),
}));

vi.mock("./mcp/loader", () => ({
  getMcpsDir: vi.fn().mockResolvedValue("/mcps"),
  installMcpToFilesystem: vi.fn(),
}));

import { readFileText, writeFile } from "./tauri";
import { getSkillInstallStatus, installCatalogSkill, syncInstalledCatalogSkills } from "./catalog-installer";

const mockReadFileText = vi.mocked(readFileText);
const mockWriteFile = vi.mocked(writeFile);

describe("catalog skill installer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileText.mockReset();
    mockWriteFile.mockReset();
  });

  it("marks an old no-manifest auxiliary-file install as needing update", async () => {
    mockReadFileText.mockImplementation(async (path: string) => {
      if (path === "/skills/slideml2/SKILL.md") return "---\nversion: 1.0.2\n---\n";
      throw new Error(`missing ${path}`);
    });

    const statuses = await getSkillInstallStatus();
    const slideml2 = statuses.find((status) => status.id === "slideml2");

    expect(slideml2?.installed).toBe(true);
    expect(slideml2?.needsUpdate).toBe(true);
  });

  it("installs auxiliary files and writes a manifest for future drift checks", async () => {
    mockWriteFile.mockResolvedValue(undefined);

    await installCatalogSkill("slideml2");

    expect(mockWriteFile).toHaveBeenCalledWith(
      "/skills/slideml2/business.md",
      expect.stringContaining("Business research decks are light-first"),
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/skills/slideml2/runtime/bin/slideml2.js",
      expect.stringContaining("usage: slideml2 <create-deck|replace-slide|read-deck|validate-render> <args.json>"),
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/skills/slideml2/runtime/dist/index.js",
      expect.stringContaining("renderToPptx"),
    );
    expect(mockWriteFile.mock.calls.some(([path]) => String(path).includes("/runtime/node_modules/"))).toBe(false);
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/skills/slideml2/.cowork-skill-manifest.json",
      expect.stringContaining("runtime/bin/slideml2.js"),
    );
    expect(mockWriteFile.mock.calls.some(([path]) => String(path).includes(".test."))).toBe(false);
  });

  it("syncs only installed catalog skills that are stale", async () => {
    mockReadFileText.mockImplementation(async (path: string) => {
      if (path === "/skills/slideml2/SKILL.md") return "---\nversion: 1.0.15\n---\n";
      throw new Error(`missing ${path}`);
    });
    mockWriteFile.mockResolvedValue(undefined);

    const result = await syncInstalledCatalogSkills();

    expect(result.updated).toEqual(["slideml2"]);
    expect(result.failed).toEqual([]);
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/skills/slideml2/SKILL.md",
      expect.stringContaining("Deck Planning Archive"),
    );
    expect(mockWriteFile).not.toHaveBeenCalledWith(
      expect.stringContaining("/skills/deep-research/"),
      expect.anything(),
    );
  });
});
