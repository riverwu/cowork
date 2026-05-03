import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
  type LayoutDiagnostic,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { buildTheme, color, parseCssColor, resolveFill } from "./theme.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Regressions for the inmuai debug log (2026-05-03 04:26 run).
 * Each test pins one issue surfaced when the agent failed to author timelines,
 * misused CSS color shorthand, or hit FALLBACK_FAILED at sub-cm boundaries.
 */

const baseDeckHeader = { size: "16x9" as const, theme: "default", brand: { name: "中华文明", primary: "8B6914" } };

function deckWith(slides: SlideV2[]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: baseDeckHeader,
    slides,
  };
}

function renderAndCollect(deck: Slideml2SourceDeck): LayoutDiagnostic[] {
  clearRenderDiagnostics();
  renderToAst(sourceToRenderedDeck(deck));
  return getRenderDiagnostics();
}

describe("timeline auto-orient (inmuai s2/s3)", () => {
  it("vertical 6-step timeline + image-card sibling no longer FALLBACK_FAILED on every step", () => {
    const slide: SlideV2 = {
      id: "s2",
      title: "黄河文明：万年脉络",
      children: [
        { id: "s2.lead", type: "lead", text: "黄河流域是中国最早的城市、文字、青铜器与礼制文明的诞生地。" } as unknown as DomNode,
        {
          id: "s2.tl",
          type: "timeline",
          items: [
            { date: "约公元前7000年", title: "裴李岗文化", body: "黄河中游新石器早期" },
            { date: "约公元前5000年", title: "仰韶文化", body: "彩陶工艺达到高峰" },
            { date: "约公元前3000年", title: "龙山文化", body: "黑陶薄如蛋壳" },
            { date: "约公元前2070年", title: "夏朝建立", body: "大禹治水后建立" },
            { date: "约公元前1600年", title: "商朝（殷）", body: "甲骨文与青铜礼器" },
            { date: "公元前770年", title: "周朝礼乐文明", body: "礼乐制度奠基" },
          ],
        } as unknown as DomNode,
        {
          id: "s2.img",
          type: "image-card",
          src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MDAiIGhlaWdodD0iNDUwIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjQ1MCIgZmlsbD0iIzExMTgyNyIvPjwvc3ZnPg==",
          fixedHeight: 2.8,
          fit: "cover",
          caption: "黄河文明时间线",
          tone: "tinted",
        } as unknown as DomNode,
      ],
    };
    const diags = renderAndCollect(deckWith([slide]));
    const fallback = diags.filter((d) => d.code === "FALLBACK_FAILED");
    // Auto-orient flips vertical timeline → horizontal grid when the slot is
    // shorter than steps × ~1.4cm; expect the per-step FALLBACK pile to vanish.
    expect(fallback, fallback.map((d) => `${d.nodeId}: ${d.message}`).join("\n")).toHaveLength(0);
  });

  it("image-card with caption + a tight fixedHeight: caption is optional and gets dropped without FALLBACK_FAILED", () => {
    const slide: SlideV2 = {
      id: "tight-image",
      children: [{
        id: "tight-image.card",
        type: "image-card",
        src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MDAiIGhlaWdodD0iNDUwIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjQ1MCIgZmlsbD0iIzExMTgyNyIvPjwvc3ZnPg==",
        // Realistic agent-supplied fixedHeight from the inmuai log; tight enough
        // that the caption can't fit alongside the image at full size.
        fixedHeight: 4,
        fit: "cover",
        caption: "long caption text that would otherwise overflow the small image-card slot",
      } as unknown as DomNode],
    };
    const diags = renderAndCollect(deckWith([slide]));
    // The contract: caption is optional, so it gets DROPped when needed,
    // never blocked with FALLBACK_FAILED on the image-card stack.
    const fallback = diags.filter((d) => d.code === "FALLBACK_FAILED" && d.nodeId?.startsWith("tight-image"));
    expect(fallback, fallback.map((d) => d.message).join("\n")).toHaveLength(0);
  });
});

