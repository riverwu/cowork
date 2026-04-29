/**
 * SlideML YAML parser.
 *
 * Strict mode: rejects extra keys at deck or slide level. Slot values are
 * passed through as-is and validated in `validator.ts` against the layout's
 * slot schema.
 */

import yaml from "js-yaml";
import type { BackgroundSpec, BandSpec, BrandSpec, ChromeSpec, DeckSpec, SlideSpec } from "./render/index.js";

export interface SlidemlParseError extends Error {
  code: "PARSE_ERROR" | "EXTRA_KEY" | "MISSING_KEY" | "TYPE_MISMATCH";
  hint?: string;
  path?: string;
}

const ALLOWED_DECK_KEYS = new Set(["size", "language", "theme", "defaults", "header", "footer", "background", "brand", "chrome", "palette", "fonts", "style", "oxml"]);
const ALLOWED_SIZES = new Set(["16x9", "16x10", "4x3", "wide"]);
const ALLOWED_SLIDE_KEYS = new Set(["layout", "chrome", "notes", "transition", "slots", "header", "footer", "background"]);
const ALLOWED_TRANSITIONS = new Set(["none", "fade"]);
const ALLOWED_CHROME_OBJECT_KEYS = new Set(["header", "footer", "brandBar", "pageNumber", "enable", "disable", "override"]);
const CHROME_BOOLEAN_KEYS = new Set(["header", "footer", "brandBar", "pageNumber"]);
const ALLOWED_BAND_KEYS = new Set(["left", "center", "right"]);

/**
 * Parse a SlideML document — accepts BOTH YAML and JSON.
 *
 * Detection: if the first non-whitespace char is `{` or `[`, treat as
 * JSON and route through `JSON.parse` for clearer errors. Otherwise
 * use the YAML parser (which technically also accepts JSON since JSON
 * is a YAML 1.2 subset, but its error messages for JSON syntax are
 * misleading — they reference YAML rules).
 *
 * Recommendation for LLM agents: prefer JSON. It eliminates the entire
 * class of YAML pitfalls (indentation, nested quotes, implicit typing,
 * `:`/`#`/`{` ambiguity) at the cost of a few escape sequences in
 * multi-line strings.
 */
