import type { DomNode, RenderedDeck, RenderedSlide, Slideml2SourceDeck, SlideV2 } from "./types.js";
import { buildTheme } from "./theme.js";

export function createSourceDeck(options: {
  title?: string;
  theme?: string;
  brand?: { name?: string; primary?: string; logo?: string };
} = {}): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: options.theme || "default",
      brand: options.brand || { name: options.title, primary: "2563EB" },
      metadata: options.title ? { title: options.title } : {},
    },
    slides: [],
  };
}

export function sourceToRenderedDeck(source: Slideml2SourceDeck): RenderedDeck {
  const theme = buildTheme(source.deck.brand || {}, source.deck.theme || "default", source.deck.themeOverride);
  const articleStyle = theme.text.article || theme.text.paragraph;
  const pageWeight = computeArticlePageWeight(articleStyle.fontSize, articleStyle.lineHeight);
  return {
    deck: {
      size: source.deck.size || "16x9",
      theme: source.deck.theme || "default",
      brand: source.deck.brand || {},
      themeOverride: source.deck.themeOverride,
    },
    slides: source.slides.flatMap((slide) => expandArticleSlide(slide, pageWeight)).map(sourceSlideToRendered),
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
  return {
    id: slide.id,
    layout: "title-and-content",
    dom: {
      id: `${slide.id}.root`,
      type: "slide",
      background: slide.background || "background",
      notes: slide.notes,
      children: [
        ...(slide.title ? [{
          id: `${slide.id}.title`,
          type: "slide-title" as const,
          text: slide.title,
          align: "left",
        }] : []),
        ...ensureContentArea(slide.id, slide.children),
      ],
    },
  };
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

function ensureContentArea(slideId: string, children: DomNode[]): DomNode[] {
  if (children.some((node) => node.area === "content")) return children;
  return [{
    id: `${slideId}.content`,
    type: "stack",
    area: "content",
    direction: "vertical",
    gap: 0.35,
    children,
  }];
}

function normalizeNode(slideId: string, node: DomNode, fallbackId: string): DomNode {
  if (!node || typeof node !== "object") return { id: fallbackId, type: "text", text: "" };
  const raw = node as DomNode & { component?: unknown };
  void raw;
  const id = typeof node.id === "string" && node.id ? node.id : fallbackId;
  return {
    ...node,
    id,
    children: Array.isArray(node.children) ? node.children.map((child, index) => normalizeNode(slideId, child, `${id}.${index + 1}`)) : node.children,
  };
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
