import type { Tool } from "./types";
import { slideml2DescribeSchema } from "@/lib/tauri";

export const describeSchemaTool: Tool = {
  definition: {
    name: "describe_schema",
    description:
      `Return focused SlideML2 schema details for deck authoring. Use this after reading the slideml2 SKILL.md when you need exact prop schemas for selected components.

Pass a \`components\` array to get full per-prop schemas for the components you plan to use, e.g. \`{components:["kpi-grid","timeline","callout"]}\`.

The slideml2 skill is the primary component-selection guide. Avoid broad schema calls as a substitute for reading the skill because large generic tool results may be compressed.`,
    parameters: {
      type: "object",
      properties: {
        components: {
          type: "array",
          items: { type: "string" },
          description: "Optional component names to describe in detail.",
        },
      },
      required: [],
    },
  },

  async execute(input) {
    const components = Array.isArray(input.components) ? input.components.map(String) : undefined;
    try {
      const result = await slideml2DescribeSchema(components);
      return JSON.stringify(result, null, 2);
    } catch (err) {
      return `Error: describe_schema failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },

  historySummarizer(_raw, status) {
    return status === "fail" ? _raw : "→ schema (deck rules + components + theme tokens)";
  },
};
