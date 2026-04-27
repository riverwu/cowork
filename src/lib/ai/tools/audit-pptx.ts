import type { Tool } from "./types";
import { slidemlAudit } from "@/lib/tauri";

export const auditPptxTool: Tool = {
  definition: {
    name: "audit_pptx",
    description:
      `Audit a .pptx file for OOXML conformance issues that PowerPoint rejects (LibreOffice tends to silently tolerate them). Useful after \`render_slideml\` if a deck must open cleanly in PowerPoint.

Checks: ZIP hygiene (no directory entries), Content_Types ↔ parts consistency, Rels integrity (every Target resolves; rId1 of every slide-rels is the slideLayout).

Returns a structured report:
\`\`\`
{
  ok: boolean,
  stats: { slides, parts, media, charts, notesSlides },
  issues: [{ severity: "error"|"warn", code, message }, ...]
}
\`\`\``,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the .pptx file." },
      },
      required: ["path"],
    },
  },

  async execute(input) {
    const path = String(input.path || "").trim();
    if (!path) return "Error: path is required.";
    try {
      const report = await slidemlAudit(path);
      return JSON.stringify(report, null, 2);
    } catch (err) {
      return `Error: audit_pptx failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
