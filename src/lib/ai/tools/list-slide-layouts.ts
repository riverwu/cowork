import type { Tool } from "./types";
import { slidemlListLayouts } from "@/lib/tauri";

export const listSlideLayoutsTool: Tool = {
  definition: {
    name: "list_slide_layouts",
    description:
      `List the slide layouts a SlideML theme exposes — name + one-line purpose + slot names only (compact).

CALL THIS FIRST when planning a deck. After picking 4–6 layouts you actually need, call \`describe_slide_layout(name)\` for each to get the full slot schema with example payloads.

Returns an array of layout summaries:
- \`name\`: layout id used in your SlideML \`layout:\` field
- \`purpose\`: one-sentence guidance for when to pick this layout
- \`requiredSlots\`: slot names that MUST be filled
- \`optionalSlots\`: slot names that may be filled

Built-in theme: \`technical-blue\` (the default if you omit \`theme\`).`,
    parameters: {
      type: "object",
      properties: {
        theme: {
          type: "string",
          description: "Theme name (e.g. 'technical-blue') or absolute path to a theme directory. Defaults to 'technical-blue'.",
        },
      },
      required: [],
    },
  },

  async execute(input) {
    const theme = (input.theme as string | undefined) || "technical-blue";
    try {
      const summaries = await slidemlListLayouts(theme);
      return JSON.stringify(summaries, null, 2);
    } catch (err) {
      return `Error: list_slide_layouts failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
