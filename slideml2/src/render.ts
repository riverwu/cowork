import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { emitPackage } from "./emitter/package.js";
import type { ChartAnnotation, ChartDataLabels, ChartNumberFormat, ChartSeries, ChartType, DeckAst, FillSpec, ImageShape, LineSpec, Paragraph, ShapeList, SlideAst, TableCell, TextRun, ShapePreset } from "./emitter/types.js";
import { expandComponent, isComponentTypedNode } from "./component-registry.js";
import { clearRenderDiagnostics, contrastRatio, contrastThreshold, getRenderDiagnostics, pushDiagnostic, relativeLuminance } from "./diagnostics.js";
import { coverageRatio, meaningfulOverlap, meaningfulOverlayOcclusion, meaningfulStructuralOverlap, meaningfulTitleOcclusion, type OverlapMetrics } from "./layout/geometry.js";
import { inferTextKind } from "./text-normalizer.js";
import type { AnchorPoint, DomNode, RenderedDeck } from "./types.js";
import type { Slideml2SourceDeck } from "./types.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DataBindingOptions } from "./data-binding.js";
import { buildTheme, color, normalizeCornerRadius, preferredFont, resolveEmphasis, resolveFill, resolveFontWeight, sizeMultiplier, textStyle, toneStyle, type FontRole, type FontWeight, type SimpleTheme, type TextStyle } from "./theme.js";
import { parseMarkdownInline, splitNumericRun } from "./markdown-inline.js";
import { formatRichToken, latexToMathText, richInlinePlainText, richRunsPlainText } from "./m3-rich-inline.js";
import { latexToOmml } from "./latex-omml.js";
import { emuToCm, normalizeStrokeCm, SLIDE_SIZES } from "./units.js";
import { isDeckSize } from "./schema.js";

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
} = {}): { fontFace: string; eastAsianFontFace?: string; complexScriptFontFace?: string; cjk: boolean; mono: boolean } {
  const marks = options.marks || [];
  const weight = options.weight ?? style.weight;
  if (options.font === "mono" || marks.includes("code") || (!options.font && style.fontFamily === "mono")) {
    const monoFace = preferredFont(theme, "mono", "text", weight);
    return { fontFace: monoFace, eastAsianFontFace: monoFace, complexScriptFontFace: monoFace, cjk: true, mono: true };
  }
  const role: FontRole = options.font === "display" ? "display" : style.fontFamily || "text";
  const cjkFace = preferredFont(theme, "cjk", role, weight);
  if (options.font === "cjk") return { fontFace: cjkFace, eastAsianFontFace: cjkFace, cjk: true, mono: false };
  return {
    fontFace: preferredFont(theme, "latin", role, weight),
    eastAsianFontFace: cjkFace,
    cjk: true,
    mono: false,
  };
}

function plainTextRun(theme: SimpleTheme, text: string, style: TextStyle, bold: boolean, colorHex: string, options: {
  font?: "display" | "text" | "mono" | "cjk";
  weight?: FontWeight;
} = {}): TextRun {
  const runText = normalizeTextForPpt(text, options.font === "mono");
  const face = pickRunFontFace(theme, runText, style, { font: options.font, weight: options.weight ?? style.weight });
  return {
    text: runText,
    sizeHalfPt: style.fontSize * 2,
    bold,
    color: colorHex,
    fontFace: face.fontFace,
    eastAsianFontFace: face.eastAsianFontFace,
    complexScriptFontFace: face.complexScriptFontFace,
    cjk: face.cjk,
    mono: face.mono,
  };
}

