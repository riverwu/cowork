/**
 * Asset pipeline.
 *
 * One place to turn an image-shaped src (path / URL / data URL) into bytes
 * and assign it a stable place in the OOXML package. Used for both image
 * shapes and background images so a single image referenced in both ways
 * is embedded only once.
 *
 * Disk cache (~/.cache/slideml/) survives between builds — agents that
 * generate a deck once a minute don't re-download remote images.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { resolveImage, type ImageExt, type ResolvedImage } from "./emitter/image.js";

export interface AssetEntry {
  /** Allocated `ppt/media/{filename}` filename, e.g. `image1.png`. */
  filename: string;
  /** Resolved bytes + ext, ready to write into the package. */
  resolved: ResolvedImage;
}

/**
 * Collect assets across a deck render. The package emitter creates one
 * Assets instance per compile, calls `intern(src)` for every image source
 * encountered, and at the end iterates `entries` to write `ppt/media/` files.
 *
 * `intern` is idempotent for the same `src` — the second call returns the
 * already-allocated filename and reuses the bytes.
 */
export class Assets {
  private byKey = new Map<string, AssetEntry>();
  private nextIndex = 1;
  /** Working directory for resolving relative paths. Defaults to cwd. */
  readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? process.cwd();
  }

  /** Resolve a src and return its allocated package filename. */
  async intern(src: string): Promise<AssetEntry> {
    const key = this.normalize(src);
    const existing = this.byKey.get(key);
    if (existing) return existing;

    const resolved = await resolveSrc(key);
    const filename = `image${this.nextIndex++}.${resolved.ext}`;
    const entry: AssetEntry = { filename, resolved };
    this.byKey.set(key, entry);
    return entry;
  }

  /** Look up a previously-interned src without resolving. */
  get(src: string): AssetEntry | undefined {
    return this.byKey.get(this.normalize(src));
  }

  /** All assets that should be written under `ppt/media/`. */
  entries(): AssetEntry[] {
    return [...this.byKey.values()];
  }

  /** Unique file extensions in the package (drives Content_Types defaults). */
  extensions(): Set<ImageExt> {
    const exts = new Set<ImageExt>();
    for (const e of this.byKey.values()) exts.add(e.resolved.ext);
    return exts;
  }

  /**
   * Normalize a src into a stable cache key:
   *   - data: URLs and http(s) URLs → as-is
   *   - relative paths → resolved against baseDir
   *   - absolute paths → as-is
   */
  private normalize(src: string): string {
    if (src.startsWith("data:")) return src;
    if (/^https?:\/\//i.test(src)) return src;
    return isAbsolute(src) ? src : resolve(this.baseDir, src);
  }
}

// ---- HTTP disk cache ------------------------------------------------------

const HTTP_CACHE_DIR = join(homedir(), ".cache", "slideml", "http");

async function resolveSrc(src: string): Promise<ResolvedImage> {
  if (/^https?:\/\//i.test(src)) {
    const cached = await readHttpCache(src);
    if (cached) return cached;
    const fresh = await resolveImage(src);
    await writeHttpCache(src, fresh);
    return fresh;
  }
  // Local path or data URL — resolveImage handles both directly.
  return resolveImage(src);
}

async function readHttpCache(url: string): Promise<ResolvedImage | undefined> {
  const path = httpCachePath(url);
  if (!existsSync(path) || !existsSync(`${path}.meta`)) return undefined;
  try {
    const bytes = await readFile(path);
    const meta = JSON.parse(await readFile(`${path}.meta`, "utf8"));
    return {
      bytes: new Uint8Array(bytes),
      ext: meta.ext,
      mimeType: meta.mimeType,
      ...(meta.dimensions ? { dimensions: meta.dimensions } : {}),
    };
  } catch {
    return undefined;
  }
}

async function writeHttpCache(url: string, img: ResolvedImage): Promise<void> {
  const path = httpCachePath(url);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, img.bytes);
  await writeFile(`${path}.meta`, JSON.stringify({
    ext: img.ext, mimeType: img.mimeType,
    ...(img.dimensions ? { dimensions: img.dimensions } : {}),
  }));
}

function httpCachePath(url: string): string {
  // Hash the full URL — short, collision-free, filesystem-safe.
  const h = createHash("sha256").update(url).digest("hex").slice(0, 32);
  return join(HTTP_CACHE_DIR, h);
}
