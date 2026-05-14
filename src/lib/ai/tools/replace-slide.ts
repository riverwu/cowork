import type { Tool } from "./types";
import { slideml2ReadDeck, slideml2ReplaceSlide, type Slideml2ReplaceSlideResult } from "@/lib/tauri";
import { hasUnvalidatedSlideWriteTarget, recordSlideWrite, slideAuthoringCheckpointHint, slideSemanticLayoutHint } from "./slideml2-authoring-state";
import { parseJsonLenient } from "./_json-repair";
import { formatCompilerDiagnostics, formatCompilerValidationErrors } from "./slideml2-diagnostic-format";

export const replaceSlideTool: Tool = {
  definition: {
    name: "replace_slide",
    description:
      `Replace one full slide by id or index. **This is the primary edit primitive for authoring AND repair.**

- To **append** a new slide, pass \`slideId\` equal to the current slide count (a number).
- To **replace** an existing slide, pass either its id (string) or its 0-based index (number).
- If you are splitting one slide into multiple pages, replace the first page and use \`insert_slide\` for the additional pages so earlier work is not overwritten.

The \`slide\` field must be a real SlideML2 SlideV2 object literal in the tool argument, not a quoted/stringified JSON blob: \`{id, title?, background?, children, notes?, metadata?}\`. Never pass \`slide:"{...}"\`, never put backslashes around every quote, and never stringify a slide to avoid object syntax. If the slide is long, simplify the slide or split it across pages; do not stringify it. Each child node uses the component name directly in \`type\`; fields are flat, never wrapped in \`props\`.

This tool validates the candidate slide before committing it. The deck file is modified only when the candidate passes schema validation and single-slide render validation with zero blocking diagnostics. Failed calls return the current slide's validation/render diagnostics and leave the deck unchanged, so repair the same slide and retry \`replace_slide\` before adding the next slide.

After every slide has passed \`replace_slide\`, call \`validate_render({deckPath,render:true})\` once to render/export the full PPTX and catch cross-slide or final output issues. Do not use \`validate_render\` as the normal per-slide loop; the per-slide gate is built into this tool. Do not write or mutate the deck JSON directly as a workaround.`,
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
          slide = parseJsonLenient(trimmed);
          autoParsedNote = "Warning: slide arrived as a JSON string and was auto-parsed as a recovery path. The canonical call is slide:{...} as an object literal; do not use slide:\"{...}\" again.\n";
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return [
            `Error: slide must be a JSON object, not a malformed JSON string. The string passed could not be parsed (${message}).`,
            `diagnostic=${JSON.stringify({
              severity: "error",
              code: "SLIDEML_JSON_PARSE",
              message: "replace_slide.slide was a malformed JSON string.",
              location: { jsonPath: "slide" },
              expected: { type: "SlideV2 object literal" },
              actual: { type: "string", parseError: message },
              suggestions: [
                "Pass slide as an object literal in the tool argument.",
                "If the slide object is too long, split the page or reduce content before retrying; do not stringify the whole slide.",
              ],
              examplePatch: `replace_slide({deckPath, slideId: 0, slide: {id: "s1", children: [{id: "s1.main", type: "text", text: "..."}]}})`,
            })}`,
            "Retry replace_slide with slide as an object literal in the tool argument: slide:{id,title?,children:[...]}. Do not quote or stringify the slide.",
            "Do not write the deck JSON with write_file/run_node/run_python; that bypasses SlideML2 validation and usually makes render failures harder to repair.",
          ].join("\n");
        }
      }
    }
    if (slide == null || typeof slide !== "object") return "Error: slide must be a JSON object.";
    input = { ...input, slide };
    const rawColorPaths = findRawTextColorPaths(input.slide);
    if (rawColorPaths.length > 0) {
      return [
        "Slide validation failed: raw hex text colors are not allowed on slide nodes.",
        `diagnostic=${JSON.stringify({
          severity: "error",
          code: "SLIDEML_SCHEMA_FIELD",
          sourceCode: "RAW_TEXT_COLOR",
          message: "Raw hex text colors on slide nodes are not portable across themes.",
          location: { jsonPath: rawColorPaths[0] },
          expected: { color: "theme token such as brand.primary or text.primary" },
          actual: { paths: rawColorPaths.slice(0, 20) },
          suggestions: [
            "Define reusable hex values in create_deck.themeOverride.colors.",
            "Reference the semantic token from slide nodes instead of using raw hex colors.",
          ],
        })}`,
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
        return [
          `Slide write rejected; deck file was not modified. ${result.error || "Validation failed."}`,
          formatSlideValidationResult(result),
          "Repair this same slide and retry replace_slide before adding the next slide.",
        ].filter(Boolean).join("\n");
      }
      const writeTarget = typeof result.insertedAt === "number"
        ? `index:${result.insertedAt}`
        : target.key;
      const writes = recordSlideWrite(deckPath, writeTarget);
      const at = typeof result.insertedAt === "number" ? `inserted at index ${result.insertedAt}` : "replaced";
      const repeatHint = repeatedTarget
        ? ` Warning: slide index ${target.index}${target.existingId ? ` (id: ${target.existingId})` : ""} was replaced again before a render validation; verify this was intentional.`
        : "";
      const semanticHint = slideSemanticLayoutHint(input.slide);
      const validateHint = `\n${slideAuthoringCheckpointHint(deckPath, writes)}`;
      return [
        `${autoParsedNote}Slide ${at}. slideCount=${result.slideCount ?? "?"}.`,
        `Per-slide validation passed: ${formatSlideValidationResult(result)}`,
        repeatHint.trim(),
        semanticHint,
        validateHint.trim(),
      ].filter(Boolean).join("\n");
    } catch (err) {
      return `Error: replace_slide failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },

  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    return rawResult.slice(0, 200);
  },
};

function formatSlideValidationResult(result: Slideml2ReplaceSlideResult): string {
  const validationOk = result.validation?.ok;
  const errorCount = Array.isArray(result.validation?.errors) ? result.validation.errors.length : 0;
  const schemaErrors = formatValidationErrors(result.validation?.errors);
  const diagnostics = result.diagnostics;
  if (!diagnostics) {
    return `schemaOk=${String(validationOk)} schemaErrors=${errorCount}${schemaErrors}`;
  }
  const blockingCount = diagnostics.blockingCount ?? 0;
  const qualityCount = diagnostics.qualityCount ?? diagnostics.quality?.length ?? 0;
  const summary = diagnostics.summary && Object.keys(diagnostics.summary).length > 0
    ? ` summary=${JSON.stringify(diagnostics.summary)}`
    : "";
  const blocking = blockingCount > 0
    ? `\nblocking=${JSON.stringify((diagnostics.blocking || []).slice(0, 12), null, 2)}`
    : "";
  const compilerDiagnostics = blockingCount > 0
    ? `\ncompilerDiagnostics=${JSON.stringify(formatCompilerDiagnostics(diagnostics.blocking, 12), null, 2)}`
    : "";
  return `schemaOk=${String(validationOk)} schemaErrors=${errorCount}${schemaErrors} renderBlocking=${blockingCount} quality=${qualityCount}${summary}${blocking}${compilerDiagnostics}`;
}

function formatValidationErrors(errors: NonNullable<Slideml2ReplaceSlideResult["validation"]>["errors"]): string {
  if (!Array.isArray(errors) || errors.length === 0) return "";
  const compact = errors.slice(0, 12).map((err) => {
    if (!err || typeof err !== "object") return err;
    const record = err as Record<string, unknown>;
    return {
      code: record.code,
      path: record.path,
      message: record.message,
      suggestedFix: record.suggestedFix,
    };
  });
  const more = errors.length > compact.length ? ` (${errors.length - compact.length} more)` : "";
  return `\nschemaErrorsDetail=${JSON.stringify(compact, null, 2)}${more}\ncompilerSchemaDiagnostics=${JSON.stringify(formatCompilerValidationErrors(errors, 12), null, 2)}`;
}

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
