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
import { getSkillInstallStatus, installCatalogSkill } from "./catalog-installer";

const mockReadFileText = vi.mocked(readFileText);
const mockWriteFile = vi.mocked(writeFile);

describe("catalog skill installer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      "/skills/slideml2/.cowork-skill-manifest.json",
      expect.stringContaining("business.md"),
    );
    expect(mockWriteFile.mock.calls.some(([path]) => String(path).includes(".test."))).toBe(false);
  });
});
