import type { Tool } from "./types";
import { slidemlListContentComponents } from "@/lib/tauri";

export const listContentComponentsTool: Tool = {
  definition: {
    name: "list_content_components",
    description:
      `List the SlideML ContentComponents a theme exposes — name + one-line purpose + prop names only (compact).

Call this after choosing PagePatterns. After picking the components you actually need, call \`describe_content_component(name)\` for each to get the full props schema with example payloads.

Returns an array of component summaries:
- \`name\`: component id used in \`slides[].regions.<region>.component\`
- \`purpose\`: one-sentence guidance for when to pick this component
- \`requiredSlots\`: prop names that MUST be filled
- \`optionalSlots\`: prop names that may be filled

SlideML source uses \`pattern + regions + component + props\`, for example:
\`{ "pattern": "single-focus", "regions": { "main": { "component": "timeline", "props": { ... } } } }\`.

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
      const summaries = await slidemlListContentComponents(theme);
      return JSON.stringify(summaries, null, 2);
    } catch (err) {
      return `Error: list_content_components failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },

  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    try {
      const arr = JSON.parse(rawResult) as Array<{ name?: string }>;
      return `→ ${arr.length} ContentComponents (${arr.map((c) => c.name).filter(Boolean).join(", ")})`;
    } catch {
      return rawResult.slice(0, 200);
    }
  },
};
