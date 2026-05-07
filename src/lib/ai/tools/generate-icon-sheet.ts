import type { Tool } from "./types";
import { imageGen } from "./image-gen";
import { runPython } from "./run-python";

interface IconRequest {
  name: string;
  label: string;
  description: string;
}

interface GridSpec {
  columns: number;
  rows: number;
}

export const generateIconSheet: Tool = {
  definition: {
    name: "generate_icon_sheet",
    description:
      `Generate a consistent icon set for a deck by creating one AI image icon sheet, slicing it into individual PNG icons, and writing a manifest.

Use for semantic business/technical/education/science icon sets such as bank, finance, trend, risk, user, automation, database, workflow. The tool internally calls image_gen with a strict grid prompt, then uses Pillow to crop each grid cell into a named icon file under output_dir.

Output icons are intended for SlideML2 image/image-card/feature-card iconSrc usage. After this tool returns, place icons by absolute path with fit:"contain"; for feature cards use iconSrc.

Do not use for exact data charts or diagrams with text. Use structured SlideML2 charts/tables or run_python charting for precise numbers.`,
    parameters: {
      type: "object",
      properties: {
        icons: {
          type: "array",
          description: "Required icon specs. Each item is {name:string ascii_slug, label?:string, description?:string}. Name becomes the output filename under output_dir.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Stable ascii filename stem, e.g. bank, trend_up, risk_control." },
              label: { type: "string", description: "Human meaning; may be Chinese." },
              description: { type: "string", description: "Visual-only instruction for this icon. Do not include text that should appear in the image." },
            },
            required: ["name", "description"],
          },
        },
        concepts: {
          type: "array",
          description: "Alias for icons. Accepts strings or {name,label,description}; use icons for best filenames.",
          items: { type: "object" },
        },
        output_dir: { type: "string", description: "Absolute current-run assets/icons directory for outputs, e.g. /.../.cowork-runs/run_x/assets/icons." },
        style: { type: "string", description: "Visual style, e.g. 'premium business line icons, rounded geometry, minimal'." },
        palette: { type: "array", items: { type: "string" }, description: "Theme colors as hex/token-like strings, e.g. ['#111827','#2563EB','#94A3B8']." },
        grid: {
          type: "object",
          description: "Optional {columns, rows}. Defaults to the smallest near-square grid.",
          properties: {
            columns: { type: "number" },
            rows: { type: "number" },
          },
        },
        background: { type: "string", description: "Icon sheet background instruction. Default 'pure white background, no border'." },
        size: { type: "string", description: "Image_gen size preset. Default 4096x4096." },
        seed: { type: "number", description: "Optional image generation seed." },
        output_size: { type: "number", description: "Individual icon PNG square size in pixels. Default 768." },
        make_transparent: { type: "boolean", description: "Default true. Removes near-background pixels from each crop when possible." },
      },
      required: ["icons", "output_dir"],
    },
  },

  async execute(input) {
    const outputDir = String(input.output_dir || "").trim();
    if (!outputDir) return "Error: output_dir is required and must be an absolute assets directory.";
    if (!outputDir.startsWith("/")) return `Error: output_dir must be an absolute path (got: ${outputDir}).`;

    const icons = normalizeIcons(input.icons ?? input.concepts);
    if (typeof icons === "string") return icons;
    if (icons.length === 0) return "Error: icons is required and must contain at least one icon spec.";
    if (icons.length > 25) return "Error: generate_icon_sheet supports at most 25 icons per sheet. Split larger sets into multiple calls.";

    const grid = normalizeGrid(input.grid, icons.length);
    if (grid.columns * grid.rows < icons.length) {
      return `Error: grid ${grid.columns}x${grid.rows} has ${grid.columns * grid.rows} cells but ${icons.length} icons were requested.`;
    }

    const style = String(input.style || "premium standalone business line icons, rounded geometry, minimal, consistent stroke, no tile background").trim();
    const palette = normalizePalette(input.palette);
    const background = String(input.background || "pure white sheet background only, no border, no labels, no icon tiles").trim();
    const size = typeof input.size === "string" && input.size.trim() ? input.size.trim() : "4096x4096";
    const seed = typeof input.seed === "number" ? Math.floor(input.seed) : undefined;
    const outputSize = clampInt(input.output_size, 256, 2048, 768);
    const makeTransparent = input.make_transparent !== false;
    const sheetPath = `${outputDir.replace(/\/+$/, "")}/icon-sheet.png`;
    const manifestPath = `${outputDir.replace(/\/+$/, "")}/manifest.json`;
    const prompt = buildIconSheetPrompt({ icons, grid, style, palette, background });

    const genResult = await imageGen.execute({
      prompt,
      output_path: sheetPath,
      size,
      seed,
    });
    if (/^Error:/i.test(genResult)) return genResult;

    const cropResult = await cropIconSheet({
      sheetPath,
      outputDir,
      manifestPath,
      icons,
      grid,
      outputSize,
      makeTransparent,
      prompt,
      imageGenResult: genResult,
    });
    if (/^Error:/i.test(cropResult)) return cropResult;
    return cropResult;
  },

  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    try {
      const parsed = JSON.parse(rawResult) as { manifestPath?: string; icons?: Array<{ path?: string }> };
      return `→ icon set ${parsed.manifestPath || ""} (${parsed.icons?.length || 0} icons)`.trim();
    } catch {
      return rawResult.slice(0, 160);
    }
  },
};

