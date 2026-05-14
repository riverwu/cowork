import type { DeckSpec, DomNode, RenderedDeck, RenderedSlide, Slideml2SourceDeck, SlideV2 } from "./types.js";
import { buildTheme } from "./theme.js";
import { isDeckSize } from "./schema.js";
import { resolveDataBindings, type DataBindingOptions } from "./data-binding.js";
import { resolveScientificReferences } from "./m3-references.js";
import { rectFromNodePlacement } from "./layout/geometry.js";

export function createSourceDeck(options: {
  title?: string;
  size?: DeckSpec["size"];
  theme?: string;
  brand?: { name?: string; primary?: string; logo?: string };
  themeOverride?: DeckSpec["themeOverride"];
  validation?: DeckSpec["validation"];
  master?: DeckSpec["master"];
  dataSources?: DeckSpec["dataSources"];
  references?: DeckSpec["references"];
  footnotes?: DeckSpec["footnotes"];
} = {}): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: {
      size: isDeckSize(options.size) ? options.size : "16x9",
      theme: options.theme || "default",
      brand: options.brand || { name: options.title, primary: "2563EB" },
      themeOverride: options.themeOverride,
      validation: options.validation,
      master: options.master,
      dataSources: options.dataSources,
      references: options.references,
      footnotes: options.footnotes,
      metadata: options.title ? { title: options.title } : {},
    },
    slides: [],
  };
}

export function sourceToRenderedDeck(source: Slideml2SourceDeck, options: DataBindingOptions = {}): RenderedDeck {
  source = resolveDataBindings(source, options);
  source = resolveScientificReferences(source);
  const themeOverride = mergeDeckChrome(source.deck.themeOverride, source.deck.chrome);
  const theme = buildTheme(source.deck.brand || {}, source.deck.theme || "default", themeOverride);
  const articleStyle = theme.text.article || theme.text.paragraph;
  const pageWeight = computeArticlePageWeight(articleStyle.fontSize, articleStyle.lineHeight);
  return {
    deck: {
      size: source.deck.size || "16x9",
      theme: source.deck.theme || "default",
      brand: source.deck.brand || {},
      themeOverride,
      master: source.deck.master,
    },
    slides: source.slides
      .flatMap((slide) => expandArticleSlide(slide, pageWeight))
      .map((slide) => sourceSlideToRendered(normalizeSlide(slide))),
  };
}

function mergeDeckChrome(
  themeOverride: Slideml2SourceDeck["deck"]["themeOverride"],
  chrome: Slideml2SourceDeck["deck"]["chrome"],
): Slideml2SourceDeck["deck"]["themeOverride"] {
  if (!chrome || typeof chrome !== "object") return themeOverride;
  return {
    ...(themeOverride || {}),
    chrome: {
      ...(themeOverride?.chrome || {}),
      ...chrome,
    },
  };
}

function computeArticlePageWeight(fontSize: number, lineHeight: number): number {
  const lineHeightCm = fontSize * 0.0353 * lineHeight;
  const usableHeight = 11.5;
  const lines = Math.max(8, Math.floor(usableHeight / lineHeightCm));
  const charsPerLine = Math.max(20, Math.floor(20 / (fontSize * 0.018)));
  return Math.round(lines * charsPerLine * 0.85);
}

export function sourceSlideToRendered(slide: SlideV2): RenderedSlide {
  const shouldInjectSlideTitle = shouldRenderSlideTitle(slide);
  const slideTitle = typeof slide.title === "string" ? slide.title : "";
  return {
    id: slide.id,
    layout: "title-and-content",
    dom: {
      id: `${slide.id}.root`,
      type: "slide",
      background: resolveSlideBackground(slide),
      notes: slide.notes,
      transition: slide.transition,
      children: [
        ...(shouldInjectSlideTitle ? [{
          id: `${slide.id}.title`,
          type: "slide-title" as const,
          text: slideTitle,
          align: "left",
          // Long Chinese / English titles routinely overflow the 1.45cm
          // title rect. autoFit:"shrink" lets the renderer scale the title
          // down to fit instead of clipping, preserving the agent's text.
          autoFit: "shrink" as const,
        }] : []),
        ...ensureContentArea(slide.id, slide.children, shouldInjectSlideTitle),
      ],
    },
  };
}

