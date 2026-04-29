import type { Tool } from "./types";
import { readFileText, writeFile } from "@/lib/tauri";
import { parseJsonLenient } from "./_json-repair";

/**
 * Append one or more slides to an existing SlideML deck file (JSON or
 * YAML on disk; reads the file, mutates the `slides` array, writes
 * back). Designed to dodge the `terminated` failure mode where an agent
 * tries to emit a 50KB+ JSON deck in a single tool call and the LLM
 * stream times out.
 *
 * Recommended workflow for any deck > 5 slides:
 *   1. `write_file` — write a SKELETON deck JSON (deck object +
 *      `"slides": []`).
 *   2. `append_slides` — add 2-4 slides at a time. Repeat until done.
 *   3. `validate_slideml` (optional) — sanity-check before render.
 *   4. `render_slideml` — produce the .pptx + sidecar.
 *
 * Each individual `append_slides` call is small enough to stream
 * reliably even on slower providers, while the cumulative deck can be
 * arbitrarily large.
 */
export const appendSlidesTool: Tool = {
  definition: {
    name: "append_slides",
    description:
      `Append one or more slides to a SlideML deck file already on disk. The file must already contain a top-level \`slides: []\` (or \`slides: [<existing>]\`) array — call \`write_file\` first to create a deck skeleton.

Use this INSTEAD of a giant single \`write_file\` when building any deck with more than ~5 slides — it splits the agent's output across multiple smaller tool calls and avoids the LLM-stream-terminated failure mode common to large content emissions.

Workflow:
1. \`write_file\` initial skeleton:
   \`\`\`json
   {
     "slideml": 1,
     "deck": { "size": "16x9", "language": "zh-CN", "theme": "charcoal-minimal" },
     "slides": []
   }
   \`\`\`
2. \`append_slides\` with 2-4 slides per call. Repeat until all slides added.
3. \`render_slideml\` (using \`path:\` arg) to produce the .pptx.

Slide objects use the same schema as inline \`slides[]\` entries — see \`describe_slide_layout\` for per-layout slot shapes.`,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to an existing SlideML deck file (JSON or YAML). Must already contain a `slides` array at top level.",
        },
        slides: {
          type: "array",
          description: "One or more slide objects to append (in order). Each slide is `{ layout: \"...\", slots: { ... } }` matching the layout's schema. Recommended batch size: 2-4 slides per call to keep stream short.",
          items: {
            type: "object",
            properties: {
              layout: { type: "string", description: "Layout name from list_slide_layouts." },
              slots: { type: "object", description: "Per-layout slot map." },
              chrome: { type: "string", description: "Optional. \"default\" | \"none\"." },
              notes: { type: "string", description: "Optional speaker notes." },
            },
            required: ["layout", "slots"],
          },
          minItems: 1,
        },
      },
      required: ["path", "slides"],
    },
  },

  async execute(input) {
    const path = String(input.path || "").trim();
    if (!path) return "Error: path (absolute) is required.";

    // Tolerate the JSON-string form: agents often serialize large array
    // arguments as a JSON-encoded string instead of a native array
    // (~30% of tool calls when the slides payload is large). Auto-parse
    // before the array check so the agent's intent works either way.
    let slidesRaw: unknown = input.slides;
    if (typeof slidesRaw === "string") {
      // Use the lenient parser — auto-repairs the most common LLM failure
      // (raw newlines / tabs inside string values, e.g. multi-line `body`).
      try {
        slidesRaw = parseJsonLenient(slidesRaw);
      } catch (err) {
        return `Error: slides was passed as a string but did not parse as JSON: ${err instanceof Error ? err.message : String(err)}. Pass slides as a native JSON array (preferred), or escape any newlines inside string values as \\n.`;
      }
    }
    const slides = Array.isArray(slidesRaw) ? slidesRaw : null;
    if (!slides || slides.length === 0) {
      return "Error: slides must be a non-empty array of slide objects (each `{layout, slots, chrome?, notes?}`).";
    }

    let body: string;
    try {
      body = await readFileText(path);
    } catch (err) {
      return `Error: failed to read deck file ${path}: ${err instanceof Error ? err.message : String(err)}. Call write_file with a deck skeleton first.`;
    }

    // JSON-only — append_slides operates on JSON deck files. Agents
    // building decks incrementally should write the skeleton as JSON
    // (also the policy we now enforce on inline `slideml:` args). YAML
    // sidecars from prior renders can still be RENDERED via render_slideml
    // path; they just can't be incrementally edited via this tool.
    const trimmed = body.replace(/^\uFEFF/, "").trimStart();
    if (!trimmed.startsWith("{")) {
      return `Error: deck file at ${path} is not JSON (must start with \`{\`). append_slides operates on JSON only — write the skeleton as JSON via write_file. (For YAML sidecars: render with render_slideml then use edit_slideml's insertSlide ops instead.)`;
    }

    let deck: { slideml?: unknown; deck?: unknown; slides?: unknown[] };
    try {
      deck = JSON.parse(body) as typeof deck;
    } catch (err) {
      return `Error: deck file at ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}. Call write_file to overwrite with a clean skeleton.`;
    }

    if (!deck || typeof deck !== "object" || Array.isArray(deck)) {
      return `Error: deck file root must be an object with \`slideml\`, \`deck\`, \`slides\`. Got: ${typeof deck}.`;
    }
    if (!Array.isArray(deck.slides)) {
      return `Error: deck file is missing top-level \`slides\` array. Initialize with \`"slides": []\` via write_file before calling append_slides.`;
    }

    const existing = deck.slides;
    const before = existing.length;
    deck.slides = [...existing, ...slides];
    const after = deck.slides.length;

    const serialized = JSON.stringify(deck, null, 2) + "\n";
    try {
      await writeFile(path, serialized);
    } catch (err) {
      return `Error: failed to write deck file ${path}: ${err instanceof Error ? err.message : String(err)}.`;
    }

    return `Appended ${after - before} slide${after - before === 1 ? "" : "s"} to ${path}. Total slides: ${after}.`;
  },

  // History compression: keep counts + path. Failures stay full.
  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    const m = /Appended (\d+) .* to (\S+)\. Total slides: (\d+)/.exec(rawResult);
    return m ? `→ +${m[1]} slides → ${m[2]} (total ${m[3]})` : rawResult.slice(0, 120);
  },
};
