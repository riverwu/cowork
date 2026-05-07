import { afterEach, describe, expect, it, vi } from "vitest";
import { imageGen } from "./image-gen";
import { generateIconSheet } from "./generate-icon-sheet";
import { runPython } from "./run-python";

describe("generate_icon_sheet tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("declares icon-sheet generation parameters", () => {
    expect(generateIconSheet.definition.name).toBe("generate_icon_sheet");
    expect(generateIconSheet.definition.parameters.required).toEqual(["icons", "output_dir"]);
    const props = generateIconSheet.definition.parameters.properties as Record<string, unknown>;
    expect(props.icons).toBeDefined();
    expect(props.concepts).toBeDefined();
    expect(props.output_dir).toBeDefined();
    expect(props.style).toBeDefined();
    expect(props.palette).toBeDefined();
    expect(props.grid).toBeDefined();
  });

  it("validates required inputs before calling image generation", async () => {
    await expect(generateIconSheet.execute({ icons: [{ name: "bank" }] })).resolves.toMatch(/output_dir is required/);
    await expect(generateIconSheet.execute({ output_dir: "/tmp/icons" })).resolves.toMatch(/icons is required/);
    await expect(generateIconSheet.execute({ output_dir: "relative", icons: [{ name: "bank" }] })).resolves.toMatch(/absolute path/);
  });

  it("keeps filenames, labels, cell ids, and raw hex codes out of the image prompt", async () => {
    const imageSpy = vi.spyOn(imageGen, "execute").mockResolvedValue("Image generated and saved to /tmp/icons/icon-sheet.png.");
    vi.spyOn(runPython, "execute").mockResolvedValue(`ICON_SHEET_RESULT:${JSON.stringify({
      sheetPath: "/tmp/icons/icon-sheet.png",
      manifestPath: "/tmp/icons/manifest.json",
      grid: { columns: 1, rows: 1 },
      outputSize: 512,
      icons: [{ name: "bank", label: "银行", description: "front view bank building line icon", path: "/tmp/icons/bank.png" }],
    })}`);

    await generateIconSheet.execute({
      output_dir: "/tmp/icons",
      icons: [{ name: "bank", label: "银行", description: "front view bank building line icon" }],
      palette: ["#111827", "#2563EB", "#94A3B8"],
      grid: { columns: 1, rows: 1 },
    });

    const prompt = String(imageSpy.mock.calls[0]?.[0]?.prompt || "");
    expect(prompt).toContain("front view bank building line icon");
    expect(prompt).toContain("dark blue");
    expect(prompt).not.toContain("#111827");
    expect(prompt).not.toContain("银行");
    expect(prompt).not.toContain("bank)");
    expect(prompt).not.toContain("r1c1");
  });
});
