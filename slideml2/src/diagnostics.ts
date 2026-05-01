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
    | "LOW_CONTRAST";
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
}

let diagnostics: LayoutDiagnostic[] = [];

export function pushDiagnostic(d: LayoutDiagnostic): void {
  diagnostics.push(d);
}

export function getRenderDiagnostics(): LayoutDiagnostic[] {
  return diagnostics.slice();
}

export function clearRenderDiagnostics(): void {
  diagnostics = [];
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