describe("CSS color functions accepted (inmuai rgba())", () => {
  it("parseCssColor handles rgba()", () => {
    const result = parseCssColor("rgba(20, 10, 5, 0.55)");
    expect(result?.hex).toBe("140A05");
    expect(result?.alpha).toBeCloseTo(0.55, 2);
  });

  it("parseCssColor handles rgb() with percent channels", () => {
    const result = parseCssColor("rgb(50%, 25%, 0%)");
    expect(result?.hex).toMatch(/^[0-9A-F]{6}$/);
  });

  it("parseCssColor handles hsl()", () => {
    const result = parseCssColor("hsl(200, 50%, 40%)");
    expect(result?.hex).toMatch(/^[0-9A-F]{6}$/);
  });

  it("color() resolves rgba() to hex (alpha discarded for text)", () => {
    const theme = buildTheme({}, "default");
    expect(color(theme, "rgba(20, 10, 5, 0.55)")).toBe("140A05");
  });

  it("resolveFill returns alpha when rgba() is used as a fill", () => {
    const theme = buildTheme({}, "default");
    const fill = resolveFill(theme, "rgba(20, 10, 5, 0.55)", "background");
    expect(fill.type).toBe("solid");
    if (fill.type === "solid") {
      expect(fill.color).toBe("140A05");
      expect(fill.alpha).toBeCloseTo(0.55, 2);
    }
  });

  it("rgba() in band fill does not trip UNKNOWN_COLOR", () => {
    const slide: SlideV2 = {
      id: "rgba-band",
      children: [{
        id: "rgba-band.b",
        type: "band",
        fill: "rgba(20, 10, 5, 0.7)",
        height: 5,
        children: [{ id: "rgba-band.b.t", type: "text", text: "标题", style: "deck-title", color: "text.inverse" }],
      } as unknown as DomNode],
    };
    const diags = renderAndCollect(deckWith([slide]));
    expect(diags.filter((d) => d.code === "UNKNOWN_COLOR" && /rgba/i.test(String(d.message)))).toHaveLength(0);
  });
});

describe("FALLBACK tolerance band (inmuai numbered-grid 0.04cm)", () => {
  it("0.04cm overflow is downgraded to OVERFLOW warn, not blocking FALLBACK_FAILED", () => {
    // A stack that needs about 2.22cm in a slot of ~2.18cm — within the
    // 5% tolerance band, so the renderer should emit an OVERFLOW warn but
    // NO blocking FALLBACK_FAILED.
    const slide: SlideV2 = {
      id: "tol",
      children: [{
        id: "tol.frame",
        type: "stack",
        direction: "vertical",
        // Use an explicit small fixedHeight that maps to an inner-children
        // available height just below the children's intrinsic sum.
        fixedHeight: 2.18,
        children: [
          { id: "tol.frame.a", type: "text", text: "线 A", style: "card-title", minHeight: 0.66, autoFit: "shrink" },
          { id: "tol.frame.b", type: "text", text: "线 B", style: "caption", minHeight: 0.66, autoFit: "shrink" },
          { id: "tol.frame.c", type: "text", text: "线 C", style: "caption", minHeight: 0.66, autoFit: "shrink" },
        ],
      } as unknown as DomNode],
    };
    const diags = renderAndCollect(deckWith([slide]));
    const fallback = diags.filter((d) => d.code === "FALLBACK_FAILED");
    expect(fallback, fallback.map((d) => `${d.nodeId}: ${d.message}`).join("\n")).toHaveLength(0);
  });
});

describe("FALLBACK constrainedBy points to a sibling fixedHeight (inmuai s2.tl + s2.img)", () => {
  it("when a sibling owns a large fixedHeight, the diagnostic surfaces it", () => {
    const slide: SlideV2 = {
      id: "sib",
      children: [{
        id: "sib.row",
        type: "stack",
        direction: "vertical",
        gap: 0.3,
        area: "content",
        children: [
          // A starving stack that intrinsically needs much more than the slot
          // can provide. Its sibling is image-card with fixedHeight 7cm —
          // that's the "real" constraint the agent should know about.
          {
            id: "sib.row.tl",
            type: "stack",
            direction: "vertical",
            gap: 0.1,
            children: Array.from({ length: 8 }, (_, i) => ({ id: `sib.row.tl.${i}`, type: "text", text: `条目 ${i + 1}`, style: "card-title", minHeight: 0.7, autoFit: "shrink" })) as unknown as DomNode[],
          } as unknown as DomNode,
          {
            id: "sib.row.img",
            type: "image",
            src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MDAiIGhlaWdodD0iNDUwIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjQ1MCIgZmlsbD0iIzExMTgyNyIvPjwvc3ZnPg==",
            fixedHeight: 7,
            fixedWidth: 18,
          } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    };
    const diags = renderAndCollect(deckWith([slide]));
    const fallback = diags.filter((d) => d.code === "FALLBACK_FAILED");
    // Either the layout solved it (zero blocking) or every blocking diagnostic
    // carries a constrainedBy that names a real DOM node — never bare "no
    // hint". This is the agent-facing contract: every FALLBACK_FAILED tells
    // the agent which size to release.
    for (const d of fallback) {
      const cb = d.constrainedBy;
      const noteId = cb?.ancestorId || "";
      // Either a fixedHeight ancestor (sib.row, slide.root, ...) OR a sibling
      // (sib.row.img). Both pinpoint a concrete repair target.
      expect(cb, `expected constrainedBy on ${d.nodeId}: ${d.message}`).toBeDefined();
      expect(typeof noteId === "string" && noteId.length > 0).toBeTruthy();
    }
  });
});
