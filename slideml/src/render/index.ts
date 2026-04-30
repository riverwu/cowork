/**
 * Render orchestrator: take a parsed deck spec + a loaded theme and produce
 * a `SlideAst[]` ready for the OOXML emitter.
 *
 * This is the API the parser/CLI/agent calls. Layouts and components are
 * black boxes from here on — they only see the LayoutContext we hand them.
 */

import { applyChrome } from "./chrome.js";
import { buildLayoutContext, type LayoutFn } from "./layout-context.js";
import { cm, SLIDE_SIZES } from "../units.js";
import type { LoadedTheme } from "../theme/types.js";
import type { DeckAst, Shape, SlideAst, SlideBackground, ShapeList, Xfrm } from "../emitter/types.js";

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
    /** Optional brand identity consumed by chrome modules such as brand-mark. */
    brand?: BrandSpec;
    /** Additional chrome modules enabled deck-wide on top of the theme defaults. */
    chrome?: readonly string[];
    /** Token overrides merged into the selected theme at compile time. */
    palette?: Record<string, string>;
    /** Font overrides merged into font-latin/font-cjk/font-mono. */
    fonts?: { latin?: string | string[]; cjk?: string | string[]; mono?: string | string[] };
    /** Light theme-style overrides. */
    style?: { titleAccentRule?: boolean; contrastTarget?: "warn" | "AA" | "AAA" };
    /** OOXML scheme overrides. */
    oxml?: unknown;
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

export interface BrandSpec {
  name?: string;
  logo?: string | { src: string; alt?: string };
  color?: string;
}

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

export type PagePattern =
  | "single-focus"
  | "title-content"
  | "main-plus-sidebar"
  | "two-column"
  | "hero-plus-supporting"
  | "top-bottom"
  | "grid"
  | "dashboard"
  | "full-bleed-visual"
  | "section-divider";

export type TitlePolicy = "none" | "optional" | "required" | "component";

export type LayoutDensity = "sparse" | "medium" | "dense";
export type LayoutEmphasis = "main" | "balanced" | "visual" | "data" | "takeaway";
export type OverflowPolicy = "shrink" | "condense" | "split" | "fail";

export interface LayoutPolicy {
  emphasis?: LayoutEmphasis;
  density?: LayoutDensity;
  overflow?: OverflowPolicy;
}

export interface ContentComponentSpec {
  component: string;
  props?: Record<string, unknown>;
}

export type RegionContent =
  | ContentComponentSpec
  | ContentComponentSpec[];

export interface SlideSpec {
  pattern: PagePattern;
  chrome?: ChromeSpec;
  notes?: string;
  transition?: "none" | "fade";
  title?: string;
  regions: Record<string, RegionContent>;
  policy?: LayoutPolicy;
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
  const deckBrand = spec.deck.brand;
  const deckChrome = spec.deck.chrome ?? [];

  // Walk slides once to compute "current section name" per slide — chrome
  // modules like `section-marker` need this. A slide is considered to start
  // a section when its pattern is "section-divider"; the slide title (or
  // the main section-divider component title) sticks until the next divider.
  const sectionNames: Array<string | undefined> = [];
  let currentSection: string | undefined;
  for (const s of spec.slides) {
    if (s.pattern === "section-divider") {
      const main = firstRegionComponent(s.regions.main);
      const t = s.title ?? main?.props?.["title"] ?? main?.props?.["eyebrow"];
      if (typeof t === "string") currentSection = t;
    }
    sectionNames.push(currentSection);
  }

  const pending: Array<{ spec: SlideSpec; sectionName: string | undefined; shapes: ShapeList }> = [];
  for (let i = 0; i < spec.slides.length; i++) {
    const slideSpec = spec.slides[i]!;
    const rendered = renderSlideLayouts(slideSpec, theme, dims, language);
    for (const shapes of rendered) {
      pending.push({ spec: slideSpec, sectionName: sectionNames[i], shapes });
    }
  }

  const slides: SlideAst[] = pending.map((page, i) =>
    applySlideChrome(page.spec, page.shapes, theme, dims, i, pending.length, language, deckHeader, deckFooter, deckBackground, page.sectionName, deckBrand, deckChrome),
  );