function normalizeTextForPpt(text: string, literal = false): string {
  if (literal || !text) return text;
  return text.replace(/([^\s\u2060])([，。！？；：、）》」』】〕〉》])/g, "$1\u2060$2");
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
  "diamond",
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
  inkRect?: Rect;
  visualRect?: Rect;
  visualRole?: string;
  relation?: "caption-of" | "annotation-of" | "marker-of";
  relatedTo?: string;
  parentId?: string;
  alpha?: number;
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

export async function renderSourceDeckToPptx(deck: Slideml2SourceDeck, outputPath: string, options: DataBindingOptions = {}): Promise<{ outputPath: string; domPath: string }> {
  return renderToPptx(sourceToRenderedDeck(deck, options), outputPath);
}

export function renderToAst(deck: RenderedDeck): DeckAst {
  clearRenderDiagnostics();
  const { theme, size } = buildThemeForDeck(deck);
  layoutDecisionsBySlide.clear();
  squashedWarnings.clear();
  // umzrkm fix: pass the active theme's resolved palette into the contrast
  // check so an agent's brand.primary / accent / success / warning / danger
  // hex values count as "theme-resolved" — auto-fix can then rewrite them
  // when contrast fails. Without this, agents who rebrand to a mid-saturation
  // teal (5B8A8A) leak that color into text.color="brand.primary" callsites
  // and the contrast check refuses to repair, treating it as user intent.
  themeAccentHexesForContrast = collectThemeAccentHexes(theme);
  themeMutedHexesForContrast = collectThemeMutedHexes(theme);
  const slides: SlideAst[] = deck.slides.map((slide, index) => {
    const dom = materializeAndCompactify(slide.dom, slide.id);
    const ids = { nextId: 2 };
    const shapes = renderSlide(theme, dom, ids, slide.id);
    const resolvedBackground = resolveSlideBackground(theme, dom.background);
    const slideBgHex = pickContrastBackgroundColor(resolvedBackground);
    shapes.push(...renderChrome(theme, deck, index, ids, slideBgHex));
    const slideAst = {
      shapes,
      background: resolvedBackground,
      notes: typeof dom.notes === "string" ? dom.notes : undefined,
    };
    runTitleOcclusionCheck(slide.id, dom, slideAst);
    runContrastCheck(slide.id, slideAst, theme);
    runShapeVisibilityCheck(slide.id, slideAst, theme);
    return slideAst;
  });
  themeAccentHexesForContrast = null;
  themeMutedHexesForContrast = null;
  return {
    size,
    language: "zh-CN",
    title: "SlideML2 MVP",
    author: "SlideML2",
    slides,
  };
}

function buildThemeForDeck(deck: RenderedDeck): { theme: SimpleTheme; size: keyof typeof SLIDE_SIZES } {
  const size = isDeckSize(deck.deck.size) ? deck.deck.size : "16x9";
  const dims = SLIDE_SIZES[size];
  const override = {
    ...(deck.deck.themeOverride || {}),
    layout: {
      ...(deck.deck.themeOverride?.layout || {}),
      slideWidthCm: deck.deck.themeOverride?.layout?.slideWidthCm ?? emuToCm(dims.width),
      slideHeightCm: deck.deck.themeOverride?.layout?.slideHeightCm ?? emuToCm(dims.height),
    },
  };
  return { theme: buildTheme(deck.deck.brand, deck.deck.theme, override), size };
}

/**
 * Resolve a slide background expression. Accepts a token string, a hex (with or
 * without `#`), `{type:"solid", color:"<token>"}`,
 * `{fill: "linear-gradient(...)"}`/`{fill: "<token>"}`, or `{src:"/path"}`.
 * Falls back to the deck's `background` token. Gradients are preserved as-is
 * so the OOXML emitter can produce <a:gradFill>.
 */
function resolveSlideBackground(theme: SimpleTheme, raw: unknown):
  | { type: "solid"; color: string }
  | { type: "gradient"; kind: "linear" | "radial"; angle?: number; stops: Array<{ position: number; color: string }> }
  | { type: "image"; src: string } {
  if (raw && typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    if (typeof rec.src === "string" && rec.src.trim()) return { type: "image", src: rec.src };
    if (typeof rec.color === "string") return resolveFill(theme, rec.color, "background");
    if (typeof rec.fill === "string") return resolveFill(theme, rec.fill, "background");
  }
  return resolveFill(theme, raw, "background");
}

/**
 * Walk the rendered shapes once and emit LOW_CONTRAST diagnostics for any
 * text whose color sits on top of a too-similar fill. The picked surface is
 * the topmost preceding solid-fill rectangle that *mostly* contains the
 * text's bounding rect; the slide background is the fallback. Strict
 * containment used to misfire when a text shape's computed rect dipped a
 * hair outside its parent band/card due to text autofit and rounding —
 * "≥ 70% area overlap" matches what a human reader would call "the text
 * sits on this surface".
 */
function fillCoversText(fill: { x: number; y: number; w: number; h: number }, t: { x: number; y: number; w: number; h: number }): boolean {
  return coverageRatio(fill, t) >= 0.7;
}

/**
 * The title is normally the first shape, but PowerPoint paints later shapes on
 * top. A too-tight contentTop can therefore pass geometry validation while a
 * panel/card background visually covers the title. Detect that exact final
 * shape-order problem and block delivery instead of trusting the flow model.
 */
function runTitleOcclusionCheck(slideId: string, slideDom: DomNode, slide: { shapes: ShapeList }): void {
  const titleNode = directSlideTitleNode(slideDom);
  if (!titleNode) return;
  const titleIndex = slide.shapes.findIndex((shape) => shape.type === "text" && shape.name === titleNode.id);
  if (titleIndex < 0) return;
  const titleShape = slide.shapes[titleIndex]!;
  const titleRect = { x: titleShape.xfrm.x, y: titleShape.xfrm.y, w: titleShape.xfrm.cx, h: titleShape.xfrm.cy };
  for (let i = titleIndex + 1; i < slide.shapes.length; i++) {
    const shape = slide.shapes[i]!;
    if (shape.type !== "shape") continue;
    const fill = shape.fill;
    if (!fill || fill.type !== "solid" || fill.alpha !== undefined && fill.alpha < 0.25) continue;
    const rect = { x: shape.xfrm.x, y: shape.xfrm.y, w: shape.xfrm.cx, h: shape.xfrm.cy };
    const overlap = meaningfulTitleOcclusion(titleRect, rect);
    if (!overlap) continue;
    const ratio = overlap.ratioOfA;
    pushDiagnostic({
      severity: "error",
      code: "TITLE_OCCLUDED",
      slideId,
      nodeId: titleNode.id,
      message: `Slide title '${titleNode.id}' is covered by later shape '${shape.name || "shape"}' (${Math.round(ratio * 100)}% of title rect).`,
      suggestion: "For slides using slide.title, move the covering shape below the title band, put it behind the title with zIndex/layer, or use a no-title custom layout and omit slide.title.",
      measured: { rect: titleRect, other: { ...rect, nodeId: shape.name } },
    });
    return;
  }
}

/**
 * Cluster key for LOW_CONTRAST: same fg color on same bg color at the same
 * font-size bucket usually has a single root cause (deck theme token or
 * surface-tone misuse); collapsing them into one representative diagnostic
 * stops agents from chasing 6 identical issues across slides.
 */
function lowContrastClusterKey(fg: string, bg: string, fontPt: number, bold: boolean): string {
  const bucket = fontPt >= 18 ? "large" : fontPt >= 14 && bold ? "large-bold" : "small";
  return `${fg.toUpperCase()}>${bg.toUpperCase()}@${bucket}`;
}

function pickContrastBackgroundColor(bg: { type: string; color?: string; stops?: Array<{ color: string }> } | undefined): string {
  if (!bg) return "FFFFFF";
  if (bg.type === "solid" && typeof bg.color === "string") return bg.color;
  if (bg.type === "gradient" && Array.isArray(bg.stops) && bg.stops.length > 0) {
    // Average luminance across stops gives the closest single value for the
    // contrast check. Per-stop nuance isn't worth the complexity.
    const avg = bg.stops.map((stop) => stop.color).filter((c) => /^[0-9A-Fa-f]{6}$/.test(c));
    if (avg.length === 0) return "FFFFFF";
    const r = Math.round(avg.reduce((acc, c) => acc + parseInt(c.slice(0, 2), 16), 0) / avg.length);
    const g = Math.round(avg.reduce((acc, c) => acc + parseInt(c.slice(2, 4), 16), 0) / avg.length);
    const b = Math.round(avg.reduce((acc, c) => acc + parseInt(c.slice(4, 6), 16), 0) / avg.length);
    return [r, g, b].map((n) => n.toString(16).padStart(2, "0").toUpperCase()).join("");
  }
  return "FFFFFF";
}

function buildSurfaceTrail(slideBg: string, picked: { color: string; nodeId?: string } | null, fg: string, textNodeId: string): string[] {
  const trail: string[] = [`slide.bg:${slideBg.toUpperCase()}`];
  if (picked) {
    const tag = picked.nodeId ? ` (${picked.nodeId})` : "";
    trail.push(`surface${tag}.fill:${picked.color.toUpperCase()}`);
  }
  trail.push(`text(${textNodeId}).color:${fg.toUpperCase()}`);
  return trail;
}

/**
 * Hex values that match common "muted" theme tokens (text.muted, text.secondary,
 * default body grays). When body text resolves to one of these and the surface
 * makes it unreadable, the agent didn't pick the color directly — the theme
 * token resolved poorly. Auto-fix to a high-contrast neutral lets the deck
 * render readably until the agent overrides the deck-level token.
 */
const MUTED_TOKEN_HEXES = new Set([
  // Default theme.text.muted variants
  "8B949E", "8C959F", "5B6478", "484F58", "9CA3AF", "6B7280",
  "94A3B8", "64748B", "A0A4AB", "78808A",
  "718096", "4A5568", "2D3748",
  // Common light-theme muted picks (agent themeOverride.text.muted variants)
  "888888", "777777", "999999", "AAAAAA", "555555", "666666",
  // Common dark-theme muted picks
  "BBBBBB", "CCCCCC", "DDDDDD",
  // text.inverse defaults across themes — when these resolve onto a
  // mid-tone surface (warning.tint, success.tint) they often hit ~3.5:1
  // which is below WCAG body text. They're theme-resolved, not custom user
  // picks, so safe to auto-fix.
  "FFFFFF", "0D1117", "0F172A", "111827", "1A1A1A", "2C2C2C", "1E293B",
]);
function isLikelyMutedToken(hex: string): boolean {
  const upper = hex.toUpperCase();
  if (MUTED_TOKEN_HEXES.has(upper)) return true;
  if (themeMutedHexesForContrast && themeMutedHexesForContrast.has(upper)) return true;
  // Near-white or near-black hexes are almost always theme-resolved
  // (text.primary/inverse defaults), not custom user accent picks. Auto-fix
  // them when contrast fails — agents reach for brand-colored accents, not
  // F0F6FC, when they want a "custom" accent that should be preserved.
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return false;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum >= 0.92 || lum <= 0.08;
}

/**
 * Theme-resolved semantic accent hexes that frequently fail contrast on
 * non-neutral surfaces. These are template choices (success/warning/danger/
 * brand defaults across light + dark theme variants), not custom user picks,
 * so rewriting them preserves agent intent.
 */
const SEMANTIC_ACCENT_HEXES = new Set([
  // success across dark + light + tinted themes
  "0E7C3A", "16A34A", "22C55E", "10B981", "047857", "2E7D32", "166534",
  // warning
  "F59E0B", "EAB308", "B45309", "92400E", "E65100",
  // danger
  "DC2626", "EF4444", "B42318", "B71C1C", "991B1B",
  // brand defaults shipped with the engine + common agent picks
  "2563EB", "1D4ED8", "0F4C81", "8B6914", "B8860B", "C0392B", "C41E3A", "8B0000", "4F46E5", "7C3AED",
]);
function isLikelySemanticAccent(hex: string): boolean {
  if (SEMANTIC_ACCENT_HEXES.has(hex.toUpperCase())) return true;
  // Active theme tokens (brand/accent/success/warning/danger). When the
  // deck's themeOverride supplies a custom palette we treat those hexes
  // the same as the engine defaults: theme-resolved, eligible for
  // auto-fix when contrast fails.
  if (themeAccentHexesForContrast && themeAccentHexesForContrast.has(hex.toUpperCase())) return true;
  return false;
}

let themeAccentHexesForContrast: Set<string> | null = null;
let themeMutedHexesForContrast: Set<string> | null = null;

function collectThemeAccentHexes(theme: SimpleTheme): Set<string> {
  const out = new Set<string>();
  const tokens = [
    "brand.primary", "brand.tint",
    "accent",
    "success", "success.accent", "warning", "warning.accent", "danger", "danger.accent", "info", "info.accent",
    "neutral",
  ];
  for (const tok of tokens) {
    const hex = theme.colors[tok];
    if (typeof hex === "string" && /^[0-9A-Fa-f]{6}$/.test(hex)) out.add(hex.toUpperCase());
  }
  return out;
}

function collectThemeMutedHexes(theme: SimpleTheme): Set<string> {
  const out = new Set<string>();
  const tokens = [
    "text.muted",
    "text.secondary",
    "text.tertiary",
    "text.subtle",
    "chart.neutral",
    "neutral",
  ];
  for (const tok of tokens) {
    const hex = theme.colors[tok];
    if (typeof hex === "string" && /^[0-9A-Fa-f]{6}$/.test(hex)) out.add(hex.toUpperCase());
  }
  return out;
}

/**
 * Auto-fix LOW_CONTRAST when the agent's text color (or its style default)
 * collides with the surface luminance. We rewrite the run color in-place to a
 * safe black/white pick — the diagnostic still fires so the agent learns about
 * it, but the rendered PPTX is readable instead of invisible.
 */
function autoFixLowContrast(slide: { shapes: ShapeList }, head: { fg: string; bg: string; nodeId: string }, theme?: SimpleTheme): string | null {
  for (const shape of slide.shapes) {
    if (shape.type !== "text") continue;
    if (shape.name !== head.nodeId) continue;
    // Intent-preserving fix: if the original fg matches an accent token
    // in the active theme, try to swap to a *different* accent that
    // contrasts. This preserves the agent's emphasis intent (e.g.
    // eyebrow on dark cover stays a "color pop" instead of becoming
    // plain text.inverse alongside neighboring body text). Only fall
    // back to black/white when no theme accent works.
    let replacement = theme ? pickIntentPreservingFix(theme, head.fg, head.bg) : null;
    if (!replacement) replacement = pickContrastingHex(head.bg);
    let touched = false;
    for (const para of shape.paragraphs || []) {
      for (const run of para.runs || []) {
        if (typeof run.color === "string" && run.color.toUpperCase() === head.fg.toUpperCase()) {
          run.color = replacement;
          touched = true;
        }
      }
    }
    if (touched) return replacement;
  }
  return null;
}

/**
 * If the failing fg color is one of the theme's named accent tokens
 * (brand.primary, accent, accent1..3, palette colors, success/warning/
 * danger), find a sibling accent in the same theme that has acceptable
 * contrast against the bg. This preserves emphasis intent — e.g. an
 * eyebrow set to brand.primary on a brand-primary background gets
 * promoted to accent1 (still a "color pop"), not to plain white.
 *
 * Returns null when no theme accent works → caller falls back to
 * plain pickContrastingHex.
 */
function pickIntentPreservingFix(theme: SimpleTheme, fgHex: string, bgHex: string): string | null {
  const fgUpper = fgHex.toUpperCase();
  const bgUpper = bgHex.toUpperCase();
  // Identify the agent's named accent tokens. Don't bother with text.*
  // tokens — collapsing those to inverse is the right call.
  const accentTokens = [
    "accent", "accent1", "accent2", "accent3",
    "brand.primary", "brand.tint",
    "success", "success.accent", "warning", "warning.accent", "danger", "danger.accent", "info", "info.accent",
    "red", "orange", "yellow", "lime", "green", "teal", "blue", "purple", "pink",
  ];
  // Was the failing color one of these? If not, the fix isn't intent-
  // sensitive — let the caller use the standard black/white fallback.
  let originalIsAccent = false;
  for (const tok of accentTokens) {
    const hex = theme.colors[tok];
    if (typeof hex === "string" && hex.toUpperCase() === fgUpper) {
      originalIsAccent = true;
      break;
    }
  }
  if (!originalIsAccent) return null;
  // First try preserving hue: darken (or lighten, on dark bgs) the
  // original color until it passes the contrast threshold. This keeps
  // the agent's brand color visually faithful — e.g. the agent's
  // brand.primary 6366F1 (purple, 4.47:1 on white) becomes ~4F46E5
  // (still purple, ~6.6:1) instead of the default blue 2563EB.
  // (oc7dyx log: 69 LOW_CONTRAST_FIXED instances of 6366F1→2563EB
  // silently swapped the agent's brand purple for the default blue.)
  //
  // Only attempt hue-preservation when the original color has SOME
  // contrast against the bg (≥ 2.0:1 ≈ borderline-readable). When
  // fg ≈ bg exactly (text-on-same-color band, contrast 1.0–1.5:1),
  // shading would have to traverse so far it's no longer the same hue
  // — fall through to the sibling-accent search instead.
  const currentRatio = contrastRatio(fgUpper, bgUpper);
  if (currentRatio >= 2.0) {
    const huePreserved = pickShadedVariantForContrast(fgUpper, bgUpper, 4.5);
    if (huePreserved) return huePreserved;
  }
  // Find a sibling accent that (a) reaches 4.5:1 and (b) preserves the
  // "color pop" intent. The naive max-contrast pick on a dark bg is
  // brand.tint (a near-white) which technically passes contrast but
  // collapses the emphasis to plain inverse — exactly what we're trying
  // to avoid. Rank candidates by chroma (max(R,G,B)-min(R,G,B)) first,
  // then contrast: a saturated accent wins over a tint even if the tint
  // has slightly higher contrast.
  let best: { hex: string; chroma: number; ratio: number } | null = null;
  for (const tok of accentTokens) {
    const hex = theme.colors[tok];
    if (typeof hex !== "string" || !/^[0-9A-Fa-f]{6}$/.test(hex)) continue;
    if (hex.toUpperCase() === fgUpper) continue;
    const ratio = contrastRatio(hex, bgUpper);
    if (ratio < 4.5) continue;
    const chroma = hexChroma(hex);
    if (!best || chroma > best.chroma || (chroma === best.chroma && ratio > best.ratio)) {
      best = { hex, chroma, ratio };
    }
  }
  // Require minimum chroma to count as "intent-preserving"; a pure
  // grayscale pick (e.g. brand.tint EEF2FF, chroma ~17) is no better
  // than the plain pickContrastingHex fallback. 60 covers all standard
  // chromatic accents (C4622D=151, 4A7C6F=46→close call but acceptable).
  if (best && best.chroma >= 40) return best.hex;
  return null;
}

function hexChroma(hex: string): number {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/**
 * Find the smallest tonal nudge of `srcHex` that still hits `threshold`
 * contrast against `bgHex`. Mixes toward black (when bg is light) or
 * white (when bg is dark) in 5% steps up to 60%. Returns null when no
 * mix in that range passes — caller falls back to sibling-accent search.
 *
 * The point: an agent's brand.primary that lands at 4.47:1 (just below
 * 4.5) gets a slightly darker variant of the SAME hue rather than being
 * swapped wholesale for a different theme color.
 */
function pickShadedVariantForContrast(srcHex: string, bgHex: string, threshold: number): string | null {
  const cleanSrc = srcHex.replace(/^#/, "");
  const cleanBg = bgHex.replace(/^#/, "");
  if (!/^[0-9A-Fa-f]{6}$/.test(cleanSrc) || !/^[0-9A-Fa-f]{6}$/.test(cleanBg)) return null;
  const bgIsLight = relativeLuminance(cleanBg) > 0.5;
  const target = bgIsLight ? "000000" : "FFFFFF";
  const sr = parseInt(cleanSrc.slice(0, 2), 16);
  const sg = parseInt(cleanSrc.slice(2, 4), 16);
  const sb = parseInt(cleanSrc.slice(4, 6), 16);
  const tr = parseInt(target.slice(0, 2), 16);
  const tg = parseInt(target.slice(2, 4), 16);
  const tb = parseInt(target.slice(4, 6), 16);
  for (let pct = 5; pct <= 60; pct += 5) {
    const t = pct / 100;
    const r = Math.round(sr + (tr - sr) * t);
    const g = Math.round(sg + (tg - sg) * t);
    const b = Math.round(sb + (tb - sb) * t);
    const hex = [r, g, b].map((n) => n.toString(16).padStart(2, "0").toUpperCase()).join("");
    if (contrastRatio(hex, cleanBg) >= threshold) return hex;
  }
  return null;
}


function runContrastCheck(slideId: string, slide: { shapes: ShapeList; background?: { type: string; color?: string; stops?: Array<{ color: string }> } }, theme?: SimpleTheme): void {
  const slideBg = pickContrastBackgroundColor(slide.background);
  const fillShapes: Array<{ x: number; y: number; w: number; h: number; color: string; nodeId?: string }> = [];
  type Hit = {
    fg: string;
    bg: string;
    ratio: number;
    threshold: number;
    fontPt: number;
    bold: boolean;
    nodeId: string;
    sample: string;
    rect: { x: number; y: number; w: number; h: number };
    surfaceTrail: string[];
  };
  const hits: Hit[] = [];
  for (const shape of slide.shapes) {
    if (shape.type === "shape" && shape.fill && shape.fill.type === "solid" && typeof shape.fill.color === "string") {
      fillShapes.push({ x: shape.xfrm.x, y: shape.xfrm.y, w: shape.xfrm.cx, h: shape.xfrm.cy, color: shape.fill.color, nodeId: shape.name });
    }
    if (shape.type === "text") {
      const trect = { x: shape.xfrm.x, y: shape.xfrm.y, w: shape.xfrm.cx, h: shape.xfrm.cy };
      let bg = slideBg;
      let picked: { color: string; nodeId?: string } | null = null;
      if (shape.fill && shape.fill.type === "solid" && typeof shape.fill.color === "string") {
        bg = shape.fill.color;
        picked = { color: shape.fill.color, nodeId: shape.name };
      } else {
        for (let i = fillShapes.length - 1; i >= 0; i--) {
          const f = fillShapes[i]!;
          if (fillCoversText(f, trect)) {
            bg = f.color;
            picked = { color: f.color, nodeId: f.nodeId };
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
          const bold = run.bold === true;
          const threshold = contrastThreshold(fontPt, bold);
          if (ratio < threshold) {
            hits.push({
              fg,
              bg,
              ratio,
              threshold,
              fontPt,
              bold,
              nodeId: shape.name || `slide-${slideId}.text`,
              sample: run.text.slice(0, 40),
              rect: trect,
              surfaceTrail: buildSurfaceTrail(slideBg, picked, fg, shape.name || "text"),
            });
          }
        }
      }
    }
  }
  if (hits.length === 0) return;
  // Cluster: emit one representative per (fg,bg,fontBucket) and roll the rest
  // into aggregated.affectedNodes. The representative is the first occurrence,
  // so its message + trail describe the cause unambiguously.
  const clusters = new Map<string, Hit[]>();
  for (const hit of hits) {
    const key = lowContrastClusterKey(hit.fg, hit.bg, hit.fontPt, hit.bold);
    const list = clusters.get(key) || [];
    list.push(hit);
    clusters.set(key, list);
  }
  for (const [, group] of clusters) {
    const head = group[0]!;
    const others = group.slice(1);
    const isLarge = head.fontPt >= 18;
    const surfaceLabel = head.bg.toUpperCase();
    const fgLabel = head.fg.toUpperCase();
    // Auto-fix tiers, ordered by confidence:
    //   1. fg ≡ bg (text is literally invisible — always rewrite)
    //   2. small body text < 3.0 AND fg is a known muted token hex
    //      (text.muted defaults across themes) — token resolved poorly,
    //      rewriting preserves agent intent for explicit colors.
    //   3. medium text (13 ≤ fontPt < 18) at < 2.5:1 — clearly unreadable.
    //   4. medium text < 3.0:1 AND fg is a known muted token hex.
    //   5. large text < 3.0 AND fg is a known semantic accent (success/
    //      warning/danger/brand defaults) that fails on the picked surface.
    //      These are theme-resolved colors, not user picks; rewriting them
    //      avoids invisible KPI values on dark themes.
    //   6. large text < 2.5:1 unconditionally (egregiously unreadable
    //      headline — even a custom accent should be fixed).
    const repairs: string[] = [];
    const isBodyText = head.fontPt < 13;
    const isMediumText = head.fontPt >= 13 && head.fontPt < 18;
    const isLargeText = head.fontPt >= 18;
    const fgEqualsBg = head.fg.toUpperCase() === head.bg.toUpperCase();
    const fgIsMutedDefault = isLikelyMutedToken(head.fg);
    const fgIsSemanticAccent = isLikelySemanticAccent(head.fg);
    const fgIsThemeResolved = fgIsMutedDefault || fgIsSemanticAccent;
    const shouldAutoFix = fgEqualsBg
      // Body text (caption, label, footnote, metric-label, quote-source)
      // below WCAG: rewrite when fg is a theme-resolved default (muted token
      // or semantic accent). User accent colors that happen to fall short
      // are NOT touched here — they're agent intent.
      || (isBodyText && head.ratio < 4.5 && fgIsThemeResolved)
      || (isMediumText && head.ratio < 2.5)
      || (isMediumText && head.ratio < 4.5 && fgIsThemeResolved)
      || (isLargeText && head.ratio < 3.0 && fgIsThemeResolved)
      || (isLargeText && head.ratio < 2.5);
    if (shouldAutoFix) {
      for (const hit of group) {
        const fixed = autoFixLowContrast(slide, hit, theme);
        if (fixed) repairs.push(`${hit.nodeId}→#${fixed}`);
      }
    }
    const repairTrail = repairs.length > 0 ? ` Renderer auto-fixed (text invisible against same-color surface): ${repairs.slice(0, 5).join(", ")}${repairs.length > 5 ? ` and ${repairs.length - 5} more` : ""}.` : "";
    const baseMessage = `Text "${head.sample}" has contrast ${head.ratio.toFixed(2)}:1 (fg ${fgLabel} on ${surfaceLabel}; need ≥ ${head.threshold.toFixed(1)}:1${isLarge ? " for large" : ""}).`;
    const message = others.length > 0
      ? `${baseMessage} Same root cause affects ${others.length + 1} text nodes.${repairTrail}`
      : `${baseMessage}${repairTrail}`;
    const suggestion = `Surface trail: ${head.surfaceTrail.join(" → ")}. Pick a fg token with sufficient contrast against ${surfaceLabel} (e.g. text.primary on light fills, text.inverse on dark fills). If the mismatch is systemic, fix the deck theme token rather than each slide.`;
    // When auto-fix actually rewrote every distinct text node in the cluster,
    // demote the diagnostic to LOW_CONTRAST_FIXED — the rendered PPTX is now
    // readable so this should not block the agent. The diagnostic is still
    // emitted so the agent can fix the deck theme token if the mismatch is
    // systemic. We compare repaired-count against UNIQUE nodeIds in the
    // group (multiple paragraph runs share one shape; one rewrite covers
    // them all).
    const uniqueNodeIds = new Set(group.map((h) => h.nodeId));
    const fullyFixed = repairs.length >= uniqueNodeIds.size;
    pushDiagnostic({
      severity: "warn",
      code: fullyFixed ? "LOW_CONTRAST_FIXED" : "LOW_CONTRAST",
      slideId,
      nodeId: head.nodeId,
      message,
      suggestion,
      measured: { rect: head.rect },
      surfaceTrail: head.surfaceTrail,
      ...(others.length > 0
        ? { aggregated: { count: group.length, affectedNodes: group.map((h) => ({ nodeId: h.nodeId, sample: h.sample })) } }
        : {}),
    });
  }
}

/**
 * Pick a high-contrast neutral that pairs with the given background:
 * dark text on light bg, light text on dark bg. Returned as a 6-char hex
 * the agent can copy into the next set_theme/text color.
 */
/**
 * Detect decorative shapes whose fill is the same (or near-same) color
 * as the surface they sit on — these render as completely invisible. The
 * cover-slide bug from the 437sxs log: agent set
 * `slide.background = "brand.primary"` and inside the slide a 0.06cm-tall
 * accent rule `{type:"shape", fill:"brand.primary"}` — both resolve to
 * the same hex, so the decoration vanishes.
 *
 * The contrast check above only scrutinizes text. This pass extends the
 * same idea to non-text shapes: if a shape's fill ≈ its surface, emit
 * SHAPE_INVISIBLE and (when the shape is small/decorative) auto-promote
 * the fill to a high-contrast token from the active theme.
 *
 * Hands-off triggers:
 *   - Skip large shapes (likely cards / panels / bands; their inside
 *     contents disambiguate them, even on same-bg fills).
 *   - Skip shapes with line/border that itself contrasts.
 *   - Skip shapes whose fill is "none".
 *
 * Promotion target:
 *   - Prefer the agent's accent tokens (accent / accent1..3) if present.
 *   - Fall back to brand.primary or theme.colors.divider.
 *   - Last resort: pickContrastingHex (black or white).
 */
/**
 * Is this hex one of the theme's "intentionally subtle" tokens? These are
 * tokens the agent picks specifically to de-emphasize (separators, muted
 * caveats, tertiary text). The SHAPE_INVISIBLE auto-promote must NOT
 * rewrite them — doing so flips visual hierarchy on its head.
 */
function isSubtleByDesignToken(theme: SimpleTheme, hex: string): boolean {
  const upper = hex.toUpperCase();
  const subtleTokens = ["divider", "border", "surface.subtle", "surface.muted", "brand.tint", "text.muted", "text.subtle"];
  for (const tok of subtleTokens) {
    const v = theme.colors[tok];
    if (typeof v === "string" && v.toUpperCase() === upper) return true;
  }
  return false;
}

function runShapeVisibilityCheck(slideId: string, slide: { shapes: ShapeList; background?: { type: string; color?: string; stops?: Array<{ color: string }> } }, theme: SimpleTheme): void {
  const slideBg = pickContrastBackgroundColor(slide.background);
  const fillCovers: Array<{ x: number; y: number; w: number; h: number; color: string; nodeId?: string }> = [];
  for (const shape of slide.shapes) {
    if (shape.type !== "shape") {
      // Track filled non-shape regions too (text shapes with fill,
      // image shapes); they form parent surfaces for any subsequent
      // shape sitting on top.
      if ((shape.type === "text" || shape.type === "image") && (shape as { fill?: { type: string; color?: string } }).fill) {
        const f = (shape as { fill?: { type: string; color?: string } }).fill;
        if (f && f.type === "solid" && typeof f.color === "string") {
          fillCovers.push({ x: shape.xfrm.x, y: shape.xfrm.y, w: shape.xfrm.cx, h: shape.xfrm.cy, color: f.color, nodeId: shape.name });
        }
      }
      continue;
    }
    // Solid-fill preset shape with no/weak border.
    const fill = shape.fill;
    if (!fill || fill.type !== "solid" || typeof fill.color !== "string") {
      // Track for downstream surface-trail detection but not eligible
      // for this check.
      continue;
    }
    const fillHex = fill.color.toUpperCase();
    // Subtle-by-design tokens: when the fill exactly matches a theme
    // token whose semantic role is "intentionally low contrast" (divider,
    // border, surface.subtle, text.muted), the agent chose to de-emphasize.
    // Promoting such a shape to brand.primary would invert the visual
    // meaning — e.g. a takeaway-list with a `tone:"neutral"` accent bar
    // intentionally renders as a divider gray, and auto-promoting to
    // brand turns the muted item into the most prominent one.
    // (qyectb log slide 13 regression.)
    if (isSubtleByDesignToken(theme, fillHex)) continue;
    // Determine the surface this shape stands on: if a previous fill
    // covers this shape, that's the parent surface; else slide bg.
    const myRect = { x: shape.xfrm.x, y: shape.xfrm.y, w: shape.xfrm.cx, h: shape.xfrm.cy };
    let surfaceColor = slideBg;
    let surfaceLabel = `slide.bg:${slideBg}`;
    for (let i = fillCovers.length - 1; i >= 0; i--) {
      const f = fillCovers[i]!;
      if (fillCoversText(f, myRect)) {
        surfaceColor = f.color;
        surfaceLabel = `surface(${f.nodeId || "?"}).fill:${f.color}`;
        break;
      }
    }
    // Track this shape as a surface for descendants too.
    fillCovers.push({ ...myRect, color: fillHex, nodeId: shape.name });
    // If line provides visible border (contrast ≥ 2:1 vs surface), the
    // shape is still discernible — skip.
    if (shape.line && typeof shape.line.color === "string") {
      const lineRatio = contrastRatio(shape.line.color, surfaceColor);
      if (isSubtleByDesignToken(theme, shape.line.color) && lineRatio >= 1.08) continue;
      if (lineRatio >= 2.0) continue;
    }
    const ratio = contrastRatio(fillHex, surfaceColor);
    if (ratio >= 1.3) continue;
    // It's invisible. Decide whether to auto-promote: only promote
    // small / decorative shapes (thin rules, narrow stripes, dots,
    // small icons). Larger shapes (cards, panels) typically have
    // inner content that disambiguates them — leave fill alone, just
    // diagnose.
    const wCm = myRect.w / EMU_PER_CM;
    const hCm = myRect.h / EMU_PER_CM;
    const isDecorative = (wCm < 0.6 || hCm < 0.6) || (wCm * hCm < 1.5);
    let repaired: string | null = null;
    let borderAdded: string | null = null;
    if (isDecorative) {
      const replacement = pickAccentForSurface(theme, surfaceColor, fillHex);
      if (replacement && replacement.toUpperCase() !== fillHex) {
        shape.fill = { type: "solid", color: replacement };
        if (shape.line && typeof shape.line.color === "string" && shape.line.color.toUpperCase() === fillHex) {
          shape.line = { ...shape.line, color: replacement };
        }
        repaired = replacement;
      }
    } else {
      // Large invisible shape — typically a card backing whose surface
      // (e.g. white) matches the slide bg (off-white). Don't repaint:
      // cards have inner content and the agent chose white deliberately.
      // Instead, give it a thin contrasting border so the card has a
      // visible boundary. (96vi8n log: 8 metric-card / table-card
      // backgrounds were SHAPE_INVISIBLE on F8FAFC; the cards looked
      // empty rather than as separate modules.)
      //
      // SKIP if the shape already has a visible shadow — elevation
      // SKIP if the shape carries a STRONG shadow — `floating`
      // elevation uses shadow as the primary boundary signal (alpha
      // ~0.28, blur ~14pt), so adding a border would override the
      // intended floating-card look. `raised` (alpha ~0.18, blur ~6pt)
      // is too subtle to delineate the card on a same-color slide bg
      // by itself, so we still add a border there.
      const shadow = (shape as { shadow?: { alpha?: number; blur?: number } }).shadow;
      const hasStrongShadow = !!shadow && (
        (typeof shadow.alpha === "number" && shadow.alpha >= 0.25)
        || (typeof shadow.blur === "number" && shadow.blur >= 100000)
      );
      // SKIP if the agent supplied a non-solid line treatment (dash etc.)
      // — overwriting their explicit `dash` style with a default border
      // would lose intent.
      const hasAgentLineStyle = !!(shape.line && typeof (shape.line as { dash?: string }).dash === "string");
      if (!hasStrongShadow && !hasAgentLineStyle) {
        // pickBorderForSurface already filters by the same 1.5:1
        // dual-contrast threshold; if it returns a hex, that hex is
        // guaranteed to contrast with both surface and fill — no need
        // to re-check here.
        const borderColor = pickBorderForSurface(theme, surfaceColor, fillHex);
        if (borderColor) {
          const widthEmu = (shape.line && typeof shape.line.width === "number" && shape.line.width > 0)
            ? shape.line.width
            : cm(0.025);
          shape.line = { color: borderColor.toUpperCase(), width: widthEmu };
          borderAdded = borderColor.toUpperCase();
        }
      }
    }
    const fixed = repaired || borderAdded;
    pushDiagnostic({
      severity: "warn",
      code: fixed ? "SHAPE_INVISIBLE_FIXED" : "SHAPE_INVISIBLE",
      slideId,
      nodeId: shape.name,
      message: `Shape '${shape.name || "?"}' has fill #${fillHex} on surface #${surfaceColor.toUpperCase()} (contrast ${ratio.toFixed(2)}:1) — visually invisible.${
        repaired ? ` Renderer auto-promoted fill to #${repaired.toUpperCase()}.` :
        borderAdded ? ` Renderer auto-added a #${borderAdded} border so the card has a visible boundary.` : ""
      }`,
      surfaceTrail: [surfaceLabel, `shape(${shape.name}).fill:${fillHex}`],
      suggestion: repaired
        ? "Decorative shape was auto-promoted to a contrasting accent. To control the choice, set fill to an explicit token (accent / accent1 / brand.primary)."
        : borderAdded
          ? "Card backing was auto-bordered. To control the look, set `borderColor`/`line` to an explicit token, or change the card fill to a tinted surface (surface.subtle, surfaceSecondary)."
          : "Pick a fill token that contrasts with this surface — typically an accent token. For card backings on near-white slide bgs, set `borderColor:\"divider\"` or `fill:\"surface.subtle\"`.",
    });
  }
}

/**
 * Pick a thin border color that delineates an otherwise-invisible card.
 * Prefers theme `divider` / `border` (the canonical separator tokens) if
 * they contrast with both the card fill and the slide bg; falls back to a
 * neutral text-muted gray.
 */
function pickBorderForSurface(theme: SimpleTheme, surfaceHex: string, fillHex: string): string | null {
  const subtleCandidates = ["divider", "border", "surface.subtle"];
  for (const tok of subtleCandidates) {
    const v = theme.colors[tok];
    if (typeof v !== "string" || !/^[0-9A-Fa-f]{6}$/.test(v)) continue;
    const ratioVsSurface = contrastRatio(v, surfaceHex);
    const ratioVsFill = contrastRatio(v, fillHex);
    if (ratioVsSurface >= 1.08 && ratioVsFill >= 1.08) return v;
  }
  const fallbackCandidates = ["text.muted"];
  for (const tok of fallbackCandidates) {
    const v = theme.colors[tok];
    if (typeof v !== "string" || !/^[0-9A-Fa-f]{6}$/.test(v)) continue;
    const ratioVsSurface = contrastRatio(v, surfaceHex);
    const ratioVsFill = contrastRatio(v, fillHex);
    if (ratioVsSurface >= 1.5 && ratioVsFill >= 1.5) return v;
  }
  return null;
}

/**
 * Pick a token from the theme's accent palette that has decent contrast
 * (≥ 3:1) against the given surface and differs from the original color.
 * Falls back to a black/white pickContrastingHex result if no theme
 * accent works.
 */
function pickAccentForSurface(theme: SimpleTheme, surfaceHex: string, originalHex: string): string {
  const surface = surfaceHex.toUpperCase();
  const original = originalHex.toUpperCase();
  // Try the agent's custom accents (accent, accent1..3) first, then
  // brand and palette colors.
  const candidates = [
    "accent", "accent1", "accent2", "accent3",
    "brand.primary", "brand.tint",
    "warning", "success", "danger", "info",
    "text.primary", "text.inverse",
    "divider",
  ];
  for (const tok of candidates) {
    const hex = theme.colors[tok];
    if (typeof hex !== "string" || !/^[0-9A-Fa-f]{6}$/.test(hex)) continue;
    const upper = hex.toUpperCase();
    if (upper === original) continue;
    const ratio = contrastRatio(hex, surface);
    if (ratio >= 3.0) return hex;
  }
  return pickContrastingHex(surfaceHex);
}

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
  const { theme } = buildThemeForDeck(deck);
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
  const layeredIds = collectLayeredIds(slideDom);
  const containerIds = collectContainerIds(slideDom);
  detectSiblingContainerOverlaps(slideId, measured, slideDom, overlayIds, layeredIds, containerIds);
  detectOverlayOcclusions(slideId, measured, slideDom, overlayIds);
  const candidates = measured.filter((node) =>
    node.id !== slideDom.id && node.visualRole !== "container" && !isUnderAnyRoot(node.id, overlayIds) && !skipIds.has(node.id) && !layeredIds.has(node.id),
  );
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      if (containerIds.has(a.id) || containerIds.has(b.id)) continue;
      if (isAncestorOf(slideDom, a.id, b.id) || isAncestorOf(slideDom, b.id, a.id)) continue;
      const aRect = collisionRect(a);
      const bRect = collisionRect(b);
      if (!aRect || !bRect) continue;
      const overlap = meaningfulOverlap(aRect, bRect);
      if (!overlap) continue;
      const sibling = a.parentId && a.parentId === b.parentId;
      const code = isDecorativeMeasuredNode(a) || isDecorativeMeasuredNode(b)
        ? "DECORATIVE_OVERLAP"
        : sibling ? "SIBLING_INK_OVERLAP" : "COLLISION";
      pushCollisionDiagnostic(slideId, code, a, b, overlap, sibling ? "sibling-ink-overlap" : "leaf-ink-overlap", slideDom);
    }
  }
}

function detectSiblingContainerOverlaps(
  slideId: string,
  measured: MeasuredNode[],
  slideDom: DomNode,
  overlayIds: Set<string>,
  layeredIds: Set<string>,
  containerIds: Set<string>,
): void {
  const containers = measured.filter((node) =>
    node.id !== slideDom.id
    && containerIds.has(node.id)
    && node.visualRect
    && !isUnderAnyRoot(node.id, overlayIds)
    && !layeredIds.has(node.id),
  );
  for (let i = 0; i < containers.length; i++) {
    for (let j = i + 1; j < containers.length; j++) {
      const a = containers[i]!;
      const b = containers[j]!;
      const aParent = a.parentId || slideDom.id;
      const bParent = b.parentId || slideDom.id;
      if (aParent !== bParent) continue;
      const aRect = collisionRect(a);
      const bRect = collisionRect(b);
      if (!aRect || !bRect) continue;
      const overlap = meaningfulStructuralOverlap(aRect, bRect);
      if (!overlap) continue;
      pushCollisionDiagnostic(slideId, "STRUCTURAL_OVERLAP", a, b, overlap, "sibling-container-overlap", slideDom);
    }
  }
}

function detectOverlayOcclusions(
  slideId: string,
  measured: MeasuredNode[],
  slideDom: DomNode,
  overlayIds: Set<string>,
): void {
  const overlayRoots = new Set(Array.from(overlayIds).filter((id) => {
    const node = findNodeById(slideDom, id);
    if (!node) return false;
    if (node.layer === "behind") return false;
    return true;
  }));
  if (overlayRoots.size === 0) return;
  const overlays = measured.filter((node) =>
    node.id !== slideDom.id
    && node.visualRole !== "container"
    && isUnderAnyRoot(node.id, overlayRoots),
  );
  const flow = measured.filter((node) =>
    node.id !== slideDom.id
    && node.visualRole !== "container"
    && !isUnderAnyRoot(node.id, overlayRoots)
    && !isMeasuredCaption(node),
  );
  for (const overlay of overlays) {
    const overlayRect = collisionRect(overlay);
    if (!overlayRect) continue;
    for (const target of flow) {
      const targetRect = collisionRect(target);
      if (!targetRect) continue;
      const overlap = meaningfulOverlayOcclusion(overlayRect, targetRect);
      if (!overlap) continue;
      pushCollisionDiagnostic(
        slideId,
        isDecorativeMeasuredNode(overlay) ? "DECORATIVE_OVERLAP" : "OVERLAY_OCCLUDES_FLOW",
        overlay,
        target,
        overlap,
        "overlay-occludes-flow",
        slideDom,
      );
    }
  }
}

function pushCollisionDiagnostic(
  slideId: string,
  code: "COLLISION" | "SIBLING_INK_OVERLAP" | "STRUCTURAL_OVERLAP" | "DECORATIVE_OVERLAP" | "OVERLAY_OCCLUDES_FLOW",
  a: MeasuredNode,
  b: MeasuredNode,
  overlap: OverlapMetrics,
  relationship: string,
  slideDom?: DomNode,
): void {
  const constrainedBy = slideDom ? findCollisionConstrainingAncestor(slideDom, a, b, overlap) : undefined;
  pushDiagnostic({
    severity: code === "STRUCTURAL_OVERLAP" ? "error" : code === "DECORATIVE_OVERLAP" ? "info" : "warn",
    code,
    slideId,
    nodeId: a.id,
    message: code === "STRUCTURAL_OVERLAP"
      ? `Sibling containers '${a.id}' and '${b.id}' overlap.`
      : code === "DECORATIVE_OVERLAP"
        ? `Decorative node '${a.id}' overlaps '${b.id}'.`
        : code === "OVERLAY_OCCLUDES_FLOW"
          ? `Overlay '${a.id}' covers flow content '${b.id}'.`
      : `Node '${a.id}' overlaps '${b.id}'.`,
    suggestion: code === "STRUCTURAL_OVERLAP"
      ? "Keep the same components but put these regions in one stack/grid/split with explicit gap, adjust row/column spans, or relax fixed sizes so sibling containers get separate slots."
      : code === "DECORATIVE_OVERLAP"
        ? "No repair is required unless the decoration obscures important content; if it does, move it behind or reduce its size/opacity."
        : code === "OVERLAY_OCCLUDES_FLOW"
          ? "Keep the same overlay intent, but move/resize it so it points at or annotates content without covering readable text, chart, table, or card evidence."
      : "Increase parent gap, give one item more width/height, split dense content, or move a deliberate annotation to a non-occluding anchored position.",
    measured: {
      rect: collisionRect(a) || a.rect,
      other: { ...(collisionRect(b) || b.rect), nodeId: b.id },
      overlap: overlap.rect,
      overlapAreaCm2: overlap.areaCm2,
      overlapRatio: overlap.ratioOfSmaller,
      relationship,
      parentId: a.parentId,
    },
    ...(constrainedBy ? { constrainedBy } : {}),
  });
}

function collisionRect(node: MeasuredNode): Rect | undefined {
  const rect = node.visualRect || node.inkRect || node.rect;
  if (!rect || rect.w <= 0.01 || rect.h <= 0.01) return undefined;
  return rect;
}

function isUnderAnyRoot(id: string, roots: Set<string>): boolean {
  for (const root of roots) {
    if (id === root || id.startsWith(`${root}.`)) return true;
  }
  return false;
}

function isDecorativeMeasuredNode(node: MeasuredNode): boolean {
  const id = node.id.toLowerCase();
  return id.includes(".decor")
    || id.includes("decoration")
    || id.includes("watermark")
    || id.includes("ornament")
    || id.includes("brand-mark")
    || node.visualRole === "decoration";
}

function collectOverlayIds(slideDom: DomNode): Set<string> {
  const ids = new Set<string>();
  for (const child of slideDom.children || []) if (isOverlayChild(child)) ids.add(child.id);
  return ids;
}

/**
 * Collect ids of nodes with `layer:"behind"` or `"above"` anywhere in
 * the slide tree. Layered children intentionally overlap their flow
 * siblings (that's the whole point), so the collision detector skips
 * them — without this, a `behind` image filling a card's content rect
 * would trigger COLLISION against every flow sibling inside the card.
 */
function collectLayeredIds(root: DomNode): Set<string> {
  const ids = new Set<string>();
  const walk = (n: DomNode) => {
    if (!n || typeof n !== "object") return;
    if (n.layer === "behind" || n.layer === "above") ids.add(n.id);
    for (const c of (n.children || [])) walk(c);
  };
  walk(root);
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
  for (const node of measured) {
    if (isMeasuredCaption(node)) ids.add(node.id);
  }
  return ids;
}

function isMeasuredCaption(node: MeasuredNode): boolean {
  return node.relation === "caption-of" || (typeof node.id === "string" && node.id.endsWith(".caption"));
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

function findNodePathById(root: DomNode, id: string, path: DomNode[] = []): DomNode[] | undefined {
  const nextPath = [...path, root];
  if (root.id === id) return nextPath;
  for (const child of root.children || []) {
    const found = findNodePathById(child, id, nextPath);
    if (found) return found;
  }
  return undefined;
}

function findCollisionConstrainingAncestor(
  slideDom: DomNode,
  a: MeasuredNode,
  b: MeasuredNode,
  overlap: OverlapMetrics,
): FallbackConstraint | undefined {
  const direction: "horizontal" | "vertical" = overlap.rect.h >= overlap.rect.w ? "vertical" : "horizontal";
  const axisProps = direction === "vertical"
    ? (["fixedHeight", "minHeight", "height", "maxHeight"] as const)
    : (["fixedWidth", "minWidth", "width", "maxWidth"] as const);
  const isMeaningfulConstraint = (value: number) => value >= 0.8;
  const paths = [findNodePathById(slideDom, a.id), findNodePathById(slideDom, b.id)].filter((item): item is DomNode[] => Boolean(item));
  for (const path of paths) {
    for (let i = path.length - 1; i >= 0; i--) {
      const node = path[i]!;
      for (const prop of axisProps) {
        const value = (node as Record<string, unknown>)[prop];
        if (typeof value === "number" && Number.isFinite(value) && isMeaningfulConstraint(value)) {
          return { ancestorId: typeof node.id === "string" ? node.id : "?", prop, value };
        }
      }
    }
  }
  return undefined;
}

function materializeAndCompactify(slideDom: DomNode, slideId: string): DomNode {
  const materialized = materializeNode(slideDom, slideId);
  const compactedChildren = (materialized.children || [])
    .flatMap((child) => child.type === "fragment" ? (child.children || []) : [child])
    .map(compactifyNode)
    .filter((c): c is DomNode => c !== null);
  return { ...materialized, children: compactedChildren };
}

interface LayoutResult {
  measured: MeasuredNode[];
  rectsById: Map<string, Rect>;
}

let currentSlideId = "";
/**
 * Stack of ancestor nodes maintained by the layout walk. Each layout
 * recursion pushes the current node before descending and pops it after, so
 * fallback diagnostics can walk back up the chain to find the constraint that
 * forced the failure (typically a fixedHeight on a panel/card/grid cell).
 */
const ancestorStack: DomNode[] = [];

function withAncestor<T>(node: DomNode, fn: () => T): T {
  ancestorStack.push(node);
  try {
    return fn();
  } finally {
    ancestorStack.pop();
  }
}

/**
 * Process-flow / similar role-tagged horizontal flows produce SQUASHED step
 * cards when an LLM drops them into a narrow column. We detect the pinch at
 * layout time and flip the local stack to a vertical orientation, keeping
 * the children otherwise intact. This is a layout decision, NOT a DOM
 * mutation: we return a shallow clone so the original tree (and any external
 * references) are unchanged.
 *
 * Same logic kicks in for `role:"timeline"`:
 *   - vertical timeline allotted height < (steps × min step height) → flip
 *     to a horizontal grid layout instead of stacking N tall cards.
 *   - horizontal timeline allotted width < (steps × min step width) → flip
 *     back to vertical (the symmetric case for narrow content cells).
 */
function autoOrientFlow(node: DomNode, rect: { w: number; h: number }): DomNode {
  if (node.role === "process-flow") return autoOrientProcessFlow(node, rect);
  if (node.role === "timeline") return autoOrientTimeline(node, rect);
  return node;
}

function autoOrientProcessFlow(node: DomNode, rect: { w: number; h: number }): DomNode {
  if (node.direction !== "horizontal") return node;
  const steps = (node.children || []).filter((child) => child.role === "process-step");
  const stepCount = steps.length;
  if (stepCount < 2) return node;
  const minPerStep = 2.6;
  const cardFlow = steps.some((step) => step.fill !== undefined || step.line !== undefined);
  const longBodyPressure = stepCount >= 4 && rect.h / stepCount >= 1.45 && steps.some((step) => {
    const body = (step.children || []).find((child) => child.id.endsWith(".body"));
    const text = typeof body?.text === "string" ? body.text : "";
    const hardLines = text.split(/\r?\n/).filter((line) => line.trim()).length;
    return text.length > 34 || hardLines > 1;
  });
  if (cardFlow && longBodyPressure) {
    const columns = 2;
    const rows = Math.ceil(stepCount / columns);
    if (rect.w / columns >= 5.2 && rect.h / rows >= 2.75) {
      return {
        ...node,
        type: "grid" as const,
        direction: undefined as never,
        columns,
        gap: stepCount >= 5 ? 0.24 : 0.32,
        children: steps,
      };
    }
  }
  if (rect.w / stepCount >= minPerStep && !longBodyPressure) return node;
  const swappedChildren = (node.children || []).map((child) => {
    if (child.role === "process-connector") {
      if (child.connector === "line") {
        return { ...child, fixedWidth: 0.05, fixedHeight: 0.46 };
      }
      return { ...child, preset: "arrow-down" as const, fixedWidth: 0.6, fixedHeight: 0.42 };
    }
    if (child.type === "shape" && (child.preset === "arrow-right" || child.preset === "arrow-down")) {
      return { ...child, preset: "arrow-down" as const, fixedWidth: 0.6, fixedHeight: 0.42 };
    }
    return child;
  });
  return { ...node, direction: "vertical" as const, children: swappedChildren };
}

function autoOrientTimeline(node: DomNode, rect: { w: number; h: number }): DomNode {
  const children = node.children || [];
  if (children.length < 2) return node;
  const allDirectChildrenAreSteps = children.every((child) => child.role === "timeline-step");
  // Vertical timeline that has less than ~1.4 cm per step needs to become a
  // horizontal grid: stacking N tall cards is impossible in such tight slots.
  if (node.type === "stack" && node.direction === "vertical" && allDirectChildrenAreSteps) {
    const minPerStep = 1.4;
    if (rect.h / children.length < minPerStep && rect.w / children.length >= 2.6) {
      // Re-pack as horizontal grid; children stay the same.
      return {
        ...node,
        type: "grid" as const,
        columns: Math.min(children.length, 6),
        direction: undefined as never,
        gap: children.length >= 5 ? 0.24 : 0.32,
      };
    }
  }
  // Horizontal timeline that has less than 2.6 cm per step → flip to vertical
  // stack so the items have at least one column to fall down.
  if (node.type === "grid") {
    const cols = typeof node.columns === "number" ? node.columns : children.length;
    if (cols >= 2 && rect.w / cols < 2.6 && rect.h / cols >= 1.4) {
      return {
        ...node,
        type: "stack" as const,
        direction: "vertical" as const,
        columns: undefined as never,
        gap: 0.18,
      };
    }
  }
  return node;
}

interface FallbackConstraint {
  ancestorId: string;
  prop: "fixedHeight" | "fixedWidth" | "height" | "width" | "minHeight" | "minWidth" | "maxHeight" | "maxWidth";
  value: number;
}

function findConstrainingAncestor(direction: "horizontal" | "vertical", failingChild?: DomNode): FallbackConstraint | undefined {
  // Walk newest → oldest. The most recent fixedHeight/fixedWidth on the axis
  // that mattered is the one the agent should release.
  // direction === "vertical" means the stack lays children top-to-bottom; the
  // constraint they ran out of is on the height axis. Likewise, horizontal
  // stacks bottom out on width.
  const propsForVertical = ["fixedHeight", "minHeight", "height", "maxHeight"] as const;
  const propsForHorizontal = ["fixedWidth", "minWidth", "width", "maxWidth"] as const;
  const axisProps = direction === "vertical" ? propsForVertical : propsForHorizontal;
  // 761q1u: walk past trivial decorative fixedHeights. These are
  // accent rules / dividers / chip ornaments — they're visually small and
  // never the actual bottleneck. Reporting them as the constraint sends
  // agents on a wild goose chase ("relax eyebrow.fixedHeight = 0.46cm" —
  // doing so frees less than half a line when the real issue is page density).
  const isMeaningfulConstraint = (value: number) => value >= 0.8;
  for (let i = ancestorStack.length - 1; i >= 0; i--) {
    const node = ancestorStack[i]!;
    for (const prop of axisProps) {
      const value = (node as Record<string, unknown>)[prop];
      if (typeof value === "number" && Number.isFinite(value) && isMeaningfulConstraint(value)) {
        return { ancestorId: typeof node.id === "string" ? node.id : "?", prop, value };
      }
    }
  }
  // No fixedHeight ancestor: scan the failing node's siblings (children of
  // the immediate parent) for the largest fixedHeight contributor. This
  // surfaces e.g. "the image-card sibling has fixedHeight:2.8 and that's
  // what's eating your slot" — a recurring inmuai-log pinch where timeline
  // and image-card competed for one ~10cm content area.
  //
  // 761q1u fix: prior code did `ancestorStack[length - 1]` then walked
  // `parent.children` — but the ancestor stack TOP is the failing node
  // itself (just pushed by withAncestor), so we ended up scanning the
  // failing node's own decorative children (e.g. sm.kt.accent inside
  // sm.kt) and reporting them as the constraint. The grandparent is at
  // length - 2.
  if (!failingChild) return undefined;
  const grandparent = ancestorStack[ancestorStack.length - 2];
  const siblings = (grandparent && Array.isArray(grandparent.children)) ? grandparent.children : undefined;
  if (!siblings || siblings.length < 2) return undefined;
  let biggest: { id: string; prop: typeof axisProps[number]; value: number } | null = null;
  for (const sibling of siblings) {
    if (sibling === failingChild) continue;
    for (const prop of axisProps) {
      const value = (sibling as Record<string, unknown>)[prop];
      if (typeof value === "number" && Number.isFinite(value) && isMeaningfulConstraint(value)) {
        if (!biggest || value > biggest.value) {
          biggest = { id: typeof sibling.id === "string" ? sibling.id : "?", prop, value };
        }
      }
    }
  }
  if (biggest) return { ancestorId: biggest.id, prop: biggest.prop, value: biggest.value };
  return undefined;
}

function layoutSlide(theme: SimpleTheme, slideDom: DomNode): LayoutResult {
  const measured: MeasuredNode[] = [];
  const rectsById = new Map<string, Rect>();
  const slideRect = fullRect(theme);
  measured.push({ id: slideDom.id, type: slideDom.type, rect: slideRect });
  rectsById.set(slideDom.id, slideRect);
  // Derive slideId from the root node (e.g. "cover.root" -> "cover")
  const previous = currentSlideId;
  currentSlideId = slideDom.id.replace(/\.root$/, "") || slideDom.id;
  ancestorStack.length = 0;
  try {
    // Pass 1: lay out flow + slide-anchor overlays. anchorTo overlays
    // are deferred so their target rects exist in rectsById first.
    const allChildren = slideDom.children || [];
    const deferred: DomNode[] = [];
    for (const child of allChildren) {
      if (isAnchorToOverlay(child)) {
        deferred.push(child);
        continue;
      }
      const childRect = rectForSlideChild(theme, child, slideDom);
      measureSubtree(theme, child, childRect, measured, rectsById);
    }
    // Pass 2: anchorTo overlays — reference frame is the target's rect.
    for (const child of deferred) {
      const childRect = rectForAnchorToOverlay(child, rectsById);
      if (!childRect) continue; // target not found; skip rather than crash.
      measureSubtree(theme, child, childRect, measured, rectsById);
    }
  } finally {
    currentSlideId = previous;
    ancestorStack.length = 0;
  }
  return { measured, rectsById };
}

/**
 * Resolve an `anchorTo` overlay's rect against its target's rect.
 * Returns null when the target id isn't found — caller skips emission.
 *
 * Honors the same anchor / offsetX / offsetY / width / height fields as
 * a slide-anchored overlay, but the reference frame is the target rect
 * rather than the slide canvas.
 */
function rectForAnchorToOverlay(node: DomNode, rectsById: Map<string, Rect>): Rect | null {
  const targetId = typeof node.anchorTo === "string" ? node.anchorTo : "";
  if (!targetId) return null;
  const target = rectsById.get(targetId);
  if (!target) return null;
  const anchor = (typeof node.anchor === "string" && ANCHOR_POINTS.has(node.anchor) ? node.anchor : "top-right") as AnchorPoint;
  const ox = numberProp(node, "offsetX", 0);
  const oy = numberProp(node, "offsetY", 0);
  const w = numberProp(node, "width", node.type === "image" ? 4 : 3);
  const h = numberProp(node, "height", node.type === "image" ? 3 : 1.2);
  let x = 0;
  let y = 0;
  if (anchor.endsWith("-left")) x = target.x + ox;
  else if (anchor.endsWith("-center")) x = target.x + (target.w - w) / 2 + ox;
  else x = target.x + target.w - w - ox;
  if (anchor.startsWith("top-")) y = target.y + oy;
  else if (anchor.startsWith("middle-")) y = target.y + (target.h - h) / 2 + oy;
  else y = target.y + target.h - h - oy;
  return { x, y, w, h };
}

function isOverlayChild(node: DomNode): boolean {
  if (typeof node.anchor === "string" && ANCHOR_POINTS.has(node.anchor)) return true;
  if (typeof node.anchorTo === "string" && node.anchorTo.length > 0) return true;
  if (isAbsoluteAt(node.at)) return true;
  if (node.layer === "behind" || node.layer === "above") return true;
  return false;
}

function isAnchorToOverlay(node: DomNode): boolean {
  return typeof node.anchorTo === "string" && node.anchorTo.length > 0;
}

/**
 * `at: [x, y, w, h]` — slide-relative absolute coordinates in cm. The
 * agent-facing primitive for editorial / custom layouts that don't fit
 * the flow + component model. Honored at slide-level only (direct child
 * of slide root); inside a stack/grid use `layer:"behind"|"above"`
 * instead. See node-types.ts ANCHOR_FIELDS for the full schema entry.
 */
function isAbsoluteAt(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value)
    && value.length === 4
    && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

function flowChildren(slideDom: DomNode): DomNode[] {
  return (slideDom.children || []).filter((child) => !isOverlayChild(child));
}

function overlayChildren(slideDom: DomNode): DomNode[] {
  return (slideDom.children || []).filter(isOverlayChild);
}

function measureSubtree(theme: SimpleTheme, node: DomNode, rect: Rect, output: MeasuredNode[], rectsById: Map<string, Rect>, parentId?: string): void {
  const caption = captionText(node);
  if (caption && (node.type === "image" || node.type === "table" || node.type === "chart")) {
    const { bodyRect, captionRect } = captionLayout(node, rect);
    output.push(measuredNode(theme, node, bodyRect, parentId));
    output.push({ ...measuredNode(theme, { ...node, id: `${node.id}.caption`, type: "text", text: caption }, captionRect, parentId), relation: "caption-of", relatedTo: node.id });
    rectsById.set(node.id, bodyRect);
    rectsById.set(`${node.id}.caption`, captionRect);
    return;
  }
  output.push(measuredNode(theme, node, rect, parentId));
  rectsById.set(node.id, rect);
  if (node.type === "stack") {
    const oriented = autoOrientFlow(node, rect);
    if (oriented.type === "grid") {
      // Auto-orient flipped a vertical-stack timeline to a horizontal grid.
      withAncestor(oriented, () => {
        layoutGridChildren(theme, oriented, contentRect(theme, oriented, rect)).forEach(({ node: child, rect: childRect }) => measureSubtree(theme, child, childRect, output, rectsById, oriented.id));
      });
      return;
    }
    withAncestor(oriented, () => {
      layoutStackChildren(theme, oriented, contentRect(theme, oriented, rect)).forEach(({ node: child, rect: childRect }) => measureSubtree(theme, child, childRect, output, rectsById, oriented.id));
    });
    return;
  }
  if (node.type === "grid") {
    const oriented = autoOrientFlow(node, rect);
    if (oriented.type === "stack") {
      withAncestor(oriented, () => {
        layoutStackChildren(theme, oriented, contentRect(theme, oriented, rect)).forEach(({ node: child, rect: childRect }) => measureSubtree(theme, child, childRect, output, rectsById, oriented.id));
      });
      return;
    }
    withAncestor(oriented, () => {
      layoutGridChildren(theme, oriented, contentRect(theme, oriented, rect)).forEach(({ node: child, rect: childRect }) => measureSubtree(theme, child, childRect, output, rectsById, oriented.id));
    });
    return;
  }
  if (node.type === "panel" || node.type === "card" || node.type === "band" || node.type === "frame" || node.type === "inset") {
    const inner = decorativeInnerRect(theme, node, rect);
    const child = decorativeChild(node);
    if (child) withAncestor(node, () => measureSubtree(theme, child, inner, output, rectsById, node.id));
  }
}

function measuredNode(theme: SimpleTheme, node: DomNode, rect: Rect, parentId?: string): MeasuredNode {
  const inkRect = estimateInkRect(theme, node, rect);
  const relation = inferredVisualRelation(node);
  return {
    id: node.id,
    type: node.type,
    rect,
    parentId,
    inkRect,
    visualRect: estimateVisualRect(theme, node, rect, inkRect),
    visualRole: measuredVisualRole(node),
    ...(relation ? { relation, relatedTo: parentId } : {}),
    alpha: measuredAlpha(node),
  };
}

function estimateInkRect(theme: SimpleTheme, node: DomNode, rect: Rect): Rect | undefined {
  if (rect.w <= 0 || rect.h <= 0) return undefined;
  if (node.type === "text") {
    const baseStyle = effectiveTextStyle(theme, node, "paragraph");
    const style = measuredTextStyleForInk(theme, node, rect, baseStyle);
    const neededH = textVisibleInkHeight(theme, node, rect.w, style);
    const neededW = estimatedTextInkWidth(theme, node, rect, style, neededH);
    return placeInkRect(node, rect, { w: neededW, h: neededH });
  }
  if (node.type === "bullets") {
    const neededH = bulletsIntrinsicHeight(theme, node, rect.w);
    return placeInkRect({ ...node, align: "left", valign: "top" }, rect, { w: rect.w, h: neededH });
  }
  if (node.type === "shape") {
    const preset = typeof node.preset === "string" ? node.preset : "";
    if (preset === "line") {
      const thickness = normalizeStrokeCm(node.thickness, 0.025, { minCm: 0.01, maxCm: 0.18 }) + 0.04;
      return rect.w >= rect.h
        ? { x: rect.x, y: rect.y + Math.max(0, (rect.h - thickness) / 2), w: rect.w, h: Math.min(rect.h, thickness) }
        : { x: rect.x + Math.max(0, (rect.w - thickness) / 2), y: rect.y, w: Math.min(rect.w, thickness), h: rect.h };
    }
    if (preset === "ellipse") return insetRect(rect, 0.08, 0.08);
    if (preset === "diamond" || preset === "triangle" || preset === "rightTriangle") return insetRect(rect, 0.14, 0.12);
  }
  if (node.type === "divider") {
    const thickness = normalizeStrokeCm(node.thickness, 0.025, { minCm: 0.01, maxCm: 0.18 }) + 0.04;
    return rect.w >= rect.h
      ? { x: rect.x, y: rect.y + Math.max(0, (rect.h - thickness) / 2), w: rect.w, h: Math.min(rect.h, thickness) }
      : { x: rect.x + Math.max(0, (rect.w - thickness) / 2), y: rect.y, w: Math.min(rect.w, thickness), h: rect.h };
  }
  return rect;
}

function estimateVisualRect(theme: SimpleTheme, node: DomNode, rect: Rect, inkRect?: Rect): Rect | undefined {
  if (node.type === "text") return hasPaintedTextSurface(node) ? rect : inkRect;
  if (node.type === "bullets") return inkRect;
  if (node.type === "spacer") return undefined;
  if (node.type === "stack" || node.type === "grid" || node.type === "fragment") return paintedContainerRect(theme, node, rect);
  if (node.type === "panel" || node.type === "card" || node.type === "band" || node.type === "frame" || node.type === "inset") return paintedContainerRect(theme, node, rect);
  return inkRect || rect;
}

function inferredVisualRelation(node: DomNode): MeasuredNode["relation"] | undefined {
  if (typeof node.id === "string" && /(?:^|\.)(mark|marker)$/.test(node.id)) return "marker-of";
  return undefined;
}

function hasPaintedTextSurface(node: DomNode): boolean {
  return typeof node.fill === "string"
    || typeof node.line === "string"
    || hasSurfaceGradient(node)
    || typeof node.cornerRadius === "number";
}

function measuredTextStyleForInk(theme: SimpleTheme, node: DomNode, rect: Rect, baseStyle: ReturnType<typeof textStyle>): ReturnType<typeof textStyle> {
  const styleKey = textStyleKey(node);
  const effectiveAutoFit = node.autoFit ?? defaultAutoFitForStyle(styleKey);
  return effectiveAutoFit === "shrink"
    ? autoShrinkStyle(theme, node, baseStyle, rect, styleKey, { emitDiagnostics: false })
    : baseStyle;
}

function paintedContainerRect(theme: SimpleTheme, node: DomNode, rect: Rect): Rect | undefined {
  const style = componentStyle(theme, node);
  const surface = surfaceNode(node, style);
  const hasFill = typeof surface.fill === "string" || hasSurfaceGradient(surface);
  const hasLine = typeof surface.line === "string";
  if (!hasFill && !hasLine) return undefined;
  return rect;
}

function estimatedTextInkWidth(theme: SimpleTheme, node: DomNode, rect: Rect, style: ReturnType<typeof textStyle>, _neededH: number): number {
  const paragraphs = textParagraphsForEstimate(theme, node, style);
  if (paragraphs.length === 0 || !paragraphs.some((para) => para.text.trim())) return Math.min(rect.w, 0.1);
  const reserve = textHorizontalReserveCm(node);
  const contentWidth = Math.max(0.25, rect.w - reserve);
  let maxLine = 0;
  for (const para of paragraphs) {
    for (const line of String(para.text || "").split(/\r?\n/)) {
      maxLine = Math.max(maxLine, estimatedTextWidthCm(theme, line, para.fontSize, para.bold));
    }
  }
  const wraps = maxLine > contentWidth;
  return wraps ? rect.w : Math.min(rect.w, Math.max(0.1, maxLine + reserve));
}

function placeInkRect(node: DomNode, slot: Rect, size: { w: number; h: number }): Rect {
  const w = Math.min(slot.w, Math.max(0, size.w));
  const h = Math.max(0, size.h);
  const align = alignProp(node);
  const valign = valignProp(node, textStyleKey(node));
  const x = align === "center" ? slot.x + (slot.w - w) / 2 : align === "right" ? slot.x + slot.w - w : slot.x;
  const y = valign === "middle" ? slot.y + (slot.h - h) / 2 : valign === "bottom" ? slot.y + slot.h - h : slot.y;
  return { x, y, w, h };
}

function insetRect(rect: Rect, xRatio: number, yRatio: number): Rect {
  const dx = Math.min(rect.w * xRatio, rect.w / 2);
  const dy = Math.min(rect.h * yRatio, rect.h / 2);
  return { x: rect.x + dx, y: rect.y + dy, w: Math.max(0, rect.w - dx * 2), h: Math.max(0, rect.h - dy * 2) };
}

function measuredVisualRole(node: DomNode): string {
  if (node.type === "text" || node.type === "bullets") return "text";
  if (node.type === "table") return "table-body";
  if (node.type === "chart") return "chart-body";
  if (node.type === "image") return "image";
  if (node.type === "shape" || node.type === "divider") return "shape";
  if (node.children && node.children.length > 0) return "container";
  return node.type;
}

function measuredAlpha(node: DomNode): number | undefined {
  const raw = node.opacity ?? node.fillOpacity;
  return alphaProp(raw);
}

function decorativeInnerRect(theme: SimpleTheme, node: DomNode, rect: Rect): Rect {
  const padding = decorativePadding(theme, node, rect);
  let inner: Rect = { x: rect.x + padding, y: rect.y + padding, w: Math.max(0, rect.w - padding * 2), h: Math.max(0, rect.h - padding * 2) };
  if (node.type === "card") {
    const accent = node.accent === "left" || node.accent === "top" ? node.accent : "none";
    if (accent === "left") inner = { x: inner.x + 0.12, y: inner.y, w: Math.max(0, inner.w - 0.12), h: inner.h };
    else if (accent === "top") inner = { x: inner.x, y: inner.y + 0.12, w: inner.w, h: Math.max(0, inner.h - 0.12) };
    const headerText = cardHeader(node)?.text || "";
    const footerText = typeof node.footer === "string" && node.footer.trim() ? node.footer.trim() : "";
    const headerHeight = headerText ? 0.7 + 0.15 : 0;
    const footerHeight = footerText ? 0.5 + 0.15 : 0;
    inner = { x: inner.x, y: inner.y + headerHeight, w: inner.w, h: Math.max(0, inner.h - headerHeight - footerHeight) };
  }
  return inner;
}

function directSlideTitleNode(slideDom: DomNode): DomNode | null {
  for (const child of slideDom.children || []) {
    if (child.type === "text" && textStyleKey(child) === "slide-title" && !isOverlayChild(child)) return child;
  }
  return null;
}

function protectedContentRect(theme: SimpleTheme, slideDom: DomNode): Rect {
  const title = directSlideTitleNode(slideDom);
  const minTop = title
    ? theme.layout.titleTop + theme.layout.titleHeight + 0.25
    : theme.layout.contentTop;
  const y = Math.max(theme.layout.contentTop, minTop);
  const footerChrome = theme.chrome.pageNumber || Boolean(theme.chrome.footerText);
  const footerTop = theme.layout.slideHeightCm - (theme.chrome.footerHeight + 0.2);
  const bottom = footerChrome ? Math.min(theme.layout.contentBottom, footerTop) : theme.layout.contentBottom;
  return {
    x: theme.layout.pageMarginX,
    y,
    w: theme.layout.slideWidthCm - theme.layout.pageMarginX * 2,
    h: Math.max(0.2, bottom - y),
  };
}

function rectForSlideChild(theme: SimpleTheme, node: DomNode, slideDom?: DomNode): Rect {
  if (node.type === "text" && textStyleKey(node) === "slide-title" && !isOverlayChild(node)) {
    const titleRect = { x: theme.layout.pageMarginX, y: theme.layout.titleTop, w: theme.layout.slideWidthCm - theme.layout.pageMarginX * 2, h: theme.layout.titleHeight };
    const intrinsic = textIntrinsicHeight(theme, node, titleRect.w);
    // Allow a generous slack: the intrinsic estimate includes padding for box
    // chrome that the slide-title rect already accounts for. Only flag titles
    // that would clearly take 2 lines (height grows by a full line).
    const lineHeight = textStyle(theme, "slide-title", "paragraph").fontSize * 0.0353;
    // Suppress OVERFLOW when the title carries autoFit:"shrink" — the
    // renderer pre-shrinks the title's font size in textShape to fit the
    // rect, so a long title is no longer broken visually. Without this gate
    // the diagnostic was a false alarm whenever sourceSlideToRendered
    // installed the auto-fit hint on slide.title.
    if (intrinsic > titleRect.h + lineHeight * 0.6 && node.autoFit !== "shrink") {
      pushDiagnostic({
        severity: "warn",
        code: "OVERFLOW",
        slideId: currentSlideId || undefined,
        nodeId: node.id,
        message: `Slide title is taller than the title rect (${intrinsic.toFixed(2)}cm vs ${titleRect.h.toFixed(2)}cm).`,
        suggestion: "Shorten the title (≤ 18 CJK chars / 60 latin chars) or split into two slides; the renderer will autoFit shrink as a fallback.",
        measured: { available: titleRect.h, needed: intrinsic, deltaCm: intrinsic - titleRect.h },
      });
    }
    return titleRect;
  }
  if (typeof node.anchor === "string" && ANCHOR_POINTS.has(node.anchor)) {
    return rectFromAnchor(theme, node);
  }
  if (isAbsoluteAt(node.at)) {
    // Slide-relative absolute coordinates: agent supplies [x, y, w, h]
    // in cm against the slide canvas origin. Clamp w/h to just above
    // the renderer's TINY_RECT threshold (0.02cm for shapes / 0.18cm
    // for content) so an accidental zero doesn't get the node dropped.
    const [x, y, w, h] = node.at;
    return { x, y, w: Math.max(0.03, w), h: Math.max(0.03, h) };
  }
  const areaName = stringProp(node, "area", "");
  if (areaName === "content") {
    return slideDom
      ? protectedContentRect(theme, slideDom)
      : { x: theme.layout.pageMarginX, y: theme.layout.contentTop, w: theme.layout.slideWidthCm - theme.layout.pageMarginX * 2, h: theme.layout.contentBottom - theme.layout.contentTop };
  }
  if (areaName === "full" || areaName === "") return fullRect(theme);
  const namedArea = theme.layout.areas[areaName];
  if (namedArea) return rectFromThemeArea(namedArea);
  return fullRect(theme);
}

function rectFromThemeArea(area: SimpleTheme["layout"]["areas"][string]): Rect {
  if ("x" in area) {
    return { x: area.x, y: area.y, w: Math.max(0.03, area.w), h: Math.max(0.03, area.h) };
  }
  return {
    x: area.left,
    y: area.top,
    w: Math.max(0.03, area.right - area.left),
    h: Math.max(0.03, area.bottom - area.top),
  };
}

function rectFromAnchor(theme: SimpleTheme, node: DomNode): Rect {
  const anchor = node.anchor as AnchorPoint;
  const slideW = theme.layout.slideWidthCm;
  const slideH = theme.layout.slideHeightCm;
  const ox = numberProp(node, "offsetX", 0);
  const oy = numberProp(node, "offsetY", 0);
  // `fillSlide:true` is a sentinel for slide-spanning overlays
  // (decoration-grid as background, watermarks). Lets the overlay
  // expand to the actual canvas without hardcoding 16:9 dims at the
  // component level — works for 4:3 / wide decks too.
  const fillSlide = node.fillSlide === true;
  const w = fillSlide ? Math.max(0.1, slideW - ox * 2) : numberProp(node, "width", node.type === "image" ? 4 : 3);
  const h = fillSlide ? Math.max(0.1, slideH - oy * 2) : numberProp(node, "height", node.type === "image" ? 3 : 1.2);
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
  detectCollisionsForSlide(slideId, layout.measured, slideDom);
  const previous = currentSlideId;
  currentSlideId = slideId;
  try {
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
      if (child.layer === "behind" || (child.layer !== "above" && z < 0)) below.push(...shapes);
      else above.push(...shapes);
    }
    return [...below, ...flowShapes, ...above];
  } finally {
    currentSlideId = previous;
  }
}

function renderNode(theme: SimpleTheme, node: DomNode, rect: Rect, rectsById: Map<string, Rect>, ids: { nextId: number }, slideId: string): ShapeList {
  pushSquashedDiagnostic(theme, node, rect, slideId);
  if (node.type === "stack") return renderStack(theme, node, rect, rectsById, ids, slideId);
  if (node.type === "grid") return renderGrid(theme, node, rect, rectsById, ids, slideId);
  if (node.type === "fragment") return (node.children || []).flatMap((child) => {
    const childRect = rectsById.get(child.id) || rect;
    return renderNode(theme, child, childRect, rectsById, ids, slideId);
  });
  if (node.type === "spacer") return [];
  // Dividers and spacers are intentionally thin/empty along one axis; only
  // gate on tiny rect for nodes that need a meaningful 2D area.
  // umzrkm + 761q1u fix: a `band` or `frame` with no children and a small
  // fixedHeight is the agent's way of drawing a thin colored divider line
  // (`{type:"band", tone:"brand", fixedHeight:0.05}` or
  // `{type:"frame", line:"FFFFFF", fixedHeight:0.08}`). Treat like a
  // shape for tinyThreshold so it isn't TINY_RECT-dropped.
  const isDividerLikeBand = (node.type === "band" || node.type === "frame")
    && (!Array.isArray(node.children) || node.children.length === 0)
    && typeof node.fixedHeight === "number" && node.fixedHeight < 0.6;
  const tinyThreshold = node.type === "divider" || node.type === "spacer" || node.type === "shape" || isDividerLikeBand ? 0.02 : 0.18;
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
  if (node.role === "timeline-spine") return;
  const meaningfulContainer = node.type === "stack" || node.type === "grid" || node.type === "panel" || node.type === "card" || node.type === "band" || node.type === "frame" || node.type === "inset";
  if (meaningfulContainer) return;
  const key = `${slideId}/${node.id}`;
  if (squashedWarnings.has(key)) return;
  // Explicit image sizing is an authoring choice: icons and corner ornaments
  // are often deliberately below the generic content minimum. Flow-assigned
  // images without an explicit size can still be flagged when squeezed.
  const hasFixedWidth = typeof node.fixedWidth === "number" && Number.isFinite(node.fixedWidth);
  const hasFixedHeight = typeof node.fixedHeight === "number" && Number.isFinite(node.fixedHeight);
  const hasAbsoluteRect = Array.isArray(node.at)
    && node.at.length === 4
    && node.at.every((value: unknown) => typeof value === "number" && Number.isFinite(value));
  const hasAnchoredSize = (typeof node.anchor === "string" || typeof node.anchorTo === "string")
    && ((typeof node.width === "number" && Number.isFinite(node.width)) || (typeof node.height === "number" && Number.isFinite(node.height)));
  if (node.type === "image" && (hasFixedWidth || hasFixedHeight || hasAbsoluteRect || hasAnchoredSize)) return;
  const minHeight = node.type === "text" ? textSquashMinHeight(theme, node) : node.type === "bullets" ? 1.0 : 0.5;
  const shortContent = (node.type === "text" || node.type === "bullets") && rect.h < minHeight;
  const narrowContent = node.type === "bullets" && rect.w < 1.4;
  if (!shortContent && !narrowContent) return;
  squashedWarnings.add(key);
  pushDiagnostic({
    severity: "error",
    code: "SQUASHED",
    slideId,
    nodeId: node.id,
    message: `Node '${node.id}' was assigned a compressed rect ${rect.w.toFixed(2)}x${rect.h.toFixed(2)}cm; it may technically render but is not visually usable.`,
    suggestion: capacitySuggestion(node, "Re-author the slide while preserving the current component's semantics: increase its region, adjust split/grid ratio, reduce sibling content, lower columns, or move supporting content to another slide. Do not rely on squeezed cards or tiny labels."),
    measured: {
      rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
      minHeightCm: minHeight,
      ...(node.type === "bullets" ? { minWidthCm: 1.4 } : {}),
    },
  });
}

function nearestSemanticRole(node?: DomNode): string | undefined {
  const candidates = [node, ...ancestorStack.slice().reverse()].filter((item): item is DomNode => Boolean(item));
  for (const candidate of candidates) {
    if (typeof candidate.role === "string" && candidate.role.trim()) return candidate.role.trim();
  }
  return undefined;
}

function capacitySuggestion(node: DomNode | undefined, fallback: string): string {
  const role = nearestSemanticRole(node);
  if (role === "chart-card") {
    return "Chart-card is over capacity: reserve a real chart body (bar/line/combo at least about 4.8x3.0cm; pie/doughnut about 5.2x4.4cm before title/caption chrome). Keep the chart as the primary evidence, use split/chart-with-rail/evidence-layout with the chart taking about 60-75% of the evidence area, move KPI/table/commentary to a rail or follow-up slide, and reduce labels/legend/series density before considering another component.";
  }
  if (role === "metric-card" || role === "kpi-grid") {
    return "KPI content is over capacity: keep the KPI/stat semantics, reduce metrics per row, use columns:2 or columns:3, shorten labels/units, use compact density, widen the metric region, or split the dashboard across slides instead of squeezing metric values.";
  }
  if (role === "stat-strip") {
    return "Stat-strip is over capacity: keep the stat row, reduce item count to the strongest metrics, shorten labels, give it full slide width, or split supporting metrics to a second strip/slide.";
  }
  if (role === "table-card") {
    return "Table-card is over capacity: reserve a table body large enough for readable rows (a compact 6-8 row business table usually needs about 4.5-6cm plus title/caption chrome). Keep the table, give it a half/full-slide evidence region, widen text-heavy columns with encoding.columns/colWidths, use density:'compact', provide rowHeights for known tall rows, or paginate the same table across slides instead of deleting data.";
  }
  if (role === "code-block") {
    return "Code-block is over capacity: keep code-block for code, paginate the listing across slides/components, use columns:2/3, density:'tiny', or smaller readable fontSize. Use maxLines only for an intentional excerpt.";
  }
  if (role === "process-flow") {
    return "Process-flow is over capacity: keep the sequence component, reduce per-step body/bullets, use vertical direction for rich stages, increase the component area, or split the flow across slides.";
  }
  if (role === "feature-card") {
    return "Feature-card content is over capacity: use fewer columns, set density:'compact', shorten body/proof/tags, or split feature groups across slides instead of relying on dropped optional content.";
  }
  if (role === "donut-summary") {
    return "Donut-summary is over capacity: reserve about 5x4cm for the ring plus legend. Keep the share-summary semantics, reduce minor slices, move explanatory facts to a side rail/follow-up slide, or give the donut a dominant split region before changing components.";
  }
  if (role === "chart-with-rail" || role === "evidence-layout") {
    return "Evidence layout is over capacity: keep one dominant evidence object and one concise interpretation rail. Increase the evidence ratio/area, shorten the rail, move secondary KPIs/tables to a follow-up slide, or switch layout from stacked to sidecar/rail only when it preserves the evidence-first job.";
  }
  if (role === "image-card") {
    return "Image-card is over capacity: reserve enough inspection area for the image, remove optional caption/chrome first, move explanation to a rail/follow-up slide, or crop intentionally with fit/position rather than squeezing the image.";
  }
  if (role === "equation") {
    return "Equation content is over capacity: reduce formulas per slide, use size:'sm' or a smaller fontSize, remove optional captions/labels, or split equations into multiple slides.";
  }
  if (role === "executive-summary" || role === "key-takeaway" || role === "explanation-block") {
    return "Summary content is over capacity: preserve the summary component, shorten supporting detail, move secondary findings to another slide, or turn the same narrative into a multi-slide sequence instead of forcing all findings into one component.";
  }
  return fallback;
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

function toneTokens(theme: SimpleTheme, tone: unknown): { fill?: string; line?: string; fg?: string; accent?: string } {
  if (tone === undefined || tone === null || tone === "") return {};
  const resolved = toneStyle(theme, tone, "neutral");
  return { fill: resolved.bg, line: resolved.line, fg: resolved.fg, accent: resolved.line };
}

function cardHeader(node: DomNode): { text: string; field: "header" | "title" } | null {
  if (typeof node.header === "string" && node.header.trim()) return { text: node.header.trim(), field: "header" };
  if (typeof node.title === "string" && node.title.trim()) return { text: node.title.trim(), field: "title" };
  return null;
}

function readableTextColorForFill(theme: SimpleTheme, fillToken: string, preferredToken?: string): string {
  const fillHex = color(theme, fillToken, "surface");
  const candidates = [
    preferredToken,
    fillToken === "brand.primary" ? "brand.onPrimary" : undefined,
    "text.inverse",
    "text.primary",
    "000000",
    "FFFFFF",
  ].filter((token): token is string => typeof token === "string" && token.length > 0);
  let best: { token: string; ratio: number } | null = null;
  for (const token of candidates) {
    const hex = color(theme, token, token);
    const ratio = contrastRatio(hex, fillHex);
    if (!best || ratio > best.ratio) best = { token, ratio };
    if (ratio >= 4.5) return token;
  }
  return best?.token || preferredToken || "text.primary";
}

function withDefaultTextColor(node: DomNode, colorToken: string, replaceDefaultTextColors = false): DomNode {
  if (node.type === "text" || node.type === "bullets") {
    const existing = typeof node.color === "string" ? node.color.trim() : "";
    const isDefaultColor = existing === "text.primary" || existing === "text.inverse";
    return existing && (!replaceDefaultTextColors || !isDefaultColor) ? node : { ...node, color: colorToken };
  }
  if (Array.isArray(node.children) && node.children.length > 0) {
    return {
      ...node,
      children: node.children.map((child) => withDefaultTextColor(child, colorToken, replaceDefaultTextColors)),
    };
  }
  return node;
}

/**
 * Elevation → outerShdw parameters in EMU.
 *   - flat:     no shadow, full border (the renderer's prior default)
 *   - raised:   thin border + soft shadow (~3pt offset, ~6pt blur, 25% alpha)
 *   - floating: no border + deeper shadow (~6pt offset, ~14pt blur, 30% alpha)
 *
 * Default `null` means "agent didn't pick" — caller chooses the safe default
 * for its component (cards default to "raised", panels stay "flat").
 */
type ElevationName = "flat" | "raised" | "floating" | "outlined";

function resolveElevation(value: unknown): ElevationName | null {
  if (value === "flat" || value === "raised" || value === "floating" || value === "outlined") return value;
  return null;
}

interface ShadowSpec { color: string; alpha?: number; blur?: number; dx?: number; dy?: number }

function shadowForElevation(theme: SimpleTheme, elevation: ElevationName, accentToken?: string): ShadowSpec | undefined {
  if (elevation === "flat" || elevation === "outlined") return undefined;
  if (elevation === "raised") {
    return {
      color: color(theme, accentToken || "text.primary", "text.primary"),
      alpha: 0.18,
      blur: 76200,    // ~6pt
      dx: 0,
      dy: 38100,      // ~3pt
    };
  }
  // floating
  return {
    color: color(theme, accentToken || "text.primary", "text.primary"),
    alpha: 0.28,
    blur: 177800,     // ~14pt
    dx: 0,
    dy: 76200,        // ~6pt
  };
}

function surfaceNode(node: DomNode, style: object = {}): DomNode {
  return { ...style, ...node } as DomNode;
}

function hasSurfaceGradient(node: DomNode): boolean {
  const raw = node.gradient;
  return Boolean(raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).stops));
}

