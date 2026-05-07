import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Regressions for visibility-loss bugs in render output.
 *
 * 437sxs log: agent set slide.background = "1A365D" (deep navy) and
 * inside the slide a 0.06cm-tall accent rule
 * `{type:"shape", fill:"brand.primary"}` where brand.primary also
 * resolved to 1A365D — the rule was completely invisible.
 *
 * The contrast check existed for text but didn't cover non-text shapes;
 * this suite locks in the new SHAPE_INVISIBLE detection + auto-promote.
 */

function deck(slides: SlideV2[], themeOverride?: Record<string, unknown>): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: "default",
      brand: { primary: "1A365D" },
      ...(themeOverride ? { themeOverride: themeOverride as never } : {}),
    },
    slides,
  };
}

function findByName(shapes: Array<{ name?: string }>, suffix: string) {
  return shapes.find((s) => typeof s.name === "string" && s.name.endsWith(suffix));
}

describe("SHAPE_INVISIBLE detection on decorative shapes", () => {
  it("an accent rule with fill=brand.primary on bg=brand.primary auto-promotes to a contrasting accent", () => {
    const slide: SlideV2 = {
      id: "cover",
      background: "brand.primary",
      children: [
        { id: "cover.title", type: "text", text: "TOEFL iBT", style: "deck-title", color: "text.inverse" },
        {
          id: "cover.rule",
          type: "shape",
          preset: "rect",
          fill: "brand.primary",
          line: "brand.primary",
          fixedWidth: 3.5,
          fixedHeight: 0.06,
        },
      ],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck([slide], {
      colors: { background: "FAFAF7", accent1: "F4A261", accent2: "8DC9B7" },
    })));
    const rule = findByName(ast.slides[0].shapes as Array<{ name?: string; fill?: { color?: string } }>, "cover.rule") as { fill?: { color?: string } } | undefined;
    expect(rule).toBeDefined();
    // fill should NOT still be brand.primary (1A365D) — should have been promoted
    expect(rule!.fill?.color?.toUpperCase()).not.toBe("1A365D");
    // Diagnostic should reflect the auto-fix
    const diag = getRenderDiagnostics().find((d) => d.code === "SHAPE_INVISIBLE_FIXED" && d.nodeId?.includes("cover.rule"));
    expect(diag).toBeDefined();
  });

  it("a small dot with fill matching slide bg gets promoted (not just diagnosed)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.dot",
        type: "shape",
        preset: "ellipse",
        fill: "FAFAF7", // same as default bg
        line: "FAFAF7",
        fixedWidth: 0.3,
        fixedHeight: 0.3,
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide], { colors: { background: "FAFAF7" } })));
    const fixed = getRenderDiagnostics().filter((d) => d.code === "SHAPE_INVISIBLE_FIXED");
    expect(fixed.length).toBeGreaterThan(0);
  });

  it("a large invisible card (fill matches surface) is auto-fixed by adding a contrasting border", () => {
    // Cards have inner content that disambiguates them; we don't repaint
    // the fill, but we DO add a thin divider border so the card has a
    // visible boundary. (96vi8n log: 8 metric-card / table-card backings
    // were SHAPE_INVISIBLE on F8FAFC and looked merged with the slide.)
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.bigblob",
        type: "shape",
        preset: "rect",
        fill: "FAFAF7",
        line: "FAFAF7",
        fixedWidth: 12,
        fixedHeight: 5,
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck([slide], { colors: { background: "FAFAF7" } })));
    const diags = getRenderDiagnostics();
    const fixedHits = diags.filter((d) => d.code === "SHAPE_INVISIBLE_FIXED");
    expect(fixedHits.length).toBeGreaterThan(0);
    // Fill is unchanged; only line was added.
    const card = ast.slides[0].shapes.find((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith("s.bigblob")) as
      | { fill?: { color?: string }; line?: { color?: string } } | undefined;
    expect(card?.fill?.color?.toUpperCase()).toBe("FAFAF7");
    expect(card?.line?.color?.toUpperCase()).toBe("DDE3EC");
  });

  it("a card with an intentional divider border is not promoted to dark muted text color", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.dividerCard",
        type: "shape",
        preset: "rect",
        fill: "FAFAF7",
        line: "divider",
        fixedWidth: 12,
        fixedHeight: 5,
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck([slide], { colors: { background: "FAFAF7" } })));
    const fixedHits = getRenderDiagnostics().filter((d) => d.code === "SHAPE_INVISIBLE_FIXED" && String(d.nodeId || "").includes("s.dividerCard"));
    expect(fixedHits).toHaveLength(0);
    const card = ast.slides[0].shapes.find((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith("s.dividerCard")) as
      | { line?: { color?: string } } | undefined;
    expect(card?.line?.color?.toUpperCase()).toBe("DDE3EC");
  });

  it("a raised large card with the default divider border is not promoted to a dark border", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.raised",
        type: "card",
        fill: "FAFAF7",
        elevation: "raised",
        children: [{ id: "s.raised.t", type: "text", text: "Card text" }],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck([slide], { colors: { background: "FAFAF7" } })));
    const fixedHits = getRenderDiagnostics().filter((d) => d.code === "SHAPE_INVISIBLE_FIXED" && String(d.nodeId || "").includes("s.raised"));
    expect(fixedHits).toHaveLength(0);
    const card = ast.slides[0].shapes.find((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.includes("s.raised-card")) as
      | { line?: { color?: string } } | undefined;
    expect(card?.line?.color?.toUpperCase()).toBe("DDE3EC");
  });

  it("a shape with a contrasting border (line) is not flagged as invisible", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.outlined",
        type: "shape",
        preset: "rect",
        fill: "FAFAF7",            // matches bg
        line: "1A365D",             // strong contrast border
        lineWidth: 0.05,
        fixedWidth: 4,
        fixedHeight: 0.4,
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide], { colors: { background: "FAFAF7" } })));
    const diags = getRenderDiagnostics();
    const hits = diags.filter((d) => d.code === "SHAPE_INVISIBLE" || d.code === "SHAPE_INVISIBLE_FIXED");
    expect(hits.length).toBe(0);
  });

  it("a shape with fill clearly contrasting the surface is not flagged", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.bar",
        type: "shape",
        preset: "rect",
        fill: "1A365D",
        fixedWidth: 4,
        fixedHeight: 0.06,
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide], { colors: { background: "FAFAF7" } })));
    const diags = getRenderDiagnostics();
    const hits = diags.filter((d) => d.code === "SHAPE_INVISIBLE" || d.code === "SHAPE_INVISIBLE_FIXED");
    expect(hits.length).toBe(0);
  });
});

