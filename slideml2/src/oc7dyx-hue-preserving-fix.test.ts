import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * oc7dyx log: agent's brand.primary = 6366F1 (purple) had 4.47:1 vs
 * white — just below WCAG AA 4.5. The contrast auto-fix promoted EVERY
 * occurrence to the default brand blue 2563EB, silently swapping the
 * agent's brand color across 69 text instances.
 *
 * New behavior: when the failing color has ≥ 2:1 contrast against bg
 * (i.e. borderline rather than invisible), the auto-fix tries a darker
 * shade of the SAME hue first. The agent's purple stays purple.
 */

function deck(slide: SlideV2, themeOverride?: Record<string, unknown>): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: "default",
      brand: { primary: "6366F1" },
      ...(themeOverride ? { themeOverride: themeOverride as never } : {}),
    },
    slides: [slide],
  };
}

function findText(ast: { slides: Array<{ shapes: Array<{ name?: string }> }> }, suffix: string) {
  return ast.slides[0].shapes.find((s) => typeof s.name === "string" && s.name.endsWith(suffix)) as
    | { paragraphs?: Array<{ runs: Array<{ color?: string }> }> } | undefined;
}

function chroma(hex: string): number {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function dominantChannel(hex: string): "r" | "g" | "b" {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (r >= g && r >= b) return "r";
  if (g >= r && g >= b) return "g";
  return "b";
}

describe("oc7dyx — hue-preserving contrast auto-fix", () => {
  it("brand.primary 6366F1 (purple) on white auto-fixes to a darker PURPLE, not the default blue", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.eyebrow",
        type: "text",
        text: "MARCH 2026",
        style: "label",
        color: "brand.primary",
      } as never],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck(slide, {
      colors: { background: "FFFFFF", "brand.primary": "6366F1" },
    })));
    const eyebrow = findText(ast, "s.eyebrow");
    expect(eyebrow).toBeDefined();
    const fixed = eyebrow!.paragraphs?.[0]?.runs[0]?.color?.toUpperCase();
    expect(fixed).toBeDefined();
    // Should NOT be the original (failed contrast).
    expect(fixed).not.toBe("6366F1");
    // Should NOT be the default brand blue (2563EB) — that's what the
    // old sibling-accent fallback would have picked. Should be a
    // darker purple variant.
    expect(fixed).not.toBe("2563EB");
    // Hue check: purple 6366F1 has dominant blue channel and high
    // chroma. The fixed color should also lean blue (still in the
    // blue/purple family).
    expect(dominantChannel(fixed!)).toBe("b");
    expect(chroma(fixed!)).toBeGreaterThan(40);
    // Diagnostic still emitted.
    const fixes = getRenderDiagnostics().filter((d) => d.code === "LOW_CONTRAST_FIXED");
    expect(fixes.length).toBeGreaterThan(0);
  });

  it("warning E67E22 (orange) borderline on white auto-fixes to a darker ORANGE, not a non-orange accent", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.note",
        type: "text",
        text: "Caution",
        style: "label",
        color: "warning",
      } as never],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck(slide, {
      colors: { background: "FFFFFF", warning: "E67E22" },
    })));
    const note = findText(ast, "s.note");
    const fixed = note!.paragraphs?.[0]?.runs[0]?.color?.toUpperCase();
    expect(fixed).toBeDefined();
    expect(fixed).not.toBe("E67E22");
    // Should still be orange-ish (R dominant, R > G > B).
    const r = parseInt(fixed!.slice(0, 2), 16);
    const g = parseInt(fixed!.slice(2, 4), 16);
    const b = parseInt(fixed!.slice(4, 6), 16);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it("when fg matches bg exactly (1:1) the hue-preserving path is skipped, sibling-accent fallback is used", () => {
    // 437sxs / earlier regression: brand-on-brand text → must collapse
    // to a sibling chromatic accent, not an unrecognizable shaded mix.
    const slide: SlideV2 = {
      id: "cover",
      background: "brand.primary",
      children: [{
        id: "cover.eyebrow",
        type: "text",
        text: "EXAMINATION GUIDE",
        style: "label",
        color: "brand.primary",
      } as never],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck(slide, {
      colors: { background: "FAFAF7", "brand.primary": "1A365D", accent1: "F4A261", accent2: "8DC9B7" },
    })));
    const eyebrow = findText(ast, "cover.eyebrow");
    const fixed = eyebrow!.paragraphs?.[0]?.runs[0]?.color?.toUpperCase();
    // Should pick one of the sibling accents — not stay brand-derived.
    expect(["F4A261", "8DC9B7"]).toContain(fixed);
  });
});
