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
import { buildTheme, color, preferredFont, resolveEmphasis, resolveFill, resolveFontWeight, sizeMultiplier, textStyle, type FontRole, type FontWeight, type SimpleTheme, type TextStyle } from "./theme.js";
import { parseMarkdownInline, splitNumericRun } from "./markdown-inline.js";

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
  // umzrkm fix: pass the active theme's resolved palette into the contrast
  // check so an agent's brand.primary / accent / success / warning / danger
  // hex values count as "theme-resolved" — auto-fix can then rewrite them
  // when contrast fails. Without this, agents who rebrand to a mid-saturation
  // teal (5B8A8A) leak that color into text.color="brand.primary" callsites
  // and the contrast check refuses to repair, treating it as user intent.
  themeAccentHexesForContrast = collectThemeAccentHexes(theme);
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
    runContrastCheck(slide.id, slideAst, theme);
    runShapeVisibilityCheck(slide.id, slideAst, theme);
    return slideAst;
  });
  themeAccentHexesForContrast = null;
  return {
    size: "16x9",
    language: "zh-CN",
    title: "SlideML2 MVP",
    author: "SlideML2",
    slides,
  };
}

/**
 * Resolve a slide background expression. Accepts a token string, a hex (with or
 * without `#`), or `{fill: "linear-gradient(...)"}`/`{fill: "<token>"}`. Falls
 * back to the deck's `background` token. Gradients are preserved as-is so the
 * OOXML emitter can produce <a:gradFill>.
 */
