import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { emitPackage } from "./emitter/package.js";
import type { ChartAnnotation, ChartNumberFormat, ChartSeries, ChartType, DeckAst, ImageShape, LineSpec, Paragraph, ShapeList, SlideAst, TableCell, TextRun, ShapePreset } from "./emitter/types.js";
import { expandComponent, isComponentTypedNode } from "./component-registry.js";
import { contrastRatio, contrastThreshold, pushDiagnostic, rectsOverlap } from "./diagnostics.js";
import { inferTextKind } from "./text-normalizer.js";
import type { AnchorPoint, DomNode, RenderedDeck } from "./types.js";
import type { Slideml2SourceDeck } from "./types.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { buildTheme, color, preferredFont, resolveFontWeight, sizeMultiplier, textStyle, type FontRole, type FontWeight, type SimpleTheme, type TextStyle } from "./theme.js";

/** Resolve a TextStyle's weight (string or numeric) into the boolean
 *  emitter flag. Anything ≥ 600 reads as bold so the OOXML `b` attribute
 *  fires even when the named-weight typeface variant is missing. */
function isStyleBold(weight: FontWeight | undefined): boolean {
  return resolveFontWeight(weight).bold;
}

/** Pick the OOXML typeface for a text run.
 *
 * Resolution order:
 *  1. Explicit run.font (display | text | mono | cjk) wins.
 *  2. mark `code` in the run forces mono.
 *  3. Otherwise pick the script (cjk vs latin via containsCjk(text)) and
 *     the role (style.fontFamily, default 'text').
 *  4. Numeric weight on the run/style triggers a typeface-suffix variant
 *     when the head font name doesn't already encode a weight.
 */
function pickRunFontFace(theme: SimpleTheme, text: string, style: TextStyle, options: {
  marks?: string[];
  weight?: FontWeight;
  font?: "display" | "text" | "mono" | "cjk";
} = {}): { fontFace: string; cjk: boolean; mono: boolean } {
  const marks = options.marks || [];
  const weight = options.weight ?? style.weight;
  if (options.font === "mono" || marks.includes("code")) {
    return { fontFace: preferredFont(theme, "mono", "text", weight), cjk: false, mono: true };
  }
  const script: "latin" | "cjk" = options.font === "cjk" || (options.font !== "display" && options.font !== "text" && containsCjk(text))
    ? "cjk"
    : "latin";
  const role: FontRole = options.font === "display" ? "display" : style.fontFamily || "text";
  return { fontFace: preferredFont(theme, script, role, weight), cjk: true, mono: false };
}

export interface LayoutDecision {
  intrinsic?: { mainAxis: "vertical" | "horizontal"; basis: number; min: number; max: number; weight: number };
  applied?: "fit" | "shrink" | "demote" | "drop" | "truncate";
  notes?: string[];
}

const layoutDecisionsBySlide = new Map<string, Map<string, LayoutDecision>>();

function recordDecision(slideId: string, nodeId: string, decision: LayoutDecision): void {
  let map = layoutDecisionsBySlide.get(slideId);
  if (!map) {
    map = new Map();
    layoutDecisionsBySlide.set(slideId, map);
  }
  const prev = map.get(nodeId) || {};
  map.set(nodeId, {
    intrinsic: decision.intrinsic ?? prev.intrinsic,
    applied: decision.applied ?? prev.applied,
    notes: [...(prev.notes || []), ...(decision.notes || [])],
  });
}

export function layoutDecisionsForSlide(deck: RenderedDeck, slideId: string): Map<string, LayoutDecision> {
  if (!layoutDecisionsBySlide.has(slideId)) measureDeck(deck);
  return layoutDecisionsBySlide.get(slideId) || new Map();
}

const EMU_PER_CM = 360000;
const ANCHOR_POINTS: Set<string> = new Set([
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
]);
const SHAPE_PRESETS: Set<string> = new Set([
  "rect", "roundRect", "ellipse", "line",
  "triangle", "rightTriangle", "pentagon",
  "arrow-right", "arrow-down", "callout",
  "chevron", "star-5", "parallelogram", "cloud",
]);

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MeasuredNode {
  id: string;
  type: string;
  rect: Rect;
}

export async function renderToPptx(deck: RenderedDeck, outputPath: string): Promise<{ outputPath: string; domPath: string }> {
  const ast = renderToAst(deck);
  const buffer = await emitPackage(ast);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buffer);
  const domPath = `${outputPath}.render-tree.json`;
  await writeFile(domPath, JSON.stringify(materializeDeck(deck), null, 2), "utf8");
  return { outputPath, domPath };
}

export async function renderSourceDeckToPptx(deck: Slideml2SourceDeck, outputPath: string): Promise<{ outputPath: string; domPath: string }> {
  return renderToPptx(sourceToRenderedDeck(deck), outputPath);
}

export function renderToAst(deck: RenderedDeck): DeckAst {
  const theme = buildTheme(deck.deck.brand, deck.deck.theme, deck.deck.themeOverride);
  layoutDecisionsBySlide.clear();
  squashedWarnings.clear();
  const slides: SlideAst[] = deck.slides.map((slide, index) => {
    const dom = materializeAndCompactify(slide.dom, slide.id);
    const ids = { nextId: 2 };
    const shapes = renderSlide(theme, dom, ids, slide.id);
    shapes.push(...renderChrome(theme, deck, index, ids));
    const slideAst = {
      shapes,
      background: { type: "solid", color: color(theme, dom.background, "background") } as { type: "solid"; color: string },
      notes: typeof dom.notes === "string" ? dom.notes : undefined,
    };
    runContrastCheck(slide.id, slideAst);
    return slideAst;
  });
  return {
    size: "16x9",
    language: "zh-CN",
    title: "SlideML2 MVP",
    author: "SlideML2",
    slides,
  };
}

/**
 * Walk the rendered shapes once and emit LOW_CONTRAST diagnostics for any
 * text whose color sits on top of a too-similar fill. The "background" of
 * a text shape is the topmost preceding solid-fill rectangle that contains
 * the text's bounding rect; the slide background is the fallback.
 *
 * This is a generic visual check — works regardless of theme, component,
 * or layout choice — and surfaces exactly the class of bug agents make
 * most often when they freestyle colors (white on light tint, brand on
 * brand.tint, ...).
 */
function runContrastCheck(slideId: string, slide: { shapes: ShapeList; background: { color: string } }): void {
  const slideBg = slide.background.color;
  const fillShapes: Array<{ x: number; y: number; w: number; h: number; color: string }> = [];
  const epsilon = 1; // EMU
  for (const shape of slide.shapes) {
    if (shape.type === "shape" && shape.fill && shape.fill.type === "solid" && typeof shape.fill.color === "string") {
      fillShapes.push({ x: shape.xfrm.x, y: shape.xfrm.y, w: shape.xfrm.cx, h: shape.xfrm.cy, color: shape.fill.color });
    }
    if (shape.type === "text") {
      const tx = shape.xfrm.x;
      const ty = shape.xfrm.y;
      const tw = shape.xfrm.cx;
      const th = shape.xfrm.cy;
      // Find the topmost preceding fill that fully contains the text rect.
      let bg = slideBg;
      // textShape itself may have a fill (for text-on-color blocks).
      if (shape.fill && shape.fill.type === "solid" && typeof shape.fill.color === "string") {
        bg = shape.fill.color;
      } else {
        for (let i = fillShapes.length - 1; i >= 0; i--) {
          const f = fillShapes[i]!;
          if (tx + epsilon >= f.x && ty + epsilon >= f.y && tx + tw <= f.x + f.w + epsilon && ty + th <= f.y + f.h + epsilon) {
            bg = f.color;
            break;
          }
        }
      }
      const paragraphs = shape.paragraphs || [];
      for (let pi = 0; pi < paragraphs.length; pi++) {
        const para = paragraphs[pi]!;
        const runs = para.runs || [];
        for (let ri = 0; ri < runs.length; ri++) {
          const run = runs[ri]!;
          if (!run.text || !run.text.trim()) continue;
          const fg = typeof run.color === "string" ? run.color : slideBg;
          const ratio = contrastRatio(fg, bg);
          const fontPt = (run.sizeHalfPt || 0) / 2;
          const threshold = contrastThreshold(fontPt, run.bold === true);
          if (ratio < threshold) {
            pushDiagnostic({
              severity: "warn",
              code: "LOW_CONTRAST",
              slideId,
              nodeId: shape.name || `slide-${slideId}.text`,
              message: `Text "${run.text.slice(0, 40)}" has contrast ${ratio.toFixed(2)}:1 against ${bg} (need ≥ ${threshold.toFixed(1)}:1${fontPt >= 18 ? " for large" : ""}).`,
              suggestion: `Pick a darker or lighter text color. On a ${bg.toUpperCase()} background, use #${pickContrastingHex(bg)} or any color with luminance ≥ 4.5:1 contrast against the background.`,
              measured: { rect: { x: tx, y: ty, w: tw, h: th } },
            });
          }
        }
      }
    }
  }
}

/**
 * Pick a high-contrast neutral that pairs with the given background:
 * dark text on light bg, light text on dark bg. Returned as a 6-char hex
 * the agent can copy into the next set_theme/text color.
 */
function pickContrastingHex(bgHex: string): string {
  const cleaned = bgHex.replace(/^#/, "");
  if (!/^[0-9A-Fa-f]{6}$/.test(cleaned)) return "111827";
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  // Perceived brightness via standard formula
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 140 ? "111827" : "FFFFFF";
}

export function measureDeck(deck: RenderedDeck): Array<{ slideId: string; nodes: MeasuredNode[] }> {
  const theme = buildTheme(deck.deck.brand, deck.deck.theme, deck.deck.themeOverride);
  layoutDecisionsBySlide.clear();
  return deck.slides.map((slide) => {
    const dom = materializeAndCompactify(slide.dom, slide.id);
    const layout = layoutSlide(theme, dom);
    detectCollisionsForSlide(slide.id, layout.measured, dom);
    return { slideId: slide.id, nodes: layout.measured };
  });
}

function detectCollisionsForSlide(slideId: string, measured: MeasuredNode[], slideDom: DomNode): void {
  const overlayIds = collectOverlayIds(slideDom);
  const skipIds = collectCaptionPairs(measured);
  const candidates = measured.filter((node) =>
    node.id !== slideDom.id && !overlayIds.has(node.id) && !skipIds.has(node.id),
  );
  const containerIds = collectContainerIds(slideDom);
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      if (containerIds.has(a.id) || containerIds.has(b.id)) continue;
      if (isAncestorOf(slideDom, a.id, b.id) || isAncestorOf(slideDom, b.id, a.id)) continue;
      if (rectsOverlap(a.rect, b.rect)) {
        pushDiagnostic({
          severity: "warn",
          code: "COLLISION",
          slideId,
          nodeId: a.id,
          message: `Node '${a.id}' overlaps '${b.id}'.`,
          suggestion: "Increase parent gap, swap one node into a sibling stack/grid, or convert one to an anchored overlay.",
          measured: { rect: a.rect, other: { ...b.rect, nodeId: b.id } },
        });
      }
    }
  }
}

function collectOverlayIds(slideDom: DomNode): Set<string> {
  const ids = new Set<string>();
  for (const child of slideDom.children || []) if (isOverlayChild(child)) ids.add(child.id);
  return ids;
}

function collectContainerIds(root: DomNode): Set<string> {
  const ids = new Set<string>();
  const walk = (node: DomNode) => {
    if (node.children && node.children.length > 0) {
      ids.add(node.id);
      for (const child of node.children) walk(child);
    }
  };
  walk(root);
  return ids;
}

function collectCaptionPairs(measured: MeasuredNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of measured) if (typeof node.id === "string" && node.id.endsWith(".caption")) ids.add(node.id);
  return ids;
}

function isAncestorOf(root: DomNode, ancestorId: string, descendantId: string): boolean {
  const ancestor = findNodeById(root, ancestorId);
  if (!ancestor) return false;
  return Boolean(findNodeById(ancestor, descendantId)) && ancestorId !== descendantId;
}

