import { resolveFlexMainTargets, type FlexMainSpec } from "./flex-sizing.js";

export interface GridTrackContribution {
  start: number;
  span?: number;
  basis: number;
  min: number;
  weight?: number;
}

export function resolveGridColumnTracks(options: {
  count: number;
  available: number;
  weights?: unknown;
  explicitSizes?: unknown;
}): number[] {
  const count = positiveCount(options.count);
  const available = finiteNonNegative(options.available);
  const explicit = numericArray(options.explicitSizes, count);
  if (explicit) {
    const sum = explicit.reduce((acc, value) => acc + value, 0);
    if (sum > 0) {
      const looksAbsolute = Math.abs(sum - available) < available * 0.5 && explicit.every((value) => value >= 0.3);
      if (looksAbsolute) {
        if (sum <= available) return explicit;
        return explicit.map((value) => (value / sum) * available);
      }
      return normalizeWeights(explicit).map((weight) => available * weight);
    }
  }
  return normalizeWeights(numericArray(options.weights, count) ?? Array.from({ length: count }, () => 1))
    .map((weight) => available * weight);
}

export function resolveGridRowTracks(options: {
  count: number;
  available: number;
  weights?: unknown;
  contributions: GridTrackContribution[];
  defaultMin?: number;
}): number[] {
  const count = positiveCount(options.count);
  const explicitWeights = numericArray(options.weights, count);
  const rowWeights = normalizeWeights(explicitWeights ?? Array.from({ length: count }, () => 1));
  const basisByRow = new Array<number>(count).fill(0);
  const minByRow = new Array<number>(count).fill(finiteNonNegative(options.defaultMin ?? 0));
  const hintedWeights = new Array<number | undefined>(count).fill(undefined);

  for (const contribution of options.contributions) {
    const start = Math.max(0, Math.floor(contribution.start));
    const span = Math.max(1, Math.floor(contribution.span ?? 1));
    const end = Math.min(count, start + span);
    if (start >= count || end <= start) continue;
    const basis = finiteNonNegative(contribution.basis) / (end - start);
    const min = finiteNonNegative(contribution.min) / (end - start);
    for (let row = start; row < end; row++) {
      basisByRow[row] = Math.max(basisByRow[row]!, basis);
      minByRow[row] = Math.max(minByRow[row]!, min);
      if (contribution.weight !== undefined) {
        hintedWeights[row] = Math.max(hintedWeights[row] ?? 0, finitePositive(contribution.weight, 1));
      }
    }
  }

  const specs: FlexMainSpec[] = basisByRow.map((basis, row) => ({
    basis,
    min: minByRow[row]!,
    max: Number.POSITIVE_INFINITY,
    weight: explicitWeights ? rowWeights[row]! : hintedWeights[row] ?? rowWeights[row] ?? 1,
    grow: true,
    fixed: false,
  }));
  return resolveFlexMainTargets(specs, options.available);
}

export function normalizeTrackWeights(value: unknown, count: number): number[] {
  return normalizeWeights(numericArray(value, positiveCount(count)) ?? Array.from({ length: positiveCount(count) }, () => 1));
}

function numericArray(value: unknown, count: number): number[] | undefined {
  if (!Array.isArray(value) || value.length !== count) return undefined;
  return value.map((item) => typeof item === "number" && Number.isFinite(item) && item > 0 ? item : 0);
}

function normalizeWeights(values: number[]): number[] {
  const positive = values.map((value) => Math.max(0, finiteNonNegative(value)));
  const total = positive.reduce((acc, value) => acc + value, 0);
  if (total <= 0) return values.map(() => 1 / Math.max(1, values.length));
  return positive.map((value) => value / total);
}

function positiveCount(value: number): number {
  return Math.max(1, Math.floor(Number.isFinite(value) ? value : 1));
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
