import type { Tool } from "./types";
import { slideml2ReplaceSlide } from "@/lib/tauri";

export const replaceSlideTool: Tool = {
  definition: {
    name: "replace_slide",
    description:
      `Replace one full slide by id or index. **This is the primary edit primitive for authoring AND repair.**

- To **append** a new slide, pass \`slideId\` equal to the current slide count (a number).
- To **replace** an existing slide, pass either its id (string) or its 0-based index (number).

The \`slide\` field is a SlideML2 SlideV2 JSON object: \`{id, title?, background?, children, notes?, metadata?}\`. Each child node uses the component name directly in \`type\`; fields are flat, never wrapped in \`props\`. Compose freely with \`stack\` / \`grid\` / \`split\` / \`panel\` / \`card\` / \`band\`. Read SLIDEML.md for component philosophy and composition patterns.

The tool validates the slide against the deck's schema. On failure it returns a structured validation error pointing at the offending field; fix and retry.`,
    parameters: {
      type: "object",
      properties: {
        deckPath: { type: "string" },
        slideId: { description: "Existing slide id, existing index, or append index equal to slideCount." },
        slide: { type: "object", description: "SlideML2 SlideV2 JSON: {id,title?,background?,children,notes?,metadata?}." },
      },
      required: ["deckPath", "slideId", "slide"],
    },
  },

  async execute(input) {
    const deckPath = String(input.deckPath || "").trim();
    if (!deckPath) return "Error: deckPath is required.";
    if (input.slideId == null) return "Error: slideId is required.";
    if (input.slide == null || typeof input.slide !== "object") return "Error: slide must be a JSON object.";
    try {
      const result = await slideml2ReplaceSlide(deckPath, input.slideId as string | number, input.slide);
      if (!result.ok) {
        return `Slide validation failed: ${result.error}\n${JSON.stringify(result.validation, null, 2)}`;
      }
      const at = typeof result.insertedAt === "number" ? `inserted at index ${result.insertedAt}` : "replaced";
      return `Slide ${at}. slideCount=${result.slideCount ?? "?"}.`;
    } catch (err) {
      return `Error: replace_slide failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },

  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    return rawResult.slice(0, 200);
  },
};
