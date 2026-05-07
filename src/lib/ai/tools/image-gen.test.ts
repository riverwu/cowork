import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  getSettings: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  downloadUrl: vi.fn(),
  getEnv: vi.fn(),
  httpPost: vi.fn(),
  readFileBase64: vi.fn(),
}));

import { getSettings } from "@/lib/db";
import { downloadUrl, getEnv, httpPost } from "@/lib/tauri";
import { imageGen } from "./image-gen";

describe("image_gen tool", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("declares the expected name and required params", () => {
    expect(imageGen.definition.name).toBe("image_gen");
    expect(imageGen.definition.parameters.required).toEqual(["prompt", "output_path"]);
    const props = imageGen.definition.parameters.properties as Record<string, unknown>;
    expect(props.prompt).toBeDefined();
    expect(props.output_path).toBeDefined();
    expect(props.reference_images).toBeDefined();
    expect(props.size).toBeDefined();
    expect(props.seed).toBeDefined();
  });

  it("returns a clear error when required inputs are missing", async () => {
    expect(await imageGen.execute({ output_path: "/tmp/out.png" })).toMatch(/prompt is required/);
    expect(await imageGen.execute({ prompt: "a cat" })).toMatch(/output_path is required/);
  });

  it("falls back to ARK image env vars when app settings are empty", async () => {
    vi.mocked(getSettings).mockResolvedValue({ llmProvider: "anthropic" });
    vi.mocked(getEnv).mockImplementation(async (key: string) => {
      if (key === "ARK_API_KEY") return "ark-key";
      if (key === "ARK_API") return "https://ark.example.com/api/v3/images/generations";
      if (key === "ARK_MODEL") return "seedream-test";
      return null;
    });
    vi.mocked(httpPost).mockResolvedValue({
      status: 200,
      body: JSON.stringify({ data: [{ url: "https://example.com/icon.png" }] }),
    });
    vi.mocked(downloadUrl).mockResolvedValue("/tmp/out.png");

    const result = await imageGen.execute({ prompt: "line icon", output_path: "/tmp/out.png" });

    expect(result).toContain("/tmp/out.png");
    expect(httpPost).toHaveBeenCalledWith(
      "https://ark.example.com/api/v3/images/generations",
      { Authorization: "Bearer ark-key" },
      expect.stringContaining('"model":"seedream-test"'),
    );
    expect(downloadUrl).toHaveBeenCalledWith("https://example.com/icon.png", "/tmp/out.png");
  });
});
