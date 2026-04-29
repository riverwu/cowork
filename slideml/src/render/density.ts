/**
 * Text-density presets — INTERNAL renderer detail. Layouts no longer
 * expose a `density` slot to the agent; instead every text frame uses
 * the fixed RENDER_DEFAULT preset and relies on render-time autoFit
 * (90% font / 20% line-spacing reduction) to absorb overflow gracefully.
 *
 * The validator's hard `maxChars` per slot is calibrated against the
 * RENDER_DEFAULT preset × autoFit headroom (~1.4×), giving a single
 * generous ceiling. When content exceeds that, the agent gets a clear
 * SLOT_OVERFLOW telling it to split the slide or pick a denser layout.
 *
 * Budget numbers are calibrated for a half-slide column at 16:9 / 25.4cm
 * × 14.3cm. Long-form content should use `article-flow`, which paginates
 * a logical source article across physical slides.
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
 * Pick a preset by name with a safe default. Density is no longer agent-
 * facing — the only legitimate caller passing a value is the validator
 * (probing budgets); layout renderers pass undefined to get the fixed
 * RENDER_DEFAULT baseline (defined below).
 */
export function densityPreset(value: unknown, fallback?: Density): DensityPreset {
  const v = typeof value === "string" && (DENSITY_VALUES as readonly string[]).includes(value)
    ? (value as Density)
    : (fallback ?? "dense"); // ← RENDER_DEFAULT inlined to avoid forward-decl
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

/**
 * Single fixed preset every renderer falls back to. "dense" gives a
 * compact-but-readable baseline (9pt body, 22pt line spacing); autoFit
 * absorbs the +40% headroom before content visibly clips.
 */
export const RENDER_DEFAULT: Density = "dense";

/**
 * autoFit headroom multiplier: PowerPoint's `<a:normAutofit fontScale=
 * "90000" lnSpcReduction="20000"/>` yields roughly 1.4× the natural
 * char capacity before content clips. Validator uses this to derive
 * the single MAX_CHARS per slot.
 */
export const AUTOFIT_HEADROOM = 1.4;

/**
 * Single MAX char budget for a half-slide column.
 *   half-column max = densest preset budget × autoFit headroom
 * Latin gets ~1000, CJK gets ~630 per half-column. Layouts apply their
 * own multiplier on top.
 */
export function maxCharBudget(cjk: boolean): number {
  const base = cjk ? DENSITY[RENDER_DEFAULT].cjkBudget : DENSITY[RENDER_DEFAULT].latinBudget;
  return Math.round(base * AUTOFIT_HEADROOM);
}
