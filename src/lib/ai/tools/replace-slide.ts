import type { Tool } from "./types";
import { slideml2ReplaceSlide } from "@/lib/tauri";
import { getUnvalidatedSlideWrites, recordSlideWrite } from "./slideml2-authoring-state";

export const replaceSlideTool: Tool = {
  definition: {
    name: "replace_slide",
    description:
      `Replace one full slide by id or index. **This is the primary edit primitive for authoring AND repair.**

- To **append** a new slide, pass \`slideId\` equal to the current slide count (a number).
- To **replace** an existing slide, pass either its id (string) or its 0-based index (number).

The \`slide\` field is a SlideML2 SlideV2 JSON object: \`{id, title?, background?, children, notes?, metadata?}\`. Each child node uses the component name directly in \`type\`; fields are flat, never wrapped in \`props\`. Choose component vocabulary from the slideml2 SKILL.md; this tool only writes and validates the slide.

The tool validates the slide against the deck's schema. It also rejects raw hex text colors on slide nodes; define hex values once in deck.themeOverride.colors and reference semantic tokens from slides. After every 1-2 successful slide writes, call \`validate_render\` with render=true before authoring more slides. If \`validate_render\` returned ok:false, prefer calling \`read_deck({deckPath, slideId})\` before repairing so you edit the current source JSON. On failure it returns a structured validation error pointing at the offending field; fix and retry.`,
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
    let slide: unknown = input.slide;
    let autoParsedNote = "";
    // LLM clients sometimes serialize the slide object into a JSON string by
    // mistake. The tool schema declares slide as object, but recovering by
    // JSON.parse beats dead-ending the agent on "must be a JSON object".
    if (typeof slide === "string") {
      const trimmed = slide.trim();
      if (trimmed.startsWith("{")) {
        try {
          slide = JSON.parse(trimmed);
          autoParsedNote = "Note: slide arrived as a JSON string and was auto-parsed; next time pass it as an object literal.\n";
        } catch (err) {
          return `Error: slide must be a JSON object. The string passed could not be parsed as JSON (${err instanceof Error ? err.message : String(err)}).`;
        }
      }
    }
    if (slide == null || typeof slide !== "object") return "Error: slide must be a JSON object.";
    input = { ...input, slide };
    const pendingWrites = getUnvalidatedSlideWrites(deckPath);
    if (pendingWrites >= 2) {
      return [
        "Slide write rejected: validate_render is required after every 1-2 successful replace_slide calls.",
        `This deck already has ${pendingWrites} unvalidated slide write(s).`,
        "Run validate_render with render=true, repair any blocking diagnostics, then continue authoring.",
      ].join("\n");
    }
    const rawColorPaths = findRawTextColorPaths(input.slide);
    if (rawColorPaths.length > 0) {
      return [
        "Slide validation failed: raw hex text colors are not allowed on slide nodes.",
        "Define hex values in create_deck.themeOverride.colors, then use semantic tokens such as brand.primary, text.primary, text.inverse, success, warning, danger, or palette names.",
        `Offending paths: ${rawColorPaths.slice(0, 20).join(", ")}`,
      ].join("\n");
    }
    try {
      const result = await slideml2ReplaceSlide(deckPath, input.slideId as string | number, input.slide);
      if (!result.ok) {
        return `Slide validation failed: ${result.error}\n${JSON.stringify(result.validation, null, 2)}`;
      }
      const writes = recordSlideWrite(deckPath);
      const at = typeof result.insertedAt === "number" ? `inserted at index ${result.insertedAt}` : "replaced";
      const validateHint = writes >= 2
        ? "\nNext required action: run validate_render with render=true before any more replace_slide calls."
        : "\nNext action: you may write one more slide, then run validate_render.";
      return `${autoParsedNote}Slide ${at}. slideCount=${result.slideCount ?? "?"}. unvalidatedSlideWrites=${writes}.${validateHint}`;
    } catch (err) {
      return `Error: replace_slide failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },

  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    return rawResult.slice(0, 200);
  },
};

function findRawTextColorPaths(value: unknown, path = "slide"): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => hits.push(...findRawTextColorPaths(item, `${path}[${index}]`)));
    return hits;
  }
  if (!value || typeof value !== "object") return hits;
  const record = value as Record<string, unknown>;
  if (typeof record.color === "string" && /^[0-9A-Fa-f]{6}$/.test(record.color.trim())) {
    hits.push(`${path}.color`);
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "color") continue;
    hits.push(...findRawTextColorPaths(child, `${path}.${key}`));
  }
  return hits;
}
