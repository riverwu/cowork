import type { Tool } from "./types";
import { slidemlCompile } from "@/lib/tauri";

export const renderSlidemlTool: Tool = {
  definition: {
    name: "render_slideml",
    description:
      `Compile a SlideML YAML body to a .pptx file using a theme's typed layouts. PREFERRED over hand-rolled pptxgenjs.

Workflow:
1. \`list_slide_layouts\` → pick 4–6 layouts you'll use.
2. \`describe_slide_layout(name)\` for each pick → read the slot schema and the inline example payloads.
3. (Optional) \`validate_slideml\` to dry-run the YAML before paying the render cost.
4. \`render_slideml\` writes BOTH the .pptx AND a sibling \`<output_path>.slideml\` source-of-truth file. The sidecar lets you (or a future call) edit slides without re-emitting from scratch.
5. On a validation failure, the error names the offending slot — fix it and retry.

Top-level grammar:
\`\`\`yaml
slideml: 1
deck:
  size: 16x9            # 16x9 | 16x10 | 4x3 | wide
  language: zh-CN       # drives CJK font fallback
  theme: technical-blue
slides:
  - layout: <name>      # from list_slide_layouts
    chrome: default     # default | none
    notes: |            # speaker notes — recommended on every content slide
      ...
    slots:              # per-layout, schema-validated
      title: "..."
      items: [...]
\`\`\`

Hard rules:
- NEVER put coordinates, hex colors, or font sizes in the YAML — those belong to the theme.
- Match each layout's slot schema exactly. Get the precise shape via \`describe_slide_layout\`.
- For Chinese decks, set \`deck.language: zh-CN\` so the CJK font stack kicks in.`,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to a SlideML YAML file. Preferred when the deck is already on disk (e.g. iterating on a previously-rendered .slideml sidecar).",
        },
        slideml: {
          type: "string",
          description: "Inline SlideML YAML document. Use when the deck isn't on disk yet.",
        },
        theme: {
          type: "string",
          description: "Theme name (e.g. 'technical-blue') or absolute path to a theme directory. Defaults to 'technical-blue'.",
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
    const theme = (input.theme as string | undefined) || "technical-blue";

    if (!inputPath && !slideml) return "Error: provide either `path` (file) or `slideml` (inline YAML).";
    if (!outputPath) return "Error: output_path (absolute) is required.";

    try {
      // Pass either inline body OR path; the main-process bridge reads
      // the file. Renderer can't import node:fs (Vite browser bundle).
      const result = await slidemlCompile(slideml || null, theme, outputPath, inputPath);
      // Sidecar is editable: any future call can read it as the
      // source-of-truth and apply edit_slideml ops without re-emitting
      // the whole YAML. Mention this explicitly so follow-up turns find
      // it.
      return `SlideML compiled to ${result.outputPath}. Theme: ${theme}. ` +
        `Editable source written to ${result.sidecar} — use edit_slideml for follow-up changes.`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error: render_slideml failed.\n${msg}`;
    }
  },
};