function resolveSlideBackground(theme: SimpleTheme, raw: unknown):
  | { type: "solid"; color: string }
  | { type: "gradient"; kind: "linear" | "radial"; angle?: number; stops: Array<{ position: number; color: string }> }
  | { type: "image"; src: string } {
  if (raw && typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    if (typeof rec.src === "string" && rec.src.trim()) return { type: "image", src: rec.src };
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
  const ix = Math.max(0, Math.min(t.x + t.w, fill.x + fill.w) - Math.max(t.x, fill.x));
  const iy = Math.max(0, Math.min(t.y + t.h, fill.y + fill.h) - Math.max(t.y, fill.y));
  if (ix <= 0 || iy <= 0) return false;
  const overlap = ix * iy;
  const textArea = Math.max(1, t.w * t.h);
  return overlap / textArea >= 0.7;
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
  if (MUTED_TOKEN_HEXES.has(hex.toUpperCase())) return true;
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

function collectThemeAccentHexes(theme: SimpleTheme): Set<string> {
  const out = new Set<string>();
  const tokens = [
    "brand.primary", "brand.tint",
    "accent",
    "success", "warning", "danger", "info",
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
    "success", "warning", "danger", "info",
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
  const subtleTokens = ["divider", "border", "surface.subtle", "surface.muted", "text.muted", "text.subtle"];
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
      // "raised"/"floating" cards intentionally use shadow as their
      // distinguishing visual instead of a border. Adding a border on
      // top would override the floating-card design language.
      const hasShadow = !!(shape as { shadow?: { color?: string; alpha?: number } }).shadow;
      // SKIP if the agent supplied a non-solid line treatment (dash etc.)
      // — overwriting their explicit `dash` style with a default border
      // would lose intent.
      const hasAgentLineStyle = !!(shape.line && typeof (shape.line as { dash?: string }).dash === "string");
      if (!hasShadow && !hasAgentLineStyle) {
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
  const candidates = ["divider", "border", "text.muted", "surface.subtle"];
  for (const tok of candidates) {
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
  const stepCount = (node.children || []).filter((child) => child.role === "process-step").length;
  if (stepCount < 2) return node;
  const minPerStep = 2.6;
  if (rect.w / stepCount >= minPerStep) return node;
  const swappedChildren = (node.children || []).map((child) => {
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
  // Vertical timeline that has less than ~1.4 cm per step needs to become a
  // horizontal grid: stacking N tall cards is impossible in such tight slots.
  if (node.type === "stack" && node.direction === "vertical") {
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
  // 761q1u: walk past trivial decorative fixedHeights (< 0.4cm). These are
  // accent rules / dividers / chip ornaments — they're visually small and
  // never the actual bottleneck. Reporting them as the constraint sends
  // agents on a wild goose chase ("relax accent.fixedHeight = 0.18cm" —
  // doing so frees 0.18cm out of a 4cm shortfall).
  const isMeaningfulConstraint = (value: number) => value >= 0.4;
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
    for (const child of slideDom.children || []) {
      const childRect = rectForSlideChild(theme, child);
      measureSubtree(theme, child, childRect, measured, rectsById);
    }
  } finally {
    currentSlideId = previous;
    ancestorStack.length = 0;
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
    const oriented = autoOrientFlow(node, rect);
    if (oriented.type === "grid") {
      // Auto-orient flipped a vertical-stack timeline to a horizontal grid.
      withAncestor(oriented, () => {
        layoutGridChildren(theme, oriented, contentRect(theme, oriented, rect)).forEach(({ node: child, rect: childRect }) => measureSubtree(theme, child, childRect, output, rectsById));
      });
      return;
    }
    withAncestor(oriented, () => {
      layoutStackChildren(theme, oriented, contentRect(theme, oriented, rect)).forEach(({ node: child, rect: childRect }) => measureSubtree(theme, child, childRect, output, rectsById));
    });
    return;
  }
  if (node.type === "grid") {
    const oriented = autoOrientFlow(node, rect);
    if (oriented.type === "stack") {
      withAncestor(oriented, () => {
        layoutStackChildren(theme, oriented, contentRect(theme, oriented, rect)).forEach(({ node: child, rect: childRect }) => measureSubtree(theme, child, childRect, output, rectsById));
      });
      return;
    }
    withAncestor(oriented, () => {
      layoutGridChildren(theme, oriented, contentRect(theme, oriented, rect)).forEach(({ node: child, rect: childRect }) => measureSubtree(theme, child, childRect, output, rectsById));
    });
    return;
  }
  if (node.type === "panel" || node.type === "card" || node.type === "band" || node.type === "frame" || node.type === "inset") {
    const inner = decorativeInnerRect(theme, node, rect);
    const child = decorativeChild(node);
    if (child) withAncestor(node, () => measureSubtree(theme, child, inner, output, rectsById));
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
  const meaningfulContainer = node.type === "stack" || node.type === "grid" || node.type === "panel" || node.type === "card" || node.type === "band" || node.type === "frame" || node.type === "inset";
  const key = `${slideId}/${node.id}`;
  if (squashedWarnings.has(key)) return;
  // An explicit fixedWidth/fixedHeight is an authoring choice — the agent has
  // told us this is the intended size. The renderer respects it and shouldn't
  // flag SQUASHED on images/icons that are deliberately small.
  const hasFixedWidth = typeof node.fixedWidth === "number" && Number.isFinite(node.fixedWidth);
  const hasFixedHeight = typeof node.fixedHeight === "number" && Number.isFinite(node.fixedHeight);
  if ((node.type === "image" || node.type === "shape") && (hasFixedWidth || hasFixedHeight)) return;
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

function toneTokens(tone: unknown): { fill?: string; line?: string; fg?: string; accent?: string } {
  if (tone === "brand") return { fill: "brand.tint", line: "brand.primary", fg: "brand.primary", accent: "brand.primary" };
  if (tone === "tinted") return { fill: "brand.tint", line: "divider", fg: "brand.primary", accent: "brand.primary" };
  if (tone === "positive") return { fill: "success.tint", line: "success", fg: "success", accent: "success" };
  if (tone === "success") return { fill: "success.tint", line: "success", fg: "success", accent: "success" };
  if (tone === "warning") return { fill: "warning.tint", line: "warning", fg: "warning", accent: "warning" };
  if (tone === "danger") return { fill: "danger.tint", line: "danger", fg: "danger", accent: "danger" };
  if (tone === "info") return { fill: "info.tint", line: "info", fg: "info", accent: "info" };
  if (tone === "neutral") return { fill: "surface", line: "divider", fg: "text.primary", accent: "brand.primary" };
  if (tone === "muted") return { fill: "surface.subtle", line: "divider", fg: "text.muted", accent: "text.muted" };
  return {};
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

function renderPanel(theme: SimpleTheme, node: DomNode, rect: Rect, rectsById: Map<string, Rect>, ids: { nextId: number }, slideId: string): ShapeList {
  const tone = toneTokens(node.tone);
  const style = theme.component.panel || {};
  const fillToken = stringProp(node, "fill", tone.fill || style.fill || "surface");
  const lineToken = stringProp(node, "line", tone.line || style.line || "divider");
  const cornerRadius = optionalNumberProp(node, "cornerRadius") ?? style.radius ?? 0.12;
  // Panels default to "flat" — they're surface containers, not raised
  // cards. Agents who want elevation pass elevation:"raised".
  const elevation = resolveElevation(node.elevation) ?? "flat";
  const shadow = shadowForElevation(theme, elevation, tone.accent);
  const padding = optionalNumberProp(node, "padding") ?? style.padding ?? 0.45;
  // Per-component border width override: agents reach for `borderWidth` /
  // `lineWidth` to make a strong frame. Numbers are in cm to stay
  // consistent with the rest of the layout vocabulary.
  const lineWidth = optionalNumberProp(node, "lineWidth") ?? optionalNumberProp(node, "borderWidth") ?? (elevation === "outlined" ? 0.04 : 0.02);
  const innerRect: Rect = { x: rect.x + padding, y: rect.y + padding, w: Math.max(0, rect.w - padding * 2), h: Math.max(0, rect.h - padding * 2) };
  const shapes: ShapeList = [{
    type: "shape",
    id: ids.nextId++,
    name: `${nodeLabel(node)}-panel`,
    preset: "roundRect",
    xfrm: xfrm(rect),
    fill: resolveFill(theme, fillToken, "surface"),
    line: elevation === "raised" || elevation === "floating"
      ? undefined
      : { color: color(theme, lineToken), width: cm(lineWidth), ...(node.dash === "dash" || node.dash === "dashDot" || node.dash === "dot" ? { dash: node.dash } : {}) },
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
  const tone = toneTokens(node.tone);
  const style = theme.component.card || {};
  const fillToken = stringProp(node, "fill", tone.fill || style.fill || "surface");
  const lineToken = stringProp(node, "line", tone.line || style.line || "divider");
  const cornerRadius = optionalNumberProp(node, "cornerRadius") ?? style.radius ?? 0.12;
  const padding = optionalNumberProp(node, "padding") ?? style.padding ?? 0.5;
  // Cards default to subtle elevation so they stand off the page; agents who
  // want a flat card pass elevation:"flat". The shadow inherits the tone's
  // accent color so brand-toned cards cast a faint colored shadow.
  const elevation = resolveElevation(node.elevation) ?? "flat";
  const shadow = shadowForElevation(theme, elevation, tone.accent);
  // Per-card border width / dash override.
  const lineWidth = optionalNumberProp(node, "lineWidth") ?? optionalNumberProp(node, "borderWidth") ?? 0.02;
  const dashToken = node.dash === "dash" || node.dash === "dashDot" || node.dash === "dot" ? node.dash : undefined;
  const accent = node.accent === "left" || node.accent === "top" ? node.accent : "none";
  // Accent color follows the tone when the agent didn't override it
  // explicitly. brand-toned cards get a brand accent bar; danger-toned
  // cards get a red one — without the agent having to spell it out.
  const accentColor = stringProp(node, "accentColor", tone.accent || "brand.primary");
  // Accent bar width — agents can thicken it with `accentWidth: 0.18`.
  const accentSize = optionalNumberProp(node, "accentWidth") ?? 0.12;
  const headerText = typeof node.header === "string" && node.header.trim() ? node.header.trim() : "";
  const footerText = typeof node.footer === "string" && node.footer.trim() ? node.footer.trim() : "";
  const shapes: ShapeList = [{
    type: "shape",
    id: ids.nextId++,
    name: `${nodeLabel(node)}-card`,
    preset: "roundRect",
    xfrm: xfrm(rect),
    fill: resolveFill(theme, fillToken, "surface"),
    line: elevation === "floating"
      ? undefined
      : { color: color(theme, lineToken), width: cm(lineWidth), ...(dashToken ? { dash: dashToken } : {}) },
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
          : toneTokens(toneRaw);
  const style = theme.component.band || {};
  const fillToken = stringProp(node, "fill", tone.fill || style.fill || "surface.subtle");
  const cornerRadius = optionalNumberProp(node, "cornerRadius") ?? style.radius ?? 0;
  // umzrkm fix: agents reach for `band` when they want a thin colored
  // divider line ({ type:"band", tone:"brand", height:0.05 }) — `height`
  // gets aliased to `fixedHeight` upstream, but the band still applied
  // the default 0.6cm padding which made a 0.05cm-tall band invisible.
  // When the band has no children AND a small fixedHeight (< 0.6cm), we
  // treat it as a divider and zero out padding so the color shows.
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const fixedH = optionalNumberProp(node, "fixedHeight");
  const isDividerBand = !hasChildren && typeof fixedH === "number" && fixedH < 0.6;
  const defaultPadding = isDividerBand ? 0 : (style.padding ?? 0.6);
  const padding = optionalNumberProp(node, "padding") ?? defaultPadding;
  // Optional agent overrides on bands.
  const lineToken = typeof node.line === "string" ? node.line : null;
  const lineWidth = optionalNumberProp(node, "lineWidth") ?? optionalNumberProp(node, "borderWidth") ?? 0;
  const dashToken = node.dash === "dash" || node.dash === "dashDot" || node.dash === "dot" ? node.dash : undefined;
  const elevation = resolveElevation(node.elevation) ?? "flat";
  const shadow = shadowForElevation(theme, elevation, tone.accent);
  const innerRect: Rect = { x: rect.x + padding, y: rect.y + padding, w: Math.max(0, rect.w - padding * 2), h: Math.max(0, rect.h - padding * 2) };
  const shapes: ShapeList = [{
    type: "shape",
    id: ids.nextId++,
    name: `${nodeLabel(node)}-band`,
    preset: cornerRadius > 0 ? "roundRect" : "rect",
    xfrm: xfrm(rect),
    fill: resolveFill(theme, fillToken, "surface.subtle"),
    cornerRadius: cornerRadius > 0 ? cornerRadius : undefined,
    line: lineToken ? { color: color(theme, lineToken), width: cm(lineWidth || 0.02), ...(dashToken ? { dash: dashToken } : {}) } : undefined,
    shadow,
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
  const cornerRadius = optionalNumberProp(node, "cornerRadius") ?? (isDividerLikeFrame ? 0 : (style.radius ?? 0.12));
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
  return [
    ...containerBackgroundShape(theme, oriented, rect, ids),
    ...layoutStackChildren(theme, oriented, contentRect(theme, oriented, rect)).flatMap(({ node: child, rect: childRect }) => {
      rectsById.set(child.id, childRect);
      return renderNode(theme, child, childRect, rectsById, ids, slideId);
    }),
  ];
}

function renderGrid(theme: SimpleTheme, node: DomNode, rect: Rect, rectsById: Map<string, Rect>, ids: { nextId: number }, slideId: string): ShapeList {
  const children = node.children || [];
  if (children.length === 0) return [];
  const oriented = autoOrientFlow(node, rect);
  if (oriented.type === "stack") return renderStack(theme, oriented, rect, rectsById, ids, slideId);
  return [
    ...containerBackgroundShape(theme, oriented, rect, ids),
    ...layoutGridChildren(theme, oriented, contentRect(theme, oriented, rect)).flatMap(({ node: child, rect: childRect }) => {
      rectsById.set(child.id, childRect);
      return renderNode(theme, child, childRect, rectsById, ids, slideId);
    }),
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
  const style = effectiveAutoFit === "shrink" ? autoShrinkStyle(theme, node, baseStyle, rect) : baseStyle;
  const paragraphs = buildParagraphs(theme, node, style);
  const autoFit = effectiveAutoFit === "shrink" || effectiveAutoFit === "resize" ? effectiveAutoFit : undefined;
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
          : [{ text, sizeHalfPt: style.fontSize * 2, bold, color: color(theme, colorToken, style.color), fontFace: containsCjk(text) ? preferredFont(theme, "cjk") : preferredFont(theme, "latin"), cjk: true }]);
    const para: Paragraph = {
      bullet: numbered
        ? { number: true as const }
        : (markerSpec ? markerSpec : { auto: true as const }),
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
  const colorToken = typeof rec.color === "string" ? rec.color : emphasis?.color;
  return {
    text,
    sizeHalfPt: style.fontSize * 2 * sizeMul,
    bold: defaultBold || resolvedWeight.bold,
    italic: rec.italic === true || marks.includes("italic") || emphasis?.italic === true,
    underline: rec.underline === true || marks.includes("underline"),
    strike: marks.includes("strikethrough"),
    baseline,
    letterSpacing: trackingPt ?? emphasis?.letterSpacing ?? style.letterSpacing,
    highlight,
    color: color(theme, colorToken, style.color),
    fontFace: fontFace.fontFace,
    cjk: fontFace.cjk,
    mono: fontFace.mono,
    hyperlink: typeof rec.link === "string" ? rec.link : undefined,
    breakLine: rec.breakLine === true,
  };
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
        const merged = { ...raw, text: maybeUppercase(raw.text, node) };
        const run = richRunToTextRun(theme, merged, effectiveStyle, baseBold);
        if (run.italic === false && node.italic === true) run.italic = true;
        if (run.underline === false && node.underline === true) run.underline = true;
        return run;
      });
    }
  }
  const face = pickRunFontFace(theme, text, style, {
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
        const merged = { ...raw, text: maybeUppercase(raw.text, node) };
        const run = richRunToTextRun(theme, merged, effectiveStyle, baseBold);
        if (run.italic === false && node.italic === true) run.italic = true;
        return run;
      });
    }
  }
  return [{
    text,
    sizeHalfPt: style.fontSize * 2,
    bold: nodeBold(node, isStyleBold(style.weight)) || emphasisBold,
    italic: node.italic === true || style.italic === true || nodeEmphasis?.italic === true,
    underline: node.underline === true,
    letterSpacing: trackingPt ?? nodeEmphasis?.letterSpacing ?? style.letterSpacing,
    color: color(theme, node.color ?? nodeEmphasis?.color, style.color),
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
      : "Split content across slides, remove a child, or increase the parent's allotted height.",
    measured: { available: availableMain, needed, deltaCm: delta },
    ...(constraint ? { constrainedBy: constraint } : {}),
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