function shouldRenderSlideTitle(slide: SlideV2): boolean {
  if (typeof slide.title !== "string" || !slide.title.trim()) return false;
  const bodyHeroTitle = findBodyHeroTitle(slide.children || []);
  if (!bodyHeroTitle.found) return true;
  return !bodyHeroTitleMatchesSlideTitle(slide.title, bodyHeroTitle.titles);
}

function findBodyHeroTitle(nodes: DomNode[]): { found: boolean; titles: string[] } {
  const titles: string[] = [];
  let found = false;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const componentName = node.type === "component" && typeof node.component === "string" ? node.component : node.type;
    if (componentName === "section-break" || componentName === "title-lockup" || componentName === "cover-composition" || componentName === "chapter-divider") {
      found = true;
      if (typeof node.title === "string" && node.title.trim()) titles.push(node.title);
    } else if (node.type === "deck-title" || node.type === "slide-title") {
      found = true;
      if (typeof node.text === "string" && node.text.trim()) titles.push(node.text);
    } else if (node.type === "text" && (node.style === "deck-title" || node.style === "slide-title" || node.style === "section-title")) {
      found = true;
      if (typeof node.text === "string" && node.text.trim()) titles.push(node.text);
    }
    const inner = (node.children as DomNode[] | undefined) || [];
    if (inner.length) {
      const nested = findBodyHeroTitle(inner);
      found = found || nested.found;
      titles.push(...nested.titles);
    }
  }
  return { found, titles };
}

function bodyHeroTitleMatchesSlideTitle(slideTitle: string, bodyTitles: string[]): boolean {
  const normalizedSlideTitle = normalizeHeroTitle(slideTitle);
  return bodyTitles.length > 0 && bodyTitles.every((title) => normalizeHeroTitle(title) === normalizedSlideTitle);
}

function normalizeHeroTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Normalize the agent-supplied slide background into the shape the renderer's
 * resolveSlideBackground understands. Accepts:
 *   - `slide.background: "brand.primary"` (token/hex/gradient string)
 *   - `slide.background: { fill: "..." }` or `{ src: "..." }`
 *   - `slide.backgroundImage: "/abs/path/img.png"` (alias for {src})
 *   - `slide.backgroundImage: { src: "..." }`
 *   - `slide.background.image` / `slide.background.src` (image fields)
 *
 * 6gl008 log: agents reach for `backgroundImage` and image-typed children
 * when they want a cover photo. Without normalization both paths silently
 * fail. This helper makes either form work.
 */
function resolveSlideBackground(slide: SlideV2): unknown {
  const explicit = slide.background;
  const bgImage = (slide as unknown as { backgroundImage?: unknown }).backgroundImage;
  // backgroundImage convenience alias takes priority when explicit is just a
  // token/hex (the agent typically wants the image to override the color).
  if (bgImage) {
    if (typeof bgImage === "string" && bgImage.trim()) {
      return { type: "image", src: bgImage };
    }
    if (typeof bgImage === "object" && bgImage !== null) {
      const rec = bgImage as Record<string, unknown>;
      const src = typeof rec.src === "string" ? rec.src : typeof rec.image === "string" ? rec.image : undefined;
      if (src) return { type: "image", src };
    }
  }
  if (explicit && typeof explicit === "object") {
    const rec = explicit as Record<string, unknown>;
    const src = typeof rec.src === "string" ? rec.src : typeof rec.image === "string" ? rec.image : undefined;
    if (src) return { type: "image", src };
  }
  return explicit || "background";
}

export function normalizeSlide(slide: SlideV2): SlideV2 {
  const safeId = typeof slide?.id === "string" && slide.id ? slide.id : `slide-${Date.now()}`;
  const safeChildren = Array.isArray(slide?.children) ? slide.children : [];
  return {
    ...slide,
    id: safeId,
    children: safeChildren.map((node, index) => normalizeNode(safeId, node, `${safeId}.node-${index + 1}`)),
  };
}