export function parseSlideml(input: string): DeckSpec {
  const trimmed = input.replace(/^\uFEFF/, "").trimStart();
  const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");

  let raw: unknown;
  if (looksLikeJson) {
    try {
      raw = JSON.parse(input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw structured(
        "PARSE_ERROR",
        `JSON parse error: ${msg}`,
        "Input was detected as JSON (starts with `{` or `[`). Common JSON pitfalls: trailing commas, unquoted keys, single quotes (use double), unescaped `\\n` / `\\\"` inside strings. If you wanted YAML, the document must NOT start with `{` or `[`.",
      );
    }
  } else {
    try {
      raw = yaml.load(input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const hint = diagnoseYamlError(msg, input);
      throw structured(
        "PARSE_ERROR",
        `YAML parse error: ${msg}`,
        hint ? `${hint} (Tip: switching to JSON output avoids most YAML pitfalls — \`{ "slideml": 1, "deck": {...}, "slides": [...] }\`.)` : undefined,
      );
    }
  }

  if (!isObject(raw)) {
    throw structured("TYPE_MISMATCH", "SlideML document must be a mapping at the top level (YAML mapping or JSON object).");
  }

  // slideml: 1
  if (!("slideml" in raw)) {
    throw structured("MISSING_KEY", `Top-level "slideml" version key is required (e.g. "slideml: 1").`);
  }
  // Accept both numeric (1) and string ("1") forms — real-LLM testing
  // showed agents emit `slideml: "1"` ~10% of the time, which YAML parses
  // as a string. Both clearly mean v1; reject only genuinely wrong values.
  const versionRaw = (raw as Record<string, unknown>)["slideml"];
  const versionNum = typeof versionRaw === "number" ? versionRaw : Number(versionRaw);
  if (versionRaw === null || versionRaw === undefined || !Number.isFinite(versionNum) || versionNum !== 1) {
    throw structured(
      "TYPE_MISMATCH",
      `Unsupported SlideML version: ${JSON.stringify(versionRaw)}. This compiler implements v1.`,
      "Add `slideml: 1` at the top of the file.",
    );
  }

  // deck: { ... }
  const deckRaw = (raw as Record<string, unknown>)["deck"];
  if (!isObject(deckRaw)) {
    throw structured("MISSING_KEY", `Top-level "deck" mapping is required.`);
  }
  for (const key of Object.keys(deckRaw)) {
    if (!ALLOWED_DECK_KEYS.has(key)) {
      throw structured("EXTRA_KEY", `Unknown deck key "${key}". Allowed: ${[...ALLOWED_DECK_KEYS].join(", ")}.`, undefined, `deck.${key}`);
    }
  }
  const size = deckRaw["size"];
  if (typeof size !== "string" || !ALLOWED_SIZES.has(size)) {
    throw structured(
      "TYPE_MISMATCH",
      `deck.size must be one of ${[...ALLOWED_SIZES].map((s) => `"${s}"`).join(", ")} (got ${JSON.stringify(size)}).`,
    );
  }
  const language = deckRaw["language"];
  if (language !== undefined && typeof language !== "string") {
    throw structured("TYPE_MISMATCH", `deck.language must be a BCP-47 string.`);
  }
  const theme = deckRaw["theme"];
  if (typeof theme !== "string" || !theme) {
    throw structured("MISSING_KEY", `deck.theme (theme name) is required.`);
  }
  const defaults = deckRaw["defaults"];
  if (defaults !== undefined && !isObject(defaults)) {
    throw structured("TYPE_MISMATCH", `deck.defaults must be a mapping of token → token reference.`);
  }
  if (defaults) {
    for (const [k, v] of Object.entries(defaults)) {
      if (typeof v !== "string") {
        throw structured(
          "TYPE_MISMATCH",
          `deck.defaults.${k} must be a token reference (string), not ${typeof v}. Raw hex/literal values are rejected.`,
        );
      }
    }
  }

  // slides: [ ... ]
  const slidesRaw = (raw as Record<string, unknown>)["slides"];
  if (!Array.isArray(slidesRaw) || slidesRaw.length === 0) {
    throw structured("MISSING_KEY", `Top-level "slides" array is required and must contain at least one slide.`);
  }

  // Reject any other top-level keys.
  const ALLOWED_TOP = new Set(["slideml", "deck", "slides"]);
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_TOP.has(key)) {
      throw structured("EXTRA_KEY", `Unknown top-level key "${key}". Allowed: ${[...ALLOWED_TOP].join(", ")}.`);
    }
  }

  const slides: SlideSpec[] = slidesRaw.map((s, i) => parseSlide(s, i));

  const header = parseBand(deckRaw["header"], "deck.header");
  const footer = parseBand(deckRaw["footer"], "deck.footer");
  const background = parseBackground(deckRaw["background"], "deck.background");
  const brand = parseBrand(deckRaw["brand"], "deck.brand");
  const chrome = parseChromeNames(deckRaw["chrome"], "deck.chrome");
  const palette = parseStringMap(deckRaw["palette"], "deck.palette");
  const fonts = parseFonts(deckRaw["fonts"], "deck.fonts");
  const style = parseDeckStyle(deckRaw["style"], "deck.style");
  const oxml = deckRaw["oxml"];
  if (oxml !== undefined && !isObject(oxml)) {
    throw structured("TYPE_MISMATCH", "deck.oxml must be an object.");
  }

  return {
    slideml: 1,
    deck: {
      size: size as DeckSpec["deck"]["size"],
      language: typeof language === "string" ? language : undefined,
      theme,
      defaults: (defaults as Record<string, string>) ?? undefined,
      header,
      footer,
      background,
      brand,
      chrome,
      palette,
      fonts,
      style,
      oxml,
    },
    slides,
  };
}

function parseBrand(value: unknown, path: string): BrandSpec | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    throw structured("TYPE_MISMATCH", `${path} must be an object with { name?, logo?, color? }.`);
  }
  const out: BrandSpec = {};
  if (value["name"] !== undefined) {
    if (typeof value["name"] !== "string") throw structured("TYPE_MISMATCH", `${path}.name must be a string.`);
    out.name = value["name"];
  }
  if (value["color"] !== undefined) {
    if (typeof value["color"] !== "string") throw structured("TYPE_MISMATCH", `${path}.color must be a token name or 6-char hex string.`);
    out.color = value["color"];
  }
  if (value["logo"] !== undefined) {
    if (typeof value["logo"] === "string") {
      out.logo = value["logo"];
    } else if (isObject(value["logo"])) {
      const src = value["logo"]["src"];
      const alt = value["logo"]["alt"];
      if (typeof src !== "string" || !src) throw structured("TYPE_MISMATCH", `${path}.logo.src must be a non-empty string.`);
      if (alt !== undefined && typeof alt !== "string") throw structured("TYPE_MISMATCH", `${path}.logo.alt must be a string.`);
      out.logo = { src, ...(typeof alt === "string" ? { alt } : {}) };
    } else {
      throw structured("TYPE_MISMATCH", `${path}.logo must be a string or { src, alt? }.`);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseChromeNames(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw structured("TYPE_MISMATCH", `${path} must be an array of chrome module name strings.`);
  }
  return value as string[];
}

function parseStringMap(value: unknown, path: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw structured("TYPE_MISMATCH", `${path} must be a mapping of string keys to string values.`);
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(value)) {
    if (typeof v !== "string") throw structured("TYPE_MISMATCH", `${path}.${key} must be a string.`);
    out[key] = v;
  }
  return out;
}

