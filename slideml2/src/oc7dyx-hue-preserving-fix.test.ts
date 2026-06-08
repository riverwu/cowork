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
 * white — just below WCAG AA 4.5. The old contrast auto-fix promoted EVERY
 * occurrence to another color, silently swapping the agent's brand color.
 *
 * New behavior: borderline-but-readable brand/accent text stays exactly as
 * authored and reports only a warning; auto-fix is reserved for unreadable
 * same/near-same color failures.
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

describe("oc7dyx — hue-preserving contrast auto-fix", () => {
  it("brand.primary 6366F1 (purple) on white stays authored when readable", () => {
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
    const rendered = eyebrow!.paragraphs?.[0]?.runs[0]?.color?.toUpperCase();
    expect(rendered).toBe("6366F1");
    const warnings = getRenderDiagnostics().filter((d) => d.code === "LOW_CONTRAST" && d.severity === "warn");
    expect(warnings.length).toBeGreaterThan(0);
    const fixes = getRenderDiagnostics().filter((d) => d.code === "LOW_CONTRAST_FIXED");
    expect(fixes).toHaveLength(0);
  });

  it("warning E67E22 (orange) borderline on white stays authored when readable", () => {
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
    const rendered = note!.paragraphs?.[0]?.runs[0]?.color?.toUpperCase();
    expect(rendered).toBe("E67E22");
    const warnings = getRenderDiagnostics().filter((d) => d.code === "LOW_CONTRAST" && d.severity === "warn");
    expect(warnings.length).toBeGreaterThan(0);
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
