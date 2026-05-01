import type { Tool } from "./types";
import { slideml2CreateDeck } from "@/lib/tauri";

export const createDeckTool: Tool = {
  definition: {
    name: "create_deck",
    description:
      `Create a fresh SlideML2 source deck JSON file at \`deckPath\`. Use once at the start of a deck task; the JSON is the source of truth.

The deck-level visual identity should be installed in this initial call via \`themeOverride\`: pass colors (\`brand.primary\`, \`background\`, \`surface\`, \`text.primary\`, ...), text styles (\`slide-title\`, \`paragraph\`, \`metric-value\`), component tuning (\`card\`, \`panel\`), layout (\`pageMarginX\`, \`defaultGap\`), fonts, and chrome (\`brandMark\`, \`pageNumber\`). Read SLIDEML.md for the style brief structure to derive these from the source content.

After this call, add slides via \`replace_slide\` (when slideId equals current slide count, it appends) and refine deck-level fields via \`patch_deck\`.`,
    parameters: {
      type: "object",
      properties: {
        deckPath: { type: "string", description: "Absolute path for the deck JSON file (e.g. /abs/path/deck.json)." },
        title: { type: "string", description: "Deck title; sets initial deck.title." },
        theme: { type: "string", description: "Base theme scaffold name. Default 'default' (a neutral theme; use themeOverride to install a real visual identity)." },
        brand: {
          type: "object",
          description: "Brand identity.",
          properties: {
            name: { type: "string" },
            primary: { type: "string", description: "6-char hex without #." },
            logo: { type: "string", description: "Absolute path or URL." },
          },
        },
        themeOverride: {
          type: "object",
          description: "Deck.themeOverride installed immediately: colors, text, component, layout, fonts, chart, chrome, sizeScale, guidance.",
        },
      },
      required: ["deckPath"],
    },
  },

  async execute(input) {
    const deckPath = String(input.deckPath || "").trim();
    if (!deckPath) return "Error: deckPath is required.";
    try {
      const result = await slideml2CreateDeck(deckPath, {
        title: typeof input.title === "string" ? input.title : undefined,
        theme: typeof input.theme === "string" ? input.theme : undefined,
        brand: input.brand && typeof input.brand === "object" ? input.brand as never : undefined,
        themeOverride: input.themeOverride,
      });
      return `Deck created at ${result.deckPath}. Add slides via replace_slide (slideId = current slide count appends).`;
    } catch (err) {
      return `Error: create_deck failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },

  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    const m = /created at (\S+)/.exec(rawResult);
    return m ? `→ deck ${m[1]}` : rawResult.slice(0, 160);
  },
};
