import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import * as jpeg from "jpeg-js";

export interface IconRequest {
  name: string;
  label: string;
  description: string;
}

export interface IconGridSpec {
  columns: number;
  rows: number;
}

export interface IconManifest {
  sheetPath: string;
  manifestPath: string;
  grid: IconGridSpec;
  outputSize: number;
  makeTransparent: boolean;
  icons: Array<IconRequest & {
    path: string;
    cell: { row: number; column: number };
    crop: { x: number; y: number; width: number; height: number };
  }>;
}

export interface SliceIconSheetOptions {
  sheetPath: string;
  outputDir: string;
  manifestPath?: string;
  icons: unknown;
  grid?: unknown;
  outputSize?: number;
  makeTransparent?: boolean;
}

interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ComponentBox extends Rect {
  area: number;
}

interface GridLine {
  position: number;
  start: number;
  end: number;
  coverage: number;
  thickness: number;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8]);
const DEFAULT_OUTPUT_SIZE = 768;

export async function sliceIconSheet(options: SliceIconSheetOptions): Promise<IconManifest> {
  const sheetPath = resolve(options.sheetPath);
  const outputDir = resolve(options.outputDir);
  const manifestPath = resolve(options.manifestPath || join(outputDir, "manifest.json"));
  const icons = normalizeIconRequests(options.icons);
  if (icons.length === 0) throw new Error("slice-icons requires at least one icon spec.");
  const grid = normalizeGridSpec(options.grid, icons.length);
  const outputSize = clampInt(options.outputSize, 256, 2048, DEFAULT_OUTPUT_SIZE);
  const makeTransparent = options.makeTransparent !== false;

  await mkdir(outputDir, { recursive: true });
  await mkdir(dirname(manifestPath), { recursive: true });

  const sheet = decodeImageRgba(await readFile(sheetPath));
  const gridRect = detectGridRect(sheet, grid);
  const cellWidth = (gridRect.right - gridRect.left) / grid.columns;
  const cellHeight = (gridRect.bottom - gridRect.top) / grid.rows;
  const maxIcons = Math.min(icons.length, grid.columns * grid.rows);
  const manifestIcons: IconManifest["icons"] = [];

  for (let index = 0; index < maxIcons; index += 1) {
    const icon = icons[index]!;
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    const cellRect = roundRect({
      left: gridRect.left + column * cellWidth,
      top: gridRect.top + row * cellHeight,
      right: gridRect.left + (column + 1) * cellWidth,
      bottom: gridRect.top + (row + 1) * cellHeight,
    }, sheet.width, sheet.height);
    const cropped = cropIconFromCell(sheet, cellRect, outputSize, makeTransparent);
    const iconPath = join(outputDir, `${icon.name}.png`);
    await writeFile(iconPath, encodePngRgba(cropped.image));
    manifestIcons.push({
      ...icon,
      path: iconPath,
      cell: { row, column },
      crop: {
        x: cropped.crop.left,
        y: cropped.crop.top,
        width: cropped.crop.right - cropped.crop.left,
        height: cropped.crop.bottom - cropped.crop.top,
      },
    });
  }

  const manifest: IconManifest = {
    sheetPath,
    manifestPath,
    grid,
    outputSize,
    makeTransparent,
    icons: manifestIcons,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function normalizeIconRequests(value: unknown): IconRequest[] {
  if (!Array.isArray(value)) throw new Error("icons must be an array of strings or {name,label,description} objects.");
  const seen = new Map<string, number>();
  return value.map((item, index) => {
    const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const rawName = typeof item === "string" ? item : firstString(record.name, record.id, record.key);
    const rawLabel = typeof item === "string" ? item : firstString(record.label, record.title, record.name, rawName);
    const rawDescription = typeof item === "string" ? item : firstString(record.description, record.prompt, record.body, rawLabel, rawName);
    let name = slugify(rawName) || slugify(rawLabel) || `icon_${index + 1}`;
    const count = seen.get(name) || 0;
    seen.set(name, count + 1);
    if (count > 0) name = `${name}_${count + 1}`;
    return {
      name,
      label: rawLabel.trim() || name,
      description: rawDescription.trim() || rawLabel.trim() || name,
    };
  });
}

export function normalizeGridSpec(value: unknown, count: number): IconGridSpec {
  if (typeof value === "string") {
    const match = /^(\d+)(?:x(\d+))?$/i.exec(value.trim());
    if (match) {
      const columns = clampInt(Number(match[1]), 1, 8, 1);
      const rows = clampInt(Number(match[2] || match[1]), 1, 8, columns);
      return { columns, rows };
    }
  }
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const explicitColumns = typeof record.columns === "number" ? Math.floor(record.columns) : undefined;
  const explicitRows = typeof record.rows === "number" ? Math.floor(record.rows) : undefined;
  if (explicitColumns && explicitRows && explicitColumns > 0 && explicitRows > 0) {
    return { columns: Math.min(8, explicitColumns), rows: Math.min(8, explicitRows) };
  }
  const size = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(Math.max(1, count)))));
  return { columns: size, rows: size };
}

