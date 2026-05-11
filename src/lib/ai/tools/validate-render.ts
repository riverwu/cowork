import type { Tool } from "./types";
import { slideml2ValidateRender, type Slideml2Diagnostic, type Slideml2ValidateRenderResult } from "@/lib/tauri";
import { requireDeckReadBeforeWrite, resetSlideWritesAfterRender } from "./slideml2-authoring-state";
import { compilerDiagnosticFromRenderDiagnostic } from "./slideml2-diagnostic-format";

export const validateRenderTool: Tool = {
  definition: {
    name: "validate_render",
    description:
      `Final-validate the SlideML2 deck and (by default) render it to a .pptx file. Use this after all slides have been accepted by \`replace_slide\`, or for explicit final QA/export. Per-slide schema/render gating is built into \`replace_slide\`; do not use this as the normal loop after every slide.

Returns a compact repair-focused report:
- schema validation status and error counts
- output paths (.pptx + sibling .render-tree.json + diagnostics JSON when rendered)
- diagnostics summary by code
- a list of BLOCKING diagnostics with slideId/nodeId/measured/suggestion
- a list of quality diagnostics such as TRUNCATED/OVERFLOW when available

	Blocking diagnostic codes: \`FALLBACK_FAILED\`, \`CODE_BLOCK_OVERFLOW\`, \`COLLISION\`, \`STRUCTURAL_OVERLAP\`, \`SIBLING_INK_OVERLAP\`, \`OVERLAY_OCCLUDES_FLOW\`, \`TITLE_OCCLUDED\`, \`EMPTY_CHART_DATA\`, \`EMPTY_TABLE_DATA\`, \`TINY_RECT\`, \`LOW_CONTRAST\`, \`SHAPE_INVISIBLE\`, \`UNKNOWN_COLOR\`, \`UNKNOWN_STYLE\`, plus any diagnostic whose severity is \`error\`. \`DROP\`, warn-level \`SQUASHED\`, and \`PIE_LABELS_HIDDEN\` are quality/repair hints unless paired with a blocking diagnostic on the same slide. Warn-level \`TRUNCATED\`/\`OVERFLOW\` diagnostics mean text was softly fit; improve them when the returned slideId/nodeId makes a concrete repair obvious, but they do not make \`ok:false\` by themselves.

Pass \`render: false\` for a fast schema-only dry run if explicitly needed; default is render=true.

A failing final result is repair guidance: inspect the affected slide with \`read_deck\`, repair it with \`replace_slide\` / focused \`patch_deck\`, then run \`validate_render({render:true})\` again before final delivery.`,
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
      const resultWithAuthoringDiagnostics = render ? await appendAuthoringDiagnostics(result, deckPath) : result;
      const compact = compactValidateRenderResult(resultWithAuthoringDiagnostics);
      if (render && compact.ok === false) {
        const slideIds = resultWithAuthoringDiagnostics.diagnostics?.blocking
          ?.map((d) => d.slideId)
          .filter((id): id is string => typeof id === "string" && id.length > 0);
        const uniqueSlideIds = [...new Set(slideIds)].slice(0, 6);
        const scope = uniqueSlideIds.length > 0 ? ` Affected slides: ${uniqueSlideIds.join(", ")}.` : "";
        requireDeckReadBeforeWrite(
          deckPath,
          `validate_render returned ok:false (${compact.error || result.error || "blocking diagnostics remain"}).${scope}`,
        );
      }
      return JSON.stringify(compact, null, 2);
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

async function appendAuthoringDiagnostics(result: Slideml2ValidateRenderResult, deckPath: string): Promise<Slideml2ValidateRenderResult> {
  const iconDiagnostic = await unusedGeneratedIconDiagnostic(deckPath);
  if (!iconDiagnostic) return result;
  const diagnostics = result.diagnostics || {
    count: 0,
    summary: {},
    blockingCount: 0,
    blocking: [],
    qualityCount: 0,
    quality: [],
  };
  const alreadyReported = [...(diagnostics.blocking || []), ...(diagnostics.quality || [])]
    .some((diagnostic) => diagnostic.code === iconDiagnostic.code);
  if (alreadyReported) return result;
  const summary = { ...diagnostics.summary, [iconDiagnostic.code]: (diagnostics.summary?.[iconDiagnostic.code] || 0) + 1 };
  const quality = [...(diagnostics.quality || []), iconDiagnostic];
  return {
    ...result,
    diagnostics: {
      ...diagnostics,
      count: diagnostics.count + 1,
      summary,
      qualityCount: (diagnostics.qualityCount ?? diagnostics.quality?.length ?? 0) + 1,
      quality,
    },
  };
}

async function unusedGeneratedIconDiagnostic(deckPath: string): Promise<Slideml2Diagnostic | undefined> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const manifestPath = path.join(path.dirname(deckPath), "assets", "icons", "manifest.json");
    const [deckRaw, manifestRaw] = await Promise.all([
      fs.readFile(deckPath, "utf8"),
      fs.readFile(manifestPath, "utf8").catch(() => ""),
    ]);
    if (!manifestRaw) return undefined;
    const deck = JSON.parse(deckRaw) as unknown;
    const manifest = JSON.parse(manifestRaw) as { icons?: Array<{ path?: unknown; name?: unknown }> };
    const icons = (manifest.icons || [])
      .map((icon) => ({
        name: typeof icon.name === "string" ? icon.name : "",
        path: typeof icon.path === "string" ? icon.path : "",
      }))
      .filter((icon) => icon.path);
    const iconPaths = icons.map((icon) => icon.path);
    if (iconPaths.length === 0) return undefined;
    const iconPathSet = new Set(iconPaths);
    const used = new Set<string>();
    collectStringValues(deck, (value) => {
      if (iconPathSet.has(value)) used.add(value);
    });
    if (used.size >= iconPaths.length) return undefined;
    const unused = icons.filter((icon) => !used.has(icon.path));
    if (used.size > 0) {
      return {
        code: "PARTIAL_UNUSED_GENERATED_ICON_ASSETS",
        severity: "warn",
        message: `Generated icon manifest exists at ${manifestPath}; the deck references ${used.size} of ${iconPaths.length} returned icon path(s).`,
        measured: {
          available: used.size,
          needed: iconPaths.length,
          used: used.size,
          unused: unused.slice(0, 12),
          manifestPath,
        },
        suggestion: "Reference every planned generated icon path in the intended slide/component field, or remove unneeded icon requests from the asset plan.",
      };
    }
    return {
      code: "UNUSED_GENERATED_ICON_ASSETS",
      severity: "warn",
      message: `Generated icon manifest exists at ${manifestPath}, but the deck references none of its ${iconPaths.length} returned icon path(s).`,
      measured: { available: 0, needed: iconPaths.length, used: 0, unused: unused.slice(0, 12), manifestPath },
      suggestion: "Use manifest.icons[].path as feature-card.iconSrc or image/image-card src on slides that requested generated icons, or skip generate_icon_sheet when the final deck will not place the icons.",
    };
  } catch {
    return undefined;
  }
}

