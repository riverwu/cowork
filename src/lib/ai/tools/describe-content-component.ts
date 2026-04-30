import type { Tool } from "./types";
import { slidemlDescribeContentComponent } from "@/lib/tauri";

export const describeContentComponentTool: Tool = {
  definition: {
    name: "describe_content_component",
    description:
      `Fetch the full props schema for ONE SlideML ContentComponent, with copy-pasteable example payloads attached to typed props (chart-spec, table, image-ref, bullets).

Call this AFTER \`list_content_components\` for each component you've decided to use. Reading the example field eliminates the most common prop-shape retries.

Returns:
- \`name\`: ContentComponent id
- \`description\`: full component description from theme.md
- \`slotSchema\`: props schema, \`{ [prop]: { type, ...constraints, example? } }\`
- \`thumbnailPath\`: absolute path to a small reference image`,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Component name returned by list_content_components (e.g. cover, timeline, visual-with-caption).",
        },
        theme: {
          type: "string",
          description: "Theme name. Defaults to 'technical-blue'.",
        },
      },
      required: ["name"],
    },
  },

  async execute(input) {
    const componentName = String(input.name || "").trim();
    const theme = (input.theme as string | undefined) || "technical-blue";
    if (!componentName) return "Error: name is required.";
    try {
      const detail = await slidemlDescribeContentComponent(componentName, theme);
      return JSON.stringify(detail, null, 2);
    } catch (err) {
      return `Error: describe_content_component failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },

  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    try {
      const detail = JSON.parse(rawResult) as { name?: string; slotSchema?: Record<string, unknown> };
      const props = detail.slotSchema ? Object.keys(detail.slotSchema).join(", ") : "";
      return `→ ${detail.name ?? "?"} schema (props: ${props})`;
    } catch {
      return rawResult.slice(0, 200);
    }
  },
};
