import type { Slideml2Diagnostic, Slideml2ValidationReport } from "@/lib/tauri";

type ValidationIssue = NonNullable<Slideml2ValidationReport["errors"]>[number];

export interface CompilerLikeDiagnostic {
  severity: string;
  code: string;
  sourceCode?: string;
  message?: string;
  location: {
    slideId?: string;
    nodeId?: string;
    componentType?: string;
    jsonPath?: string;
  };
  expected?: Record<string, unknown>;
  actual?: Record<string, unknown>;
  suggestions: string[];
  examplePatch?: string;
  related?: Record<string, unknown>;
}

export function compilerDiagnosticFromRenderDiagnostic(d: Slideml2Diagnostic): CompilerLikeDiagnostic {
  const componentType = inferComponentType(d);
  const normalized = normalizedDiagnosticCode(d);
  const suggestions = orderedRepairSuggestions(d, componentType);
  const measured = measuredRecord(d);
  const parsedMin = parseMinimumSize(d.message);
  const expected: Record<string, unknown> = {};
  const actual: Record<string, unknown> = {};

  if (parsedMin) {
    expected.minWidthCm = parsedMin.w;
    expected.minHeightCm = parsedMin.h;
  }
  if (typeof measured?.needed === "number") expected.neededCm = measured.needed;
  if (typeof measured?.heightNeeded === "number") expected.heightNeededCm = measured.heightNeeded;
  if (typeof measured?.lineCount === "number") expected.lineCount = measured.lineCount;
  if (typeof measured?.estimatedCapacityLines === "number") expected.estimatedCapacityLines = measured.estimatedCapacityLines;
  if (measured?.rect && typeof measured.rect === "object") actual.rect = measured.rect;
  if (typeof measured?.available === "number") actual.availableCm = measured.available;
  if (typeof measured?.heightAvailable === "number") actual.heightAvailableCm = measured.heightAvailable;
  if (typeof measured?.deltaCm === "number") actual.deltaCm = measured.deltaCm;
  if (typeof measured?.overlapAreaCm2 === "number") actual.overlapAreaCm2 = measured.overlapAreaCm2;
  if (typeof measured?.overlapRatio === "number") actual.overlapRatio = measured.overlapRatio;
  if (typeof measured?.relationship === "string") actual.relationship = measured.relationship;
  if (typeof measured?.parentId === "string") actual.parentId = measured.parentId;
  if (typeof measured?.columns === "number") actual.columns = measured.columns;
  if (typeof measured?.density === "string") actual.density = measured.density;
  if (typeof measured?.fontSize === "number") actual.fontSize = measured.fontSize;

  return {
    severity: d.severity,
    code: normalized,
    sourceCode: typeof d.code === "string" ? d.code : undefined,
    message: d.message,
    location: {
      slideId: stringField(d.slideId),
      nodeId: stringField(d.nodeId),
      componentType,
    },
    expected: Object.keys(expected).length ? expected : undefined,
    actual: Object.keys(actual).length ? actual : undefined,
    suggestions,
    related: relatedInfo(d),
  };
}

export function compilerDiagnosticFromValidationIssue(issue: ValidationIssue): CompilerLikeDiagnostic {
  const path = stringField(issue.path);
  const code = stringField(issue.code) || "SLIDEML_SCHEMA";
  return {
    severity: stringField(issue.severity) || stringField((issue as Record<string, unknown>).level) || "error",
    code: schemaCompilerCode(code),
    sourceCode: code,
    message: issue.message,
    location: {
      slideId: stringField(issue.slideId),
      nodeId: stringField(issue.nodeName),
      jsonPath: path,
    },
    expected: expectedFromSchemaIssue(issue),
    actual: path ? { path } : undefined,
    suggestions: issue.suggestedFix ? [issue.suggestedFix] : ["Repair the field named in location.jsonPath, then retry the same SlideML2 tool call."],
    examplePatch: schemaExamplePatch(code),
  };
}

export function formatCompilerDiagnostics(diags: Slideml2Diagnostic[] | undefined, limit = 8): CompilerLikeDiagnostic[] {
  return (diags || []).slice(0, limit).map(compilerDiagnosticFromRenderDiagnostic);
}

export function formatCompilerValidationErrors(errors: Slideml2ValidationReport["errors"] | undefined, limit = 8): CompilerLikeDiagnostic[] {
  return (errors || []).slice(0, limit).map(compilerDiagnosticFromValidationIssue);
}

