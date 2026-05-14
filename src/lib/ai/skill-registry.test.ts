import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/catalog-installer", () => ({
  syncInstalledCatalogSkills: vi.fn().mockResolvedValue({ updated: [], failed: [] }),
}));

vi.mock("./skill-loader", () => ({
  loadSkillsFromFilesystem: vi.fn().mockResolvedValue([]),
}));

import { syncInstalledCatalogSkills } from "@/lib/catalog-installer";
import { loadSkillsFromFilesystem } from "./skill-loader";
import { skillRegistry } from "./skill-registry";

describe("skill registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(syncInstalledCatalogSkills).mockResolvedValue({ updated: [], failed: [] });
    vi.mocked(loadSkillsFromFilesystem).mockResolvedValue([]);
  });

  it("syncs installed bundled skills before loading the runtime skill list", async () => {
    await skillRegistry.reload();

    expect(syncInstalledCatalogSkills).toHaveBeenCalledTimes(1);
    expect(loadSkillsFromFilesystem).toHaveBeenCalledTimes(1);
  });
});
