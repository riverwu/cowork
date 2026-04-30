import type { Tool } from "./types";
import { readFileText, slidemlEdit, type SlidemlEditOp } from "@/lib/tauri";

/**
 * Lightweight `deck.theme` peek for JSON/YAML sidecars. This mirrors
 * render_slideml's auto-detect behavior so edits keep the deck's declared
 * theme as the source of truth.
 */
function extractDeckTheme(body: string): string | undefined {
  const m = /(?:^|[\s,{])"?theme"?\s*:\s*["']?([A-Za-z0-9_./-]+)["']?/.exec(body);
  return m?.[1];
}

function themeFromOps(ops: SlidemlEditOp[]): string | undefined {
  for (const op of ops) {
    if (op.kind === "set" && op.path === "deck.theme" && typeof op.value === "string" && op.value.trim()) {
      return op.value.trim();
    }
  }
  return undefined;
}

export const editSlidemlTool: Tool = {
  definition: {
    name: "edit_slideml",
    description:
      `Apply structured edits to an existing deck's sidecar source (.slideml) and recompile to .pptx. Use this for follow-up edits to an already-rendered SlideML deck, especially theme/style/chrome changes. Cheaper and more reliable than re-emitting the whole deck.

Use after a previous \`render_slideml\` produced a deck and the user (or you) want to mutate it. Reads the sidecar at \`sidecar_path\` (typically \`<output>.pptx.slideml\`), applies the ops in order, then writes BOTH the new .pptx at \`output_path\` AND a refreshed sidecar at \`<output_path>.slideml\`.

Natural-language routing:
- "把 PPT 主题换成红色/商务/极简/暖色" → use this tool on the existing \`<pptx>.slideml\`, not raw pptx editing.
- "换主题" → \`list_themes\` if a built-in theme fits, or set \`deck.palette.*\` / create a user theme when the request is a color variant.
- "改页眉/页脚/logo/chrome/字体/颜色" → set \`deck.header\`, \`deck.footer\`, \`deck.brand\`, \`deck.chrome\`, \`deck.fonts\`, \`deck.palette\`, then recompile.

Op grammar (paths use dot-bracket notation: \`slides[3].regions.main.props.title\`, \`deck.header.left\`, \`slides[0].regions.main.props.items[2]\`):
- \`{ kind: "set", path: "slides[3].regions.main.props.title", value: "..." }\`
- \`{ kind: "set", path: "deck.theme", value: "vibrant-startup" }\`
- \`{ kind: "set", path: "deck.palette.brand-primary", value: "B91C1C" }\`
- \`{ kind: "set", path: "deck.palette.accent", value: "DC2626" }\`
- \`{ kind: "set", path: "deck.chrome", value: ["page-header", "page-footer", "brand-mark"] }\`
- \`{ kind: "delete", path: "slides[2].notes" }\`
- \`{ kind: "insertSlide", at: 4, slide: { pattern: "...", regions: {...} } }\`
- \`{ kind: "deleteSlide", at: 3 }\`
- \`{ kind: "moveSlide", from: 4, to: 1 }\`

Indexes are 0-based. \`output_path\` may be the same as the original (overwrites in place).

Important for theme changes: when you set \`deck.theme\` to a different theme, also pass the same theme name in this tool's \`theme\` argument so validation/rendering uses the new theme immediately. For palette-only color changes, leave \`deck.theme\` unchanged and set \`deck.palette.*\` tokens.`,
    parameters: {
      type: "object",
      properties: {
        sidecar_path: { type: "string", description: "Absolute path to the .slideml sidecar (typically <pptx>.slideml)." },
        ops: {
          type: "array",
          description: "Array of edit operations to apply in order.",
          items: { type: "object" },
        },
        output_path: { type: "string", description: "Absolute path where the recompiled .pptx is written." },
        theme: {
          type: "string",
          description: "OPTIONAL. Theme name or absolute path to a theme directory. Leave unset and the tool auto-detects from the sidecar's own `deck.theme` field. If ops change `deck.theme`, pass the NEW theme here too.",
        },
      },
      required: ["sidecar_path", "ops", "output_path"],
    },
  },

  async execute(input) {
    const sidecarPath = String(input.sidecar_path || "").trim();
    const outputPath = String(input.output_path || "").trim();
    const explicitTheme = (input.theme as string | undefined)?.trim();

    // Lenient: accept either an actual array OR a JSON-encoded string.
    // Real-LLM observation: agents sometimes double-encode large nested
    // arrays (string ~3KB+) as a JSON string for the `ops` argument
    // instead of passing the array directly. Auto-parse rather than
    // forcing a retry.
    let ops: SlidemlEditOp[];
    if (typeof input.ops === "string") {
      try {
        const parsed = JSON.parse(input.ops);
        if (!Array.isArray(parsed)) {
          return `Error: ops was a JSON string but parsed to ${typeof parsed}, expected an array.`;
        }
        ops = parsed as SlidemlEditOp[];
      } catch (err) {
        return `Error: ops was a string that did not parse as JSON: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else {
      ops = (input.ops as SlidemlEditOp[]) ?? [];
    }

    if (!sidecarPath) return "Error: sidecar_path is required.";
    if (!outputPath) return "Error: output_path is required.";
    if (!Array.isArray(ops) || ops.length === 0) return "Error: ops must be a non-empty array.";

    const opTheme = themeFromOps(ops);
    let theme = explicitTheme || opTheme || "technical-blue";
    let themeSource = explicitTheme ? "explicit" : opTheme ? "ops" : "default";
    if (!explicitTheme) {
      try {
        const declared = extractDeckTheme(await readFileText(sidecarPath));
        if (declared && !opTheme) {
          theme = declared;
          themeSource = "sidecar";
        }
      } catch {
        // Fall back to the legacy default. The edit/compile path will report
        // a clearer file or validation error if the sidecar is unreadable.
      }
    }

    try {
      await slidemlEdit(sidecarPath, ops, outputPath, theme);
      const themeNote = themeSource === "sidecar"
        ? ` Theme: ${theme} (auto-detected from sidecar).`
        : themeSource === "ops"
          ? ` Theme: ${theme} (auto-detected from deck.theme edit op).`
          : ` Theme: ${theme}.`;
      return `Edited ${sidecarPath} (${ops.length} op(s)) → ${outputPath} (sidecar: ${outputPath}.slideml).${themeNote}`;
    } catch (err) {
      return `Error: edit_slideml failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },

  // History compression: keep target paths + op count.
  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    return rawResult.slice(0, 150);
  },
};