function collectStringValues(value: unknown, visit: (value: string) => void): void {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectStringValues(item, visit);
  }
}

function compactValidateRenderResult(result: Slideml2ValidateRenderResult) {
  const validation = result.validation;
  const diagnostics = result.diagnostics;
  return {
    ok: result.ok,
    error: result.error,
    outputPath: result.outputPath,
    domPath: result.domPath,
    diagnosticsPath: result.diagnosticsPath,
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
          qualityCount: diagnostics.qualityCount ?? diagnostics.quality?.length ?? 0,
          quality: (diagnostics.quality || []).slice(0, 40).map(compactDiagnostic),
          nextAction: diagnostics.blockingCount > 0 ? nextRepairAction(result) : undefined,
          qualityAction: diagnostics.blockingCount === 0 ? softQualityAction(diagnostics.summary) : undefined,
        }
      : undefined,
  };
}

function softQualityAction(summary: Record<string, number> | undefined): string | undefined {
  if (!summary) return undefined;
  if (summary.PARTIAL_UNUSED_GENERATED_ICON_ASSETS) {
    return "Quality advisory: some generated icon assets are not referenced by the deck. Use the remaining manifest icon paths in planned feature-card.iconSrc/image fields, or remove unused icon requests from the asset plan.";
  }
  if (summary.UNUSED_GENERATED_ICON_ASSETS) {
    return "Quality advisory: generated icon assets were found but no returned icon paths are referenced by the deck. Use the manifest icon paths as feature-card.iconSrc or image src, or skip icon generation.";
  }
  if (summary.SPARSE_CONTENT_SLIDE || summary.PLAIN_FEATURE_CARD_GRID) {
    return "Quality advisory: one or more slides may look visually sparse even though layout validation passed. Add supporting evidence/takeaways, use richer component variants, or place planned generated iconSrc assets before final delivery.";
  }
  const truncated = summary.TRUNCATED || 0;
  const overflow = summary.OVERFLOW || 0;
  const softFit = truncated + overflow;
  if (softFit < 8) return undefined;
  return `Quality advisory: render has ${softFit} soft-fit warning(s) (${truncated} TRUNCATED, ${overflow} OVERFLOW). If diagnostics.quality includes concrete slideId/nodeId targets, repair those slides by reducing text, splitting pages, using multi-column semantic components, or giving affected components more space. Do not replace semantic components with generic cards solely to hide warnings.`;
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
    compiler: compilerDiagnosticFromRenderDiagnostic(d),
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
    case "CODE_BLOCK_OVERFLOW":
      return "Paginate the code into multiple slides or multiple code-block components. Use columns/density/fontSize for readable compression, and use maxLines only for an intentional excerpt.";
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
    case "TITLE_OCCLUDED":
      return "Move the content region below the title (contentTop >= titleTop + titleHeight + 0.25), or move the covering decoration behind the title.";
    case "COLLISION":
    case "SIBLING_INK_OVERLAP":
    case "STRUCTURAL_OVERLAP":
      return "Keep the same semantic components, but separate the overlapping regions with a stack/grid/split gap, adjust ratio/row/column spans, relax fixed sizes, or paginate dense content. Do not replace evidence components with generic text solely to pass validation.";
    case "OVERLAY_OCCLUDES_FLOW":
      return "Move or resize the overlay so it annotates without covering the evidence/body content, or place it behind only if it is decorative. Prefer adjusting the current area/anchor over changing component semantics.";
	    case "PIE_LABELS_HIDDEN":
	      return "For pie/doughnut charts, keep slice labels visible with dataLabels:{show:true,position:'bestFit',showCategoryName:true,showPercent:true}; do not rely on legend-only designs.";
	    case "EMPTY_CHART_DATA":
	      return "Keep the chart component and repair the data binding: check bind.filter still returns rows, use filter arrays or {in:[...]} for inclusion, and map encoding.x/encoding.y so labels are categorical and values are numeric. For horizontal ranked bars, use orientation:'horizontal' or x:numeric with y:category.";
	    case "EMPTY_TABLE_DATA":
	      return "Keep the table component and repair the row-to-column mapping: use encoding.columns with explicit {key,label}, or set headers to actual object row keys. Do not replace the table with blank prose.";
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
