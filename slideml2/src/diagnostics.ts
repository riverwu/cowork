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
 */
export interface LayoutDiagnostic {
  severity: "warn" | "error";
  code:
    | "OVERFLOW"
    | "DROP"
    | "COLLISION"
    | "UNKNOWN_COLOR"
    | "UNKNOWN_STYLE"
    | "TINY_RECT"
    | "SQUASHED"
    | "TRUNCATED"
    | "DEMOTED"
    | "FALLBACK_FAILED"
    | "LOW_CONTRAST"
    /** LOW_CONTRAST that the renderer auto-rewrote to a contrasting hex. The
     *  rendered PPTX is readable; the diagnostic remains so the agent can
     *  decide to fix the underlying theme token, but it doesn't block. */
    | "LOW_CONTRAST_FIXED"
    /** A non-text shape (decorative rule, divider, accent stripe, dot) whose
     *  fill matches its surface (slide bg or parent fill) is visually
     *  invisible. Severity warn; it doesn't block render but hides the
     *  agent's intended visual. */
    | "SHAPE_INVISIBLE"
    /** SHAPE_INVISIBLE that was small/decorative enough for the renderer to
     *  auto-promote to a contrasting accent color. The rendered PPTX shows
     *  the decoration; agent can override by setting an explicit fill. */
    | "SHAPE_INVISIBLE_FIXED";
  slideId?: string;
  nodeId?: string;
  message: string;
  suggestion?: string;
  measured?: {
    available?: number;
    needed?: number;
    deltaCm?: number;
    rect?: { x: number; y: number; w: number; h: number };
    other?: { x: number; y: number; w: number; h: number; nodeId?: string };
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
 * diagnostics confusing the agent). The key is intentionally narrow: code +
 * nodeId + slideId + the rounded delta — so distinct issues on the same node
 * still surface, but exact duplicates from a second measure pass are dropped.
 */
function diagnosticDedupKey(d: LayoutDiagnostic): string {
  const slide = d.slideId || "";
  const node = d.nodeId || "";
  const delta = d.measured?.deltaCm !== undefined ? Math.round(d.measured.deltaCm * 100) : "";
  // Cluster diagnostics encode the affected count; without that, identical
  // first-of-cluster messages from two passes would dedupe each other.
  const clusterCount = d.aggregated?.count !== undefined ? d.aggregated.count : "";
  return `${d.code}|${slide}|${node}|${delta}|${clusterCount}`;
}

export function pushDiagnostic(d: LayoutDiagnostic): void {
  const key = diagnosticDedupKey(d);
  // Dedupe across (slide,node,code) AND across (any-slide,node,code) — the
  // second emission from the render pass often has slideId="" while the first
  // has the real slideId. We treat them as the same issue.
  const sansSlide = `${d.code}||${d.nodeId || ""}|${d.measured?.deltaCm !== undefined ? Math.round(d.measured.deltaCm * 100) : ""}|${d.aggregated?.count !== undefined ? d.aggregated.count : ""}`;
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
export function getDiagnosticsBySeverity(severity: "warn" | "error"): LayoutDiagnostic[] {
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
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  const epsilon = 0.005;
  return (
    a.x + a.w > b.x + epsilon &&
    b.x + b.w > a.x + epsilon &&
    a.y + a.h > b.y + epsilon &&
    b.y + b.h > a.y + epsilon
  );
}