function surfaceFill(theme: SimpleTheme, node: DomNode, fillToken: string | undefined, fallback: string, alpha?: number): FillSpec {
  const gradient = surfaceGradientFill(theme, node, alpha);
  if (gradient) return gradient;
  return withFillAlpha(resolveFill(theme, fillToken, fallback), alpha);
}

function surfaceGradientFill(theme: SimpleTheme, node: DomNode, inheritedAlpha?: number): FillSpec | undefined {
  const raw = node.gradient;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  const rawStops = rec.stops;
  if (!Array.isArray(rawStops) || rawStops.length < 2) return undefined;
  const stops = rawStops.flatMap((stop, index) => {
    if (!stop || typeof stop !== "object" || Array.isArray(stop)) return [];
    const item = stop as Record<string, unknown>;
    if (typeof item.color !== "string" || !item.color.trim()) return [];
    const autoPosition = rawStops.length === 1 ? 0 : (index / (rawStops.length - 1)) * 100;
    const position = typeof item.position === "number" && Number.isFinite(item.position)
      ? clamp(item.position <= 1 ? item.position * 100 : item.position, 0, 100)
      : autoPosition;
    const alpha = alphaProp(item.alpha ?? inheritedAlpha);
    return [{
      position,
      color: color(theme, item.color),
      ...(alpha !== undefined ? { alpha } : {}),
    }];
  });
  if (stops.length < 2) return undefined;
  const kind = rec.kind === "radial" ? "radial" : "linear";
  const angle = typeof rec.angle === "number" && Number.isFinite(rec.angle) ? rec.angle : undefined;
  return { type: "gradient", kind, ...(angle !== undefined ? { angle } : {}), stops };
}

