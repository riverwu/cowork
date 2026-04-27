/**
 * WCAG 2.x contrast utilities for theme validation.
 *
 * The Pptx skill notes "low-contrast text" as the most common AI-generated
 * deck failure. We compute the WCAG contrast ratio at theme-load and
 * either warn or fail when key token pairings violate the threshold.
 *
 * Targets (WCAG AA):
 *   - normal body text vs background    ≥ 4.5
 *   - large text (≥ 18pt OR bold ≥ 14pt) ≥ 3.0
 *   - UI elements (icons, focus rings)  ≥ 3.0
 *
 * We check the load-bearing pairings only — themes can opt into stricter
 * AAA checks via `theme.style.contrastTarget = "AAA"`.
 */

const HEX_RE = /^[0-9a-fA-F]{6}$/;

export type ContrastLevel = "AA" | "AAA";

export interface ContrastReport {
  ok: boolean;
  ratios: Array<{ name: string; tokens: [string, string]; ratio: number; required: number; passes: boolean }>;
  warnings: string[];
}

/** Compute the relative luminance of a 6-char hex color per WCAG 2.x. */
export function relativeLuminance(hex: string): number {
  if (!HEX_RE.test(hex)) {
    throw new Error(`relativeLuminance: invalid hex "${hex}" (expected 6-char without #).`);
  }
  const r = channelLuma(parseInt(hex.slice(0, 2), 16));
  const g = channelLuma(parseInt(hex.slice(2, 4), 16));
  const b = channelLuma(parseInt(hex.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function channelLuma(byte: number): number {
  const c = byte / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG contrast ratio between two hex colors. Always ≥ 1; ≥ 4.5 = AA body. */
export function contrastRatio(fg: string, bg: string): number {
  const lf = relativeLuminance(fg);
  const lb = relativeLuminance(bg);
  const lighter = Math.max(lf, lb);
  const darker = Math.min(lf, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Audit the load-bearing token pairings of a theme. Returns a structured
 * report; callers decide whether to throw, warn, or ignore based on
 * `theme.style.contrastTarget`.
 *
 * Pairings checked:
 *   1. text-strong on bg-canvas   (body text on slide bg)         AA: 4.5
 *   2. text-strong on bg-card     (body text on card)             AA: 4.5
 *   3. text-muted on bg-canvas    (subtitles/captions)            AA: 4.5
 *   4. brand-primary on bg-canvas (KPI value, accent text)        AA: 3.0 (large)
 *   5. accent on bg-canvas        (decorative)                    AA: 3.0
 *   6. text-strong on brand-deep  (text over a dark accent panel) AA: 4.5
 */
export function auditThemeContrast(
  tokens: Record<string, unknown>,
  level: ContrastLevel = "AA",
): ContrastReport {
  const aa = level === "AAA";
  const NORMAL = aa ? 7.0 : 4.5;
  const LARGE  = aa ? 4.5 : 3.0;

  const get = (name: string): string | undefined => {
    const v = tokens[name];
    return typeof v === "string" && HEX_RE.test(v) ? v : undefined;
  };

  const pairings: Array<{ name: string; fg?: string; bg?: string; required: number; bestText?: boolean }> = [
    { name: "body text on canvas",       fg: get("text-strong"),   bg: get("bg-canvas"),     required: NORMAL },
    { name: "body text on card",         fg: get("text-strong"),   bg: get("bg-card"),       required: NORMAL },
    { name: "muted text on canvas",      fg: get("text-muted"),    bg: get("bg-canvas"),     required: NORMAL },
    { name: "brand-primary on canvas",   fg: get("brand-primary"), bg: get("bg-canvas"),     required: LARGE  },
    { name: "accent on canvas",          fg: get("accent"),        bg: get("bg-canvas"),     required: LARGE  },
    // Closing / section-divider layouts use the `bestTextOn` primitive to
    // pick whichever of (text-strong, white) gives the highest contrast on
    // brand-deep. Audit the EFFECTIVE contrast — not necessarily text-strong.
    { name: "best text on brand-deep",   fg: get("text-strong"),   bg: get("brand-deep"),    required: NORMAL, bestText: true },
  ];

  const ratios: ContrastReport["ratios"] = [];
  const warnings: string[] = [];
  let ok = true;
  for (const p of pairings) {
    if (!p.fg || !p.bg) continue;
    let r: number;
    let usedFg: string;
    if (p.bestText) {
      const rText = contrastRatio(p.fg, p.bg);
      const rWhite = contrastRatio("FFFFFF", p.bg);
      r = Math.max(rText, rWhite);
      usedFg = rWhite > rText ? "FFFFFF" : p.fg;
    } else {
      r = contrastRatio(p.fg, p.bg);
      usedFg = p.fg;
    }
    const passes = r >= p.required;
    if (!passes) ok = false;
    ratios.push({
      name: p.name,
      tokens: [usedFg, p.bg],
      ratio: Math.round(r * 100) / 100,
      required: p.required,
      passes,
    });
    if (!passes) {
      warnings.push(
        `Contrast ${r.toFixed(2)}:1 between "${usedFg}" and "${p.bg}" fails ${level} threshold ${p.required.toFixed(1)}:1 (${p.name}).`,
      );
    }
  }
  return { ok, ratios, warnings };
}