function findNodeById(root: DomNode, id: string): DomNode | null {
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

function materializeAndCompactify(slideDom: DomNode, slideId: string): DomNode {
  const materialized = materializeNode(slideDom, slideId);
  const compactedChildren = (materialized.children || [])
    .map(compactifyNode)
    .filter((c): c is DomNode => c !== null);
  return { ...materialized, children: compactedChildren };
}

interface LayoutResult {
  measured: MeasuredNode[];
  rectsById: Map<string, Rect>;
}

let currentSlideId = "";

function layoutSlide(theme: SimpleTheme, slideDom: DomNode): LayoutResult {
  const measured: MeasuredNode[] = [];
  const rectsById = new Map<string, Rect>();
  const slideRect = fullRect(theme);
  measured.push({ id: slideDom.id, type: slideDom.type, rect: slideRect });
  rectsById.set(slideDom.id, slideRect);
  // Derive slideId from the root node (e.g. "cover.root" -> "cover")
  const previous = currentSlideId;
  currentSlideId = slideDom.id.replace(/\.root$/, "") || slideDom.id;
  try {
    for (const child of slideDom.children || []) {
      const childRect = rectForSlideChild(theme, child);
      measureSubtree(theme, child, childRect, measured, rectsById);
    }
  } finally {
    currentSlideId = previous;
  }
  return { measured, rectsById };
}

function isOverlayChild(node: DomNode): boolean {
  if (typeof node.anchor === "string" && ANCHOR_POINTS.has(node.anchor)) return true;
  if (node.type === "image" && (node.position === "bottom-right" || node.position === "top-right" || node.position === "center")) return true;
  return false;
}

function flowChildren(slideDom: DomNode): DomNode[] {
  return (slideDom.children || []).filter((child) => !isOverlayChild(child));
}

function overlayChildren(slideDom: DomNode): DomNode[] {
  return (slideDom.children || []).filter(isOverlayChild);
}

function measureSubtree(theme: SimpleTheme, node: DomNode, rect: Rect, output: MeasuredNode[], rectsById: Map<string, Rect>): void {
  const caption = captionText(node);
  if (caption && (node.type === "image" || node.type === "table" || node.type === "chart")) {
    const { bodyRect, captionRect } = captionLayout(node, rect);
    output.push({ id: node.id, type: node.type, rect: bodyRect });
    output.push({ id: `${node.id}.caption`, type: "text", rect: captionRect });
    rectsById.set(node.id, bodyRect);
    rectsById.set(`${node.id}.caption`, captionRect);
    return;
  }
  output.push({ id: node.id, type: node.type, rect });
  rectsById.set(node.id, rect);
  if (node.type === "stack") {
    layoutStackChildren(theme, node, contentRect(theme, node, rect)).forEach(({ node: child, rect: childRect }) => measureSubtree(theme, child, childRect, output, rectsById));
    return;
  }
  if (node.type === "grid") {
    layoutGridChildren(theme, node, contentRect(theme, node, rect)).forEach(({ node: child, rect: childRect }) => measureSubtree(theme, child, childRect, output, rectsById));
    return;
  }
  if (node.type === "panel" || node.type === "card" || node.type === "band" || node.type === "frame" || node.type === "inset") {
    const inner = decorativeInnerRect(theme, node, rect);
    const child = decorativeChild(node);
    if (child) measureSubtree(theme, child, inner, output, rectsById);
  }
}

function decorativeInnerRect(theme: SimpleTheme, node: DomNode, rect: Rect): Rect {
  const styleKey = node.type === "panel" ? "panel" : node.type === "card" ? "card" : node.type === "band" ? "band" : node.type === "frame" ? "frame" : "inset";
  const style = theme.component[styleKey] || {};
  const padding = optionalNumberProp(node, "padding") ?? style.padding ?? 0.4;
  let inner: Rect = { x: rect.x + padding, y: rect.y + padding, w: Math.max(0, rect.w - padding * 2), h: Math.max(0, rect.h - padding * 2) };
  if (node.type === "card") {
    const accent = node.accent === "left" || node.accent === "top" ? node.accent : "none";
    if (accent === "left") inner = { x: inner.x + 0.12, y: inner.y, w: Math.max(0, inner.w - 0.12), h: inner.h };
    else if (accent === "top") inner = { x: inner.x, y: inner.y + 0.12, w: inner.w, h: Math.max(0, inner.h - 0.12) };
    const headerText = typeof node.header === "string" && node.header.trim() ? node.header.trim() : "";
    const footerText = typeof node.footer === "string" && node.footer.trim() ? node.footer.trim() : "";
    const headerHeight = headerText ? 0.7 + 0.15 : 0;
    const footerHeight = footerText ? 0.5 + 0.15 : 0;
    inner = { x: inner.x, y: inner.y + headerHeight, w: inner.w, h: Math.max(0, inner.h - headerHeight - footerHeight) };
  }
  return inner;
}

function rectForSlideChild(theme: SimpleTheme, node: DomNode): Rect {
  if (node.type === "text" && textStyleKey(node) === "slide-title" && !isOverlayChild(node)) {
    const titleRect = { x: theme.layout.pageMarginX, y: theme.layout.titleTop, w: theme.layout.slideWidthCm - theme.layout.pageMarginX * 2, h: theme.layout.titleHeight };
    const intrinsic = textIntrinsicHeight(theme, node, titleRect.w);
    // Allow a generous slack: the intrinsic estimate includes padding for box
    // chrome that the slide-title rect already accounts for. Only flag titles
    // that would clearly take 2 lines (height grows by a full line).
    const lineHeight = textStyle(theme, "slide-title", "paragraph").fontSize * 0.0353;
    if (intrinsic > titleRect.h + lineHeight * 0.6) {
      pushDiagnostic({
        severity: "warn",
        code: "OVERFLOW",
        slideId: currentSlideId || undefined,
        nodeId: node.id,
        message: `Slide title is taller than the title rect (${intrinsic.toFixed(2)}cm vs ${titleRect.h.toFixed(2)}cm).`,
        suggestion: "Shorten the title (≤ 18 CJK chars / 60 latin chars) or split into two slides; do not rely on autofit.",
        measured: { available: titleRect.h, needed: intrinsic, deltaCm: intrinsic - titleRect.h },
      });
    }
    return titleRect;
  }
  if (typeof node.anchor === "string" && ANCHOR_POINTS.has(node.anchor)) {
    return rectFromAnchor(theme, node);
  }
  if (node.type === "image" && node.position === "bottom-right") {
    const w = numberProp(node, "width", 2.4);
    const h = numberProp(node, "height", 1.0);
    return { x: theme.layout.slideWidthCm - w - 0.7, y: theme.layout.slideHeightCm - h - 0.55, w, h };
  }
  if (node.type === "image" && node.position === "top-right") {
    const w = numberProp(node, "width", 2.4);
    const h = numberProp(node, "height", 1.0);
    return { x: theme.layout.slideWidthCm - w - 0.7, y: 0.55, w, h };
  }
  if (node.type === "image" && node.position === "center") {
    const w = numberProp(node, "width", 8);
    const h = numberProp(node, "height", 5);
    return { x: (theme.layout.slideWidthCm - w) / 2, y: (theme.layout.slideHeightCm - h) / 2, w, h };
  }
  if (stringProp(node, "area", "") === "content") {
    return { x: theme.layout.pageMarginX, y: theme.layout.contentTop, w: theme.layout.slideWidthCm - theme.layout.pageMarginX * 2, h: theme.layout.slideHeightCm - theme.layout.contentTop - theme.layout.contentBottom };
  }
  return fullRect(theme);
}

function rectFromAnchor(theme: SimpleTheme, node: DomNode): Rect {
  const anchor = node.anchor as AnchorPoint;
  const w = numberProp(node, "width", node.type === "image" ? 4 : 3);
  const h = numberProp(node, "height", node.type === "image" ? 3 : 1.2);
  const ox = numberProp(node, "offsetX", 0);
  const oy = numberProp(node, "offsetY", 0);
  const slideW = theme.layout.slideWidthCm;
  const slideH = theme.layout.slideHeightCm;
  let x = 0;
  let y = 0;
  if (anchor.endsWith("-left")) x = ox;
  else if (anchor.endsWith("-center")) x = (slideW - w) / 2 + ox;
  else x = slideW - w - ox;
  if (anchor.startsWith("top-")) y = oy;
  else if (anchor.startsWith("middle-")) y = (slideH - h) / 2 + oy;
  else y = slideH - h - oy;
  return { x, y, w, h };
}

function renderSlide(theme: SimpleTheme, slideDom: DomNode, ids: { nextId: number }, slideId: string): ShapeList {
  const layout = layoutSlide(theme, slideDom);
  const flow = flowChildren(slideDom);
  const overlays = overlayChildren(slideDom);
  const flowShapes: ShapeList = [];
  for (const child of flow) {
    const rect = layout.rectsById.get(child.id);
    if (!rect) continue;
    flowShapes.push(...renderNode(theme, child, rect, layout.rectsById, ids, slideId));
  }
  const sorted = [...overlays].sort((a, b) => numberProp(a, "zIndex", 0) - numberProp(b, "zIndex", 0));
  const below: ShapeList = [];
  const above: ShapeList = [];
  for (const child of sorted) {
    const rect = layout.rectsById.get(child.id);
    if (!rect) continue;
    const z = numberProp(child, "zIndex", 0);
    const shapes = renderNode(theme, child, rect, layout.rectsById, ids, slideId);
    if (z < 0) below.push(...shapes);
    else above.push(...shapes);
  }
  return [...below, ...flowShapes, ...above];
}

function renderNode(theme: SimpleTheme, node: DomNode, rect: Rect, rectsById: Map<string, Rect>, ids: { nextId: number }, slideId: string): ShapeList {
  pushSquashedDiagnostic(theme, node, rect, slideId);
  if (node.type === "stack") return renderStack(theme, node, rect, rectsById, ids, slideId);
  if (node.type === "grid") return renderGrid(theme, node, rect, rectsById, ids, slideId);
  if (node.type === "spacer") return [];
  // Dividers and spacers are intentionally thin/empty along one axis; only
  // gate on tiny rect for nodes that need a meaningful 2D area.
  const tinyThreshold = node.type === "divider" || node.type === "spacer" || node.type === "shape" ? 0.02 : 0.18;
  if (rect.h < tinyThreshold || rect.w < tinyThreshold) {
    layoutDropWarnings.add(`${slideId}/${node.id}:${rect.w.toFixed(2)}x${rect.h.toFixed(2)}`);
    pushDiagnostic({
      severity: "error",
      code: "TINY_RECT",
      slideId,
      nodeId: node.id,
      message: `Node assigned an unrenderable rect ${rect.w.toFixed(2)}x${rect.h.toFixed(2)}cm; rendering skipped.`,
      suggestion: "Reduce sibling fixed sizes, drop optional siblings, or split this slide.",
      measured: { rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } },
    });
    recordDecision(slideId, node.id, { applied: "drop", notes: [`tiny rect ${rect.w.toFixed(2)}x${rect.h.toFixed(2)}`] });
    return [];
  }
  if (node.type === "divider") return [dividerShape(theme, node, rect, ids)];
  if (node.type === "text") return [textShape(theme, node, rect, ids)];
  if (node.type === "bullets") return [bulletsShape(theme, node, rect, ids)];
  if (node.type === "image") return captionedShapes(theme, node, rect, ids, (bodyRect) => imageShape(theme, node, bodyRect, ids));
  if (node.type === "table") return captionedShapes(theme, node, rect, ids, (bodyRect) => [tableShape(theme, node, bodyRect, ids)]);
  if (node.type === "chart") return captionedShapes(theme, node, rect, ids, (bodyRect) => [chartShape(theme, node, bodyRect, ids)]);
  if (node.type === "shape") return [presetShape(theme, node, rect, ids)];
  if (node.type === "panel") return renderPanel(theme, node, rect, rectsById, ids, slideId);
  if (node.type === "card") return renderCard(theme, node, rect, rectsById, ids, slideId);
  if (node.type === "band") return renderBand(theme, node, rect, rectsById, ids, slideId);
  if (node.type === "frame") return renderFrame(theme, node, rect, rectsById, ids, slideId);
  if (node.type === "inset") return renderInset(theme, node, rect, rectsById, ids, slideId);
  return [];
}

const squashedWarnings = new Set<string>();

function pushSquashedDiagnostic(theme: SimpleTheme, node: DomNode, rect: Rect, slideId: string): void {
  if (node.optional === true) return;
  if (node.type === "spacer" || node.type === "divider" || node.type === "shape") return;
  const meaningfulContainer = node.type === "stack" || node.type === "grid" || node.type === "panel" || node.type === "card" || node.type === "band" || node.type === "frame" || node.type === "inset";
  const key = `${slideId}/${node.id}`;
  if (squashedWarnings.has(key)) return;
  const minWidth = node.type === "text" ? 1.4 : node.type === "image" || node.type === "chart" || node.type === "table" ? 3.0 : meaningfulContainer ? 2.2 : 1.8;
  const minHeight = node.type === "text" ? textSquashMinHeight(theme, node) : node.type === "bullets" ? 1.0 : meaningfulContainer ? 0.75 : 0.5;
  const narrowContainer = meaningfulContainer && rect.w < minWidth && rect.h > 1.2;
  const shortContent = !meaningfulContainer && rect.h < minHeight;
  const narrowContent = (node.type === "bullets" || node.type === "table" || node.type === "chart" || node.type === "image") && rect.w < minWidth;
  if (!narrowContainer && !shortContent && !narrowContent) return;
  squashedWarnings.add(key);
  pushDiagnostic({
    severity: "error",
    code: "SQUASHED",
    slideId,
    nodeId: node.id,
    message: `Node '${node.id}' was assigned a compressed rect ${rect.w.toFixed(2)}x${rect.h.toFixed(2)}cm; it may technically render but is not visually usable.`,
    suggestion: "Re-author the slide: reduce siblings, use fewer columns, change to split/axis-ruler/table, or move content to another slide. Do not rely on squeezed cards or tiny labels.",
    measured: { rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } },
  });
}

function textSquashMinHeight(theme: SimpleTheme, node: DomNode): number {
  const style = effectiveTextStyle(theme, node, "paragraph");
  return Math.max(0.32, style.fontSize * 0.0353 * Math.max(1, style.lineHeight) * 0.8);
}

/** Decorative wrapper renderers. Each paints chrome and delegates layout to its
 * single child. Multiple children are auto-wrapped in a vertical stack. */

function decorativeChild(node: DomNode): DomNode | null {
  const children = node.children || [];
  if (children.length === 0) return null;
  if (children.length === 1) return children[0]!;
  return {
    id: `${node.id}.inner`,
    type: "stack",
    direction: "vertical",
    gap: 0.3,
    children,
  };
}

function toneTokens(tone: unknown): { fill?: string; line?: string; fg?: string } {
  if (tone === "brand") return { fill: "brand.tint", line: "brand.primary", fg: "brand.primary" };
  if (tone === "tinted") return { fill: "brand.tint", line: "divider", fg: "brand.primary" };
  if (tone === "positive") return { fill: "success.tint", line: "success", fg: "success" };
  if (tone === "warning") return { fill: "warning.tint", line: "warning", fg: "warning" };
  if (tone === "danger") return { fill: "danger.tint", line: "danger", fg: "danger" };
  if (tone === "neutral") return { fill: "surface", line: "divider", fg: "text.primary" };
  return {};
}

function renderPanel(theme: SimpleTheme, node: DomNode, rect: Rect, rectsById: Map<string, Rect>, ids: { nextId: number }, slideId: string): ShapeList {
  const tone = toneTokens(node.tone);
  const style = theme.component.panel || {};
  const fillToken = stringProp(node, "fill", tone.fill || style.fill || "surface");
  const lineToken = stringProp(node, "line", tone.line || style.line || "divider");
  const cornerRadius = optionalNumberProp(node, "cornerRadius") ?? style.radius ?? 0.12;
  const elevation = node.elevation === "raised" || node.elevation === "outlined" || node.elevation === "flat" ? node.elevation : "flat";
  const padding = optionalNumberProp(node, "padding") ?? style.padding ?? 0.45;
  const innerRect: Rect = { x: rect.x + padding, y: rect.y + padding, w: Math.max(0, rect.w - padding * 2), h: Math.max(0, rect.h - padding * 2) };
  const shapes: ShapeList = [{
    type: "shape",
    id: ids.nextId++,
    name: `${nodeLabel(node)}-panel`,
    preset: "roundRect",
    xfrm: xfrm(rect),
    fill: { type: "solid", color: color(theme, fillToken) },
    line: elevation === "raised" ? undefined : { color: color(theme, lineToken), width: cm(elevation === "outlined" ? 0.04 : 0.02) },
    cornerRadius,
  }];
  const child = decorativeChild(node);
  if (child) {
    rectsById.set(child.id, innerRect);
    shapes.push(...renderNode(theme, child, innerRect, rectsById, ids, slideId));
  }
  return shapes;
}