function parseFonts(value: unknown, path: string): DeckSpec["deck"]["fonts"] | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw structured("TYPE_MISMATCH", `${path} must be an object.`);
  const out: NonNullable<DeckSpec["deck"]["fonts"]> = {};
  for (const key of ["latin", "cjk", "mono"] as const) {
    const v = value[key];
    if (v === undefined) continue;
    if (typeof v === "string") out[key] = v;
    else if (Array.isArray(v) && v.every((item) => typeof item === "string")) out[key] = v as string[];
    else throw structured("TYPE_MISMATCH", `${path}.${key} must be a string or string array.`);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseDeckStyle(value: unknown, path: string): DeckSpec["deck"]["style"] | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw structured("TYPE_MISMATCH", `${path} must be an object.`);
  const out: NonNullable<DeckSpec["deck"]["style"]> = {};
  if (value["titleAccentRule"] !== undefined) {
    if (typeof value["titleAccentRule"] !== "boolean") throw structured("TYPE_MISMATCH", `${path}.titleAccentRule must be boolean.`);
    out.titleAccentRule = value["titleAccentRule"];
  }
  if (value["contrastTarget"] !== undefined) {
    const v = value["contrastTarget"];
    if (v !== "warn" && v !== "AA" && v !== "AAA") throw structured("TYPE_MISMATCH", `${path}.contrastTarget must be warn, AA, or AAA.`);
    out.contrastTarget = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseSlide(raw: unknown, index: number): SlideSpec {
  if (!isObject(raw)) {
    throw structured("TYPE_MISMATCH", `slides[${index}] must be a mapping.`, undefined, `slides[${index}]`);
  }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_SLIDE_KEYS.has(key)) {
      throw structured(
        "EXTRA_KEY",
        `slides[${index}].${key} is not a recognized slide key. Allowed: ${[...ALLOWED_SLIDE_KEYS].join(", ")}.`,
        undefined,
        `slides[${index}].${key}`,
      );
    }
  }

  const layout = raw["layout"];
  if (typeof layout !== "string" || !layout) {
    throw structured("MISSING_KEY", `slides[${index}].layout (string) is required.`, undefined, `slides[${index}].layout`);
  }

  const chrome = parseChrome(raw["chrome"], `slides[${index}].chrome`);

  const notes = raw["notes"];
  if (notes !== undefined && typeof notes !== "string") {
    throw structured("TYPE_MISMATCH", `slides[${index}].notes must be a string.`);
  }

  const transition = raw["transition"];
  if (transition !== undefined && (typeof transition !== "string" || !ALLOWED_TRANSITIONS.has(transition))) {
    throw structured("TYPE_MISMATCH", `slides[${index}].transition must be "none" or "fade".`);
  }

  const slots = raw["slots"];
  if (!isObject(slots)) {
    throw structured("MISSING_KEY", `slides[${index}].slots mapping is required.`, undefined, `slides[${index}].slots`);
  }

  // Per-slide overrides — `null` is the explicit "clear deck default" sentinel.
  const header = "header" in raw
    ? (raw["header"] === null ? null : parseBand(raw["header"], `slides[${index}].header`))
    : undefined;
  const footer = "footer" in raw
    ? (raw["footer"] === null ? null : parseBand(raw["footer"], `slides[${index}].footer`))
    : undefined;
  const background = "background" in raw
    ? (raw["background"] === null ? null : parseBackground(raw["background"], `slides[${index}].background`))
    : undefined;

  return {
    layout,
    chrome,
    notes: notes as string | undefined,
    transition: transition as SlideSpec["transition"],
    slots: slots as Record<string, unknown>,
    header,
    footer,
    background,
  };
}