function withFillAlpha(fill: FillSpec, alpha?: number): FillSpec {
  if (alpha === undefined) return fill;
  if (fill.type === "solid") return { ...fill, alpha };
  if (fill.type === "gradient") return { ...fill, stops: fill.stops.map((stop) => ({ ...stop, alpha: stop.alpha ?? alpha })) };
  return fill;
}

function surfaceShadow(theme: SimpleTheme, node: DomNode, fallback?: ShadowSpec): ShadowSpec | undefined {
  return imageShadowSpec(theme, node) ?? fallback;
}

function surfaceDash(node: DomNode): "dash" | "dashDot" | "dot" | undefined {
  if (node.lineDash === "dash" || node.lineDash === "dashDot" || node.lineDash === "dot") return node.lineDash;
  if (node.dash === "dash" || node.dash === "dashDot" || node.dash === "dot") return node.dash;
  return undefined;
}

function renderPanel(theme: SimpleTheme, node: DomNode, rect: Rect, rectsById: Map<string, Rect>, ids: { nextId: number }, slideId: string): ShapeList {
  const tone = toneTokens(theme, node.tone);
  const style = theme.component.panel || {};
  const surface = surfaceNode(node, style);
  const fillToken = typeof node.fill === "string" ? node.fill : tone.fill || style.fill || "surface";
  const lineToken = typeof node.line === "string" ? node.line : tone.line || style.line || "divider";
  const cornerRadius = optionalCornerRadiusProp(node) ?? style.cornerRadius ?? 0.12;
  // Panels default to "flat" — they're surface containers, not raised
  // cards. Agents who want elevation pass elevation:"raised".
  const elevation = resolveElevation(node.elevation) ?? "flat";
  const shadow = surfaceShadow(theme, surface, shadowForElevation(theme, elevation, tone.accent));
  const padding = optionalNumberProp(node, "padding") ?? style.padding ?? 0.45;
  // Stroke-like fields are normalized separately from layout dimensions:
  // legacy tiny values (0.02cm) remain valid, while agent-authored `1` means
  // 1pt instead of a 1cm block.
  const lineWidth = normalizeStrokeCm(optionalNumberProp(surface, "lineWidth") ?? optionalNumberProp(surface, "borderWidth"), elevation === "outlined" ? 0.04 : 0.02);
  const fillAlpha = alphaProp(surface.fillOpacity);
  const lineAlpha = alphaProp(surface.lineOpacity);
  const dash = surfaceDash(surface);
  const innerRect: Rect = { x: rect.x + padding, y: rect.y + padding, w: Math.max(0, rect.w - padding * 2), h: Math.max(0, rect.h - padding * 2) };
  const shapes: ShapeList = [{
    type: "shape",
    id: ids.nextId++,
    name: `${nodeLabel(node)}-panel`,
    preset: "roundRect",
    xfrm: xfrm(rect),
    fill: surfaceFill(theme, surface, fillToken, "surface", fillAlpha),
    line: elevation === "raised" || elevation === "floating"
      ? undefined
      : { color: color(theme, lineToken), width: cm(lineWidth), ...(dash ? { dash } : {}), ...(lineAlpha !== undefined ? { alpha: lineAlpha } : {}) },
    cornerRadius,
    shadow,
  }];
  const child = decorativeChild(node);
  if (child) {
    rectsById.set(child.id, innerRect);
    shapes.push(...renderNode(theme, child, innerRect, rectsById, ids, slideId));
  }
  return shapes;
}

function renderCard(theme: SimpleTheme, node: DomNode, rect: Rect, rectsById: Map<string, Rect>, ids: { nextId: number }, slideId: string): ShapeList {
  const tone = toneTokens(theme, node.tone);
  const style = theme.component.card || {};
  const surface = surfaceNode(node, style);
  const fillToken = typeof node.fill === "string" ? node.fill : tone.fill || style.fill || "surface";
  const lineToken = typeof node.line === "string" ? node.line : tone.line || style.line || "divider";
  const cornerRadius = optionalCornerRadiusProp(node) ?? style.cornerRadius ?? 0.12;
  const padding = optionalNumberProp(node, "padding") ?? style.padding ?? 0.5;
  // Cards default to subtle elevation so they stand off the page; agents who
  // want a flat card pass elevation:"flat". The shadow inherits the tone's
  // accent color so brand-toned cards cast a faint colored shadow.
  const elevation = resolveElevation(node.elevation) ?? "flat";
  const shadow = surfaceShadow(theme, surface, shadowForElevation(theme, elevation, tone.accent));
  // Per-card border width / dash override.
  const lineWidth = normalizeStrokeCm(optionalNumberProp(surface, "lineWidth") ?? optionalNumberProp(surface, "borderWidth"), 0.02);
  const dashToken = surfaceDash(surface);
  const fillAlpha = alphaProp(surface.fillOpacity);
  const lineAlpha = alphaProp(surface.lineOpacity);
  const accent = node.accent === "left" || node.accent === "top" ? node.accent : "none";
  // Accent color follows the tone when the agent didn't override it
  // explicitly. brand-toned cards get a brand accent bar; danger-toned
  // cards get a red one — without the agent having to spell it out.
  const accentColor = stringProp(node, "accentColor", tone.accent || "brand.primary");
  // Accent bar width — agents can thicken it with `accentWidth: 0.18`.
  const accentSize = optionalNumberProp(node, "accentWidth") ?? 0.12;
  const header = cardHeader(node);
  const headerText = header?.text || "";
  const footerText = typeof node.footer === "string" && node.footer.trim() ? node.footer.trim() : "";
  const shapes: ShapeList = [{
    type: "shape",
    id: ids.nextId++,
    name: `${nodeLabel(node)}-card`,
    preset: "roundRect",
    xfrm: xfrm(rect),
    fill: surfaceFill(theme, surface, fillToken, "surface", fillAlpha),
    line: elevation === "floating"
      ? undefined
      : { color: color(theme, lineToken), width: cm(lineWidth), ...(dashToken ? { dash: dashToken } : {}), ...(lineAlpha !== undefined ? { alpha: lineAlpha } : {}) },
    cornerRadius,
    shadow,
  }];
  let inner: Rect = { x: rect.x + padding, y: rect.y + padding, w: Math.max(0, rect.w - padding * 2), h: Math.max(0, rect.h - padding * 2) };
  if (accent === "left") {
    shapes.push({
      type: "shape",
      id: ids.nextId++,
      name: `${nodeLabel(node)}-accent`,
      preset: "rect",
      xfrm: xfrm({ x: rect.x, y: rect.y + cornerRadius * 0.5, w: accentSize, h: Math.max(0.2, rect.h - cornerRadius) }),
      fill: { type: "solid", color: color(theme, accentColor) },
    });
    inner = { x: inner.x + accentSize, y: inner.y, w: Math.max(0, inner.w - accentSize), h: inner.h };
  } else if (accent === "top") {
    shapes.push({
      type: "shape",
      id: ids.nextId++,
      name: `${nodeLabel(node)}-accent`,
      preset: "rect",
      xfrm: xfrm({ x: rect.x + cornerRadius * 0.5, y: rect.y, w: Math.max(0.2, rect.w - cornerRadius), h: accentSize }),
      fill: { type: "solid", color: color(theme, accentColor) },
    });
    inner = { x: inner.x, y: inner.y + accentSize, w: inner.w, h: Math.max(0, inner.h - accentSize) };
  }
  const headerHeight = headerText ? 0.7 : 0;
  const footerHeight = footerText ? 0.5 : 0;
  if (headerText) {
    shapes.push(textShape(theme, { id: `${node.id}.${header?.field || "header"}`, type: "text", text: headerText, style: "card-title", color: tone.fg }, { x: inner.x, y: inner.y, w: inner.w, h: headerHeight }, ids));
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
  // Bands are full-bleed/section dividers, NOT card-tinted surfaces. When an
  // agent writes `tone:"brand"` on a band they expect the brand color to
  // fill it (covers, section headers, end slides). The shared `toneTokens`
  // helper maps brand → brand.tint (a soft pastel) which is correct for
  // metric-card / insight-card chrome but wrong for bands. Override here so
  // the band always paints with the strong tone color, and text inside
  // resolves against text.inverse.
  const toneRaw = node.tone;
  const tone = toneRaw === "brand"
    ? { fill: "brand.primary", line: "brand.primary", fg: "text.inverse" }
    : toneRaw === "positive"
      ? { fill: "success", line: "success", fg: "text.inverse" }
      : toneRaw === "warning"
        ? { fill: "warning", line: "warning", fg: "text.inverse" }
        : toneRaw === "danger"
          ? { fill: "danger", line: "danger", fg: "text.inverse" }
          : toneTokens(theme, toneRaw);
  const style = theme.component.band || {};
  const surface = surfaceNode(node, style);
  const fillToken = typeof node.fill === "string" ? node.fill : tone.fill || style.fill || "surface.subtle";
  const childFgToken = readableTextColorForFill(theme, fillToken, tone.fg);
  const cornerRadius = optionalCornerRadiusProp(node) ?? style.cornerRadius ?? 0;
  const padding = decorativePadding(theme, node, rect);
  // Optional agent overrides on bands.
  const lineToken = typeof surface.line === "string" ? surface.line : null;
  const lineWidth = normalizeStrokeCm(optionalNumberProp(surface, "lineWidth") ?? optionalNumberProp(surface, "borderWidth"), 0.02);
  const dashToken = surfaceDash(surface);
  const fillAlpha = alphaProp(surface.fillOpacity);
  const lineAlpha = alphaProp(surface.lineOpacity);
  const elevation = resolveElevation(node.elevation) ?? "flat";
  const shadow = surfaceShadow(theme, surface, shadowForElevation(theme, elevation, tone.accent));
  const innerRect: Rect = { x: rect.x + padding, y: rect.y + padding, w: Math.max(0, rect.w - padding * 2), h: Math.max(0, rect.h - padding * 2) };
  const shapes: ShapeList = [{
    type: "shape",
    id: ids.nextId++,
    name: `${nodeLabel(node)}-band`,
    preset: cornerRadius > 0 ? "roundRect" : "rect",
    xfrm: xfrm(rect),
    fill: surfaceFill(theme, surface, fillToken, "surface.subtle", fillAlpha),
    cornerRadius: cornerRadius > 0 ? cornerRadius : undefined,
    line: lineToken ? { color: color(theme, lineToken), width: cm(lineWidth), ...(dashToken ? { dash: dashToken } : {}), ...(lineAlpha !== undefined ? { alpha: lineAlpha } : {}) } : undefined,
    shadow,
  }];
  const child = decorativeChild(node);
  if (child) {
    rectsById.set(child.id, innerRect);
    shapes.push(...renderNode(theme, withDefaultTextColor(child, childFgToken, true), innerRect, rectsById, ids, slideId));
  }
  return shapes;
}

function renderFrame(theme: SimpleTheme, node: DomNode, rect: Rect, rectsById: Map<string, Rect>, ids: { nextId: number }, slideId: string): ShapeList {
  const style = theme.component.frame || {};
  const lineToken = stringProp(node, "line", style.line || "divider");
  const lineWidth = normalizeStrokeCm(optionalNumberProp(node, "lineWidth"), 0.025);
  const dash = node.dash === "dash" || node.dash === "dashDot" || node.dash === "dot" ? node.dash : undefined;
  // 761q1u fix: agents reach for `frame` with a tiny fixedHeight as a
  // horizontal accent rule (`{type:"frame", line:"FFFFFF", fixedHeight:0.08}`).
  // The default frame radius (0.12) on a 0.08cm-tall rect produces a
  // capsule that visually disappears, and frame's default padding of
  // 0.4cm consumes the whole rect. Treat as divider when no children +
  // small fixedHeight: zero radius, no padding so the line stretches edge
  // to edge. Tony tinyThreshold bypass is wired in renderNode.
  const fixedH = optionalNumberProp(node, "fixedHeight");
  const isDividerLikeFrame = (!Array.isArray(node.children) || node.children.length === 0)
    && typeof fixedH === "number" && fixedH < 0.6;
  const cornerRadius = optionalCornerRadiusProp(node) ?? (isDividerLikeFrame ? 0 : (style.cornerRadius ?? 0.12));
  const padding = optionalNumberProp(node, "padding") ?? (isDividerLikeFrame ? 0 : (style.padding ?? 0.4));
  const innerRect: Rect = { x: rect.x + padding, y: rect.y + padding, w: Math.max(0, rect.w - padding * 2), h: Math.max(0, rect.h - padding * 2) };
  const shapes: ShapeList = [{
    type: "shape",
    id: ids.nextId++,
    name: `${nodeLabel(node)}-frame`,
    // Divider-like frame draws a SOLID filled bar (the agent gave us an
    // explicit `line` color, but they actually want a visible rule, not a
    // hollow outline). Use the line color as fill so it shows up.
    preset: "rect",
    xfrm: xfrm(rect),
    fill: isDividerLikeFrame
      ? { type: "solid", color: color(theme, lineToken) }
      : { type: "none" },
    line: isDividerLikeFrame
      ? undefined
      : { color: color(theme, lineToken), width: cm(lineWidth), ...(dash ? { dash } : {}) },
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
  // Mirror the auto-orient applied during measureSubtree so the rendered
  // shapes match the measured layout. Without this, the renderer would lay
  // out a vertical stack of 6 cards when the measurer flipped it to a
  // horizontal grid — which both renders incorrectly AND emits a
  // FALLBACK_FAILED on the stale stack path.
  const oriented = autoOrientFlow(node, rect);
  if (oriented.type === "grid") return renderGrid(theme, oriented, rect, rectsById, ids, slideId);
  return assembleLayeredContainer(theme, oriented, rect, rectsById, ids, slideId, layoutStackChildren);
}

function renderGrid(theme: SimpleTheme, node: DomNode, rect: Rect, rectsById: Map<string, Rect>, ids: { nextId: number }, slideId: string): ShapeList {
  const children = node.children || [];
  if (children.length === 0) return [];
  const oriented = autoOrientFlow(node, rect);
  if (oriented.type === "stack") return renderStack(theme, oriented, rect, rectsById, ids, slideId);
  return assembleLayeredContainer(theme, oriented, rect, rectsById, ids, slideId, layoutGridChildren);
}

/**
 * Render a stack/grid container with layered children: backing → behind
 * children → flow children → above children. Layered children fill the
 * parent's content rect (set by layoutStack/GridChildren). Render order
 * matches z-order — behind first, flow next, above last.
 */
function assembleLayeredContainer(
  theme: SimpleTheme,
  node: DomNode,
  rect: Rect,
  rectsById: Map<string, Rect>,
  ids: { nextId: number },
  slideId: string,
  layoutFn: (theme: SimpleTheme, node: DomNode, rect: Rect) => Array<{ node: DomNode; rect: Rect }>,
): ShapeList {
  const inner = contentRect(theme, node, rect);
  const placements = layoutFn(theme, node, inner);
  // If the parent container declares a cornerRadius (panel/card-like
  // round shape) and a layered image child has no explicit clip, inherit
  // the radius so the image fits the container's rounded corners. This
  // is the lightweight clipping case — full container clipping for all
  // child types is harder in OOXML and out of scope here.
  const parentCornerRadius = optionalCornerRadiusProp(node);
  const behind: ShapeList = [];
  const flow: ShapeList = [];
  const above: ShapeList = [];
  for (const { node: child, rect: childRect } of placements) {
    const isLayeredImage = child.type === "image" && (child.layer === "behind" || child.layer === "above");
    const shouldInheritClip = isLayeredImage
      && typeof parentCornerRadius === "number" && parentCornerRadius > 0
      && child.clip === undefined;
    if (shouldInheritClip) {
      // Mutate a shallow clone — don't touch the source DOM.
      const clipped: DomNode = { ...child, clip: "rounded", cornerRadius: parentCornerRadius };
      rectsById.set(clipped.id, childRect);
      const shapes = renderNode(theme, clipped, childRect, rectsById, ids, slideId);
      const layer = clipped.layer === "behind" ? "behind" : "above";
      if (layer === "behind") behind.push(...shapes); else above.push(...shapes);
      continue;
    }
    rectsById.set(child.id, childRect);
    const shapes = renderNode(theme, child, childRect, rectsById, ids, slideId);
    const layer = child.layer === "behind" ? "behind" : child.layer === "above" ? "above" : "flow";
    if (layer === "behind") behind.push(...shapes);
    else if (layer === "above") above.push(...shapes);
    else flow.push(...shapes);
  }
  return [
    ...containerBackgroundShape(theme, node, rect, ids),
    ...behind,
    ...flow,
    ...above,
  ];
}

function renderChrome(theme: SimpleTheme, deck: RenderedDeck, slideIndex: number, ids: { nextId: number }, slideBgHex?: string): ShapeList {
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
    // Chrome is added by the renderer regardless of slide background, so we
    // pick a contrasting color against the rendered slide bg. Without this,
    // a brand-fill cover slide would show 1.82:1 page-number text — a
    // problem the agent cannot fix from slide JSON.
    const pageColor = pickChromeFgColor(theme, slideBgHex);
    out.push(textShape(theme, {
      id: `chrome.page-${slideIndex + 1}`,
      type: "text",
      text: `${slideIndex + 1} / ${deck.slides.length}`,
      style: "footnote",
      align: "right",
      color: pageColor,
    }, { x: layout.slideWidthCm - chrome.footerPadding - 2, y: footerY + 0.05, w: 2, h: chrome.footerHeight - 0.05 }, ids));
  }
  const footerText = typeof chrome.footerText === "string" && chrome.footerText.trim() ? chrome.footerText.trim() : "";
  if (footerText) {
    const footerColor = pickChromeFgColor(theme, slideBgHex);
    const rightReserve = chrome.pageNumber ? 2.4 : 0;
    out.push(textShape(theme, {
      id: "chrome.footer-text",
      type: "text",
      text: footerText,
      style: "footnote",
      align: "left",
      color: footerColor,
    }, {
      x: layout.pageMarginX,
      y: footerY + 0.05,
      w: Math.max(2, layout.slideWidthCm - layout.pageMarginX * 2 - rightReserve),
      h: chrome.footerHeight - 0.05,
    }, ids));
  }
  return out;
}

/**
 * Pick a chrome (page-number / footer text) fg that has at least 4.5:1
 * contrast against the slide bg. Default theme uses text.muted (gray) which
 * fails on brand-fill covers; we pick from a small set of safe candidates so
 * the chrome is always readable.
 */
function pickChromeFgColor(theme: SimpleTheme, slideBgHex?: string): string {
  if (!slideBgHex || !/^[0-9A-Fa-f]{6}$/.test(slideBgHex)) return "text.muted";
  const candidates = ["text.muted", "text.primary", "text.inverse"];
  let best: { token: string; ratio: number } | null = null;
  for (const token of candidates) {
    const hex = theme.colors[token] || color(theme, token, "text.primary");
    const ratio = contrastRatio(hex, slideBgHex);
    if (!best || ratio > best.ratio) best = { token, ratio };
    if (ratio >= 4.5) return token;
  }
  return best?.token || "text.primary";
}

function textShape(theme: SimpleTheme, node: DomNode, rect: Rect, ids: { nextId: number }): ShapeList[number] {
  const kind = textStyleKey(node);
  const baseStyle = effectiveTextStyle(theme, node, "paragraph");
  // Auto-enable autoFit:"shrink" for display-tier styles when the agent
  // hasn't set anything explicit. Headlines / hero stats / CTA labels are
  // the most common overflow source — pre-shrinking is a safer default
  // than clipping. Body / paragraph / article styles do NOT auto-enable
  // because shrinking body text usually means the layout is wrong, not the
  // text being too long.
  const effectiveAutoFit = node.autoFit ?? defaultAutoFitForStyle(kind);
  const style = effectiveAutoFit === "shrink" ? autoShrinkStyle(theme, node, baseStyle, rect, kind) : baseStyle;
  const paragraphs = buildParagraphs(theme, node, style);
  const autoFit = effectiveAutoFit === "shrink" || effectiveAutoFit === "resize" ? effectiveAutoFit : undefined;
  if (!autoFit) pushTextFitDiagnostics(theme, node, rect, baseStyle);
  const cornerRadius = typeof node.cornerRadius === "number"
    ? normalizeCornerRadius(node.cornerRadius)
    : (typeof node.fill === "string" || typeof node.line === "string" ? 0.08 : undefined);
  return {
    type: "text",
    id: ids.nextId++,
    name: nodeLabel(node),
    xfrm: xfrm(rect, node),
    valign: valignProp(node, kind),
    paragraphs,
    margin: { l: cm(0.1), r: cm(0.1), t: cm(0.05), b: cm(0.05) },
    wrap: node.wrap === "none" || node.noWrap === true ? "none" : undefined,
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
            // Markdown expansion at the paragraph-text level too — keeps
            // {paragraphs:[{text:"**重点**"}]} working without forcing the
            // agent to construct runs[] manually.
            if (rec.markdown !== false) {
              const parsed = parseMarkdownInline(text);
              if (parsed.matched) {
                const styleColor = typeof rec.color === "string" ? { ...paraStyle, color: rec.color } : paraStyle;
                return parsed.runs.map((r) => richRunToTextRun(theme, r, styleColor, isStyleBold(paraStyle.weight)));
              }
            }
            const face = pickRunFontFace(theme, text, paraStyle);
            return [{
              text,
              sizeHalfPt: paraStyle.fontSize * 2,
              bold: isStyleBold(paraStyle.weight),
              italic: paraStyle.italic === true,
              letterSpacing: paraStyle.letterSpacing,
              color: color(theme, typeof rec.color === "string" ? rec.color : undefined, paraStyle.color),
              fontFace: face.fontFace,
              eastAsianFontFace: face.eastAsianFontFace,
              complexScriptFontFace: face.complexScriptFontFace,
              cjk: face.cjk,
              mono: face.mono,
            }];
          })();
      const para: Paragraph = {
        runs,
        align: paragraphAlign(rec.align ?? node.align),
      };
      if (typeof rec.indentLevel === "number" && rec.indentLevel > 0) para.indentLevel = rec.indentLevel;
      para.lineSpacingHalfPt = typeof rec.lineSpacing === "number" ? rec.lineSpacing * 2 : lineSpacingHalfPtForStyle(paraStyle);
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
  para.lineSpacingHalfPt = typeof node.lineSpacing === "number" ? node.lineSpacing * 2 : lineSpacingHalfPtForStyle(style);
  if (typeof node.spaceAfter === "number") para.spaceAfterHalfPt = node.spaceAfter * 2;
  return [para];
}

function lineSpacingHalfPtForStyle(style: ReturnType<typeof textStyle>): number | undefined {
  if (!Number.isFinite(style.fontSize) || !Number.isFinite(style.lineHeight) || style.fontSize <= 0 || style.lineHeight <= 0) return undefined;
  return style.fontSize * style.lineHeight * 2;
}

function paragraphAlign(value: unknown): "left" | "center" | "right" | "justify" | undefined {
  if (value === "left" || value === "center" || value === "right" || value === "justify") return value;
  return undefined;
}

/**
 * Map a bullets node's `marker` field to a paragraph-level glyph bullet.
 *
 * Two input shapes are accepted:
 *   marker: "disc" | "circle" | "square" | "square-outline" | "triangle" |
 *           "diamond" | "arrow" | "check" | "star" | "dash" | "chevron"
 *   marker: { shape | preset: <one of the above>, color?: string, size?: number }
 *
 * `markerColor` and `markerSize` on the bullets node are accepted as
 * top-level shorthands. `size` is a multiplier of the run font size
 * (1.0 = same as text); clamped 0.5..2.0 for sanity.
 *
 * Returns `null` when no marker is requested → caller falls back to the
 * default `{ auto: true }` bullet.
 */
function resolveBulletMarker(
  theme: SimpleTheme,
  node: DomNode,
): { char: string; color?: string; sizePct?: number } | null {
  const raw = node.marker;
  if (!raw) return null;
  const isObject = typeof raw === "object" && !Array.isArray(raw);
  const tokenRaw = isObject
    ? (typeof (raw as { shape?: unknown }).shape === "string"
        ? (raw as { shape: string }).shape
        : typeof (raw as { preset?: unknown }).preset === "string"
          ? (raw as { preset: string }).preset
          : "")
    : (typeof raw === "string" ? raw : "");
  const token = tokenRaw.toLowerCase().trim();
  const char = BULLET_MARKER_GLYPHS[token];
  if (!char) return null;
  const colorToken = isObject && typeof (raw as { color?: unknown }).color === "string"
    ? (raw as { color: string }).color
    : (typeof node.markerColor === "string" ? node.markerColor : undefined);
  const sizeRaw = isObject && typeof (raw as { size?: unknown }).size === "number"
    ? (raw as { size: number }).size
    : (typeof node.markerSize === "number" ? node.markerSize : undefined);
  const out: { char: string; color?: string; sizePct?: number } = { char };
  if (typeof colorToken === "string") {
    const resolved = color(theme, colorToken);
    if (resolved) out.color = resolved;
  }
  if (typeof sizeRaw === "number" && sizeRaw > 0) {
    out.sizePct = Math.max(0.5, Math.min(2.0, sizeRaw));
  }
  return out;
}

/**
 * Glyph table for shape-style bullet markers. Entries map an agent-friendly
 * preset name to the Unicode character that PowerPoint will render via
 * `<a:buChar>`. We keep this list intentionally small — the goal is to give
 * agents a familiar shape vocabulary (disc, square, triangle, etc.), not a
 * full emoji palette. All glyphs are in the BMP and render in standard
 * Latin/CJK font fallback chains without needing a custom typeface.
 */
const BULLET_MARKER_GLYPHS: Record<string, string> = {
  disc: "\u25CF",            // ●
  dot: "\u25CF",
  circle: "\u25CB",          // ○
  "circle-outline": "\u25CB",
  square: "\u25A0",          // ■
  "square-outline": "\u25A1", // □
  rect: "\u25A0",
  triangle: "\u25B6",        // ▶  (right-pointing — feels like a marker)
  "triangle-up": "\u25B2",   // ▲
  "triangle-down": "\u25BC", // ▼
  diamond: "\u25C6",         // ◆
  arrow: "\u2192",           // →
  "arrow-right": "\u2192",
  check: "\u2713",           // ✓
  checkmark: "\u2713",
  star: "\u2605",            // ★
  dash: "\u2013",            // –
  hyphen: "\u2013",
  chevron: "\u203A",         // ›
  bullet: "\u2022",          // • (explicit, same as auto)
};

function bulletsShape(theme: SimpleTheme, node: DomNode, rect: Rect, ids: { nextId: number }): ShapeList[number] {
  const rawItems = Array.isArray(node.items) ? node.items : [];
  // Use the bullet style and apply node's size dial.
  const baseStyle = textStyle(theme, node.density === "compact" ? "bullet-compact" : "bullet", "paragraph");
  const mult = sizeMultiplier(theme, node.size);
  const style = mult === 1 ? baseStyle : { ...baseStyle, fontSize: baseStyle.fontSize * mult };
  const title = typeof node.title === "string" && node.title.trim() ? node.title.trim() : "";
  const numbered = node.numbered === true;
  const defaultIndent = typeof node.indentLevel === "number" ? node.indentLevel : 0;
  const markerSpec = resolveBulletMarker(theme, node);
  const hangingIndent = bulletHangingIndent(node);
  const itemParas: Paragraph[] = rawItems.map((rawItem) => {
    const isObject = rawItem && typeof rawItem === "object" && !Array.isArray(rawItem);
    const itemRec = isObject ? rawItem as Record<string, unknown> : { text: String(rawItem ?? "") };
    const text = typeof itemRec.text === "string" ? itemRec.text : "";
    const indent = typeof itemRec.indentLevel === "number" ? itemRec.indentLevel : defaultIndent;
    const bold = itemRec.bold === true || (isStyleBold(style.weight));
    const colorToken = typeof itemRec.color === "string" ? itemRec.color : (typeof node.color === "string" ? node.color : undefined);
    const customRuns = Array.isArray(itemRec.runs) ? itemRec.runs : null;
    const styleForItem = colorToken ? { ...style, color: colorToken } : style;
    const parsedRuns = (!customRuns && itemRec.markdown !== false) ? parseMarkdownInline(text) : null;
    const runs: TextRun[] = customRuns
      ? customRuns.map((r) => richRunToTextRun(theme, r, style, bold))
      : (parsedRuns && parsedRuns.matched
          ? parsedRuns.runs.map((r) => richRunToTextRun(theme, r, styleForItem, bold))
          : [plainTextRun(theme, text, style, bold, color(theme, colorToken, style.color))]);
    const para: Paragraph = {
      bullet: numbered
        ? { number: true as const }
        : (markerSpec ? markerSpec : { auto: true as const }),
      runs,
      lineSpacingHalfPt: lineSpacingHalfPtForStyle(style),
      spaceAfterHalfPt: bulletSpaceAfterHalfPt(node),
      marginLeft: hangingIndent.marginLeft,
      hanging: hangingIndent.hanging,
    };
    if (indent > 0) para.indentLevel = indent;
    return para;
  });
  pushBulletsFitDiagnostics(theme, node, rect);
  return {
    type: "text",
    id: ids.nextId++,
    name: nodeLabel(node),
    xfrm: xfrm(rect, node),
    paragraphs: [
      ...(title ? [{
        runs: [plainTextRun(theme, title, theme.text["card-title"], true, color(theme, "brand.primary"))],
        lineSpacingHalfPt: lineSpacingHalfPtForStyle(theme.text["card-title"]),
        spaceAfterHalfPt: 6,
      }] : []),
      ...itemParas,
    ],
    margin: { l: cm(0.2), r: cm(0.1), t: cm(0.08), b: cm(0.08) },
  };
}

function bulletHangingIndent(node: DomNode): { marginLeft: number; hanging: number } {
  if (node.numbered === true) {
    return node.density === "compact"
      ? { marginLeft: cm(0.78), hanging: -cm(0.48) }
      : { marginLeft: cm(0.88), hanging: -cm(0.54) };
  }
  return node.density === "compact"
    ? { marginLeft: cm(0.44), hanging: -cm(0.24) }
    : { marginLeft: cm(0.54), hanging: -cm(0.30) };
}

function bulletSpaceAfterHalfPt(node: DomNode): number {
  if (typeof node.spaceAfter === "number" && Number.isFinite(node.spaceAfter) && node.spaceAfter >= 0) return node.spaceAfter * 2;
  if (node.numbered === true) return node.density === "compact" ? 8 : 13;
  return node.density === "compact" ? 7 : 12;
}

function presetShape(theme: SimpleTheme, node: DomNode, rect: Rect, ids: { nextId: number }): ShapeList[number] {
  const marker = markerVisualSpec(theme, node);
  const presetCandidate = marker?.preset || (typeof node.preset === "string" && SHAPE_PRESETS.has(node.preset) ? node.preset : "rect");
  const preset = presetCandidate as ShapePreset;
  const lineWidthCm = normalizeStrokeCm(optionalNumberProp(node, "lineWidth") ?? marker?.lineWidth, marker?.lineWidth ?? 0.02);
  const lineDash = node.lineDash === "dash" || node.lineDash === "dashDot" || node.lineDash === "dot"
    ? node.lineDash
    : node.dash === "dash" || node.dash === "dashDot" || node.dash === "dot"
      ? node.dash
      : marker?.dash;
  const fillToken = typeof node.fill === "string" ? node.fill : marker?.fill;
  const lineToken = typeof node.line === "string" ? node.line : marker?.line;
  const fillAlpha = alphaProp(node.fillOpacity ?? node.opacity ?? marker?.fillOpacity);
  const lineAlpha = alphaProp(node.lineOpacity ?? node.opacity ?? marker?.lineOpacity);
  const shapeRect = marker ? markerRect(rect, marker, node) : rect;
  const shapeNode = marker && typeof node.rotation !== "number" && typeof marker.rotation === "number"
    ? { ...node, rotation: marker.rotation }
    : node;
  const shape: Extract<ShapeList[number], { type: "shape" }> = {
    type: "shape",
    id: ids.nextId++,
    name: nodeLabel(node),
    preset,
    xfrm: xfrm(shapeRect, shapeNode),
    fill: fillToken || hasSurfaceGradient(node) ? surfaceFill(theme, node, fillToken, "background", fillAlpha) : { type: "none" },
    line: lineToken ? { color: color(theme, lineToken), width: cm(lineWidthCm), ...(lineDash ? { dash: lineDash } : {}), ...(lineAlpha !== undefined ? { alpha: lineAlpha } : {}) } : undefined,
    ...(typeof node.cornerRadius === "number" ? { cornerRadius: normalizeCornerRadius(node.cornerRadius) } : marker?.cornerRadius !== undefined ? { cornerRadius: marker.cornerRadius } : {}),
  };
  const shadow = surfaceShadow(theme, node);
  if (shadow) shape.shadow = shadow;
  return shape;
}

type MarkerVisualSpec = {
  preset: ShapePreset;
  w: number;
  h: number;
  fill?: string;
  line?: string;
  fillOpacity?: number;
  lineOpacity?: number;
  lineWidth?: number;
  dash?: "dash" | "dashDot" | "dot";
  cornerRadius?: number;
  rotation?: number;
};

function markerVisualSpec(theme: SimpleTheme, node: DomNode): MarkerVisualSpec | null {
  const marker = markerName(node);
  if (!marker) return null;
  const markerRec = markerObject(node);
  const size = markerSizeCm(node.size ?? node.markerSize ?? markerRec?.size);
  const tone = markerToneTokens(theme, node.tone ?? markerRec?.tone);
  const rawVariant = node.variant ?? markerRec?.variant;
  const variant = rawVariant === "solid" || rawVariant === "outline" || rawVariant === "ghost" || rawVariant === "ring" || rawVariant === "badge"
    ? rawVariant
    : marker === "ring"
      ? "ring"
      : "tint";
  const preset = markerPreset(marker);
  const dims = markerDimensions(marker, size);
  const accent = tone.accent;
  const tint = tone.fill;
  const fill = variant === "solid" || variant === "badge"
    ? accent
    : variant === "outline" || variant === "ring"
      ? undefined
      : variant === "ghost"
        ? accent
        : tint;
  const line = variant === "ghost" && node.line === undefined ? accent : accent;
  return {
    preset,
    ...dims,
    fill,
    line,
    fillOpacity: variant === "ghost" ? 0.14 : undefined,
    lineOpacity: variant === "ghost" ? 0.38 : undefined,
    lineWidth: variant === "solid" || variant === "badge" ? 0.02 : 1,
    cornerRadius: marker === "rounded-square" || marker === "index-chip" || marker === "side-bar" ? 0.18 : undefined,
    rotation: marker === "slash" ? -18 : undefined,
  };
}

function markerObject(node: DomNode): Record<string, unknown> | null {
  return node.marker && typeof node.marker === "object" && !Array.isArray(node.marker)
    ? node.marker as Record<string, unknown>
    : null;
}

function markerName(node: DomNode): string | null {
  const raw = node.marker;
  if (typeof raw === "string" && raw.trim()) return normalizeMarkerName(raw);
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    const value = rec.shape ?? rec.preset ?? rec.marker ?? rec.type;
    if (typeof value === "string" && value.trim()) return normalizeMarkerName(value);
  }
  if (node.role === "item-marker" && typeof node.shape === "string") return normalizeMarkerName(node.shape);
  if (node.role === "item-marker" && typeof node.preset === "string") return normalizeMarkerName(node.preset);
  return null;
}