  return {
    size: spec.deck.size,
    language,
    title: undefined,
    slides,
  };
}

function renderSlideLayouts(
  spec: SlideSpec,
  theme: LoadedTheme,
  deck: { width: number; height: number },
  language: string,
): ShapeList[] {
  if (isSingleRegionPattern(spec)) {
    const layoutName = componentForPattern(spec);
    const slots = slotsForPattern(spec, layoutName);
    return renderComponentPages(layoutName, slots, theme, deck, language, 2);
  }

  const titlePolicy = titlePolicyForPattern(spec.pattern);
  const hasPageTitle = !!spec.title && (titlePolicy === "optional" || titlePolicy === "required");
  const regions = regionRects(spec.pattern, deck, hasPageTitle);
  const out: ShapeList = hasPageTitle ? [renderPageTitle(spec.title!, theme, deck, language, 2)] : [];
  let nextId = maxShapeId(out) + 1;
  for (const [regionName, rect] of Object.entries(regions)) {
    const region = spec.regions[regionName];
    if (!region) continue;
    const components = Array.isArray(region) ? region : [region];
    components.forEach((component, componentIndex) => {
      const componentName = canonicalComponentName(component.component);
      const slots = componentPropsForRegion(spec, component, regionName, componentIndex === 0);
      const rendered = renderComponent(componentName, slots, theme, deck, language, nextId);
      const transformed = rendered.map((shape) => transformShape(shape, fullRect(deck), rect));
      out.push(...transformed);
      nextId = maxShapeId(out) + 1;
    });
  }
  return [out];
}

function renderComponent(
  layoutName: string,
  slots: Record<string, unknown>,
  theme: LoadedTheme,
  deck: { width: number; height: number },
  language: string,
  startId: number,
): ShapeList {
  return renderComponentPages(layoutName, slots, theme, deck, language, startId).flat();
}

function renderComponentPages(
  layoutName: string,
  slots: Record<string, unknown>,
  theme: LoadedTheme,
  deck: { width: number; height: number },
  language: string,
  startId: number,
): ShapeList[] {
  const loaded = theme.layouts.get(layoutName);
  if (!loaded) {
    throw new Error(
      `renderSlide: content component "${layoutName}" not found in theme "${theme.manifest.name}". ` +
      `Available: ${[...theme.layouts.keys()].join(", ")}`,
    );
  }

  const ctx = buildLayoutContext({
    theme,
    deck,
    slots,
    language,
    startId,
  });

  const layoutFn = loaded.render as LayoutFn;
  const layoutResult = layoutFn(ctx);
  return isShapePages(layoutResult) ? layoutResult : [layoutResult];
}

function componentForPattern(spec: SlideSpec): string {
  const main = firstRegionComponent(spec.regions.main);
  if (main) return canonicalComponentName(main.component);
  if (spec.pattern === "section-divider") return "section-divider";
  if (spec.pattern === "full-bleed-visual") return "image-full-bleed";
  return "title-only";
}

function slotsForPattern(spec: SlideSpec, componentName: string): Record<string, unknown> {
  const main = firstRegionComponent(spec.regions.main);
  const base = { ...(main?.props ?? {}) };
  if (spec.title && titlePolicyForPattern(spec.pattern) === "component" && base.title === undefined) base.title = spec.title;

  const sidebar = firstRegionComponent(spec.regions.sidebar);
  if (sidebar) {
    // Direct mappings preserve old layout coverage while giving the new
    // source model flexible page composition. Region-aware renderers can
    // later consume these richer fields without changing the public schema.
    if (componentName === "timeline" && sidebar.component === "text" && base.description === undefined) {
      base.description = sidebar.props?.["text"] ?? sidebar.props?.["body"];
    } else if (componentName === "visual-with-text") {
      if (sidebar.component === "text" && base.text === undefined) base.text = sidebar.props?.["text"] ?? sidebar.props?.["body"];
      if (sidebar.component === "bullets" && base.bullets === undefined) {
        base.textKind = "bullets";
        base.bullets = sidebar.props?.["items"] ?? sidebar.props?.["bullets"];
      }
    }
  }

  const supporting = firstRegionComponent(spec.regions.supporting);
  if (supporting && componentName === "hero-stat" && base.caption === undefined) {
    base.caption = supporting.props?.["text"] ?? supporting.props?.["body"];
  }

  return base;
}

