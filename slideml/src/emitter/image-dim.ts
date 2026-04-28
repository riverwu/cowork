/**
 * Inline image-dimension probe — reads only the file's header bytes, no
 * full decode. Supports PNG, JPEG, GIF, WEBP, SVG. Returns undefined when
 * the format is unrecognised; callers fall back to "fill" (stretch) mode.
 *
 * Dimensions are needed by the OOXML emitter to compute `<a:srcRect>`
 * cropping for `fit: "cover" | "contain"` — without source dimensions
 * the image is stretched to fill the target rect (fit: "fill" behaviour).
 */

import type { ImageExt } from "./image.js";

export interface ImageDimensions {
  width: number;
  height: number;
}

export function probeImageDimensions(bytes: Uint8Array, ext: ImageExt): ImageDimensions | undefined {
  switch (ext) {
    case "png":  return probePng(bytes);
    case "jpg":  return probeJpeg(bytes);
    case "gif":  return probeGif(bytes);
    case "webp": return probeWebp(bytes);
    case "svg":  return probeSvg(bytes);
    default:     return undefined;
  }
}

// --- PNG ----------------------------------------------------------------
//
// Layout: 8-byte signature, then IHDR chunk starting at offset 8.
// IHDR has 4 bytes length, 4 bytes type ("IHDR"), then 13 bytes data:
//   width: uint32 BE at 16, height: uint32 BE at 20.
function probePng(b: Uint8Array): ImageDimensions | undefined {
  if (b.length < 24) return undefined;
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4E || b[3] !== 0x47) return undefined;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

// --- JPEG ---------------------------------------------------------------
//
// Walk segments looking for SOF0..SOF15 (excluding DHT=C4 / JPG=C8 / DAC=CC).
// Each segment: 0xFF marker, length (BE uint16), data. SOF segments contain
// height (BE uint16) at offset 5 and width at offset 7 (relative to segment data).
function probeJpeg(b: Uint8Array): ImageDimensions | undefined {
  if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return undefined;
  let i = 2;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (i < b.length - 9) {
    if (b[i] !== 0xFF) return undefined;
    let marker = b[i + 1]!;
    while (marker === 0xFF) { i++; marker = b[i + 1]!; }
    i += 2;
    // Standalone markers (no length / payload).
    if (marker === 0xD8 || marker === 0xD9) continue;
    if (marker >= 0xD0 && marker <= 0xD7) continue;
    if (i + 2 > b.length) return undefined;
    const segLen = view.getUint16(i, false);
    // SOF markers carry dimensions: 0xC0..0xCF except C4/C8/CC.
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      if (i + 7 > b.length) return undefined;
      return {
        height: view.getUint16(i + 3, false),
        width:  view.getUint16(i + 5, false),
      };
    }
    i += segLen;
  }
  return undefined;
}

// --- GIF ----------------------------------------------------------------
//
// "GIF87a" or "GIF89a" header, then logical screen descriptor at offset 6:
// width (LE uint16) at 6, height at 8.
function probeGif(b: Uint8Array): ImageDimensions | undefined {
  if (b.length < 10) return undefined;
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return undefined;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

// --- WEBP ---------------------------------------------------------------
//
// RIFF container: "RIFF????WEBP". Then a chunk; we support VP8 / VP8L / VP8X.
//   VP8  (lossy, simple):  width at offset 26 (LE uint16, masked 0x3FFF)
//   VP8L (lossless):       width-1 at offset 21 (14 bits LE)
//   VP8X (extended):       width-1 at offset 24 (LE uint24)
function probeWebp(b: Uint8Array): ImageDimensions | undefined {
  if (b.length < 30) return undefined;
  if (b[0] !== 0x52 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x46) return undefined;
  if (b[8] !== 0x57 || b[9] !== 0x45 || b[10] !== 0x42 || b[11] !== 0x50) return undefined;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // Chunk type at offset 12 (4 ascii chars).
  const ty = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (ty === "VP8 ") {
    return { width: view.getUint16(26, true) & 0x3FFF, height: view.getUint16(28, true) & 0x3FFF };
  }
  if (ty === "VP8L") {
    const lo = b[21]!, hi = b[22]!, hi2 = b[23]!, hi3 = b[24]!;
    const widthMinus1 = lo | ((hi & 0x3F) << 8);
    const heightMinus1 = ((hi >> 6) | (hi2 << 2) | ((hi3 & 0x0F) << 10));
    return { width: widthMinus1 + 1, height: heightMinus1 + 1 };
  }
  if (ty === "VP8X") {
    const w = (b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1;
    const h = (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1;
    return { width: w, height: h };
  }
  return undefined;
}

// --- SVG ----------------------------------------------------------------
//
// Parse `viewBox="0 0 W H"` first (most reliable), fall back to width / height
// attributes in user units.
function probeSvg(b: Uint8Array): ImageDimensions | undefined {
  // Decode the first ~4KB as utf-8; SVG headers are short.
  const text = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, Math.min(b.length, 4096)));
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i.exec(text);
  if (vb) return { width: Math.round(Number(vb[1])), height: Math.round(Number(vb[2])) };
  const w = /\bwidth\s*=\s*["']\s*([\d.]+)\s*(?:px)?\s*["']/i.exec(text);
  const h = /\bheight\s*=\s*["']\s*([\d.]+)\s*(?:px)?\s*["']/i.exec(text);
  if (w && h) return { width: Math.round(Number(w[1])), height: Math.round(Number(h[1])) };
  return undefined;
}
