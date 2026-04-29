import type { Tool } from "./types";
import { slidemlDescribeLayout } from "@/lib/tauri";

export const describeSlideLayoutTool: Tool = {
  definition: {
    name: "describe_slide_layout",
    description:
      `Fetch the full slot schema for ONE SlideML layout, with copy-pasteable example payloads attached to typed slots (chart-spec, table, image-ref, bullets).

Call this AFTER \`list_slide_layouts\` for each layout you've decided to use. Reading the example field eliminates the most common slot-shape retries.

Returns:
- \`name\`: layout id
- \`description\`: full layout description from theme.md
- \`slotSchema\`: \`{ [slot]: { type, ...constraints, example? } }\`
- \`thumbnailPath\`: absolute path to a small reference image`,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Layout name returned by list_slide_layouts (e.g. 'cover', 'chart-with-takeaway').",
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
    const layoutName = String(input.name || "").trim();
    const theme = (input.theme as string | undefined) || "technical-blue";
    if (!layoutName) return "Error: name is required.";
    try {
      const detail = await slidemlDescribeLayout(layoutName, theme);
      return JSON.stringify(detail, null, 2);
    } catch (err) {
      return `Error: describe_slide_layout failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },

  // History compression: schemas are big (sometimes >2KB); the agent
  // already wrote the deck YAML by the next turn — no need to re-ship.
  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    try {
      const detail = JSON.parse(rawResult) as { name?: string; slotSchema?: Record<string, unknown> };
      const slots = detail.slotSchema ? Object.keys(detail.slotSchema).join(", ") : "";
      return `→ ${detail.name ?? "?"} schema (slots: ${slots})`;
    } catch {
      return rawResult.slice(0, 200);
    }
  },
};