function renderCard(theme: SimpleTheme, node: DomNode, rect: Rect, rectsById: Map<string, Rect>, ids: { nextId: number }, slideId: string): ShapeList {
  const tone = toneTokens(node.tone);
  const style = theme.component.card || {};
  const fillToken = stringProp(node, "fill", tone.fill || style.fill || "surface");
  const lineToken = stringProp(node, "line", tone.line || style.line || "divider");
  const cornerRadius = optionalNumberProp(node, "cornerRadius") ?? style.radius ?? 0.12;
  const padding = optionalNumberProp(node, "padding") ?? style.padding ?? 0.5;
  const accent = node.accent === "left" || node.accent === "top" ? node.accent : "none";
  const accentColor = stringProp(node, "accentColor", "brand.primary");
  const headerText = typeof node.header === "string" && node.header.trim() ? node.header.trim() : "";
  const footerText = typeof node.footer === "string" && node.footer.trim() ? node.footer.trim() : "";
  const shapes: ShapeList = [{
    type: "shape",
    id: ids.nextId++,
    name: `${nodeLabel(node)}-card`,
    preset: "roundRect",
    xfrm: xfrm(rect),
    fill: { type: "solid", color: color(theme, fillToken) },
    line: { color: color(theme, lineToken), width: cm(0.02) },
    cornerRadius,
  }];
  let inner: Rect = { x: rect.x + padding, y: rect.y + padding, w: Math.max(0, rect.w - padding * 2), h: Math.max(0, rect.h - padding * 2) };
  if (accent === "left") {
    const accentWidth = 0.12;
    shapes.push({
      type: "shape",
      id: ids.nextId++,
      name: `${nodeLabel(node)}-accent`,
      preset: "rect",
      xfrm: xfrm({ x: rect.x, y: rect.y + cornerRadius * 0.5, w: accentWidth, h: Math.max(0.2, rect.h - cornerRadius) }),
      fill: { type: "solid", color: color(theme, accentColor) },
    });
    inner = { x: inner.x + accentWidth, y: inner.y, w: Math.max(0, inner.w - accentWidth), h: inner.h };
  } else if (accent === "top") {
    const accentHeight = 0.12;
    shapes.push({
      type: "shape",
      id: ids.nextId++,
      name: `${nodeLabel(node)}-accent`,
      preset: "rect",
      xfrm: xfrm({ x: rect.x + cornerRadius * 0.5, y: rect.y, w: Math.max(0.2, rect.w - cornerRadius), h: accentHeight }),
      fill: { type: "solid", color: color(theme, accentColor) },
    });
    inner = { x: inner.x, y: inner.y + accentHeight, w: inner.w, h: Math.max(0, inner.h - accentHeight) };
  }
  const headerHeight = headerText ? 0.7 : 0;
  const footerHeight = footerText ? 0.5 : 0;
  if (headerText) {
    shapes.push(textShape(theme, { id: `${node.id}.header`, type: "text", text: headerText, style: "card-title", color: tone.fg }, { x: inner.x, y: inner.y, w: inner.w, h: headerHeight }, ids));
  }
  if (footerText) {
    shapes.push(textShape(theme, { id: `${node.id}.footer`, type: "text", text: footerText, style: "caption", color: "text.muted" }, { x: inner.x, y: inner.y + inner.h - footerHeight, w: inner.w, h: footerHeight }, ids));
  }
  const bodyRect: Rect = { x: inner.x, y: inner.y + headerHeight + (headerText ? 0.15 : 0), w: inner.w, h: Math.max(0, inner.h - headerHeight - footerHeight - (headerText ? 0.15 : 0) - (footerText ? 0.15 : 0)) };
  const child = decorativeChild(node);
  if (child) {
    rectsById.set(child.id, bodyRect);
    shapes.push(...renderNode(theme, child, bodyRect, rectsById, ids, slideId));
  }
  return shapes;
}

function renderBand(theme: SimpleTheme, node: DomNode, rect: Rect, rectsById: Map<string, Rect>, ids: { nextId: number }, slideId: string): ShapeList {
  const tone = toneTokens(node.tone);
  const style = theme.component.band || {};
  const fillToken = stringProp(node, "fill", tone.fill || style.fill || "surface.subtle");
  const cornerRadius = optionalNumberProp(node, "cornerRadius") ?? style.radius ?? 0;
  const padding = optionalNumberProp(node, "padding") ?? style.padding ?? 0.6;
  const innerRect: Rect = { x: rect.x + padding, y: rect.y + padding, w: Math.max(0, rect.w - padding * 2), h: Math.max(0, rect.h - padding * 2) };
  const shapes: ShapeList = [{
    type: "shape",
    id: ids.nextId++,
    name: `${nodeLabel(node)}-band`,
    preset: cornerRadius > 0 ? "roundRect" : "rect",
    xfrm: xfrm(rect),
    fill: { type: "solid", color: color(theme, fillToken) },
    cornerRadius: cornerRadius > 0 ? cornerRadius : undefined,
  }];
  const child = decorativeChild(node);
  if (child) {
    rectsById.set(child.id, innerRect);
    shapes.push(...renderNode(theme, child, innerRect, rectsById, ids, slideId));
  }
  return shapes;
}

function renderFrame(theme: SimpleTheme, node: DomNode, rect: Rect, rectsById: Map<string, Rect>, ids: { nextId: number }, slideId: string): ShapeList {
  const style = theme.component.frame || {};
  const lineToken = stringProp(node, "line", style.line || "divider");
  const lineWidth = optionalNumberProp(node, "lineWidth") ?? 0.025;
  const dash = node.dash === "dash" || node.dash === "dashDot" || node.dash === "dot" ? node.dash : undefined;
  const cornerRadius = optionalNumberProp(node, "cornerRadius") ?? style.radius ?? 0.12;
  const padding = optionalNumberProp(node, "padding") ?? style.padding ?? 0.4;
  const innerRect: Rect = { x: rect.x + padding, y: rect.y + padding, w: Math.max(0, rect.w - padding * 2), h: Math.max(0, rect.h - padding * 2) };
  const shapes: ShapeList = [{
    type: "shape",
    id: ids.nextId++,
    name: `${nodeLabel(node)}-frame`,
    preset: "roundRect",
    xfrm: xfrm(rect),
    fill: { type: "none" },
    line: { color: color(theme, lineToken), width: cm(lineWidth), ...(dash ? { dash } : {}) },
    cornerRadius,
  }];
  const child = decorativeChild(node);
  if (child) {
    rectsById.set(child.id, innerRect);
    shapes.push(...renderNode(theme, child, innerRect, rectsById, ids, slideId));
  }
  return shapes;
}

function renderInset(theme: SimpleTheme, node: DomNode, rect: Rect, rectsById: Map<string, Rect>, ids: { nextId: number }, slideId: string): ShapeList {
  const padding = optionalNumberProp(node, "padding") ?? theme.component.inset?.padding ?? 0.35;
  const innerRect: Rect = { x: rect.x + padding, y: rect.y + padding, w: Math.max(0, rect.w - padding * 2), h: Math.max(0, rect.h - padding * 2) };
  const child = decorativeChild(node);
  if (!child) return [];
  rectsById.set(child.id, innerRect);
  return renderNode(theme, child, innerRect, rectsById, ids, slideId);
}

const layoutDropWarnings = new Set<string>();
export function listLayoutDropWarnings(): string[] {
  return Array.from(layoutDropWarnings);
}
export function clearLayoutDropWarnings(): void {
  layoutDropWarnings.clear();
}

function renderStack(theme: SimpleTheme, node: DomNode, rect: Rect, rectsById: Map<string, Rect>, ids: { nextId: number }, slideId: string): ShapeList {
  const children = node.children || [];
  if (children.length === 0) return [];
  return [
    ...containerBackgroundShape(theme, node, rect, ids),
    ...layoutStackChildren(theme, node, contentRect(theme, node, rect)).flatMap(({ node: child, rect: childRect }) => {
      rectsById.set(child.id, childRect);
      return renderNode(theme, child, childRect, rectsById, ids, slideId);
    }),
  ];
}

function renderGrid(theme: SimpleTheme, node: DomNode, rect: Rect, rectsById: Map<string, Rect>, ids: { nextId: number }, slideId: string): ShapeList {
  const children = node.children || [];
  if (children.length === 0) return [];
  return [
    ...containerBackgroundShape(theme, node, rect, ids),
    ...layoutGridChildren(theme, node, contentRect(theme, node, rect)).flatMap(({ node: child, rect: childRect }) => {
      rectsById.set(child.id, childRect);
      return renderNode(theme, child, childRect, rectsById, ids, slideId);
    }),
  ];
}

function renderChrome(theme: SimpleTheme, deck: RenderedDeck, slideIndex: number, ids: { nextId: number }): ShapeList {
  const out: ShapeList = [];
  const layout = theme.layout;
  const chrome = theme.chrome;
  const footerY = layout.slideHeightCm - chrome.footerHeight;
  if (chrome.footerLine) {
    out.push({
      type: "shape",
      id: ids.nextId++,
      name: "chrome.footer-line",
      preset: "line",
      xfrm: xfrm({ x: layout.pageMarginX, y: footerY, w: layout.slideWidthCm - layout.pageMarginX * 2, h: 0.01 }),
      fill: { type: "none" },
      line: { color: color(theme, "divider"), width: cm(0.02) },
    });
  }
  if (chrome.pageNumber) {
    out.push(textShape(theme, {
      id: `chrome.page-${slideIndex + 1}`,
      type: "text",
      text: `${slideIndex + 1} / ${deck.slides.length}`,
      style: "footnote",
      align: "right",
    }, { x: layout.slideWidthCm - chrome.footerPadding - 2, y: footerY + 0.05, w: 2, h: chrome.footerHeight - 0.05 }, ids));
  }
  return out;
}

function textShape(theme: SimpleTheme, node: DomNode, rect: Rect, ids: { nextId: number }): ShapeList[number] {
  const kind = textStyleKey(node);
  const baseStyle = effectiveTextStyle(theme, node, "paragraph");
  // Layout-aware autoFit: when the rendered rect is narrower than the text's
  // intrinsic single-line width AND the agent opted into autoFit:"shrink",
  // we *pre-shrink* the fontSize so it fits in one line. This is robust
  // across viewers (LibreOffice, Keynote, ...) which otherwise ignore the
  // bare <a:normAutofit/> hint. Layout already determined the rect — we
  // know exactly how much we have.
  const style = node.autoFit === "shrink" ? autoShrinkStyle(theme, node, baseStyle, rect) : baseStyle;
  const paragraphs = buildParagraphs(theme, node, style);
  const autoFit = node.autoFit === "shrink" || node.autoFit === "resize" ? node.autoFit : undefined;
  const cornerRadius = typeof node.cornerRadius === "number"
    ? node.cornerRadius
    : (typeof node.fill === "string" || typeof node.line === "string" ? 0.08 : undefined);
  return {
    type: "text",
    id: ids.nextId++,
    name: nodeLabel(node),
    xfrm: xfrm(rect),
    valign: valignProp(node, kind),
    paragraphs,
    margin: { l: cm(0.1), r: cm(0.1), t: cm(0.05), b: cm(0.05) },
    fill: typeof node.fill === "string" ? { type: "solid", color: color(theme, node.fill) } : undefined,
    line: typeof node.line === "string" ? { color: color(theme, node.line), width: cm(0.02) } : undefined,
    cornerRadius,
    ...(autoFit ? { autoFit } : {}),
  };
}

function buildParagraphs(theme: SimpleTheme, node: DomNode, style: ReturnType<typeof textStyle>): Paragraph[] {
  if (Array.isArray(node.paragraphs) && node.paragraphs.length > 0) {
    return node.paragraphs.map((rawPara) => {
      const rec = rawPara && typeof rawPara === "object" ? rawPara as Record<string, unknown> : {};
      const paraStyleKey = typeof rec.style === "string" ? rec.style : undefined;
      const paraStyle = paraStyleKey ? textStyle(theme, paraStyleKey, "paragraph") : style;
      const runs: TextRun[] = Array.isArray(rec.runs)
        ? rec.runs.map((r) => richRunToTextRun(theme, r, paraStyle, isStyleBold(paraStyle.weight)))
        : (() => {
            const text = typeof rec.text === "string" ? rec.text : "";
            const face = pickRunFontFace(theme, text, paraStyle);
            return [{
              text,
              sizeHalfPt: paraStyle.fontSize * 2,
              bold: isStyleBold(paraStyle.weight),
              italic: paraStyle.italic === true,
              letterSpacing: paraStyle.letterSpacing,
              color: color(theme, typeof rec.color === "string" ? rec.color : undefined, paraStyle.color),
              fontFace: face.fontFace,
              cjk: face.cjk,
              mono: face.mono,
            }];
          })();
      const para: Paragraph = {
        runs,
        align: paragraphAlign(rec.align ?? node.align),
      };
      if (typeof rec.indentLevel === "number" && rec.indentLevel > 0) para.indentLevel = rec.indentLevel;
      if (typeof rec.lineSpacing === "number") para.lineSpacingHalfPt = rec.lineSpacing * 2;
      if (typeof rec.spaceAfter === "number") para.spaceAfterHalfPt = rec.spaceAfter * 2;
      if (rec.bullet === "auto") para.bullet = { auto: true };
      else if (rec.bullet === "number") para.bullet = { number: true };
      return para;
    });
  }
  const runs = textRuns(theme, node, style);
  const para: Paragraph = {
    align: paragraphAlign(node.align),
    runs,
  };
  if (typeof node.indentLevel === "number" && node.indentLevel > 0) para.indentLevel = node.indentLevel;
  if (typeof node.lineSpacing === "number") para.lineSpacingHalfPt = node.lineSpacing * 2;
  if (typeof node.spaceAfter === "number") para.spaceAfterHalfPt = node.spaceAfter * 2;
  return [para];
}

function paragraphAlign(value: unknown): "left" | "center" | "right" | "justify" | undefined {
  if (value === "left" || value === "center" || value === "right" || value === "justify") return value;
  return undefined;
}

function bulletsShape(theme: SimpleTheme, node: DomNode, rect: Rect, ids: { nextId: number }): ShapeList[number] {
  const rawItems = Array.isArray(node.items) ? node.items : [];
  // Use the bullet style and apply node's size dial.
  const baseStyle = textStyle(theme, node.density === "compact" ? "bullet-compact" : "bullet", "paragraph");
  const mult = sizeMultiplier(theme, node.size);
  const style = mult === 1 ? baseStyle : { ...baseStyle, fontSize: baseStyle.fontSize * mult };
  const title = typeof node.title === "string" && node.title.trim() ? node.title.trim() : "";
  const numbered = node.numbered === true;
  const defaultIndent = typeof node.indentLevel === "number" ? node.indentLevel : 0;
  const itemParas: Paragraph[] = rawItems.map((rawItem) => {
    const isObject = rawItem && typeof rawItem === "object" && !Array.isArray(rawItem);
    const itemRec = isObject ? rawItem as Record<string, unknown> : { text: String(rawItem ?? "") };
    const text = typeof itemRec.text === "string" ? itemRec.text : "";
    const indent = typeof itemRec.indentLevel === "number" ? itemRec.indentLevel : defaultIndent;
    const bold = itemRec.bold === true || (isStyleBold(style.weight));
    const colorToken = typeof itemRec.color === "string" ? itemRec.color : (typeof node.color === "string" ? node.color : undefined);
    const customRuns = Array.isArray(itemRec.runs) ? itemRec.runs : null;
    const runs: TextRun[] = customRuns
      ? customRuns.map((r) => richRunToTextRun(theme, r, style, bold))
      : [{ text, sizeHalfPt: style.fontSize * 2, bold, color: color(theme, colorToken, style.color), fontFace: containsCjk(text) ? preferredFont(theme, "cjk") : preferredFont(theme, "latin"), cjk: true }];
    const para: Paragraph = {
      bullet: numbered ? { number: true as const } : { auto: true as const },
      runs,
      spaceAfterHalfPt: node.density === "compact" ? 4 : 10,
    };
    if (indent > 0) para.indentLevel = indent;
    return para;
  });
  return {
    type: "text",
    id: ids.nextId++,
    name: nodeLabel(node),
    xfrm: xfrm(rect),
    paragraphs: [
      ...(title ? [{
        runs: [{ text: title, sizeHalfPt: theme.text["card-title"].fontSize * 2, bold: true, color: color(theme, "brand.primary"), fontFace: containsCjk(title) ? preferredFont(theme, "cjk") : preferredFont(theme, "latin"), cjk: true }],
        spaceAfterHalfPt: 6,
      }] : []),
      ...itemParas,
    ],
    margin: { l: cm(0.2), r: cm(0.1), t: cm(0.08), b: cm(0.08) },
  };
}

