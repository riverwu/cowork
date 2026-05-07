import type { Tool } from "./types";
import { slideml2ReadDeck, slideml2ReplaceSlide } from "@/lib/tauri";
import { hasUnvalidatedSlideWriteTarget, recordSlideWrite } from "./slideml2-authoring-state";

export const replaceSlideTool: Tool = {
  definition: {
    name: "replace_slide",
    description:
      `Replace one full slide by id or index. **This is the primary edit primitive for authoring AND repair.**

- To **append** a new slide, pass \`slideId\` equal to the current slide count (a number).
- To **replace** an existing slide, pass either its id (string) or its 0-based index (number).
- If you are splitting one slide into multiple pages, replace the first page and use \`insert_slide\` for the additional pages so earlier work is not overwritten.

The \`slide\` field is a SlideML2 SlideV2 JSON object: \`{id, title?, background?, children, notes?, metadata?}\`. Each child node uses the component name directly in \`type\`; fields are flat, never wrapped in \`props\`. Choose component vocabulary from the slideml2 SKILL.md; this tool only writes and validates the slide.

The tool validates the slide against the deck's schema. It also rejects raw hex text colors on slide nodes; define hex values once in deck.themeOverride.colors and reference semantic tokens from slides. Use \`validate_render\` periodically and before final delivery; if \`validate_render\` returned ok:false, prefer calling \`read_deck({deckPath, slideId})\` before repairing so you edit the current source JSON. On failure it returns a structured validation error pointing at the offending field; fix and retry.`,
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
    const rawColorPaths = findRawTextColorPaths(input.slide);
    if (rawColorPaths.length > 0) {
      return [
        "Slide validation failed: raw hex text colors are not allowed on slide nodes.",
        "Define hex values in create_deck.themeOverride.colors, then use semantic tokens such as brand.primary, text.primary, text.inverse, success, warning, danger, or palette names.",
        `Offending paths: ${rawColorPaths.slice(0, 20).join(", ")}`,
      ].join("\n");
    }
    const target = await resolveReplaceTarget(deckPath, input.slideId);
    if (typeof target === "string") return target;
    const repeatedTarget = target.kind === "replace" && hasUnvalidatedSlideWriteTarget(deckPath, target.key);
    try {
      const result = await slideml2ReplaceSlide(deckPath, input.slideId as string | number, input.slide);
      if (!result.ok) {
        return `Slide validation failed: ${result.error}\n${JSON.stringify(result.validation, null, 2)}`;
      }
      const writeTarget = typeof result.insertedAt === "number"
        ? `index:${result.insertedAt}`
        : target.key;
      const writes = recordSlideWrite(deckPath, writeTarget);
      const at = typeof result.insertedAt === "number" ? `inserted at index ${result.insertedAt}` : "replaced";
      const repeatHint = repeatedTarget
        ? ` Warning: slide index ${target.index}${target.existingId ? ` (id: ${target.existingId})` : ""} was replaced again before a render validation; verify this was intentional.`
        : "";
      const validateHint = "\nRecommended: run validate_render with render=true before treating the PPTX as final.";
      return `${autoParsedNote}Slide ${at}. slideCount=${result.slideCount ?? "?"}. unvalidatedSlideWrites=${writes}.${repeatHint}${validateHint}`;
    } catch (err) {
      return `Error: replace_slide failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },

  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    return rawResult.slice(0, 200);
  },
};

async function resolveReplaceTarget(
  deckPath: string,
  slideId: unknown,
): Promise<{ kind: "replace" | "append"; index: number; key: string; existingId?: string } | string> {
  try {
    const deck = await slideml2ReadDeck(deckPath) as { slides?: Array<{ id?: unknown }> };
    const slides = Array.isArray(deck.slides) ? deck.slides : [];
    const normalized = normalizeSlideId(slideId);
    if (typeof normalized === "number") {
      if (normalized === slides.length) {
        return { kind: "append", index: normalized, key: `index:${normalized}` };
      }
      if (normalized >= 0 && normalized < slides.length) {
        const existingId = typeof slides[normalized]?.id === "string" ? slides[normalized]!.id as string : undefined;
        return { kind: "replace", index: normalized, key: `index:${normalized}`, existingId };
      }
      return `Error: slideId index ${normalized} out of range. Valid existing indexes: 0..${Math.max(0, slides.length - 1)}; append index: ${slides.length}.`;
    }
    const index = slides.findIndex((s) => s && typeof s === "object" && s.id === normalized);
    if (index < 0) {
      return `Error: slide not found: ${normalized}. Use read_deck to inspect current slide ids, or append with slideId equal to current slideCount (${slides.length}).`;
    }
    return { kind: "replace", index, key: `index:${index}`, existingId: normalized };
  } catch (err) {
    return `Error: replace_slide could not read deck before writing.\n${err instanceof Error ? err.message : String(err)}`;
  }
}

function normalizeSlideId(value: unknown): string | number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return String(value || "");
}

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
