import type { Tool } from "./types";
import { slideml2PatchDeck, slideml2ReadDeck, type Slideml2JsonPatchOp } from "@/lib/tauri";
import { recordSlideWrite, getUnvalidatedSlideWrites } from "./slideml2-authoring-state";

/**
 * Thin wrapper over patch_deck — equivalent to:
 *   { "insert": { "/slides/<index>": slide } }
 * Kept for ergonomics: agents who have a clear "insert one slide" intent
 * shouldn't have to reach for the more general patch_deck. Internally we
 * compose the same RFC 6902 op the new patch_deck would emit.
 */
export const insertSlideTool: Tool = {
  definition: {
    name: "insert_slide",
    description:
      `Insert a NEW slide at a specific position. Use when you need to add a slide between two existing slides — for splitting a combined slide, inserting a section break before a content slide, or adding a fresh page mid-deck.

- \`index\` is the 0-based position where the new slide will appear. Subsequent slides shift down by one.
- \`index\` may equal the current slide count (append at end).
- \`index\` may be \`"end"\` as a shortcut for "append".
- For replacing an EXISTING slide, use \`replace_slide\`. For deleting a slide, use \`delete_slide\`. For batch ops or arbitrary DOM edits, use \`patch_deck\`.

The slide JSON has the same shape as \`replace_slide.slide\`: \`{id, title?, background?, children, notes?, metadata?}\`. The whole deck is re-validated after insertion; if the slide breaks schema invariants the deck file is left unchanged.

After every 1-2 successful slide writes, run \`validate_render({deckPath, render:true})\`.`,
    parameters: {
      type: "object",
      properties: {
        deckPath: { type: "string" },
        index: { description: "0-based insertion position. May be a number, the literal \"end\", or omitted (append)." },
        slide: { type: "object", description: "SlideML2 SlideV2 JSON: {id,title?,background?,children,notes?,metadata?}." },
      },
      required: ["deckPath", "slide"],
    },
  },

  async execute(input) {
    const deckPath = String(input.deckPath || "").trim();
    if (!deckPath) return "Error: deckPath is required.";
    const slide = parseSlideArg(input.slide);
    if (typeof slide === "string") return slide;
    const pendingWrites = getUnvalidatedSlideWrites(deckPath);
    if (pendingWrites >= 2) {
      return [
        "Slide write rejected: validate_render is required after every 1-2 successful slide writes.",
        `This deck already has ${pendingWrites} unvalidated write(s).`,
        "Run validate_render with render=true, then continue authoring.",
      ].join("\n");
    }
    let deck: { slides?: unknown[] } | null = null;
    try {
      deck = await slideml2ReadDeck(deckPath) as { slides?: unknown[] };
    } catch (err) {
      return `Error: insert_slide could not read deck.\n${err instanceof Error ? err.message : String(err)}`;
    }
    const slideCount = Array.isArray(deck?.slides) ? deck.slides.length : 0;
    const targetIndex = resolveInsertIndex(input.index, slideCount);
    if (typeof targetIndex === "string") return targetIndex;
    const path = targetIndex === slideCount ? "/slides/-" : `/slides/${targetIndex}`;
    const patch: Slideml2JsonPatchOp[] = [{ op: "add", path, value: slide as unknown as Record<string, unknown> }];
    try {
      const result = await slideml2PatchDeck(deckPath, patch);
      if (!result.ok) {
        return `Slide insert rejected (deck unchanged): ${result.error}\n${JSON.stringify(result.validation, null, 2)}`;
      }
      const writes = recordSlideWrite(deckPath);
      const validateHint = writes >= 2
        ? "\nNext required action: run validate_render with render=true before any more slide writes."
        : "\nNext action: you may write one more slide, then run validate_render.";
      return `Slide inserted at index ${targetIndex}. slideCount=${result.summary.slideCount}. unvalidatedSlideWrites=${writes}.${validateHint}`;
    } catch (err) {
      return `Error: insert_slide failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },

  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    return rawResult.slice(0, 200);
  },
};

function parseSlideArg(raw: unknown): unknown | string {
  let slide: unknown = raw;
  if (typeof slide === "string") {
    const trimmed = slide.trim();
    if (!trimmed.startsWith("{")) {
      return "Error: slide must be a JSON object (got a non-JSON string).";
    }
    try {
      slide = JSON.parse(trimmed);
    } catch (err) {
      return `Error: slide must be a JSON object. The string passed could not be parsed as JSON (${err instanceof Error ? err.message : String(err)}).`;
    }
  }
  if (slide == null || typeof slide !== "object") return "Error: slide must be a JSON object.";
  return slide;
}

function resolveInsertIndex(raw: unknown, slideCount: number): number | string {
  if (raw === undefined || raw === null || raw === "end") return slideCount;
  if (typeof raw === "string") {
    const n = Number(raw);
    if (!Number.isInteger(n)) return `Error: insert index must be an integer or "end" (got "${raw}").`;
    raw = n;
  }
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    return `Error: insert index must be an integer or "end".`;
  }
  if (raw < 0 || raw > slideCount) {
    return `Error: insert index ${raw} out of range. Valid: 0..${slideCount} (current slideCount=${slideCount}).`;
  }
  return raw;
}
