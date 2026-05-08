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
    expect(generateIconSheet.definition.description).toContain("deck planning archive");
    expect(generateIconSheet.definition.description).toContain("feature-card.iconSrc");
    expect(generateIconSheet.definition.description).toContain("timeline.items[].iconSrc");
    expect(generateIconSheet.definition.description).toContain("image-card.src");
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
    expect(prompt).toContain("no title");
    expect(prompt).toContain("no captions");
    expect(prompt).toContain("no explanatory text");
    expect(prompt).not.toContain("#111827");
    expect(prompt).not.toContain("银行");
    expect(prompt).not.toContain("bank)");
    expect(prompt).not.toContain("r1c1");
  });

  it("slices around detected icon subjects instead of trusting only hard grid cells", async () => {
    vi.spyOn(imageGen, "execute").mockResolvedValue("Image generated and saved to /tmp/icons/icon-sheet.png.");
    const pythonSpy = vi.spyOn(runPython, "execute").mockResolvedValue(`ICON_SHEET_RESULT:${JSON.stringify({
      sheetPath: "/tmp/icons/icon-sheet.png",
      manifestPath: "/tmp/icons/manifest.json",
      grid: { columns: 2, rows: 2 },
      outputSize: 768,
      icons: [
        { name: "bank", label: "bank", description: "bank building", path: "/tmp/icons/bank.png" },
        { name: "risk", label: "risk", description: "risk shield", path: "/tmp/icons/risk.png" },
      ],
    })}`);

    await generateIconSheet.execute({
      output_dir: "/tmp/icons",
      icons: [
        { name: "bank", description: "bank building" },
        { name: "risk", description: "risk shield" },
      ],
      grid: { columns: 2, rows: 2 },
    });

    const script = String(pythonSpy.mock.calls[0]?.[0]?.code || "");
    expect(script).toContain("expand_x = round(cell_w * 0.18)");
    expect(script).toContain("expected = ((left + right) / 2 - search_left");
    expect(script).toContain("bbox = icon_bbox(search, expected)");
    expect(script).toContain("text_like = wide_flat");
  });

  it("splits large icon sets into square sheets of at most 3x3", async () => {
    const icons = Array.from({ length: 12 }, (_, index) => ({
      name: `icon_${index + 1}`,
      description: `simple symbolic icon ${index + 1}`,
    }));
    const imageSpy = vi.spyOn(imageGen, "execute")
      .mockResolvedValueOnce("Image generated and saved to /tmp/icons/icon-sheet-1.png.")
      .mockResolvedValueOnce("Image generated and saved to /tmp/icons/icon-sheet-2.png.");
    vi.spyOn(runPython, "execute")
      .mockResolvedValueOnce(`ICON_SHEET_RESULT:${JSON.stringify({
        sheetPath: "/tmp/icons/icon-sheet-1.png",
        manifestPath: "/tmp/icons/manifest-sheet-1.json",
        grid: { columns: 3, rows: 3 },
        outputSize: 768,
        icons: icons.slice(0, 9).map((icon) => ({ ...icon, label: icon.name, path: `/tmp/icons/${icon.name}.png` })),
      })}`)
      .mockResolvedValueOnce(`ICON_SHEET_RESULT:${JSON.stringify({
        sheetPath: "/tmp/icons/icon-sheet-2.png",
        manifestPath: "/tmp/icons/manifest-sheet-2.json",
        grid: { columns: 2, rows: 2 },
        outputSize: 768,
        icons: icons.slice(9).map((icon) => ({ ...icon, label: icon.name, path: `/tmp/icons/${icon.name}.png` })),
      })}`)
      .mockResolvedValueOnce("ICON_MANIFEST_WRITTEN:/tmp/icons/manifest.json");

    const result = JSON.parse(String(await generateIconSheet.execute({
      output_dir: "/tmp/icons",
      icons,
      grid: { columns: 4, rows: 3 },
    })));

    expect(imageSpy).toHaveBeenCalledTimes(2);
    expect(imageSpy.mock.calls[0]?.[0]).toMatchObject({ output_path: "/tmp/icons/icon-sheet-1.png" });
    expect(String(imageSpy.mock.calls[0]?.[0]?.prompt)).toContain("square 3 by 3 icon sheet");
    expect(String(imageSpy.mock.calls[1]?.[0]?.prompt)).toContain("square 2 by 2 icon sheet");
    expect(result.icons).toHaveLength(12);
    expect(result.sheets).toMatchObject([
      { sheetPath: "/tmp/icons/icon-sheet-1.png", grid: { columns: 3, rows: 3 } },
      { sheetPath: "/tmp/icons/icon-sheet-2.png", grid: { columns: 2, rows: 2 } },
    ]);
  });
});
