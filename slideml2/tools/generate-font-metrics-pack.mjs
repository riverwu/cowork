#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = resolve(repoRoot, "src/font-metrics-pack.ts");
const cacheDir = resolve(repoRoot, ".font-cache");

const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
const punctuation = "–—‘’“”…•·×÷±≈≤≥≠∞∑√παβγδθλμσφΩ→←↑↓↔✓✔✕✖★☆●○◆◇■□▲▼";
const cjkSample = "的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处理世什香格里拉雪山草甸湖泊研究商业科研";
const metricChars = uniqueChars(ascii + punctuation + cjkSample);
const kerningPairs = [
  "AV", "AW", "AY", "FA", "LT", "LV", "LY", "PA", "Ta", "Te", "To", "Tr", "Ts", "Tu", "Ty",
  "VA", "Vo", "Wa", "We", "Wo", "Ya", "Ye", "Yo", "ff", "fi", "fl", "ry", "st",
];

const downloads = {
  "Carlito-Regular.ttf": "https://raw.githubusercontent.com/googlefonts/carlito/main/fonts/ttf/Carlito-Regular.ttf",
  "Carlito-Bold.ttf": "https://raw.githubusercontent.com/googlefonts/carlito/main/fonts/ttf/Carlito-Bold.ttf",
  "NotoSansCJKsc-Regular.otf": "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf",
  "NotoSansCJKsc-Bold.otf": "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf",
};

