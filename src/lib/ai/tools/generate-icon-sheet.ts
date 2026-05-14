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

interface IconManifest {
  sheetPath: string;
  manifestPath: string;
  grid: GridSpec;
  outputSize: number;
  makeTransparent?: boolean;
  prompt?: string;
  imageGenResult?: string;
  icons: Array<IconRequest & { path: string }>;
  sheets?: Array<{
    sheetPath: string;
    grid: GridSpec;
    prompt?: string;
    imageGenResult?: string;
    icons: string[];
  }>;
}

export const generateIconSheet: Tool = {
  definition: {
    name: "generate_icon_sheet",
    description:
      `Generate a consistent icon set for a deck by creating one or more AI image icon sheets, slicing them into individual PNG icons, and writing a manifest.

Use for semantic business/technical/education/science icon sets such as bank, finance, trend, risk, user, automation, database, workflow. The tool internally calls image_gen with strict square grid prompts, then uses Pillow to detect the actual generated grid, remove stray labels/tile frames, and crop each icon into a named PNG file under output_dir. Generated sheets are constrained to NxN layouts only, max 3x3 per generated image; larger icon sets are split across multiple sheets automatically.

Output icons are intended for SlideML2 image/image-card/feature-card/timeline iconSrc usage. Before calling this tool, the deck planning archive should already map each requested icon name to a slide and field such as feature-card.iconSrc, timeline.items[].iconSrc, or image-card.src. After this tool returns, place icons by absolute path with fit:"contain"; for feature cards and timeline milestones use iconSrc. A later validate_render call warns if the current run has this manifest but the deck references none of its icon paths.

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
          description: "Optional square {columns:n, rows:n} per generated sheet. Only 1x1, 2x2, or 3x3 are used; non-square values are normalized to a square grid.",
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
    if (icons.length > 25) return "Error: generate_icon_sheet supports at most 25 icons per call. Split larger sets into multiple calls.";

    const style = String(input.style || "premium standalone business line icons, rounded geometry, minimal, consistent stroke, no tile background").trim();
    const palette = normalizePalette(input.palette);
    const background = String(input.background || "pure white sheet background only, no border, no labels, no icon tiles").trim();
    const size = typeof input.size === "string" && input.size.trim() ? input.size.trim() : "4096x4096";
    const seed = typeof input.seed === "number" ? Math.floor(input.seed) : undefined;
    const outputSize = clampInt(input.output_size, 256, 2048, 768);
    const makeTransparent = input.make_transparent !== false;
    const cleanOutputDir = outputDir.replace(/\/+$/, "");
    const manifestPath = `${cleanOutputDir}/manifest.json`;
    const batches = chunkIcons(icons, 9);
    const batchManifests: IconManifest[] = [];

    for (const [batchIndex, batchIcons] of batches.entries()) {
      const grid = normalizeGrid(batches.length === 1 ? input.grid : undefined, batchIcons.length);
      const suffix = batches.length === 1 ? "" : `-${batchIndex + 1}`;
      const sheetPath = `${cleanOutputDir}/icon-sheet${suffix}.png`;
      const batchManifestPath = batches.length === 1 ? manifestPath : `${cleanOutputDir}/manifest-sheet${suffix}.json`;
      const prompt = buildIconSheetPrompt({ icons: batchIcons, grid, style, palette, background });

      const genResult = await imageGen.execute({
        prompt,
        output_path: sheetPath,
        size,
        seed: seed === undefined ? undefined : seed + batchIndex,
      });
      if (/^Error:/i.test(genResult)) return genResult;

      const cropResult = await cropIconSheet({
        sheetPath,
        outputDir,
        manifestPath: batchManifestPath,
        icons: batchIcons,
        grid,
        outputSize,
        makeTransparent,
        prompt,
        imageGenResult: genResult,
      });
      if (/^Error:/i.test(cropResult)) return cropResult;
      try {
        batchManifests.push(JSON.parse(cropResult) as IconManifest);
      } catch {
        return `Error: slicing returned invalid manifest JSON.\n${cropResult}`;
      }
    }

    const manifest = mergeBatchManifests(batchManifests, manifestPath, outputSize, makeTransparent);
    const manifestWriteError = await writeFinalManifest(manifest);
    if (manifestWriteError) return manifestWriteError;
    return JSON.stringify(manifest, null, 2);
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
  const needed = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(Math.max(1, count)))));
  const requestedSquare = explicitColumns && explicitRows && explicitColumns === explicitRows
    ? Math.max(1, Math.min(3, explicitColumns))
    : undefined;
  const size = Math.max(needed, requestedSquare || needed);
  return { columns: size, rows: size };
}

function chunkIcons(icons: IconRequest[], maxPerSheet: number): IconRequest[][] {
  const batches: IconRequest[][] = [];
  for (let index = 0; index < icons.length; index += maxPerSheet) {
    batches.push(icons.slice(index, index + maxPerSheet));
  }
  return batches;
}

function mergeBatchManifests(
  manifests: IconManifest[],
  manifestPath: string,
  outputSize: number,
  makeTransparent: boolean,
): IconManifest {
  const first = manifests[0];
  return {
    sheetPath: first?.sheetPath || "",
    manifestPath,
    grid: first?.grid || { columns: 1, rows: 1 },
    outputSize,
    makeTransparent,
    prompt: first?.prompt,
    imageGenResult: first?.imageGenResult,
    sheets: manifests.map((manifest) => ({
      sheetPath: manifest.sheetPath,
      grid: manifest.grid,
      prompt: manifest.prompt,
      imageGenResult: manifest.imageGenResult,
      icons: (manifest.icons || []).map((icon) => icon.name),
    })),
    icons: manifests.flatMap((manifest) => manifest.icons || []),
  };
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
    `Create a single square ${input.grid.columns} by ${input.grid.rows} icon sheet for a PowerPoint deck.`,
    `Style: ${input.style}.`,
    `Palette: ${describePalette(input.palette)}. Use only these colors plus transparent/white negative space. Do not render color names, codes, swatches, or palette samples.`,
    `Background: ${input.background}.`,
    "Critical text ban: absolutely no visible text of any kind anywhere in the image. No words, no letters, no numbers, no digits, no dates, no labels, no captions, no headings, no row or column names, no watermarks, no signatures, no UI text.",
    "Canvas and grid rules: the square grid must fill the entire square image from edge to edge, with no title band, no header band, no footer band, and no unused outer margin. Every grid cell must be the same square size and the grid lines/cell boundaries must align to a regular full-canvas layout.",
    "Icon shape rules: one centered standalone icon per square cell. Every icon artwork must have a square visual bounding box with equal width and height, not a wide horizontal symbol or tall vertical symbol. If a concept is naturally wide or tall, simplify or arrange it into a square-proportioned symbol. All icons must use the same square footprint, same visual weight, and consistent stroke width.",
    "Spacing rules: each icon should fill most of its square cell while leaving only modest even padding inside that cell. No cropping, no overlap between cells, no tiny icons floating in a mostly empty sheet.",
    "Do not place icons inside rounded-square app tiles, cards, boxes, circles, badges, frames, shadows, or button backgrounds. Each cell should contain only the symbolic icon on plain white/transparent negative space.",
    "Content rules: use simple symbolic vector-like icons only. Do not include realistic photos, UI mockups, diagrams with required labels, charts, maps with labels, clock/date numerals, currency amounts, code, math notation, or any other readable glyphs.",
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
out_size = int(cfg["outputSize"])
transparent = bool(cfg["makeTransparent"])
icons_out = []

def bg_from_corners(im):
    px = im.load()
    sample = max(1, round(min(im.width, im.height) * 0.015))
    step = max(1, sample // 6)
    pts = []
    corner_ranges = [
        (range(0, sample), range(0, sample)),
        (range(max(0, im.width - sample), im.width), range(0, sample)),
        (range(0, sample), range(max(0, im.height - sample), im.height)),
        (range(max(0, im.width - sample), im.width), range(max(0, im.height - sample), im.height)),
    ]
    for xs, ys in corner_ranges:
        for y in list(ys)[::step]:
            for x in list(xs)[::step]:
                pts.append(px[x, y])
    if not pts:
        pts = [px[0, 0]]
    vals = []
    for channel in range(3):
        channel_values = sorted(p[channel] for p in pts)
        vals.append(channel_values[len(channel_values) // 2])
    return tuple(vals)

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

def foreground_mask(im, threshold=26):
    bg = bg_from_corners(im)
    mask = Image.new("L", im.size, 0)
    src = im.load()
    dst = mask.load()
    for y in range(im.height):
        for x in range(im.width):
            r,g,b,a = src[x,y]
            if not is_background_pixel(r, g, b, a, bg, threshold):
                dst[x,y] = 255
    return mask

def component_boxes(mask):
    w, h = mask.size
    pix = mask.load()
    seen = bytearray(w * h)
    boxes = []
    for y in range(h):
        for x in range(w):
            idx = y * w + x
            if seen[idx] or pix[x, y] == 0:
                continue
            stack = [(x, y)]
            seen[idx] = 1
            min_x = max_x = x
            min_y = max_y = y
            area = 0
            while stack:
                cx, cy = stack.pop()
                area += 1
                min_x = min(min_x, cx); max_x = max(max_x, cx)
                min_y = min(min_y, cy); max_y = max(max_y, cy)
                for nx in (cx - 1, cx, cx + 1):
                    for ny in (cy - 1, cy, cy + 1):
                        if nx < 0 or ny < 0 or nx >= w or ny >= h:
                            continue
                        nidx = ny * w + nx
                        if seen[nidx] or pix[nx, ny] == 0:
                            continue
                        seen[nidx] = 1
                        stack.append((nx, ny))
            boxes.append((min_x, min_y, max_x + 1, max_y + 1, area))
    return boxes

def merge_boxes(boxes):
    if not boxes:
        return None
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )

def expand_box(box, pad_x, pad_y, width, height):
    l,t,r,b = box
    return (
        max(0, int(round(l - pad_x))),
        max(0, int(round(t - pad_y))),
        min(width, int(round(r + pad_x))),
        min(height, int(round(b + pad_y))),
    )

def fit_aspect_expand(box, target_aspect, width, height):
    l,t,r,b = [float(v) for v in box]
    box_w = max(1, r - l)
    box_h = max(1, b - t)
    cx = (l + r) / 2
    cy = (t + b) / 2
    if box_w / box_h > target_aspect:
        box_h = box_w / target_aspect
    else:
        box_w = box_h * target_aspect
    l = cx - box_w / 2
    r = cx + box_w / 2
    t = cy - box_h / 2
    b = cy + box_h / 2
    if l < 0:
        r -= l
        l = 0
    if r > width:
        l -= r - width
        r = width
    if t < 0:
        b -= t
        t = 0
    if b > height:
        t -= b - height
        b = height
    return (
        max(0, round(l)),
        max(0, round(t)),
        min(width, round(r)),
        min(height, round(b)),
    )

def detect_grid_bbox(im, cols, rows):
    max_dim = 768
    scale = min(1.0, max_dim / max(im.width, im.height))
    if scale < 1:
        small = im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.BILINEAR)
    else:
        small = im.copy()
    mask = foreground_mask(small, threshold=28)
    boxes = component_boxes(mask)
    sw, sh = small.size
    image_area = sw * sh
    min_side = min(sw, sh)
    layout_boxes = []
    for box in boxes:
        l,t,r,b,area = box
        bw = r - l
        bh = b - t
        large_span = bw >= min_side * 0.10 and bh >= min_side * 0.10
        large_area = area >= image_area * 0.0035
        tall_enough = bh >= min_side * 0.055
        caption_like = bw > bh * 2.8 and bh < min_side * 0.14 and t < sh * 0.24
        if tall_enough and not caption_like and (large_span or large_area):
            layout_boxes.append(box)
    if not layout_boxes:
        layout_boxes = [box for box in boxes if box[4] >= max(8, image_area * 0.0005)]
    merged = merge_boxes(layout_boxes)
    if not merged:
        return (0, 0, im.width, im.height)
    inv_scale = 1 / scale
    grid = tuple(v * inv_scale for v in merged)
    pad = max(im.width, im.height) * 0.012
    grid = expand_box(grid, pad, pad, im.width, im.height)
    grid = fit_aspect_expand(grid, cols / rows, im.width, im.height)
    grid_w = grid[2] - grid[0]
    grid_h = grid[3] - grid[1]
    if grid_w > im.width * 0.92 and grid_h > im.height * 0.92:
        return (0, 0, im.width, im.height)
    return grid

def overlap_area(box, rect):
    if rect is None:
        return None
    l,t,r,b = box[:4]
    fl,ft,fr,fb = rect
    return max(0, min(r, fr) - max(l, fl)) * max(0, min(b, fb) - max(t, ft))

def clip_box(box, rect):
    if rect is None:
        return box
    l,t,r,b = box
    fl,ft,fr,fb = rect
    return (max(l, fl), max(t, ft), min(r, fr), min(b, fb))

def is_frame_like(box, im_width, im_height, focus_rect=None):
    l,t,r,b,area = box
    bw = r - l
    bh = b - t
    if focus_rect is None:
        fl,ft,fr,fb = (0, 0, im_width, im_height)
    else:
        fl,ft,fr,fb = focus_rect
    focus_w = max(1, fr - fl)
    focus_h = max(1, fb - ft)
    slop = max(4, round(min(focus_w, focus_h) * 0.045))
    touches = [
        l <= fl + slop,
        r >= fr - slop,
        t <= ft + slop,
        b >= fb - slop,
    ]
    touch_count = sum(1 for value in touches if value)
    span_w = bw >= focus_w * 0.68
    span_h = bh >= focus_h * 0.68
    wraps_center = (
        l < fl + focus_w * 0.18 and
        r > fr - focus_w * 0.18 and
        t < ft + focus_h * 0.18 and
        b > fb - focus_h * 0.18
    )
    edge_band = touch_count >= 2 and (span_w or span_h)
    full_tile = span_w and span_h and touch_count >= 2
    return full_tile or (wraps_center and edge_band)

def icon_bbox(im, expected_center=None, focus_rect=None, drop_edge_frames=True):
    mask = foreground_mask(im)
    boxes = component_boxes(mask)
    if not boxes:
        return None
    cell_area = im.width * im.height
    # AI image models sometimes ignore "no labels" and add titles, captions,
    # or per-cell labels. Keep the primary visual components and ignore
    # probable text so the output icon is centered on the symbol instead of
    # being shrunk or sliced by stray text.
    min_area = max(10, int(cell_area * 0.00008))
    candidates = []
    frame_boxes = []
    for l,t,r,b,area in boxes:
        bw = r - l
        bh = b - t
        if area < min_area:
            continue
        if focus_rect is not None:
            overlap = overlap_area((l,t,r,b,area), focus_rect)
            if overlap is None or overlap == 0:
                continue
            cx = (l + r) / 2
            cy = (t + b) / 2
            fl,ft,fr,fb = focus_rect
            focus_w = max(1, fr - fl)
            focus_h = max(1, fb - ft)
            within_focus = fl <= cx <= fr and ft <= cy <= fb
            meaningful_overlap = overlap >= min(area * 0.22, focus_w * focus_h * 0.015)
            if not within_focus and not meaningful_overlap:
                continue
        if drop_edge_frames and is_frame_like((l,t,r,b,area), im.width, im.height, focus_rect):
            frame_boxes.append((l,t,r,b,area))
            continue
        top_band = b < im.height * 0.26
        bottom_band = t > im.height * 0.55
        shallow = bh < im.height * 0.20
        tiny = area < cell_area * 0.018
        wide_flat = shallow and bw > bh * 1.25
        text_like = wide_flat or ((top_band or bottom_band) and tiny and shallow)
        if text_like:
            continue
        candidates.append((l,t,r,b,area))
    if not candidates:
        fallback = []
        for box in boxes:
            if focus_rect is not None and not overlap_area(box, focus_rect):
                continue
            if box in frame_boxes:
                continue
            fallback.append(box)
        candidates = sorted(fallback or boxes, key=lambda box: box[4], reverse=True)[:6]
    if not candidates:
        return None

    def score(box):
        l,t,r,b,area = box
        focus_bonus = 1
        if focus_rect is not None:
            focus_bonus += ((overlap_area(box, focus_rect) or 0) / max(1, area)) * 1.8
        if expected_center is None:
            return area * focus_bonus
        cx = (l + r) / 2
        cy = (t + b) / 2
        ex, ey = expected_center
        dx = abs(cx - ex) / max(1, im.width)
        dy = abs(cy - ey) / max(1, im.height)
        return area * focus_bonus / (1 + (dx + dy) * 2.4)

    # Drop far-away tiny remnants after finding the main symbol center.
    largest = max(candidates, key=score)
    lc_x = (largest[0] + largest[2]) / 2
    lc_y = (largest[1] + largest[3]) / 2
    filtered = []
    for box in candidates:
        l,t,r,b,area = box
        cx = (l + r) / 2
        cy = (t + b) / 2
        far = abs(cx - lc_x) > im.width * 0.42 or abs(cy - lc_y) > im.height * 0.42
        tiny = area < largest[4] * 0.10
        if far and tiny:
            continue
        filtered.append(box)
    merged = merge_boxes(filtered or [largest])
    if merged and focus_rect is not None:
        gutter_x = max(4, round((focus_rect[2] - focus_rect[0]) * 0.08))
        gutter_y = max(4, round((focus_rect[3] - focus_rect[1]) * 0.08))
        guard = (
            max(0, focus_rect[0] - gutter_x),
            max(0, focus_rect[1] - gutter_y),
            min(im.width, focus_rect[2] + gutter_x),
            min(im.height, focus_rect[3] + gutter_y),
        )
        clipped = clip_box(merged, guard)
        if clipped[2] > clipped[0] and clipped[3] > clipped[1]:
            return clipped
    return merged

grid_left, grid_top, grid_right, grid_bottom = detect_grid_bbox(img, cols, rows)
cell_w = (grid_right - grid_left) / cols
cell_h = (grid_bottom - grid_top) / rows

for index, icon in enumerate(cfg["icons"]):
    col = index % cols
    row = index // cols
    left = grid_left + col * cell_w
    top = grid_top + row * cell_h
    right = grid_left + (col + 1) * cell_w
    bottom = grid_top + (row + 1) * cell_h
    expand_x = round(cell_w * 0.10)
    expand_y = round(cell_h * 0.10)
    search_left = max(0, round(left - expand_x))
    search_top = max(0, round(top - expand_y))
    search_right = min(w, round(right + expand_x))
    search_bottom = min(h, round(bottom + expand_y))
    search = img.crop((search_left, search_top, search_right, search_bottom))
    expected = ((left + right) / 2 - search_left, (top + bottom) / 2 - search_top)
    focus = (left - search_left, top - search_top, right - search_left, bottom - search_top)
    bbox = icon_bbox(search, expected, focus, drop_edge_frames=True)
    if bbox:
        pad = max(12, round(max(search.width, search.height) * 0.035))
        l,t,r,b = bbox
        l = max(0, l - pad); t = max(0, t - pad)
        r = min(search.width, r + pad); b = min(search.height, b + pad)
        guard_x = max(4, round((focus[2] - focus[0]) * 0.10))
        guard_y = max(4, round((focus[3] - focus[1]) * 0.10))
        l = max(l, round(focus[0] - guard_x)); t = max(t, round(focus[1] - guard_y))
        r = min(r, round(focus[2] + guard_x)); b = min(b, round(focus[3] + guard_y))
        cell = search.crop((l,t,r,b))
    else:
        cell = img.crop((round(left), round(top), round(right), round(bottom)))
        inset_x = max(0, round(cell.width * 0.055))
        inset_y = max(0, round(cell.height * 0.055))
        cell = cell.crop((inset_x, inset_y, cell.width - inset_x, cell.height - inset_y))
    if transparent:
        bbox = icon_bbox(cell, drop_edge_frames=False)
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

async function writeFinalManifest(manifest: IconManifest): Promise<string | null> {
  const script = `
import json
from pathlib import Path

manifest = json.loads(${JSON.stringify(JSON.stringify(manifest))})
manifest_path = Path(manifest["manifestPath"]).expanduser()
manifest_path.parent.mkdir(parents=True, exist_ok=True)
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print("ICON_MANIFEST_WRITTEN:" + str(manifest_path))
`;
  const result = await runPython.execute({ code: script, timeout: 30 });
  if (/Process exited with code|Python execution error|Package installation failed/i.test(result)) {
    return `Error: failed to write final icon manifest.\n${result}`;
  }
  return null;
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