// Anchor values that the renderer treats as slide-level overlays
// (they get a fixed rect from rectForSlideChild instead of flowing inside the
// content stack). Mirrored from render.ts ANCHOR_POINTS / isOverlayChild.
const OVERLAY_ANCHOR_POINTS = new Set([
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
]);

// Component types that are *inherently* slide-level overlays. Their
// factories set `anchor` internally during expansion, but expansion
// happens AFTER source-deck normalization — so here we recognize them
// by name and pull them out of the content stack so the renderer's
// anchor logic later places them correctly. Without this, the anchor
// metadata gets buried inside the content stack and is ignored.
const OVERLAY_COMPONENT_TYPES = new Set([
  "watermark", "corner-mark", "callout-marker", "big-page-number",
  "brand-mark",
  "freeform-group", "cover-composition", "chapter-divider",
]);

function isOverlayChildAtSource(node: DomNode): boolean {
  if (!node || typeof node !== "object") return false;
  if ((node.type === "decoration-grid" || node.type === "decorative-shapes") && node.asBackground !== false) return true;
  if (node.layer === "behind" || node.layer === "above") return true;
  if (typeof node.anchor === "string" && OVERLAY_ANCHOR_POINTS.has(node.anchor)) return true;
  if (typeof node.anchorTo === "string" && node.anchorTo.length > 0) return true;
  if (rectFromNodePlacement(node)) return true;
  if (isOverlayWrapperAtSource(node)) return true;
  if (typeof node.type === "string" && OVERLAY_COMPONENT_TYPES.has(node.type)) return true;
  return false;
}

function isOverlayWrapperAtSource(node: DomNode): boolean {
  if (node.type !== "stack" && node.type !== "freeform-group") return false;
  if (!Array.isArray(node.children) || node.children.length === 0) return false;
  if (node.area || node.at || rectFromNodePlacement(node) || node.anchor || node.anchorTo) return false;
  if (hasVisibleWrapperSurface(node)) return false;
  return node.children.every((child) => isOverlayChildAtSource(child));
}

function hasVisibleWrapperSurface(node: DomNode): boolean {
  return [
    "fill",
    "background",
    "line",
    "borderColor",
    "borderWidth",
    "tone",
    "title",
    "header",
  ].some((key) => node[key] !== undefined);
}

function aliasDimensionFields(node: DomNode): DomNode {
  if (!node || typeof node !== "object") return node;
  // umzrkm fix: agents reach for `height` / `width` on shape / band /
  // frame / panel nodes when they want a fixed dimension. Renderer reads
  // `fixedHeight` / `fixedWidth` for layout-container types, so the
  // agent's `height` was silently ignored, leaving (e.g.) a thin band
  // rendered at default size.
  //
  // Caveats:
  //   - `image` / `chart` / `table` with anchor read `width` /
  //     `height` directly via numberProp() — do not strip those.
  //   - Other container types: copy `height`→`fixedHeight` (canonical
  //     field) but keep both available so any code reading either form
  //     still works.
  const skipAlias = node.type === "image" || node.type === "chart" || node.type === "table"
    || typeof node.anchor === "string"
    || Boolean(rectFromNodePlacement(node));
  let mutated = node;
  if (!skipAlias) {
    if (typeof node.height === "number" && node.fixedHeight === undefined) {
      mutated = { ...mutated };
      mutated.fixedHeight = node.height;
    }
    if (typeof node.width === "number" && node.fixedWidth === undefined) {
      if (mutated === node) mutated = { ...mutated };
      mutated.fixedWidth = node.width;
    }
  }
  if (Array.isArray(node.children)) {
    const aliasedChildren = node.children.map((c) => aliasDimensionFields(c));
    if (mutated === node) mutated = { ...mutated };
    mutated.children = aliasedChildren;
  }
  return mutated;
}