function componentPropsForRegion(spec: SlideSpec, component: ContentComponentSpec, regionName: string, firstInRegion: boolean): Record<string, unknown> {
  const props = { ...(component.props ?? {}) };
  if (regionName === "main" && firstInRegion && spec.title && titlePolicyForPattern(spec.pattern) === "component" && props.title === undefined) props.title = spec.title;
  return props;
}

function isSingleRegionPattern(spec: SlideSpec): boolean {
  const keys = Object.keys(spec.regions);
  return keys.length === 1 && keys[0] === "main" &&
    (spec.pattern === "single-focus" || spec.pattern === "section-divider" || spec.pattern === "full-bleed-visual");
}

export function titlePolicyForPattern(pattern: PagePattern): TitlePolicy {
  switch (pattern) {
    case "title-content":
      return "required";
    case "single-focus":
    case "section-divider":
      return "component";
    case "full-bleed-visual":
      return "none";
    default:
      return "optional";
  }
}

export function requiredRegionsForPattern(pattern: PagePattern): readonly string[] {
  switch (pattern) {
    case "two-column":
      return ["left", "right"];
    case "top-bottom":
      return ["top", "bottom"];
    case "grid":
      return ["top", "left", "right", "bottom"];
    case "hero-plus-supporting":
      return ["main", "supporting"];
    case "main-plus-sidebar":
      return ["main", "sidebar"];
    default:
      return ["main"];
  }
}

function renderPageTitle(title: string, theme: LoadedTheme, deck: { width: number; height: number }, language: string, id: number): Shape {
  const fontKey = /^(zh|ja|ko)/i.test(language) ? "font-cjk" : "font-latin";
  const fontToken = theme.manifest.tokens[fontKey];
  const fontFace = Array.isArray(fontToken) ? fontToken[0] : undefined;
  const color = tokenColor(theme, "text-strong", "111111");
  return {
    type: "text",
    id,
    name: "Page Title",
    xfrm: { x: cm(1.2), y: cm(0.55), cx: deck.width - cm(2.4), cy: cm(0.9) },
    valign: "middle",
    autoFit: "shrink",
    margin: { l: 0, r: 0, t: 0, b: 0 },
    paragraphs: [{
      runs: [{
        text: title,
        sizeHalfPt: 42,
        color,
        bold: true,
        cjk: /^(zh|ja|ko)/i.test(language),
        fontFace,
      }],
    }],
  };
}

function tokenColor(theme: LoadedTheme, name: string, fallback: string): string {
  const value = theme.manifest.tokens[name];
  return typeof value === "string" ? value : fallback;
}

