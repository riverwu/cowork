export const RENDER_DIAGNOSTIC_CODES = [
  "OVERFLOW",
  "DROP",
  "COLLISION",
  "STRUCTURAL_OVERLAP",
  "SIBLING_INK_OVERLAP",
  "OVERLAY_OCCLUDES_FLOW",
  "DECORATIVE_OVERLAP",
  "EDGE_CLIPPED",
  "OFF_SLIDE",
  "TIGHT_GAP",
  "UNKNOWN_COLOR",
  "UNKNOWN_STYLE",
  "TINY_RECT",
  "SQUASHED",
  "TRUNCATED",
  "DEMOTED",
  "FALLBACK_FAILED",
  "FEATURE_CARD_OVER_CAPACITY",
  "CODE_BLOCK_OVERFLOW",
  "TITLE_OCCLUDED",
  "PIE_LABELS_HIDDEN",
  "EMPTY_CHART_DATA",
  "EMPTY_TABLE_DATA",
  "LOW_CONTRAST",
  "LOW_CONTRAST_FIXED",
  "SHAPE_INVISIBLE",
  "SHAPE_INVISIBLE_FIXED",
] as const;

export type RenderDiagnosticCode = typeof RENDER_DIAGNOSTIC_CODES[number];

export const SOURCE_VALIDATION_CODES = [
  "NODE_OUT_OF_BOUNDS",
  "TEXT_BOX_TOO_SHORT",
  "TOP_LEVEL_LAYOUT_OVERLAP",
] as const;

export type SourceValidationCode = typeof SOURCE_VALIDATION_CODES[number];

export const SOURCE_VALIDATION_CODE: { readonly [K in SourceValidationCode]: K } = {
  NODE_OUT_OF_BOUNDS: "NODE_OUT_OF_BOUNDS",
  TEXT_BOX_TOO_SHORT: "TEXT_BOX_TOO_SHORT",
  TOP_LEVEL_LAYOUT_OVERLAP: "TOP_LEVEL_LAYOUT_OVERLAP",
} as const;

export const BLOCKING_RENDER_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  "FALLBACK_FAILED",
  "FEATURE_CARD_OVER_CAPACITY",
  "CODE_BLOCK_OVERFLOW",
  "COLLISION",
  "STRUCTURAL_OVERLAP",
  "SIBLING_INK_OVERLAP",
  "OVERLAY_OCCLUDES_FLOW",
  "TITLE_OCCLUDED",
  "EMPTY_CHART_DATA",
  "EMPTY_TABLE_DATA",
  "TINY_RECT",
  "LOW_CONTRAST",
  "SHAPE_INVISIBLE",
  "UNKNOWN_COLOR",
  "UNKNOWN_STYLE",
  "OFF_SLIDE",
]);

export const QUALITY_RENDER_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  "TRUNCATED",
  "OVERFLOW",
  "DROP",
  "DEMOTED",
  "LOW_CONTRAST_FIXED",
  "SHAPE_INVISIBLE_FIXED",
  "DECORATIVE_OVERLAP",
  "EDGE_CLIPPED",
  "TIGHT_GAP",
  "SQUASHED",
  "PIE_LABELS_HIDDEN",
]);

export function isBlockingRenderDiagnostic(code: unknown, severity?: unknown): boolean {
  if (severity === "error") return true;
  return typeof code === "string" && BLOCKING_RENDER_DIAGNOSTIC_CODES.has(code);
}

export function isQualityRenderDiagnostic(code: unknown): boolean {
  return typeof code === "string" && QUALITY_RENDER_DIAGNOSTIC_CODES.has(code);
}
