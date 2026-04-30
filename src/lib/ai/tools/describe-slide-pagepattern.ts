import type { Tool } from "./types";
import { findSlidePagePattern } from "./slide-pagepatterns";

export const describeSlidePagePatternTool: Tool = {
  definition: {
    name: "describe_slide_pagepattern",
    description:
      `Describe one SlideML PagePattern in detail, including titlePolicy, usable regions, layout policy guidance, best component combinations, and a copy-pasteable slide example.

Use this after \`list_slide_pagepatterns\` when deciding the page geometry for a specific slide. PagePatterns are not content components; they decide region geometry and whether \`slide.title\` is separate, required, component-owned, or disallowed.`,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "PagePattern name from list_slide_pagepatterns, e.g. single-focus, main-plus-sidebar, two-column, dashboard.",
        },
      },
      required: ["name"],
    },
  },

  async execute(input) {
    const name = String(input.name || "").trim();
    if (!name) return "Error: name is required.";
    const pattern = findSlidePagePattern(name);
    if (!pattern) return `Error: unknown PagePattern "${name}". Call list_slide_pagepatterns first.`;
    return JSON.stringify(pattern, null, 2);
  },

  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    try {
      const detail = JSON.parse(rawResult) as { name?: string; regions?: string[] };
      return `→ ${detail.name ?? "?"} PagePattern (regions: ${(detail.regions || []).join(", ")})`;
    } catch {
      return rawResult.slice(0, 200);
    }
  },
};
