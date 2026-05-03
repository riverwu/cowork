import type { Tool } from "./types";
import { slideml2PatchDeck, slideml2ReadDeck, type Slideml2JsonPatchOp } from "@/lib/tauri";

/**
 * 9gusb7: agents need to delete a slide (e.g. removing a stale draft,
 * dropping a slide after refactor). Before this tool the only path was
 * patch_deck with `{op:"remove", path:"/slides/N"}`, which the agent
 * could not reliably format. This tool resolves a slide id OR a 0-based
 * index to the right path and applies the remove.
 */
export const deleteSlideTool: Tool = {
  definition: {
    name: "delete_slide",
    description:
      `Delete a slide from the deck by id or 0-based index. Subsequent slides shift up by one.

- Pass \`slideId\` as a string (the slide's \`id\` field) OR a number (0-based index).
- For replacing a slide, use \`replace_slide\`. For inserting a new slide, use \`insert_slide\`.

The whole deck is re-validated after deletion. If validation fails the deck file is left unchanged.`,
    parameters: {
      type: "object",
      properties: {
        deckPath: { type: "string" },
        slideId: { description: "Slide id (string) or 0-based index (number)." },
      },
      required: ["deckPath", "slideId"],
    },
  },

  async execute(input) {
    const deckPath = String(input.deckPath || "").trim();
    if (!deckPath) return "Error: deckPath is required.";
    if (input.slideId === undefined || input.slideId === null) return "Error: slideId is required.";
    let deck: { slides?: Array<{ id?: string }> } | null = null;
    try {
      deck = await slideml2ReadDeck(deckPath) as { slides?: Array<{ id?: string }> };
    } catch (err) {
      return `Error: delete_slide could not read deck.\n${err instanceof Error ? err.message : String(err)}`;
    }
    const slides = Array.isArray(deck?.slides) ? deck.slides : [];
    const index = resolveSlideIndex(input.slideId, slides);
    if (typeof index === "string") return index;
    const patch: Slideml2JsonPatchOp[] = [{ op: "remove", path: `/slides/${index}` }];
    try {
      const result = await slideml2PatchDeck(deckPath, patch);
      if (!result.ok) {
        return `Slide delete rejected (deck unchanged): ${result.error}\n${JSON.stringify(result.validation, null, 2)}`;
      }
      const removedId = slides[index]?.id || `index ${index}`;
      return `Slide ${removedId} deleted (was at index ${index}). slideCount=${result.summary.slideCount}. Run validate_render to confirm downstream references are still valid.`;
    } catch (err) {
      return `Error: delete_slide failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },

  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    return rawResult.slice(0, 200);
  },
};

function resolveSlideIndex(raw: unknown, slides: Array<{ id?: string }>): number | string {
  if (typeof raw === "number" && Number.isInteger(raw)) {
    if (raw < 0 || raw >= slides.length) {
      return `Error: slide index ${raw} out of range. Valid: 0..${slides.length - 1} (slideCount=${slides.length}).`;
    }
    return raw;
  }
  if (typeof raw === "string") {
    // First try parsing as numeric index
    const n = Number(raw);
    if (Number.isInteger(n) && String(n) === raw.trim()) {
      if (n < 0 || n >= slides.length) {
        return `Error: slide index ${n} out of range. Valid: 0..${slides.length - 1}.`;
      }
      return n;
    }
    // Otherwise look up by id
    const id = raw.trim();
    const idx = slides.findIndex((s) => typeof s.id === "string" && s.id === id);
    if (idx < 0) {
      const sample = slides.slice(0, 6).map((s, i) => `${i}:${s.id || "?"}`).join(", ");
      return `Error: slide id "${id}" not found. First slides: [${sample}${slides.length > 6 ? ", ..." : ""}].`;
    }
    return idx;
  }
  return "Error: slideId must be a string (slide id) or number (0-based index).";
}
