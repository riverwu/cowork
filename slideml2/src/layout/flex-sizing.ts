export interface FlexMainSpec {
  basis: number;
  min: number;
  max: number;
  weight: number;
  grow: boolean;
  fixed: boolean;
  shrinkWeight?: number;
}

export interface FlexMainTargetOptions {
  autoFillSlack?: boolean;
  onOverflow?: (overflow: number, available: number) => void;
}

const EPSILON = 0.0001;

export function resolveFlexMainTargets(
  specs: FlexMainSpec[],
  availableMain: number,
  options: FlexMainTargetOptions = {},
): number[] {
  if (specs.length === 0) return [];
  const available = Math.max(0, finiteOrZero(availableMain));
  const targets = specs.map((spec) => clampMain(spec.basis, spec.min, spec.max));
  const total = sum(targets);
  if (total > available + EPSILON) return shrinkTargets(specs, targets, available, options);
  if (total < available - EPSILON) return growTargets(specs, targets, available - total, options);
  return targets;
}

function growTargets(specs: FlexMainSpec[], targets: number[], extra: number, options: FlexMainTargetOptions): number[] {
  let remaining = extra;
  let growIndexes = growableIndexes(specs, targets, false);
  if (growIndexes.length === 0 && options.autoFillSlack) {
    growIndexes = growableIndexes(specs, targets, true);
  }
  while (remaining > EPSILON && growIndexes.length > 0) {
    const weights = normalizeWeights(growIndexes.map((index) => positiveNumber(specs[index]!.weight, 1)));
    let consumed = 0;
    growIndexes.forEach((index, weightIndex) => {
      const room = normalizedMax(specs[index]!.max) - targets[index]!;
      const addition = Math.min(room, remaining * weights[weightIndex]!);
      targets[index]! += addition;
      consumed += addition;
    });
    if (consumed <= EPSILON) break;
    remaining -= consumed;
    growIndexes = growIndexes.filter((index) => targets[index]! < normalizedMax(specs[index]!.max) - EPSILON);
  }
  return targets;
}

function shrinkTargets(specs: FlexMainSpec[], targets: number[], available: number, options: FlexMainTargetOptions): number[] {
  let overflow = sum(targets) - available;
  let shrinkable = shrinkableIndexes(specs, targets);
  while (overflow > EPSILON && shrinkable.length > 0) {
    const factors = shrinkable.map((index) => shrinkFactor(specs[index]!, targets[index]!));
    const totalFactor = sum(factors);
    if (totalFactor <= EPSILON) break;
    let consumed = 0;
    shrinkable.forEach((index, factorIndex) => {
      const capacity = Math.max(0, targets[index]! - normalizedMin(specs[index]!.min));
      const reduction = Math.min(capacity, overflow * (factors[factorIndex]! / totalFactor));
      targets[index]! -= reduction;
      consumed += reduction;
    });
    if (consumed <= EPSILON) break;
    overflow = sum(targets) - available;
    shrinkable = shrinkableIndexes(specs, targets);
  }
  if (overflow > EPSILON) {
    options.onOverflow?.(overflow, available);
    return fitToAvailableRespectingFixed(specs, targets, available);
  }
  return targets;
}

function growableIndexes(specs: FlexMainSpec[], targets: number[], includeNonFixed: boolean): number[] {
  return specs
    .map((spec, index) => (!spec.fixed && (includeNonFixed || spec.grow) && targets[index]! < normalizedMax(spec.max) - EPSILON) ? index : -1)
    .filter((index) => index >= 0);
}

function shrinkableIndexes(specs: FlexMainSpec[], targets: number[]): number[] {
  return specs
    .map((spec, index) => (!spec.fixed && targets[index]! > normalizedMin(spec.min) + EPSILON) ? index : -1)
    .filter((index) => index >= 0);
}

function shrinkFactor(spec: FlexMainSpec, target: number): number {
  if (spec.shrinkWeight !== undefined) return Math.max(0, finiteOrZero(spec.shrinkWeight));
  return Math.max(0, target - normalizedMin(spec.min));
}

function fitToAvailableRespectingFixed(specs: FlexMainSpec[], targets: number[], availableMain: number): number[] {
  const fixedTotal = specs.reduce((acc, spec, index) => acc + (spec.fixed ? targets[index]! : 0), 0);
  const flexibleTotal = targets.reduce((acc, target, index) => acc + (specs[index]!.fixed ? 0 : target), 0);
  const flexibleAvailable = Math.max(0, availableMain - fixedTotal);
  if (flexibleTotal <= 0 || flexibleTotal <= flexibleAvailable) return targets;
  const scale = flexibleAvailable / flexibleTotal;
  return targets.map((target, index) => specs[index]!.fixed ? target : target * scale);
}

function clampMain(value: number, min: number, max: number): number {
  const lower = normalizedMin(min);
  const upper = Math.max(lower, normalizedMax(max));
  return Math.max(lower, Math.min(finiteOrZero(value), upper));
}

function normalizedMin(value: number): number {
  return Math.max(0, finiteOrZero(value));
}

function normalizedMax(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : Number.POSITIVE_INFINITY;
}

function positiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function normalizeWeights(values: number[]): number[] {
  const positive = values.map((value) => Number.isFinite(value) && value > 0 ? value : 0);
  const total = sum(positive);
  if (total <= 0) return values.map(() => 1 / Math.max(1, values.length));
  return positive.map((value) => value / total);
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}