function presetShape(theme: SimpleTheme, node: DomNode, rect: Rect, ids: { nextId: number }): ShapeList[number] {
  const presetCandidate = typeof node.preset === "string" && SHAPE_PRESETS.has(node.preset) ? node.preset : "rect";
  const preset = presetCandidate as ShapePreset;
  const lineWidthCm = typeof node.lineWidth === "number" ? node.lineWidth : 0.02;
  const lineDash = node.lineDash === "dash" || node.lineDash === "dashDot" || node.lineDash === "dot" ? node.lineDash : undefined;
  return {
    type: "shape",
    id: ids.nextId++,
    name: nodeLabel(node),
    preset,
    xfrm: xfrm(rect, node),
    fill: typeof node.fill === "string" ? { type: "solid", color: color(theme, node.fill) } : { type: "none" },
    line: typeof node.line === "string" ? { color: color(theme, node.line), width: cm(lineWidthCm), ...(lineDash ? { dash: lineDash } : {}) } : undefined,
    ...(typeof node.cornerRadius === "number" ? { cornerRadius: node.cornerRadius } : {}),
  };
}

function dividerShape(theme: SimpleTheme, node: DomNode, rect: Rect, ids: { nextId: number }): ShapeList[number] {
  const orientation = node.orientation === "horizontal" || node.orientation === "vertical"
    ? node.orientation
    : rect.w >= rect.h ? "horizontal" : "vertical";
  const thickness = numberProp(node, "thickness", 0.025);
  const lineRect = orientation === "horizontal"
    ? { x: rect.x, y: rect.y + rect.h / 2, w: rect.w, h: Math.max(0.01, thickness) }
    : { x: rect.x + rect.w / 2, y: rect.y, w: Math.max(0.01, thickness), h: rect.h };
  const dash = node.dash === "dash" || node.dash === "dashDot" || node.dash === "dot" ? node.dash : undefined;
  return {
    type: "shape",
    id: ids.nextId++,
    name: nodeLabel(node),
    preset: "line",
    xfrm: xfrm(lineRect),
    fill: { type: "none" },
    line: { color: color(theme, node.line, "divider"), width: cm(Math.max(0.01, thickness)), ...(dash ? { dash } : {}) },
  };
}

function tableShape(theme: SimpleTheme, node: DomNode, rect: Rect, ids: { nextId: number }): ShapeList[number] {
  // Accept two schemas:
  //   1. headers: ["A","B"]   rows: [["1","2"], ...]
  //   2. columns: [{header,width?}, ...]  rows: [{cells:[...]}, ...]
  // Form 2 is what LLMs commonly emit when they think of a table relationally.
  // Normalize both into the form-1 shape before rendering so the rest of the
  // path can stay simple.
  const columnsField = Array.isArray(node.columns) ? node.columns : null;
  const headers: string[] = columnsField
    ? columnsField.map((c) => (c && typeof c === "object" && typeof (c as { header?: unknown }).header === "string" ? String((c as { header: string }).header) : ""))
    : Array.isArray(node.headers) ? node.headers.map(String) : [];
  const widthsFromColumns: number[] | null = columnsField
    ? columnsField.map((c) => (c && typeof c === "object" && typeof (c as { width?: unknown }).width === "number" ? (c as { width: number }).width : 0))
    : null;
  const rawRows: unknown[][] = Array.isArray(node.rows) ? node.rows.map((row) => {
    if (Array.isArray(row)) return row;
    if (row && typeof row === "object" && Array.isArray((row as { cells?: unknown }).cells)) return (row as { cells: unknown[] }).cells;
    return [];
  }) : [];
  const headerRow: unknown[] = headers.length > 0 ? headers : [];
  const allRows: unknown[][] = headerRow.length > 0 ? [headerRow, ...rawRows] : rawRows;
  const colCount = Math.max(1, ...allRows.map((row) => row.length));
  const rowCount = Math.max(1, allRows.length);
  const cellAlign = node.align === "center" || node.align === "right" || node.align === "left" ? node.align : "left";
  const firstRowHeader = node.firstRowHeader === false ? false : headers.length > 0;
  const widthsInput = Array.isArray(node.colWidths) ? node.colWidths : (widthsFromColumns && widthsFromColumns.some((w) => w > 0) ? widthsFromColumns : undefined);
  const colWidths = resolveTableColWidths(widthsInput, colCount, rect.w);
  const rowHeightsCm = resolveTableRowHeights(node.rowHeights, rowCount, rect.h);
  const cells = makeTableCells(theme, allRows, colCount, firstRowHeader, cellAlign);
  pushTableFitDiagnostics(theme, node, rect, allRows, colWidths, rowHeightsCm, firstRowHeader);
  return {
    type: "table",
    id: ids.nextId++,
    name: nodeLabel(node),
    xfrm: xfrm(rect),
    colWidths: colWidths.map(cm),
    rowHeights: rowHeightsCm.map(cm),
    cells,
    firstRowHeader,
    borderColor: color(theme, typeof node.borderColor === "string" ? node.borderColor : "divider"),
    borderWidth: cm(typeof node.borderWidth === "number" ? node.borderWidth : 0.01),
  };
}

function makeTableCells(theme: SimpleTheme, rows: unknown[][], colCount: number, firstRowHeader: boolean, defaultAlign: "left" | "center" | "right"): TableCell[][] {
  const out: TableCell[][] = [];
  const occupied: boolean[][] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const rawRow = rows[rowIndex] || [];
    const row: TableCell[] = [];
    out[rowIndex] = row;
    let colIndex = 0;
    for (const raw of rawRow) {
      while (colIndex < colCount && occupied[rowIndex]?.[colIndex]) {
        row[colIndex] = coveredTableCell(occupiedByHorizontalMerge(occupied, rowIndex, colIndex), true);
        colIndex++;
      }
      if (colIndex >= colCount) break;
      const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      const colspan = Math.max(1, Math.min(colCount - colIndex, Math.floor(typeof rec.colspan === "number" ? rec.colspan : 1)));
      const rowspan = Math.max(1, Math.floor(typeof rec.rowspan === "number" ? rec.rowspan : 1));
      const isHeader = rowIndex === 0 && firstRowHeader;
      row[colIndex] = {
        ...makeTableCell(theme, raw, isHeader, defaultAlign),
        ...(colspan > 1 ? { colspan } : {}),
        ...(rowspan > 1 ? { rowspan } : {}),
      };
      for (let r = rowIndex; r < rowIndex + rowspan; r++) {
        if (!occupied[r]) occupied[r] = [];
        for (let c = colIndex; c < colIndex + colspan; c++) {
          if (r === rowIndex && c === colIndex) continue;
          occupied[r]![c] = true;
        }
      }
      for (let c = colIndex + 1; c < colIndex + colspan; c++) {
        row[c] = coveredTableCell(true, false);
      }
      colIndex += colspan;
    }
    while (colIndex < colCount) {
      if (occupied[rowIndex]?.[colIndex]) row[colIndex] = coveredTableCell(occupiedByHorizontalMerge(occupied, rowIndex, colIndex), true);
      else row[colIndex] = makeTableCell(theme, "", rowIndex === 0 && firstRowHeader, defaultAlign);
      colIndex++;
    }
  }
  return out;
}

function occupiedByHorizontalMerge(occupied: boolean[][], row: number, col: number): boolean {
  return Boolean(col > 0 && occupied[row]?.[col - 1]);
}

function coveredTableCell(hMerge: boolean, vMerge: boolean): TableCell {
  return {
    runs: [],
    ...(hMerge ? { hMerge: true } : {}),
    ...(vMerge ? { vMerge: true } : {}),
  };
}

function resolveTableColWidths(raw: unknown, colCount: number, totalCm: number): number[] {
  if (Array.isArray(raw) && raw.length === colCount) {
    const nums = raw.map((v) => typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
    const sum = nums.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      // Treat as widths if total is close to totalCm; otherwise as weights.
      const looksAbsolute = Math.abs(sum - totalCm) < totalCm * 0.5 && nums.every((n) => n >= 0.3);
      if (looksAbsolute) return nums;
      return nums.map((n) => (n / sum) * totalCm);
    }
  }
  return Array.from({ length: colCount }, () => totalCm / colCount);
}

function resolveTableRowHeights(raw: unknown, rowCount: number, totalCm: number): number[] {
  if (Array.isArray(raw) && raw.length === rowCount) {
    const nums = raw.map((v) => typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
    const sum = nums.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      const looksAbsolute = Math.abs(sum - totalCm) < totalCm * 0.5 && nums.every((n) => n >= 0.2);
      if (looksAbsolute) return nums;
      return nums.map((n) => (n / sum) * totalCm);
    }
  }
  return Array.from({ length: rowCount }, () => totalCm / rowCount);
}

function makeTableCell(theme: SimpleTheme, raw: unknown, isHeader: boolean, defaultAlign: "left" | "center" | "right"): TableCell {
  const kind = isHeader ? "table-header" : "table-cell";
  const style = textStyle(theme, kind, "table-cell");
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const cell = raw as Record<string, unknown>;
    const text = typeof cell.text === "string" ? cell.text : "";
    const customRuns = Array.isArray(cell.runs) ? cell.runs : null;
    const align = cell.align === "left" || cell.align === "center" || cell.align === "right" ? cell.align : (isHeader ? "center" : defaultAlign);
    const valign = cell.valign === "top" || cell.valign === "bottom" || cell.valign === "middle" ? cell.valign : "middle";
    const fillToken = typeof cell.fill === "string" ? cell.fill : isHeader ? "surface.subtle" : undefined;
    const colorToken = typeof cell.color === "string" ? cell.color : undefined;
    const bold = cell.bold === true || (isStyleBold(style.weight));
    const runs: TextRun[] = customRuns
      ? customRuns.map((r) => richRunToTextRun(theme, r, style, bold))
      : [{ text, sizeHalfPt: style.fontSize * 2, bold, color: color(theme, colorToken, style.color), fontFace: containsCjk(text) ? preferredFont(theme, "cjk") : preferredFont(theme, "latin"), cjk: true }];
    return {
      runs,
      fill: fillToken ? { type: "solid", color: color(theme, fillToken) } : undefined,
      align,
      valign,
    };
  }
  const text = String(raw ?? "");
  return {
    runs: [{ text, sizeHalfPt: style.fontSize * 2, bold: isStyleBold(style.weight), color: color(theme, undefined, style.color), fontFace: containsCjk(text) ? preferredFont(theme, "cjk") : preferredFont(theme, "latin"), cjk: true }],
    fill: isHeader ? { type: "solid", color: color(theme, "surface.subtle") } : undefined,
    align: isHeader ? "center" : defaultAlign,
    valign: "middle",
  };
}

function richRunToTextRun(theme: SimpleTheme, raw: unknown, style: ReturnType<typeof textStyle>, defaultBold: boolean): TextRun {
  const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const text = typeof rec.text === "string" ? rec.text : "";
  const marks = Array.isArray(rec.marks) ? rec.marks.map(String) : [];
  // Per-run weight override falls back to bold mark, then to the style.
  const runWeight: FontWeight | undefined =
    typeof rec.weight === "number" || rec.weight === "bold" || rec.weight === "normal"
      ? rec.weight as FontWeight
      : (marks.includes("bold") || marks.includes("emphasis") || rec.bold === true ? "bold" : style.weight);
  const resolvedWeight = resolveFontWeight(runWeight);
  // Per-run size override (xs..2xl) re-scales relative to the style's base.
  const sizeMul = typeof rec.size === "string" ? sizeMultiplier(theme, rec.size) : 1;
  const fontFace = pickRunFontFace(theme, text, style, {
    marks,
    weight: runWeight,
    font: rec.font === "display" || rec.font === "text" || rec.font === "mono" || rec.font === "cjk" ? rec.font : undefined,
  });
  // Baseline auto-set from sub/sup marks; explicit numeric overrides.
  let baseline: number | undefined;
  if (marks.includes("superscript")) baseline = 30;
  if (marks.includes("subscript")) baseline = -25;
  if (typeof rec.baseline === "number") baseline = rec.baseline;
  // Highlight requires the explicit color field; the mark alone is a no-op.
  const highlightToken = typeof rec.highlight === "string" ? rec.highlight : undefined;
  const highlight = highlightToken && marks.includes("highlight")
    ? color(theme, highlightToken, "warning.tint")
    : undefined;
  return {
    text,
    sizeHalfPt: style.fontSize * 2 * sizeMul,
    bold: defaultBold || resolvedWeight.bold,
    italic: rec.italic === true || marks.includes("italic"),
    underline: rec.underline === true || marks.includes("underline"),
    strike: marks.includes("strikethrough"),
    baseline,
    letterSpacing: typeof rec.letterSpacing === "number" ? rec.letterSpacing : style.letterSpacing,
    highlight,
    color: color(theme, typeof rec.color === "string" ? rec.color : undefined, style.color),
    fontFace: fontFace.fontFace,
    cjk: fontFace.cjk,
    mono: fontFace.mono,
    hyperlink: typeof rec.link === "string" ? rec.link : undefined,
    breakLine: rec.breakLine === true,
  };
}

function chartShape(theme: SimpleTheme, node: DomNode, rect: Rect, ids: { nextId: number }): ShapeList[number] {
  const labels = Array.isArray(node.labels) ? node.labels.map(String) : [];
  const series = normalizeChartSeries(node.series);
  const customColors = Array.isArray(node.colors) ? node.colors.filter((c): c is string => typeof c === "string") : null;
  const palette = customColors && customColors.length > 0
    ? customColors.map((token) => color(theme, token))
    : (theme.chart?.series || ["brand.primary", "brand.primary.tint", "text.muted"]).map((token) => color(theme, token));
  const showLegend = typeof node.showLegend === "boolean" ? node.showLegend : series.length > 1;
  const annotations = normalizeChartAnnotations(node.annotations);
  return {
    type: "chart",
    id: ids.nextId++,
    name: nodeLabel(node),
    xfrm: xfrm(rect),
    chartType: chartType(node.chartType),
    labels,
    series,
    colors: palette,
    showLegend,
    showValues: Boolean(node.showValues),
    title: typeof node.title === "string" ? node.title : undefined,
    yFormat: chartNumberFormat(node.yFormat),
    annotations: annotations.length > 0 ? annotations : undefined,
  };
}

