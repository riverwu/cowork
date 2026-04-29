import type { Tool } from "./types";
import { slidemlDescribeTheme } from "@/lib/tauri";

export const describeThemeTool: Tool = {
  definition: {
    name: "describe_theme",
    description:
      `Get FULL detail of one SlideML theme — imagery guidance, palette hex tokens, typography, voice, and the layout list. Call AFTER \`list_themes\` once you've picked a theme; call BEFORE \`image_gen\` so generated cover/background/illustration images stay visually coherent with the deck.

Returns:
- \`palette\`: hex tokens (mention these in image_gen prompts: "deep navy #1E2761 + amber #FFB400")
- \`typography.headingFamily\` / \`bodyFamily\`: feed into typographic image briefs
- \`imagery.guidance\`: paste verbatim into image_gen \`prompt\` (one-paragraph brief)
- \`imagery.preferredStyles\`: include in prompt ("photographic, cinematic")
- \`imagery.avoid\`: pass as negative cues ("no cartoon, no bright pastels")
- \`voice.tone\`: shape slide text wording (titles, takeaways)
- \`layouts\`: layout names this theme provides (a subset of the 17-layout master list)

Pattern when generating a deck with imagery:
  1. \`list_themes\` → pick by audience/industry/mood
  2. \`describe_theme(name)\` → get imagery guidance + palette
  3. \`image_gen\` with prompts that include the imagery guidance verbatim AND mention the palette hex codes
  4. \`render_slideml\` referencing the generated images by absolute path`,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Theme name from list_themes (e.g. 'midnight-executive')." },
      },
      required: ["name"],
    },
  },

  async execute(input) {
    const name = String(input.name || "").trim();
    if (!name) return "Error: name is required.";
    try {
      const detail = await slidemlDescribeTheme(name);
      return JSON.stringify(detail, null, 2);
    } catch (err) {
      return `Error: describe_theme failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },

  // History compression: theme details (palette, imagery guidance, voice) are
  // load-bearing on the call turn but pure noise once images are generated.
  // Keep just name + layout count so the agent remembers which theme it picked.
  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    try {
      const detail = JSON.parse(rawResult) as {
        name?: string;
        displayName?: string;
        layouts?: unknown[];
      };
      const layoutCount = Array.isArray(detail.layouts) ? detail.layouts.length : 0;
      return `→ ${detail.name ?? "?"} (${detail.displayName ?? ""}, ${layoutCount} layouts)`;
    } catch {
      return rawResult.slice(0, 200);
    }
  },
};
