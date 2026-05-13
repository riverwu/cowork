import { rectsOverlap as geometryRectsOverlap, type RectLike } from "./layout/geometry.js";
import type { RenderDiagnosticCode } from "./diagnostic-codes.js";

/**
 * Render diagnostics: structured, agent-readable feedback from the layout solver
 * and renderer. Replaces the legacy Set<string> warning channels.
 *
 * Severity: "warn" still produces a slide; "error" means content was dropped or
 * cannot be reliably positioned.
 *
 * Codes (stable; agents may match on them):
 *   OVERFLOW         children exceed available size; solver shrank/dropped to fit
 *   DROP             a child was removed because no fit was possible
 *   COLLISION        two non-overlay rects intersect after layout
 *   UNKNOWN_COLOR    color token not found in current theme
 *   UNKNOWN_STYLE    text style token not found in current theme
 *   TINY_RECT        a node was assigned width or height < 0.18cm; rendering skipped
 *   SQUASHED         a meaningful node was assigned a technically renderable but unusably compressed rect
 *   TRUNCATED        text was clipped or autofit-shrunk to fit
 *   DEMOTED          density/style was demoted (e.g. bullets comfortable->compact)
 *   FALLBACK_FAILED  fallback ladder exhausted; content cannot fit
 *   FEATURE_CARD_OVER_CAPACITY feature card cannot keep title + body readable in its assigned slot
 *   CODE_BLOCK_OVERFLOW full code listing cannot fit in its assigned area
 *   TITLE_OCCLUDED   slide title is covered by a later solid-fill shape
 *   PIE_LABELS_HIDDEN pie/doughnut chart hides slice labels
 *   EMPTY_CHART_DATA chart has no renderable labels/series after data binding
 *   EMPTY_TABLE_DATA table has authored object rows but no body cell text matched columns/headers
 *   PAGE_OVER_CAPACITY multiple large components together exceed a single readable page budget
 *   REGION_OVER_CAPACITY a split/rail/local region has more direct content blocks than its readable budget
 */
export interface LayoutDiagnostic {
  severity: "info" | "warn" | "error";
  code: RenderDiagnosticCode;
  slideId?: string;
  nodeId?: string;
  message: string;
  suggestion?: string;
  measured?: {
    available?: number;
    needed?: number;
    heightAvailable?: number;
    heightNeeded?: number;
    unbreakableNeeded?: number;
    deltaCm?: number;
    rect?: { x: number; y: number; w: number; h: number };
    other?: { x: number; y: number; w: number; h: number; nodeId?: string };
    overlap?: { x: number; y: number; w: number; h: number };
    overlapAreaCm2?: number;
    overlapRatio?: number;
    relationship?: string;
    parentId?: string;
    lineCount?: number;
    renderedRows?: number;
    estimatedCapacityLines?: number;
    columns?: number;
    columnCount?: number;
    dataRowCount?: number;
    estimatedVisibleRowsFit?: number;
    minWidthCm?: number;
    minHeightCm?: number;
    labelCount?: number;
    seriesCount?: number;
    showLegend?: boolean;
    aspectRatio?: number;
    maxAspectRatio?: number;
    recommendedAspectRatio?: number;
    aspectNeededHeightCm?: number;
    minWidthAtCurrentHeightCm?: number;
    aspectReason?: string;
    hardMinHeightCm?: number;
    bodyNeededHeightCm?: number;
    chromeHeightCm?: number;
    outerNeededHeightCm?: number;
    outerRect?: { x: number; y: number; w: number; h: number };
    sourceAspectRatio?: number;
    frameAspectRatio?: number;
    aspectDelta?: number;
    visibleFraction?: number;
    evidenceRatio?: number;
    recommendedRatio?: number;
    stepCount?: number;
    itemCount?: number;
    metricCount?: number;
    richCount?: number;
    entryCount?: number;
    perStepWidthCm?: number;
    perStepHeightCm?: number;
    perItemWidthCm?: number;
    perItemHeightCm?: number;
    perMetricWidthCm?: number;
    perMetricHeightCm?: number;
    recommendedColumns?: number;
    recommendedRows?: number;
    recommendedDirection?: string;
    scaleSuggestion?: string;
    ringDiameterCm?: number;
    minRingDiameterCm?: number;
    legendWidthCm?: number;
    worstRow?: { index: number; neededCm: number; availableCm: number };
    density?: string;
    fontSize?: number;
    componentCount?: number;
    largeComponentCount?: number;
    capacityRatio?: number;
    components?: Array<{ nodeId: string; role: string; assignedHeightCm: number; neededHeightCm: number }>;
  };
  /**
   * For LOW_CONTRAST: ordered chain of surfaces that determined the comparison
   * background, e.g. ["slide.bg:FAF0E6", "band(s1.b).fill:2C1810",
   * "text(s1.t).color:FFFFFF"]. Lets agents see *why* the diagnostic picked
   * the surface it did, instead of guessing.
   */
  surfaceTrail?: string[];
  /**
   * Set when this diagnostic represents a cluster (e.g. all texts of the same
   * color on the same surface). The representative diagnostic carries the
   * cluster size and the affected nodes; per-node duplicates are suppressed.
   */
  aggregated?: {
    affectedNodes: Array<{ nodeId: string; sample?: string }>;
    count: number;
  };
  /**
   * For FALLBACK_FAILED / SQUASHED on flow content: the nearest ancestor that
   * imposed a hard size on the failing axis. Lets agents read the diagnostic
   * and know exactly which fixedHeight/fixedWidth to relax — without it, the
   * suggestion "increase the parent's allotted height" is ambiguous.
   */
  constrainedBy?: {
    ancestorId: string;
    prop: "fixedHeight" | "fixedWidth" | "height" | "width" | "minHeight" | "minWidth" | "maxHeight" | "maxWidth";
    value: number;
  };
}