function normalizeChartAnnotations(value: unknown): ChartAnnotation[] {
  if (!Array.isArray(value)) return [];
  const out: ChartAnnotation[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const label = typeof rec.label === "string" ? rec.label : "";
    if (!label) continue;
    const ann: ChartAnnotation = { label };
    if (typeof rec.at === "number") ann.at = rec.at;
    if (Array.isArray(rec.range) && rec.range.length === 2 && typeof rec.range[0] === "number" && typeof rec.range[1] === "number") {
      ann.range = [rec.range[0], rec.range[1]];
    }
    if (rec.style === "callout" || rec.style === "marker" || rec.style === "band") ann.style = rec.style;
    out.push(ann);
  }
  return out;
}

function chartNumberFormat(value: unknown): ChartNumberFormat | undefined {
  if (value === "int" || value === "decimal" || value === "percent" || value === "wanyuan" || value === "yi") return value;
  return undefined;
}

function imageShape(theme: SimpleTheme, node: DomNode, rect: Rect, ids: { nextId: number }): ShapeList {
  const src = stringProp(node, "src", "");
  if (!src) return [];
  const shape: ImageShape = {
    type: "image",
    id: ids.nextId++,
    name: nodeLabel(node),
    xfrm: xfrm(rect, node),
    src,
    altText: stringProp(node, "alt", nodeLabel(node)),
    fit: node.fit === "cover" || node.fit === "fill" ? node.fit : "contain",
  };
  if (node.clip === "rounded" || node.clip === "circle" || node.clip === "square") shape.clip = node.clip;
  if (typeof node.cornerRadius === "number") shape.cornerRadius = node.cornerRadius;
  const border = imageBorderSpec(theme, node);
  if (border) shape.border = border;
  const overlay = imageOverlaySpec(theme, node);
  if (overlay) shape.overlay = overlay;
  const crop = imageCropSpec(node);
  if (crop) shape.crop = crop;
  if (typeof node.softEdge === "number") shape.softEdge = node.softEdge;
  const shadow = imageShadowSpec(theme, node);
  if (shadow) shape.shadow = shadow;
  if (node.grayscale === true) shape.grayscale = true;
  if (typeof node.brightness === "number") shape.brightness = node.brightness;
  if (typeof node.blur === "number") shape.blur = node.blur;
  const duotone = imageDuotoneSpec(theme, node);
  if (duotone) shape.duotone = duotone;
  return [shape];
}

function imageBorderSpec(theme: SimpleTheme, node: DomNode): LineSpec | undefined {
  const raw = node.border;
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const colorToken = typeof rec.color === "string" ? rec.color : "divider";
  const width = typeof rec.width === "number" ? cm(rec.width) : cm(0.025);
  const dash = rec.dash === "dash" || rec.dash === "dashDot" || rec.dash === "dot" ? rec.dash : undefined;
  return { color: color(theme, colorToken), width, ...(dash ? { dash } : {}) };
}

function imageOverlaySpec(theme: SimpleTheme, node: DomNode): { color: string; alpha?: number } | undefined {
  const raw = node.overlay;
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.color !== "string") return undefined;
  const out: { color: string; alpha?: number } = { color: color(theme, rec.color) };
  if (typeof rec.alpha === "number") out.alpha = rec.alpha;
  return out;
}

function imageCropSpec(node: DomNode): { left?: number; right?: number; top?: number; bottom?: number } | undefined {
  const raw = node.crop;
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const out: { left?: number; right?: number; top?: number; bottom?: number } = {};
  if (typeof rec.left === "number") out.left = rec.left;
  if (typeof rec.right === "number") out.right = rec.right;
  if (typeof rec.top === "number") out.top = rec.top;
  if (typeof rec.bottom === "number") out.bottom = rec.bottom;
  return Object.keys(out).length > 0 ? out : undefined;
}

function imageShadowSpec(theme: SimpleTheme, node: DomNode): { color: string; alpha?: number; blur?: number; dx?: number; dy?: number } | undefined {
  const raw = node.shadow;
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const colorToken = typeof rec.color === "string" ? rec.color : "111827";
  const out: { color: string; alpha?: number; blur?: number; dx?: number; dy?: number } = { color: color(theme, colorToken) };
  if (typeof rec.alpha === "number") out.alpha = rec.alpha;
  if (typeof rec.blur === "number") out.blur = rec.blur;
  if (typeof rec.dx === "number") out.dx = rec.dx;
  if (typeof rec.dy === "number") out.dy = rec.dy;
  return out;
}

function imageDuotoneSpec(theme: SimpleTheme, node: DomNode): { dark: string; light: string } | undefined {
  const raw = node.duotone;
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.dark !== "string" || typeof rec.light !== "string") return undefined;
  return { dark: color(theme, rec.dark), light: color(theme, rec.light) };
}

function captionedShapes(theme: SimpleTheme, node: DomNode, rect: Rect, ids: { nextId: number }, renderBody: (rect: Rect) => ShapeList): ShapeList {
  const caption = captionText(node);
  if (!caption) return renderBody(rect);
  const position = node.captionPosition;
  if (position === "none") return renderBody(rect);
  const { bodyRect, captionRect } = captionLayout(node, rect);
  const captionShape = textShape(theme, {
    id: `${node.id}.caption`,
    type: "text",
    text: caption,
    style: "figure-caption",
    align: position === "right" ? "left" : "center",
  }, captionRect, ids);
  return [
    ...renderBody(bodyRect),
    captionShape,
  ];
}

function captionText(node: DomNode): string {
  return typeof node.caption === "string" && node.caption.trim() ? node.caption.trim() : "";
}

function captionLayout(node: DomNode, rect: Rect): { bodyRect: Rect; captionRect: Rect } {
  const position = node.captionPosition;
  const gap = 0.1;
  if (position === "above") {
    const captionHeight = Math.min(0.72, Math.max(0.48, rect.h * 0.14));
    const bodyRect = { x: rect.x, y: rect.y + captionHeight + gap, w: rect.w, h: Math.max(0.2, rect.h - captionHeight - gap) };
    return { bodyRect, captionRect: { x: rect.x, y: rect.y, w: rect.w, h: captionHeight } };
  }
  if (position === "right") {
    const captionWidth = Math.min(7, Math.max(3.5, rect.w * 0.32));
    const bodyRect = { x: rect.x, y: rect.y, w: Math.max(0.2, rect.w - captionWidth - gap), h: rect.h };
    return { bodyRect, captionRect: { x: bodyRect.x + bodyRect.w + gap, y: rect.y, w: captionWidth, h: rect.h } };
  }
  const captionHeight = Math.min(0.72, Math.max(0.48, rect.h * 0.14));
  const bodyRect = { ...rect, h: Math.max(0.2, rect.h - captionHeight - gap) };
  return {
    bodyRect,
    captionRect: { x: rect.x, y: bodyRect.y + bodyRect.h + gap, w: rect.w, h: captionHeight },
  };
}

function maybeUppercase(text: string, node: DomNode): string {
  return node.uppercase === true ? text.toUpperCase() : text;
}

function nodeBold(node: DomNode, styleBold: boolean): boolean {
  if (node.weight === "bold") return true;
  if (node.weight === "medium") return true;
  if (node.weight === "normal") return false;
  return styleBold;
}

function textRuns(theme: SimpleTheme, node: DomNode, style: ReturnType<typeof textStyle>): TextRun[] {
  const content = node.content;
  if (Array.isArray(content)) {
    // Route every rich-text run through the canonical builder so size /
    // weight / font / strike / sub / sup / highlight stay honored. The
    // node-level uppercase/italic/bold still apply as a baseline.
    return content.map((raw) => {
      const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const upperRaw = typeof record.text === "string" ? maybeUppercase(record.text, node) : record.text;
      const merged = { ...record, text: upperRaw };
      const baseBold = nodeBold(node, isStyleBold(style.weight));
      const run = richRunToTextRun(theme, merged, style, baseBold);
      // Node-level italic / underline still propagate when the run has none.
      if (run.italic === false && node.italic === true) run.italic = true;
      if (run.underline === false && node.underline === true) run.underline = true;
      return run;
    });
  }
  const text = maybeUppercase(stringProp(node, "text", typeof content === "string" ? content : ""), node);
  const styleKey = textStyleKey(node);
  const face = pickRunFontFace(theme, text, style, {
    font: styleKey === "code" ? "mono" : undefined,
  });
  return [{
    text,
    sizeHalfPt: style.fontSize * 2,
    bold: nodeBold(node, isStyleBold(style.weight)),
    italic: node.italic === true || style.italic === true,
    underline: node.underline === true,
    letterSpacing: style.letterSpacing,
    color: color(theme, node.color, style.color),
    fontFace: face.fontFace,
    cjk: face.cjk,
    mono: face.mono,
  }];
}

function materializeNode(node: DomNode, slideId: string, fallbackPath = ""): DomNode {
  // Defensive: agents (or programmatic callers) may submit nodes without an
  // id. Synthesize a deterministic fallback so layout/measurement stays
  // crash-free; validators still surface MISSING_NODE_ID separately.
  const safeNode: DomNode = node && typeof node === "object" ? node : { id: "", type: "" };
  const fallbackId = safeNode.id && typeof safeNode.id === "string" ? safeNode.id : `${slideId}.auto.${fallbackPath || "node"}`;
  const withId: DomNode = safeNode.id ? safeNode : { ...safeNode, id: fallbackId };
  const expanded = isComponentTypedNode(withId) ? expandComponent(slideId, withId) : withId;
  // `split` is sugar over `stack` with explicit layoutWeights. Lower it after
  // component expansion as well, since semantic components such as two-column
  // can expand to split.
  const lowered = expanded.type === "split" ? splitToStack(expanded) : expanded;
  return {
    ...lowered,
    id: typeof lowered.id === "string" && lowered.id ? lowered.id : fallbackId,
    children: lowered.children?.map((child, index) => materializeNode(child, slideId, `${fallbackPath ? fallbackPath + "." : ""}${index}`)),
  };
}

function splitToStack(node: DomNode): DomNode {
  const children = Array.isArray(node.children) ? node.children : [];
  const direction = node.direction === "vertical" ? "vertical" : "horizontal";
  const ratioRaw = Array.isArray(node.ratio) ? node.ratio.filter((n) => typeof n === "number" && Number.isFinite(n) && n > 0) : null;
  const defaultRatio = children.length === 2 ? [0.62, 0.38] : children.length === 3 ? [0.4, 0.3, 0.3] : children.map(() => 1);
  const ratio = ratioRaw && ratioRaw.length === children.length ? ratioRaw : defaultRatio;
  return {
    ...node,
    type: "stack",
    direction,
    children: children.map((child, index) => {
      if (!child || typeof child !== "object") return child;
      // Only assign weight if the child hasn't set one explicitly.
      const weight = typeof child.layoutWeight === "number" ? child.layoutWeight : (ratio[index] ?? 1);
      return { ...child, layoutWeight: weight };
    }),
  };
}

function compactifyNode(node: DomNode): DomNode | null {
  if (node.type === "bullets") {
    const items = bulletsItemsFromNode(node);
    if (items.length === 0) return null;
    return { ...node, items };
  }
  if (node.type === "text") {
    const text = typeof node.text === "string" ? node.text.trim() : "";
    const hasContent = Array.isArray(node.content) && node.content.length > 0;
    const hasParagraphs = Array.isArray(node.paragraphs) && node.paragraphs.length > 0;
    if (!text && !hasContent && !hasParagraphs) return null;
    return node;
  }
  if (Array.isArray(node.children)) {
    const compacted = node.children.map(compactifyNode).filter((c): c is DomNode => c !== null);
    if ((node.type === "stack" || node.type === "grid") && compacted.length === 0) return null;
    return { ...node, children: compacted };
  }
  return node;
}