function parseChrome(value: unknown, path: string): ChromeSpec | undefined {
  if (value === undefined) return undefined;
  if (value === "default" || value === "none") return value;
  if (!isObject(value)) {
    throw structured("TYPE_MISMATCH", `${path} must be "default" | "none" | { header?, footer?, brandBar?, pageNumber?, enable?, disable?, override? } object.`);
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_CHROME_OBJECT_KEYS.has(key)) {
      throw structured("EXTRA_KEY", `${path}.${key} is not a recognized chrome key. Allowed: ${[...ALLOWED_CHROME_OBJECT_KEYS].join(", ")}.`);
    }
    if (CHROME_BOOLEAN_KEYS.has(key)) {
      if (typeof value[key] !== "boolean") {
        throw structured("TYPE_MISMATCH", `${path}.${key} must be a boolean.`);
      }
      continue;
    }
    if (key === "enable" || key === "disable") {
      const arr = value[key];
      if (!Array.isArray(arr) || arr.some((v) => typeof v !== "string")) {
        throw structured("TYPE_MISMATCH", `${path}.${key} must be an array of chrome module name strings.`);
      }
      continue;
    }
    if (key === "override") {
      const ov = value[key];
      if (!isObject(ov)) {
        throw structured("TYPE_MISMATCH", `${path}.override must be an object mapping chrome module name → params object.`);
      }
      for (const moduleName of Object.keys(ov)) {
        if (!isObject(ov[moduleName])) {
          throw structured("TYPE_MISMATCH", `${path}.override.${moduleName} must be an object.`);
        }
      }
      continue;
    }
  }
  return value as ChromeSpec;
}

function parseBand(value: unknown, path: string): BandSpec | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (!isObject(value)) {
    throw structured("TYPE_MISMATCH", `${path} must be a string or { left?, center?, right? } object.`);
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_BAND_KEYS.has(key)) {
      throw structured("EXTRA_KEY", `${path}.${key} is not allowed. Allowed: ${[...ALLOWED_BAND_KEYS].join(", ")}.`);
    }
    if (value[key] !== undefined && typeof value[key] !== "string") {
      throw structured("TYPE_MISMATCH", `${path}.${key} must be a string.`);
    }
  }
  return value as BandSpec;
}