function normalizeMarkerName(value: string): string {
  const v = value.trim();
  if (v === "rect") return "square";
  if (v === "roundRect") return "rounded-square";
  if (v === "ellipse") return "dot";
  if (v === "roundedSquare" || v === "round-square" || v === "rounded-rect") return "rounded-square";
  if (v === "chip" || v === "index") return "index-chip";
  if (v === "bar" || v === "stripe" || v === "side-rail") return "side-bar";
  return v;
}

function markerPreset(marker: string): ShapePreset {
  if (marker === "dot" || marker === "ring") return "ellipse";
  if (marker === "rounded-square" || marker === "index-chip") return "roundRect";
  if (marker === "diamond") return "diamond";
  if (marker === "slash") return "line";
  return "rect";
}

function markerDimensions(marker: string, size: number): { w: number; h: number } {
  if (marker === "side-bar") return { w: Math.max(0.06, size * 0.22), h: Math.max(0.55, size * 1.9) };
  if (marker === "slash") return { w: Math.max(0.5, size * 1.55), h: Math.max(0.16, size * 0.32) };
  if (marker === "index-chip") return { w: size * 1.35, h: size };
  return { w: size, h: size };
}

function markerSizeCm(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return clamp(value, 0.12, 0.9);
  if (value === "xs") return 0.18;
  if (value === "sm") return 0.28;
  if (value === "lg") return 0.52;
  if (value === "xl") return 0.68;
  return 0.38;
}

function markerToneTokens(theme: SimpleTheme, toneValue: unknown): { fill: string; accent: string } {
  const tone = toneTokens(theme, toneValue);
  if (toneValue === "neutral" || toneValue === "muted") return { fill: "surface.subtle", accent: "divider" };
  return { fill: tone.fill || "brand.tint", accent: tone.accent || tone.line || "brand.primary" };
}

function markerRect(rect: Rect, marker: MarkerVisualSpec, node: DomNode): Rect {
  const w = Math.min(marker.w, rect.w);
  const h = Math.min(marker.h, rect.h);
  const align = node.align === "left" || node.align === "start" ? "start" : node.align === "right" || node.align === "end" ? "end" : "center";
  const valign = node.valign === "top" || node.valign === "start" ? "start" : node.valign === "bottom" || node.valign === "end" ? "end" : "center";
  const x = align === "start" ? rect.x : align === "end" ? rect.x + rect.w - w : rect.x + (rect.w - w) / 2;
  const y = valign === "start" ? rect.y : valign === "end" ? rect.y + rect.h - h : rect.y + (rect.h - h) / 2;
  return { x, y, w, h };
}

function dividerShape(theme: SimpleTheme, node: DomNode, rect: Rect, ids: { nextId: number }): ShapeList[number] {
  const orientation = node.orientation === "horizontal" || node.orientation === "vertical"
    ? node.orientation
    : rect.w >= rect.h ? "horizontal" : "vertical";
  const thickness = normalizeStrokeCm(node.thickness, 0.025, { minCm: 0.01, maxCm: 0.18 });
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
  const sourceRows = tableSourceRows(node);
  const columnModel = tableColumnModel(node, sourceRows);
  const headers = columnModel.headers;
  const widthsFromColumns = columnModel.widthsFromColumns;
  const rawRows = tableRowsFromNode(sourceRows, columnModel.columnDefs);
  const headerRow: unknown[] = headers.length > 0 ? headers : [];
  const allRows: unknown[][] = headerRow.length > 0 ? [headerRow, ...rawRows] : rawRows;
  const colCount = Math.max(1, ...allRows.map((row) => row.length));
  const rowCount = Math.max(1, allRows.length);
  const cellAlign = node.align === "center" || node.align === "right" || node.align === "left" ? node.align : "left";
  const firstRowHeader = node.firstRowHeader === false ? false : headers.length > 0;
  const widthsInput = Array.isArray(node.colWidths) ? node.colWidths : (widthsFromColumns && widthsFromColumns.some((w) => w > 0) ? widthsFromColumns : undefined);
  const colWidths = resolveTableColWidths(widthsInput, colCount, rect.w);
  const density = tableDensity(node.density);
  const rowHeightsCm = resolveTableRowHeights(node.rowHeights, rowCount, rect.h, {
    theme,
    rows: allRows,
    colWidths,
    firstRowHeader,
    density,
  });
  const cells = makeTableCells(theme, allRows, colCount, firstRowHeader, cellAlign, {
    headerFill: typeof node.headerFill === "string" ? node.headerFill : undefined,
    bodyFill: typeof node.bodyFill === "string" ? node.bodyFill : undefined,
    density,
  });
  pushEmptyTableDataDiagnostic(node, rect, sourceRows, rawRows, firstRowHeader);
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
    borderWidth: cm(normalizeStrokeCm(node.borderWidth, 0.01)),
  };
}

type TableColumnDef = { key: string; header: string; width: number };

function tableSourceRows(node: DomNode): unknown[] {
  const data = node.data && typeof node.data === "object" && !Array.isArray(node.data)
    ? node.data as Record<string, unknown>
    : null;
  const raw = Array.isArray(node.rows)
    ? node.rows
    : Array.isArray(data?.rows)
      ? data.rows
      : Array.isArray(node.items)
        ? node.items
        : Array.isArray(data?.items)
          ? data.items
          : Array.isArray(node.values)
            ? node.values
            : [];
  return Array.isArray(raw) ? raw : [];
}

function tableColumnModel(node: DomNode, sourceRows: unknown[] = tableSourceRows(node)): { headers: string[]; columnDefs: TableColumnDef[] | null; widthsFromColumns: number[] | null } {
  const data = node.data && typeof node.data === "object" && !Array.isArray(node.data)
    ? node.data as Record<string, unknown>
    : null;
  const encoding = node.encoding && typeof node.encoding === "object" && !Array.isArray(node.encoding)
    ? node.encoding as Record<string, unknown>
    : null;
  const columnsField = Array.isArray(node.columns)
    ? node.columns
    : Array.isArray(encoding?.columns)
      ? encoding.columns
      : Array.isArray(data?.columns)
        ? data.columns
      : null;
  if (columnsField) {
    const columnDefs = columnsField.map(tableColumnDefFromUnknown).filter((column) => column.key || column.header);
    return {
      headers: columnDefs.map((c) => c.header),
      columnDefs,
      widthsFromColumns: columnDefs.map((c) => c.width),
    };
  }
  const headersField = Array.isArray(node.headers)
    ? node.headers
    : Array.isArray(data?.headers)
      ? data.headers
      : [];
  const headerDefs = headersField.map(tableColumnDefFromUnknown).filter((column) => column.key || column.header);
  const headers = headerDefs.map((column) => column.header);
  if (headerDefs.length) {
    return {
      headers,
      // Agents often author {headers:["A"], rows:[{A:"..."}]} rather than
      // columns:[{key:"A",header:"A"}]. Treat headers as object-row keys and
      // fuzzy labels so this common table shape preserves data.
      columnDefs: headerDefs,
      widthsFromColumns: headerDefs.some((column) => column.width > 0) ? headerDefs.map((column) => column.width) : null,
    };
  }
  const inferredKeys = inferTableObjectKeys(sourceRows);
  return {
    headers: inferredKeys,
    columnDefs: inferredKeys.length ? inferredKeys.map((key) => ({ key, header: key, width: 0 })) : null,
    widthsFromColumns: null,
  };
}

function tableColumnDefFromUnknown(value: unknown): TableColumnDef {
  if (typeof value === "string") {
    const key = value.trim();
    return { key, header: key, width: 0 };
  }
  const rec = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const key = firstTableString(rec.key, rec.field, rec.name, rec.id, rec.accessor, rec.value);
  const header = firstTableString(rec.header, rec.label, rec.title, rec.name, rec.text, rec.key, rec.field, rec.value);
  const width = typeof rec.width === "number" && Number.isFinite(rec.width) ? rec.width : 0;
  return { key: key || header, header: header || key, width };
}

function inferTableObjectKeys(sourceRows: unknown[]): string[] {
  for (const row of sourceRows) {
    if (!row || typeof row !== "object" || Array.isArray(row) || Array.isArray((row as { cells?: unknown }).cells)) continue;
    return tableOrderedObjectKeys(row as Record<string, unknown>);
  }
  return [];
}

function tableRowsFromNode(rowsValue: unknown, columnDefs: TableColumnDef[] | null): unknown[][] {
  return Array.isArray(rowsValue) ? rowsValue.map((row) => {
    if (Array.isArray(row)) return row;
    if (row && typeof row === "object" && Array.isArray((row as { cells?: unknown }).cells)) return (row as { cells: unknown[] }).cells;
    if (row && typeof row === "object" && columnDefs?.length) {
      const rec = row as Record<string, unknown>;
      const mapped = columnDefs.map((column) => tableObjectCell(rec, column));
      if (mapped.some((item) => item.matched)) return mapped.map((item) => item.value);
      const ordered = tableOrderedObjectKeys(rec).map((key) => rec[key]);
      if (ordered.length >= columnDefs.length) return ordered.slice(0, columnDefs.length);
      return mapped.map((item) => item.value);
    }
    return [];
  }) : [];
}

function tableObjectCell(row: Record<string, unknown>, column: TableColumnDef): { matched: boolean; value: unknown } {
  const exactKeys = [column.key, column.header].filter(Boolean);
  for (const key of exactKeys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return { matched: true, value: row[key] };
  }
  const rowKeys = Object.keys(row);
  const folded = new Map<string, string>();
  for (const key of rowKeys) folded.set(key.toLowerCase(), key);
  for (const key of exactKeys) {
    const found = folded.get(key.toLowerCase());
    if (found) return { matched: true, value: row[found] };
  }
  const normalized = new Map<string, string>();
  for (const key of rowKeys) {
    for (const candidate of tableKeyCandidates(key)) normalized.set(candidate, key);
  }
  for (const key of exactKeys) {
    for (const candidate of tableKeyCandidates(key)) {
      const found = normalized.get(candidate);
      if (found) return { matched: true, value: row[found] };
    }
  }
  return { matched: false, value: "" };
}

function tableKeyCandidates(key: string): string[] {
  const base = tableKeyFingerprint(key);
  if (!base) return [];
  const out = new Set<string>([base]);
  out.add(base.replace(/(h[12])(\d{2})$/i, "$120$2"));
  out.add(base.replace(/([a-z]+)(\d{2})$/i, "$120$2"));
  for (const group of TABLE_KEY_SYNONYM_GROUPS) {
    if (group.includes(base)) for (const alias of group) out.add(alias);
  }
  return Array.from(out);
}

function tableKeyFingerprint(key: string): string {
  return key.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function tableOrderedObjectKeys(row: Record<string, unknown>): string[] {
  return Object.keys(row).filter((key) => !TABLE_ROW_METADATA_KEYS.has(key));
}

const TABLE_ROW_METADATA_KEYS = new Set(["tone", "status", "color", "fill", "bold", "align", "valign", "style", "metadata", "className"]);
const TABLE_KEY_SYNONYM_GROUPS = [
  ["metric", "label", "name", "title", "category", "item"],
  ["amount", "value", "val"],
  ["count", "number", "num", "qty", "quantity"],
  ["headcount", "hc", "people", "staff"],
  ["revenue", "rev", "sales"],
];

function firstTableString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function makeTableCells(
  theme: SimpleTheme,
  rows: unknown[][],
  colCount: number,
  firstRowHeader: boolean,
  defaultAlign: "left" | "center" | "right",
  defaults: { headerFill?: string; bodyFill?: string; density?: TableDensity } = {},
): TableCell[][] {
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
        ...makeTableCell(theme, raw, isHeader, defaultAlign, defaults),
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
      else row[colIndex] = makeTableCell(theme, "", rowIndex === 0 && firstRowHeader, defaultAlign, defaults);
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
      const missing = nums.filter((n) => n <= 0).length;
      if (missing > 0) {
        // Partial column widths are almost always authored as relative
        // emphasis ("make the label column ~2.5x") while omitted columns mean
        // "auto". Treat missing widths as weight 1 instead of absolute zero so
        // bound tables never emit zero-width grid columns and the emphasized
        // columns get the space the author intended.
        const weights = nums.map((n) => n > 0 ? n : 1);
        const weightSum = weights.reduce((a, b) => a + b, 0);
        return weights.map((n) => (n / weightSum) * totalCm);
      }
      // Treat as widths if total is close to totalCm; otherwise as weights.
      const looksAbsolute = Math.abs(sum - totalCm) < totalCm * 0.5 && nums.every((n) => n >= 0.3);
      if (looksAbsolute) return nums;
      return nums.map((n) => (n / sum) * totalCm);
    }
  }
  return Array.from({ length: colCount }, () => totalCm / colCount);
}

