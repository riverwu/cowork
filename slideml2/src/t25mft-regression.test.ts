import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { validateDeck } from "./validate.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Regressions for the t25mft debug log (2026-05-03 07:42).
 *
 * Two visual issues showed up in the final deck:
 *  1. Cover/end slides used `band tone:"brand"` expecting the band to fill
 *     with the brand color. The band painted brand.tint (a soft pastel), and
 *     the contrast auto-fix then rewrote white title text to dark — leaving
 *     a light-blue panel on the dark-red cover with dark text.
 *  2. Long Chinese slide titles ("第一阶段：先秦——文明在北方的摇篮",
 *     "近现代：南北互动的深化与新格局") overflowed the 1.45cm title rect.
 *
 * These tests pin the fixes:
 *   - renderBand maps tone:"brand" → brand.primary fill (not brand.tint),
 *     positive/warning/danger → solid semantic colors. Bands are full-bleed
 *     dividers; agents writing `tone:"brand"` mean "the brand color".
 *   - sourceSlideToRendered adds autoFit:"shrink" to the auto-generated
 *     slide-title text so long titles compress to fit.
 */

const BRAND = "C0392B";

function deck(slide: SlideV2, themeOverride?: Slideml2SourceDeck["deck"]["themeOverride"]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { name: "Test", primary: BRAND }, themeOverride },
    slides: [slide],
  };
}

function findShape(ast: ReturnType<typeof renderToAst>, name: string) {
  return ast.slides[0]!.shapes.find((s) => s.name === name);
}