function cropIconFromCell(sheet: RgbaImage, cellRect: Rect, outputSize: number, makeTransparent: boolean): { image: RgbaImage; crop: Rect } {
  const cell = cropImage(sheet, cellRect);
  const focus = insetRect({ left: 0, top: 0, right: cell.width, bottom: cell.height }, Math.max(2, Math.round(Math.min(cell.width, cell.height) * 0.035)));
  const bbox = iconContentBox(cell, {
    expectedCenter: { x: cell.width / 2, y: cell.height / 2 },
    focusRect: focus,
    dropEdgeFrames: true,
  });
  const rawCrop = bbox
    ? constrainRect(expandRect(bbox, Math.max(8, Math.round(Math.max(cell.width, cell.height) * 0.035))), cell.width, cell.height)
    : insetRect({ left: 0, top: 0, right: cell.width, bottom: cell.height }, Math.max(2, Math.round(Math.min(cell.width, cell.height) * 0.08)));
  const guard = expandRect(focus, Math.max(4, Math.round(Math.min(cell.width, cell.height) * 0.08)));
  const guardedCrop = intersectRect(rawCrop, constrainRect(guard, cell.width, cell.height)) || rawCrop;
  let icon = cropImage(cell, guardedCrop);

  const tight = iconContentBox(icon, { dropEdgeFrames: false });
  if (tight) {
    icon = cropImage(icon, constrainRect(expandRect(tight, Math.max(6, Math.round(Math.max(icon.width, icon.height) * 0.035))), icon.width, icon.height));
  }
  if (makeTransparent) icon = removeBackground(icon);

  const maxArtwork = Math.round(outputSize * 0.82);
  const scale = Math.min(1, maxArtwork / Math.max(1, icon.width), maxArtwork / Math.max(1, icon.height));
  const resized = resizeImage(icon, Math.max(1, Math.round(icon.width * scale)), Math.max(1, Math.round(icon.height * scale)));
  const canvas = blankImage(outputSize, outputSize, makeTransparent ? [255, 255, 255, 0] : [255, 255, 255, 255]);
  pasteImage(canvas, resized, Math.floor((outputSize - resized.width) / 2), Math.floor((outputSize - resized.height) / 2), !makeTransparent);

  return {
    image: canvas,
    crop: {
      left: cellRect.left + guardedCrop.left,
      top: cellRect.top + guardedCrop.top,
      right: cellRect.left + guardedCrop.right,
      bottom: cellRect.top + guardedCrop.bottom,
    },
  };
}

function detectGridRect(image: RgbaImage, grid: IconGridSpec): Rect {
  const lineRect = detectLineGridRect(image, grid);
  if (lineRect) return lineRect;
  const content = contentBox(image);
  if (!content) return { left: 0, top: 0, right: image.width, bottom: image.height };
  const fullArea = image.width * image.height;
  const contentArea = (content.right - content.left) * (content.bottom - content.top);
  if (contentArea > fullArea * 0.82) return { left: 0, top: 0, right: image.width, bottom: image.height };
  const padded = constrainRect(expandRect(content, Math.max(image.width, image.height) * 0.018), image.width, image.height);
  return fitAspectRect(padded, grid.columns / grid.rows, image.width, image.height);
}