function regionRects(pattern: PagePattern, deck: { width: number; height: number }, hasPageTitle = false): Record<string, Xfrm> {
  const m = Math.round(deck.width * 0.08);
  const top = hasPageTitle ? Math.round(deck.height * 0.17) : Math.round(deck.height * 0.11);
  const bottom = Math.round(deck.height * 0.1);
  const gap = Math.round(deck.width * 0.035);
  const body: Xfrm = { x: m, y: top, cx: deck.width - m * 2, cy: deck.height - top - bottom };
  if (pattern === "main-plus-sidebar") {
    const side = Math.round(body.cx * 0.3);
    return {
      main: { x: body.x, y: body.y, cx: body.cx - side - gap, cy: body.cy },
      sidebar: { x: body.x + body.cx - side, y: body.y, cx: side, cy: body.cy },
    };
  }
  if (pattern === "two-column") {
    const w = Math.floor((body.cx - gap) / 2);
    return {
      left: { x: body.x, y: body.y, cx: w, cy: body.cy },
      right: { x: body.x + w + gap, y: body.y, cx: w, cy: body.cy },
      main: { x: body.x, y: body.y, cx: w, cy: body.cy },
      sidebar: { x: body.x + w + gap, y: body.y, cx: w, cy: body.cy },
    };
  }
  if (pattern === "hero-plus-supporting") {
    const supportH = Math.round(body.cy * 0.3);
    return {
      main: { x: body.x, y: body.y, cx: body.cx, cy: body.cy - supportH - gap },
      supporting: { x: body.x, y: body.y + body.cy - supportH, cx: body.cx, cy: supportH },
    };
  }
  if (pattern === "top-bottom") {
    const h = Math.floor((body.cy - gap) / 2);
    return {
      top: { x: body.x, y: body.y, cx: body.cx, cy: h },
      bottom: { x: body.x, y: body.y + h + gap, cx: body.cx, cy: h },
      main: { x: body.x, y: body.y, cx: body.cx, cy: h },
      supporting: { x: body.x, y: body.y + h + gap, cx: body.cx, cy: h },
    };
  }
  if (pattern === "grid") {
    const w = Math.floor((body.cx - gap) / 2);
    const h = Math.floor((body.cy - gap) / 2);
    return {
      top: { x: body.x, y: body.y, cx: w, cy: h },
      left: { x: body.x, y: body.y + h + gap, cx: w, cy: h },
      right: { x: body.x + w + gap, y: body.y + h + gap, cx: w, cy: h },
      bottom: { x: body.x + w + gap, y: body.y, cx: w, cy: h },
    };
  }
  if (pattern === "dashboard") {
    const w = Math.floor((body.cx - gap) / 2);
    const h = Math.floor((body.cy - gap) / 2);
    return {
      main: { x: body.x, y: body.y, cx: w, cy: h },
      top: { x: body.x + w + gap, y: body.y, cx: w, cy: h },
      left: { x: body.x, y: body.y + h + gap, cx: w, cy: h },
      right: { x: body.x + w + gap, y: body.y + h + gap, cx: w, cy: h },
    };
  }
  return { main: body };
}

function fullRect(deck: { width: number; height: number }): Xfrm {
  return { x: 0, y: 0, cx: deck.width, cy: deck.height };
}

function transformShape(shape: Shape, from: Xfrm, to: Xfrm): Shape {
  const scaleX = to.cx / from.cx;
  const scaleY = to.cy / from.cy;
  return {
    ...shape,
    xfrm: transformXfrm(shape.xfrm, from, to, scaleX, scaleY),
  } as Shape;
}

function transformXfrm(xfrm: Xfrm, from: Xfrm, to: Xfrm, scaleX: number, scaleY: number): Xfrm {
  return {
    ...xfrm,
    x: Math.round(to.x + (xfrm.x - from.x) * scaleX),
    y: Math.round(to.y + (xfrm.y - from.y) * scaleY),
    cx: Math.round(xfrm.cx * scaleX),
    cy: Math.round(xfrm.cy * scaleY),
  };
}

function maxShapeId(shapes: ShapeList): number {
  return shapes.reduce((max, shape) => Math.max(max, shape.id), 1);
}

function firstRegionComponent(region: RegionContent | undefined): ContentComponentSpec | undefined {
  if (!region) return undefined;
  return Array.isArray(region) ? region[0] : region;
}

function canonicalComponentName(component: string): string {
  if (component === "prose") return "article-flow";
  if (component === "q-and-a") return "question-list";
  if (component === "text" || component === "bullets") return "visual-with-text";
  if (component === "image") return "image-full-bleed";
  return component;
}

function isShapePages(value: ShapeList | ShapeList[]): value is ShapeList[] {
  return Array.isArray(value[0]);
}

function applySlideChrome(
  spec: SlideSpec,
  layoutShapes: ShapeList,
  theme: LoadedTheme,
  deck: { width: number; height: number },
  index: number,
  total: number,
  language: string,
  deckHeader: BandSpec | undefined,
  deckFooter: BandSpec | undefined,
  deckBackground: BackgroundSpec | undefined,
  sectionName: string | undefined,
  deckBrand: BrandSpec | undefined,
  deckChrome: readonly string[],
): SlideAst {
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
        brand: deckBrand,
        flags: chromeResolved.flags,
        enable: [...deckChrome, ...(chromeResolved.enable ?? [])],
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
