import type { Tool } from "./types";
import { slidemlValidate, readFileText } from "@/lib/tauri";

/** See render-slideml.ts for rationale. Same regex peek for `deck.theme`. */
function extractDeckTheme(body: string): string | undefined {
  const m = /(?:^|[\s,{])"?theme"?\s*:\s*["']?([A-Za-z0-9_./-]+)["']?/.exec(body);
  return m?.[1];
}

export const validateSlidemlTool: Tool = {
  definition: {
    name: "validate_slideml",
    description:
      `Dry-run validate a SlideML deck against a theme — no file is written. Cheap; use it after you've drafted a deck (or a single slide) to surface errors before calling \`render_slideml\`.

**JSON ONLY for inline input.** Pass JSON via \`slideml:\`, or a file path via \`path:\` (file may be JSON or YAML — back-compat). YAML inline is rejected at the tool layer (high agent error rate on quoting / indentation).

Two ways to pass the deck:
- \`path\` (preferred when the deck is already on disk, e.g. a .slideml sidecar from a prior render or one built incrementally via \`append_slides\`)
- \`slideml\` (inline JSON body)

Returns either { ok: true } or { ok: false, errors: "<one [CODE] message per line>" }.

Useful patterns:
- For long decks: build with \`write_file\` skeleton + \`append_slides\` batches, then validate the on-disk file via \`path:\`.
- Fix all reported errors in one pass before paying the render cost.`,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to a SlideML source file (YAML or JSON — auto-detected; e.g. <output>.pptx.slideml). Preferred when the deck is already on disk.",
        },
        slideml: {
          type: "string",
          description: "Inline SlideML body — JSON ONLY (must start with `{`). Inline YAML rejected at the tool layer.",
        },
        theme: {
          type: "string",
          description: "OPTIONAL. Auto-detected from the deck's `deck.theme` field when unset (recommended). Pass explicitly only to OVERRIDE.",
        },
      },
      // Tool requires AT LEAST one of `path` or `slideml`. JSON Schema can't
      // express that purely; runtime check in execute() handles it. The
      // `required` field stays empty so the registry-shape audit passes.
      required: [],
    },
  },

  // History compression: success collapses to "OK". Failures stay full —
  // validator output (DENSITY_OVERFLOW / SLOT_TYPE_MISMATCH / hint:) is
  // load-bearing for the agent's next-turn fix.
  historySummarizer(rawResult, status) {
    if (status === "fail" || rawResult.startsWith("Validation failed")) return rawResult;
    return "OK";
  },

  async execute(input) {
    const path = (input.path as string | undefined)?.trim();
    const slideml = String(input.slideml || "").trim();
    const explicitTheme = (input.theme as string | undefined)?.trim();
    if (!path && !slideml) return "Error: provide either `path` (file) or `slideml` (inline JSON body).";
    // Enforce JSON-only on the inline path (file path stays back-compat).
    if (slideml) {
      const firstChar = slideml.replace(/^\uFEFF/, "").trimStart()[0];
      if (firstChar !== "{" && firstChar !== "[") {
        return `Error: inline \`slideml\` must be JSON (must start with \`{\`). Inline YAML is no longer accepted (high agent error rate). Either rewrite as JSON, or write to a file via \`write_file\` and pass via \`path:\`.`;
      }
    }

    // Auto-detect theme from deck.theme when not passed — same logic as
    // render_slideml. Avoids the high-frequency THEME_NAME_MISMATCH where
    // the deck declares one theme but the tool defaulted to another.
    let theme = explicitTheme || "technical-blue";
    if (!explicitTheme) {
      try {
        const body = slideml || (path ? await readFileText(path) : "");
        const declared = extractDeckTheme(body);
        if (declared) theme = declared;
      } catch {
        // peek failed — fall back to default; underlying call will error if path is bad.
      }
    }

    try {
      // Pass either inline body OR path through to the main-process
      // bridge — file IO must NOT happen in the renderer (no node:fs).
      const result = await slidemlValidate(slideml || null, theme, path);
      if (result.ok) return "OK — deck validates against theme.";
      // The CLI's stderr already begins with "Validation failed:\n" so
      // we don't add another prefix (was double-printed before).
      const body = result.errors || "(validator returned no error text)";
      return body.startsWith("Validation failed") ? body : `Validation failed:\n${body}`;
    } catch (err) {
      return `Error: validate_slideml failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