let diagnostics: LayoutDiagnostic[] = [];
let diagnosticDedupKeys: Set<string> = new Set();

/**
 * Build a stable deduplication key for a diagnostic. The renderer's measure
 * pass and render pass both call applyFallbackLadder/SQUASHED logic, which
 * historically caused the same FALLBACK_FAILED to fire twice (once with the
 * slide context set, once without — the rm8s07 log showed pairs of identical
 * diagnostics confusing the agent). The key includes the rounded quantitative
 * fields that distinguish repeated issues on the same node, and omits empty
 * optional fields so non-collision diagnostics do not carry noise from the
 * collision-specific dimensions.
 */
function diagnosticDedupKey(d: LayoutDiagnostic, includeSlide = true): string {
  const key: Record<string, unknown> = { code: d.code };
  const slide = includeSlide ? d.slideId || "" : "";
  if (slide) key.slide = slide;
  if (d.nodeId) key.node = d.nodeId;
  if (d.measured?.deltaCm !== undefined) key.delta = Math.round(d.measured.deltaCm * 100);
  if (d.measured?.other?.nodeId) key.other = d.measured.other.nodeId;
  if (d.measured?.relationship) key.relationship = d.measured.relationship;
  if (d.measured?.overlapAreaCm2 !== undefined) key.overlapArea = Math.round(d.measured.overlapAreaCm2 * 100);
  if (d.measured?.overlap) {
    key.overlapRect = [d.measured.overlap.x, d.measured.overlap.y, d.measured.overlap.w, d.measured.overlap.h]
      .map((value) => Math.round(value * 100));
  }
  // Cluster diagnostics encode the affected count; without that, identical
  // first-of-cluster messages from two passes would dedupe each other.
  if (d.aggregated?.count !== undefined) key.clusterCount = d.aggregated.count;
  return JSON.stringify(key);
}

export function pushDiagnostic(d: LayoutDiagnostic): void {
  const key = diagnosticDedupKey(d);
  // Dedupe across (slide,node,code) AND across (any-slide,node,code) — the
  // second emission from the render pass often has slideId="" while the first
  // has the real slideId. We treat them as the same issue.
  const sansSlide = diagnosticDedupKey(d, false);
  if (diagnosticDedupKeys.has(key) || diagnosticDedupKeys.has(sansSlide)) return;
  diagnosticDedupKeys.add(key);
  diagnosticDedupKeys.add(sansSlide);
  diagnostics.push(d);
}

export function getRenderDiagnostics(): LayoutDiagnostic[] {
  return diagnostics.slice();
}

export function clearRenderDiagnostics(): void {
  diagnostics = [];
  diagnosticDedupKeys = new Set();
}

/** Filter helpers for agents and tests. */
export function getDiagnosticsBySeverity(severity: "info" | "warn" | "error"): LayoutDiagnostic[] {
  return diagnostics.filter((d) => d.severity === severity);
}

export function getDiagnosticsByCode(code: LayoutDiagnostic["code"]): LayoutDiagnostic[] {
  return diagnostics.filter((d) => d.code === code);
}

/**
 * WCAG relative luminance + contrast ratio helpers. Used by the renderer's
 * post-pass to detect LOW_CONTRAST text — the most common visual defect
 * agents introduce when they assign a brand color to text on a tinted
 * surface or, vice versa, an inverse color on a light background.
 */
function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const cleaned = hex.replace(/^#/, "");
  if (!/^[0-9A-Fa-f]{6}$/.test(cleaned)) return 1;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(fgHex: string, bgHex: string): number {
  const lf = relativeLuminance(fgHex);
  const lb = relativeLuminance(bgHex);
  const [hi, lo] = lf > lb ? [lf, lb] : [lb, lf];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * WCAG AA thresholds: 4.5:1 for body text, 3.0:1 for large text (≥ 18pt
 * regular or ≥ 14pt bold). We err on the strict side — even a "decorative"
 * cover hero deserves to be readable.
 */
export function contrastThreshold(fontPt: number, bold: boolean): number {
  const isLarge = fontPt >= 18 || (fontPt >= 14 && bold);
  return isLarge ? 3.0 : 4.5;
}

/** Two rects overlap if they share any interior. Tangent edges do not count. */
export function rectsOverlap(
  a: RectLike,
  b: RectLike,
): boolean {
  return geometryRectsOverlap(a, b);
}