function bulletsItemsFromNode(node: DomNode): unknown[] {
  if (Array.isArray(node.items) && node.items.length > 0) return node.items;
  for (const alias of ["bullets", "points", "list", "lines"]) {
    const value = node[alias];
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return [];
}

function materializeDeck(deck: RenderedDeck): RenderedDeck {
  return {
    ...deck,
    slides: deck.slides.map((slide) => ({
      ...slide,
      dom: materializeAndCompactify(slide.dom, slide.id),
    })),
  };
}

function containerBackgroundShape(theme: SimpleTheme, node: DomNode, rect: Rect, ids: { nextId: number }): ShapeList {
  const style = componentStyle(theme, node);
  const fillToken = typeof node.fill === "string" ? node.fill : style.fill;
  const lineToken = typeof node.line === "string" ? node.line : style.line;
  if (!fillToken && !lineToken) return [];
  const cornerRadius = typeof node.cornerRadius === "number" ? node.cornerRadius : 0.08;
  return [{
    type: "shape",
    id: ids.nextId++,
    name: `${nodeLabel(node)}-background`,
    preset: "roundRect",
    xfrm: xfrm(rect),
    fill: fillToken ? { type: "solid", color: color(theme, fillToken) } : { type: "none" },
    line: lineToken ? { color: color(theme, lineToken), width: cm(0.02) } : undefined,
    cornerRadius,
  }];
}

function contentRect(theme: SimpleTheme, node: DomNode, rect: Rect): Rect {
  const style = componentStyle(theme, node);
  const pad = numberProp(node, "padding", style.padding ?? 0);
  if (pad <= 0) return rect;
  return {
    x: rect.x + pad,
    y: rect.y + pad,
    w: Math.max(0, rect.w - pad * 2),
    h: Math.max(0, rect.h - pad * 2),
  };
}

/**
 * Stage of the fallback ladder applied when children's intrinsic sum exceeds
 * the available main-axis space. We try each in order; if none fits, emit
 * FALLBACK_FAILED and let the solver scale flex children down (potentially
 * triggering TINY_RECT and DROP further down).
 *
 *   1. shrink           (handled by solveSizes/shrinkSizes — flex children -> min)
 *   2. demote density   (bullets comfortable->compact, paragraph->caption)
 *   3. drop optional    (children with `optional: true` are removed)
 *   4. truncate         (apply autoFit:"shrink" to text/bullets so OOXML
 *                        tightens to fit)
 *   5. hard fail        (FALLBACK_FAILED diagnostic with measured deltaCm)
 */
function applyFallbackLadder(theme: SimpleTheme, parent: DomNode, direction: "horizontal" | "vertical", availableMain: number, crossSize: number): void {
  if (parent.__fallbackApplied === true) return;
  parent.__fallbackApplied = true;
  const children = parent.children || [];
  if (children.length === 0) return;

  const gap = gapCm(theme, parent);
  const sumIntrinsic = () => {
    const specs = children.map((child) => childMainSpec(theme, child, direction, crossSize));
    return specs.reduce((sum, spec) => sum + spec.basis, 0) + gap * Math.max(0, children.length - 1);
  };
  const sumMin = () => {
    const specs = children.map((child) => childMainSpec(theme, child, direction, crossSize));
    return specs.reduce((sum, spec) => sum + spec.min, 0) + gap * Math.max(0, children.length - 1);
  };

  // Stage 1 covered by solver; we only act when min sum exceeds available.
  if (sumMin() <= availableMain + 0.001) return;

  // Stage 2: demote density.
  let demoted = 0;
  for (const child of children) {
    if (child.type === "bullets" && child.density !== "compact") {
      child.density = "compact";
      demoted++;
      pushDiagnostic({
        severity: "warn",
        code: "DEMOTED",
        slideId: currentSlideId || undefined,
        nodeId: child.id,
        message: `Bullets density demoted to 'compact' to fit available space.`,
        suggestion: "Either accept the denser look, split into two slides, or shorten items.",
      });
    } else if (child.type === "text" && child.style === "paragraph") {
      child.style = "caption";
      demoted++;
      pushDiagnostic({
        severity: "warn",
        code: "DEMOTED",
        slideId: currentSlideId || undefined,
        nodeId: child.id,
        message: `Text style demoted from 'paragraph' to 'caption' to fit available space.`,
        suggestion: "Use a shorter sentence or split this slide.",
      });
    }
  }
  if (demoted > 0 && sumMin() <= availableMain + 0.001) return;

  // Stage 3: drop optional.
  const before = children.length;
  const remaining = children.filter((child) => {
    if (child.optional === true) {
      pushDiagnostic({
        severity: "warn",
        code: "DROP",
        slideId: currentSlideId || undefined,
        nodeId: child.id,
        message: `Optional child '${child.id}' dropped to fit available space.`,
        suggestion: "If this content is critical, mark it non-optional and move other content out.",
      });
      return false;
    }
    return true;
  });
  if (remaining.length < before) {
    parent.children = remaining;
    if (sumMin() <= availableMain + 0.001) return;
  }

  // Stage 4: truncate. Mark text/bullets with autoFit:"shrink" so OOXML tightens.
  let truncated = 0;
  for (const child of parent.children || []) {
    if ((child.type === "text" || child.type === "bullets") && child.autoFit !== "shrink") {
      child.autoFit = "shrink";
      truncated++;
      pushDiagnostic({
        severity: "warn",
        code: "TRUNCATED",
        slideId: currentSlideId || undefined,
        nodeId: child.id,
        message: `Auto-shrink applied to '${child.id}' so its text fits the assigned rect.`,
        suggestion: "Shorten the text or split the slide for cleaner typography.",
      });
    }
  }
  if (truncated > 0 && sumMin() <= availableMain + 0.001) return;

  // Stage 5: hard fail.
  const needed = sumIntrinsic();
  pushDiagnostic({
    severity: "error",
    code: "FALLBACK_FAILED",
    slideId: currentSlideId || undefined,
    nodeId: parent.id,
    message: `Container '${parent.id}' cannot fit its children even after demote/drop/truncate (needed ${needed.toFixed(2)}cm, available ${availableMain.toFixed(2)}cm).`,
    suggestion: "Split content across slides, remove a child, or increase the parent's allotted height.",
    measured: { available: availableMain, needed, deltaCm: needed - availableMain },
  });
}

function layoutStackChildren(theme: SimpleTheme, node: DomNode, rect: Rect): Array<{ node: DomNode; rect: Rect }> {
  const direction = node.direction === "horizontal" ? "horizontal" : "vertical";
  const mainSize = direction === "horizontal" ? rect.w : rect.h;
  const crossSize = direction === "horizontal" ? rect.h : rect.w;
  const gap = gapCm(theme, node);
  const initialChildren = node.children || [];
  if (initialChildren.length === 0) return [];
  const initialAvailable = Math.max(0, mainSize - gap * (initialChildren.length - 1));
  applyFallbackLadder(theme, node, direction, initialAvailable, crossSize);
  const children = node.children || [];
  if (children.length === 0) return [];
  const availableMain = Math.max(0, mainSize - gap * (children.length - 1));
  const childSpecs = children.map((child) => childMainSpec(theme, child, direction, crossSize));
  if (currentSlideId) {
    children.forEach((child, index) => {
      const spec = childSpecs[index]!;
      recordDecision(currentSlideId, child.id, {
        intrinsic: { mainAxis: direction === "horizontal" ? "horizontal" : "vertical", basis: spec.basis, min: spec.min, max: Number.isFinite(spec.max) ? spec.max : -1, weight: spec.weight },
      });
    });
  }
  const childSizes = solveSizes(childSpecs, availableMain, direction === "horizontal");
  // Main-axis alignment ('justify'): when total size < available and no
  // grow children consumed the slack, distribute the leftover according to
  // the chosen justify. This makes "vertically centered hero", "right-aligned
  // toolbar" etc. expressible without inserting spacer hacks.
  const totalMain = childSizes.reduce((sum, size) => sum + size, 0) + gap * Math.max(0, children.length - 1);
  const slack = Math.max(0, mainSize - totalMain);
  const justify = stringProp(node, "justify", "start");
  const startOffset = slack > 0.001 ? (justify === "center" || justify === "middle" ? slack / 2 : justify === "end" ? slack : 0) : 0;
  if (currentSlideId) {
    children.forEach((child, index) => {
      const spec = childSpecs[index]!;
      const size = childSizes[index]!;
      const applied: LayoutDecision["applied"] = spec.fixed
        ? "fit"
        : size < spec.basis - 0.001
          ? "shrink"
          : size > spec.basis + 0.001
            ? "fit"
            : "fit";
      recordDecision(currentSlideId, child.id, { applied });
    });
  }
  let cursor = (direction === "horizontal" ? rect.x : rect.y) + startOffset;
  return children.map((child, index) => {
    const size = childSizes[index]!;
    const cross = childCrossRect(child, direction === "horizontal" ? rect.y : rect.x, crossSize, node, child);
    const childRect = direction === "horizontal"
      ? { x: cursor, y: cross.start, w: size, h: cross.size }
      : { x: cross.start, y: cursor, w: cross.size, h: size };
    cursor += size + gap;
    return { node: child, rect: childRect };
  });
}

function childCrossRect(child: DomNode, parentCrossStart: number, parentCrossSize: number, parent: DomNode, _self: DomNode): { start: number; size: number } {
  const isHorizontal = parent.direction === "horizontal";
  const crossKey = isHorizontal ? "valign" : "align";
  const childExplicit = stringProp(child, crossKey, "");
  const parentExplicit = stringProp(parent, crossKey, "");
  // Default cross alignment is "stretch", but when a child sets a fixed
  // cross-axis size, that's a stronger declaration of intent than the
  // parent's stretch default — honor it (centering by default).
  const fixedCross = optionalNumberProp(child, isHorizontal ? "fixedHeight" : "fixedWidth");
  let crossAlign: string;
  if (childExplicit) crossAlign = childExplicit;
  else if (parentExplicit && parentExplicit !== "stretch") crossAlign = parentExplicit;
  else if (fixedCross !== undefined) crossAlign = "start";
  else crossAlign = "stretch";
  if (fixedCross === undefined || crossAlign === "stretch") return { start: parentCrossStart, size: parentCrossSize };
  const size = Math.min(fixedCross, parentCrossSize);
  if (crossAlign === "center" || crossAlign === "middle") return { start: parentCrossStart + (parentCrossSize - size) / 2, size };
  if (crossAlign === "end" || crossAlign === "bottom" || crossAlign === "right") return { start: parentCrossStart + parentCrossSize - size, size };
  return { start: parentCrossStart, size };
}

interface GridPlacement {
  child: DomNode;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

/**
 * Place grid children into a 2D occupancy map honoring colSpan/rowSpan on
 * each child. Children flow left-to-right, top-to-bottom; if a span doesn't
 * fit in the current row, it slides to the next free cell that does.
 * This lets agents author "hero + satellite" layouts without leaving grid.
 */
function computeGridPlacements(children: DomNode[], columns: number): GridPlacement[] {
  const occupied: boolean[][] = [];
  const isFree = (row: number, col: number, rowSpan: number, colSpan: number): boolean => {
    if (col + colSpan > columns) return false;
    for (let r = row; r < row + rowSpan; r++) {
      const line = occupied[r] || [];
      for (let c = col; c < col + colSpan; c++) {
        if (line[c]) return false;
      }
    }
    return true;
  };
  const mark = (row: number, col: number, rowSpan: number, colSpan: number): void => {
    for (let r = row; r < row + rowSpan; r++) {
      if (!occupied[r]) occupied[r] = new Array(columns).fill(false);
      for (let c = col; c < col + colSpan; c++) occupied[r][c] = true;
    }
  };
  const placements: GridPlacement[] = [];
  for (const child of children) {
    if (!child || typeof child !== "object") continue;
    const colSpan = clamp(Math.floor(numberProp(child, "colSpan", 1)), 1, columns);
    const rowSpan = Math.max(1, Math.floor(numberProp(child, "rowSpan", 1)));
    let placed = false;
    for (let row = 0; !placed; row++) {
      for (let col = 0; col + colSpan <= columns; col++) {
        if (isFree(row, col, rowSpan, colSpan)) {
          mark(row, col, rowSpan, colSpan);
          placements.push({ child, row, col, rowSpan, colSpan });
          placed = true;
          break;
        }
      }
    }
  }
  return placements;
}

function layoutGridChildren(theme: SimpleTheme, node: DomNode, rect: Rect): Array<{ node: DomNode; rect: Rect }> {
  const children = node.children || [];
  if (children.length === 0) return [];
  const columns = Math.max(1, numberProp(node, "columns", 2));
  const placements = computeGridPlacements(children, columns);
  const declaredRows = Math.max(0, Math.floor(numberProp(node, "rows", 0)));
  const usedRows = placements.reduce((max, p) => Math.max(max, p.row + p.rowSpan), 0);
  const rows = Math.max(1, declaredRows, usedRows);
  const gap = gapCm(theme, node);
  const availableWidth = Math.max(0, rect.w - gap * (columns - 1));
  const availableHeight = Math.max(0, rect.h - gap * (rows - 1));
  const columnWeights = weightsFromProp(node.columnWeights, columns);
  const colX = positionsFromWeights(rect.x, availableWidth, gap, columnWeights);
  const colWidths = colX.map((col) => col.size);
  const rowHeights = resolveGridRowHeights(theme, placements, columns, rows, availableHeight, colWidths, gap, node.rowWeights);
  const rowY = positionsFromSizes(rect.y, gap, rowHeights);
  return placements.map(({ child, row, col, rowSpan, colSpan }) => {
    const x = colX[col]!.start;
    const y = rowY[row]!.start;
    let w = 0;
    for (let i = 0; i < colSpan; i++) w += colX[col + i]!.size;
    if (colSpan > 1) w += gap * (colSpan - 1);
    let h = 0;
    for (let i = 0; i < rowSpan; i++) h += rowY[row + i]!.size;
    if (rowSpan > 1) h += gap * (rowSpan - 1);
    return { node: child, rect: { x, y, w, h } };
  });
}

function resolveMainSizes(theme: SimpleTheme, children: DomNode[], direction: "horizontal" | "vertical", availableMain: number, crossSize: number): number[] {
  return solveSizes(children.map((child) => childMainSpec(theme, child, direction, crossSize)), availableMain);
}

interface SizeSpec {
  basis: number;
  min: number;
  max: number;
  weight: number;
  grow: boolean;
  fixed: boolean;
}

function childMainSpec(theme: SimpleTheme, node: DomNode, direction: "horizontal" | "vertical", crossSize: number): SizeSpec {
  const fixed = optionalNumberProp(node, direction === "horizontal" ? "fixedWidth" : "fixedHeight");
  const intrinsic = intrinsicMainSize(theme, node, direction, crossSize);
  const min = optionalNumberProp(node, direction === "horizontal" ? "minWidth" : "minHeight") ?? intrinsicMinSize(theme, node, direction, crossSize);
  const max = optionalNumberProp(node, direction === "horizontal" ? "maxWidth" : "maxHeight") ?? Number.POSITIVE_INFINITY;
  const hasExplicitWeight = optionalNumberProp(node, "layoutWeight") !== undefined;
  const isContainer = node.type === "stack" || node.type === "grid";
  // For containers, fixedHeight/Width is treated as a soft minimum: if the children's
  // natural intrinsic size exceeds it, let the container grow so children aren't crushed.
  const naturalContainerMain = isContainer && fixed !== undefined
    ? containerNaturalMainSize(theme, node, direction, crossSize)
    : undefined;
  const effectiveFixed = (isContainer && fixed !== undefined && naturalContainerMain !== undefined && naturalContainerMain > fixed)
    ? undefined
    : fixed;
  const fixedSize = effectiveFixed === undefined ? undefined : Math.max(0, effectiveFixed);
  const defaultWeight = node.type === "image" ? theme.imageGrowWeight : 1;
  if (fixedSize === undefined) {
    const lower = isContainer && fixed !== undefined ? Math.max(min, fixed) : Math.max(0, min);
    const basisCandidate = isContainer && naturalContainerMain !== undefined ? naturalContainerMain : intrinsic;
    return {
      basis: clamp(basisCandidate, lower, max),
      min: lower,
      max: Math.max(lower, max),
      weight: Math.max(0.0001, numberProp(node, "layoutWeight", defaultWeight)),
      grow: hasExplicitWeight || canGrow(node),
      fixed: false,
    };
  }
  return {
    basis: fixedSize,
    min: fixedSize,
    max: fixedSize,
    weight: Math.max(0.0001, numberProp(node, "layoutWeight", defaultWeight)),
    grow: false,
    fixed: true,
  };
}

function containerNaturalMainSize(theme: SimpleTheme, node: DomNode, direction: "horizontal" | "vertical", crossSize: number): number {
  if (direction === "vertical") {
    if (node.type === "stack") return stackIntrinsicHeight(theme, node, crossSize);
    if (node.type === "grid") return gridIntrinsicHeight(theme, node, crossSize);
    return 0;
  }
  if (node.type === "stack" && node.direction === "horizontal") return horizontalStackIntrinsicWidth(theme, node, crossSize);
  return crossSize;
}

const sizeOverflowWarnings = new Set<string>();

export function listSizeOverflowWarnings(): string[] {
  return Array.from(sizeOverflowWarnings);
}

export function clearSizeOverflowWarnings(): void {
  sizeOverflowWarnings.clear();
}

function solveSizes(specs: SizeSpec[], availableMain: number, autoFillSlack = false): number[] {
  if (specs.length === 0) return [];
  const available = Math.max(0, availableMain);
  const sizes = specs.map((spec) => clamp(spec.basis, spec.min, spec.max));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total > available) return shrinkSizes(specs, sizes, available);
  if (total < available) return growSizes(specs, sizes, available - total, autoFillSlack);
  return sizes;
}

function shrinkSizes(specs: SizeSpec[], sizes: number[], available: number): number[] {
  let overflow = sizes.reduce((sum, size) => sum + size, 0) - available;
  const shrinkable = specs.map((spec, index) => ({ spec, index })).filter(({ spec, index }) => !spec.fixed && sizes[index]! > spec.min);
  while (overflow > 0.0001 && shrinkable.some(({ spec, index }) => sizes[index]! > spec.min + 0.0001)) {
    const capacities = shrinkable.map(({ spec, index }) => Math.max(0, sizes[index]! - spec.min));
    const totalCapacity = capacities.reduce((sum, capacity) => sum + capacity, 0);
    if (totalCapacity <= 0) break;
    shrinkable.forEach(({ spec, index }, listIndex) => {
      const reduction = Math.min(sizes[index]! - spec.min, overflow * (capacities[listIndex]! / totalCapacity));
      sizes[index] -= reduction;
    });
    overflow = sizes.reduce((sum, size) => sum + size, 0) - available;
  }
  if (overflow > 0.0001) {
    sizeOverflowWarnings.add(`overflow=${overflow.toFixed(2)}cm; available=${available.toFixed(2)}cm`);
    pushDiagnostic({
      severity: "warn",
      code: "OVERFLOW",
      message: `Container is short by ${overflow.toFixed(2)}cm of children's minimum sizes; fixed-size children kept and flexible children scaled to fit.`,
      suggestion: "Reduce fixedHeight/fixedWidth on a sibling, drop a low-priority child, or move content to a new slide.",
      measured: { available, needed: available + overflow, deltaCm: overflow },
    });
    return fitToAvailableRespectingFixed(specs, sizes, available);
  }
  return sizes;
}

function growSizes(specs: SizeSpec[], sizes: number[], extra: number, autoFillSlack = false): number[] {
  let remaining = extra;
  let growIndexes = specs.map((spec, index) => spec.grow && sizes[index]! < spec.max ? index : -1).filter((index) => index >= 0);
  if (growIndexes.length === 0 && autoFillSlack) {
    // No child opted into growth, but the parent has slack and the caller
    // signalled that the slack should be absorbed (typical for horizontal
    // stacks of text where leftover gutter would clip narrow intrinsic widths).
    growIndexes = specs.map((spec, index) => spec.fixed ? -1 : index).filter((index) => index >= 0);
  }
  while (remaining > 0.0001 && growIndexes.length > 0) {
    const weights = normalizeWeights(growIndexes.map((index) => specs[index]!.weight));
    let consumed = 0;
    growIndexes.forEach((index, weightIndex) => {
      const room = specs[index]!.max - sizes[index]!;
      const addition = Math.min(room, remaining * weights[weightIndex]!);
      sizes[index] += addition;
      consumed += addition;
    });
    if (consumed <= 0.0001) break;
    remaining -= consumed;
    growIndexes = growIndexes.filter((index) => sizes[index]! < specs[index]!.max - 0.0001);
  }
  return sizes;
}

function intrinsicMainSize(theme: SimpleTheme, node: DomNode, direction: "horizontal" | "vertical", crossSize: number): number {
  const fixed = optionalNumberProp(node, direction === "horizontal" ? "fixedWidth" : "fixedHeight");
  if (fixed !== undefined) return fixed;
  if (node.type === "panel" || node.type === "card" || node.type === "band" || node.type === "frame" || node.type === "inset") {
    return decorativeIntrinsicMain(theme, node, direction, crossSize);
  }
  if (direction === "horizontal") {
    if (node.type === "image") return Math.min(12, Math.max(6, crossSize * 0.9));
    if (node.type === "text") return textIntrinsicWidth(theme, node);
    if (node.type === "divider") return numberProp(node, "thickness", 0.025) + 0.02;
    if (node.type === "stack" && node.direction === "horizontal") return horizontalStackIntrinsicWidth(theme, node, crossSize);
    return 3.2;
  }
  if (node.type === "text") return textIntrinsicHeight(theme, node, crossSize);
  if (node.type === "bullets") return bulletsIntrinsicHeight(theme, node, crossSize);
  if (node.type === "spacer") return direction === "vertical" ? 0.4 : 0.6;
  if (node.type === "divider") return numberProp(node, "thickness", 0.025) + 0.02;
  if (node.type === "image") return Math.min(10, Math.max(4, crossSize * 0.62));
  if (node.type === "table") return tableIntrinsicHeight(theme, node, crossSize);
  if (node.type === "stack") return stackIntrinsicHeight(theme, node, crossSize);
  if (node.type === "grid") return gridIntrinsicHeight(theme, node, crossSize);
  return 2;
}

function decorativeIntrinsicMain(theme: SimpleTheme, node: DomNode, direction: "horizontal" | "vertical", crossSize: number): number {
  const styleKey = node.type === "panel" ? "panel" : node.type === "card" ? "card" : node.type === "band" ? "band" : node.type === "frame" ? "frame" : "inset";
  const style = theme.component[styleKey] || {};
  const padding = optionalNumberProp(node, "padding") ?? style.padding ?? 0.4;
  let chromeMain = padding * 2;
  if (direction === "vertical" && node.type === "card") {
    if (typeof node.header === "string" && node.header.trim()) chromeMain += 0.85;
    if (typeof node.footer === "string" && node.footer.trim()) chromeMain += 0.65;
    if (node.accent === "top") chromeMain += 0.12;
  }
  if (direction === "horizontal" && node.type === "card" && node.accent === "left") chromeMain += 0.12;
  const child = decorativeChild(node);
  if (!child) return Math.max(chromeMain, 0.6);
  const innerCross = Math.max(0, crossSize - padding * 2);
  return chromeMain + intrinsicMainSize(theme, child, direction, innerCross);
}

function intrinsicMinSize(theme: SimpleTheme, node: DomNode, direction: "horizontal" | "vertical", crossSize: number): number {
  const explicit = optionalNumberProp(node, direction === "horizontal" ? "minWidth" : "minHeight");
  if (explicit !== undefined) return explicit;
  if (direction === "horizontal") return Math.min(intrinsicMainSize(theme, node, direction, crossSize), node.type === "divider" ? 0.02 : 0.45);
  if (node.type === "text") return singleLineTextHeight(theme, node);
  if (node.type === "bullets") return 0.8;
  if (node.type === "divider") return numberProp(node, "thickness", 0.025) + 0.02;
  if (node.type === "spacer") return 0;
  return Math.min(intrinsicMainSize(theme, node, direction, crossSize), 0.9);
}

function tableIntrinsicHeight(theme: SimpleTheme, node: DomNode, widthCm: number): number {
  const { allRows, colCount, firstRowHeader, colWidths } = tableLayoutInfo(node, widthCm);
  if (allRows.length === 0) return 0.9;
  const rowHeights = estimateTableRowHeights(theme, allRows, colWidths, firstRowHeader);
  return Math.min(10, Math.max(0.9, rowHeights.reduce((sum, h) => sum + h, 0)));
}

function tableLayoutInfo(node: DomNode, widthCm: number): {
  allRows: unknown[][];
  colCount: number;
  firstRowHeader: boolean;
  colWidths: number[];
} {
  const columnsField = Array.isArray(node.columns) ? node.columns : null;
  const headers: string[] = columnsField
    ? columnsField.map((c) => (c && typeof c === "object" && typeof (c as { header?: unknown }).header === "string" ? String((c as { header: string }).header) : ""))
    : Array.isArray(node.headers) ? node.headers.map(String) : [];
  const widthsFromColumns: number[] | null = columnsField
    ? columnsField.map((c) => (c && typeof c === "object" && typeof (c as { width?: unknown }).width === "number" ? (c as { width: number }).width : 0))
    : null;
  const rawRows: unknown[][] = Array.isArray(node.rows) ? node.rows.map((row) => {
    if (Array.isArray(row)) return row;
    if (row && typeof row === "object" && Array.isArray((row as { cells?: unknown }).cells)) return (row as { cells: unknown[] }).cells;
    return [];
  }) : [];
  const headerRow: unknown[] = headers.length > 0 ? headers : [];
  const allRows: unknown[][] = headerRow.length > 0 ? [headerRow, ...rawRows] : rawRows;
  const colCount = Math.max(1, ...allRows.map((row) => row.length));
  const firstRowHeader = node.firstRowHeader === false ? false : headers.length > 0;
  const widthsInput = Array.isArray(node.colWidths) ? node.colWidths : (widthsFromColumns && widthsFromColumns.some((w) => w > 0) ? widthsFromColumns : undefined);
  const colWidths = resolveTableColWidths(widthsInput, colCount, widthCm);
  return { allRows, colCount, firstRowHeader, colWidths };
}

function estimateTableRowHeights(theme: SimpleTheme, rows: unknown[][], colWidths: number[], firstRowHeader: boolean): number[] {
  return rows.map((row, rowIndex) => {
    const isHeader = rowIndex === 0 && firstRowHeader;
    let needed = isHeader ? 0.55 : 0.48;
    for (let col = 0; col < Math.max(row.length, colWidths.length); col++) {
      const raw = row[col] ?? "";
      needed = Math.max(needed, tableCellIntrinsicHeight(theme, raw, colWidths[col] || colWidths[0] || 1, isHeader));
    }
    return needed;
  });
}

function tableCellIntrinsicHeight(theme: SimpleTheme, raw: unknown, widthCm: number, isHeader: boolean): number {
  const kind = isHeader ? "table-header" : "table-cell";
  const style = textStyle(theme, kind, "table-cell");
  const text = tableCellText(raw);
  const contentWidth = Math.max(0.8, widthCm - 0.28);
  const fontPt = style.fontSize;
  const isMostlyCjk = text.length > 0 && cjkRatio(text) > 0.5;
  const charWidthCm = isMostlyCjk ? fontPt * 0.0353 * 1.02 : avgCharWidthCm(theme, fontPt, isStyleBold(style.weight));
  const charsPerLine = Math.max(6, Math.floor(contentWidth / charWidthCm));
  const lines = Math.max(1, Math.ceil(weightedTextLength(text) / charsPerLine));
  return lines * fontPt * 0.0353 * style.lineHeight + 0.24;
}

function tableCellText(raw: unknown): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    if (typeof rec.text === "string") return rec.text;
    if (Array.isArray(rec.runs)) return rec.runs.map((run) => run && typeof run === "object" && typeof (run as { text?: unknown }).text === "string" ? (run as { text: string }).text : "").join("");
    return "";
  }
  return String(raw ?? "");
}

