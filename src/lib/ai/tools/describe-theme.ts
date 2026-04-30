import type { Tool } from "./types";
import { slidemlDescribeTheme } from "@/lib/tauri";

export const describeThemeTool: Tool = {
  definition: {
    name: "describe_theme",
    description:
      `Get FULL detail of one SlideML theme — imagery guidance, palette hex tokens, typography, voice, chrome, and the ContentComponent list. Call AFTER \`list_themes\` once you've picked a theme; call BEFORE \`image_gen\` so generated cover/background/illustration images stay visually coherent with the deck.

Use this as the source material for theme customization. To create a new theme, copy the useful fields into a new \`theme.json\` written with \`write_file\` under \`~/.cowork/themes/<new-name>/theme.json\`, then set \`deck.theme\` to \`<new-name>\`. Theme packages can define tokens/colors, font stacks, typography, surfaces/cards, dataviz palette, imagery guidance, voice, chrome modules, and OOXML scheme overrides.

Returns:
- \`palette\`: hex tokens (mention these in image_gen prompts: "deep navy #1E2761 + amber #FFB400")
- \`typography.headingFamily\` / \`bodyFamily\`: feed into typographic image briefs
- \`imagery.guidance\`: paste verbatim into image_gen \`prompt\` (one-paragraph brief)
- \`imagery.preferredStyles\`: include in prompt ("photographic, cinematic")
- \`imagery.avoid\`: pass as negative cues ("no cartoon, no bright pastels")
- \`voice.tone\`: shape slide text wording (titles, takeaways)
- \`contentComponents\`: ContentComponent names this theme exposes; use these as \`regions.*.component\`

Pattern when generating a deck with imagery:
  1. \`list_themes\` → pick by audience/industry/mood
  2. \`describe_theme(name)\` → get imagery guidance + palette
  3. \`image_gen\` with prompts that include the imagery guidance verbatim AND mention the palette hex codes
  4. \`render_slideml\` referencing the generated images by absolute path

Pattern when creating a custom theme:
  1. \`list_themes\` → choose a close base
  2. \`describe_theme(base)\` → inspect tokens, fonts, style, chrome, imagery
  3. \`write_file(path: "~/.cowork/themes/<name>/theme.json", ...)\` with the new theme manifest
  4. Use \`deck.theme: "<name>"\` in SlideML and validate/render`,
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
      const normalized = normalizeThemeDetailForAgent(detail);
      return JSON.stringify(normalized, null, 2);
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
        contentComponents?: unknown[];
      };
      const componentCount = Array.isArray(detail.contentComponents) ? detail.contentComponents.length : 0;
      return `→ ${detail.name ?? "?"} (${detail.displayName ?? ""}, ${componentCount} ContentComponents)`;
    } catch {
      return rawResult.slice(0, 200);
    }
  },
};

function normalizeThemeDetailForAgent(detail: unknown): unknown {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return detail;
  const obj = { ...(detail as Record<string, unknown>) };
  if ("layouts" in obj && !("contentComponents" in obj)) {
    obj.contentComponents = obj.layouts;
    delete obj.layouts;
  }
  return obj;
}