function resolveTableRowHeights(
  raw: unknown,
  rowCount: number,
  totalCm: number,
  intrinsic?: { theme: SimpleTheme; rows: unknown[][]; colWidths: number[]; firstRowHeader: boolean; density?: TableDensity },
): number[] {
  if (Array.isArray(raw) && raw.length === rowCount) {
    const nums = raw.map((v) => typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
    const sum = nums.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      const looksAbsolute = Math.abs(sum - totalCm) < totalCm * 0.5 && nums.every((n) => n >= 0.2);
      if (looksAbsolute) return nums;
      return nums.map((n) => (n / sum) * totalCm);
    }
  }
  if (intrinsic && intrinsic.rows.length === rowCount) {
    const floor = tableRowHeightFloor(false, intrinsic.density || "comfortable");
    const needed = estimateTableRowHeights(intrinsic.theme, intrinsic.rows, intrinsic.colWidths, intrinsic.firstRowHeader, intrinsic.density || "comfortable")
      .map((h) => Math.max(floor, h));
    const sum = needed.reduce((a, b) => a + b, 0);
    if (sum > 0 && Number.isFinite(sum)) {
      if (sum <= totalCm) {
        const surplus = (totalCm - sum) / rowCount;
        return needed.map((h) => h + surplus);
      }
      // When the table is genuinely too dense, allocate proportional row
      // heights so the diagnostic points at real shortage instead of an
      // artificial equal-row split.
      return needed.map((h) => (h / sum) * totalCm);
    }
  }
  return Array.from({ length: rowCount }, () => totalCm / rowCount);
}

function makeTableCell(
  theme: SimpleTheme,
  raw: unknown,
  isHeader: boolean,
  defaultAlign: "left" | "center" | "right",
  defaults: { headerFill?: string; bodyFill?: string; density?: TableDensity } = {},
): TableCell {
  const style = tableTextStyle(theme, isHeader, defaults.density || "comfortable");
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const cell = raw as Record<string, unknown>;
    const text = firstTableString(cell.text, cell.value, cell.label, cell.title);
    const customRuns = Array.isArray(cell.runs) ? cell.runs : null;
    const align = cell.align === "left" || cell.align === "center" || cell.align === "right" ? cell.align : (isHeader ? "center" : defaultAlign);
    const valign = cell.valign === "top" || cell.valign === "bottom" || cell.valign === "middle" ? cell.valign : "middle";
    const fillToken = typeof cell.fill === "string" ? cell.fill : isHeader ? (defaults.headerFill || "surface.subtle") : defaults.bodyFill;
    const colorToken = typeof cell.color === "string" ? cell.color : tokenToneColor(cell.tone);
    const bold = cell.bold === true || (isStyleBold(style.weight));
    const effectiveStyle = colorToken ? { ...style, color: colorToken } : style;
    const parsedRuns = (!customRuns && cell.markdown !== false) ? parseMarkdownInline(text) : null;
    const runs: TextRun[] = customRuns
      ? customRuns.map((r) => richRunToTextRun(theme, r, style, bold))
      : parsedRuns?.matched
        ? parsedRuns.runs.map((r) => richRunToTextRun(theme, r, effectiveStyle, bold))
        : [plainTextRun(theme, text, style, bold, color(theme, colorToken, style.color))];
    return {
      runs,
      fill: fillToken ? { type: "solid", color: color(theme, fillToken) } : undefined,
      align,
      valign,
    };
  }
  const text = String(raw ?? "");
  const parsedRuns = parseMarkdownInline(text);
  return {
    runs: parsedRuns.matched
      ? parsedRuns.runs.map((r) => richRunToTextRun(theme, r, style, isStyleBold(style.weight)))
      : [plainTextRun(theme, text, style, isStyleBold(style.weight), color(theme, undefined, style.color))],
    fill: isHeader
      ? { type: "solid", color: color(theme, defaults.headerFill || "surface.subtle") }
      : defaults.bodyFill ? { type: "solid", color: color(theme, defaults.bodyFill) } : undefined,
    align: isHeader ? "center" : defaultAlign,
    valign: "middle",
  };
}

function richRunToTextRun(theme: SimpleTheme, raw: unknown, style: ReturnType<typeof textStyle>, defaultBold: boolean): TextRun {
  const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const kind = typeof rec.kind === "string" ? rec.kind : "text";
  const rawLatex = kind === "math" ? (typeof rec.latex === "string" ? rec.latex : String(rec.text ?? "")) : "";
  const omml = kind === "math" ? latexToOmml(rawLatex, { align: "center" }) : undefined;
  if (kind === "math" && omml && !omml.ok) {
    throw new Error(`Unsupported LaTeX command(s) in math run: ${omml.unsupported.join(", ")}. Use supported LaTeX or render the formula as an image.`);
  }
  const rawText = richRunDisplayText(rec);
  const marks = Array.isArray(rec.marks) ? rec.marks.map(String) : [];
  const isMath = kind === "math";
  const text = normalizeTextForPpt(rawText, marks.includes("code") || rec.font === "mono");
  // Resolve a semantic emphasis word ("key", "muted", "danger", ...) into
  // a (color, weight, italic, letterSpacing) hint. Per-run explicit fields
  // still win — emphasis is the convenience layer, not the override layer.
  const emphasis = resolveEmphasis(rec.emphasis);
  // Per-run weight override falls back to bold mark, then to the style.
  // Strings now include the full named CSS axis (medium, semibold, etc.) —
  // resolveFontWeight handles all of them through resolveNumericWeight.
  const explicitWeight =
    typeof rec.weight === "number" || typeof rec.weight === "string"
      ? rec.weight as FontWeight
      : undefined;
  const runWeight: FontWeight | undefined =
    explicitWeight ??
    (marks.includes("bold") || marks.includes("emphasis") || rec.bold === true ? "bold" : undefined) ??
    emphasis?.weight ??
    style.weight;
  const resolvedWeight = resolveFontWeight(runWeight);
  // Per-run size override (xs..2xl) re-scales relative to the style's base.
  const sizeMul = typeof rec.size === "string" ? sizeMultiplier(theme, rec.size) : 1;
  const explicitFontSize = typeof rec.fontSize === "number" && Number.isFinite(rec.fontSize) && rec.fontSize > 0 ? rec.fontSize : undefined;
  const fontFace = isMath
    ? { fontFace: "Cambria Math", eastAsianFontFace: "Cambria Math", complexScriptFontFace: "Cambria Math", cjk: true, mono: false }
    : pickRunFontFace(theme, text, style, {
    marks,
    weight: runWeight,
    font: rec.font === "display" || rec.font === "text" || rec.font === "mono" || rec.font === "cjk" ? rec.font : undefined,
  });
  // Baseline auto-set from sub/sup marks; explicit numeric overrides.
  let baseline: number | undefined;
  if (marks.includes("superscript")) baseline = 30;
  if (marks.includes("subscript")) baseline = -25;
  if (typeof rec.baseline === "number") baseline = rec.baseline;
  // Highlight: agents reach for `highlight:"yellow"` as a one-word inline
  // marker. Accept it as a sufficient signal — no separate `marks:["highlight"]`
  // is required. The mark form still works; this just removes a footgun
  // where the color field looked applied but silently did nothing.
  const highlightToken = typeof rec.highlight === "string" ? rec.highlight : undefined;
  const highlight = highlightToken
    ? color(theme, highlightToken, "warning.tint")
    : (marks.includes("highlight") ? color(theme, undefined, "warning.tint") : undefined);
  // Letter-spacing accepts a tracking word ("tight" | "normal" | "wide")
  // alongside the existing 1/100-pt numeric form. Tracking words let agents
  // reach for `tracking:"tight"` on a hero without remembering point math.
  const trackingPt = trackingToLetterSpacing(rec.tracking ?? rec.letterSpacing);
  // Color resolution priority: explicit per-run color → emphasis hint → style default.
  const colorToken = typeof rec.color === "string" ? rec.color : (kind === "token" ? tokenToneColor(rec.tone) : emphasis?.color);
  return {
    text,
    ...(omml?.omml ? { mathOmml: omml.omml, mathLatex: rawLatex } : {}),
    sizeHalfPt: (explicitFontSize ?? style.fontSize * sizeMul) * 2,
    bold: defaultBold || resolvedWeight.bold,
    italic: rec.italic === true || (!isMath && marks.includes("italic")) || emphasis?.italic === true,
    underline: rec.underline === true || marks.includes("underline"),
    strike: marks.includes("strikethrough"),
    baseline,
    letterSpacing: trackingPt ?? emphasis?.letterSpacing ?? style.letterSpacing,
    highlight,
    color: color(theme, colorToken, style.color),
    fontFace: fontFace.fontFace,
    eastAsianFontFace: fontFace.eastAsianFontFace,
    complexScriptFontFace: fontFace.complexScriptFontFace,
    cjk: fontFace.cjk,
    mono: fontFace.mono,
    hyperlink: typeof rec.link === "string" ? rec.link : undefined,
    breakLine: rec.breakLine === true,
  };
}

function richRunDisplayText(rec: Record<string, unknown>): string {
  if (rec.kind === "math") return latexToMathText(typeof rec.latex === "string" ? rec.latex : String(rec.text ?? ""));
  if (rec.kind === "token") return typeof rec.text === "string" ? rec.text : formatRichToken(rec.value, rec.format);
  if (rec.kind === "icon") return typeof rec.alt === "string" ? rec.alt : typeof rec.marker === "string" ? rec.marker : "";
  if (typeof rec.text === "string") return rec.text;
  return richInlinePlainText(rec);
}

function tokenToneColor(tone: unknown): string | undefined {
  if (tone === "positive" || tone === "success") return "positive";
  if (tone === "warning") return "warning";
  if (tone === "danger" || tone === "negative") return "danger";
  if (tone === "brand" || tone === "info") return "brand.primary";
  if (tone === "neutral" || tone === "muted") return "text.muted";
  return undefined;
}

/**
 * Map agent-friendly tracking words to letter-spacing in 1/100 pt.
 *   "tight"  → -50  (good for display headlines)
 *   "normal" →   0
 *   "wide"   → +75  (good for eyebrows / labels)
 *   "wider"  → +150
 * Numeric values pass through unchanged.
 */
function trackingToLetterSpacing(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  switch (value.trim().toLowerCase()) {
    case "tighter": return -75;
    case "tight": return -50;
    case "snug": return -25;
    case "normal": return 0;
    case "wide": return 75;
    case "wider": return 150;
    case "widest": return 250;
    default: return undefined;
  }
}

function chartShape(theme: SimpleTheme, node: DomNode, rect: Rect, ids: { nextId: number }): ShapeList[number] {
  const labels = Array.isArray(node.labels) ? node.labels.map(String) : [];
  const series = normalizeChartSeries(node.series);
  const resolvedChartType = chartType(node.chartType);
  const hasRenderableData = chartHasRenderableData(resolvedChartType, labels, series);
  if (!hasRenderableData) pushEmptyChartDataDiagnostic(node, labels, series);
  const safeLabels = hasRenderableData || labels.length > 0 ? labels : ["No data"];
  const safeSeries = alignChartSeriesToLabels(
    hasRenderableData && series.length > 0 ? series : [{ name: "No data", values: [0] }],
    safeLabels.length,
    resolvedChartType,
  );
  const customColors = Array.isArray(node.colors) ? node.colors.filter((c): c is string => typeof c === "string") : null;
  const palette = customColors && customColors.length > 0
    ? customColors.map((token) => color(theme, token))
    : (theme.chart?.series || ["brand.primary", "brand.primary.tint", "text.muted"]).map((token) => color(theme, token));
  const showLegend = typeof node.showLegend === "boolean" ? node.showLegend : safeSeries.length > 1;
  const pieLike = resolvedChartType === "pie" || resolvedChartType === "doughnut";
  const showValues = typeof node.showValues === "boolean" ? node.showValues : pieLike;
  const dataLabels = normalizeChartDataLabels(node.dataLabels, { pieLike, showValues });
  const annotations = normalizeChartAnnotations(node.annotations);
  pushChartFitDiagnostics(node, rect, resolvedChartType, safeLabels.length, showLegend);
  pushChartLabelDiagnostics(node, rect, resolvedChartType, dataLabels);
  const barLike = resolvedChartType === "bar" || resolvedChartType === "stacked-bar" || resolvedChartType === "combo";
  return {
    type: "chart",
    id: ids.nextId++,
    name: nodeLabel(node),
    xfrm: xfrm(rect),
    chartType: resolvedChartType,
    labels: safeLabels,
    series: safeSeries,
    colors: palette,
    showLegend,
    showValues,
    orientation: node.orientation === "horizontal" ? "horizontal" : "vertical",
    dataLabels,
    ...(barLike ? { negativeColor: color(theme, node.negativeColor, "danger") } : {}),
    ...(barLike && typeof node.positiveColor === "string" ? { positiveColor: color(theme, node.positiveColor) } : {}),
    title: typeof node.title === "string" ? node.title : undefined,
    yFormat: chartNumberFormat(node.yFormat),
    annotations: annotations.length > 0 ? annotations : undefined,
  };
}

function chartHasRenderableData(chartTypeValue: ChartType, labels: string[], series: ChartSeries[]): boolean {
  if (chartTypeValue === "scatter") return series.some((item) => (item.points?.length || 0) > 0 || item.values.length > 0);
  return labels.length > 0 && series.some((item) => item.values.length > 0);
}

function alignChartSeriesToLabels(series: ChartSeries[], labelCount: number, chartTypeValue: ChartType): ChartSeries[] {
  if (chartTypeValue === "scatter") return series;
  return series.map((item) => item.values.length === labelCount
    ? item
    : { ...item, values: Array.from({ length: labelCount }, (_, index) => item.values[index] ?? 0) });
}

function pushEmptyChartDataDiagnostic(node: DomNode, labels: string[], series: ChartSeries[]): void {
  const rowCount = node.resolvedData && typeof node.resolvedData === "object" && Array.isArray((node.resolvedData as { rows?: unknown }).rows)
    ? (node.resolvedData as { rows: unknown[] }).rows.length
    : undefined;
  pushDiagnostic({
    severity: "error",
    code: "EMPTY_CHART_DATA",
    slideId: currentSlideId || undefined,
    nodeId: nodeLabel(node),
    message: `Chart '${nodeLabel(node)}' has no renderable data after binding/encoding.`,
    suggestion: "Keep the chart component and repair its data path: verify bind.filter still returns rows, use array filters as inclusion lists or {in:[...]}, and ensure encoding maps category labels to a text field and values to numeric field(s). For horizontal ranked bars, use orientation:'horizontal' or x:numeric with y:category.",
    measured: {
      available: series.reduce((count, item) => count + item.values.length + (item.points?.length || 0), 0),
      needed: 1,
      renderedRows: rowCount,
      lineCount: labels.length,
    },
  });
}

function normalizeChartDataLabels(
  value: unknown,
  defaults: { pieLike: boolean; showValues: boolean },
): ChartDataLabels | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    const out: ChartDataLabels = {};
    if (typeof rec.show === "boolean") out.show = rec.show;
    if (rec.position === "bestFit" || rec.position === "center" || rec.position === "insideEnd" || rec.position === "insideBase" || rec.position === "outsideEnd") out.position = rec.position;
    if (typeof rec.showValue === "boolean") out.showValue = rec.showValue;
    if (typeof rec.showCategoryName === "boolean") out.showCategoryName = rec.showCategoryName;
    if (typeof rec.showSeriesName === "boolean") out.showSeriesName = rec.showSeriesName;
    if (typeof rec.showPercent === "boolean") out.showPercent = rec.showPercent;
    if (typeof rec.showLegendKey === "boolean") out.showLegendKey = rec.showLegendKey;
    if (typeof rec.showLeaderLines === "boolean") out.showLeaderLines = rec.showLeaderLines;
    return out;
  }
  if (defaults.pieLike) {
    return {
      show: defaults.showValues,
      position: "bestFit",
      showCategoryName: true,
      showPercent: true,
      showLeaderLines: true,
    };
  }
  if (defaults.showValues) {
    return { show: true, position: "outsideEnd", showValue: true };
  }
  return undefined;
}

function pushChartLabelDiagnostics(node: DomNode, rect: Rect, resolvedChartType: ChartType, dataLabels: ChartDataLabels | undefined): void {
  const pieLike = resolvedChartType === "pie" || resolvedChartType === "doughnut";
  if (!pieLike) return;
  if (dataLabels?.show !== false) return;
  pushDiagnostic({
    severity: "warn",
    code: "PIE_LABELS_HIDDEN",
    slideId: currentSlideId || undefined,
    nodeId: nodeLabel(node),
    message: `Pie chart '${nodeLabel(node)}' hides slice labels; readers must infer values from the legend or surrounding text.`,
    suggestion: "For pie/doughnut charts, omit showValues:false or set dataLabels:{show:true, position:'bestFit', showCategoryName:true, showPercent:true}.",
    measured: { rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } },
  });
}

function pushChartFitDiagnostics(node: DomNode, rect: Rect, resolvedChartType: ChartType, labelCount: number, showLegend: boolean): void {
  const pieLike = resolvedChartType === "pie" || resolvedChartType === "doughnut";
  const minWidth = pieLike ? 5.2 : 4.8;
  const minHeight = pieLike
    ? labelCount >= 5 || showLegend ? 4.4 : 3.8
    : resolvedChartType === "bar" || resolvedChartType === "stacked-bar" || resolvedChartType === "waterfall" ? 3.0 : 2.8;
  if (rect.w >= minWidth && rect.h >= minHeight) return;
  pushDiagnostic({
    severity: "warn",
    code: "SQUASHED",
    slideId: currentSlideId || undefined,
    nodeId: node.id,
    message: `Chart '${nodeLabel(node)}' was assigned ${rect.w.toFixed(2)}x${rect.h.toFixed(2)}cm; ${resolvedChartType} charts may be hard to read below about ${minWidth.toFixed(1)}x${minHeight.toFixed(1)}cm.`,
    suggestion: chartCapacitySuggestion(resolvedChartType, minWidth, minHeight, labelCount, showLegend),
    measured: {
      rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
      available: rect.h,
      needed: minHeight,
      deltaCm: Math.max(0, minHeight - rect.h),
      minWidthCm: minWidth,
      minHeightCm: minHeight,
      labelCount,
      showLegend,
    },
  });
}

function chartCapacitySuggestion(resolvedChartType: ChartType, minWidth: number, minHeight: number, labelCount: number, showLegend: boolean): string {
  const minimum = `Reserve at least ${minWidth.toFixed(1)}x${minHeight.toFixed(1)}cm for the chart body inside chart-card; title/caption/card chrome need additional space.`;
  const density = labelCount > 8
    ? ` This chart has ${labelCount} categories; reduce label density, group categories, or use a follow-up slide after the body area is large enough.`
    : "";
  const legend = showLegend ? " Move or simplify the legend only after the chart body meets its minimum size." : "";
  if (resolvedChartType === "pie" || resolvedChartType === "doughnut") {
    return `${minimum} Keep the pie/doughnut as the evidence object: use evidence-layout/chart-with-rail/split with the chart taking the dominant region, move explanatory facts to a side rail or next slide, and keep slice labels/data labels visible instead of relying on a tiny legend.${density}${legend}`;
  }
  if (resolvedChartType === "bar" || resolvedChartType === "stacked-bar" || resolvedChartType === "waterfall") {
    return `${minimum} Keep the bar chart as the evidence object: give it full width or a 60-75% split/evidence region, move KPI/table/commentary below/aside or to a follow-up slide, and reduce labels/series/card chrome before changing components.${density}${legend}`;
  }
  return `${minimum} Keep the chart as the evidence object: give it a dominant region, move KPI/table/commentary to a rail or follow-up slide, and reduce series/label/legend density before changing components.${density}${legend}`;
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
  if (typeof node.cornerRadius === "number") shape.cornerRadius = normalizeCornerRadius(node.cornerRadius);
  const border = imageBorderSpec(theme, node);
  if (border) shape.border = border;
  const overlay = imageOverlaySpec(theme, node);
  if (overlay) shape.overlay = overlay;
  const opacity = alphaProp(node.opacity);
  if (opacity !== undefined) shape.opacity = opacity;
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
  // Defer all weight resolution to resolveFontWeight so named ("medium",
  // "semibold", "light") and numeric (100..900) values share one semantic
  // — bold ⇔ numeric >= 600. The previous hand-rolled comparisons treated
  // "medium" as bold, which contradicts CSS (medium=500, semibold=600).
  if (node.weight === undefined || node.weight === null) return styleBold;
  const resolved = resolveFontWeight(node.weight as FontWeight | undefined);
  // If we couldn't resolve the value, fall back to the style's bold-ness so
  // typos don't silently flip emphasis on or off.
  if (typeof node.weight === "string" && !["thin","hairline","extralight","ultralight","light","normal","regular","book","medium","semibold","demibold","bold","extrabold","ultrabold","heavy","black","super"].includes(node.weight as string)) {
    return styleBold;
  }
  return resolved.bold;
}

