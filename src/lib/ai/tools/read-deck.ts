import type { Tool } from "./types";
import { slideml2ReadDeck } from "@/lib/tauri";

export const readDeckTool: Tool = {
  definition: {
    name: "read_deck",
    description:
      `Read the current SlideML2 deck JSON from disk. Use before targeted edits or after validation/render failures to inspect the exact structure.

For a deck with many slides, this returns the entire deck JSON; if you only need to repair one slide flagged by validate_render, prefer reading slide N from the validation message and re-emitting that one slide via replace_slide.`,
    parameters: {
      type: "object",
      properties: {
        deckPath: { type: "string", description: "Absolute path to the deck JSON file." },
      },
      required: ["deckPath"],
    },
  },

  async execute(input) {
    const deckPath = String(input.deckPath || "").trim();
    if (!deckPath) return "Error: deckPath is required.";
    try {
      const deck = await slideml2ReadDeck(deckPath);
      return JSON.stringify(deck, null, 2);
    } catch (err) {
      return `Error: read_deck failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
