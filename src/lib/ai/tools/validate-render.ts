import type { Tool } from "./types";
import { slideml2ValidateRender, type Slideml2Diagnostic, type Slideml2ValidateRenderResult } from "@/lib/tauri";
import { requireDeckReadBeforeWrite, resetSlideWritesAfterRender } from "./slideml2-authoring-state";

export const validateRenderTool: Tool = {
  definition: {
    name: "validate_render",
    description:
      `Validate the SlideML2 deck and (by default) render it to a .pptx file. Returns a compact repair-focused report:
- schema validation status and error counts
- output paths (.pptx + sibling .render-tree.json)
- diagnostics summary by code
- a list of BLOCKING diagnostics with slideId/nodeId/measured/suggestion

Blocking diagnostic codes: \`FALLBACK_FAILED\`, \`COLLISION\`, \`TINY_RECT\`, \`SQUASHED\`, \`DROP\`, \`LOW_CONTRAST\`, \`SHAPE_INVISIBLE\`, \`UNKNOWN_COLOR\`, \`UNKNOWN_STYLE\`. Re-author the offending slide via \`replace_slide\` (or fix deck-level via \`patch_deck\`) and re-validate.

Pass \`render: false\` for a fast schema-only dry run during authoring; default is render=true after slides are in place.

Use this periodically during deck authoring and before final delivery. A failing result is repair guidance, not a restriction on using other tools.`,
    parameters: {
      type: "object",
      properties: {
        deckPath: { type: "string", description: "Absolute path to the deck JSON file." },
        outputPath: { type: "string", description: "Absolute path for the .pptx output. Defaults to deckPath with .pptx extension when render=true." },
        render: { type: "boolean", description: "Default true. Set false for schema-only validation." },
      },
      required: ["deckPath"],
    },
  },

  async execute(input) {
    const deckPath = String(input.deckPath || "").trim();
    if (!deckPath) return "Error: deckPath is required.";
    try {
      const fs = await import("node:fs");
      if (!fs.existsSync(deckPath)) {
        return `Error: deckPath does not exist: ${deckPath}\nCheck the path for typos (e.g. /Users/rriver vs /Users/river) and re-issue with the corrected path.`;
      }
    } catch {
      // existsSync threw despite being sync — fall through to the native call.
    }
    const outputPath = typeof input.outputPath === "string" ? input.outputPath : undefined;
    const render = input.render !== false;
    try {
      const result = await slideml2ValidateRender(deckPath, outputPath, render);
      if (render) resetSlideWritesAfterRender(deckPath);
      if (render && result.ok === false) {
        const slideIds = result.diagnostics?.blocking
          ?.map((d) => d.slideId)
          .filter((id): id is string => typeof id === "string" && id.length > 0);
        const uniqueSlideIds = [...new Set(slideIds)].slice(0, 6);
        const scope = uniqueSlideIds.length > 0 ? ` Affected slides: ${uniqueSlideIds.join(", ")}.` : "";
        requireDeckReadBeforeWrite(
          deckPath,
          `validate_render returned ok:false (${result.error || "blocking diagnostics remain"}).${scope}`,
        );
      }
      return JSON.stringify(compactValidateRenderResult(result), null, 2);
    } catch (err) {
      return `Error: validate_render failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },

  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    try {
      const parsed = JSON.parse(rawResult);
      if (parsed.outputPath) {
        const block = parsed.diagnostics?.blockingCount ?? 0;
        return `→ ${parsed.outputPath} (blocking=${block})`;
      }
      return `validation only: ok=${parsed.ok}`;
    } catch {
      return rawResult.slice(0, 200);
    }
  },
};

function compactValidateRenderResult(result: Slideml2ValidateRenderResult) {
  const validation = result.validation;
  const diagnostics = result.diagnostics;
  return {
    ok: result.ok,
    error: result.error,
    outputPath: result.outputPath,
    domPath: result.domPath,
    validation: {
      ok: validation?.ok,
      errorCount: validation?.errors?.length ?? 0,
      warningCount: (validation as { warnings?: unknown[] } | undefined)?.warnings?.length ?? 0,
      infoCount: (validation as { info?: unknown[] } | undefined)?.info?.length ?? 0,
      errors: validation?.errors?.slice(0, 20) ?? [],
    },
    diagnostics: diagnostics
      ? {
          count: diagnostics.count,
          summary: diagnostics.summary,
          blockingCount: diagnostics.blockingCount,
          blocking: diagnostics.blocking.slice(0, 40).map(compactDiagnostic),
          nextAction: diagnostics.blockingCount > 0 ? nextRepairAction(result) : undefined,
        }
      : undefined,
  };
}

function compactDiagnostic(d: Slideml2Diagnostic) {
  const aggregated = d.aggregated as
    | { count?: number; affectedNodes?: Array<{ nodeId?: string; sample?: string }> }
    | undefined;
  return {
    code: d.code,
    severity: d.severity,
    slideId: d.slideId,
    nodeId: d.nodeId,
    message: d.message,
    measured: d.measured,
    surfaceTrail: d.surfaceTrail,
    constrainedBy: d.constrainedBy,
    aggregated: aggregated && aggregated.count && aggregated.count > 1
      ? {
          count: aggregated.count,
          affectedNodes: (aggregated.affectedNodes || []).slice(0, 8),
        }
      : undefined,
    suggestion: d.suggestion || repairHint(d),
  };
}

function repairHint(d: Slideml2Diagnostic): string | undefined {
  switch (d.code) {
    case "FALLBACK_FAILED":
      return "Keep the selected slide semantics, but reduce item text/count, mark secondary details optional, split dense content into another slide, or give the failing region more height.";
    case "TINY_RECT":
    case "SQUASHED":
      return "Keep the selected component semantics, but reduce item text/count, lower columns, mark secondary details optional, or split dense content into another slide.";
    case "LOW_CONTRAST": {
      const trail = Array.isArray(d.surfaceTrail) ? (d.surfaceTrail as string[]).join(" → ") : undefined;
      const trailLine = trail ? `Surface trail: ${trail}. ` : "";
      return `${trailLine}Pick a fg token with sufficient contrast against the picked surface (text.primary on light fills, text.inverse on dark fills); fix the deck theme token if the mismatch is systemic. Do not put raw hex on slide text nodes.`;
    }
    case "UNKNOWN_COLOR":
      return "Use a token defined in deck.themeOverride.colors; do not use raw hex on slide nodes.";
    case "UNKNOWN_STYLE":
      return "Use a theme text style token defined in deck.themeOverride.text.";
    default:
      return undefined;
  }
}

function nextRepairAction(result: Slideml2ValidateRenderResult): string | undefined {
  const slideIds = result.diagnostics?.blocking
    ?.map((d) => d.slideId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const uniqueSlideIds = [...new Set(slideIds || [])];
  if (uniqueSlideIds.length === 0) return "Call read_deck({ deckPath }) before repairing, then edit from the current source JSON.";
  const first = uniqueSlideIds[0];
  const more = uniqueSlideIds.length > 1 ? ` Also inspect: ${uniqueSlideIds.slice(1, 6).join(", ")}.` : "";
  return `Call read_deck({ deckPath, slideId: "${first}" }) before repairing, then edit from that current source JSON.${more}`;
}
