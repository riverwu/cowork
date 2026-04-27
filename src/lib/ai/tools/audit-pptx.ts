import type { Tool } from "./types";
import { slidemlAudit } from "@/lib/tauri";

export const auditPptxTool: Tool = {
  definition: {
    name: "audit_pptx",
    description:
      `Audit a .pptx file for OOXML conformance issues that PowerPoint rejects (LibreOffice tends to silently tolerate them). Useful after \`render_slideml\` if a deck must open cleanly in PowerPoint.

Checks: ZIP hygiene (no directory entries), Content_Types ↔ parts consistency, Rels integrity (every Target resolves; rId1 of every slide-rels is the slideLayout).

Returns a one-line OK summary OR a multi-line failure breakdown. Pass \`format: "json"\` if you want the machine-readable structured report instead.`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the .pptx file." },
        format: {
          type: "string",
          enum: ["text", "json"],
          description: "Output format. Default 'text' (human-readable summary).",
        },
      },
      required: ["path"],
    },
  },

  async execute(input) {
    const path = String(input.path || "").trim();
    const format = (input.format as string | undefined) ?? "text";
    if (!path) return "Error: path is required.";
    try {
      const report = await slidemlAudit(path);
      if (format === "json") return JSON.stringify(report, null, 2);
      // Human-readable rendering — agent and user both read this.
      const tag = report.ok ? "✓ OK" : "✗ FAIL";
      const stats = `${report.stats.slides} slides · ${report.stats.parts} parts · ${report.stats.media} media · ${report.stats.charts} charts · ${report.stats.notesSlides} notes`;
      const lines = [`${tag} ${path}`, `   ${stats}`];
      if (report.issues.length > 0) {
        for (const i of report.issues) {
          const sev = i.severity === "error" ? "✗" : "!";
          lines.push(`   ${sev} [${i.code}] ${i.message}`);
        }
      }
      return lines.join("\n");
    } catch (err) {
      return `Error: audit_pptx failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