// Common authoring aliases that preserve the same SlideML semantics. These are
// normalized before render so the validator can stay strict about the canonical
// tree while still accepting predictable LLM shorthand.
const TEXT_STYLE_TYPE_ALIASES = new Set([
  "h3", "h4", "h5", "h6",
  "body", "caption", "footnote",
  "metric-value", "metric-label", "card-title", "section-title",
  "paragraph", "bullet", "bullet-compact", "quote-source",
  "title",
]);

const NODE_OBJECT_SLOT_KEYS = ["evidence", "rail", "left", "right", "hero", "insight"] as const;
const NODE_ARRAY_SLOT_KEYS = ["annotations", "supports"] as const;

function normalizeAuthoringAliases(node: DomNode): DomNode {
  let normalized = node;
  if (typeof normalized.type === "string" && TEXT_STYLE_TYPE_ALIASES.has(normalized.type)) {
    normalized = {
      ...normalized,
      type: "text",
      style: typeof normalized.style === "string" && normalized.style.trim() ? normalized.style : normalized.type,
    };
  }
  const scalarRatio = normalized.ratio;
  if (typeof scalarRatio === "number" && Number.isFinite(scalarRatio) && scalarRatio > 0) {
    normalized = { ...normalized, ratio: scalarRatioToPair(scalarRatio) };
  }
  return normalized;
}

function scalarRatioToPair(value: number): [number, number] {
  if (value > 0 && value < 1) return [value, 1 - value];
  if (value === 1) return [1, 1];
  if (value > 1 && value < 100) return [value, 100 - value];
  return [value, 1];
}

function ensureContentArea(slideId: string, children: DomNode[], hasSlideTitle = false): DomNode[] {
  // Run dimension-field aliasing on every child before content-area wrap.
  children = children.map((c) => normalizeAuthoringAliases(aliasDimensionFields(c)));
  if (children.some((node) => node.area === "content")) return children;
  // yajush regression: agents put a footer/corner decoration (image with
  // anchor:"bottom-right" at slide-level expecting it to
  // float over the slide. ensureContentArea used to wrap EVERY child inside
  // the content stack, so the seal got flowed and stretched to fill the
  // content rect. Now we split overlay-style children out: they stay at
  // slide level so rectForSlideChild gives them a proper anchored rect.
  const overlays = children.filter(isOverlayChildAtSource);
  const explicitAreas = children.filter((c) => !isOverlayChildAtSource(c) && isExplicitAreaChild(c));
  const flow = children.filter((c) => !isOverlayChildAtSource(c) && !isExplicitAreaChild(c));
  if (explicitAreas.length > 0) {
    if (flow.length === 0) return [...explicitAreas, ...overlays];
    return [
      {
        id: `${slideId}.content`,
        type: "stack",
        area: "content",
        direction: "vertical",
        gap: 0.35,
        children: flow,
      },
      ...explicitAreas,
      ...overlays,
    ];
  }
  if (flow.length === 0) return overlays;
  const onlyFlow = flow[0];
  if (!hasSlideTitle && flow.length === 1 && onlyFlow?.type === "band" && onlyFlow.area === undefined && onlyFlow.fixedHeight === undefined && onlyFlow.height === undefined) {
    return [onlyFlow, ...overlays];
  }
  return [
    {
      id: `${slideId}.content`,
      type: "stack",
      area: "content",
      direction: "vertical",
      gap: 0.35,
      children: flow,
    },
    ...overlays,
  ];
}

function isExplicitAreaChild(node: DomNode): boolean {
  return typeof node.area === "string" && node.area.trim().length > 0;
}