function detectLineGridRect(image: RgbaImage, grid: IconGridSpec): Rect | null {
  const vertical = detectLineClusters(image, "vertical");
  const horizontal = detectLineClusters(image, "horizontal");
  const v = bestLineSequence(vertical, grid.columns + 1);
  const h = bestLineSequence(horizontal, grid.rows + 1);
  if (!v || !h) return null;
  const left = Math.max(0, Math.round(v[0]!.start));
  const right = Math.min(image.width, Math.round(v[v.length - 1]!.end));
  const top = Math.max(0, Math.round(h[0]!.start));
  const bottom = Math.min(image.height, Math.round(h[h.length - 1]!.end));
  if (right - left < image.width * 0.25 || bottom - top < image.height * 0.25) return null;
  return fitAspectRect({ left, top, right, bottom }, grid.columns / grid.rows, image.width, image.height);
}

function detectLineClusters(image: RgbaImage, axis: "vertical" | "horizontal"): GridLine[] {
  const length = axis === "vertical" ? image.width : image.height;
  const span = axis === "vertical" ? image.height : image.width;
  const threshold = Math.max(8, span * 0.42);
  const counts: number[] = [];
  for (let p = 0; p < length; p += 1) {
    let count = 0;
    let start = -1;
    let end = -1;
    for (let q = 0; q < span; q += 1) {
      const x = axis === "vertical" ? p : q;
      const y = axis === "vertical" ? q : p;
      const idx = (y * image.width + x) * 4;
      const r = image.data[idx]!;
      const g = image.data[idx + 1]!;
      const b = image.data[idx + 2]!;
      const a = image.data[idx + 3]!;
      if (a > 16 && isLikelyRulePixel(r, g, b)) {
        count += 1;
        if (start < 0) start = q;
        end = q;
      }
    }
    counts.push(count >= threshold ? count : 0);
  }
  const clusters: GridLine[] = [];
  let start = -1;
  let weighted = 0;
  let weight = 0;
  let maxCoverage = 0;
  for (let p = 0; p <= length; p += 1) {
    const count = p < length ? counts[p]! : 0;
    if (count > 0) {
      if (start < 0) start = p;
      weighted += p * count;
      weight += count;
      maxCoverage = Math.max(maxCoverage, count);
    } else if (start >= 0) {
      const end = p;
      const thickness = end - start;
      const position = weight > 0 ? weighted / weight : (start + end) / 2;
      if (thickness <= Math.max(12, length * 0.035)) {
        clusters.push({ position, start, end, coverage: maxCoverage / span, thickness });
      }
      start = -1;
      weighted = 0;
      weight = 0;
      maxCoverage = 0;
    }
  }
  return clusters;
}

function isLikelyRulePixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max < 92 || (max - min < 18 && max < 150);
}

function bestLineSequence(lines: GridLine[], needed: number): GridLine[] | null {
  if (lines.length < needed) return null;
  let best: { score: number; window: GridLine[] } | null = null;
  const sorted = lines.slice().sort((a, b) => a.position - b.position);
  for (let start = 0; start <= sorted.length - needed; start += 1) {
    const window = sorted.slice(start, start + needed);
    const gaps: number[] = [];
    for (let i = 1; i < window.length; i += 1) gaps.push(window[i]!.position - window[i - 1]!.position);
    const avg = gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(1, gaps.length);
    if (avg <= 1) continue;
    const variance = gaps.reduce((sum, gap) => sum + Math.abs(gap - avg) / avg, 0) / Math.max(1, gaps.length);
    const coverage = window.reduce((sum, line) => sum + line.coverage, 0) / window.length;
    const score = variance - coverage * 0.08;
    if (!best || score < best.score) best = { score, window };
  }
  return best && best.score < 0.42 ? best.window : null;
}

