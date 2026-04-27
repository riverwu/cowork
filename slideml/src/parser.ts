/**
 * SlideML YAML parser.
 *
 * Strict mode: rejects extra keys at deck or slide level. Slot values are
 * passed through as-is and validated in `validator.ts` against the layout's
 * slot schema.
 */

import yaml from "js-yaml";
import type { BackgroundSpec, BandSpec, ChromeSpec, DeckSpec, SlideSpec } from "./render/index.js";

export interface SlidemlParseError extends Error {
  code: "PARSE_ERROR" | "EXTRA_KEY" | "MISSING_KEY" | "TYPE_MISMATCH";
  hint?: string;
  path?: string;
}

const ALLOWED_DECK_KEYS = new Set(["size", "language", "theme", "defaults", "header", "footer", "background"]);
const ALLOWED_SIZES = new Set(["16x9", "16x10", "4x3", "wide"]);
const ALLOWED_SLIDE_KEYS = new Set(["layout", "chrome", "notes", "transition", "slots", "header", "footer", "background"]);
const ALLOWED_TRANSITIONS = new Set(["none", "fade"]);
const ALLOWED_CHROME_OBJECT_KEYS = new Set(["header", "footer", "brandBar", "pageNumber"]);
const ALLOWED_BAND_KEYS = new Set(["left", "center", "right"]);

/** Parse a SlideML YAML string into a typed DeckSpec. */
export function parseSlideml(input: string): DeckSpec {
  let raw: unknown;
  try {
    raw = yaml.load(input);
  } catch (err) {
    throw structured("PARSE_ERROR", `YAML parse error: ${err instanceof Error ? err.message : err}`);
  }

  if (!isObject(raw)) {
    throw structured("TYPE_MISMATCH", "SlideML document must be a YAML mapping at the top level.");
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
    },
    slides,
  };
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
    throw structured("TYPE_MISMATCH", `${path} must be "default" | "none" | { header, footer, brandBar, pageNumber } object.`);
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_CHROME_OBJECT_KEYS.has(key)) {
      throw structured("EXTRA_KEY", `${path}.${key} is not a recognized chrome flag. Allowed: ${[...ALLOWED_CHROME_OBJECT_KEYS].join(", ")}.`);
    }
    if (typeof value[key] !== "boolean") {
      throw structured("TYPE_MISMATCH", `${path}.${key} must be a boolean.`);
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
