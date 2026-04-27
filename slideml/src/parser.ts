/**
 * SlideML YAML parser.
 *
 * Strict mode: rejects extra keys at deck or slide level. Slot values are
 * passed through as-is and validated in `validator.ts` against the layout's
 * slot schema.
 */

import yaml from "js-yaml";
import type { DeckSpec, SlideSpec } from "./render/index.js";

export interface SlidemlParseError extends Error {
  code: "PARSE_ERROR" | "EXTRA_KEY" | "MISSING_KEY" | "TYPE_MISMATCH";
  hint?: string;
  path?: string;
}

const ALLOWED_DECK_KEYS = new Set(["size", "language", "theme", "defaults"]);
const ALLOWED_SIZES = new Set(["16x9", "16x10", "4x3", "wide"]);
const ALLOWED_SLIDE_KEYS = new Set(["layout", "chrome", "notes", "transition", "slots"]);
const ALLOWED_TRANSITIONS = new Set(["none", "fade"]);

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

  return {
    slideml: 1,
    deck: {
      size: size as DeckSpec["deck"]["size"],
      language: typeof language === "string" ? language : undefined,
      theme,
      defaults: (defaults as Record<string, string>) ?? undefined,
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

  const chrome = raw["chrome"];
  if (chrome !== undefined && chrome !== "default" && chrome !== "none") {
    throw structured("TYPE_MISMATCH", `slides[${index}].chrome must be "default" or "none".`);
  }

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

  return {
    layout,
    chrome: chrome as SlideSpec["chrome"],
    notes: notes as string | undefined,
    transition: transition as SlideSpec["transition"],
    slots: slots as Record<string, unknown>,
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
