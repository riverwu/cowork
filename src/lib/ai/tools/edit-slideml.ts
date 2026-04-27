import type { Tool } from "./types";
import { slidemlEdit, type SlidemlEditOp } from "@/lib/tauri";

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
        theme: { type: "string", description: "Theme name. Defaults to 'technical-blue'." },
      },
      required: ["sidecar_path", "ops", "output_path"],
    },
  },

  async execute(input) {
    const sidecarPath = String(input.sidecar_path || "").trim();
    const outputPath = String(input.output_path || "").trim();
    const theme = (input.theme as string | undefined) || "technical-blue";
    const ops = (input.ops as SlidemlEditOp[]) || [];
    if (!sidecarPath) return "Error: sidecar_path is required.";
    if (!outputPath) return "Error: output_path is required.";
    if (!Array.isArray(ops) || ops.length === 0) return "Error: ops must be a non-empty array.";
    try {
      await slidemlEdit(sidecarPath, ops, outputPath, theme);
      return `Edited ${sidecarPath} (${ops.length} op(s)) → ${outputPath} (sidecar: ${outputPath}.slideml).`;
    } catch (err) {
      return `Error: edit_slideml failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
