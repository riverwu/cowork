import type { Tool } from "./types";
import { slidemlCompile, readFileText } from "@/lib/tauri";

/**
 * Pull `deck.theme` out of a SlideML body without doing a full YAML
 * parse. Tolerant of both JSON and YAML on the same regex — both have
 * the shape `theme: <value>` with the value being either an unquoted
 * identifier (YAML), a single-quoted string, or a double-quoted string
 * (JSON or YAML quoted form). Returns undefined if not found.
 *
 * Why peek instead of full parse: the parser lives in the slideml
 * package which the cowork renderer can't import directly (different
 * runtime — Vite browser vs Node main-process). A regex peek avoids
 * dragging the whole parse path into the renderer just to extract one
 * field.
 */
function extractDeckTheme(body: string): string | undefined {
  const m = /(?:^|[\s,{])"?theme"?\s*:\s*["']?([A-Za-z0-9_./-]+)["']?/.exec(body);
  return m?.[1];
}

export const renderSlidemlTool: Tool = {
  definition: {
    name: "render_slideml",
    description:
      `Compile a SlideML deck to a .pptx file using a theme's typed layouts. PREFERRED over hand-rolled pptxgenjs.

**JSON ONLY for inline input.** Pass the deck as JSON via \`slideml:\`, or pass a file path via \`path:\` (file may be JSON or YAML — back-compat for existing sidecars). YAML inline is rejected at the tool layer because agents reproducibly trip on YAML pitfalls (indentation drift, nested-quote conflicts in CJK content like \`"罢黜百家"\`, \`{...}\` flow-mapping ambiguity, multi-line scalar markers \`|\`/\`>\`, implicit type coercion).

**For decks with > 5 slides, USE THE CHUNKED WORKFLOW** to avoid LLM-stream-terminated failures on huge tool calls:
1. \`write_file\` a deck SKELETON: \`{"slideml":1,"deck":{...},"slides":[]}\`
2. \`append_slides(path, [slide1, slide2, slide3])\` — repeat in batches of 2-4
3. \`render_slideml(path: ...)\` — render the assembled file

Workflow:
1. \`list_slide_layouts\` → pick 4–6 layouts you'll use.
2. \`describe_slide_layout(name)\` for each pick → read the slot schema and the inline example payloads.
3. (Optional) \`validate_slideml\` to dry-run before paying the render cost.
4. \`render_slideml\` writes BOTH the .pptx AND a sibling \`<output_path>.slideml\` (YAML) source-of-truth file. The sidecar lets you (or a future call) edit slides without re-emitting from scratch.
5. On a validation failure, the error names the offending slot — fix it and retry.

Top-level grammar (JSON form, recommended):
\`\`\`json
{
  "slideml": 1,
  "deck": {
    "size": "16x9",
    "language": "zh-CN",
    "theme": "technical-blue"
  },
  "slides": [
    {
      "layout": "cover",
      "slots": {
        "title": "中国历史",
        "subtitle": "汉武帝采纳\\"罢黜百家\\"的政策"
      }
    },
    {
      "layout": "prose",
      "slots": {
        "title": "第一章",
        "body": "段落一文本。\\n\\n段落二文本，可以含\\"嵌套引号\\"无需转外层。"
      }
    }
  ]
}
\`\`\`

Hard rules (apply to BOTH JSON and YAML):
- NEVER put coordinates, hex colors, or font sizes in the deck — those belong to the theme.
- Match each layout's slot schema exactly. Get the precise shape via \`describe_slide_layout\`.
- For Chinese decks, set \`deck.language: "zh-CN"\` so the CJK font stack kicks in.
- **Within a single paragraph (a text-block value), do NOT insert \`\\n\` mid-sentence for cosmetic line wrapping.** The renderer turns each \`\\n\` into a hard line break and wastes vertical space. Use \`\\n\\n\` (a blank line) ONLY between distinct paragraphs. The renderer wraps long sentences automatically.

JSON-specific notes (since you should be using JSON):
- Multi-line content goes in one string with \`\\n\\n\` between paragraphs. No \`|\` / \`>\` markers needed.
- Inner ASCII \`"\` escape as \`\\"\`. Inner \`\\\` escape as \`\\\\\`. Newlines as \`\\n\`. Tabs as \`\\t\`.
- No trailing commas. No unquoted keys. No comments (use a separate \`notes\` slot if needed).

YAML-only fallback rules (only if you really insist on YAML — JSON is safer):
- Values containing \`{\`, \`}\`, \`[\`, \`]\`, ASCII \`:\`, \`#\`, or that span multiple lines MUST be wrapped in double quotes — or use \`|\` / \`>\` for multi-line block scalars.
- If your value contains ASCII \`"\` (CJK emphasis pattern: \`"罢黜百家"\`), pick one: escape inner \`\\"\`; outer single quotes; inner Chinese curly quotes \`\u201C\u201D\`; or block scalar \`body: |\`.`,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to a SlideML source file (YAML or JSON — the parser auto-detects). Preferred when the deck is already on disk (e.g. iterating on a previously-rendered .slideml sidecar).",
        },
        slideml: {
          type: "string",
          description: "Inline SlideML document — JSON ONLY (must start with `{`). Inline YAML is rejected at the tool layer (use the `path:` arg if you have a YAML file).",
        },
        theme: {
          type: "string",
          description: "OPTIONAL. Theme name (e.g. 'technical-blue') or absolute path to a theme directory. **Leave unset and the tool auto-detects from the deck's own `deck.theme` field** — that's the recommended path (single source of truth). Only pass explicitly to OVERRIDE the deck's declared theme.",
        },
        output_path: {
          type: "string",
          description: "Absolute path where the .pptx file should be written. A sibling \`<output_path>.slideml\` source file is written alongside.",
        },
      },
      required: ["output_path"],
    },
  },

  async execute(input) {
    const inputPath = (input.path as string | undefined)?.trim();
    const slideml = String(input.slideml || "").trim();
    const outputPath = String(input.output_path || "").trim();
    const explicitTheme = (input.theme as string | undefined)?.trim();

    if (!inputPath && !slideml) return "Error: provide either `path` (file) or `slideml` (inline JSON body).";
    if (!outputPath) return "Error: output_path (absolute) is required.";
    // Enforce JSON-only on the inline path. File path is exempt — sidecars
    // on disk may still be YAML for back-compat (the renderer auto-detects).
    if (slideml) {
      const firstChar = slideml.replace(/^\uFEFF/, "").trimStart()[0];
      if (firstChar !== "{" && firstChar !== "[") {
        return `Error: inline \`slideml\` must be JSON (must start with \`{\`). YAML inline is no longer accepted because of high agent error rates (indentation, nested quotes, multi-line scalars). Either rewrite as JSON, or write your YAML to a file via \`write_file\` and pass via \`path:\`.`;
      }
    }

    // Auto-detect theme from the deck's own `deck.theme` field when the
    // caller didn't pass `theme:` explicitly. Avoids the high-frequency
    // mismatch where the deck declares `theme: "charcoal-minimal"` but
    // the tool defaulted the renderer to `technical-blue` and validation
    // failed with THEME_NAME_MISMATCH. Explicit `theme:` argument still
    // wins when supplied.
    let theme = explicitTheme || "technical-blue";
    let themeSource = explicitTheme ? "explicit" : "default";
    if (!explicitTheme) {
      try {
        const body = slideml || (inputPath ? await readFileText(inputPath) : "");
        const declared = extractDeckTheme(body);
        if (declared) {
          theme = declared;
          themeSource = "deck";
        }
      } catch {
        // peek failed — fall back to default; renderer will surface a
        // clearer error if the deck/file is genuinely unreadable.
      }
    }

    try {
      // Pass either inline body OR path; the main-process bridge reads
      // the file. Renderer can't import node:fs (Vite browser bundle).
      const result = await slidemlCompile(slideml || null, theme, outputPath, inputPath);
      // Sidecar is editable: any future call can read it as the
      // source-of-truth and apply edit_slideml ops without re-emitting
      // the whole YAML. Mention this explicitly so follow-up turns find
      // it.
      const themeNote = themeSource === "deck"
        ? `Theme: ${theme} (auto-detected from deck.theme).`
        : `Theme: ${theme}.`;
      return `SlideML compiled to ${result.outputPath}. ${themeNote} ` +
        `Editable source written to ${result.sidecar} — use edit_slideml for follow-up changes.`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error: render_slideml failed.\n${msg}`;
    }
  },

  // History compression: keep both the .pptx output path and the .slideml
  // sidecar path — agents reference the sidecar for follow-up edits.
  // Failures stay full (validator output is precious for fix-and-retry).
  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    const out = /compiled to (\S+)/.exec(rawResult);
    const side = /source written to (\S+)/.exec(rawResult);
    if (out && side) return `→ ${out[1]} (sidecar: ${side[1]})`;
    return rawResult.slice(0, 200);
  },
};