const families = [
  {
    family: "Arial",
    aliases: ["Arial", "Helvetica", "Helvetica Neue"],
    regular: { query: "Arial:style=Regular", fallback: "/System/Library/Fonts/Supplemental/Arial.ttf" },
    bold: { query: "Arial:style=Bold", fallback: "/System/Library/Fonts/Supplemental/Arial Bold.ttf" },
  },
  {
    family: "Calibri",
    aliases: ["Calibri", "Aptos", "Aptos Display", "Aptos Body"],
    regular: { query: "Calibri:style=Regular", download: "Carlito-Regular.ttf" },
    bold: { query: "Calibri:style=Bold", download: "Carlito-Bold.ttf" },
  },
  {
    family: "Times New Roman",
    aliases: ["Times New Roman", "Times"],
    regular: { query: "Times New Roman:style=Regular", fallback: "/System/Library/Fonts/Supplemental/Times New Roman.ttf" },
    bold: { query: "Times New Roman:style=Bold", fallback: "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf" },
  },
  {
    family: "Georgia",
    aliases: ["Georgia"],
    regular: { query: "Georgia:style=Regular", fallback: "/System/Library/Fonts/Supplemental/Georgia.ttf" },
    bold: { query: "Georgia:style=Bold", fallback: "/System/Library/Fonts/Supplemental/Georgia Bold.ttf" },
  },
  {
    family: "Verdana",
    aliases: ["Verdana"],
    regular: { query: "Verdana:style=Regular", fallback: "/System/Library/Fonts/Supplemental/Verdana.ttf" },
    bold: { query: "Verdana:style=Bold", fallback: "/System/Library/Fonts/Supplemental/Verdana Bold.ttf" },
  },
  {
    family: "Courier New",
    aliases: ["Courier New", "Courier", "Menlo", "JetBrains Mono"],
    regular: { query: "Courier New:style=Regular", fallback: "/System/Library/Fonts/Supplemental/Courier New.ttf" },
    bold: { query: "Courier New:style=Bold", fallback: "/System/Library/Fonts/Supplemental/Courier New Bold.ttf" },
  },
  {
    family: "Noto Sans CJK SC",
    aliases: ["Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "SimSun", "Songti SC"],
    regular: { query: "Noto Sans CJK SC:style=Regular", download: "NotoSansCJKsc-Regular.otf", fallbackQuery: "PingFang SC:style=Regular" },
    bold: { query: "Noto Sans CJK SC:style=Bold", download: "NotoSansCJKsc-Bold.otf", fallbackQuery: "PingFang SC:style=Semibold" },
  },
];

const args = new Set(process.argv.slice(2));
const downloadMissing = args.has("--download-missing");

await mkdir(cacheDir, { recursive: true });

const faces = {};
const aliases = {};
const sourceFiles = {};
const warnings = [];

for (const family of families) {
  const regularKey = faceKey(family.family, "regular");
  const boldKey = faceKey(family.family, "bold");
  const regular = await resolveFaceSource(family.regular, family.family, "regular");
  const bold = await resolveFaceSource(family.bold, family.family, "bold");
  faces[regularKey] = extractFace(regular.path, family.family, "regular", regular.query, regular.note);
  faces[boldKey] = extractFace(bold.path, family.family, "bold", bold.query, bold.note);
  for (const alias of family.aliases) {
    aliases[normalizeAlias(alias)] = { regular: regularKey, bold: boldKey };
  }
  sourceFiles[regularKey] = regular.publicSource;
  sourceFiles[boldKey] = bold.publicSource;
}

const pack = {
  version: 1,
  generatedAt: new Date().toISOString(),
  units: "em",
  chars: metricChars,
  kerningPairs,
  aliases,
  faces,
  sourceFiles,
  warnings,
};

const body = `// Auto-generated by tools/generate-font-metrics-pack.mjs. Do not edit by hand.\n` +
  `// Contains derived font metrics only; it does not embed or redistribute font files.\n` +
  `export const FONT_METRICS_PACK = ${JSON.stringify(pack, null, 2)} as const;\n`;
await writeFile(outPath, body, "utf8");
console.log(`Wrote ${outPath}`);
console.log(`Faces: ${Object.keys(faces).length}, chars: ${metricChars.length}, warnings: ${warnings.length}`);
for (const warning of warnings) console.warn(`warning: ${warning}`);

async function resolveFaceSource(spec, family, weight) {
  const matched = matchFont(spec.query);
  if (matched.path && isUsableMatch(matched, spec.query)) {
    return { path: matched.path, query: spec.query, publicSource: matched.path, note: "fontconfig" };
  }
  if (spec.fallbackQuery) {
    const fallback = matchFont(spec.fallbackQuery);
    if (fallback.path && isUsableMatch(fallback, spec.fallbackQuery)) {
      warnings.push(`${family} ${weight}: ${spec.query} not installed; used ${spec.fallbackQuery}.`);
      return { path: fallback.path, query: spec.fallbackQuery, publicSource: fallback.path, note: "fontconfig-fallback" };
    }
  }
  if (spec.download) {
    const cached = resolve(cacheDir, spec.download);
    if (!existsSync(cached) && downloadMissing) {
      await downloadFile(downloads[spec.download], cached);
    }
    if (existsSync(cached)) {
      warnings.push(`${family} ${weight}: ${spec.query} not installed; used downloaded open font ${spec.download}.`);
      return { path: cached, query: spec.query, publicSource: `.font-cache/${spec.download}`, note: "downloaded-open-font" };
    }
  }
  if (spec.fallback && existsSync(spec.fallback)) {
    warnings.push(`${family} ${weight}: ${spec.query} not installed; used fallback file ${spec.fallback}.`);
    return { path: spec.fallback, query: spec.query, publicSource: spec.fallback, note: "path-fallback" };
  }
  throw new Error(`Could not resolve ${family} ${weight}; query=${spec.query}`);
}

function matchFont(query) {
  try {
    const out = execFileSync("fc-match", ["-f", "%{file}\n%{family}\n%{style}\n", query], { encoding: "utf8" });
    const [path = "", family = "", style = ""] = out.split("\n");
    return { path: path.trim(), family: family.trim(), style: style.trim() };
  } catch {
    return { path: "", family: "", style: "" };
  }
}

function isUsableMatch(match, query) {
  if (!match.path || !existsSync(match.path)) return false;
  const requested = query.split(":")[0].toLowerCase();
  const matched = `${match.family} ${basename(match.path)}`.toLowerCase();
  if (requested.includes("calibri") || requested.includes("aptos") || requested.includes("microsoft yahei") || requested.includes("noto sans cjk")) {
    return matched.includes(requested);
  }
  return true;
}

async function downloadFile(url, path) {
  if (!url) throw new Error(`Missing download URL for ${path}`);
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(path, bytes);
}

function extractFace(path, requestedFamily, weight, query, sourceKind) {
  const font = selectFont(fontkit.openSync(path), requestedFamily, weight);
  const unitsPerEm = font.unitsPerEm || 1000;
  const advances = {};
  for (const ch of metricChars) {
    advances[ch] = round4(advanceUnits(font, ch) / unitsPerEm);
  }
  const kerning = {};
  for (const pair of kerningPairs) {
    const delta = advanceUnits(font, pair) - [...pair].reduce((sum, ch) => sum + advanceUnits(font, ch), 0);
    if (Math.abs(delta) >= 1) kerning[pair] = round4(delta / unitsPerEm);
  }
  const buckets = {
    latin: round4(averageAdvance(font, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", unitsPerEm)),
    digit: round4(averageAdvance(font, "0123456789", unitsPerEm)),
    space: round4(advanceUnits(font, " ") / unitsPerEm),
    narrow: round4(averageAdvance(font, "ilI1|.,:;", unitsPerEm)),
    wide: round4(averageAdvance(font, "MW@#%&", unitsPerEm)),
    symbol: round4(averageAdvance(font, "→←✓✕●◆★", unitsPerEm)),
    cjk: round4(averageAdvance(font, "的一是中国人香格里拉雪山", unitsPerEm)),
  };
  return {
    family: requestedFamily,
    weight,
    sourceKind,
    query,
    fontFamily: font.familyName || "",
    fullName: font.fullName || "",
    postscriptName: font.postscriptName || "",
    sourceHash: hashFile(path),
    unitsPerEm,
    ascent: round4((font.ascent || unitsPerEm * 0.8) / unitsPerEm),
    descent: round4((font.descent || -unitsPerEm * 0.2) / unitsPerEm),
    lineGap: round4((font.lineGap || 0) / unitsPerEm),
    capHeight: typeof font.capHeight === "number" ? round4(font.capHeight / unitsPerEm) : undefined,
    xHeight: typeof font.xHeight === "number" ? round4(font.xHeight / unitsPerEm) : undefined,
    buckets,
    advances,
    kerning,
  };
}

function selectFont(opened, requestedFamily, weight) {
  const fonts = Array.isArray(opened.fonts) ? opened.fonts : [opened];
  if (fonts.length === 1) return fonts[0];
  const req = requestedFamily.toLowerCase();
  const wantBold = weight === "bold";
  const scored = fonts.map((font) => {
    const name = `${font.familyName || ""} ${font.fullName || ""} ${font.subfamilyName || ""}`.toLowerCase();
    let score = 0;
    if (name.includes(req)) score += 5;
    for (const token of req.split(/\s+/)) if (token && name.includes(token)) score += 1;
    const boldish = /bold|semibold|medium|w6|黑|粗/i.test(name);
    if (wantBold === boldish) score += 3;
    if (!wantBold && /regular|w3|normal|標準|常规/i.test(name)) score += 2;
    return { font, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0].font;
}

function advanceUnits(font, text) {
  const run = font.layout(text);
  return run.positions.reduce((sum, pos) => sum + (pos.xAdvance || 0), 0);
}

function averageAdvance(font, chars, unitsPerEm) {
  const list = [...chars].filter((ch) => {
    try { return font.hasGlyphForCodePoint(ch.codePointAt(0)); } catch { return true; }
  });
  const usable = list.length ? list : [...chars];
  return usable.reduce((sum, ch) => sum + advanceUnits(font, ch), 0) / usable.length / unitsPerEm;
}

function hashFile(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
  } catch {
    return "";
  }
}

function faceKey(family, weight) {
  return `${normalizeAlias(family)}-${weight}`;
}

function normalizeAlias(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function uniqueChars(text) {
  return Array.from(new Set([...text])).join("");
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}
