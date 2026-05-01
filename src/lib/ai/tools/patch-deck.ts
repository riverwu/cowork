import type { Tool } from "./types";
import { slideml2PatchDeck, type Slideml2JsonPatchOp } from "@/lib/tauri";

export const patchDeckTool: Tool = {
  definition: {
    name: "patch_deck",
    description:
      `Apply RFC6902-style JSON Patch ops to the deck for **deck-level edits** (theme tokens, palette, brand, chrome, footer, header) and **structural slide ops** (reorder, delete, append at \`/slides/-\`). For substantive slide content changes, prefer \`replace_slide\` — it validates the whole slide.

Common deck-level paths:
- \`/deck/themeOverride/colors/brand.primary\`
- \`/deck/themeOverride/text/slide-title/fontSize\`
- \`/deck/themeOverride/component/card/padding\`
- \`/deck/themeOverride/layout/defaultGap\`
- \`/deck/themeOverride/chrome/brandMark\`
- \`/deck/brand/logo\`

Slide-level structural paths:
- \`/slides/-\` (append slide; value = full SlideV2 JSON)
- \`/slides/0\` (replace slide at index 0 — but prefer \`replace_slide\` for this)
- remove \`/slides/3\` (delete slide at index 3)
- move \`/slides/3\` → \`/slides/1\` (reorder)

The tool validates the patched deck before writing. If the patch breaks schema invariants the deck file is left unchanged and the validation errors are returned.`,
    parameters: {
      type: "object",
      properties: {
        deckPath: { type: "string" },
        patch: {
          type: "array",
          items: { type: "object" },
          description: "Array of {op, path, value?, from?} entries. op ∈ add|replace|remove|move|copy|test.",
        },
      },
      required: ["deckPath", "patch"],
    },
  },

  async execute(input) {
    const deckPath = String(input.deckPath || "").trim();
    if (!deckPath) return "Error: deckPath is required.";
    if (!Array.isArray(input.patch)) return "Error: patch must be an array of JSON Patch ops.";
    try {
      const result = await slideml2PatchDeck(deckPath, input.patch as Slideml2JsonPatchOp[]);
      if (!result.ok) {
        return `Patch rejected (deck unchanged): ${result.error}\n${JSON.stringify(result.validation, null, 2)}`;
      }
      return `Patch applied. slideCount=${result.summary.slideCount}.`;
    } catch (err) {
      return `Error: patch_deck failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },

  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    return rawResult.slice(0, 200);
  },
};
