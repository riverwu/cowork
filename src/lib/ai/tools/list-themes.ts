import type { Tool } from "./types";
import { slidemlListThemes } from "@/lib/tauri";

export const listThemesTool: Tool = {
  definition: {
    name: "list_themes",
    description:
      `List the SlideML themes installed on this machine (built-in + user-installed). Use this when the user asks for a deck and you want to pick a theme that fits the topic, or when the user mentions a deck mood ("warm", "minimal", "executive", "sustainability") that suggests a non-default theme.

Returns an array of theme summaries:
- \`name\`: id to pass to other deck tools (\`render_slideml({ theme: ... })\`)
- \`displayName\`: human-friendly name
- \`description\`: one-line summary of the theme's character
- \`whenToUse\`: short note on when this theme is appropriate
- \`source\`: "builtin" or "user"

Default theme is \`technical-blue\` (engineering / data). If you don't call this tool, that's what \`render_slideml\` will use.`,
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  async execute() {
    try {
      const themes = await slidemlListThemes();
      return JSON.stringify(themes, null, 2);
    } catch (err) {
      return `Error: list_themes failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },

  // History compression: list_themes returns ~6KB JSON. Once the agent
  // has picked a theme, the picked name lives in the deck YAML — the
  // catalog is throwaway. Collapse to one-line "saw N themes" reminder.
  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    try {
      const arr = JSON.parse(rawResult) as Array<{ name?: string }>;
      const names = arr.map((t) => t.name).filter(Boolean).join(", ");
      return `→ ${arr.length} themes: ${names}`;
    } catch {
      return rawResult.slice(0, 120);
    }
  },
};
