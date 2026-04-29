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

export const editSlidemlTool: Tool = {
  definition: {
    name: "edit_slideml",
    description:
      `Apply structured edits to an existing deck's sidecar source (.slideml) and recompile to .pptx. Cheaper than re-emitting the whole YAML.

Use after a previous \`render_slideml\` produced a deck and the user (or you) want to mutate it. Reads the sidecar at \`sidecar_path\` (typically \`<output>.pptx.slideml\`), applies the ops in order, then writes BOTH the new .pptx at \`output_path\` AND a refreshed sidecar at \`<output_path>.slideml\`.

Op grammar (paths use dot-bracket notation: \`slides[3].slots.title\`, \`deck.header.left\`, \`slides[0].slots.items[2]\`):
- \`{ kind: "set", path: "slides[3].slots.title", value: "..." }\`
- \`{ kind: "delete", path: "slides[2].notes" }\`
- \`{ kind: "insertSlide", at: 4, slide: { layout: "...", slots: {...} } }\`
- \`{ kind: "deleteSlide", at: 3 }\`
- \`{ kind: "moveSlide", from: 4, to: 1 }\`

Indexes are 0-based. \`output_path\` may be the same as the original (overwrites in place).`,
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
          description: "OPTIONAL. Theme name or absolute path to a theme directory. Leave unset and the tool auto-detects from the sidecar's own `deck.theme` field.",
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

    let theme = explicitTheme || "technical-blue";
    let themeSource = explicitTheme ? "explicit" : "default";
    if (!explicitTheme) {
      try {
        const declared = extractDeckTheme(await readFileText(sidecarPath));
        if (declared) {
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
