import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { __iconSheetTest, sliceIconSheet } from "./icon-sheet.js";

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/icon-sheets/seedream");

describe("icon sheet slicing", () => {
  it("slices sheets separated by black grid lines without keeping the frames", async () => {
    const dir = await mkdtemp(join(tmpdir(), "slideml2-icons-"));
    try {
      const sheet = syntheticSheet(240, 240, { left: 0, top: 0, right: 240, bottom: 240 }, 2, 2);
      const sheetPath = join(dir, "sheet.png");
      await writeFile(sheetPath, __iconSheetTest.encodePngRgba(sheet));

      const manifest = await sliceIconSheet({
        sheetPath,
        outputDir: join(dir, "icons"),
        icons: [
          { name: "bank", description: "bank" },
          { name: "risk", description: "risk" },
          { name: "growth", description: "growth" },
          { name: "team", description: "team" },
        ],
        grid: "2x2",
        outputSize: 96,
        makeTransparent: true,
      });

      expect(manifest.icons).toHaveLength(4);
      for (const icon of manifest.icons) {
        const image = __iconSheetTest.decodePngRgba(await readFile(icon.path));
        const bbox = alphaBBox(image);
        expect(bbox, icon.name).toBeTruthy();
        expect(edgeDarkOpaquePixels(image), icon.name).toBeLessThan(10);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects a bordered grid below a stray title band", async () => {
    const dir = await mkdtemp(join(tmpdir(), "slideml2-icons-margin-"));
    try {
      const gridRect = { left: 30, top: 80, right: 290, bottom: 340 };
      const sheet = syntheticSheet(320, 360, gridRect, 2, 2, true);
      const sheetPath = join(dir, "sheet.png");
      await writeFile(sheetPath, __iconSheetTest.encodePngRgba(sheet));

      const manifest = await sliceIconSheet({
        sheetPath,
        outputDir: join(dir, "icons"),
        icons: ["one", "two", "three", "four"],
        grid: { columns: 2, rows: 2 },
        outputSize: 64,
      });

      expect(manifest.icons).toHaveLength(4);
      expect(manifest.icons[0]!.crop.y).toBeGreaterThanOrEqual(80);
      expect(manifest.icons[0]!.crop.x).toBeGreaterThanOrEqual(30);
      expect(manifest.icons[3]!.crop.y).toBeGreaterThan(180);
      expect(manifest.icons[3]!.crop.x).toBeGreaterThan(150);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("slices real Seedream-generated JPEG sheets saved with png extensions", async () => {
    const cases = [
      {
        file: "youdao-business-3x3.seedream.png",
        grid: { columns: 3, rows: 3 },
        icons: ["startup", "education", "hardware", "marketing", "ai_chip", "finance", "globe", "trophy", "warning"],
        minAlphaRatio: 0.05,
      },
      {
        file: "chilechuan-dark-3x3-six-icons.seedream.png",
        grid: { columns: 3, rows: 3 },
        icons: ["mountain", "yurt", "sky", "grassland", "sheep", "wind"],
        minAlphaRatio: 0.012,
      },
      {
        file: "physics-dark-3x3.seedream.png",
        grid: { columns: 3, rows: 3 },
        icons: ["inertia", "acceleration", "force_arrow", "action_reaction", "impulse", "momentum", "spring_energy", "rotation", "orbit"],
        minAlphaRatio: 0.035,
      },
      {
        file: "physics-dark-1x1.seedream.png",
        grid: { columns: 1, rows: 1 },
        icons: ["wave"],
        minAlphaRatio: 0.035,
      },
    ];

    for (const testCase of cases) {
      const dir = await mkdtemp(join(tmpdir(), `slideml2-seedream-${testCase.file}-`));
      try {
        const sheetPath = join(fixtureRoot, testCase.file);
        const sheetBytes = await readFile(sheetPath);
        expect([...sheetBytes.subarray(0, 2)], testCase.file).toEqual([0xff, 0xd8]);
        const sheet = __iconSheetTest.decodeImageRgba(sheetBytes);

        const manifest = await sliceIconSheet({
          sheetPath,
          outputDir: join(dir, "icons"),
          icons: testCase.icons,
          grid: testCase.grid,
          outputSize: 256,
          makeTransparent: true,
        });

        expect(manifest.icons).toHaveLength(testCase.icons.length);
        for (const [index, icon] of manifest.icons.entries()) {
          expect(icon.name).toBe(testCase.icons[index]);
          expect(icon.cell).toEqual({
            row: Math.floor(index / testCase.grid.columns),
            column: index % testCase.grid.columns,
          });
          expectCropInExpectedGridCell(icon.crop, sheet.width, sheet.height, testCase.grid.columns, testCase.grid.rows, index);

          const output = __iconSheetTest.decodePngRgba(await readFile(icon.path));
          const stats = alphaStats(output);
          expect(stats.alphaRatio, `${testCase.file}:${icon.name}`).toBeGreaterThan(testCase.minAlphaRatio);
          expect(stats.edgeOpaque, `${testCase.file}:${icon.name}`).toBeLessThan(64);
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });
});

function syntheticSheet(width: number, height: number, grid: { left: number; top: number; right: number; bottom: number }, columns: number, rows: number, titleBand = false) {
  const image = blankImage(width, height, [255, 255, 255, 255]);
  if (titleBand) {
    fillRect(image, 62, 22, 258, 42, [20, 20, 20, 255]);
    fillRect(image, 92, 50, 228, 58, [45, 45, 45, 255]);
  }
  const cellW = (grid.right - grid.left) / columns;
  const cellH = (grid.bottom - grid.top) / rows;
  for (let c = 0; c <= columns; c += 1) {
    const x = Math.round(grid.left + c * cellW);
    fillRect(image, x - 2, grid.top, x + 2, grid.bottom, [0, 0, 0, 255]);
  }
  for (let r = 0; r <= rows; r += 1) {
    const y = Math.round(grid.top + r * cellH);
    fillRect(image, grid.left, y - 2, grid.right, y + 2, [0, 0, 0, 255]);
  }
  const colors: Array<[number, number, number, number]> = [
    [37, 99, 235, 255],
    [220, 38, 38, 255],
    [22, 163, 74, 255],
    [124, 58, 237, 255],
  ];
  for (let index = 0; index < columns * rows; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cx = Math.round(grid.left + column * cellW + cellW / 2);
    const cy = Math.round(grid.top + row * cellH + cellH / 2);
    fillRect(image, cx - 24, cy - 18, cx + 24, cy + 18, colors[index % colors.length]!);
    fillRect(image, cx - 12, cy - 34, cx + 12, cy - 18, colors[index % colors.length]!);
  }
  return image;
}

function blankImage(width: number, height: number, rgba: [number, number, number, number]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }
  return { width, height, data };
}

function fillRect(image: { width: number; height: number; data: Uint8Array }, left: number, top: number, right: number, bottom: number, rgba: [number, number, number, number]) {
  for (let y = Math.max(0, top); y < Math.min(image.height, bottom); y += 1) {
    for (let x = Math.max(0, left); x < Math.min(image.width, right); x += 1) {
      const idx = (y * image.width + x) * 4;
      image.data[idx] = rgba[0];
      image.data[idx + 1] = rgba[1];
      image.data[idx + 2] = rgba[2];
      image.data[idx + 3] = rgba[3];
    }
  }
}

function alphaBBox(image: { width: number; height: number; data: Uint8Array }) {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = image.data[(y * image.width + x) * 4 + 3]!;
      if (alpha <= 8) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right >= left && bottom >= top ? { left, top, right, bottom } : null;
}

function edgeDarkOpaquePixels(image: { width: number; height: number; data: Uint8Array }): number {
  let count = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (x > 1 && x < image.width - 2 && y > 1 && y < image.height - 2) continue;
      const idx = (y * image.width + x) * 4;
      const dark = image.data[idx]! < 40 && image.data[idx + 1]! < 40 && image.data[idx + 2]! < 40;
      if (dark && image.data[idx + 3]! > 200) count += 1;
    }
  }
  return count;
}

function alphaStats(image: { width: number; height: number; data: Uint8Array }): { alphaRatio: number; edgeOpaque: number } {
  let opaque = 0;
  let edgeOpaque = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = image.data[(y * image.width + x) * 4 + 3]!;
      if (alpha <= 8) continue;
      opaque += 1;
      if (x < 3 || x >= image.width - 3 || y < 3 || y >= image.height - 3) edgeOpaque += 1;
    }
  }
  return { alphaRatio: opaque / (image.width * image.height), edgeOpaque };
}

function expectCropInExpectedGridCell(
  crop: { x: number; y: number; width: number; height: number },
  sheetWidth: number,
  sheetHeight: number,
  columns: number,
  rows: number,
  index: number,
): void {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const cellWidth = sheetWidth / columns;
  const cellHeight = sheetHeight / rows;
  const slackX = cellWidth * 0.10;
  const slackY = cellHeight * 0.10;
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;

  expect(centerX).toBeGreaterThanOrEqual(column * cellWidth - slackX);
  expect(centerX).toBeLessThanOrEqual((column + 1) * cellWidth + slackX);
  expect(centerY).toBeGreaterThanOrEqual(row * cellHeight - slackY);
  expect(centerY).toBeLessThanOrEqual((row + 1) * cellHeight + slackY);
  expect(crop.width).toBeGreaterThanOrEqual(cellWidth * 0.10);
  expect(crop.height).toBeGreaterThanOrEqual(cellHeight * 0.10);
  expect(crop.width).toBeLessThanOrEqual(sheetWidth);
  expect(crop.height).toBeLessThanOrEqual(sheetHeight);
}
