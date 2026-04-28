/**
 * Text-density presets — agent-facing concept that pairs (font size +
 * line spacing + character budget) into a single named choice.
 *
 * Layouts with a text body slot expose a `density` enum slot so the
 * agent can match the visual density to the actual content length.
 * Density also drives the validator's DENSITY_OVERFLOW soft check
 * (the layout's hard `maxChars` is preserved as an absolute upper bound).
 *
 * Budget numbers are calibrated for a half-slide column at 16:9 / 25.4cm
 * × 14.3cm. A full-slide single-column layout (e.g. `prose`) gets ~1.5×
 * the budget; that's documented in each layout's description.
 */

export type Density = "loose" | "normal" | "dense" | "micro";
export const DENSITY_VALUES: readonly Density[] = ["loose", "normal", "dense", "micro"];

export interface DensityPreset {
  /** Run font size in OOXML half-points. */
  sizeHalfPt: number;
  /** Per-paragraph line spacing in half-points. */
  lineSpacingHalfPt: number;
  /** Space-after in half-points. */
  spaceAfterHalfPt: number;
  /** Approx character budget for a half-slide column (latin). */
  latinBudget: number;
  /** Approx character budget for the same column (CJK — each glyph wider). */
  cjkBudget: number;
}

export const DENSITY: Record<Density, DensityPreset> = {
  loose:  { sizeHalfPt: 28, lineSpacingHalfPt: 64, spaceAfterHalfPt: 24, latinBudget: 180,  cjkBudget: 110 },
  normal: { sizeHalfPt: 22, lineSpacingHalfPt: 52, spaceAfterHalfPt: 18, latinBudget: 360,  cjkBudget: 225 },
  dense:  { sizeHalfPt: 18, lineSpacingHalfPt: 44, spaceAfterHalfPt: 14, latinBudget: 720,  cjkBudget: 450 },
  micro:  { sizeHalfPt: 14, lineSpacingHalfPt: 36, spaceAfterHalfPt: 10, latinBudget: 1200, cjkBudget: 750 },
};

/**
 * Pick a preset by name with a safe default. Accepts undefined / unknown
 * input so layouts can pass `ctx.slot<string>("density")` directly.
 */
export function densityPreset(value: unknown, fallback: Density = "normal"): DensityPreset {
  const v = typeof value === "string" && (DENSITY_VALUES as readonly string[]).includes(value)
    ? (value as Density)
    : fallback;
  return DENSITY[v];
}

/**
 * Best-fit density for a given character count on a half-slide column.
 * Used by validators and (optionally) layouts that auto-pick when
 * `density` is omitted.
 */
export function suggestDensity(charCount: number, cjk: boolean): Density {
  for (const d of DENSITY_VALUES) {
    const budget = cjk ? DENSITY[d].cjkBudget : DENSITY[d].latinBudget;
    if (charCount <= budget) return d;
  }
  return "micro";
}