function contentBox(image: RgbaImage): Rect | null {
  const bg = estimateBackground(image);
  const mask = foregroundMask(image, bg, 30);
  const boxes = componentBoxes(mask, image.width, image.height);
  const area = image.width * image.height;
  const minArea = Math.max(12, area * 0.0004);
  const keep = boxes.filter((box) => {
    const w = box.right - box.left;
    const h = box.bottom - box.top;
    const captionLike = w > h * 2.8 && h < image.height * 0.12 && box.top < image.height * 0.24;
    return box.area >= minArea && !captionLike;
  });
  return mergeRects(keep);
}

function iconContentBox(image: RgbaImage, options: { expectedCenter?: { x: number; y: number }; focusRect?: Rect; dropEdgeFrames?: boolean } = {}): Rect | null {
  const bg = estimateBackground(image, options.focusRect ? insetRect(options.focusRect, Math.min(options.focusRect.right - options.focusRect.left, options.focusRect.bottom - options.focusRect.top) * 0.08) : undefined);
  const mask = foregroundMask(image, bg, 30);
  const boxes = componentBoxes(mask, image.width, image.height);
  if (!boxes.length) return null;
  const imageArea = image.width * image.height;
  const minArea = Math.max(8, imageArea * 0.00008);
  const candidates: ComponentBox[] = [];
  const frameBoxes = new Set<ComponentBox>();

  for (const box of boxes) {
    if (box.area < minArea) continue;
    if (options.focusRect && !hasMeaningfulOverlap(box, options.focusRect)) continue;
    if (options.dropEdgeFrames !== false && isFrameLike(box, image.width, image.height, options.focusRect)) {
      frameBoxes.add(box);
      continue;
    }
    if (isTextLike(box, image.width, image.height)) continue;
    candidates.push(box);
  }

  const fallback = candidates.length ? candidates : boxes.filter((box) => !frameBoxes.has(box) && (!options.focusRect || hasOverlap(box, options.focusRect)));
  if (!fallback.length) return null;
  const largest = fallback.slice().sort((a, b) => scoreComponent(b, image, options) - scoreComponent(a, image, options))[0]!;
  const cx = (largest.left + largest.right) / 2;
  const cy = (largest.top + largest.bottom) / 2;
  const filtered = fallback.filter((box) => {
    const bx = (box.left + box.right) / 2;
    const by = (box.top + box.bottom) / 2;
    const far = Math.abs(bx - cx) > image.width * 0.42 || Math.abs(by - cy) > image.height * 0.42;
    const tiny = box.area < largest.area * 0.10;
    return !(far && tiny);
  });
  const merged = mergeRects(filtered.length ? filtered : [largest]);
  if (!merged) return null;
  if (!options.focusRect) return merged;
  const guard = constrainRect(expandRect(options.focusRect, Math.max(4, Math.round(Math.min(image.width, image.height) * 0.08))), image.width, image.height);
  return intersectRect(merged, guard) || merged;
}

function hasMeaningfulOverlap(box: Rect, focus: Rect): boolean {
  const overlap = overlapArea(box, focus);
  if (overlap <= 0) return false;
  const area = Math.max(1, (box.right - box.left) * (box.bottom - box.top));
  const focusArea = Math.max(1, (focus.right - focus.left) * (focus.bottom - focus.top));
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  return (cx >= focus.left && cx <= focus.right && cy >= focus.top && cy <= focus.bottom)
    || overlap >= Math.min(area * 0.22, focusArea * 0.015);
}

function hasOverlap(box: Rect, focus: Rect): boolean {
  return overlapArea(box, focus) > 0;
}