function normalizedDiagnosticCode(d: Slideml2Diagnostic): string {
  switch (d.code) {
    case "CODE_BLOCK_OVERFLOW":
    case "FALLBACK_FAILED":
    case "SQUASHED":
    case "TINY_RECT":
      return "SLIDEML_COMPONENT_CAPACITY";
    case "TRUNCATED":
    case "OVERFLOW":
      return "SLIDEML_TEXT_FIT";
    case "PIE_LABELS_HIDDEN":
      return "SLIDEML_CHART_LABELS";
    case "EMPTY_CHART_DATA":
      return "SLIDEML_CHART_DATA";
    case "EMPTY_TABLE_DATA":
      return "SLIDEML_TABLE_DATA";
    case "LOW_CONTRAST":
    case "LOW_CONTRAST_FIXED":
      return "SLIDEML_CONTRAST";
    case "UNKNOWN_COLOR":
    case "UNKNOWN_STYLE":
      return "SLIDEML_THEME_TOKEN";
    case "TITLE_OCCLUDED":
    case "COLLISION":
    case "STRUCTURAL_OVERLAP":
    case "SIBLING_INK_OVERLAP":
    case "OVERLAY_OCCLUDES_FLOW":
      return "SLIDEML_LAYOUT_COLLISION";
    case "EDGE_CLIPPED":
    case "OFF_SLIDE":
      return "SLIDEML_LAYOUT_BOUNDS";
    case "TIGHT_GAP":
    case "DECORATIVE_OVERLAP":
      return "SLIDEML_LAYOUT_QUALITY";
    case "DROP":
    case "DEMOTED":
      return "SLIDEML_RENDER_FALLBACK";
    default:
      return `SLIDEML_${String(d.code || "DIAGNOSTIC")}`;
  }
}

function schemaCompilerCode(code: string): string {
  if (/JSON|PARSE/i.test(code)) return "SLIDEML_JSON_PARSE";
  if (/ENUM|VALUE|MODE|TONE/i.test(code)) return "SLIDEML_SCHEMA_ENUM";
  if (/UNKNOWN|FIELD/i.test(code)) return "SLIDEML_SCHEMA_FIELD";
  if (/MISSING|required/i.test(code)) return "SLIDEML_SCHEMA_REQUIRED";
  return "SLIDEML_SCHEMA";
}

function inferComponentType(d: Slideml2Diagnostic): string | undefined {
  const nodeId = String(d.nodeId || "");
  const message = String(d.message || "");
  const role = stringField((d as Record<string, unknown>).componentType);
  if (role) return role;
  if (d.code === "CODE_BLOCK_OVERFLOW" || /code block/i.test(message)) return "code-block";
  if (/chart/i.test(message) || /\.chart$/.test(nodeId)) return "chart-card/chart";
  if (/table/i.test(message) || /\.table\d*$/.test(nodeId)) return "table-card/table";
  if (/donut|doughnut/i.test(message) || /donut/.test(nodeId)) return "donut-summary";
  if (/evidence/i.test(message) || /evidence/.test(nodeId)) return "evidence-layout";
  if (/equation/i.test(message) || /\.math$|\.number$/.test(nodeId)) return "equation";
  if (/process|flow/i.test(message) || /process|flow/.test(nodeId)) return "process-flow";
  if (/metric|KPI|stat/i.test(message) || /kpi|metric|stat/.test(nodeId)) return "kpi-grid/stat-strip";
  return undefined;
}

