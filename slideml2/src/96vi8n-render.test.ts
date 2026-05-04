import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * 96vi8n log regressions. Final rendered deck had two recurring defects:
 *   1. section-break: agent passed accent:"brand" intending the tone /
 *      color, got rendered as the literal eyebrow text "brand" on every
 *      section divider slide (5 instances).
 *   2. SHAPE_INVISIBLE warnings on metric-card / table-card backings —
 *      cards had fill #FFFFFF on slide bg #F8FAFC (1.05:1 contrast).
 *      The warnings fired but the cards stayed invisible.
 */

function deck(slides: SlideV2[], themeOverride?: Record<string, unknown>): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: "default",
      brand: { primary: "6366F1" },
      ...(themeOverride ? { themeOverride: themeOverride as never } : {}),
    },
    slides,
  };
}

describe("section-break: tone-keyword passed as `accent` is silently ignored", () => {
  function eyebrowText(slide: SlideV2): string | undefined {
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const eyebrow = ast.slides[0].shapes.find((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(".accent")) as
      | { paragraphs?: Array<{ runs: Array<{ text?: string }> }> } | undefined;
    return eyebrow?.paragraphs?.[0]?.runs[0]?.text;
  }

  it("accent='brand' does NOT render the literal word 'brand' as eyebrow", () => {
    const slide: SlideV2 = {
      id: "section1",
      children: [{ id: "s1.break", type: "section-break", title: "01", subtitle: "Topic", accent: "brand" } as never],
    };
    expect(eyebrowText(slide)).toBeUndefined();
  });

  it.each([
    ["primary"], ["neutral"], ["positive"], ["danger"], ["warning"],
    ["success"], ["error"], ["caution"], ["muted"], ["inverse"],
    ["color"], ["tone"], ["secondary"], ["tertiary"],
  ])("accent='%s' (a tone keyword) is silently ignored", (kw) => {
    const slide: SlideV2 = {
      id: "s",
      children: [{ id: "s.break", type: "section-break", title: "01", subtitle: "T", accent: kw } as never],
    };
    expect(eyebrowText(slide)).toBeUndefined();
  });

  it("a real eyebrow string ('PART ONE') still renders normally", () => {
    const slide: SlideV2 = {
      id: "s",
      children: [{ id: "s.break", type: "section-break", title: "01", subtitle: "T", accent: "PART ONE" } as never],
    };
    expect(eyebrowText(slide)).toBe("PART ONE");
  });

  it("tone:'neutral' colors the rule with the divider gray", () => {
    const slide: SlideV2 = {
      id: "s",
      children: [{ id: "s.break", type: "section-break", title: "01", tone: "neutral" } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const rule = ast.slides[0].shapes.find((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(".rule")) as
      | { fill?: { color?: string } } | undefined;
    expect(rule?.fill?.color?.toUpperCase()).not.toBe("6366F1"); // not brand
  });
});

describe("SHAPE_INVISIBLE auto-border on white-on-near-white card backings", () => {
  it("a large fill-matches-surface card gets a divider border (instead of just warning)", () => {
    // Mimics the 96vi8n setup: bg = F8FAFC, surface = FFFFFF.
    const slide: SlideV2 = {
      id: "s",
      children: [{
        id: "s.kpi",
        type: "card",
        fill: "FFFFFF",
        elevation: "flat",
        children: [{ id: "s.kpi.v", type: "text", text: "78%" }, { id: "s.kpi.l", type: "text", text: "label" }],
      } as never],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck([slide], {
      colors: { background: "F8FAFC", surface: "FFFFFF" },
    })));
    const fixed = getRenderDiagnostics().filter((d) => d.code === "SHAPE_INVISIBLE_FIXED");
    expect(fixed.length).toBeGreaterThan(0);
    // The auto-border should sit on the card-backing shape.
    const cardShape = ast.slides[0].shapes.find((s) =>
      typeof (s as { name?: string }).name === "string" &&
      (s as { name: string }).name.endsWith("-card")
    ) as { line?: { color?: string }; fill?: { color?: string } } | undefined;
    expect(cardShape?.line?.color).toBeDefined();
    // Fill stays the agent's choice (white).
    expect(cardShape?.fill?.color?.toUpperCase()).toBe("FFFFFF");
  });

  it("a card with elevation:'floating' (shadow) is NOT given an auto-border", () => {
    // Floating cards use shadow as their distinguishing visual; an
    // auto-border would override the design language.
    const slide: SlideV2 = {
      id: "s",
      children: [{
        id: "s.card",
        type: "card",
        fill: "FFFFFF",
        elevation: "floating",
        children: [{ id: "s.card.v", type: "text", text: "x" }, { id: "s.card.l", type: "text", text: "y" }],
      } as never],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck([slide], {
      colors: { background: "F8FAFC", surface: "FFFFFF" },
    })));
    const card = ast.slides[0].shapes.find((s) =>
      typeof (s as { name?: string }).name === "string" &&
      (s as { name: string }).name.endsWith("-card")
    ) as { line?: { color?: string }; shadow?: unknown } | undefined;
    // floating elevation supplies a shadow that gives the card a visible
    // boundary; the auto-border path must not run.
    expect(card?.shadow).toBeDefined();
    expect(card?.line).toBeUndefined();
  });
});