function overlapArea(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

function isFrameLike(box: Rect, width: number, height: number, focusRect?: Rect): boolean {
  const focus = focusRect || { left: 0, top: 0, right: width, bottom: height };
  const focusW = Math.max(1, focus.right - focus.left);
  const focusH = Math.max(1, focus.bottom - focus.top);
  const boxW = box.right - box.left;
  const boxH = box.bottom - box.top;
  const slop = Math.max(3, Math.round(Math.min(focusW, focusH) * 0.045));
  const touchesLeft = box.left <= focus.left + slop;
  const touchesRight = box.right >= focus.right - slop;
  const touchesTop = box.top <= focus.top + slop;
  const touchesBottom = box.bottom >= focus.bottom - slop;
  const touchCount = [touchesLeft, touchesRight, touchesTop, touchesBottom].filter(Boolean).length;
  const spanW = boxW >= focusW * 0.68;
  const spanH = boxH >= focusH * 0.68;
  const thinVerticalRule = boxW <= focusW * 0.08 && spanH && (touchesTop || touchesBottom || touchesLeft || touchesRight);
  const thinHorizontalRule = boxH <= focusH * 0.08 && spanW && (touchesTop || touchesBottom || touchesLeft || touchesRight);
  const wrapsCenter = box.left < focus.left + focusW * 0.18
    && box.right > focus.right - focusW * 0.18
    && box.top < focus.top + focusH * 0.18
    && box.bottom > focus.bottom - focusH * 0.18;
  return thinVerticalRule || thinHorizontalRule || (touchCount >= 2 && (spanW || spanH)) || (wrapsCenter && touchCount >= 2);
}

function isTextLike(box: Rect, width: number, height: number): boolean {
  const boxW = box.right - box.left;
  const boxH = box.bottom - box.top;
  const topBand = box.bottom < height * 0.26;
  const bottomBand = box.top > height * 0.55;
  const shallow = boxH < height * 0.20;
  const wideFlat = shallow && boxW > boxH * 1.25;
  const tiny = boxW * boxH < width * height * 0.04;
  return wideFlat || ((topBand || bottomBand) && tiny && shallow);
}

function scoreComponent(box: ComponentBox, image: RgbaImage, options: { expectedCenter?: { x: number; y: number }; focusRect?: Rect }): number {
  let focusBonus = 1;
  if (options.focusRect) focusBonus += overlapArea(box, options.focusRect) / Math.max(1, box.area) * 1.8;
  if (!options.expectedCenter) return box.area * focusBonus;
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const dx = Math.abs(cx - options.expectedCenter.x) / Math.max(1, image.width);
  const dy = Math.abs(cy - options.expectedCenter.y) / Math.max(1, image.height);
  return box.area * focusBonus / (1 + (dx + dy) * 2.4);
}

function foregroundMask(image: RgbaImage, bg: [number, number, number], threshold: number): Uint8Array {
  const mask = new Uint8Array(image.width * image.height);
  for (let i = 0, p = 0; i < image.data.length; i += 4, p += 1) {
    const r = image.data[i]!;
    const g = image.data[i + 1]!;
    const b = image.data[i + 2]!;
    const a = image.data[i + 3]!;
    if (!isBackgroundPixel(r, g, b, a, bg, threshold)) mask[p] = 1;
  }
  return mask;
}

function isBackgroundPixel(r: number, g: number, b: number, a: number, bg: [number, number, number], threshold: number): boolean {
  if (a <= 8) return true;
  const diff = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
  if (diff <= threshold * 3) return true;
  const bgNearWhite = bg[0] >= 210 && bg[1] >= 210 && bg[2] >= 210;
  return bgNearWhite && r >= 225 && g >= 225 && b >= 225 && Math.max(r, g, b) - Math.min(r, g, b) <= 42;
}

function estimateBackground(image: RgbaImage, rect?: Rect): [number, number, number] {
  const area = rect ? constrainRect(rect, image.width, image.height) : { left: 0, top: 0, right: image.width, bottom: image.height };
  const w = Math.max(1, area.right - area.left);
  const h = Math.max(1, area.bottom - area.top);
  const patch = Math.max(2, Math.round(Math.min(w, h) * 0.055));
  const inset = Math.max(1, Math.round(Math.min(w, h) * 0.035));
  const samples: Array<[number, number, number]> = [];
  const patches: Rect[] = [
    { left: area.left + inset, top: area.top + inset, right: area.left + inset + patch, bottom: area.top + inset + patch },
    { left: area.right - inset - patch, top: area.top + inset, right: area.right - inset, bottom: area.top + inset + patch },
    { left: area.left + inset, top: area.bottom - inset - patch, right: area.left + inset + patch, bottom: area.bottom - inset },
    { left: area.right - inset - patch, top: area.bottom - inset - patch, right: area.right - inset, bottom: area.bottom - inset },
  ];
  for (const patchRect of patches) {
    const clipped = constrainRect(patchRect, image.width, image.height);
    const step = Math.max(1, Math.round(Math.min(clipped.right - clipped.left, clipped.bottom - clipped.top) / 8));
    for (let y = clipped.top; y < clipped.bottom; y += step) {
      for (let x = clipped.left; x < clipped.right; x += step) {
        const idx = (y * image.width + x) * 4;
        const a = image.data[idx + 3]!;
        if (a > 8) samples.push([image.data[idx]!, image.data[idx + 1]!, image.data[idx + 2]!]);
      }
    }
  }
  if (!samples.length) return [255, 255, 255];
  const buckets = new Map<string, { count: number; rgb: [number, number, number] }>();
  for (const rgb of samples) {
    const key = rgb.map((value) => Math.round(value / 16)).join(",");
    const prev = buckets.get(key);
    if (prev) prev.count += 1;
    else buckets.set(key, { count: 1, rgb });
  }
  return Array.from(buckets.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const al = a.rgb[0] + a.rgb[1] + a.rgb[2];
    const bl = b.rgb[0] + b.rgb[1] + b.rgb[2];
    return bl - al;
  })[0]!.rgb;
}

