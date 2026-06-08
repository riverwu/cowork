import { describe, expect, it } from "vitest";
import { clearRenderDiagnostics, getRenderDiagnostics } from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

function buildDeck(slide: SlideV2): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { name: "Test", primary: "2563EB" } },
    slides: [slide],
  };
}

function renderSlide(slide: SlideV2) {
  clearRenderDiagnostics();
  const rendered = sourceToRenderedDeck(buildDeck(slide));
  renderToAst(rendered);
  return { diagnostics: getRenderDiagnostics() };
}

describe("slide budget audit (M5.3 + M5.4)", () => {
  it("one loud component → no warning", () => {
    const { diagnostics } = renderSlide({
      id: "sba-single",
      children: [{
        id: "sba-single.k",
        type: "key-takeaway",
        variant: "panel",
        headline: "结论",
        detail: "支撑",
        tone: "brand",
      } as unknown as DomNode],
    });
    expect(diagnostics.filter((d) => d.code === "CHROME_BUDGET_EXCEEDED")).toEqual([]);
    expect(diagnostics.filter((d) => d.code === "CHROMATIC_BUDGET_EXCEEDED")).toEqual([]);
  });

  it("two loud components → CHROME_BUDGET_EXCEEDED warning", () => {
    const { diagnostics } = renderSlide({
      id: "sba-two-loud",
      children: [
        {
          id: "sba-two-loud.a",
          type: "key-takeaway",
          variant: "panel",
          headline: "结论 A",
          tone: "brand",
        },
        {
          id: "sba-two-loud.b",
          type: "key-takeaway",
          variant: "panel",
          headline: "结论 B",
          tone: "brand",
        },
      ] as unknown as DomNode[],
    });
    const warning = diagnostics.find((d) => d.code === "CHROME_BUDGET_EXCEEDED");
    expect(warning).toBeDefined();
  });

  it("two distinct chromatic tones → CHROMATIC_BUDGET_EXCEEDED warning", () => {
    const { diagnostics } = renderSlide({
      id: "sba-two-chroma",
      children: [
        {
          id: "sba-two-chroma.a",
          type: "key-takeaway",
          variant: "panel",
          headline: "正向",
          tone: "positive",
        },
        {
          id: "sba-two-chroma.b",
          type: "key-takeaway",
          variant: "panel",
          headline: "警示",
          tone: "warning",
        },
      ] as unknown as DomNode[],
    });
    const warning = diagnostics.find((d) => d.code === "CHROMATIC_BUDGET_EXCEEDED");
    expect(warning).toBeDefined();
  });

  it("two minimal-variant takeaways with the same tone → no warning (single chromatic family)", () => {
    const { diagnostics } = renderSlide({
      id: "sba-minimal-pair",
      children: [
        {
          id: "sba-minimal-pair.a",
          type: "key-takeaway",
          variant: "minimal",
          headline: "第一",
          tone: "brand",
        },
        {
          id: "sba-minimal-pair.b",
          type: "key-takeaway",
          variant: "minimal",
          headline: "第二",
          tone: "brand",
        },
      ] as unknown as DomNode[],
    });
    // Minimal variant emits no surface fill; same tone means the slide carries
    // ONE chromatic family (brand) — under the contract budget.
    expect(diagnostics.filter((d) => d.code === "CHROMATIC_BUDGET_EXCEEDED")).toEqual([]);
  });

  it("two minimal-variant takeaways with DIFFERENT tones → still no warning (DESIGN.md §2.5 — rails are decoration, not chromatic surface)", () => {
    const { diagnostics } = renderSlide({
      id: "sba-minimal-diff",
      children: [
        {
          id: "sba-minimal-diff.a",
          type: "key-takeaway",
          variant: "minimal",
          headline: "第一",
          tone: "positive",
        },
        {
          id: "sba-minimal-diff.b",
          type: "key-takeaway",
          variant: "minimal",
          headline: "第二",
          tone: "warning",
        },
      ] as unknown as DomNode[],
    });
    // The minimal variant's tone shows up only on a decorative rail shape, not
    // a container surface. Per DESIGN.md §2.5, tone is allowed on rail / accent
    // / icon / kicker without spending the slide's chromatic-moment budget.
    expect(diagnostics.filter((d) => d.code === "CHROMATIC_BUDGET_EXCEEDED")).toEqual([]);
  });
});
