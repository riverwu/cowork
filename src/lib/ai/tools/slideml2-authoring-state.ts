const unvalidatedSlideWrites = new Map<string, number>();
const readRequiredBeforeWrite = new Map<string, string>();

export function recordSlideWrite(deckPath: string): number {
  const next = (unvalidatedSlideWrites.get(deckPath) ?? 0) + 1;
  unvalidatedSlideWrites.set(deckPath, next);
  return next;
}

export function getUnvalidatedSlideWrites(deckPath: string): number {
  return unvalidatedSlideWrites.get(deckPath) ?? 0;
}

export function resetSlideWritesAfterRender(deckPath: string): void {
  unvalidatedSlideWrites.delete(deckPath);
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
