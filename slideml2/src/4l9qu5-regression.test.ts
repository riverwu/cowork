import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
  type LayoutDiagnostic,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Regressions for the 4l9qu5 debug log (2026-05-03 04:54).
 *
 * Issues observed and now under guard:
 *   - chrome page-number text rendered text.muted on a brand-fill cover
 *     produced 1.82:1 contrast — agent had no way to fix it from slide JSON.
 *   - Composite factories (quote source / insight-card headline / stat-strip
 *     value / step-card title / comparison-card title / profile-card name)
 *     used fixedHeight on internal text, triggering FALLBACK_FAILED with
 *     constrainedBy pointing inside the component. Each is now minHeight +
 *     autoFit:"shrink".
 *   - patch_deck used to throw on op:"replace" against a missing key. The
 *     electron handler now soft-creates the key and intermediate parents.
 */

const baseDeckHeader = { size: "16x9" as const, theme: "default", brand: { name: "Test", primary: "B8860B" } };

function deckWith(slides: SlideV2[], themeOverride?: Slideml2SourceDeck["deck"]["themeOverride"]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { ...baseDeckHeader, themeOverride },
    slides,
  };
}

function renderAndCollect(deck: Slideml2SourceDeck): LayoutDiagnostic[] {
  clearRenderDiagnostics();
  renderToAst(sourceToRenderedDeck(deck));
  return getRenderDiagnostics();
}