function componentBoxes(mask: Uint8Array, width: number, height: number): ComponentBox[] {
  const seen = new Uint8Array(mask.length);
  const boxes: ComponentBox[] = [];
  for (let idx = 0; idx < mask.length; idx += 1) {
    if (seen[idx] || mask[idx] === 0) continue;
    const stack = [idx];
    seen[idx] = 1;
    let minX = idx % width;
    let maxX = minX;
    let minY = Math.floor(idx / width);
    let maxY = minY;
    let area = 0;
    while (stack.length) {
      const current = stack.pop()!;
      area += 1;
      const y = Math.floor(current / width);
      const x = current - y * width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let ny = y - 1; ny <= y + 1; ny += 1) {
        if (ny < 0 || ny >= height) continue;
        for (let nx = x - 1; nx <= x + 1; nx += 1) {
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (seen[next] || mask[next] === 0) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    boxes.push({ left: minX, top: minY, right: maxX + 1, bottom: maxY + 1, area });
  }
  return boxes;
}

function removeBackground(image: RgbaImage): RgbaImage {
  const bg = estimateBackground(image);
  const data = new Uint8Array(image.data);
  for (let i = 0; i < data.length; i += 4) {
    if (isBackgroundPixel(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!, bg, 30)) data[i + 3] = 0;
  }
  return { width: image.width, height: image.height, data };
}

function cropImage(image: RgbaImage, rect: Rect): RgbaImage {
  const clipped = constrainRect(rect, image.width, image.height);
  const width = Math.max(1, clipped.right - clipped.left);
  const height = Math.max(1, clipped.bottom - clipped.top);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const srcStart = ((clipped.top + y) * image.width + clipped.left) * 4;
    const dstStart = y * width * 4;
    data.set(image.data.subarray(srcStart, srcStart + width * 4), dstStart);
  }
  return { width, height, data };
}

function resizeImage(image: RgbaImage, width: number, height: number): RgbaImage {
  if (image.width === width && image.height === height) return { width, height, data: new Uint8Array(image.data) };
  const data = new Uint8Array(width * height * 4);
  const scaleX = image.width / width;
  const scaleY = image.height / height;
  for (let y = 0; y < height; y += 1) {
    const srcY = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.floor(srcY));
    const y1 = Math.min(image.height - 1, y0 + 1);
    const fy = Math.max(0, srcY - y0);
    for (let x = 0; x < width; x += 1) {
      const srcX = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.floor(srcX));
      const x1 = Math.min(image.width - 1, x0 + 1);
      const fx = Math.max(0, srcX - x0);
      const dst = (y * width + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        const p00 = image.data[(y0 * image.width + x0) * 4 + c]!;
        const p10 = image.data[(y0 * image.width + x1) * 4 + c]!;
        const p01 = image.data[(y1 * image.width + x0) * 4 + c]!;
        const p11 = image.data[(y1 * image.width + x1) * 4 + c]!;
        data[dst + c] = Math.round((p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy);
      }
    }
  }
  return { width, height, data };
}