function normalizeIcons(value: unknown): IconRequest[] | string {
  if (!Array.isArray(value)) return "Error: icons is required and must be an array.";
  const seen = new Map<string, number>();
  const icons: IconRequest[] = [];
  value.forEach((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const rawName = typeof item === "string" ? item : String(record.name || record.id || record.key || "");
    const rawLabel = typeof item === "string" ? item : String(record.label || record.title || record.name || rawName || "");
    const rawDescription = typeof item === "string" ? item : String(record.description || record.prompt || record.body || rawLabel || rawName || "");
    let name = slugify(rawName) || slugify(rawLabel) || `icon_${index + 1}`;
    const count = seen.get(name) || 0;
    seen.set(name, count + 1);
    if (count > 0) name = `${name}_${count + 1}`;
    icons.push({
      name,
      label: rawLabel.trim() || name,
      description: rawDescription.trim() || rawLabel.trim() || name,
    });
  });
  return icons;
}

function normalizeGrid(value: unknown, count: number): GridSpec {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const explicitColumns = typeof record.columns === "number" ? Math.floor(record.columns) : undefined;
  const explicitRows = typeof record.rows === "number" ? Math.floor(record.rows) : undefined;
  if (explicitColumns && explicitRows) return { columns: Math.max(1, explicitColumns), rows: Math.max(1, explicitRows) };
  if (explicitColumns) return { columns: Math.max(1, explicitColumns), rows: Math.ceil(count / Math.max(1, explicitColumns)) };
  if (explicitRows) return { columns: Math.ceil(count / Math.max(1, explicitRows)), rows: Math.max(1, explicitRows) };
  const columns = Math.ceil(Math.sqrt(count));
  return { columns, rows: Math.ceil(count / columns) };
}

function normalizePalette(value: unknown): string[] {
  if (!Array.isArray(value)) return ["#111827", "#2563EB", "#94A3B8"];
  return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 6);
}

function describePalette(palette: string[]): string {
  const names = palette
    .map(colorName)
    .filter(Boolean);
  return Array.from(new Set(names)).join(", ") || "dark neutral, blue accent, cool gray";
}

