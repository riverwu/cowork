import type { Tool } from "./types";
import { slidemlValidate } from "@/lib/tauri";

export const validateSlidemlTool: Tool = {
  definition: {
    name: "validate_slideml",
    description:
      `Dry-run validate a SlideML deck against a theme — no file is written. Cheap; use it after you've drafted a deck (or a single slide) to surface errors before calling \`render_slideml\`.

Two ways to pass the deck:
- \`path\` (preferred when the deck is already on disk, e.g. a .slideml sidecar from a prior render)
- \`slideml\` (inline YAML body)

Returns either { ok: true } or { ok: false, errors: "<one [CODE] message per line>" }.

Useful patterns:
- Iterate on long decks slide-by-slide: validate one slide at a time before assembling the final deck.
- Fix all reported errors in one pass before paying the render cost.`,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to a SlideML YAML file (e.g. <output>.pptx.slideml). Preferred when the deck is already on disk.",
        },
        slideml: {
          type: "string",
          description: "Inline SlideML YAML body (top-level keys: slideml, deck, slides). Use when the deck is not yet on disk.",
        },
        theme: {
          type: "string",
          description: "Theme name. Defaults to 'technical-blue'.",
        },
      },
      // Tool requires AT LEAST one of `path` or `slideml`. JSON Schema can't
      // express that purely; runtime check in execute() handles it. The
      // `required` field stays empty so the registry-shape audit passes.
      required: [],
    },
  },

  async execute(input) {
    const path = (input.path as string | undefined)?.trim();
    const slideml = String(input.slideml || "").trim();
    const theme = (input.theme as string | undefined) || "technical-blue";
    if (!path && !slideml) return "Error: provide either `path` (file) or `slideml` (inline YAML).";
    try {
      // Pass either inline body OR path through to the main-process
      // bridge — file IO must NOT happen in the renderer (no node:fs).
      const result = await slidemlValidate(slideml || null, theme, path);
      if (result.ok) return "OK — deck validates against theme.";
      return `Validation failed:\n${result.errors}`;
    } catch (err) {
      return `Error: validate_slideml failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