function parseBackground(value: unknown, path: string): BackgroundSpec | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    throw structured("TYPE_MISMATCH", `${path} must be { color: "RRGGBB" } or { image: { src, ... } }.`);
  }
  const hasColor = "color" in value;
  const hasImage = "image" in value;
  if (hasColor === hasImage) {
    throw structured("TYPE_MISMATCH", `${path} must have exactly one of "color" or "image".`);
  }
  if (hasColor) {
    const c = value["color"];
    if (typeof c !== "string") {
      throw structured("TYPE_MISMATCH", `${path}.color must be a hex color string (e.g. "0B1B2A").`);
    }
    return { color: c };
  }
  const img = value["image"];
  if (!isObject(img) || typeof img["src"] !== "string") {
    throw structured("TYPE_MISMATCH", `${path}.image must be { src: "<path|url|data:>", alt?, opacity? }.`);
  }
  return {
    image: {
      src: img["src"],
      alt: typeof img["alt"] === "string" ? img["alt"] : undefined,
      opacity: typeof img["opacity"] === "number" ? img["opacity"] : undefined,
    },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function structured(
  code: SlidemlParseError["code"],
  message: string,
  hint?: string,
  path?: string,
): SlidemlParseError {
  const err = new Error(message) as SlidemlParseError;
  err.code = code;
  if (hint) err.hint = hint;
  if (path) err.path = path;
  return err;
}

/**
 * Pattern-match the most common agent-authored YAML mistakes against
 * the line where js-yaml choked, and return a targeted hint. Pure
 * heuristics — when nothing matches we return undefined so the caller
 * just surfaces the raw js-yaml message.
 *
 * Caught patterns (in order):
 *   - Unquoted `{kind:value}` chip → flow-mapping conflict
 *   - Unbalanced ASCII `"` count → outer quoted value with unescaped
 *     inner ASCII quotes (CJK pattern: `"...含 "嵌套" 词..."`)
 *   - Unquoted ASCII `: ` mid-string in a slot value
 *   - Unquoted multi-line string (no `|` / `>`)
 *   - `#` mid-string interpreted as a comment
 *   - `[...]` interpreted as a flow sequence
 */
function diagnoseYamlError(message: string, input: string): string | undefined {
  // Pull "(line:col)" out of the js-yaml message.
  const lineColMatch = /\((\d+):(\d+)\)/.exec(message);
  const line = lineColMatch ? Number(lineColMatch[1]) : NaN;
  const lines = input.split(/\r?\n/);
  const offending = Number.isFinite(line) && line > 0 && line <= lines.length
    ? (lines[line - 1] ?? "")
    : "";
  const prev = Number.isFinite(line) && line > 1 ? (lines[line - 2] ?? "") : "";
  const window = `${prev}\n${offending}`;

  // Chip notation `{kind:value}` unquoted.
  if (/\{[a-zA-Z]+:[^}]*\}/.test(window) && !/["']\s*\{/.test(window)) {
    return `The line contains a SlideML chip like \`{up:+12%}\` but the value is not quoted — YAML reads \`{...}\` as a flow mapping and chokes on the colon. Fix: wrap the whole value in double quotes, e.g. \`takeaway: "收入 {up:+12%} 强劲"\`.`;
  }

  // Nested ASCII `"` inside an outer ASCII-quoted value — happens when
  // the agent wraps a value in `"..."` AND embeds unescaped inner ASCII
  // `"` (extremely common in CJK content quoting classical phrases like
  // `"罢黜百家"`, `"书同文"`). YAML closes the outer string at the first
  // inner `"`; the rest becomes stray tokens. Detection: a `key: "..."`
  // line where the count of unescaped `"` exceeds 2 (a well-formed
  // quoted scalar has exactly 2). Works for both odd (truly unbalanced)
  // and even (one nested phrase = 4 quotes total).
  const lineLooksQuoted = /^\s*[A-Za-z_][\w-]*:\s+"/.test(offending);
  if (lineLooksQuoted) {
    const valuePart = offending.replace(/^\s*[A-Za-z_][\w-]*:\s+/, "");
    const quoteCount = (valuePart.match(/(?<!\\)"/g) ?? []).length;
    if (quoteCount > 2) {
      return `Line ${line}: the value is wrapped in ASCII \`"..."\` but contains ${quoteCount - 2} extra unescaped inner ASCII \`"\` (likely a CJK phrase like \`"书同文"\` or \`"罢黜百家"\`). YAML closes the outer string at the first inner \`"\`. Fix any of: (a) escape inner quotes — \`\\"书同文\\"\`; (b) wrap outer in single quotes — \`'... "书同文" ...'\`; (c) use Chinese curly quotes inside — \`\u201C书同文\u201D\` (U+201C/U+201D); (d) switch to a block scalar — \`body: |\` then content on next line, no quoting needed.`;
    }
  }

  // Multi-line string without block scalar marker. Heuristic: previous
  // line ends in `key: <text>` and current line starts indented but
  // looks like prose (not `- `, not `key:`).
  if (/^\s*[A-Za-z_][\w-]*:\s+\S/.test(prev) &&
      /^\s+\S/.test(offending) &&
      !/^\s*-\s/.test(offending) &&
      !/:\s*$|:\s+\S/.test(offending)) {
    return `Line ${line} looks like a continuation of the previous slot value, but the value isn't a YAML block scalar. Fix: prefix the value with \`|\` (preserves newlines) or \`>\` (folds), e.g. \`text: |\\n  第一段\\n  第二段\`. Or quote the whole value on one line.`;
  }

  // Unquoted ASCII `: ` mid-value (Chinese full-width `：` is safe; only
  // ASCII `: ` triggers YAML key-splitting).
  if (/^\s*[A-Za-z_][\w-]*:\s+[^"'|>].*:\s\S/.test(offending)) {
    return `The slot value contains an unquoted ASCII \`: \` (colon-space), which YAML splits as a sub-mapping. Fix: wrap the value in double quotes, e.g. \`title: "第三章: 详解"\`. Note Chinese full-width \`：\` is safe.`;
  }

  // `#` interpreted as a comment in an unquoted value.
  if (/^\s*[A-Za-z_][\w-]*:\s+[^"'|>].*\s#/.test(offending)) {
    return `The slot value contains an unquoted \`#\`, which YAML treats as the start of a line comment. Fix: wrap the value in double quotes, e.g. \`subtitle: "第一名 #1"\` or \`accent: "#FF0000"\`.`;
  }

  // `[...]` parsed as flow sequence.
  if (/^\s*[A-Za-z_][\w-]*:\s+[^"'|>].*\[.*\]/.test(offending)) {
    return `The slot value contains \`[...]\`, which YAML reads as a flow sequence. Fix: wrap the value in double quotes, e.g. \`caption: "[备注] 内容"\`.`;
  }

  // Generic fallback when we have a line number — point at it.
  if (Number.isFinite(line)) {
    return `Line ${line}: when a slot value contains \`{\`, \`}\`, \`[\`, \`]\`, ASCII \`: \`, \`#\`, or spans multiple lines, wrap it in double quotes (or use \`|\` / \`>\` for multi-line). Otherwise YAML parses it as a mapping/sequence/comment.`;
  }
  return undefined;
}
