export interface OoxmlTheme {
  colors: Record<string, string>;
  fonts: {
    majorLatin?: string | null;
    minorLatin?: string | null;
  };
}

export function parseOoxmlTheme(xml: string): OoxmlTheme {
  return {
    colors: parseColorScheme(xml),
    fonts: parseFontScheme(xml),
  };
}

export function resolveOoxmlColor(xml: string, theme?: OoxmlTheme | null): string | null {
  const colorNode = firstColorNode(xml);
  if (!colorNode) return null;

  const srgb = attrsFromTag(colorNode.openTag).val;
  const scheme = attrsFromTag(colorNode.openTag).val;
  const sys = attrsFromTag(colorNode.openTag).lastClr;
  const base = colorNode.tag === "a:schemeClr" && scheme
    ? theme?.colors[scheme] || null
    : colorNode.tag === "a:sysClr" && sys
      ? normalizeHex(sys)
      : srgb
        ? normalizeHex(srgb)
        : null;
  if (!base) return null;

  return colorToCss(applyColorTransforms(hexToRgb(base), colorNode.block), parseAlpha(colorNode.block));
}

function parseColorScheme(xml: string): Record<string, string> {
  const scheme = extractFirstBlock(xml, "a:clrScheme") || xml;
  const colors: Record<string, string> = {};
  const keys = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  for (const key of keys) {
    const block = extractFirstBlock(scheme, `a:${key}`);
    if (!block) continue;
    const color = attrFromFirstTag(block, "a:srgbClr", "val") || attrFromFirstTag(block, "a:sysClr", "lastClr");
    if (color) colors[key] = normalizeHex(color);
  }
  return colors;
}

function parseFontScheme(xml: string): OoxmlTheme["fonts"] {
  const majorFont = extractFirstBlock(xml, "a:majorFont") || "";
  const minorFont = extractFirstBlock(xml, "a:minorFont") || "";
  return {
    majorLatin: attrFromFirstTag(majorFont, "a:latin", "typeface"),
    minorLatin: attrFromFirstTag(minorFont, "a:latin", "typeface"),
  };
}

function extractFirstBlock(xml: string, tag: string): string | null {
  const escaped = tag.replace(":", "\\:");
  return xml.match(new RegExp(`<${escaped}\\b[\\s\\S]*?<\\/${escaped}>`, "m"))?.[0] || null;
}

function attrFromFirstTag(xml: string, tag: string, attr: string): string | null {
  const escaped = tag.replace(":", "\\:");
  const tagText = xml.match(new RegExp(`<${escaped}\\b[^>]*>`, "m"))?.[0];
  if (!tagText) return null;
  return tagText.match(new RegExp(`${attr}="([^"]*)"`))?.[1] || null;
}

function normalizeHex(value: string): string {
  return `#${value.replace(/^#/, "").toUpperCase()}`;
}

interface ColorNode {
  tag: "a:srgbClr" | "a:schemeClr" | "a:sysClr";
  openTag: string;
  block: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function firstColorNode(xml: string): ColorNode | null {
  const tags: ColorNode["tag"][] = ["a:srgbClr", "a:schemeClr", "a:sysClr"];
  const matches = tags
    .map((tag) => {
      const open = firstTag(xml, tag);
      if (!open) return null;
      return { tag, index: xml.indexOf(open), openTag: open, block: colorBlockAt(xml, tag, open) };
    })
    .filter((node): node is ColorNode & { index: number } => Boolean(node))
    .sort((a, b) => a.index - b.index);
  return matches[0] || null;
}

function firstTag(xml: string, tag: string): string | null {
  const escaped = tag.replace(":", "\\:");
  return xml.match(new RegExp(`<${escaped}\\b[^>]*>`, "m"))?.[0] || null;
}

function colorBlockAt(xml: string, tag: string, openTag: string): string {
  if (openTag.endsWith("/>")) return openTag;
  const start = xml.indexOf(openTag);
  const escaped = tag.replace(":", "\\:");
  const close = xml.slice(start).match(new RegExp(`<\\/${escaped}>`));
  return close ? xml.slice(start, start + (close.index || 0) + close[0].length) : openTag;
}

function attrsFromTag(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:.-]+)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function applyColorTransforms(rgb: Rgb, block: string): Rgb {
  let next = rgb;
  const shade = percentValue(block, "a:shade");
  const tint = percentValue(block, "a:tint");
  const lumMod = percentValue(block, "a:lumMod");
  const lumOff = percentValue(block, "a:lumOff");

  if (shade !== null) next = mixRgb(next, { r: 0, g: 0, b: 0 }, 1 - shade);
  if (tint !== null) next = mixRgb(next, { r: 255, g: 255, b: 255 }, 1 - tint);
  if (lumMod !== null || lumOff !== null) {
    const hsl = rgbToHsl(next);
    hsl.l = clamp01(hsl.l * (lumMod ?? 1) + (lumOff ?? 0));
    next = hslToRgb(hsl);
  }
  return next;
}

function percentValue(block: string, tag: string): number | null {
  const value = attrFromFirstTag(block, tag, "val");
  return value ? Number(value) / 100000 : null;
}

function parseAlpha(block: string): number | null {
  const alpha = percentValue(block, "a:alpha");
  return alpha === null ? null : clamp01(alpha);
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  return {
    r: clampChannel(from.r + (to.r - from.r) * amount),
    g: clampChannel(from.g + (to.g - from.g) * amount),
    b: clampChannel(from.b + (to.b - from.b) * amount),
  };
}

function hexToRgb(hex: string): Rgb {
  const normalized = hex.replace(/^#/, "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function colorToCss(rgb: Rgb, alpha: number | null): string {
  if (alpha !== null && alpha < 1) return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${roundAlpha(alpha)})`;
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function toHex(value: number): string {
  return clampChannel(value).toString(16).padStart(2, "0").toUpperCase();
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundAlpha(value: number): number {
  return Number(value.toFixed(3));
}

function rgbToHsl(rgb: Rgb): { h: number; s: number; l: number } {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === r) h = (g - b) / delta + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb(hsl: { h: number; s: number; l: number }): Rgb {
  if (hsl.s === 0) {
    const value = clampChannel(hsl.l * 255);
    return { r: value, g: value, b: value };
  }
  const q = hsl.l < 0.5 ? hsl.l * (1 + hsl.s) : hsl.l + hsl.s - hsl.l * hsl.s;
  const p = 2 * hsl.l - q;
  return {
    r: clampChannel(hueToRgb(p, q, hsl.h + 1 / 3) * 255),
    g: clampChannel(hueToRgb(p, q, hsl.h) * 255),
    b: clampChannel(hueToRgb(p, q, hsl.h - 1 / 3) * 255),
  };
}

function hueToRgb(p: number, q: number, t: number): number {
  let next = t;
  if (next < 0) next += 1;
  if (next > 1) next -= 1;
  if (next < 1 / 6) return p + (q - p) * 6 * next;
  if (next < 1 / 2) return q;
  if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
  return p;
}