describe("chrome page-number contrast (4l9qu5)", () => {
  it("brand-fill cover slide: page-number does not flag LOW_CONTRAST", () => {
    const slide: SlideV2 = {
      id: "cover",
      background: { fill: "brand.primary" } as unknown as SlideV2["background"],
      children: [{ id: "cover.title", type: "deck-title", text: "封面", color: "text.inverse" } as unknown as DomNode],
    };
    const diags = renderAndCollect(deckWith([slide], { chrome: { pageNumber: true } }));
    const chromeIssues = diags.filter((d) => d.code === "LOW_CONTRAST" && /chrome\.page/.test(String(d.nodeId || "")));
    expect(chromeIssues, chromeIssues.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("dark slide: page-number picks a contrasting fg automatically", () => {
    const slide: SlideV2 = {
      id: "dark",
      background: { fill: "111827" } as unknown as SlideV2["background"],
      children: [{ id: "dark.title", type: "deck-title", text: "暗色封面", color: "text.inverse" } as unknown as DomNode],
    };
    const diags = renderAndCollect(deckWith([slide], { chrome: { pageNumber: true } }));
    const chromeIssues = diags.filter((d) => d.code === "LOW_CONTRAST" && /chrome\.page/.test(String(d.nodeId || "")));
    expect(chromeIssues, chromeIssues.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("page-number picks contrast against a footer band, not only the slide background", () => {
    const slide: SlideV2 = {
      id: "closing",
      children: [{
        id: "closing.band",
        type: "band",
        tone: "brand",
        area: "content",
        fill: "success",
        children: [{ id: "closing.t", type: "text", text: "感谢聆听", color: "text.inverse" }],
      } as unknown as DomNode],
    };
    const diags = renderAndCollect(deckWith([slide], {
      colors: { success: "27AE60", text: { secondary: "4A6274" } },
      chrome: { pageNumber: true },
    }));
    const chromeIssues = diags.filter((d) => d.code === "LOW_CONTRAST" && /chrome\.page/.test(String(d.nodeId || "")));
    expect(chromeIssues, chromeIssues.map((d) => d.message).join("\n")).toHaveLength(0);
  });
});

describe("composite factory minHeight conversions (4l9qu5)", () => {
  it("quoteBlock source: tight slot does not FALLBACK_FAILED on the source line", () => {
    const slide: SlideV2 = {
      id: "q",
      children: [{
        id: "q.frame",
        type: "stack",
        direction: "vertical",
        gap: 0.2,
        area: "content",
        // Two quotes side by side make the source text squeeze; minHeight
        // (instead of fixedHeight 0.6) lets autoFit absorb it.
        children: [
          { id: "q.frame.q1", type: "quote", text: "短句一", source: "出处一" } as unknown as DomNode,
          { id: "q.frame.q2", type: "quote", text: "短句二", source: "出处二" } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    };
    const diags = renderAndCollect(deckWith([slide]));
    const fallback = diags.filter((d) => d.code === "FALLBACK_FAILED" && d.constrainedBy?.prop === "fixedHeight" && /\.source$/.test(String(d.constrainedBy?.ancestorId || "")));
    expect(fallback, fallback.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("stat-strip value no longer triggers FALLBACK_FAILED with constrainedBy on the value's fixedHeight", () => {
    const slide: SlideV2 = {
      id: "ss",
      children: [{
        id: "ss.tight",
        type: "panel",
        fixedHeight: 2.6,
        children: [{
          id: "ss.tight.body",
          type: "stat-strip",
          tone: "brand",
          items: [
            { value: "5464公里", label: "黄河全长" },
            { value: "6300公里", label: "长江全长" },
            { value: "5000+年", label: "文明历史" },
          ],
        } as unknown as DomNode],
      } as unknown as DomNode],
    };
    const diags = renderAndCollect(deckWith([slide]));
    const valueConstrained = diags.filter((d) => d.code === "FALLBACK_FAILED" && /\.value$/.test(String(d.constrainedBy?.ancestorId || "")));
    expect(valueConstrained, valueConstrained.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("comparison-card title in 3-col grid: no FALLBACK pointing at title.fixedHeight", () => {
    const slide: SlideV2 = {
      id: "cmp",
      title: "对比",
      children: [{
        id: "cmp.grid",
        type: "grid",
        columns: 3,
        gap: 0.4,
        area: "content",
        children: Array.from({ length: 3 }, (_, i) => ({
          id: `cmp.grid.${i}`,
          type: "comparison-card",
          title: `项目 ${i + 1}`,
          points: ["要点一", "要点二", "要点三", "要点四"],
        } as unknown as DomNode)),
      } as unknown as DomNode],
    };
    const diags = renderAndCollect(deckWith([slide]));
    const titleHit = diags.filter((d) => d.code === "FALLBACK_FAILED" && /\.title$/.test(String(d.constrainedBy?.ancestorId || "")));
    expect(titleHit, titleHit.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("insight-card headline: tight slot doesn't FALLBACK on headline.fixedHeight", () => {
    const slide: SlideV2 = {
      id: "ic",
      children: [{
        id: "ic.tight",
        type: "panel",
        fixedHeight: 4.0,
        children: [{
          id: "ic.tight.body",
          type: "insight-card",
          headline: "核心判断：双河文明并行发展",
          detail: "黄河与长江流域共同构成中华文明的两大支柱",
          bullets: ["要点1", "要点2", "要点3"],
        } as unknown as DomNode],
      } as unknown as DomNode],
    };
    const diags = renderAndCollect(deckWith([slide]));
    const headlineHit = diags.filter((d) => d.code === "FALLBACK_FAILED" && /\.headline$/.test(String(d.constrainedBy?.ancestorId || "")));
    expect(headlineHit, headlineHit.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("step-card and profile-card titles in dense grids: no fixedHeight FALLBACK", () => {
    const slide: SlideV2 = {
      id: "dense",
      children: [{
        id: "dense.grid",
        type: "grid",
        columns: 4,
        gap: 0.3,
        area: "content",
        children: [
          ...Array.from({ length: 2 }, (_, i) => ({
            id: `dense.grid.s${i}`,
            type: "step-card",
            step: `0${i + 1}`,
            title: `步骤 ${i + 1}`,
            body: "短描述",
          } as unknown as DomNode)),
          ...Array.from({ length: 2 }, (_, i) => ({
            id: `dense.grid.p${i}`,
            type: "profile-card",
            image: "data:image/svg+xml;base64,PHN2Zy8+",
            name: `人物 ${i + 1}`,
            role: "工程师",
            bio: "短简介",
          } as unknown as DomNode)),
        ],
      } as unknown as DomNode],
    };
    const diags = renderAndCollect(deckWith([slide]));
    const fixedHeightHits = diags.filter((d) =>
      d.code === "FALLBACK_FAILED" &&
      d.constrainedBy &&
      ["fixedHeight"].includes(d.constrainedBy.prop) &&
      /\.(title|name|step|role)$/.test(String(d.constrainedBy.ancestorId || ""))
    );
    expect(fixedHeightHits, fixedHeightHits.map((d) => d.message).join("\n")).toHaveLength(0);
  });
});

describe("auto-fix LOW_CONTRAST when fg matches surface exactly (4l9qu5)", () => {
  it("rewrites brand.primary text on brand.primary fill to a contrasting hex", () => {
    const slide: SlideV2 = {
      id: "collide",
      children: [{
        id: "collide.band",
        type: "band",
        fill: "brand.primary",
        height: 4,
        children: [{
          id: "collide.band.t",
          type: "text",
          text: "5464公里",
          style: "metric-value",
          color: "brand.primary",
        }],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deckWith([slide])));
    const textShape = ast.slides[0]!.shapes.find((s) => s.type === "text" && s.name === "collide.band.t");
    if (textShape && textShape.type === "text") {
      const runColor = textShape.paragraphs?.[0]?.runs?.[0]?.color || "";
      // The auto-fix should kick in: original brand.primary B8860B on B8860B
      // is invisible (1:1). After fix the run color is black or white.
      expect(runColor).toMatch(/^(111827|FFFFFF)$/);
    }
    const diags = getRenderDiagnostics();
    // Either LOW_CONTRAST (when auto-fix didn't fully cover the cluster) or
    // LOW_CONTRAST_FIXED (when it did) is acceptable — both report the issue
    // to the agent. The contract is: the diagnostic was emitted AND the
    // rendered run color is no longer the colliding hex.
    const reported = diags.filter((d) => (d.code === "LOW_CONTRAST" || d.code === "LOW_CONTRAST_FIXED") && d.nodeId === "collide.band.t");
    expect(reported.length).toBeGreaterThanOrEqual(1);
    expect(String(reported[0]?.message || "")).toMatch(/auto-fixed/i);
  });

  it("does NOT rewrite custom user accent colors that just happen to fall short", () => {
    const slide: SlideV2 = {
      id: "custom",
      children: [{
        id: "custom.t",
        type: "text",
        text: "强调标题",
        style: "card-title",
        color: "FF6B6B",
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deckWith([slide])));
    const textShape = ast.slides[0]!.shapes.find((s) => s.type === "text" && s.name === "custom.t");
    if (textShape && textShape.type === "text") {
      const runColor = textShape.paragraphs?.[0]?.runs?.[0]?.color || "";
      expect(runColor).toBe("FF6B6B");
    }
  });
});