function normalizeNode(slideId: string, node: DomNode, fallbackId: string): DomNode {
  if (!node || typeof node !== "object") return { id: fallbackId, type: "text", text: "" };
  const raw = node as DomNode & { component?: unknown };
  void raw;
  const aliased = normalizeAuthoringAliases(aliasDimensionFields(node));
  const id = typeof aliased.id === "string" && aliased.id ? aliased.id : fallbackId;
  const normalized: DomNode = {
    ...aliased,
    id,
    children: Array.isArray(aliased.children) ? aliased.children.map((child, index) => normalizeNode(slideId, child, `${id}.${index + 1}`)) : aliased.children,
  };
  for (const key of NODE_OBJECT_SLOT_KEYS) {
    const value = aliased[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      normalized[key] = normalizeNode(slideId, value as DomNode, `${id}.${key}`);
    }
  }
  for (const key of NODE_ARRAY_SLOT_KEYS) {
    const value = aliased[key];
    if (Array.isArray(value)) {
      normalized[key] = value.map((item, index) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? normalizeNode(slideId, item as DomNode, `${id}.${key}.${index + 1}`)
          : item
      );
    }
  }
  return normalized;
}

function expandArticleSlide(slide: SlideV2, pageWeight = 950): SlideV2[] {
  const article = findArticle(slide.children);
  if (!article) return [slide];
  const paragraphs = articleParagraphs(article);
  if (paragraphs.length === 0) return [slide];
  const chunks = paginateArticle(paragraphs, pageWeight);
  const articleTitle = typeof article.title === "string" && article.title.trim() ? article.title.trim() : slide.title;
  return chunks.map((chunk, index) => ({
    id: `${slide.id}${index === 0 ? "" : `-${index + 1}`}`,
    title: chunks.length > 1 && articleTitle ? `${articleTitle} (${index + 1}/${chunks.length})` : articleTitle,
    background: slide.background,
    notes: slide.notes,
    metadata: { ...slide.metadata, articleSourceSlideId: slide.id, articlePage: index + 1, articlePageCount: chunks.length },
    children: [{
      id: `${slide.id}.article.${index + 1}.content`,
      type: "stack",
      area: "content",
      direction: "vertical",
      gap: 0.25,
      children: [
        ...chunk.map((text, paragraphIndex) => ({
          id: `${slide.id}.article.${index + 1}.p${paragraphIndex + 1}`,
          type: "text" as const,
          style: "article",
          text,
        })),
        ...(index === chunks.length - 1 && typeof article.source === "string" && article.source.trim()
          ? [{ id: `${slide.id}.article.source`, type: "source-note" as const, text: article.source.trim() }]
          : []),
      ],
    }],
  }));
}

function findArticle(nodes: DomNode[]): DomNode | null {
  for (const node of nodes) {
    if (node.type === "component" && node.component === "article") return node;
    const nested = node.children ? findArticle(node.children) : null;
    if (nested) return nested;
  }
  return null;
}

function articleParagraphs(node: DomNode): string[] {
  if (Array.isArray(node.paragraphs)) return node.paragraphs.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof node.text === "string") return node.text.split(/\n\s*\n/g).map((item) => item.trim()).filter(Boolean);
  return [];
}

function paginateArticle(paragraphs: string[], pageWeight: number): string[][] {
  const pages: string[][] = [];
  let current: string[] = [];
  let currentWeight = 0;
  for (const paragraph of paragraphs) {
    const weight = weightedTextLength(paragraph) + 80;
    if (current.length > 0 && currentWeight + weight > pageWeight) {
      pages.push(current);
      current = [];
      currentWeight = 0;
    }
    if (weight > pageWeight) {
      const split = splitLongParagraph(paragraph, pageWeight);
      for (const part of split) {
        if (current.length > 0) {
          pages.push(current);
          current = [];
          currentWeight = 0;
        }
        pages.push([part]);
      }
      continue;
    }
    current.push(paragraph);
    currentWeight += weight;
  }
  if (current.length > 0) pages.push(current);
  return pages;
}

function splitLongParagraph(text: string, limit: number): string[] {
  const sentences = text.split(/(?<=[。.!?？])\s*/).filter(Boolean);
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences.length > 1 ? sentences : text.match(/.{1,420}/g) || [text]) {
    if (current && weightedTextLength(current + sentence) > limit) {
      parts.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function weightedTextLength(text: string): number {
  let length = 0;
  for (const char of text) length += /[\u4e00-\u9fff]/.test(char) ? 1.05 : 0.58;
  return length;
}
