/**
 * Resolve `ImageShape.src` to bytes + a file extension.
 *
 * Sources supported:
 *   - Local file path (absolute or relative to cwd)
 *   - `data:image/<ext>;base64,...` URL
 *   - HTTP/HTTPS URL (downloaded via Node fetch)
 *
 * The emitter uses the resolved extension to register the right
 * `[Content_Types].xml` override and place the file under `ppt/media/`.
 */

import { readFile } from "node:fs/promises";

export type ImageExt = "png" | "jpg" | "gif" | "svg" | "webp";

export interface ResolvedImage {
  bytes: Uint8Array;
  ext: ImageExt;
  mimeType: string;
}

const EXT_TO_MIME: Record<ImageExt, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

const MIME_TO_EXT: Record<string, ImageExt> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

const EXT_PATTERN = /\.(png|jpe?g|gif|svg|webp)$/i;

/** Resolve any supported `src` to bytes + ext. */
export async function resolveImage(src: string): Promise<ResolvedImage> {
  // data: URL
  if (src.startsWith("data:")) {
    const m = /^data:([^;,]+)(?:;base64)?,(.*)$/s.exec(src);
    if (!m) throw new Error(`Invalid data URL`);
    const [, mime, body] = m;
    const ext = MIME_TO_EXT[mime!.toLowerCase()];
    if (!ext) throw new Error(`Unsupported image mime in data URL: ${mime}`);
    const bytes = src.includes(";base64,")
      ? Uint8Array.from(Buffer.from(body!, "base64"))
      : new TextEncoder().encode(decodeURIComponent(body!));
    return { bytes, ext, mimeType: EXT_TO_MIME[ext] };
  }

  // HTTP(S) URL
  if (/^https?:\/\//i.test(src)) {
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Failed to fetch image ${src}: HTTP ${response.status}`);
    }
    const contentType = (response.headers.get("content-type") || "").split(";")[0]!.trim().toLowerCase();
    const ext = MIME_TO_EXT[contentType] ?? extFromUrlPath(src);
    if (!ext) {
      throw new Error(`Cannot determine image extension for URL ${src} (content-type: ${contentType})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return { bytes: new Uint8Array(arrayBuffer), ext, mimeType: EXT_TO_MIME[ext] };
  }

  // Local file path
  const ext = extFromUrlPath(src);
  if (!ext) {
    throw new Error(`Cannot determine image extension for path ${src}`);
  }
  const bytes = await readFile(src);
  return { bytes: new Uint8Array(bytes), ext, mimeType: EXT_TO_MIME[ext] };
}

function extFromUrlPath(s: string): ImageExt | undefined {
  const m = EXT_PATTERN.exec(s.split("?")[0]!.split("#")[0]!);
  if (!m) return undefined;
  const ext = m[1]!.toLowerCase();
  if (ext === "jpeg") return "jpg";
  return ext as ImageExt;
}
