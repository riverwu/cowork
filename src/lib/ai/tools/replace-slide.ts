import type { Tool } from "./types";
import { readFileText, writeFile } from "@/lib/tauri";
import { parseJsonLenient } from "./_json-repair";

/**
 * Replace one slide in a SlideML JSON deck file by 0-based index.
 * Companion to `read_slide` for the surgical-fix workflow:
 *
 *   1. validate_slideml → "slides[5].regions.main.props.body too long"
 *   2. read_slide(path, 5) → see current state
 *   3. replace_slide(path, 5, fixed_slide_object) → write back
 *   4. validate_slideml → confirm fixed
 *
 * Cheaper than re-emitting the entire deck (avoids the big-tool-call
 * stream-terminated failure mode) and more atomic than apply_patch on
 * deeply-nested JSON.
 */
export const replaceSlideTool: Tool = {
  definition: {
    name: "replace_slide",
    description:
      `Replace one slide at a 0-based index in a SlideML deck JSON file. Index uses the same numbering as validator error messages (\`slides[N]\`).

Use this for surgical fixes — when validate_slideml flags a single slide, read it with \`read_slide\`, edit, then call this. Far cheaper and more reliable than rewriting the whole deck.

The new slide object uses the same schema as inline \`slides[]\` entries (\`{ pattern, title?, regions, policy?, chrome?, notes? }\`).`,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to a JSON SlideML deck file.",
        },
        index: {
          type: "number",
          description: "0-based slide index to replace (same numbering as validator's `slides[N]` errors).",
        },
        slide: {
          type: "object",
          description: "New slide object: `{ pattern, title?, regions, policy?, chrome?, notes? }`. See `list_slide_pagepatterns` for regions and `describe_content_component` for component props.",
          properties: {
            pattern: { type: "string" },
            title: { type: "string" },
            regions: { type: "object" },
            policy: { type: "object" },
            chrome: { type: "string" },
            notes: { type: "string" },
          },
          required: ["pattern", "regions"],
        },
      },
      required: ["path", "index", "slide"],
    },
  },

  async execute(input) {
    const path = String(input.path || "").trim();
    const index = typeof input.index === "number" ? Math.floor(input.index) : NaN;
    if (!path) return "Error: path (absolute) is required.";
    if (!Number.isFinite(index) || index < 0) {
      return "Error: index must be a non-negative integer (0-based).";
    }
    // Tolerate JSON-string form of `slide` (same agent quirk handled in
    // append_slides — large complex args sometimes arrive serialized).
    let slideRaw: unknown = input.slide;
    if (typeof slideRaw === "string") {
      try {
        slideRaw = parseJsonLenient(slideRaw);
      } catch (err) {
        return `Error: slide was passed as a string but did not parse as JSON: ${err instanceof Error ? err.message : String(err)}. Pass slide as a native JSON object (preferred), or escape any newlines inside string values as \\n.`;
      }
    }
    const slide = slideRaw as Record<string, unknown> | undefined;
    if (!slide || typeof slide !== "object" || Array.isArray(slide)) {
      return "Error: slide must be an object with at least `pattern` and `regions` fields.";
    }
    if (typeof slide.pattern !== "string" || !slide.pattern) {
      return "Error: slide.pattern must be a non-empty string. See list_slide_pagepatterns.";
    }
    if (!slide.regions || typeof slide.regions !== "object" || Array.isArray(slide.regions)) {
      return "Error: slide.regions must be an object. Fill it with ContentComponents from list_content_components.";
    }

    let body: string;
    try {
      body = await readFileText(path);
    } catch (err) {
      return `Error: failed to read deck file ${path}: ${err instanceof Error ? err.message : String(err)}.`;
    }
    const trimmed = body.replace(/^\uFEFF/, "").trimStart();
    if (!trimmed.startsWith("{")) {
      return `Error: deck file at ${path} is not JSON. replace_slide operates on JSON deck files only.`;
    }
    let deck: { slides?: unknown[] };
    try {
      deck = JSON.parse(body);
    } catch (err) {
      return `Error: invalid JSON at ${path}: ${err instanceof Error ? err.message : String(err)}.`;
    }
    if (!Array.isArray(deck.slides)) {
      return `Error: deck file is missing top-level \`slides\` array.`;
    }
    if (index >= deck.slides.length) {
      return `Error: index ${index} is out of range. Deck has ${deck.slides.length} slide${deck.slides.length === 1 ? "" : "s"} (valid indices 0..${deck.slides.length - 1}). Use \`append_slides\` to add new slides at the end.`;
    }

    const old = deck.slides[index] as { pattern?: string } | undefined;
    deck.slides[index] = slide;

    try {
      await writeFile(path, JSON.stringify(deck, null, 2) + "\n");
    } catch (err) {
      return `Error: failed to write deck file ${path}: ${err instanceof Error ? err.message : String(err)}.`;
    }

    const oldPattern = old && typeof old.pattern === "string" ? old.pattern : "?";
    return `Replaced slide ${index} (${oldPattern} → ${slide.pattern}) in ${path}.`;
  },

  // History compression: keep index + before/after pattern names.
  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    const m = /Replaced slide (\d+) \(([^)]+)\) in (\S+)/.exec(rawResult);
    return m ? `→ slide ${m[1]} replaced (${m[2]}) in ${m[3]}` : rawResult.slice(0, 120);
  },
};
