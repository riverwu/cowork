import { describe, expect, it } from "vitest";
import { clearRenderDiagnostics, getDiagnosticsByCode } from "./diagnostics.js";
import { measureDeck, renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";
import { validateDeck } from "./validate.js";

/**
 * Regressions for 2026-05-07T08-39-17-254-htdnvr:
 * - agent set contentTop inside the title band, so later card backgrounds
 *   covered every slide title;
 * - contentBottom was too low for page-number chrome, so source notes
 *   collided with page numbers;
 * - validate_render returned ok:true despite the visible title occlusion.
 */

function deckWith(slides: SlideV2[], themeOverride?: Slideml2SourceDeck["deck"]["themeOverride"], chrome?: Slideml2SourceDeck["deck"]["chrome"]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: "default",
      brand: { name: "Office", primary: "2563EB" },
      themeOverride,
      chrome,
    },
    slides,
  };
}

const basicSlide: SlideV2 = {
  id: "s",
  title: "一句话核心结论",
  children: [{
    id: "s.kt",
    type: "key-takeaway",
    headline: "最高赔率 = 三条已被验证的路径",
    detail: "港股IPO候选、私有化Agent中台、Day 1海外架构。",
    tone: "brand",
  } as unknown as DomNode],
};

describe("title/content vertical rhythm guard (htdnvr)", () => {
  it("rejects themeOverride layout that starts content inside the title region", () => {
    const deck = deckWith([basicSlide], {
      layout: {
        titleTop: 0.3,
        contentTop: 1.1,
        contentBottom: 14.0,
      },
    }, { pageNumber: true });

    const validation = validateDeck(deck);
    expect(validation.ok).toBe(false);
    expect(validation.errors.map((e) => e.code)).toEqual(expect.arrayContaining([
      "THEME_LAYOUT_TITLE_OVERLAP",
      "THEME_LAYOUT_FOOTER_OVERLAP",
    ]));
  });

  it("renderer clamps legacy content rect below the title and footer chrome", () => {
    const deck = deckWith([{
      ...basicSlide,
      children: [
        ...(basicSlide.children || []),
        { id: "s.src", type: "source-note", text: "数据来源：上市公司财报、QuestMobile、国家发改委" } as unknown as DomNode,
      ],
    }], {
      layout: {
        titleTop: 0.3,
        contentTop: 1.1,
        contentBottom: 14.0,
      },
    }, { pageNumber: true });

    const rendered = sourceToRenderedDeck(deck);
    const measured = measureDeck(rendered)[0]!.nodes;
    const content = measured.find((node) => node.id === "s.content")!;
    expect(content.rect.y).toBeGreaterThanOrEqual(2.0);
    expect(content.rect.y + content.rect.h).toBeLessThanOrEqual(13.55);

    clearRenderDiagnostics();
    renderToAst(rendered);
    expect(getDiagnosticsByCode("TITLE_OCCLUDED")).toHaveLength(0);
  });

  it("reports TITLE_OCCLUDED when a later absolute fill covers the slide title", () => {
    const deck = deckWith([{
      id: "cover",
      title: "被遮挡的标题",
      children: [{
        id: "cover.bad-fill",
        type: "shape",
        preset: "rect",
        fill: "surface",
        at: [0.5, 1.0, 24.4, 2.0],
      } as unknown as DomNode],
    }]);

    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck));
    const hits = getDiagnosticsByCode("TITLE_OCCLUDED");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("error");
  });

});
