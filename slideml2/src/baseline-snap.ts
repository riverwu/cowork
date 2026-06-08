/**
 * Baseline grid snap pass · M4.2 scaffold
 *
 * DESIGN.md §5.2 calls for all body-style text first-baselines to be snapped
 * to a global baseline grid (default 12pt). The proper implementation needs
 * to participate in layout (snapping post-hoc creates gaps / overlaps unless
 * parent heights are recomputed), so the full pass is deferred to a
 * follow-on PR.
 *
 * This module exposes the API surface the future pass will use, plus a
 * pure analysis utility that reports baseline misalignment without
 * mutating geometry — useful for diagnostics and for guiding the layout
 * solver in a future revision.
 */
import { BASELINE_GRID_PT, pt } from "./design-tokens.js";

export interface BaselineSnapOptions {
  /** Baseline grid unit in pt. Default DESIGN.md §5.2 = 12pt. */
  gridPt: number;
}

/** Compute the snap delta in cm needed to align a baseline-y to the grid. */
export function baselineSnapDeltaCm(baselineYCm: number, options: Partial<BaselineSnapOptions> = {}): number {
  const gridCm = pt(options.gridPt ?? BASELINE_GRID_PT);
  if (gridCm <= 0) return 0;
  const remainder = baselineYCm - Math.floor(baselineYCm / gridCm) * gridCm;
  // Snap to the nearest line — positive or negative delta.
  return remainder >= gridCm / 2 ? gridCm - remainder : -remainder;
}

/** Returns true if a baseline is already grid-aligned within a 0.01cm tolerance. */
export function isBaselineAligned(baselineYCm: number, options: Partial<BaselineSnapOptions> = {}): boolean {
  return Math.abs(baselineSnapDeltaCm(baselineYCm, options)) <= 0.01;
}