describe("intent-preserving contrast auto-fix for emphasis tokens", () => {
  it("an eyebrow set to brand.primary on a brand.primary background is promoted to a sibling accent (not collapsed to plain inverse)", () => {
    // Mimics the 437sxs cover slide: eyebrow color was brand.primary,
    // background was brand.primary. Old auto-fix would replace with
    // text.inverse (white). New behavior: prefer a sibling accent in
    // the theme (accent1, accent2) so the "color pop" intent survives.
    const slide: SlideV2 = {
      id: "cover",
      background: "brand.primary",
      children: [
        {
          id: "cover.eyebrow",
          type: "text",
          text: "EXAMINATION GUIDE",
          style: "label",
          color: "brand.primary",
        },
        {
          id: "cover.title",
          type: "text",
          text: "TOEFL iBT",
          style: "deck-title",
          color: "text.inverse",
        },
      ],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck([slide], {
      colors: { background: "FAFAF7", accent1: "F4A261", accent2: "8DC9B7" },
    })));
    const eyebrow = findByName(ast.slides[0].shapes as Array<{ name?: string }>, "cover.eyebrow") as { paragraphs?: Array<{ runs: Array<{ color?: string }> }> } | undefined;
    expect(eyebrow).toBeDefined();
    const fixedColor = eyebrow!.paragraphs?.[0]?.runs[0]?.color?.toUpperCase();
    expect(fixedColor).toBeDefined();
    // Must contrast with brand.primary background
    expect(fixedColor).not.toBe("1A365D");
    // Should NOT be plain white (text.inverse default) — should be one of
    // the agent-defined chromatic accents (F4A261 / 8DC9B7), not the
    // near-white brand.tint EEF2FF.
    expect(["F4A261", "8DC9B7"]).toContain(fixedColor);
  });

  it("a regular text node (no accent intent) still falls back to plain inverse", () => {
    // text.primary on dark bg → no accent intent → use plain inverse.
    const slide: SlideV2 = {
      id: "cover",
      background: "1A365D",
      children: [
        { id: "cover.body", type: "text", text: "Body content", style: "paragraph", color: "text.primary" },
      ],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const body = findByName(ast.slides[0].shapes as Array<{ name?: string }>, "cover.body") as { paragraphs?: Array<{ runs: Array<{ color?: string }> }> } | undefined;
    const fixedColor = body!.paragraphs?.[0]?.runs[0]?.color?.toUpperCase();
    // Should be a near-white fallback (text.inverse / FFFFFF / similar).
    expect(["FFFFFF", "FAFAF7"]).toContain(fixedColor);
  });
});
