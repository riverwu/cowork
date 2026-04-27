import type { Tool } from "./types";
import { slidemlValidate } from "@/lib/tauri";

export const validateSlidemlTool: Tool = {
  definition: {
    name: "validate_slideml",
    description:
      `Dry-run validate a SlideML YAML body against a theme — no file is written. Cheap; use it after you've drafted a deck (or a single slide) to surface errors before calling \`render_slideml\`.

Returns either { ok: true } or { ok: false, errors: "<one [CODE] message per line>" }.

Useful patterns:
- Iterate on long decks slide-by-slide: validate one slide at a time before assembling the final deck.
- Fix all reported errors in one pass before paying the render cost.`,
    parameters: {
      type: "object",
      properties: {
        slideml: {
          type: "string",
          description: "Full SlideML YAML body (top-level keys: slideml, deck, slides).",
        },
        theme: {
          type: "string",
          description: "Theme name. Defaults to 'technical-blue'.",
        },
      },
      required: ["slideml"],
    },
  },

  async execute(input) {
    const slideml = String(input.slideml || "").trim();
    const theme = (input.theme as string | undefined) || "technical-blue";
    if (!slideml) return "Error: slideml YAML body is required.";
    try {
      const result = await slidemlValidate(slideml, theme);
      if (result.ok) return "OK — deck validates against theme.";
      return `Validation failed:\n${result.errors}`;
    } catch (err) {
      return `Error: validate_slideml failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
