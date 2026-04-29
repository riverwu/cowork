import type { Tool } from "./types";
import { readFileText } from "@/lib/tauri";

/**
 * Read a single slide from a SlideML deck file by index. Designed for
 * the surgical-fix workflow: when `validate_slideml` reports
 * `slides[5].slots.body has X chars, exceeds...`, the agent should
 * read just slide 5, fix it, and write it back via `replace_slide` —
 * NOT re-emit the entire deck.
 *
 * JSON-only on disk (matches append_slides / replace_slide policy).
 * Index is 0-based to match validator error messages.
 */
export const readSlideTool: Tool = {
  definition: {
    name: "read_slide",
    description:
      `Read a single slide from a SlideML deck JSON file by 0-based index. Returns the slide's JSON.

Use this when \`validate_slideml\` reports an error on \`slides[N]\` — read slide N, see what's wrong, then call \`replace_slide(path, N, fixed)\` to fix it. Avoids re-reading or re-emitting the whole deck.

Index is 0-based and MUST match the validator's \`slides[N]\` error format.`,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to a JSON SlideML deck file.",
        },
        index: {
          type: "number",
          description: "0-based slide index. Matches validator error format `slides[N]`.",
        },
      },
      required: ["path", "index"],
    },
  },

  async execute(input) {
    const path = String(input.path || "").trim();
    const index = typeof input.index === "number" ? Math.floor(input.index) : NaN;
    if (!path) return "Error: path (absolute) is required.";
    if (!Number.isFinite(index) || index < 0) {
      return "Error: index must be a non-negative integer (0-based).";
    }

    let body: string;
    try {
      body = await readFileText(path);
    } catch (err) {
      return `Error: failed to read deck file ${path}: ${err instanceof Error ? err.message : String(err)}.`;
    }
    const trimmed = body.replace(/^\uFEFF/, "").trimStart();
    if (!trimmed.startsWith("{")) {
      return `Error: deck file at ${path} is not JSON. read_slide operates on JSON deck files only.`;
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
      return `Error: index ${index} is out of range. Deck has ${deck.slides.length} slide${deck.slides.length === 1 ? "" : "s"} (valid indices 0..${deck.slides.length - 1}).`;
    }
    const slide = deck.slides[index];
    return `Slide ${index} of ${deck.slides.length}:\n${JSON.stringify(slide, null, 2)}`;
  },

  // History compression: keep just the slide layout + index identifier.
  // Failures stay full.
  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    const layoutMatch = /"layout"\s*:\s*"([^"]+)"/.exec(rawResult);
    const indexMatch = /^Slide (\d+) of (\d+)/.exec(rawResult);
    if (layoutMatch && indexMatch) {
      return `→ slide ${indexMatch[1]}/${indexMatch[2]} (layout: ${layoutMatch[1]})`;
    }
    return rawResult.slice(0, 120);
  },
};
