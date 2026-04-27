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
  };
  slides: SlideSpec[];
}

export interface SlideSpec {
  layout: string;
  chrome?: "default" | "none";
  notes?: string;
  transition?: "none" | "fade";
  slots: Record<string, unknown>;
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
  const slides: SlideAst[] = spec.slides.map((slideSpec, i) =>
    renderSlide(slideSpec, theme, dims, i, spec.slides.length, language),
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

  const withChrome = spec.chrome === "none"
    ? layoutShapes
    : applyChrome({
        shapes: layoutShapes,
        theme,
        deck,
        slideIndex: index + 1,
        slideCount: total,
        language,
        startId: maxId + 1,
      });

  // Background: every slide gets the theme's bg-canvas unless the layout
  // injected its own background (we don't currently let layouts set the
  // slide background — they paint full-bleed shapes instead).
  const bg: SlideBackground = {
    type: "solid",
    color: theme.manifest.tokens["bg-canvas"],
  };

  return {
    background: bg,
    shapes: withChrome,
    notes: spec.notes,
  };
}
