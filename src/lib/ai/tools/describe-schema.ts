import type { Tool } from "./types";
import { slideml2DescribeSchema } from "@/lib/tauri";

export const describeSchemaTool: Tool = {
  definition: {
    name: "describe_schema",
    description:
      `Return the SlideML2 authoring schema, deck rules, component index, optional detailed component schemas, text kinds, node types, theme tokens, and default theme scaffold. Call once before authoring slides.

Pass a \`components\` array to get full per-prop schemas for the components you plan to use, e.g. \`{components:["kpi-grid","timeline","callout"]}\`.

This is the single discovery tool — it replaces a separate list/describe split for themes, page patterns, and content components. Pair with \`SLIDEML.md\` (read it once at the start of any deck task).`,
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
