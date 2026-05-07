import type { Tool } from "./types";
import { slideml2ReadDeck } from "@/lib/tauri";
import { clearDeckReadRequirement } from "./slideml2-authoring-state";

export const readDeckTool: Tool = {
  definition: {
    name: "read_deck",
    description:
      `Read the current SlideML2 deck JSON from disk. Use before targeted edits or after validation/render failures to inspect the exact structure.

For a deck with many slides, pass \`slideId\` to read only the slide you need to repair. After \`validate_render\` returns ok:false, prefer calling this before \`replace_slide\` or \`patch_deck\` so repairs are based on the current source JSON rather than memory.`,
    parameters: {
      type: "object",
      properties: {
        deckPath: { type: "string", description: "Absolute path to the deck JSON file." },
        slideId: { description: "Optional slide id or 0-based index. Use this to read only the slide flagged by diagnostics." },
      },
      required: ["deckPath"],
    },
  },

  async execute(input) {
    const deckPath = String(input.deckPath || "").trim();
    if (!deckPath) return "Error: deckPath is required.";
    try {
      const deck = await slideml2ReadDeck(deckPath);
      clearDeckReadRequirement(deckPath);
      return JSON.stringify(selectDeckReadResult(deckPath, deck, input.slideId), null, 2);
    } catch (err) {
      return `Error: read_deck failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

function selectDeckReadResult(deckPath: string, deck: unknown, slideId: unknown): unknown {
  if (slideId == null || slideId === "") return deck;
  const record = deck && typeof deck === "object" ? deck as { slides?: unknown[] } : {};
  const slides = Array.isArray(record.slides) ? record.slides : [];
  const normalized = normalizeSlideId(slideId);
  const index = typeof normalized === "number"
    ? normalized
    : slides.findIndex((slide) => slide && typeof slide === "object" && (slide as { id?: unknown }).id === normalized);
  if (index < 0 || index >= slides.length) {
    return { deckPath, slideCount: slides.length, error: `Slide not found: ${String(slideId)}` };
  }
  return { deckPath, slideCount: slides.length, index, slide: slides[index] };
}

function normalizeSlideId(value: unknown): string | number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return String(value || "");
}
