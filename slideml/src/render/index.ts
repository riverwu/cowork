/**
 * Render orchestrator: take a parsed deck spec + a loaded theme and produce
 * a `SlideAst[]` ready for the OOXML emitter.
 *
 * This is the API the parser/CLI/agent calls. Layouts and components are
 * black boxes from here on — they only see the LayoutContext we hand them.
 */

import { applyChrome } from "./chrome.js";
import { buildLayoutContext, type LayoutFn } from "./layout-context.js";
import { SLIDE_SIZES } from "../units.js";
import type { LoadedTheme } from "../theme/types.js";
import type { DeckAst, SlideAst, SlideBackground } from "../emitter/types.js";

/** A pre-validation deck spec. The parser produces this shape. */
export interface DeckSpec {
  /** SlideML schema version. Currently must be `1`. */
  slideml: 1;
  deck: {
    size: keyof typeof SLIDE_SIZES;
    language?: string;
    theme: string;
    defaults?: Record<string, string>;
    /** Default page header for every slide; per-slide override allowed. */
    header?: BandSpec | null;
    /** Default page footer for every slide; per-slide override allowed. */
    footer?: BandSpec | null;
    /** Default slide background; per-slide override allowed. */
    background?: BackgroundSpec | null;
  };
  slides: SlideSpec[];
}

/**
 * Header / footer band content. A single string is shorthand for `{ left }`.
 * `center` slot is rendered between left and right; layouts choose which to
 * actually use based on horizontal space.
 */
export type BandSpec =
  | string
  | { left?: string; center?: string; right?: string };

/**
 * Slide background. `{ color }` or `{ image: { src, ... } }`. Pass `null`
 * at the slide level to clear a deck-level default.
 */
export type BackgroundSpec =
  | { color: string }
  | { image: { src: string; alt?: string; opacity?: number } };

/**
 * Per-slide chrome control.
 *
 *   "default" — keep everything the theme declares.
 *   "none"    — suppress every chrome module.
 *   object    — selective control. Three orthogonal mechanisms:
 *
 *     1. legacy booleans (`header`/`footer`/`brandBar`/`pageNumber`):
 *        flip individual theme-declared modules on/off.
 *     2. `enable`: list of chrome module names to ADD for this slide,
 *        even if the theme doesn't declare them (e.g. add a one-off
 *        progress-bar to the cover slide).
 *     3. `disable`: list of chrome module names to suppress for this
 *        slide (modern alternative to the legacy booleans).
 *     4. `override`: per-module parameter overrides. Each chrome module
 *        defines what overrides it accepts; e.g. page-footer accepts
 *        `{ left, center, right }`, brand-bar accepts `{ color }`,
 *        watermark accepts `{ text, color, alpha }`.
 */
export type ChromeSpec =
  | "default"
  | "none"
  | {
      header?: boolean;
      footer?: boolean;
      brandBar?: boolean;
      pageNumber?: boolean;
      enable?: readonly string[];
      disable?: readonly string[];
      override?: Record<string, Record<string, unknown>>;
    };

export interface SlideSpec {
  layout: string;
  chrome?: ChromeSpec;
  notes?: string;
  transition?: "none" | "fade";
  slots: Record<string, unknown>;
  /** Per-slide override of the deck-level header (pass `null` to clear). */
  header?: BandSpec | null;
  /** Per-slide override of the deck-level footer (pass `null` to clear). */
  footer?: BandSpec | null;
  /** Per-slide override of the deck-level background (pass `null` to clear). */
  background?: BackgroundSpec | null;
}

/** Resolve a BandSpec to its three slots, treating string as shorthand for left. */
export function resolveBand(spec: BandSpec | undefined | null): { left?: string; center?: string; right?: string } | undefined {
  if (spec === undefined || spec === null) return undefined;
  if (typeof spec === "string") return { left: spec };
  return spec;
}

/**
 * Render a parsed `DeckSpec` against a loaded theme. Produces a `DeckAst`
 * the OOXML emitter can consume.
 *
 * Throws on unknown layouts or chrome opt-out misuses; slot validation is
 * the parser/validator's job (Stage 4) — this layer trusts that the spec
 * already passed validation.
 */
