import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createSourceDeck, normalizeSlide } from "./source-deck.js";
import { renderSourceDeckToPptx } from "./render.js";
import { validateDeck } from "./validate.js";
import type { DeckSpec, Slideml2SourceDeck, SlideV2 } from "./types.js";

export async function createDeck(deckPath: string, options: { title?: string; theme?: string; brand?: DeckSpec["brand"] } = {}): Promise<DeckOpResult> {
  const deck = createSourceDeck(options);
  await writeDeck(deckPath, deck);
  return summary(deck, { ok: true });
}

export async function setDeckProps(deckPath: string, props: Partial<DeckSpec>): Promise<DeckOpResult> {
  const deck = await readDeck(deckPath);
  const { slides: _slides, ...allowed } = props as Partial<DeckSpec> & { slides?: unknown };
  // Theme overrides deep-merge so the agent can extend (not replace) prior
  // theme settings across multiple set_theme calls.
  if (allowed.themeOverride) {
    deck.deck.themeOverride = mergeOverride(deck.deck.themeOverride, allowed.themeOverride);
    delete (allowed as { themeOverride?: unknown }).themeOverride;
  }
  deck.deck = { ...deck.deck, ...allowed };
  await writeDeck(deckPath, deck);
  return summary(deck, { ok: true });
}

function mergeOverride(prev: DeckSpec["themeOverride"] | undefined, next: NonNullable<DeckSpec["themeOverride"]>): DeckSpec["themeOverride"] {
  const base = prev || {};
  return {
    ...base,
    ...next,
    colors: { ...(base.colors || {}), ...(next.colors || {}) },
    text: mergeKeyed(base.text, next.text),
    component: mergeKeyed(base.component, next.component),
    tone: { ...(base.tone || {}), ...(next.tone || {}) },
    layout: { ...(base.layout || {}), ...(next.layout || {}) },
    fonts: {
      latin: next.fonts?.latin ?? base.fonts?.latin,
      cjk: next.fonts?.cjk ?? base.fonts?.cjk,
      mono: next.fonts?.mono ?? base.fonts?.mono,
    },
    chart: { series: next.chart?.series ?? base.chart?.series },
    chrome: { ...(base.chrome || {}), ...(next.chrome || {}) },
    imageGrowWeight: next.imageGrowWeight ?? base.imageGrowWeight,
    sizeScale: { ...(base.sizeScale || {}), ...(next.sizeScale || {}) },
  };
}

function mergeKeyed<T extends Record<string, unknown>>(prev: Record<string, T> | undefined, next: Record<string, T> | undefined): Record<string, T> | undefined {
  if (!prev && !next) return undefined;
  const out: Record<string, T> = { ...(prev || {}) };
  if (next) for (const [k, v] of Object.entries(next)) out[k] = { ...(prev?.[k] || ({} as T)), ...v };
  return out;
}

export async function appendSlide(deckPath: string, slide: SlideV2): Promise<DeckOpResult> {
  const deck = await readDeck(deckPath);
  deck.slides.push(normalizeSlide(slide));
  await writeDeck(deckPath, deck);
  return summary(deck, { ok: true, insertedAt: deck.slides.length - 1 });
}

export async function insertSlide(deckPath: string, at: number, slide: SlideV2): Promise<DeckOpResult> {
  const deck = await readDeck(deckPath);
  const index = Math.max(0, Math.min(at, deck.slides.length));
  deck.slides.splice(index, 0, normalizeSlide(slide));
  await writeDeck(deckPath, deck);
  return summary(deck, { ok: true, insertedAt: index });
}

export async function replaceSlide(deckPath: string, slideIdOrIndex: string | number, slide: SlideV2): Promise<DeckOpResult> {
  const deck = await readDeck(deckPath);
  const index = findSlideIndex(deck, slideIdOrIndex);
  if (index < 0) return summary(deck, { ok: false, error: `Slide not found: ${slideIdOrIndex}` });
  deck.slides[index] = normalizeSlide(slide);
  await writeDeck(deckPath, deck);
  return summary(deck, { ok: true, replacedAt: index });
}

export async function deleteSlide(deckPath: string, slideIdOrIndex: string | number): Promise<DeckOpResult> {
  const deck = await readDeck(deckPath);
  const index = findSlideIndex(deck, slideIdOrIndex);
  if (index < 0) return summary(deck, { ok: false, error: `Slide not found: ${slideIdOrIndex}` });
  deck.slides.splice(index, 1);
  await writeDeck(deckPath, deck);
  return summary(deck, { ok: true, deletedAt: index });
}

export async function validateDeckPath(deckPath: string) {
  return validateDeck(await readDeck(deckPath));
}

export async function renderDeck(deckPath: string, outputPath: string) {
  const deck = await readDeck(deckPath);
  const validation = validateDeck(deck);
  const rendered = await renderSourceDeckToPptx(deck, outputPath);
  return { ...rendered, validation };
}

export async function readDeck(deckPath: string): Promise<Slideml2SourceDeck> {
  const parsed = JSON.parse(await readFile(deckPath, "utf8")) as Slideml2SourceDeck;
  if (parsed.slideml2 !== 2) throw new Error(`Expected SlideML2 source deck with slideml2: 2 at ${deckPath}`);
  return parsed;
}

export async function writeDeck(deckPath: string, deck: Slideml2SourceDeck): Promise<void> {
  await mkdir(dirname(deckPath), { recursive: true });
  await writeFile(deckPath, JSON.stringify(deck, null, 2), "utf8");
}

export interface DeckOpResult {
  ok: boolean;
  error?: string;
  slideCount: number;
  insertedAt?: number;
  replacedAt?: number;
  deletedAt?: number;
  slides: Array<{ index: number; id: string; title?: string }>;
}

function summary(deck: Slideml2SourceDeck, extra: Partial<DeckOpResult>): DeckOpResult {
  return {
    ok: extra.ok ?? true,
    error: extra.error,
    slideCount: deck.slides.length,
    insertedAt: extra.insertedAt,
    replacedAt: extra.replacedAt,
    deletedAt: extra.deletedAt,
    slides: deck.slides.map((slide, index) => ({ index, id: slide.id, title: slide.title })),
  };
}

function findSlideIndex(deck: Slideml2SourceDeck, slideIdOrIndex: string | number): number {
  if (typeof slideIdOrIndex === "number") return slideIdOrIndex >= 0 && slideIdOrIndex < deck.slides.length ? slideIdOrIndex : -1;
  return deck.slides.findIndex((slide) => slide.id === slideIdOrIndex);
}