function blankImage(width: number, height: number, rgba: [number, number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }
  return { width, height, data };
}

function pasteImage(target: RgbaImage, source: RgbaImage, left: number, top: number, compositeOnWhite: boolean): void {
  for (let y = 0; y < source.height; y += 1) {
    const ty = top + y;
    if (ty < 0 || ty >= target.height) continue;
    for (let x = 0; x < source.width; x += 1) {
      const tx = left + x;
      if (tx < 0 || tx >= target.width) continue;
      const src = (y * source.width + x) * 4;
      const dst = (ty * target.width + tx) * 4;
      const a = source.data[src + 3]! / 255;
      if (compositeOnWhite) {
        target.data[dst] = Math.round(source.data[src]! * a + 255 * (1 - a));
        target.data[dst + 1] = Math.round(source.data[src + 1]! * a + 255 * (1 - a));
        target.data[dst + 2] = Math.round(source.data[src + 2]! * a + 255 * (1 - a));
        target.data[dst + 3] = 255;
      } else {
        target.data[dst] = source.data[src]!;
        target.data[dst + 1] = source.data[src + 1]!;
        target.data[dst + 2] = source.data[src + 2]!;
        target.data[dst + 3] = source.data[src + 3]!;
      }
    }
  }
}

function decodeImageRgba(buffer: Buffer): RgbaImage {
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return decodePngRgba(buffer);
  if (buffer.subarray(0, 2).equals(JPEG_SIGNATURE)) return decodeJpegRgba(buffer);
  throw new Error("Icon sheets must be PNG or JPEG/JFIF images.");
}

function decodeJpegRgba(buffer: Buffer): RgbaImage {
  const decoded = jpeg.decode(buffer, {
    useTArray: true,
    maxResolutionInMP: 80,
    maxMemoryUsageInMB: 768,
  });
  return {
    width: decoded.width,
    height: decoded.height,
    data: decoded.data instanceof Uint8Array ? new Uint8Array(decoded.data) : Uint8Array.from(decoded.data),
  };
}

