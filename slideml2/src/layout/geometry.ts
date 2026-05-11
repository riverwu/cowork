export interface RectLike {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlapMetrics {
  rect: RectLike;
  areaCm2: number;
  ratioOfA: number;
  ratioOfB: number;
  ratioOfSmaller: number;
}

export const GEOMETRY_EPSILON_CM = 0.02;
export const MIN_MEANINGFUL_OVERLAP_AREA_CM2 = 0.05;

export function intersectionRect(a: RectLike, b: RectLike, epsilon = 0): RectLike | undefined {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 + epsilon || y2 <= y1 + epsilon) return undefined;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function overlapMetrics(a: RectLike, b: RectLike, epsilon = 0): OverlapMetrics | undefined {
  const rect = intersectionRect(a, b, epsilon);
  if (!rect) return undefined;
  const areaCm2 = rect.w * rect.h;
  const areaA = Math.max(0.001, a.w * a.h);
  const areaB = Math.max(0.001, b.w * b.h);
  return {
    rect,
    areaCm2,
    ratioOfA: areaCm2 / areaA,
    ratioOfB: areaCm2 / areaB,
    ratioOfSmaller: areaCm2 / Math.min(areaA, areaB),
  };
}

export function meaningfulOverlap(
  a: RectLike,
  b: RectLike,
  options: { epsilonCm?: number; minAreaCm2?: number } = {},
): OverlapMetrics | undefined {
  const epsilon = options.epsilonCm ?? GEOMETRY_EPSILON_CM;
  const metrics = overlapMetrics(a, b, epsilon);
  if (!metrics) return undefined;
  if (metrics.areaCm2 < (options.minAreaCm2 ?? MIN_MEANINGFUL_OVERLAP_AREA_CM2)) return undefined;
  return metrics;
}

export function rectsOverlap(a: RectLike, b: RectLike, epsilon = GEOMETRY_EPSILON_CM): boolean {
  return Boolean(intersectionRect(a, b, epsilon));
}

export function rectOverlapArea(a: RectLike, b: RectLike): number {
  return overlapMetrics(a, b)?.areaCm2 ?? 0;
}

export function coverageRatio(cover: RectLike, target: RectLike): number {
  const overlap = overlapMetrics(cover, target);
  if (!overlap) return 0;
  return overlap.ratioOfB;
}

export function rectContains(outer: RectLike, inner: RectLike, epsilon = 0.03): boolean {
  return inner.x >= outer.x - epsilon
    && inner.y >= outer.y - epsilon
    && inner.x + inner.w <= outer.x + outer.w + epsilon
    && inner.y + inner.h <= outer.y + outer.h + epsilon;
}