function textRuns(theme: SimpleTheme, node: DomNode, style: ReturnType<typeof textStyle>): TextRun[] {
  const content = node.content;
  // node.color is the authored intent for the whole text shape; when content
  // runs don't override individually, they should inherit it (not the bare
  // style default). Without this, components that set node-level color via
  // ctaButton/featureCard end up rendering text.primary against the surface.
  const effectiveStyle = typeof node.color === "string" && node.color.trim()
    ? { ...style, color: node.color }
    : style;
  if (Array.isArray(content)) {
    // Route every rich-text run through the canonical builder so size /
    // weight / font / strike / sub / sup / highlight stay honored. The
    // node-level uppercase/italic/bold still apply as a baseline.
    return content.map((raw) => {
      const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const upperRaw = typeof record.text === "string" ? maybeUppercase(record.text, node) : record.text;
      const merged = { ...record, text: upperRaw };
      const baseBold = nodeBold(node, isStyleBold(effectiveStyle.weight));
      const run = richRunToTextRun(theme, merged, effectiveStyle, baseBold);
      // Node-level italic / underline still propagate when the run has none.
      if (run.italic === false && node.italic === true) run.italic = true;
      if (run.underline === false && node.underline === true) run.underline = true;
      return run;
    });
  }
  const text = maybeUppercase(stringProp(node, "text", typeof content === "string" ? content : ""), node);
  const styleKey = textStyleKey(node);
  // Markdown-inline expansion: if the agent embeds **bold** / *italic* /
  // ==highlight== / `code` / {{key:foo}} markers in `text`, expand them into
  // proper RichTextRuns. Disabled when the node opts out via `markdown:false`
  // (intentional literal text). Code-style nodes also opt out — backticks
  // there are content, not markup.
  if (styleKey !== "code" && node.markdown !== false) {
    const parsed = parseMarkdownInline(text);
    if (parsed.matched) {
      const baseBold = nodeBold(node, isStyleBold(effectiveStyle.weight));
      return parsed.runs.map((raw) => {
        const merged = { ...raw, text: maybeUppercase(raw.text ?? "", node) };
        const run = richRunToTextRun(theme, merged, effectiveStyle, baseBold);
        if (run.italic === false && node.italic === true) run.italic = true;
        if (run.underline === false && node.underline === true) run.underline = true;
        return run;
      });
    }
  }
  const runText = normalizeTextForPpt(text, styleKey === "code");
  const face = pickRunFontFace(theme, runText, style, {
    font: styleKey === "code" ? "mono" : undefined,
  });
  // Node-level emphasis applies to the whole text shape when `node.emphasis`
  // is set — agents reach for it on labels / hero stats / kickers without
  // having to nest a runs[] array.
  const nodeEmphasis = resolveEmphasis(node.emphasis);
  const emphasisBold = nodeEmphasis?.weight ? resolveFontWeight(nodeEmphasis.weight).bold : false;
  const trackingPt = trackingToLetterSpacing(node.tracking);
  // Number-aware metric weight: hero / metric-value styles get a numeric
  // portion bolded automatically when the agent writes "25% increase" or
  // "¥1,250 GMV" without any explicit runs[]. The text stays semantic.
  if ((styleKey === "metric-value" || styleKey === "hero") && !nodeEmphasis && node.numericEmphasis !== false) {
    const split = splitNumericRun(text);
    if (split) {
      const baseBold = nodeBold(node, isStyleBold(effectiveStyle.weight));
      return split.map((raw) => {
        const merged = { ...raw, text: maybeUppercase(raw.text ?? "", node) };
        const run = richRunToTextRun(theme, merged, effectiveStyle, baseBold);
        if (run.italic === false && node.italic === true) run.italic = true;
        return run;
      });
    }
  }
  return [{
    text: runText,
    sizeHalfPt: style.fontSize * 2,
    bold: nodeBold(node, isStyleBold(style.weight)) || emphasisBold,
    italic: node.italic === true || style.italic === true || nodeEmphasis?.italic === true,
    underline: node.underline === true,
    letterSpacing: trackingPt ?? nodeEmphasis?.letterSpacing ?? style.letterSpacing,
    color: color(theme, node.color ?? nodeEmphasis?.color, style.color),
    fontFace: face.fontFace,
    eastAsianFontFace: face.eastAsianFontFace,
    complexScriptFontFace: face.complexScriptFontFace,
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
  // Pre-pass: when a stack/grid has many callout siblings, the per-callout
  // height/width budget collapses (5 callouts in 8cm vertical stack → 1.6cm
  // each, but each callout's chrome alone wants 1.6cm). Stamp density:"compact"
  // on those siblings BEFORE component expansion so calloutNode emits a
  // tighter surface that actually fits.
  const densified = densifyCalloutSiblings(withId);
  const expanded = isComponentTypedNode(densified) ? expandComponent(slideId, densified) : densified;
  // `split` is sugar over `stack` with explicit layoutWeights. Lower it after
  // component expansion as well, since semantic components such as two-column
  // can expand to split.
  const lowered = expanded.type === "split" ? splitToStack(expanded) : expanded;
  const children = lowered.children
    ?.map((child, index) => materializeNode(child, slideId, `${fallbackPath ? fallbackPath + "." : ""}${index}`))
    .flatMap((child) => child.type === "fragment" ? (child.children || []) : [child]);
  return {
    ...lowered,
    id: typeof lowered.id === "string" && lowered.id ? lowered.id : fallbackId,
    children,
  };
}

function densifyCalloutSiblings(node: DomNode): DomNode {
  if (!node || typeof node !== "object") return node;
  const isContainer = node.type === "stack" || node.type === "grid" || node.type === "split";
  if (!isContainer || !Array.isArray(node.children) || node.children.length < 4) return node;
  const calloutCount = node.children.filter((child) => child && typeof child === "object" && (child.type === "callout" || (child.type === "component" && child.component === "callout"))).length;
  if (calloutCount < 4) return node;
  const updatedChildren = node.children.map((child) => {
    if (!child || typeof child !== "object") return child;
    const isCallout = child.type === "callout" || (child.type === "component" && child.component === "callout");
    if (!isCallout) return child;
    // Respect explicit density choice — author may have set
    // density:"comfortable" deliberately to fight the auto-densify, or
    // density:"compact" already (no-op).
    if (typeof child.density === "string") return child;
    return { ...child, density: "compact", __densifiedBySiblings: true } as DomNode;
  });
  return { ...node, children: updatedChildren };
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
    __loweredFromSplit: true,
    __explicitSplitRatio: Boolean(ratioRaw && ratioRaw.length === children.length),
    __splitRatio: ratio,
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
  const { theme } = buildThemeForDeck(deck);
  const slides = deck.slides.map((slide) => {
    const dom = materializeAndCompactify(slide.dom, slide.id);
    return { slide, dom, layout: layoutSlide(theme, dom), decisions: layoutDecisionsBySlide.get(slide.id) || new Map() };
  });
  const diagnostics = getRenderDiagnostics();
  return {
    ...deck,
    slides: slides.map(({ slide, dom, layout, decisions }) => {
      const slideDiagnostics = diagnostics.filter((item) => item.slideId === slide.id);
      return {
        ...slide,
        dom,
        measured: {
          nodes: layout.measured.map(serializeMeasuredNode),
          layoutDecisions: Array.from(decisions.entries()).map(([nodeId, decision]) => ({ nodeId, ...decision })),
          diagnostics: slideDiagnostics,
          collisions: slideDiagnostics
            .filter((item) => item.code === "COLLISION" || item.code === "SIBLING_INK_OVERLAP" || item.code === "STRUCTURAL_OVERLAP" || item.code === "OVERLAY_OCCLUDES_FLOW")
            .map((item) => ({
              code: item.code,
              nodeId: item.nodeId,
              otherNodeId: item.measured?.other?.nodeId,
              rect: item.measured?.rect,
              other: item.measured?.other,
              overlap: item.measured?.overlap,
              overlapAreaCm2: item.measured?.overlapAreaCm2,
              overlapRatio: item.measured?.overlapRatio,
              relationship: item.measured?.relationship,
            })),
        },
      };
    }),
  } as RenderedDeck;
}

function serializeMeasuredNode(node: MeasuredNode): MeasuredNode {
  return {
    ...node,
    rect: roundRect(node.rect),
    ...(node.inkRect ? { inkRect: roundRect(node.inkRect) } : {}),
    ...(node.visualRect ? { visualRect: roundRect(node.visualRect) } : {}),
  };
}

function roundRect(rect: Rect): Rect {
  return {
    x: Math.round(rect.x * 1000) / 1000,
    y: Math.round(rect.y * 1000) / 1000,
    w: Math.round(rect.w * 1000) / 1000,
    h: Math.round(rect.h * 1000) / 1000,
  };
}

function containerBackgroundShape(theme: SimpleTheme, node: DomNode, rect: Rect, ids: { nextId: number }): ShapeList {
  const style = componentStyle(theme, node);
  const surface = surfaceNode(node, style);
  const fillToken = typeof surface.fill === "string" ? surface.fill : undefined;
  const lineToken = typeof surface.line === "string" ? surface.line : undefined;
  if (!fillToken && !lineToken && !hasSurfaceGradient(surface)) return [];
  const cornerRadius = typeof surface.cornerRadius === "number" ? normalizeCornerRadius(surface.cornerRadius) : 0.08;
  const fillAlpha = alphaProp(surface.fillOpacity);
  const lineAlpha = alphaProp(surface.lineOpacity);
  const lineWidth = normalizeStrokeCm(optionalNumberProp(surface, "lineWidth") ?? optionalNumberProp(surface, "borderWidth"), 0.02);
  const dash = surfaceDash(surface);
  const shape: Extract<ShapeList[number], { type: "shape" }> = {
    type: "shape",
    id: ids.nextId++,
    name: `${nodeLabel(node)}-background`,
    preset: "roundRect",
    xfrm: xfrm(rect),
    fill: fillToken || hasSurfaceGradient(surface) ? surfaceFill(theme, surface, fillToken, "surface", fillAlpha) : { type: "none" },
    line: lineToken ? { color: color(theme, lineToken), width: cm(lineWidth), ...(dash ? { dash } : {}), ...(lineAlpha !== undefined ? { alpha: lineAlpha } : {}) } : undefined,
    cornerRadius,
  };
  const shadow = surfaceShadow(theme, surface);
  if (shadow) shape.shadow = shadow;
  return [shape];
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
  const children = () => parent.children || [];
  if (children().length === 0) return;

  const gap = gapCm(theme, parent);
  const sumIntrinsic = () => {
    const current = children();
    const specs = current.map((child) => childMainSpec(theme, child, direction, crossSize));
    return specs.reduce((sum, spec) => sum + spec.basis, 0) + gap * Math.max(0, current.length - 1);
  };
  const sumMin = () => {
    const current = children();
    const specs = current.map((child) => childMainSpec(theme, child, direction, crossSize));
    return specs.reduce((sum, spec) => sum + spec.min, 0) + gap * Math.max(0, current.length - 1);
  };

  // Stage 1 covered by solver; we only act when min sum exceeds available.
  if (sumMin() <= availableMain + 0.001) return;

  // Stage 2: demote density.
  let demoted = 0;
  for (const child of children()) {
    if (child.type === "bullets" && child.density !== "compact") {
      child.density = "compact";
      demoted++;
      pushDiagnostic({
        severity: "warn",
        code: "DEMOTED",
        slideId: currentSlideId || undefined,
        nodeId: child.id,
        message: `Bullets density demoted to 'compact' to fit available space.`,
        suggestion: capacitySuggestion(child, "Either accept the denser look, split into two slides, or shorten items."),
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
        suggestion: capacitySuggestion(child, "Use a shorter sentence or split this slide."),
      });
    }
  }
  if (demoted > 0 && sumMin() <= availableMain + 0.001) return;

  // Stage 3: drop optional.
  const before = children().length;
  const remaining = children().filter((child) => {
    if (child.optional === true) {
      pushDiagnostic({
        severity: "warn",
        code: "DROP",
        slideId: currentSlideId || undefined,
        nodeId: child.id,
        message: `Optional child '${child.id}' dropped to fit available space.`,
        suggestion: capacitySuggestion(child, "If this content is critical, mark it non-optional and move other content out."),
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
        suggestion: capacitySuggestion(child, "Shorten the text or split the slide for cleaner typography."),
      });
    }
  }
  if (truncated > 0 && sumMin() <= availableMain + 0.001) return;

  // Stage 5: hard fail — but with a tolerance band. When `needed` exceeds
  // `available` by < 5% (or < 0.1cm absolute), the renderer's autoFit shrink
  // and inter-line slack absorb the difference; emitting a blocking
  // FALLBACK_FAILED for what the eye reads as "fits fine" forces agents
  // into wasteful retry loops on no-op deltas (see qzwkqg/inmuai logs).
  const needed = sumIntrinsic();
  const delta = needed - availableMain;
  const tolerance = Math.max(0.1, availableMain * 0.05);
  if (delta < tolerance) {
    pushDiagnostic({
      severity: "warn",
      code: "OVERFLOW",
      slideId: currentSlideId || undefined,
      nodeId: parent.id,
      message: `Container '${parent.id}' is ${delta.toFixed(2)}cm over its available height (${availableMain.toFixed(2)}cm); within tolerance, autoFit will absorb it.`,
      suggestion: "No fix required unless the rendered output looks crowded; the small delta is absorbed by autoFit shrink.",
      measured: { available: availableMain, needed, deltaCm: delta },
    });
    return;
  }
  const constraint = findConstrainingAncestor(direction, parent);
  const constraintHint = constraint
    ? ` Constrained by ${constraint.ancestorId}.${constraint.prop} = ${constraint.value}cm; relax or remove that to give children room.`
    : "";
  pushDiagnostic({
    severity: "error",
    code: "FALLBACK_FAILED",
    slideId: currentSlideId || undefined,
    nodeId: parent.id,
    message: `Container '${parent.id}' cannot fit its children even after demote/drop/truncate (needed ${needed.toFixed(2)}cm, available ${availableMain.toFixed(2)}cm).${constraintHint}`,
    suggestion: constraint
      ? `Drop or raise ${constraint.ancestorId}.${constraint.prop} (currently ${constraint.value}cm) so the children have ≥${needed.toFixed(2)}cm. Alternatively, split content across slides or remove a child.`
      : capacitySuggestion(parent, "Split content across slides, remove a child, or increase the parent's allotted height."),
    measured: { available: availableMain, needed, deltaCm: delta },
    ...(constraint ? { constrainedBy: constraint } : {}),
  });
}

function layoutStackChildren(theme: SimpleTheme, node: DomNode, rect: Rect): Array<{ node: DomNode; rect: Rect }> {
  const direction = node.direction === "horizontal" ? "horizontal" : "vertical";
  const mainSize = direction === "horizontal" ? rect.w : rect.h;
  const crossSize = direction === "horizontal" ? rect.h : rect.w;
  const gap = gapCm(theme, node);
  const allChildren = node.children || [];
  if (allChildren.length === 0) return [];
  // Layered children (`layer:"behind"` / `"above"`) claim no main-axis
  // space. They fill the parent's content rect and are rendered
  // beneath / above flow children in renderStack/renderGrid.
  const isLayered = (c: DomNode) => c.layer === "behind" || c.layer === "above";
  const flowOnly = allChildren.filter((c) => !isLayered(c));
  const layered = allChildren.filter(isLayered);
  // Stash flow children on the node so applyFallbackLadder operates on
  // them only; restore after.
  const savedChildren = node.children;
  node.children = flowOnly;
  const initialChildren = flowOnly;
  if (initialChildren.length === 0) {
    node.children = savedChildren;
    return layered.map((c) => ({ node: c, rect }));
  }
  // applyFallbackLadder compares total child demand including gaps
  // (`sumMin` / `sumIntrinsic` add gap * (n - 1)). Pass the full main-axis
  // size here; subtracting gaps here as well double-counts spacing and
  // falsely reports FALLBACK_FAILED for otherwise valid compact stacks.
  const initialAvailable = Math.max(0, mainSize);
  applyFallbackLadder(theme, node, direction, initialAvailable, crossSize);
  const children = node.children || [];
  // Restore the full child list so renderStack still iterates the full
  // set including layered ones.
  node.children = savedChildren;
  if (children.length === 0) {
    return layered.map((c) => ({ node: c, rect }));
  }
  const availableMain = Math.max(0, mainSize - gap * (children.length - 1));
  const explicitSplitRatio = explicitSplitRatioWeights(node, children.length);
  const childSpecs = children.map((child, index) => {
    const spec = childMainSpec(theme, child, direction, crossSize);
    if (!explicitSplitRatio || spec.fixed) return spec;
    const target = availableMain * explicitSplitRatio[index]!;
    return {
      ...spec,
      basis: clamp(target, spec.min, spec.max),
      weight: Math.max(0.0001, explicitSplitRatio[index]!),
      grow: true,
    };
  });
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
  const flowOut = children.map((child, index) => {
    const size = childSizes[index]!;
    const cross = childCrossRect(theme, child, direction === "horizontal" ? rect.y : rect.x, crossSize, node, size, direction);
    const childRect = direction === "horizontal"
      ? { x: cursor, y: cross.start, w: size, h: cross.size }
      : { x: cross.start, y: cursor, w: cross.size, h: size };
    cursor += size + gap;
    return { node: child, rect: childRect };
  });
  if (layered.length === 0) return flowOut;
  return [...flowOut, ...layered.map((c) => ({ node: c, rect }))];
}

function explicitSplitRatioWeights(node: DomNode, childCount: number): number[] | null {
  if (node.__loweredFromSplit !== true || node.__explicitSplitRatio !== true) return null;
  const raw = Array.isArray(node.__splitRatio) ? node.__splitRatio : null;
  if (!raw || raw.length !== childCount) return null;
  const values = raw.map((value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);
  if (values.some((value) => value <= 0)) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  return values.map((value) => value / total);
}

function childCrossRect(theme: SimpleTheme, child: DomNode, parentCrossStart: number, parentCrossSize: number, parent: DomNode, mainSize: number, parentDirection: "horizontal" | "vertical"): { start: number; size: number } {
  const isHorizontal = parentDirection === "horizontal";
  const crossKey = isHorizontal ? "valign" : "align";
  const childExplicit = stringProp(child, crossKey, "");
  const parentExplicit = stringProp(parent, crossKey, "");
  // Default cross alignment is "stretch", but when a child sets a fixed
  // cross-axis size, that's a stronger declaration of intent than the
  // parent's stretch default — honor it (centering by default).
  const fixedCross = optionalNumberProp(child, isHorizontal ? "fixedHeight" : "fixedWidth");
  const maxCross = optionalNumberProp(child, isHorizontal ? "maxHeight" : "maxWidth");
  const minCrossProp = optionalNumberProp(child, isHorizontal ? "minHeight" : "minWidth");
  let crossAlign: string;
  if (childExplicit) crossAlign = childExplicit;
  else if (parentExplicit && parentExplicit !== "stretch") crossAlign = parentExplicit;
  else if (fixedCross !== undefined || maxCross !== undefined) crossAlign = "start";
  else crossAlign = "stretch";
  // Stretch path: full cross size goes to the child (default flex behavior).
  if (crossAlign === "stretch") return { start: parentCrossStart, size: parentCrossSize };
  // Pick the constrained size. fixed wins over max; max caps an otherwise
  // intrinsic-sized child so a `process-step` with maxHeight:3.1 in a 10cm
  // row collapses to 3.1cm and aligns per valign — without this, fill:
  // "surface" was painting a 10cm grey card around 1.7cm of content. But
  // the cap must NOT compress content below its intrinsic minimum, so when
  // the child needs more than maxCross (rich step with title+meta+body+
  // bullets), grow back to that intrinsic min — otherwise SQUASHED.
  let size: number;
  if (fixedCross !== undefined) size = Math.min(fixedCross, parentCrossSize);
  else if (maxCross !== undefined) {
    const childCrossDirection: "horizontal" | "vertical" = isHorizontal ? "vertical" : "horizontal";
    const intrinsic = intrinsicMainSize(theme, child, childCrossDirection, mainSize);
    const minCross = Math.max(intrinsicMinSize(theme, child, childCrossDirection, mainSize), minCrossProp ?? 0, 0);
    const ceilBound = Math.min(parentCrossSize, Math.max(maxCross, minCross));
    size = Math.min(parentCrossSize, Math.max(intrinsic, minCross, Math.min(maxCross, ceilBound)));
  }
  else return { start: parentCrossStart, size: parentCrossSize };
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
  const allChildren = node.children || [];
  if (allChildren.length === 0) return [];
  // Layered children skip grid placement and fill the grid's content rect.
  const isLayered = (c: DomNode) => c.layer === "behind" || c.layer === "above";
  const flowOnly = allChildren.filter((c) => !isLayered(c));
  const layered = allChildren.filter(isLayered);
  if (flowOnly.length === 0) {
    return layered.map((c) => ({ node: c, rect }));
  }
  const children = flowOnly;
  const columns = Math.max(1, numberProp(node, "columns", 2));
  const placements = computeGridPlacements(children, columns);
  const declaredRows = Math.max(0, Math.floor(numberProp(node, "rows", 0)));
  const usedRows = placements.reduce((max, p) => Math.max(max, p.row + p.rowSpan), 0);
  const rows = Math.max(1, declaredRows, usedRows);
  const gap = gapCm(theme, node);
  const availableWidth = Math.max(0, rect.w - gap * (columns - 1));
  const availableHeight = Math.max(0, rect.h - gap * (rows - 1));
  const colWidths = gridColumnSizesFromProps(node, columns, availableWidth);
  const colX = positionsFromSizes(rect.x, gap, colWidths);
  const rowHeights = resolveGridRowHeights(theme, placements, columns, rows, availableHeight, colWidths, gap, node.rowWeights);
  const rowY = positionsFromSizes(rect.y, gap, rowHeights);
  const flowOut = placements.map(({ child, row, col, rowSpan, colSpan }) => {
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
  if (layered.length === 0) return flowOut;
  return [...flowOut, ...layered.map((c) => ({ node: c, rect }))];
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
  if (node.type === "stack" && node.direction !== "horizontal") return verticalStackIntrinsicWidth(theme, node, crossSize);
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
  if (node.type === "shape") {
    const marker = markerVisualSpec(theme, node);
    if (marker) return direction === "horizontal" ? marker.w : marker.h;
  }
  if (node.type === "panel" || node.type === "card" || node.type === "band" || node.type === "frame" || node.type === "inset") {
    return decorativeIntrinsicMain(theme, node, direction, crossSize);
  }
  if (direction === "horizontal") {
    if (node.type === "image") return Math.min(12, Math.max(3.2, crossSize * 0.9));
    if (node.type === "text") return textIntrinsicWidth(theme, node);
    if (node.type === "divider") return normalizeStrokeCm(node.thickness, 0.025, { minCm: 0.01, maxCm: 0.18 }) + 0.02;
    if (node.type === "stack") return node.direction === "horizontal" ? horizontalStackIntrinsicWidth(theme, node, crossSize) : verticalStackIntrinsicWidth(theme, node, crossSize);
    return 3.2;
  }
  if (node.type === "text") return textIntrinsicHeight(theme, node, crossSize);
  if (node.type === "bullets") return bulletsIntrinsicHeight(theme, node, crossSize);
  if (node.type === "spacer") return direction === "vertical" ? 0.4 : 0.6;
  if (node.type === "divider") return normalizeStrokeCm(node.thickness, 0.025, { minCm: 0.01, maxCm: 0.18 }) + 0.02;
  if (node.type === "image") return Math.min(10, Math.max(2.4, crossSize * 0.62));
  if (node.type === "table") return tableIntrinsicHeight(theme, node, crossSize);
  if (node.type === "stack") return stackIntrinsicHeight(theme, node, crossSize) + contentHugSafetySlack(node);
  if (node.type === "grid") return gridIntrinsicHeight(theme, node, crossSize);
  return 2;
}

function decorativeIntrinsicMain(theme: SimpleTheme, node: DomNode, direction: "horizontal" | "vertical", crossSize: number): number {
  const padding = decorativePadding(theme, node);
  let chromeMain = padding * 2;
  if (direction === "vertical" && node.type === "card") {
    if (cardHeader(node)) chromeMain += 0.85;
    if (typeof node.footer === "string" && node.footer.trim()) chromeMain += 0.65;
    if (node.accent === "top") chromeMain += 0.12;
  }
  if (direction === "horizontal" && node.type === "card" && node.accent === "left") chromeMain += 0.12;
  const child = decorativeChild(node);
  if (!child) return Math.max(chromeMain, 0.6);
  const innerCross = Math.max(0, crossSize - padding * 2);
  return chromeMain + intrinsicMainSize(theme, child, direction, innerCross);
}

function decorativePadding(theme: SimpleTheme, node: DomNode, rect?: Rect): number {
  const styleKey = node.type === "panel" ? "panel" : node.type === "card" ? "card" : node.type === "band" ? "band" : node.type === "frame" ? "frame" : "inset";
  const style = theme.component[styleKey] || {};
  const explicit = optionalNumberProp(node, "padding");
  if (explicit !== undefined) return explicit;
  const base = style.padding ?? (node.type === "band" ? 0.6 : 0.4);
  if (node.type !== "band") return base;

  const childCount = Array.isArray(node.children) ? node.children.length : 0;
  const bandHeight = rect?.h ?? optionalNumberProp(node, "fixedHeight");
  if (typeof bandHeight !== "number" || !Number.isFinite(bandHeight)) return base;

  // Thin band with no children is a decorative divider: padding would make the
  // colored strip disappear. For text-bearing bands, auto-reduce padding on
  // short fixed-height bands so label+paragraph strips remain renderable.
  if (childCount === 0 && bandHeight < 0.6) return 0;
  if (childCount > 1) {
    if (bandHeight <= 1.55) return Math.min(base, 0.04);
    if (bandHeight <= 1.8) return Math.min(base, 0.12);
    if (bandHeight <= 2.2) return Math.min(base, 0.22);
  } else if (childCount === 1) {
    if (bandHeight <= 1.2) return Math.min(base, 0.08);
    if (bandHeight <= 1.6) return Math.min(base, 0.22);
    if (bandHeight <= 2.0) return Math.min(base, 0.32);
  }
  return base;
}

function intrinsicMinSize(theme: SimpleTheme, node: DomNode, direction: "horizontal" | "vertical", crossSize: number): number {
  const explicit = optionalNumberProp(node, direction === "horizontal" ? "minWidth" : "minHeight");
  if (explicit !== undefined) return explicit;
  if (direction === "horizontal") return Math.min(intrinsicMainSize(theme, node, direction, crossSize), node.type === "divider" ? 0.02 : 0.45);
  if (node.type === "text") return textMinHeight(theme, node, crossSize);
  if (node.type === "bullets") return bulletsIntrinsicHeight(theme, node, crossSize);
  if (node.type === "divider") return normalizeStrokeCm(node.thickness, 0.025, { minCm: 0.01, maxCm: 0.18 }) + 0.02;
  if (node.type === "spacer") return 0;
  return Math.min(intrinsicMainSize(theme, node, direction, crossSize), 0.9);
}

function tableIntrinsicHeight(theme: SimpleTheme, node: DomNode, widthCm: number): number {
  const { allRows, colCount, firstRowHeader, colWidths } = tableLayoutInfo(node, widthCm);
  if (allRows.length === 0) return 0.9;
  const rowHeights = estimateTableRowHeights(theme, allRows, colWidths, firstRowHeader, tableDensity(node.density));
  return Math.min(10, Math.max(0.9, rowHeights.reduce((sum, h) => sum + h, 0)));
}

function tableLayoutInfo(node: DomNode, widthCm: number): {
  allRows: unknown[][];
  colCount: number;
  firstRowHeader: boolean;
  colWidths: number[];
} {
  const sourceRows = tableSourceRows(node);
  const columnModel = tableColumnModel(node, sourceRows);
  const headers = columnModel.headers;
  const widthsFromColumns = columnModel.widthsFromColumns;
  const rawRows = tableRowsFromNode(sourceRows, columnModel.columnDefs);
  const headerRow: unknown[] = headers.length > 0 ? headers : [];
  const allRows: unknown[][] = headerRow.length > 0 ? [headerRow, ...rawRows] : rawRows;
  const colCount = Math.max(1, ...allRows.map((row) => row.length));
  const firstRowHeader = node.firstRowHeader === false ? false : headers.length > 0;
  const widthsInput = Array.isArray(node.colWidths) ? node.colWidths : (widthsFromColumns && widthsFromColumns.some((w) => w > 0) ? widthsFromColumns : undefined);
  const colWidths = resolveTableColWidths(widthsInput, colCount, widthCm);
  return { allRows, colCount, firstRowHeader, colWidths };
}

type TableDensity = "comfortable" | "compact" | "code" | "code-dense" | "code-tiny";

function tableDensity(raw: unknown): TableDensity {
  if (raw === "code" || raw === "code-dense" || raw === "code-tiny") return raw;
  if (raw === "compact") return "compact";
  return "comfortable";
}

function estimateTableRowHeights(theme: SimpleTheme, rows: unknown[][], colWidths: number[], firstRowHeader: boolean, density: TableDensity = "comfortable"): number[] {
  return rows.map((row, rowIndex) => {
    const isHeader = rowIndex === 0 && firstRowHeader;
    let needed = tableRowHeightFloor(isHeader, density);
    for (let col = 0; col < Math.max(row.length, colWidths.length); col++) {
      const raw = row[col] ?? "";
      needed = Math.max(needed, tableCellIntrinsicHeight(theme, raw, colWidths[col] || colWidths[0] || 1, isHeader, density));
    }
    return needed;
  });
}

function tableRowHeightFloor(isHeader: boolean, density: TableDensity): number {
  if (density === "code-tiny") return 0.18;
  if (density === "code-dense") return 0.21;
  if (density === "code") return 0.25;
  if (density === "compact") return isHeader ? 0.42 : 0.36;
  return isHeader ? 0.55 : 0.48;
}

function tableTextStyle(theme: SimpleTheme, isHeader: boolean, density: TableDensity): ReturnType<typeof textStyle> {
  const kind = isHeader ? "table-header" : "table-cell";
  const style = textStyle(theme, kind, "table-cell");
  if (density === "code-tiny") return { ...style, fontSize: 5.8, lineHeight: 1.0, weight: "regular" };
  if (density === "code-dense") return { ...style, fontSize: 6.5, lineHeight: 1.02, weight: "regular" };
  if (density === "code") return { ...style, fontSize: 7.2, lineHeight: 1.05, weight: "regular" };
  if (density !== "compact") return style;
  return {
    ...style,
    fontSize: Math.max(isHeader ? 8.5 : 8, style.fontSize - (isHeader ? 0.8 : 1.0)),
    lineHeight: Math.min(style.lineHeight, isHeader ? 1.12 : 1.15),
  };
}

function tableCellIntrinsicHeight(theme: SimpleTheme, raw: unknown, widthCm: number, isHeader: boolean, density: TableDensity = "comfortable"): number {
  const style = tableTextStyle(theme, isHeader, density);
  const text = tableCellText(raw);
  const isCode = density === "code" || density === "code-dense" || density === "code-tiny";
  const contentWidth = Math.max(0.8, widthCm - (isCode ? 0.18 : density === "compact" ? 0.38 : 0.52));
  const fontPt = tableCellEffectiveFontPt(raw, style.fontSize);
  const lines = estimatedWrappedLineCount(theme, text, fontPt, isStyleBold(style.weight), contentWidth);
  // Native PowerPoint table cells reserve top/bottom inset and tend to look
  // cramped before geometric overflow is visible in our outer layout. Keep a
  // conservative readable floor so dense 6x7 comparison tables fail validation
  // instead of shipping rows that visually collide in PowerPoint.
  const verticalPadding = isCode ? 0.254 : density === "compact" ? (isHeader ? 0.24 : 0.28) : (isHeader ? 0.38 : 0.42);
  const lineHeight = isCode ? Math.max(style.lineHeight, 1.18) : style.lineHeight;
  return lines * fontPt * 0.0353 * lineHeight + verticalPadding;
}

function tableCellEffectiveFontPt(raw: unknown, fallbackPt: number): number {
  let fontPt = fallbackPt;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    if (Array.isArray(rec.runs)) {
      for (const run of rec.runs) {
        if (!run || typeof run !== "object") continue;
        const value = (run as Record<string, unknown>).fontSize;
        if (typeof value === "number" && Number.isFinite(value) && value > 0) fontPt = Math.max(fontPt, value);
      }
    }
  }
  return fontPt;
}

function tableCellText(raw: unknown): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    if (typeof rec.text === "string") return rec.text;
    if (Array.isArray(rec.runs)) return richRunsPlainText(rec.runs);
    return "";
  }
  return String(raw ?? "");
}

function pushTableFitDiagnostics(theme: SimpleTheme, node: DomNode, rect: Rect, rows: unknown[][], colWidths: number[], rowHeights: number[], firstRowHeader: boolean): void {
  const needed = estimateTableRowHeights(theme, rows, colWidths, firstRowHeader, tableDensity(node.density));
  const shortRows = needed
    .map((height, index) => ({ index, needed: height, available: rowHeights[index] || 0 }))
    .filter((row) => row.needed > row.available + 0.08);
  if (shortRows.length === 0) return;
  if (node.role === "code-block-table") {
    pushCodeBlockOverflowDiagnostic(node, rect, rows, needed, rowHeights, shortRows);
    return;
  }
  const worst = shortRows.reduce((max, row) => row.needed - row.available > max.needed - max.available ? row : max, shortRows[0]!);
  const totalNeeded = needed.reduce((sum, h) => sum + h, 0);
  const estimatedRowsFit = countRowsThatFit(needed, Math.max(0, rect.h));
  const visibleRowsFit = firstRowHeader ? Math.max(0, estimatedRowsFit - 1) : estimatedRowsFit;
  const dataRowCount = firstRowHeader ? Math.max(0, rows.length - 1) : rows.length;
  pushDiagnostic({
    severity: "error",
    code: "FALLBACK_FAILED",
    slideId: currentSlideId,
    nodeId: node.id,
    message: `Table '${nodeLabel(node)}' has ${shortRows.length} row(s) whose text needs more height than assigned; row ${worst.index + 1} needs ${worst.needed.toFixed(2)}cm, available ${worst.available.toFixed(2)}cm.`,
    suggestion: tableCapacitySuggestion(node, {
      dataRowCount,
      visibleRowsFit,
      totalNeeded,
      rect,
      columnCount: colWidths.length,
      density: tableDensity(node.density),
    }),
    measured: {
      available: rect.h,
      needed: totalNeeded,
      rect,
      dataRowCount,
      estimatedVisibleRowsFit: visibleRowsFit,
      columnCount: colWidths.length,
      worstRow: {
        index: worst.index + 1,
        neededCm: worst.needed,
        availableCm: worst.available,
      },
    },
  });
}

function tableCapacitySuggestion(
  node: DomNode,
  details: { dataRowCount: number; visibleRowsFit: number; totalNeeded: number; rect: Rect; columnCount: number; density: string },
): string {
  const { dataRowCount, visibleRowsFit, totalNeeded, rect, columnCount, density } = details;
  const fitText = dataRowCount > 0 && visibleRowsFit < dataRowCount
    ? `This ${columnCount}-column table can currently fit about ${visibleRowsFit}/${dataRowCount} data row(s).`
    : `This ${columnCount}-column table needs about ${totalNeeded.toFixed(2)}cm body height.`;
  const compactHint = density === "compact" || density === "code" || density === "code-dense" || density === "code-tiny"
    ? "It is already using a compact density, so prefer a larger region, wider columns, row pagination, or shorter cell text."
    : "Set density:'compact' for business summary tables before removing rows or columns.";
  const regionHint = rect.h < 4.5
    ? "For 6-8 readable business rows, reserve roughly 4.5-6cm of table body height plus title/caption/card chrome, or let table-card own a half/full slide."
    : `Assigned body height is ${rect.h.toFixed(2)}cm but estimated need is ${totalNeeded.toFixed(2)}cm.`;
  return `Keep the table-card/table semantics and do not delete data just to pass validation. ${fitText} ${regionHint} ${compactHint} Widen text-heavy columns with encoding.columns/colWidths, provide rowHeights for known tall rows, reduce visible rows with an explicit page split, or paginate the same table across slides.`;
}

function pushEmptyTableDataDiagnostic(node: DomNode, rect: Rect, sourceRows: unknown[], bodyRows: unknown[][], firstRowHeader: boolean): void {
  const objectRowsWithFields = sourceRows.filter((row) =>
    Boolean(row && typeof row === "object" && !Array.isArray(row) && !Array.isArray((row as { cells?: unknown }).cells) && Object.keys(row as Record<string, unknown>).length > 0)
  );
  if (!objectRowsWithFields.length || !firstRowHeader || bodyRows.length === 0) return;
  const hasBodyText = bodyRows.some((row) => row.some((cell) => tableCellText(cell).trim() !== ""));
  if (hasBodyText) return;
  pushDiagnostic({
    severity: "error",
    code: "EMPTY_TABLE_DATA",
    slideId: currentSlideId,
    nodeId: node.id,
    message: `Table '${nodeLabel(node)}' has ${objectRowsWithFields.length} authored object row(s), but no body cell text matched its headers/columns.`,
    suggestion: "Keep the table component and repair the mapping: use encoding.columns with explicit {key,label}, or set headers to actual row keys. Header labels can differ from keys only when encoding.columns declares the key.",
    measured: { rect },
  });
}

function pushCodeBlockOverflowDiagnostic(
  node: DomNode,
  rect: Rect,
  rows: unknown[][],
  needed: number[],
  rowHeights: number[],
  shortRows: Array<{ index: number; needed: number; available: number }>,
): void {
  const totalNeeded = needed.reduce((sum, h) => sum + h, 0);
  const available = Math.max(0, rect.h);
  const columns = typeof node.codeColumns === "number" && Number.isFinite(node.codeColumns) && node.codeColumns > 0 ? Math.floor(node.codeColumns) : 1;
  const totalLines = typeof node.codeTotalLines === "number" && Number.isFinite(node.codeTotalLines) ? Math.floor(node.codeTotalLines) : rows.length;
  const capacityInThisColumn = countRowsThatFit(needed, available);
  const estimatedCapacity = Math.max(1, capacityInThisColumn * columns);
  const density = typeof node.codeDensity === "string" ? node.codeDensity.replace(/^code-?/, "") || "compact" : "compact";
  const ownerId = nodeLabel(node).replace(/\.table\d*$/, "");
  const worst = shortRows.reduce((max, row) => row.needed - row.available > max.needed - max.available ? row : max, shortRows[0]!);
  const manyRowsShort = shortRows.length > rows.length / 2;
  pushDiagnostic({
    severity: "error",
    code: "CODE_BLOCK_OVERFLOW",
    slideId: currentSlideId,
    nodeId: ownerId,
    message: manyRowsShort
      ? `Code block '${ownerId}' has ${totalLines} line(s), but the assigned area can show about ${estimatedCapacity} line(s) at density '${density}'.`
      : `Code block '${ownerId}' has line(s) that wrap or need more height than assigned; row ${worst.index + 1} needs ${worst.needed.toFixed(2)}cm, available ${worst.available.toFixed(2)}cm.`,
    suggestion: "Paginate the code into multiple slides or multiple code-block components with explicit line ranges. Use columns:2/3, density:'tiny', or fontSize:5-6 only when still readable. Use maxLines only for an intentional excerpt, not to hide required code.",
    measured: {
      available,
      needed: totalNeeded,
      deltaCm: Math.max(0, totalNeeded - available),
      rect,
      lineCount: totalLines,
      renderedRows: rows.length,
      estimatedCapacityLines: estimatedCapacity,
      columns,
      density,
      fontSize: typeof node.codeFontSize === "number" ? node.codeFontSize : undefined,
    },
  });
}

function countRowsThatFit(heights: number[], available: number): number {
  let used = 0;
  let count = 0;
  for (const height of heights) {
    if (used + height > available + 0.001) break;
    used += height;
    count++;
  }
  return count;
}

const CONTENT_HUG_STACK_ROLES = new Set([
  "callout",
  "quote",
  "timeline",
  "timeline-row",
  "timeline-marker",
]);

function contentHugSafetySlack(node: DomNode): number {
  if (node.role === "callout") {
    // Short callouts should hug their text; the larger safety slack is only
    // needed for long/rich callouts where PowerPoint's text metrics can add
    // another wrapped line.
    return subtreeWeightedTextLength(node) <= 52 ? 0.48 : 0.58;
  }
  if (node.role === "quote") return 0.35;
  return 0;
}

function subtreeWeightedTextLength(node: DomNode): number {
  let total = weightedTextLength(renderedTextContent(node));
  if (node.type === "bullets" && Array.isArray(node.items)) {
    total += node.items.reduce((sum, item) => sum + weightedTextLength(bulletItemText(item)), 0);
  }
  for (const child of node.children || []) total += subtreeWeightedTextLength(child);
  return total;
}

function canGrow(node: DomNode): boolean {
  if (optionalNumberProp(node, "layoutWeight") !== undefined) return true;
  if (node.fill === true) return true;
  if (node.type === "stack" && typeof node.role === "string" && CONTENT_HUG_STACK_ROLES.has(node.role)) return false;
  if (node.type === "grid" && (node.role === "timeline-marker-row" || node.role === "timeline-item-row")) return false;
  return node.type === "image" || node.type === "grid" || node.type === "stack" || node.type === "table" || node.type === "chart" || node.type === "spacer" || node.type === "panel" || node.type === "card" || node.type === "band" || node.type === "frame" || node.type === "inset";
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

function verticalStackIntrinsicWidth(theme: SimpleTheme, node: DomNode, heightCm: number): number {
  const children = node.children || [];
  if (children.length === 0) return 0;
  const pad = paddingCm(theme, node);
  const innerHeight = Math.max(0, heightCm - pad * 2);
  const childWidths = children.map((child) => intrinsicMainSize(theme, child, "horizontal", innerHeight));
  return Math.max(0, ...childWidths) + pad * 2;
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
  const contentWidth = contentRect(theme, node, { x: 0, y: 0, w: widthCm, h: 10 }).w;
  const availableWidth = Math.max(0, contentWidth - gap * (columns - 1));
  const colWidths = gridColumnSizesFromProps(node, columns, availableWidth);
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
  return textNeededHeight(theme, node, widthCm, style);
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
    parts.push(richRunsPlainText(node.content));
  }
  if (Array.isArray(node.paragraphs)) {
    for (const para of node.paragraphs) {
      if (!para || typeof para !== "object") continue;
      const rec = para as Record<string, unknown>;
      if (typeof rec.text === "string") parts.push(rec.text);
      if (Array.isArray(rec.runs)) {
        parts.push(richRunsPlainText(rec.runs));
      }
    }
  }
  if (parts.length === 0 && typeof node.content === "string") parts.push(node.content);
  return parts.join("");
}

function bulletItemText(raw: unknown): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    if (typeof rec.text === "string") return rec.text;
    if (Array.isArray(rec.runs)) {
      return richRunsPlainText(rec.runs);
    }
    return "";
  }
  return String(raw ?? "");
}

function bulletsIntrinsicHeight(theme: SimpleTheme, node: DomNode, widthCm: number): number {
  const items = Array.isArray(node.items) ? node.items.map(bulletItemText) : [""];
  const baseStyle = textStyle(theme, node.density === "compact" ? "bullet-compact" : "bullet", "paragraph");
  const mult = sizeMultiplier(theme, node.size);
  const style = mult === 1 ? baseStyle : { ...baseStyle, fontSize: baseStyle.fontSize * mult };
  const contentWidth = Math.max(0.8, widthCm - 0.85);
  const lineCount = items.reduce((sum, item) => sum + estimatedWrappedLineCount(theme, item, style.fontSize, isStyleBold(style.weight), contentWidth), 0);
  const lineHeight = style.fontSize * 0.0353 * style.lineHeight;
  const spaceAfter = bulletSpaceAfterHalfPt(node) * 0.5 * 0.0353;
  const titleHeight = typeof node.title === "string" && node.title.trim()
    ? theme.text["card-title"].fontSize * 0.0353 * theme.text["card-title"].lineHeight + 6 * 0.5 * 0.0353
    : 0;
  return Math.max(1.05, titleHeight + lineCount * lineHeight + items.length * spaceAfter + 0.16);
}

interface TextParagraphEstimate {
  text: string;
  fontSize: number;
  bold: boolean;
  lineHeightCm: number;
  spaceAfterCm: number;
}

function textNeededHeight(theme: SimpleTheme, node: DomNode, widthCm: number, baseStyle = effectiveTextStyle(theme, node, "paragraph")): number {
  const bodyHeight = textBodyHeightForEstimate(theme, node, widthCm, baseStyle);
  if (bodyHeight <= 0) return singleLineTextHeight(theme, node);
  return Math.min(12, Math.max(minTextLineHeightCm(baseStyle), bodyHeight + textVerticalReserveCm(node)));
}

function textVisibleInkHeight(theme: SimpleTheme, node: DomNode, widthCm: number, baseStyle = effectiveTextStyle(theme, node, "paragraph")): number {
  const bodyHeight = textBodyHeightForEstimate(theme, node, widthCm, baseStyle);
  if (bodyHeight <= 0) return singleLineTextHeight(theme, node);
  return Math.min(12, Math.max(baseStyle.fontSize * 0.0353 * baseStyle.lineHeight, bodyHeight + 0.03));
}

function textBodyHeightForEstimate(theme: SimpleTheme, node: DomNode, widthCm: number, baseStyle: ReturnType<typeof textStyle>): number {
  const paragraphs = textParagraphsForEstimate(theme, node, baseStyle);
  if (paragraphs.length === 0) return 0;
  const contentWidth = Math.max(0.25, widthCm - textHorizontalReserveCm(node));
  const wrap = node.wrap === "none" || node.noWrap === true ? "none" : "wrap";
  return paragraphs.reduce((sum, para, index) => {
    const lines = wrap === "none"
      ? Math.max(1, String(para.text || "").split(/\r?\n/).length)
      : estimatedWrappedLineCount(theme, para.text, para.fontSize, para.bold, contentWidth);
    const spaceAfter = index === paragraphs.length - 1 ? 0 : para.spaceAfterCm;
    return sum + lines * para.lineHeightCm + spaceAfter;
  }, 0);
}

function textParagraphsForEstimate(theme: SimpleTheme, node: DomNode, baseStyle: ReturnType<typeof textStyle>): TextParagraphEstimate[] {
  if (Array.isArray(node.paragraphs) && node.paragraphs.length > 0) {
    const out: TextParagraphEstimate[] = [];
    for (const rawPara of node.paragraphs) {
      if (!rawPara || typeof rawPara !== "object") continue;
      const rec = rawPara as Record<string, unknown>;
      const paraStyle = typeof rec.style === "string" ? textStyle(theme, rec.style, "paragraph") : baseStyle;
      const text = typeof rec.text === "string"
        ? rec.text
        : Array.isArray(rec.runs)
          ? richRunsTextForEstimate(rec.runs)
          : "";
      out.push({
        text,
        fontSize: paraStyle.fontSize,
        bold: isStyleBold(paraStyle.weight),
        lineHeightCm: lineSpacingCmForEstimate(rec.lineSpacing, paraStyle),
        spaceAfterCm: typeof rec.spaceAfter === "number" && Number.isFinite(rec.spaceAfter) ? rec.spaceAfter * 0.0353 : 0,
      });
    }
    return out;
  }
  const text = renderedTextContent(node);
  if (!text) return [];
  return [{
    text,
    fontSize: baseStyle.fontSize,
    bold: isStyleBold(baseStyle.weight),
    lineHeightCm: lineSpacingCmForEstimate(node.lineSpacing, baseStyle),
    spaceAfterCm: typeof node.spaceAfter === "number" && Number.isFinite(node.spaceAfter) ? node.spaceAfter * 0.0353 : 0,
  }];
}

function richRunsTextForEstimate(runs: unknown[]): string {
  return richRunsPlainText(runs);
}

function lineSpacingCmForEstimate(rawLineSpacing: unknown, style: ReturnType<typeof textStyle>): number {
  if (typeof rawLineSpacing === "number" && Number.isFinite(rawLineSpacing) && rawLineSpacing > 0) {
    return rawLineSpacing * 0.0353;
  }
  return style.fontSize * 0.0353 * style.lineHeight;
}

function minTextLineHeightCm(style: ReturnType<typeof textStyle>): number {
  return style.fontSize * 0.0353 * style.lineHeight + 0.16;
}

function textHorizontalReserveCm(node: DomNode): number {
  // textShape emits 0.1cm left/right margins. The extra 0.15cm is deliberate:
  // PowerPoint/LibreOffice line breaking is slightly wider than our glyph
  // estimate, especially for Helvetica/Arial body text.
  return typeof node.fill === "string" || typeof node.line === "string" ? 0.45 : 0.35;
}

function textVerticalReserveCm(node: DomNode): number {
  return typeof node.fill === "string" || typeof node.line === "string" ? 0.28 : 0.18;
}

function fullHeightTextStyle(styleKey: string): boolean {
  return styleKey === "paragraph"
    || styleKey === "caption"
    || styleKey === "figure-caption"
    || styleKey === "article"
    || styleKey === "lead"
    || styleKey === "footnote"
    || styleKey === "code";
}

function skipStrictTextFitDiagnostic(node: DomNode, styleKey: string): boolean {
  if (!fullHeightTextStyle(styleKey)) return true;
  const id = typeof node.id === "string" ? node.id : "";
  return (styleKey === "caption" || styleKey === "figure-caption") && (id.endsWith(".footer") || id.endsWith(".caption"));
}

function pushTextFitDiagnostics(theme: SimpleTheme, node: DomNode, rect: Rect, style: ReturnType<typeof textStyle>): void {
  const styleKey = textStyleKey(node);
  if (skipStrictTextFitDiagnostic(node, styleKey)) return;
  const text = renderedTextContent(node);
  if (!text) return;
  const needed = textNeededHeight(theme, node, rect.w, style);
  if (needed <= rect.h + 0.08) return;
  pushDiagnostic({
    severity: "error",
    code: "FALLBACK_FAILED",
    slideId: currentSlideId,
    nodeId: node.id,
    message: `Text '${nodeLabel(node)}' needs ${needed.toFixed(2)}cm but was assigned ${rect.h.toFixed(2)}cm; PowerPoint would overflow the text box and overlap nearby content.`,
    suggestion: "Give this text more height/width, reduce the copy, or split it across slides. Use autoFit:'shrink' only for non-body display text.",
    measured: { available: rect.h, needed, deltaCm: needed - rect.h, rect },
  });
}

function pushBulletsFitDiagnostics(theme: SimpleTheme, node: DomNode, rect: Rect): void {
  const needed = bulletsIntrinsicHeight(theme, node, rect.w);
  if (needed <= rect.h + 0.08) return;
  pushDiagnostic({
    severity: "error",
    code: "FALLBACK_FAILED",
    slideId: currentSlideId,
    nodeId: node.id,
    message: `Bullets '${nodeLabel(node)}' need ${needed.toFixed(2)}cm but were assigned ${rect.h.toFixed(2)}cm; PowerPoint would compress paragraph spacing or overlap lines.`,
    suggestion: "Use fewer bullets, switch to compact density, split the slide, or give the bullet list more vertical space.",
    measured: { available: rect.h, needed, deltaCm: needed - rect.h, rect },
  });
}

function estimatedWrappedLineCount(theme: SimpleTheme, text: string, fontPt: number, bold: boolean, contentWidthCm: number): number {
  const usable = Math.max(0.25, contentWidthCm);
  const lines = String(text || "").split(/\r?\n/);
  return lines.reduce((sum, line) => {
    const totalWidth = estimatedTextWidthCm(theme, line, fontPt, bold);
    const unbreakableWidth = longestUnbreakableWidthCm(theme, line, fontPt, bold);
    return sum + Math.max(1, Math.ceil(totalWidth / usable), Math.ceil(unbreakableWidth / usable));
  }, 0);
}

function estimatedTextWidthCm(theme: SimpleTheme, text: string, fontPt: number, bold: boolean): number {
  let width = 0;
  for (const ch of text) width += estimatedGlyphWidthCm(theme, ch, fontPt, bold);
  return width;
}

function longestUnbreakableWidthCm(theme: SimpleTheme, text: string, fontPt: number, bold: boolean): number {
  let longest = 0;
  let current = 0;
  for (const ch of text) {
    if (/\s/.test(ch) || /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) {
      longest = Math.max(longest, current);
      current = 0;
      continue;
    }
    current += estimatedGlyphWidthCm(theme, ch, fontPt, bold);
  }
  return Math.max(longest, current);
}

function estimatedGlyphWidthCm(theme: SimpleTheme, ch: string, fontPt: number, bold: boolean): number {
  if (ch === "\u2060") return 0;
  if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) return fontPt * 0.0353 * 1.02;
  if (/\s/.test(ch)) return avgCharWidthCm(theme, fontPt, bold) * 0.45;
  if (isWideVisualSymbol(ch)) return fontPt * 0.0353 * 0.9;
  if (/[ilI1|.,:;]/.test(ch)) return avgCharWidthCm(theme, fontPt, bold) * 0.55;
  if (/[MW@#%&]/.test(ch)) return avgCharWidthCm(theme, fontPt, bold) * 1.25;
  return avgCharWidthCm(theme, fontPt, bold);
}

function isWideVisualSymbol(ch: string): boolean {
  return /[\u2605\u2606\u2713\u2714\u2717\u2715\u2716\u26a0\u25cf\u25cb\u25c6\u25c7\u25a0\u25a1\u25b2\u25b3\u25b6\u25b7\u25bc\u25bd]/.test(ch);
}

function singleLineTextHeight(theme: SimpleTheme, node: DomNode): number {
  const style = effectiveTextStyle(theme, node, "paragraph");
  return style.fontSize * 0.0353 * style.lineHeight + 0.16;
}

/**
 * Vertical-direction min height for a text node, honoring hard `\n` breaks
 * AND wrapped lines under the available cross size. Used by intrinsicMinSize
 * so the flex solver allocates enough vertical space for multi-line content
 * (otherwise a 5-bullet `• … \n • … \n …` blob is sized as 1 line and the
 * overflow is silently swallowed by autoFit:"shrink").
 */
function textMinHeight(theme: SimpleTheme, node: DomNode, crossSize: number): number {
  const style = effectiveTextStyle(theme, node, "paragraph");
  const styleKey = textStyleKey(node);
  const text = renderedTextContent(node);
  if (!text) return singleLineTextHeight(theme, node);
  const effectiveAutoFit = node.autoFit ?? defaultAutoFitForStyle(styleKey);
  const needsFullHeight = node.wrapMinHeight === true || (fullHeightTextStyle(styleKey) && effectiveAutoFit !== "shrink");
  if (!needsFullHeight && !text.includes("\n")) return singleLineTextHeight(theme, node);
  return textNeededHeight(theme, node, Math.max(0.45, crossSize > 0 ? crossSize : 1), style);
}

function textStyleKey(node: DomNode): string {
  if (typeof node.style === "string" && node.style.trim()) return node.style;
  return inferTextKind(node).kind;
}

/**
 * Display-tier styles default autoFit:"shrink" so headline overflow is
 * gracefully shrunk instead of clipped. Body styles do NOT — shrinking
 * body usually masks a layout error.
 */
const AUTOFIT_DEFAULT_SHRINK_STYLES: Set<string> = new Set([
  "deck-title", "slide-title", "section-title", "card-title",
  "hero", "title", "lead",
  "metric-value", "callout", "badge", "tag",
]);

function defaultAutoFitForStyle(styleKey: string): "shrink" | undefined {
  return AUTOFIT_DEFAULT_SHRINK_STYLES.has(styleKey) ? "shrink" : undefined;
}

/**
 * Pre-shrink a text style so the rendered single-line width fits the rect.
 * Used by autoFit:"shrink" nodes to avoid LibreOffice not honoring the
 * runtime normAutofit hint. Floor at 70% of the original size — beyond
 * that the metric is illegible and the slide should be re-authored.
 */
function autoShrinkStyle(
  theme: SimpleTheme,
  node: DomNode,
  style: ReturnType<typeof textStyle>,
  rect: Rect,
  styleKey: string,
  options: { emitDiagnostics?: boolean } = {},
): ReturnType<typeof textStyle> {
  const emitDiagnostics = options.emitDiagnostics !== false;
  const rawText = renderedTextContent(node);
  const lines = rawText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const text = (lines.length > 0 ? lines : [rawText.replace(/\n/g, " ")]).join("\n");
  if (!text) return style;
  // Width margin baked into textShape (l:0.1 + r:0.1 = 0.2 cm) plus a safety
  // buffer so we land well inside the renderer's actual line-break threshold.
  const inner = Math.max(0.1, rect.w - 0.35);
  const innerHeight = Math.max(0.12, rect.h - 0.12);
  const textLines = text.split("\n");
  const computeFit = (fontPt: number): { fits: boolean; widthNeeded: number; heightNeeded: number; unbreakableNeeded: number } => {
    // Bold display text in LibreOffice consistently rendered ~12-15% wider
    // than the cm/pt × char-count estimate; bake that in here so autoShrink
    // errs toward smaller-but-fits rather than estimated-fits-but-wraps.
    const boldFactor = isStyleBold(style.weight) ? (fontPt >= 22 ? 1.32 : 1.22) : 1;
    const latinW = fontPt * 0.019 * boldFactor;
    const cjkW = fontPt * 0.0353 * 1.05;
    const symbolW = fontPt * 0.0353 * 0.95;
    const measureLine = (line: string): number => {
      let w = 0;
      for (const ch of line) {
        if (ch === "\u2060") continue;
        w += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? cjkW : isWideVisualSymbol(ch) ? symbolW : latinW;
      }
      return w;
    };
    const measureUnbreakable = (line: string): number => {
      if (cjkRatio(line) > 0.3) {
        const latinSegments = line.match(/[A-Za-z0-9_.:/@#%+\-]+/g) || [];
        return Math.max(cjkW, ...latinSegments.map(measureLine));
      }
      const tokens = line.trim().split(/\s+/).filter(Boolean);
      return Math.max(0, ...tokens.map(measureLine));
    };
    let widthNeeded = 0;
    let unbreakableNeeded = 0;
    let wrappedLines = 0;
    for (const line of textLines) {
      const measured = measureLine(line);
      widthNeeded = Math.max(widthNeeded, measured);
      unbreakableNeeded = Math.max(unbreakableNeeded, measureUnbreakable(line));
      wrappedLines += Math.max(1, Math.ceil(measured / inner));
    }
    const lineHeightCm = typeof node.lineSpacing === "number" && Number.isFinite(node.lineSpacing) && node.lineSpacing > 0
      ? node.lineSpacing * 0.0353
      : fontPt * 0.0353 * style.lineHeight;
    const heightNeeded = wrappedLines * lineHeightCm;
    return {
      fits: unbreakableNeeded <= inner && (wrappedLines === 1 || heightNeeded <= innerHeight + 0.08),
      widthNeeded,
      heightNeeded,
      unbreakableNeeded,
    };
  };
  const initial = computeFit(style.fontSize);
  if (initial.fits) return style;
  const minPt = Math.max(8, style.fontSize * 0.7);
  let lo = minPt, hi = style.fontSize, fitted = minPt;
  for (let iter = 0; iter < 12; iter++) {
    const mid = (lo + hi) / 2;
    if (computeFit(mid).fits) {
      fitted = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  // Round to a half-pt to keep nice numbers.
  fitted = Math.round(fitted * 2) / 2;
  if (fitted >= style.fontSize - 0.25) return style;
  const severe = isSevereTextShrink(node, styleKey, style.fontSize, fitted);
  if (emitDiagnostics && (severe || fitted <= 9 || fitted <= style.fontSize * 0.78)) {
    pushDiagnostic({
      severity: severe ? "error" : "warn",
      code: "TRUNCATED",
      slideId: currentSlideId || undefined,
      nodeId: node.id,
      message: `Text '${nodeLabel(node)}' was auto-shrunk from ${style.fontSize.toFixed(1)}pt to ${fitted.toFixed(1)}pt to fit its assigned text box after wrapping.`,
      suggestion: severe
        ? "This body text is no longer presentation-readable. Give it more width/height, split the content, shorten it, or choose a layout/component that gives body text more space."
        : "Give this text more width/height, split the content, use shorter lines, or choose a layout/component that gives body text more space.",
      measured: { available: inner, needed: initial.widthNeeded, heightAvailable: innerHeight, heightNeeded: initial.heightNeeded, unbreakableNeeded: initial.unbreakableNeeded, rect },
    });
  }
  return { ...style, fontSize: fitted };
}

function isSevereTextShrink(node: DomNode, styleKey: string, originalPt: number, fittedPt: number): boolean {
  if (node.optional === true) return false;
  if (styleKey === "label" || styleKey === "metric-label" || styleKey === "badge" || styleKey === "tag" || styleKey === "source-note") return false;
  const bodyLike = styleKey === "paragraph" || styleKey === "caption" || styleKey === "figure-caption" || styleKey === "article" || styleKey === "lead";
  if (!bodyLike) return false;
  return fittedPt < 9.5 || fittedPt <= originalPt * 0.72;
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
  const out = { ...base };
  if (mult !== 1) out.fontSize = out.fontSize * mult;
  if (typeof node.fontSize === "number" && Number.isFinite(node.fontSize) && node.fontSize > 0) out.fontSize = node.fontSize;
  if (typeof node.lineHeight === "number" && Number.isFinite(node.lineHeight) && node.lineHeight > 0) out.lineHeight = node.lineHeight;
  if (node.fontWeight !== undefined) out.weight = node.fontWeight;
  if (node.weight !== undefined) out.weight = node.weight;
  if (node.fontFamily === "display" || node.fontFamily === "text" || node.fontFamily === "mono") out.fontFamily = node.fontFamily;
  if (node.font === "display" || node.font === "text" || node.font === "mono") out.fontFamily = node.font;
  if (typeof node.letterSpacing === "number") out.letterSpacing = node.letterSpacing;
  if (node.italic === true) out.italic = true;
  return out;
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

function gridColumnSizesFromProps(node: DomNode, columns: number, availableWidth: number): number[] {
  if (Array.isArray(node.columnWeights) && node.columnWeights.length === columns) {
    return weightsFromProp(node.columnWeights, columns).map((weight) => availableWidth * weight);
  }
  if (Array.isArray(node.colWidths) && node.colWidths.length === columns) {
    const nums = node.colWidths.map((item) => typeof item === "number" && Number.isFinite(item) && item > 0 ? item : 0);
    const sum = nums.reduce((acc, value) => acc + value, 0);
    if (sum > 0) {
      // Match table semantics: values close to the available width are cm;
      // small fractional lists such as [0.12, 1] are proportions.
      const looksAbsolute = Math.abs(sum - availableWidth) < availableWidth * 0.5 && nums.every((n) => n >= 0.3);
      if (looksAbsolute) {
        if (sum <= availableWidth) return nums;
        return nums.map((n) => (n / sum) * availableWidth);
      }
      return normalizeWeights(nums).map((weight) => availableWidth * weight);
    }
  }
  return weightsFromProp(undefined, columns).map((weight) => availableWidth * weight);
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

function optionalCornerRadiusProp(node: DomNode): number | undefined {
  const value = optionalNumberProp(node, "cornerRadius");
  return value === undefined ? undefined : normalizeCornerRadius(value);
}

function alphaProp(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return clamp(value, 0, 1);
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
    if (record.axis === "primary" || record.axis === "secondary") series.axis = record.axis;
    const trendLine = normalizeSeriesTrendLine(record.trendLine);
    if (trendLine) series.trendLine = trendLine;
    const errorBars = normalizeSeriesErrorBars(record.errorBars);
    if (errorBars) series.errorBars = errorBars;
    output.push(series);
  });
  return output;
}

function normalizeSeriesTrendLine(value: unknown): ChartSeries["trendLine"] | undefined {
  if (value === true) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  return {
    ...(rec.type === "linear" || rec.type === "exp" || rec.type === "log" || rec.type === "poly" ? { type: rec.type } : {}),
    ...(typeof rec.order === "number" && Number.isFinite(rec.order) ? { order: Math.max(2, Math.min(6, Math.floor(rec.order))) } : {}),
    ...(typeof rec.label === "string" && rec.label.trim() ? { label: rec.label.trim() } : {}),
  };
}

function normalizeSeriesErrorBars(value: unknown): ChartSeries["errorBars"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  return {
    ...(rec.type === "fixed" || rec.type === "percent" || rec.type === "stdDev" || rec.type === "stdErr" ? { type: rec.type } : {}),
    ...(typeof rec.value === "number" && Number.isFinite(rec.value) && rec.value >= 0 ? { value: rec.value } : {}),
    ...(rec.direction === "x" || rec.direction === "y" || rec.direction === "both" ? { direction: rec.direction } : {}),
  };
}