function colorName(value: string): string {
  const parsed = parseHexColor(value);
  if (!parsed) return value.replace(/[#0-9a-f]/gi, "").trim() || "accent color";
  const { r, g, b } = parsed;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 510;
  const chroma = max - min;
  if (chroma < 16) {
    if (lightness < 0.18) return "near-black neutral";
    if (lightness > 0.82) return "near-white neutral";
    return lightness < 0.48 ? "dark gray" : "light gray";
  }
  const hue = rgbHue(r, g, b);
  const tone = lightness < 0.34 ? "dark" : lightness > 0.72 ? "light" : "clear";
  if (hue < 20 || hue >= 340) return `${tone} red`;
  if (hue < 45) return `${tone} orange`;
  if (hue < 70) return `${tone} yellow`;
  if (hue < 165) return `${tone} green`;
  if (hue < 200) return `${tone} cyan`;
  if (hue < 255) return `${tone} blue`;
  if (hue < 290) return `${tone} purple`;
  return `${tone} magenta`;
}

function parseHexColor(value: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const raw = match[1];
  const full = raw.length === 3
    ? raw.split("").map((ch) => `${ch}${ch}`).join("")
    : raw;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function rgbHue(r: number, g: number, b: number): number {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue = 0;
  if (max === rn) hue = ((gn - bn) / delta) % 6;
  else if (max === gn) hue = (bn - rn) / delta + 2;
  else hue = (rn - gn) / delta + 4;
  return (hue * 60 + 360) % 360;
}

function buildIconSheetPrompt(input: {
  icons: IconRequest[];
  grid: GridSpec;
  style: string;
  palette: string[];
  background: string;
}): string {
  const cells = input.icons.map((icon, index) => {
    return `${positionPhrase(index, input.grid)}: ${icon.description}`;
  }).join("\n");
  const blankCount = input.grid.columns * input.grid.rows - input.icons.length;
  const blanks = blankCount > 0 ? ` Leave the final ${blankCount} unused cell${blankCount === 1 ? "" : "s"} empty.` : "";
  return [
    `Create a single ${input.grid.columns} by ${input.grid.rows} icon sheet for a PowerPoint deck.`,
    `Style: ${input.style}.`,
    `Palette: ${describePalette(input.palette)}. Use only these colors plus transparent/white negative space. Do not render color names, codes, swatches, or palette samples.`,
    `Background: ${input.background}.`,
    "Critical layout rules: exact regular grid, one centered standalone icon per cell, generous padding inside every cell, all icons same visual weight, consistent stroke width, no cropping, no overlap between cells.",
    "Do not place icons inside rounded-square app tiles, cards, boxes, circles, badges, frames, shadows, or button backgrounds. Each cell should contain only the symbolic icon on plain white/transparent negative space.",
    "Content rules: no words, no letters, no numbers, no row or column names, no labels, no watermarks, no UI mockups, no realistic photos. Use simple symbolic vector-like icons.",
    cells,
    blanks,
  ].filter(Boolean).join("\n");
}

function positionPhrase(index: number, grid: GridSpec): string {
  const row = Math.floor(index / grid.columns);
  const col = index % grid.columns;
  return `${rowPhrase(row, grid.rows)}, ${columnPhrase(col, grid.columns)}`;
}

function rowPhrase(row: number, rows: number): string {
  if (rows <= 1) return "center row";
  if (row === 0) return "top row";
  if (row === rows - 1) return "bottom row";
  if (row < rows / 2) return "upper middle row";
  if (row > rows / 2) return "lower middle row";
  return "middle row";
}

function columnPhrase(column: number, columns: number): string {
  if (columns <= 1) return "center column";
  if (column === 0) return "left column";
  if (column === columns - 1) return "right column";
  if (column < columns / 2) return "left middle column";
  if (column > columns / 2) return "right middle column";
  return "middle column";
}

async function cropIconSheet(input: {
  sheetPath: string;
  outputDir: string;
  manifestPath: string;
  icons: IconRequest[];
  grid: GridSpec;
  outputSize: number;
  makeTransparent: boolean;
  prompt: string;
  imageGenResult: string;
}): Promise<string> {
  const script = `
import json
from pathlib import Path
from PIL import Image

cfg = json.loads(${JSON.stringify(JSON.stringify(input))})
sheet_path = Path(cfg["sheetPath"]).expanduser()
output_dir = Path(cfg["outputDir"]).expanduser()
manifest_path = Path(cfg["manifestPath"]).expanduser()
output_dir.mkdir(parents=True, exist_ok=True)

img = Image.open(sheet_path).convert("RGBA")
w, h = img.size
cols = int(cfg["grid"]["columns"])
rows = int(cfg["grid"]["rows"])
cell_w = w / cols
cell_h = h / rows
out_size = int(cfg["outputSize"])
transparent = bool(cfg["makeTransparent"])
icons_out = []

def bg_from_corners(im):
    px = im.load()
    pts = [(0,0), (im.width-1,0), (0,im.height-1), (im.width-1,im.height-1)]
    vals = [px[x,y] for x,y in pts]
    return tuple(int(sum(v[i] for v in vals) / len(vals)) for i in range(3))

def near_white_background(r, g, b):
    return r >= 218 and g >= 218 and b >= 218 and (max(r, g, b) - min(r, g, b)) <= 34

def is_background_pixel(r, g, b, a, bg, threshold=26):
    if a <= 8:
        return True
    diff = abs(r-bg[0]) + abs(g-bg[1]) + abs(b-bg[2])
    return diff <= threshold or near_white_background(r, g, b)

def content_bbox(im, threshold=26):
    bg = bg_from_corners(im)
    mask = Image.new("L", im.size, 0)
    src = im.load()
    dst = mask.load()
    for y in range(im.height):
        for x in range(im.width):
            r,g,b,a = src[x,y]
            if not is_background_pixel(r, g, b, a, bg, threshold):
                dst[x,y] = 255
    return mask.getbbox()

for index, icon in enumerate(cfg["icons"]):
    col = index % cols
    row = index // cols
    left = round(col * cell_w)
    top = round(row * cell_h)
    right = round((col + 1) * cell_w)
    bottom = round((row + 1) * cell_h)
    cell = img.crop((left, top, right, bottom))
    inset_x = max(0, round(cell.width * 0.055))
    inset_y = max(0, round(cell.height * 0.055))
    cell = cell.crop((inset_x, inset_y, cell.width - inset_x, cell.height - inset_y))
    if transparent:
        bbox = content_bbox(cell)
        if bbox:
            pad = max(12, round(max(cell.width, cell.height) * 0.04))
            l,t,r,b = bbox
            l = max(0, l - pad); t = max(0, t - pad)
            r = min(cell.width, r + pad); b = min(cell.height, b + pad)
            cell = cell.crop((l,t,r,b))
            bg = bg_from_corners(cell)
            data = []
            for r0,g0,b0,a0 in cell.getdata():
                data.append((r0,g0,b0,0 if is_background_pixel(r0, g0, b0, a0, bg) else a0))
            cell.putdata(data)
    cell.thumbnail((round(out_size * 0.82), round(out_size * 0.82)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (out_size, out_size), (255,255,255,0 if transparent else 255))
    x = (out_size - cell.width) // 2
    y = (out_size - cell.height) // 2
    canvas.alpha_composite(cell, (x, y))
    icon_path = output_dir / f"{icon['name']}.png"
    canvas.save(icon_path)
    icons_out.append({
        "name": icon["name"],
        "label": icon["label"],
        "description": icon["description"],
        "path": str(icon_path),
    })

manifest = {
    "sheetPath": str(sheet_path),
    "manifestPath": str(manifest_path),
    "grid": cfg["grid"],
    "outputSize": out_size,
    "makeTransparent": transparent,
    "prompt": cfg["prompt"],
    "imageGenResult": cfg["imageGenResult"],
    "icons": icons_out,
}
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print("ICON_SHEET_RESULT:" + json.dumps(manifest, ensure_ascii=False))
`;
  const result = await runPython.execute({ code: script, timeout: 120 });
  if (/Process exited with code|Python execution error|Package installation failed/i.test(result)) {
    return `Error: failed to slice icon sheet.\n${result}`;
  }
  const match = /ICON_SHEET_RESULT:(\{[\s\S]*\})/.exec(result);
  if (!match) return `Error: icon sheet was generated but slicing did not return a manifest.\n${result}`;
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return `Error: slicing returned invalid manifest JSON.\n${result}`;
  }
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