function decodePngRgba(buffer: Buffer): RgbaImage {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("Only PNG icon sheets are supported.");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  const idat: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      transparency = Buffer.from(data);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
  }
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}; use an 8-bit PNG sheet.`);
  const channels = pngChannels(colorType);
  const rowBytes = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  const raw = new Uint8Array(width * height * channels);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[src++]!;
    const rowStart = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const value = inflated[src++]!;
      const left = x >= channels ? raw[rowStart + x - channels]! : 0;
      const up = y > 0 ? raw[rowStart + x - rowBytes]! : 0;
      const upLeft = y > 0 && x >= channels ? raw[rowStart + x - rowBytes - channels]! : 0;
      raw[rowStart + x] = unfilterByte(filter, value, left, up, upLeft);
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    const out = p * 4;
    const input = p * channels;
    if (colorType === 6) {
      rgba[out] = raw[input]!;
      rgba[out + 1] = raw[input + 1]!;
      rgba[out + 2] = raw[input + 2]!;
      rgba[out + 3] = raw[input + 3]!;
    } else if (colorType === 2) {
      rgba[out] = raw[input]!;
      rgba[out + 1] = raw[input + 1]!;
      rgba[out + 2] = raw[input + 2]!;
      rgba[out + 3] = 255;
    } else if (colorType === 0) {
      rgba[out] = raw[input]!;
      rgba[out + 1] = raw[input]!;
      rgba[out + 2] = raw[input]!;
      rgba[out + 3] = 255;
    } else if (colorType === 4) {
      rgba[out] = raw[input]!;
      rgba[out + 1] = raw[input]!;
      rgba[out + 2] = raw[input]!;
      rgba[out + 3] = raw[input + 1]!;
    } else if (colorType === 3) {
      if (!palette) throw new Error("Indexed PNG is missing PLTE chunk.");
      const idx = raw[input]!;
      rgba[out] = palette[idx * 3] ?? 0;
      rgba[out + 1] = palette[idx * 3 + 1] ?? 0;
      rgba[out + 2] = palette[idx * 3 + 2] ?? 0;
      rgba[out + 3] = transparency?.[idx] ?? 255;
    }
  }
  return { width, height, data: rgba };
}

function encodePngRgba(image: RgbaImage): Buffer {
  const raw = Buffer.alloc((image.width * 4 + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const rowStart = y * (image.width * 4 + 1);
    raw[rowStart] = 0;
    raw.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), rowStart + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export const __iconSheetTest = {
  decodeImageRgba,
  decodeJpegRgba,
  decodePngRgba,
  encodePngRgba,
};

function pngChannels(colorType: number): number {
  if (colorType === 0 || colorType === 3) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  throw new Error(`Unsupported PNG color type ${colorType}; use RGB or RGBA PNG.`);
}

function unfilterByte(filter: number, value: number, left: number, up: number, upLeft: number): number {
  if (filter === 0) return value;
  if (filter === 1) return (value + left) & 0xff;
  if (filter === 2) return (value + up) & 0xff;
  if (filter === 3) return (value + Math.floor((left + up) / 2)) & 0xff;
  if (filter === 4) return (value + paeth(left, up, upLeft)) & 0xff;
  throw new Error(`Unsupported PNG filter type ${filter}.`);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

let crcTable: number[] | undefined;
function crc32(data: Buffer): number {
  const table = crcTable ??= makeCrcTable();
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable(): number[] {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function roundRect(rect: Rect, width: number, height: number): Rect {
  return constrainRect({
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
  }, width, height);
}

function insetRect(rect: Rect, inset: number): Rect {
  const safe = Math.max(0, Math.round(inset));
  return {
    left: Math.min(rect.right - 1, rect.left + safe),
    top: Math.min(rect.bottom - 1, rect.top + safe),
    right: Math.max(rect.left + 1, rect.right - safe),
    bottom: Math.max(rect.top + 1, rect.bottom - safe),
  };
}

function expandRect(rect: Rect, pad: number): Rect {
  return {
    left: rect.left - pad,
    top: rect.top - pad,
    right: rect.right + pad,
    bottom: rect.bottom + pad,
  };
}

function constrainRect(rect: Rect, width: number, height: number): Rect {
  const left = Math.max(0, Math.min(width - 1, Math.round(rect.left)));
  const top = Math.max(0, Math.min(height - 1, Math.round(rect.top)));
  const right = Math.max(left + 1, Math.min(width, Math.round(rect.right)));
  const bottom = Math.max(top + 1, Math.min(height, Math.round(rect.bottom)));
  return { left, top, right, bottom };
}

function intersectRect(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

function mergeRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
  };
}

function fitAspectRect(rect: Rect, targetAspect: number, width: number, height: number): Rect {
  let boxW = Math.max(1, rect.right - rect.left);
  let boxH = Math.max(1, rect.bottom - rect.top);
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  if (boxW / boxH > targetAspect) boxH = boxW / targetAspect;
  else boxW = boxH * targetAspect;
  return constrainRect({ left: cx - boxW / 2, top: cy - boxH / 2, right: cx + boxW / 2, bottom: cy + boxH / 2 }, width, height);
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
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