function orderedRepairSuggestions(d: Slideml2Diagnostic, componentType?: string): string[] {
  const suggestions: string[] = [];
  const add = (value?: string) => {
    const text = normalizeSuggestion(value);
    if (!text) return;
    if (!suggestions.some((item) => item.toLowerCase() === text.toLowerCase())) suggestions.push(text);
  };

  const capacity = normalizedDiagnosticCode(d) === "SLIDEML_COMPONENT_CAPACITY";
  if (capacity) {
    if (componentType?.includes("chart")) {
      add("Keep the chart component as the evidence object first: reserve the required chart body area (bar/line/combo roughly >=4.8x3.0cm; pie/doughnut roughly >=5.2x4.4cm before title/caption/card chrome).");
      add("Use split/chart-with-rail/evidence-layout so the chart gets full width or about 60-75% of the evidence area; move KPI, table, legend, or commentary content to a side rail or follow-up slide before replacing the chart.");
      add("After the chart body is large enough, reduce chart label density, category count, series count, legend, or surrounding card chrome while keeping required labels readable.");
    } else if (componentType?.includes("table")) {
      add("Keep the table component first: reserve enough table body height (a compact 6-8 row business table often needs about 4.5-6cm plus title/caption/card chrome) before changing components.");
      add("Widen text-heavy columns with encoding.columns/colWidths, use density:'compact', shorten cell text, or provide explicit rowHeights for known tall rows.");
      add("If rows still exceed the readable floor, paginate the same table across slides or split exact table and interpretation into separate regions rather than dropping table content.");
    } else if (componentType?.includes("code-block")) {
      add("Keep code-block for code: paginate the listing across slides/components, use columns:2/3, density:'tiny', or a smaller readable fontSize.");
      add("Use maxLines only when the requested slide is an intentional excerpt.");
    } else if (componentType?.includes("equation")) {
      add("Keep equation for display math: reduce formulas per slide, use size:'sm' or fontSize, and remove optional labels/captions before switching representations.");
    } else if (componentType?.includes("process-flow")) {
      add("Keep process-flow for sequence semantics: reduce per-step body/bullets, use vertical direction for rich stages, or split stages across slides.");
    } else if (componentType?.includes("donut") || componentType?.includes("evidence")) {
      add("Keep the evidence component's semantic job first: reserve one dominant evidence area, shorten the interpretation rail, and move secondary metrics/tables/facts to a follow-up slide.");
    } else if (componentType?.includes("kpi") || componentType?.includes("stat")) {
      add("Keep the KPI/stat component first: reduce metrics per row, shorten labels, use compact density, or give the component a wider region.");
      add("Split dense dashboards into multiple slides before replacing numeric components with generic text/cards.");
    } else {
      add("Preserve the current component semantics first: increase the allocated area, adjust layout ratio, reduce item count/text, or paginate supporting content.");
    }
  }

  add(d.suggestion);
  if (suggestions.length === 0) {
    add("Inspect location.slideId/location.nodeId, repair the same slide, and retry replace_slide.");
  }
  return suggestions.slice(0, 5).map((item) => markOptionalReplacement(item));
}

function markOptionalReplacement(text: string): string {
  if (/\b(switch|replace|change to)\b/i.test(text) && !/^Optional\b/i.test(text)) {
    return `Optional only if semantics improve: ${text}`;
  }
  return text;
}

function normalizeSuggestion(value?: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/\s+/g, " ");
  return text || undefined;
}

function parseMinimumSize(message?: unknown): { w: number; h: number } | undefined {
  if (typeof message !== "string") return undefined;
  const match = message.match(/need(?:s)? at least\s+([0-9.]+)x([0-9.]+)cm/i);
  if (!match) return undefined;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return undefined;
  return { w, h };
}

function measuredRecord(d: Slideml2Diagnostic): Record<string, unknown> | undefined {
  const measured = (d as Record<string, unknown>).measured;
  return measured && typeof measured === "object" && !Array.isArray(measured)
    ? measured as Record<string, unknown>
    : undefined;
}

function relatedInfo(d: Slideml2Diagnostic): Record<string, unknown> | undefined {
  const related: Record<string, unknown> = {};
  const constrainedBy = (d as Record<string, unknown>).constrainedBy;
  const surfaceTrail = (d as Record<string, unknown>).surfaceTrail;
  const aggregated = (d as Record<string, unknown>).aggregated;
  if (constrainedBy) related.constrainedBy = constrainedBy;
  if (surfaceTrail) related.surfaceTrail = surfaceTrail;
  if (aggregated) related.aggregated = aggregated;
  const measured = measuredRecord(d);
  if (measured?.other) related.otherRect = measured.other;
  return Object.keys(related).length ? related : undefined;
}

function expectedFromSchemaIssue(issue: ValidationIssue): Record<string, unknown> | undefined {
  const details = (issue as Record<string, unknown>).details;
  if (details && typeof details === "object") return details as Record<string, unknown>;
  return undefined;
}

function schemaExamplePatch(code: string): string | undefined {
  if (/UNKNOWN.*COLOR|RAW.*COLOR|COLOR/i.test(code)) {
    return `{"deck":{"themeOverride":{"colors":{"brand.primary":"2563EB"}}},"slides":[{"children":[{"type":"text","color":"brand.primary"}]}]}`;
  }
  if (/MISSING.*CHILDREN|REQUIRED/i.test(code)) {
    return `{"id":"slide_id","children":[{"id":"slide_id.main","type":"text","text":"..."}]}`;
  }
  return undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