function pushTableFitDiagnostics(theme: SimpleTheme, node: DomNode, rect: Rect, rows: unknown[][], colWidths: number[], rowHeights: number[], firstRowHeader: boolean): void {
  const needed = estimateTableRowHeights(theme, rows, colWidths, firstRowHeader);
  const shortRows = needed
    .map((height, index) => ({ index, needed: height, available: rowHeights[index] || 0 }))
    .filter((row) => row.needed > row.available + 0.08);
  if (shortRows.length === 0) return;
  const worst = shortRows.reduce((max, row) => row.needed - row.available > max.needed - max.available ? row : max, shortRows[0]!);
  pushDiagnostic({
    severity: "error",
    code: "FALLBACK_FAILED",
    slideId: currentSlideId,
    nodeId: node.id,
    message: `Table '${nodeLabel(node)}' has ${shortRows.length} row(s) whose text needs more height than assigned; row ${worst.index + 1} needs ${worst.needed.toFixed(2)}cm, available ${worst.available.toFixed(2)}cm.`,
    suggestion: "Shorten table text, widen columns, provide rowHeights, split the table, or use fewer rows.",
    measured: { available: rect.h, needed: needed.reduce((sum, h) => sum + h, 0), rect },
  });
}

function canGrow(node: DomNode): boolean {
  return node.type === "image" || node.type === "grid" || node.type === "stack" || node.type === "table" || node.type === "chart" || node.type === "shape" || node.type === "spacer" || node.type === "panel" || node.type === "card" || node.type === "band" || node.type === "frame" || node.type === "inset" || node.fill === true;
}

function stackIntrinsicHeight(theme: SimpleTheme, node: DomNode, crossSize: number): number {
  const children = node.children || [];
  if (children.length === 0) return 0;
  const gap = gapCm(theme, node);
  const pad = paddingCm(theme, node);
  const innerWidth = Math.max(0, crossSize - pad * 2);
  if (node.direction === "horizontal") {
    const availableWidth = Math.max(0, innerWidth - gap * Math.max(0, children.length - 1));
    const widths = resolveMainSizes(theme, children, "horizontal", availableWidth, 10);
    const childHeights = children.map((child, index) => intrinsicMainSize(theme, child, "vertical", widths[index] || innerWidth));
    return Math.max(0, ...childHeights) + pad * 2;
  }
  const fixed = children.reduce((sum, child) => sum + intrinsicMainSize(theme, child, "vertical", innerWidth), 0);
  return fixed + gap * Math.max(0, children.length - 1) + pad * 2;
}

function horizontalStackIntrinsicWidth(theme: SimpleTheme, node: DomNode, heightCm: number): number {
  const children = node.children || [];
  if (children.length === 0) return 0;
  const gap = gapCm(theme, node);
  const pad = paddingCm(theme, node);
  return children.reduce((sum, child) => sum + intrinsicMainSize(theme, child, "horizontal", heightCm), 0) + gap * Math.max(0, children.length - 1) + pad * 2;
}

function gridIntrinsicHeight(theme: SimpleTheme, node: DomNode, widthCm: number): number {
  const children = node.children || [];
  if (children.length === 0) return 0;
  const columns = Math.max(1, numberProp(node, "columns", 2));
  const placements = computeGridPlacements(children, columns);
  const declaredRows = Math.max(0, Math.floor(numberProp(node, "rows", 0)));
  const usedRows = placements.reduce((max, p) => Math.max(max, p.row + p.rowSpan), 0);
  const rows = Math.max(1, declaredRows, usedRows);
  const gap = gapCm(theme, node);
  const columnWeights = weightsFromProp(node.columnWeights, columns);
  const contentWidth = contentRect(theme, node, { x: 0, y: 0, w: widthCm, h: 10 }).w;
  const availableWidth = Math.max(0, contentWidth - gap * (columns - 1));
  const colWidths = columnWeights.map((weight) => availableWidth * weight);
  // Each row's intrinsic height is the max of (placed child intrinsic / rowSpan)
  // for children that start in that row OR span across it.
  const rowHeights = new Array(rows).fill(0);
  for (const placement of placements) {
    let spanWidth = 0;
    for (let i = 0; i < placement.colSpan; i++) spanWidth += colWidths[placement.col + i] || 0;
    if (placement.colSpan > 1) spanWidth += gap * (placement.colSpan - 1);
    const intrinsic = intrinsicMainSize(theme, placement.child, "vertical", spanWidth || availableWidth / columns);
    const perRow = intrinsic / placement.rowSpan;
    for (let i = 0; i < placement.rowSpan; i++) {
      const row = placement.row + i;
      if (row < rows) rowHeights[row] = Math.max(rowHeights[row], perRow);
    }
  }
  const total = rowHeights.reduce((sum, h) => sum + h, 0);
  return total + gap * Math.max(0, rows - 1);
}

