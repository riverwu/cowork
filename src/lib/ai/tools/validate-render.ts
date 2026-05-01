import type { Tool } from "./types";
import { slideml2ValidateRender } from "@/lib/tauri";

export const validateRenderTool: Tool = {
  definition: {
    name: "validate_render",
    description:
      `Validate the SlideML2 deck and (by default) render it to a .pptx file. Returns:
- schema validation report
- output paths (.pptx + sibling .render-tree.json)
- diagnostics summary by code
- a list of BLOCKING diagnostics that must be fixed before delivery

Blocking diagnostic codes: \`FALLBACK_FAILED\`, \`COLLISION\`, \`TINY_RECT\`, \`SQUASHED\`, \`DROP\`, \`LOW_CONTRAST\`, \`UNKNOWN_COLOR\`, \`UNKNOWN_STYLE\`. Re-author the offending slide via \`replace_slide\` (or fix deck-level via \`patch_deck\`) and re-validate.

Pass \`render: false\` for a fast schema-only dry run during authoring; default is render=true after slides are in place.

Run this AFTER each batch of edits, then iterate from diagnostics. Do not declare the deck done until validate_render returns zero blocking diagnostics.`,
    parameters: {
      type: "object",
      properties: {
        deckPath: { type: "string", description: "Absolute path to the deck JSON file." },
        outputPath: { type: "string", description: "Absolute path for the .pptx output. Defaults to deckPath with .pptx extension when render=true." },
        render: { type: "boolean", description: "Default true. Set false for schema-only validation." },
      },
      required: ["deckPath"],
    },
  },

  async execute(input) {
    const deckPath = String(input.deckPath || "").trim();
    if (!deckPath) return "Error: deckPath is required.";
    const outputPath = typeof input.outputPath === "string" ? input.outputPath : undefined;
    const render = input.render !== false;
    try {
      const result = await slideml2ValidateRender(deckPath, outputPath, render);
      return JSON.stringify(result, null, 2);
    } catch (err) {
      return `Error: validate_render failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },

  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    try {
      const parsed = JSON.parse(rawResult);
      if (parsed.outputPath) {
        const block = parsed.diagnostics?.blockingCount ?? 0;
        return `→ ${parsed.outputPath} (blocking=${block})`;
      }
      return `validation only: ok=${parsed.ok}`;
    } catch {
      return rawResult.slice(0, 200);
    }
  },
};