export function renderDeck(spec: DeckSpec, theme: LoadedTheme): DeckAst {
  const dims = SLIDE_SIZES[spec.deck.size];
  if (!dims) throw new Error(`renderDeck: unknown deck size "${spec.deck.size}"`);

  const language = spec.deck.language ?? "en-US";
  const deckHeader = spec.deck.header ?? undefined;
  const deckFooter = spec.deck.footer ?? undefined;
  const deckBackground = spec.deck.background ?? undefined;

  // Walk slides once to compute "current section name" per slide — chrome
  // modules like `section-marker` need this. A slide is considered to start
  // a section when its layout is "section-divider"; the divider's `title`
  // slot (or `eyebrow`) sticks until the next divider.
  const sectionNames: Array<string | undefined> = [];
  let currentSection: string | undefined;
  for (const s of spec.slides) {
    if (s.layout === "section-divider") {
      const t = (s.slots["title"] ?? s.slots["eyebrow"]) as unknown;
      if (typeof t === "string") currentSection = t;
    }
    sectionNames.push(currentSection);
  }

  const slides: SlideAst[] = spec.slides.map((slideSpec, i) =>
    renderSlide(slideSpec, theme, dims, i, spec.slides.length, language, deckHeader, deckFooter, deckBackground, sectionNames[i]),
  );

  return {
    size: spec.deck.size,
    language,
    title: undefined,
    slides,
  };
}

function renderSlide(
  spec: SlideSpec,
  theme: LoadedTheme,
  deck: { width: number; height: number },
  index: number,
  total: number,
  language: string,
  deckHeader: BandSpec | undefined,
  deckFooter: BandSpec | undefined,
  deckBackground: BackgroundSpec | undefined,
  sectionName: string | undefined,
): SlideAst {
  const loaded = theme.layouts.get(spec.layout);
  if (!loaded) {
    throw new Error(
      `renderSlide: layout "${spec.layout}" not found in theme "${theme.manifest.name}". ` +
      `Available: ${[...theme.layouts.keys()].join(", ")}`,
    );
  }

  const ctx = buildLayoutContext({
    theme,
    deck,
    slots: spec.slots,
    language,
    startId: 2,
  });

  const layoutFn = loaded.render as LayoutFn;
  const layoutShapes = layoutFn(ctx);

  // Compute the next id chrome should start from (max existing + 1).
  let maxId = 1;
  for (const s of layoutShapes) if (s.id > maxId) maxId = s.id;

  // Resolve effective header/footer/background — slide value overrides
  // deck default; explicit `null` clears.
  const effectiveHeader = spec.header === null ? undefined : (spec.header ?? deckHeader);
  const effectiveFooter = spec.footer === null ? undefined : (spec.footer ?? deckFooter);
  const effectiveBackground = spec.background === null ? undefined : (spec.background ?? deckBackground);

  const chromeResolved = resolveChrome(spec.chrome);
  const withChrome = chromeResolved === null
    ? layoutShapes
    : applyChrome({
        shapes: layoutShapes,
        theme,
        deck,
        slideIndex: index + 1,
        slideCount: total,
        language,
        startId: maxId + 1,
        header: resolveBand(effectiveHeader),
        footer: resolveBand(effectiveFooter),
        flags: chromeResolved.flags,
        enable: chromeResolved.enable,
        disable: chromeResolved.disable,
        overrides: chromeResolved.overrides,
        sectionName,
      });

  // Background: image (if provided) wins over solid color; both fall back
  // to the theme's bg-canvas. The package emitter resolves image src.
  const bg: SlideBackground = effectiveBackground && "image" in effectiveBackground
    ? { type: "image", src: effectiveBackground.image.src }
    : effectiveBackground && "color" in effectiveBackground
      ? { type: "solid", color: effectiveBackground.color }
      : { type: "solid", color: theme.manifest.tokens["bg-canvas"] };

  return {
    background: bg,
    shapes: withChrome,
    notes: spec.notes,
  };
}

/**
 * Resolve ChromeSpec → the four facets the compositor needs, or `null` to
 * skip chrome entirely. Defaults all legacy flags to true (= "default").
 */
interface ResolvedChrome {
  flags: { header: boolean; footer: boolean; brandBar: boolean; pageNumber: boolean };
  enable: readonly string[];
  disable: readonly string[];
  overrides: Record<string, Record<string, unknown>>;
}
function resolveChrome(spec: ChromeSpec | undefined): ResolvedChrome | null {
  if (spec === "none") return null;
  if (spec === undefined || spec === "default") {
    return {
      flags: { header: true, footer: true, brandBar: true, pageNumber: true },
      enable: [],
      disable: [],
      overrides: {},
    };
  }
  return {
    flags: {
      header:     spec.header     ?? true,
      footer:     spec.footer     ?? true,
      brandBar:   spec.brandBar   ?? true,
      pageNumber: spec.pageNumber ?? true,
    },
    enable:    spec.enable    ?? [],
    disable:   spec.disable   ?? [],
    overrides: spec.override  ?? {},
  };
}
