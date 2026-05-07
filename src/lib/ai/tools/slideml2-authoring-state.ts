const unvalidatedSlideWrites = new Map<string, number>();
const unvalidatedSlideWriteTargets = new Map<string, Set<string>>();
const readRequiredBeforeWrite = new Map<string, string>();

export function recordSlideWrite(deckPath: string, target?: string): number {
  const next = (unvalidatedSlideWrites.get(deckPath) ?? 0) + 1;
  unvalidatedSlideWrites.set(deckPath, next);
  if (target) {
    const targets = unvalidatedSlideWriteTargets.get(deckPath) ?? new Set<string>();
    targets.add(target);
    unvalidatedSlideWriteTargets.set(deckPath, targets);
  }
  return next;
}

export function getUnvalidatedSlideWrites(deckPath: string): number {
  return unvalidatedSlideWrites.get(deckPath) ?? 0;
}

export function hasUnvalidatedSlideWriteTarget(deckPath: string, target: string): boolean {
  return unvalidatedSlideWriteTargets.get(deckPath)?.has(target) ?? false;
}

export function resetSlideWritesAfterRender(deckPath: string): void {
  unvalidatedSlideWrites.delete(deckPath);
  unvalidatedSlideWriteTargets.delete(deckPath);
}

export function requireDeckReadBeforeWrite(deckPath: string, reason: string): void {
  readRequiredBeforeWrite.set(deckPath, reason);
}

export function clearDeckReadRequirement(deckPath: string): void {
  readRequiredBeforeWrite.delete(deckPath);
}

export function getDeckReadRequirement(deckPath: string): string | null {
  return readRequiredBeforeWrite.get(deckPath) ?? null;
}

export function resetAllSlideMl2AuthoringState(): void {
  unvalidatedSlideWrites.clear();
  unvalidatedSlideWriteTargets.clear();
  readRequiredBeforeWrite.clear();
}