describe("band tone:'brand' paints brand.primary (t25mft cover/end fix)", () => {
  it("cover band tone:'brand' fills with brand.primary (not brand.tint)", () => {
    const slide: SlideV2 = {
      id: "cover",
      background: "brand.primary",
      children: [{
        id: "cover.band",
        type: "band",
        tone: "brand",
        height: 5.5,
        children: [
          { id: "cover.band.title", type: "text", text: "封面标题", style: "slide-title", color: "text.inverse", align: "center" },
        ],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const bandShape = findShape(ast, "cover.band-band");
    expect(bandShape?.type).toBe("shape");
    if (bandShape && bandShape.type === "shape" && bandShape.fill?.type === "solid") {
      // brand.primary resolves to the deck's brand color (uppercase hex).
      expect(bandShape.fill.color).toBe(BRAND);
    }
    // Title text retains text.inverse (white) — it's readable on brand fill.
    const titleShape = findShape(ast, "cover.band.title");
    if (titleShape && titleShape.type === "text") {
      expect(titleShape.paragraphs?.[0]?.runs?.[0]?.color).toBe("FFFFFF");
    }
  });

  it("body section bands also paint brand.primary, not brand.tint", () => {
    const slide: SlideV2 = {
      id: "section",
      title: "第一节",
      children: [{
        id: "sec.band",
        type: "band",
        tone: "brand",
        height: 1.4,
        children: [
          { id: "sec.band.title", type: "text", text: "秦（前221—前206）", style: "h2", color: "text.inverse" },
        ],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const bandShape = findShape(ast, "sec.band-band");
    if (bandShape && bandShape.type === "shape" && bandShape.fill?.type === "solid") {
      expect(bandShape.fill.color).toBe(BRAND);
    }
  });

  it("band tone:'positive' paints solid success color; warning/danger likewise", () => {
    // Default theme defines success/warning/danger to specific hexes; the
    // exact value is what the renderer emits via the new band-tone path.
    const cases: Array<["positive" | "warning" | "danger", string]> = [
      ["positive", "0E7C3A"],
      ["warning", "B45309"],
      ["danger", "B42318"],
    ];
    for (const [tone, expectedHex] of cases) {
      const slide: SlideV2 = {
        id: `band-${tone}`,
        children: [{
          id: `b.${tone}`,
          type: "band",
          tone,
          height: 2,
          children: [{ id: `b.${tone}.t`, type: "text", text: "x", style: "slide-title", color: "text.inverse" }],
        } as unknown as DomNode],
      };
      const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
      const bandShape = findShape(ast, `b.${tone}-band`);
      if (bandShape && bandShape.type === "shape" && bandShape.fill?.type === "solid") {
        expect(bandShape.fill.color, `band tone=${tone}`).toBe(expectedHex);
      }
    }
  });

  it("band tone:'tinted' still paints brand.tint (back-compat)", () => {
    const slide: SlideV2 = {
      id: "tinted",
      children: [{
        id: "t.band",
        type: "band",
        tone: "tinted",
        height: 2,
        children: [{ id: "t.band.t", type: "text", text: "x", style: "h2" }],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const bandShape = findShape(ast, "t.band-band");
    if (bandShape && bandShape.type === "shape" && bandShape.fill?.type === "solid") {
      // brand.tint is the soft pastel — different from brand.primary BRAND.
      expect(bandShape.fill.color).not.toBe(BRAND);
    }
  });
});

describe("slide-title autoFit (t25mft long-title fix)", () => {
  it("long Chinese title triggers autoFit:'shrink' instead of OVERFLOW", () => {
    const slide: SlideV2 = {
      id: "long",
      title: "第一阶段：先秦——文明在北方的摇篮 | A second clause that pushes the title way over 1.45cm",
      children: [{ id: "long.body", type: "text", text: "body", style: "paragraph" } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const titleShape = findShape(ast, "long.title");
    expect(titleShape?.type).toBe("text");
    if (titleShape && titleShape.type === "text") {
      // autoFit:"shrink" propagates to the rendered text shape.
      expect((titleShape as { autoFit?: string }).autoFit).toBe("shrink");
    }
    // OVERFLOW diagnostic should not fire because the renderer pre-shrinks.
    const overflow = getRenderDiagnostics().filter((d) => d.code === "OVERFLOW" && /\.title$/.test(String(d.nodeId || "")));
    expect(overflow.length, overflow.map((d) => d.message).join("\n")).toBe(0);
  });

  it("short title still renders at the canonical slide-title size", () => {
    const slide: SlideV2 = {
      id: "short",
      title: "封面",
      children: [{ id: "short.body", type: "text", text: "body", style: "paragraph" } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const titleShape = findShape(ast, "short.title");
    if (titleShape && titleShape.type === "text") {
      // Default slide-title fontSize is 29pt = 58 halfPt. A short title should
      // not be shrunk meaningfully (autoFit only acts when intrinsic > rect).
      const sz = titleShape.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt ?? 0;
      expect(sz).toBeGreaterThanOrEqual(54);
    }
  });
});

describe("process-flow horizontal step centering (t25mft tang slide)", () => {
  it("steps vertically center within the content rect, aligning with the arrows between them", () => {
    const slide: SlideV2 = {
      id: "tang",
      title: "唐宋",
      children: [{
        id: "tang.process",
        type: "process-flow",
        direction: "horizontal",
        steps: [
          { title: "盛唐（618—907）", body: "北方政治稳定" },
          { title: "安史之乱（755—763）", body: "北方再次陷入战乱" },
          { title: "宋代（960—1279）", body: "经济重心南移" },
        ],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const stepTitles = ast.slides[0]!.shapes.filter((s) => s.type === "text" && /\.step\d+\.title$/.test(String(s.name || "")));
    const arrows = ast.slides[0]!.shapes.filter((s) => s.type === "shape" && /\.arrow\d+$/.test(String(s.name || "")));
    expect(stepTitles.length).toBe(3);
    expect(arrows.length).toBe(2);
    // Step title y and arrow y should be close (within 1.5cm = 540000 EMU).
    // Pre-fix the gap was ~5cm (titles at 2.95cm, arrows at 7.87cm).
    const titleY = stepTitles[0]!.xfrm.y;
    const arrowY = arrows[0]!.xfrm.y;
    expect(Math.abs(titleY - arrowY)).toBeLessThan(540000);
  });
});

describe("flow-arrow visual prominence (t25mft modern slide)", () => {
  it("flow-arrow renders with a visible arrow shape (not a tiny lonely icon)", () => {
    const slide: SlideV2 = {
      id: "modern",
      title: "近现代",
      children: [{
        id: "modern.arrow",
        type: "flow-arrow",
        label: "南北双向互动",
        direction: "down",
        tone: "brand",
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const arrowShape = ast.slides[0]!.shapes.find((s) => s.type === "shape" && /\.arrow\.arrow$/.test(String(s.name || "")));
    expect(arrowShape).toBeDefined();
    if (arrowShape && arrowShape.type === "shape") {
      // Pre-fix: 0.90 x 1.20cm. Post-fix: 1.40 x 1.60cm — visible.
      const widthCm = arrowShape.xfrm.cx / 360000;
      const heightCm = arrowShape.xfrm.cy / 360000;
      expect(widthCm).toBeGreaterThanOrEqual(1.2);
      expect(heightCm).toBeGreaterThanOrEqual(1.4);
    }
  });

  it("375vrl: flow-arrow label hugs its text instead of stretching to the full slide width", () => {
    const slide: SlideV2 = {
      id: "modern",
      title: "近现代",
      children: [{
        id: "modern.arrow",
        type: "flow-arrow",
        label: "近代南北双向互动",
        direction: "down",
        tone: "brand",
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const labelShape = ast.slides[0]!.shapes.find((s) => s.type === "text" && /\.arrow\.label$/.test(String(s.name || "")));
    expect(labelShape).toBeDefined();
    if (labelShape && labelShape.type === "text") {
      // Slide width is ~25.4cm; the label rect should NOT span the full
      // content area (~21.80cm). After fix the cluster is bounded to ~5cm.
      const widthCm = labelShape.xfrm.cx / 360000;
      expect(widthCm).toBeLessThan(10);
      // And the label should be horizontally centered around slide center.
      const centerCm = (labelShape.xfrm.x + labelShape.xfrm.cx / 2) / 360000;
      expect(centerCm).toBeGreaterThan(10);
      expect(centerCm).toBeLessThan(15.4);
    }
  });

  it("flow-arrow direction:'right' (horizontal cluster) is bounded too", () => {
    const slide: SlideV2 = {
      id: "h",
      children: [{
        id: "h.arrow",
        type: "flow-arrow",
        label: "下一阶段",
        direction: "right",
        tone: "brand",
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const labelShape = ast.slides[0]!.shapes.find((s) => s.type === "text" && /\.arrow\.label$/.test(String(s.name || "")));
    expect(labelShape).toBeDefined();
    if (labelShape && labelShape.type === "text") {
      const widthCm = labelShape.xfrm.cx / 360000;
      expect(widthCm).toBeLessThan(12);
    }
  });
});

describe("slide background image / backgroundImage alias (6gl008 fix)", () => {
  it("slide.backgroundImage:'/path/img.png' installs an image background", () => {
    const slide = {
      id: "cover",
      backgroundImage: "/abs/cover-bg.png",
      children: [{ id: "cover.t", type: "text", text: "封面", style: "slide-title", color: "text.inverse" }],
    } as unknown as SlideV2;
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const slideAst = ast.slides[0]!;
    expect(slideAst.background?.type).toBe("image");
    if (slideAst.background?.type === "image") {
      expect(slideAst.background.src).toBe("/abs/cover-bg.png");
    }
  });

  it("slide.background:{src:'/path/img.png'} installs an image background", () => {
    const slide = {
      id: "cover",
      background: { src: "/abs/img.png" },
      children: [{ id: "cover.t", type: "text", text: "x", style: "slide-title" }],
    } as unknown as SlideV2;
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const slideAst = ast.slides[0]!;
    expect(slideAst.background?.type).toBe("image");
  });

  it("slide.background:{image:'/path'} alias also works", () => {
    const slide = {
      id: "cover",
      background: { image: "/abs/img.png" },
      children: [{ id: "cover.t", type: "text", text: "x", style: "slide-title" }],
    } as unknown as SlideV2;
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    expect(ast.slides[0]!.background?.type).toBe("image");
  });

  it("backgroundImage takes priority over a background token (agent intent: image overrides color)", () => {
    const slide = {
      id: "cover",
      background: "brand.primary",
      backgroundImage: "/abs/cover.png",
      children: [{ id: "cover.t", type: "text", text: "x", style: "slide-title" }],
    } as unknown as SlideV2;
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    expect(ast.slides[0]!.background?.type).toBe("image");
  });
});

describe("UNKNOWN_NODE_TYPE actionable suggestions (6gl008)", () => {
  it("type:'overlay' gets a hint pointing to background.src + band fill rgba", () => {
    // We import validateSlide indirectly through validateDeck of a deck with one slide.
    const dk = deck({
      id: "s",
      children: [{ id: "s.o", type: "overlay" as never, opacity: 0.5, children: [] } as unknown as DomNode],
    });
    // The validator runs through validateSlide internally; verify by searching errors.
    const report = validateDeck(dk);
    const hit = report.errors.find((e) => e.code === "UNKNOWN_NODE_TYPE" && /overlay/.test(e.message));
    expect(hit).toBeDefined();
    expect(String(hit!.suggestedFix || "")).toMatch(/background\.src|band|rgba/);
  });

  it("type:'background' steers the agent to slide.background instead of a child node", () => {
    const dk = deck({
      id: "s",
      children: [{ id: "s.bg", type: "background" as never, src: "/x.png" } as unknown as DomNode],
    });
    const report = validateDeck(dk);
    const hit = report.errors.find((e) => e.code === "UNKNOWN_NODE_TYPE" && /background/.test(e.message));
    expect(hit).toBeDefined();
    expect(String(hit!.suggestedFix || "")).toMatch(/slide\.background/);
  });

  it("type:'row' / 'column' / 'container' get steered to stack/grid", () => {
    const cases: Array<[string, RegExp]> = [
      ["row", /stack.*horizontal/i],
      ["column", /stack.*vertical|grid.*columns/i],
      ["container", /stack|grid|card|panel|band/],
    ];
    for (const [nodeType, expected] of cases) {
      const dk = deck({
        id: `s-${nodeType}`,
        children: [{ id: `s.x`, type: nodeType as never } as unknown as DomNode],
      });
      const report = validateDeck(dk);
      const hit = report.errors.find((e) => e.code === "UNKNOWN_NODE_TYPE");
      expect(hit, `type=${nodeType}`).toBeDefined();
      expect(String(hit!.suggestedFix || "")).toMatch(expected);
    }
  });
});

describe("cover slide composition: brand bg + brand band + inverse text reads correctly", () => {
  it("rendered cover has 0 BLOCKING diagnostics and brand-fill + white text", () => {
    const slide: SlideV2 = {
      id: "cover",
      background: "brand.primary",
      children: [{
        id: "cover.band",
        type: "band",
        tone: "brand",
        height: 5.5,
        children: [
          { id: "cover.band.title", type: "text", text: "中华文明", style: "slide-title", color: "text.inverse", align: "center" },
          { id: "cover.band.subtitle", type: "text", text: "副标题", style: "lead", color: "text.inverse", align: "center" },
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const blocking = getRenderDiagnostics().filter((d) => {
      const code = d.code;
      return code === "FALLBACK_FAILED" || code === "SQUASHED" || code === "TINY_RECT" || code === "LOW_CONTRAST" || code === "UNKNOWN_COLOR" || code === "UNKNOWN_STYLE" || code === "COLLISION";
    });
    expect(blocking, blocking.map((d) => d.message).join("\n")).toHaveLength(0);
    // Sanity: title and subtitle stay white on the rendered cover.
    const titleShape = findShape(ast, "cover.band.title");
    const subtitleShape = findShape(ast, "cover.band.subtitle");
    if (titleShape?.type === "text") {
      expect(titleShape.paragraphs?.[0]?.runs?.[0]?.color).toBe("FFFFFF");
    }
    if (subtitleShape?.type === "text") {
      expect(subtitleShape.paragraphs?.[0]?.runs?.[0]?.color).toBe("FFFFFF");
    }
  });
});