function resolveGridRowHeights(theme: SimpleTheme, placements: GridPlacement[], columns: number, rows: number, availableHeight: number, colWidths: number[], gap: number, rowWeightsValue: unknown): number[] {
  const rowWeights = weightsFromProp(rowWeightsValue, rows);
  const specs: SizeSpec[] = [];
  // For each row, intrinsic basis is driven by the children that *start* in
  // that row, scaled by their rowSpan (so a rowSpan:2 child contributes half
  // its intrinsic to each of the two rows it covers).
  const childByCell = new Map<string, GridPlacement>();
  for (const p of placements) childByCell.set(`${p.row}:${p.col}`, p);
  for (let row = 0; row < rows; row++) {
    let basis = 0;
    let min = 0.4;
    for (let col = 0; col < columns; col++) {
      const placement = childByCell.get(`${row}:${col}`);
      if (!placement) continue;
      const child = placement.child;
      if (!child) continue;
      let width = 0;
      for (let i = 0; i < placement.colSpan; i++) width += colWidths[placement.col + i] || 0;
      if (placement.colSpan > 1) width += gap * (placement.colSpan - 1);
      const perRowBasis = intrinsicMainSize(theme, child, "vertical", width || colWidths[col] || colWidths[0] || 1) / placement.rowSpan;
      const perRowMin = intrinsicMinSize(theme, child, "vertical", width || colWidths[col] || colWidths[0] || 1) / placement.rowSpan;
      basis = Math.max(basis, perRowBasis);
      min = Math.max(min, perRowMin);
    }
    specs.push({ basis, min, max: Number.POSITIVE_INFINITY, weight: rowWeights[row] || 1, grow: true, fixed: false });
  }
  return solveSizes(specs, availableHeight);
}

function textIntrinsicHeight(theme: SimpleTheme, node: DomNode, widthCm: number): number {
  const style = effectiveTextStyle(theme, node, "paragraph");
  const fontPt = style.fontSize;
  const text = renderedTextContent(node);
  const isMostlyCjk = text.length > 0 && cjkRatio(text) > 0.5;
  // CJK glyphs are roughly square at the font's pt size, so a CJK line packs
  // fewer characters per cm than the latin estimate.
  const charWidthCm = isMostlyCjk ? fontPt * 0.0353 * 1.02 : avgCharWidthCm(theme, fontPt, isStyleBold(style.weight));
  const charsPerLine = Math.max(8, Math.floor(widthCm / charWidthCm));
  const lines = Math.max(1, Math.ceil(weightedTextLength(text) / charsPerLine));
  const boxPadding = typeof node.fill === "string" || typeof node.line === "string" ? 0.28 : 0.18;
  return Math.min(8, Math.max(fontPt * 0.0353 * style.lineHeight + boxPadding, lines * fontPt * 0.0353 * style.lineHeight + boxPadding));
}

function cjkRatio(text: string): number {
  let cjk = 0;
  let total = 0;
  for (const char of text) {
    if (/\s/.test(char)) continue;
    total++;
    if (/[\u4e00-\u9fff]/.test(char)) cjk++;
  }
  return total === 0 ? 0 : cjk / total;
}

function componentStyle(theme: SimpleTheme, node: DomNode) {
  return typeof node.role === "string" ? theme.component[node.role] || {} : {};
}

function gapCm(theme: SimpleTheme, node: DomNode): number {
  return numberProp(node, "gap", theme.layout.defaultGap);
}

function paddingCm(theme: SimpleTheme, node: DomNode): number {
  const style = componentStyle(theme, node);
  return numberProp(node, "padding", style.padding ?? 0);
}

function avgCharWidthCm(theme: SimpleTheme, fontPt: number, bold = false): number {
  const latin = preferredFont(theme, "latin").toLowerCase();
  // Calibrated against LibreOffice headless renders. Aptos/Calibri at small
  // body sizes is ~0.0185 cm/pt, but bold display sizes (>= 22pt) widen to
  // ~0.022 cm/pt due to heavier strokes and looser kerning in headless mode.
  const base = latin.includes("aptos") || latin.includes("calibri") ? 0.019 : latin.includes("arial") ? 0.0195 : 0.019;
  const boldFactor = bold ? (fontPt >= 22 ? 1.18 : 1.10) : 1;
  return fontPt * base * boldFactor;
}

function textIntrinsicWidth(theme: SimpleTheme, node: DomNode): number {
  const style = effectiveTextStyle(theme, node, "paragraph");
  const text = renderedTextContent(node).replace(/\n/g, " ");
  // CJK glyphs render roughly 1pt × 1pt (square em-box) regardless of latin
  // metrics; mixed-script strings need per-glyph estimation, not the latin-
  // only avg charWidth × weighted-count formula (which underestimates by
  // ~30% on pages with currency-prefixed CJK like "$500亿+" or "500亿美元+").
  const latinChars = avgCharWidthCm(theme, style.fontSize, isStyleBold(style.weight));
  const cjkChars = style.fontSize * 0.0353 * 1.02;
  let width = 0;
  for (const ch of text) {
    width += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? cjkChars : latinChars;
  }
  return Math.min(8, Math.max(0.45, width + 0.35));
}

/**
 * Combine `text`, `content` runs, and `paragraphs` into a single string for
 * intrinsic-size estimation. Earlier this looked at `node.text` only, which
 * undercounted nodes whose runs add visible characters (e.g. metric-card
 * value followed by an inline trend glyph). The width estimate must reflect
 * what will actually render, otherwise the layout solver allocates too narrow
 * a box and OOXML wraps the line.
 */
function renderedTextContent(node: DomNode): string {
  const parts: string[] = [];
  if (typeof node.text === "string") parts.push(node.text);
  if (Array.isArray(node.content)) {
    for (const run of node.content) {
      if (run && typeof run === "object" && typeof (run as { text?: unknown }).text === "string") {
        parts.push((run as { text: string }).text);
      }
    }
  }
  if (Array.isArray(node.paragraphs)) {
    for (const para of node.paragraphs) {
      if (!para || typeof para !== "object") continue;
      const rec = para as Record<string, unknown>;
      if (typeof rec.text === "string") parts.push(rec.text);
      if (Array.isArray(rec.runs)) {
        for (const run of rec.runs) {
          if (run && typeof run === "object" && typeof (run as { text?: unknown }).text === "string") {
            parts.push((run as { text: string }).text);
          }
        }
      }
    }
  }
  if (parts.length === 0 && typeof node.content === "string") parts.push(node.content);
  return parts.join("");
}

function bulletsIntrinsicHeight(theme: SimpleTheme, node: DomNode, widthCm: number): number {
  const items = Array.isArray(node.items) ? node.items.map(String) : [""];
  const baseStyle = textStyle(theme, node.density === "compact" ? "bullet-compact" : "bullet", "paragraph");
  const mult = sizeMultiplier(theme, node.size);
  const style = mult === 1 ? baseStyle : { ...baseStyle, fontSize: baseStyle.fontSize * mult };
  const charWidthCm = avgCharWidthCm(theme, style.fontSize, isStyleBold(style.weight));
  const charsPerLine = Math.max(8, Math.floor(widthCm / charWidthCm));
  const lineCount = items.reduce((sum, item) => sum + Math.max(1, Math.ceil(weightedTextLength(item) / charsPerLine)), 0);
  const lineHeight = style.fontSize * 0.0353 * style.lineHeight;
  const paragraphGap = (node.density === "compact" ? 0.012 : 0.018) * style.fontSize;
  const titleHeight = typeof node.title === "string" && node.title.trim() ? 0.62 : 0;
  return Math.max(1.05, titleHeight + lineCount * lineHeight + Math.max(0, items.length - 1) * paragraphGap + 0.35);
}

function singleLineTextHeight(theme: SimpleTheme, node: DomNode): number {
  const style = effectiveTextStyle(theme, node, "paragraph");
  return style.fontSize * 0.0353 * style.lineHeight + 0.16;
}

function textStyleKey(node: DomNode): string {
  if (typeof node.style === "string" && node.style.trim()) return node.style;
  return inferTextKind(node).kind;
}

/**
 * Pre-shrink a text style so the rendered single-line width fits the rect.
 * Used by autoFit:"shrink" nodes to avoid LibreOffice not honoring the
 * runtime normAutofit hint. Floor at 70% of the original size — beyond
 * that the metric is illegible and the slide should be re-authored.
 */
function autoShrinkStyle(theme: SimpleTheme, node: DomNode, style: ReturnType<typeof textStyle>, rect: Rect): ReturnType<typeof textStyle> {
  const text = renderedTextContent(node).replace(/\n/g, " ");
  if (!text) return style;
  // Width margin baked into textShape (l:0.1 + r:0.1 = 0.2 cm) plus a safety
  // buffer so we land well inside the renderer's actual line-break threshold.
  const inner = Math.max(0.1, rect.w - 0.35);
  const isMostlyCjk = cjkRatio(text) > 0.5;
  const computeWidth = (fontPt: number): number => {
    // Bold display text in LibreOffice consistently rendered ~12-15% wider
    // than the cm/pt × char-count estimate; bake that in here so autoShrink
    // errs toward smaller-but-fits rather than estimated-fits-but-wraps.
    const boldFactor = isStyleBold(style.weight) ? (fontPt >= 22 ? 1.32 : 1.22) : 1;
    const latinW = fontPt * 0.019 * boldFactor;
    const cjkW = fontPt * 0.0353 * 1.05;
    if (isMostlyCjk) return text.length * cjkW;
    let w = 0;
    for (const ch of text) w += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? cjkW : latinW;
    return w;
  };
  if (computeWidth(style.fontSize) <= inner) return style;
  const minPt = Math.max(8, style.fontSize * 0.7);
  let lo = minPt, hi = style.fontSize, fitted = minPt;
  for (let iter = 0; iter < 12; iter++) {
    const mid = (lo + hi) / 2;
    if (computeWidth(mid) <= inner) {
      fitted = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  // Round to a half-pt to keep nice numbers.
  fitted = Math.round(fitted * 2) / 2;
  if (fitted >= style.fontSize - 0.25) return style;
  return { ...style, fontSize: fitted };
}

/**
 * Returns the theme text style after applying the node's `size` dial.
 * Agents pick semantic sizes (xs/sm/md/lg/xl/2xl); the multiplier is theme
 * controlled. Use this everywhere a fontSize is needed so layout
 * estimation and rendering stay in sync.
 */
function effectiveTextStyle(theme: SimpleTheme, node: DomNode, fallback = "paragraph"): ReturnType<typeof textStyle> {
  const key = textStyleKey(node);
  const base = textStyle(theme, key, fallback);
  const mult = sizeMultiplier(theme, node.size);
  if (mult === 1) return base;
  return { ...base, fontSize: base.fontSize * mult };
}

function nodeLabel(node: DomNode): string {
  return node.id;
}

function weightedTextLength(text: string): number {
  let length = 0;
  for (const char of text) length += /[\u4e00-\u9fff]/.test(char) ? 1.05 : 0.58;
  return length;
}

function fitToAvailableRespectingFixed(specs: SizeSpec[], sizes: number[], availableMain: number): number[] {
  const fixedTotal = specs.reduce((sum, spec, index) => sum + (spec.fixed ? sizes[index]! : 0), 0);
  const flexTotal = sizes.reduce((sum, size, index) => sum + (specs[index]!.fixed ? 0 : size), 0);
  const flexAvailable = Math.max(0, availableMain - fixedTotal);
  if (flexTotal <= 0) return sizes;
  if (flexTotal <= flexAvailable) return sizes;
  const scale = flexAvailable / flexTotal;
  return sizes.map((size, index) => specs[index]!.fixed ? size : size * scale);
}

function weightsFromProp(value: unknown, count: number): number[] {
  if (Array.isArray(value) && value.length === count) {
    return normalizeWeights(value.map((item) => typeof item === "number" && Number.isFinite(item) && item > 0 ? item : 1));
  }
  return normalizeWeights(Array.from({ length: count }, () => 1));
}

function normalizeWeights(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0);
  if (total <= 0) return values.map(() => 1 / values.length);
  return values.map((value) => Math.max(value, 0) / total);
}

function positionsFromWeights(start: number, availableSize: number, gap: number, weights: number[]): Array<{ start: number; size: number }> {
  const sizes = weights.map((weight) => availableSize * weight);
  return positionsFromSizes(start, gap, sizes);
}

function positionsFromSizes(start: number, gap: number, sizes: number[]): Array<{ start: number; size: number }> {
  const items: Array<{ start: number; size: number }> = [];
  let cursorEmu = Math.round(start * EMU_PER_CM);
  const gapEmu = Math.round(gap * EMU_PER_CM);
  for (const size of sizes) {
    const sizeEmu = Math.round(size * EMU_PER_CM);
    items.push({ start: cursorEmu / EMU_PER_CM, size: sizeEmu / EMU_PER_CM });
    cursorEmu += sizeEmu + gapEmu;
  }
  return items;
}

function fullRect(theme: SimpleTheme): Rect {
  return { x: 0, y: 0, w: theme.layout.slideWidthCm, h: theme.layout.slideHeightCm };
}

function xfrm(rect: Rect, node?: DomNode) {
  const base: { x: number; y: number; cx: number; cy: number; rot?: number; flipH?: boolean; flipV?: boolean } = {
    x: cm(rect.x), y: cm(rect.y), cx: cm(rect.w), cy: cm(rect.h),
  };
  if (node) {
    if (typeof node.rotation === "number" && node.rotation !== 0) base.rot = Math.round(node.rotation * 60000);
    if (node.flipH === true) base.flipH = true;
    if (node.flipV === true) base.flipV = true;
  }
  return base;
}

function cm(value: number): number {
  return Math.round(value * EMU_PER_CM);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function stringProp(node: DomNode, key: string, fallback: string): string {
  const value = node[key];
  return typeof value === "string" ? value : fallback;
}

function numberProp(node: DomNode, key: string, fallback: number): number {
  const value = node[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalNumberProp(node: DomNode, key: string): number | undefined {
  const value = node[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function alignProp(node: DomNode): "left" | "center" | "right" {
  return node.align === "center" || node.align === "right" ? node.align : "left";
}

function valignProp(node: DomNode, kind: string): "top" | "middle" | "bottom" {
  if (node.valign === "top" || node.valign === "bottom" || node.valign === "middle") return node.valign;
  if (kind === "paragraph" || kind === "article" || kind === "lead" || kind === "footnote" || kind === "caption" || kind === "figure-caption" || kind === "code") return "top";
  return "middle";
}

function containsCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function chartType(value: unknown): ChartType {
  if (value === "line" || value === "pie" || value === "doughnut" || value === "area" ||
      value === "stacked-bar" || value === "combo" || value === "scatter" || value === "waterfall") return value;
  return "bar";
}

function normalizeChartSeries(value: unknown): ChartSeries[] {
  if (!Array.isArray(value)) return [];
  const output: ChartSeries[] = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : `Series ${index + 1}`;
    if (Array.isArray(record.points)) {
      const points = record.points
        .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === "object"))
        .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (points.length > 0) output.push({ name, values: [], points });
      return;
    }
    const values = Array.isArray(record.values)
      ? record.values.map((v) => v === null ? null : Number(v)).filter((v): v is number | null => v === null || Number.isFinite(v))
      : [];
    if (values.length === 0) return;
    const series: ChartSeries = { name, values };
    if (record.type === "bar" || record.type === "line") series.type = record.type;
    output.push(series);
  });
  return output;
}
