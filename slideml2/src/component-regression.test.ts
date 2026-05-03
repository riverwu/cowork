import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
  type LayoutDiagnostic,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { validateDeck, validateSlide } from "./validate.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Targeted regressions for component bugs discovered in the wuur34 debug log
 * and during the surfaceTrail/cluster work. Each test pins one small claim
 * about how the renderer or validator should behave; they protect against
 * accidental reverts from future component refactors.
 */

const baseDeck = { deck: { size: "16x9" as const, theme: "default", brand: { primary: "2563EB" } } };

const TINY_PNG = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiPjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiIGZpbGw9IiMyNTYzZWIiLz48L3N2Zz4=";

const BLOCKING_CODES: ReadonlySet<LayoutDiagnostic["code"]> = new Set<LayoutDiagnostic["code"]>([
  "FALLBACK_FAILED",
  "COLLISION",
  "TINY_RECT",
  "SQUASHED",
  "DROP",
  "LOW_CONTRAST",
  "UNKNOWN_COLOR",
  "UNKNOWN_STYLE",
]);

function buildDeckWithSlide(slide: SlideV2): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { name: "Test", primary: "2563EB" } },
    slides: [slide],
  };
}

function findShapeByName(ast: ReturnType<typeof renderToAst>, name: string) {
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) {
      if (shape.type === "text" && shape.name === name) return shape;
      if (shape.type === "shape" && shape.name === name) return shape;
    }
  }
  return undefined;
}

function findRunColor(ast: ReturnType<typeof renderToAst>, name: string): string | undefined {
  const shape = findShapeByName(ast, name);
  if (!shape || shape.type !== "text") return undefined;
  return shape.paragraphs?.[0]?.runs?.[0]?.color;
}

describe("component regressions", () => {
  it("ctaButton renders text.inverse hex on a brand-fill surface", () => {
    const slide: SlideV2 = {
      id: "reg-cta",
      children: [{ id: "reg-cta.btn", type: "cta", text: "立即开始", tone: "brand" }],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const runColor = findRunColor(ast, "reg-cta.btn");
    // text.inverse resolves to FFFFFF in the default theme.
    expect(runColor, JSON.stringify(ast.slides[0].shapes, null, 2)).toBe("FFFFFF");
    const blocking = getRenderDiagnostics().filter((d) => BLOCKING_CODES.has(d.code) && d.severity !== "info");
    expect(blocking, JSON.stringify(blocking)).toHaveLength(0);
  });

  it("ctaButton with link still inherits node.color into content runs", () => {
    const slide: SlideV2 = {
      id: "reg-cta-link",
      children: [{ id: "reg-cta-link.btn", type: "cta", text: "前往", tone: "brand", link: "https://example.com" } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const runColor = findRunColor(ast, "reg-cta-link.btn");
    expect(runColor).toBe("FFFFFF");
  });

  it("profile-card with default photo size does not emit SQUASHED on the photo", () => {
    const slide: SlideV2 = {
      id: "reg-profile",
      children: [{
        id: "reg-profile.card",
        type: "profile-card",
        image: TINY_PNG,
        name: "张三",
        role: "工程师",
        bio: "短简介。",
      }],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const squashed = getRenderDiagnostics().filter((d) => d.code === "SQUASHED");
    expect(squashed, squashed.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("title-lockup with tone:'inverse' is wrapped in a brand-fill band so the text stays readable", () => {
    const slide: SlideV2 = {
      id: "reg-lockup",
      children: [{
        id: "reg-lockup.lock",
        type: "title-lockup",
        title: "封面标题",
        subtitle: "副标题",
        tone: "inverse",
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    // A band shape ('roundRect' or 'rect' rendered via renderBand) carrying the
    // brand fill should appear in the rendered shapes — that's how the inverse
    // text stays readable on a default light deck.
    const hasBrandFill = ast.slides[0].shapes.some((shape) => shape.type === "shape" && shape.fill?.type === "solid" && (shape.fill.color === "2563EB"));
    expect(hasBrandFill, JSON.stringify(ast.slides[0].shapes.map((s) => s.type === "shape" ? { fill: s.fill } : { type: s.type }))).toBe(true);
    const blocking = getRenderDiagnostics().filter((d) => BLOCKING_CODES.has(d.code) && d.severity !== "info");
    expect(blocking, blocking.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("LOW_CONTRAST clusters by (fg,bg,fontBucket) with surfaceTrail", () => {
    const slide: SlideV2 = {
      id: "reg-cluster",
      children: [{
        id: "reg-cluster.row",
        type: "stack",
        direction: "vertical",
        gap: 0.2,
        area: "content",
        children: [
          { id: "reg-cluster.row.a", type: "text", text: "白字一", style: "paragraph", color: "text.inverse" },
          { id: "reg-cluster.row.b", type: "text", text: "白字二", style: "paragraph", color: "text.inverse" },
          { id: "reg-cluster.row.c", type: "text", text: "白字三", style: "paragraph", color: "text.inverse" },
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    // Whether the auto-fix fired or not, the cluster diagnostic structure
    // (surfaceTrail + aggregated.affectedNodes) must hold for both
    // LOW_CONTRAST and LOW_CONTRAST_FIXED.
    const lowContrast = getRenderDiagnostics().filter((d) => d.code === "LOW_CONTRAST" || d.code === "LOW_CONTRAST_FIXED");
    expect(lowContrast, JSON.stringify(lowContrast.map((d) => d.message))).toHaveLength(1);
    expect(lowContrast[0]!.surfaceTrail?.length, "surfaceTrail should describe slide.bg → surface → text.color").toBeGreaterThanOrEqual(2);
    expect(lowContrast[0]!.aggregated?.count).toBe(3);
    expect(lowContrast[0]!.aggregated?.affectedNodes.map((n) => n.nodeId)).toEqual(
      expect.arrayContaining(["reg-cluster.row.a", "reg-cluster.row.b", "reg-cluster.row.c"]),
    );
  });

  it("LOW_CONTRAST surfaceTrail picks band fill when text sits on a band even with rounding noise", () => {
    const slide: SlideV2 = {
      id: "reg-band-trail",
      children: [{
        id: "reg-band-trail.band",
        type: "band",
        fill: "111827",
        height: 5,
        children: [{
          id: "reg-band-trail.band.title",
          type: "text",
          text: "白色标题",
          style: "slide-title",
          color: "text.inverse",
        }],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const lowContrast = getRenderDiagnostics().filter((d) => d.code === "LOW_CONTRAST");
    // White on near-black band must be readable; if the contrast checker
    // ever reverts to comparing against the slide bg, this test fails.
    expect(lowContrast, lowContrast.map((d) => `[${d.code}] ${d.message} trail=${(d.surfaceTrail || []).join(" → ")}`).join("\n")).toHaveLength(0);
  });

  it("section-break.accent with a literal label string does NOT trip INVALID_FIELD_USAGE", () => {
    const slide: SlideV2 = {
      id: "reg-accent-ok",
      children: [{ id: "reg-accent-ok.s", type: "section-break", title: "第一章", accent: "PART 01" } as unknown as SlideV2["children"][number]],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors, JSON.stringify(report.errors)).toHaveLength(0);
  });

  it("section-break.accent with a token-shaped string trips INVALID_FIELD_USAGE", () => {
    const slide: SlideV2 = {
      id: "reg-accent-bad",
      children: [{ id: "reg-accent-bad.s", type: "section-break", title: "第一章", accent: "brand.primary" } as unknown as SlideV2["children"][number]],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors.find((e) => e.code === "INVALID_FIELD_USAGE")).toBeDefined();
  });

  it("STYLE_AS_TYPE error includes the precise rewrite for {type:'paragraph'}", () => {
    const slide: SlideV2 = {
      id: "reg-style-as-type",
      children: [{ id: "reg-style-as-type.x", type: "paragraph" as unknown as SlideV2["children"][number]["type"], text: "abc" }],
    };
    const report = validateSlide(slide, baseDeck);
    const hit = report.errors.find((e) => e.code === "STYLE_AS_TYPE");
    expect(hit, JSON.stringify(report.errors)).toBeDefined();
    expect(`${hit!.message} ${hit!.suggestedFix || ""}`).toMatch(/style:"paragraph"/);
  });

  it("h2 component (not a misuse) validates cleanly", () => {
    const slide: SlideV2 = {
      id: "reg-h2",
      children: [{ id: "reg-h2.title", type: "h2", text: "卡片标题" } as unknown as SlideV2["children"][number]],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors, JSON.stringify(report.errors)).toHaveLength(0);
  });

  it("profile-card.name (a documented field) is NOT flagged as LEGACY_NODE_NAME", () => {
    const slide: SlideV2 = {
      id: "reg-profile-name",
      children: [{
        id: "reg-profile-name.card",
        type: "profile-card",
        image: TINY_PNG,
        name: "李四",
      } as unknown as SlideV2["children"][number]],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors.find((e) => e.code === "LEGACY_NODE_NAME"), JSON.stringify(report.errors)).toBeUndefined();
  });

  it("non-component {type:'stack'} with a name field still trips LEGACY_NODE_NAME", () => {
    const slide: SlideV2 = {
      id: "reg-legacy-name",
      children: [{
        id: "reg-legacy-name.stack",
        type: "stack",
        direction: "vertical",
        gap: 0.2,
        name: "legacy-name-field",
        children: [{ id: "reg-legacy-name.stack.t", type: "text", text: "x", style: "paragraph" }],
      } as unknown as SlideV2["children"][number]],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors.find((e) => e.code === "LEGACY_NODE_NAME"), JSON.stringify(report.errors)).toBeDefined();
  });

  it("text.color hex is rejected with a message clarifying band/card/shape fill is OK", () => {
    const slide: SlideV2 = {
      id: "reg-hex",
      children: [{ id: "reg-hex.t", type: "text", text: "红字", color: "FF0000", style: "paragraph" }],
    };
    const report = validateSlide(slide, baseDeck);
    const hit = report.errors.find((e) => e.code === "RAW_TEXT_HEX_COLOR");
    expect(hit).toBeDefined();
    expect(hit!.message).toMatch(/band\/card\/shape/i);
  });

  it("band.fill hex is allowed (no validation error)", () => {
    const slide: SlideV2 = {
      id: "reg-band-hex",
      children: [{
        id: "reg-band-hex.band",
        type: "band",
        fill: "111827",
        height: 5,
        children: [{ id: "reg-band-hex.band.t", type: "text", text: "白字", style: "slide-title", color: "text.inverse" }],
      } as unknown as DomNode],
    };
    const deck = buildDeckWithSlide(slide);
    const report = validateDeck(deck);
    expect(report.errors.filter((e) => e.code === "RAW_TEXT_HEX_COLOR"), JSON.stringify(report.errors)).toHaveLength(0);
  });

  it("explicit fixedWidth/fixedHeight on an image exempts it from SQUASHED", () => {
    const slide: SlideV2 = {
      id: "reg-fixed-img",
      children: [{
        id: "reg-fixed-img.s",
        type: "stack",
        direction: "vertical",
        gap: 0.2,
        children: [
          { id: "reg-fixed-img.s.icon", type: "image", src: TINY_PNG, alt: "icon", fit: "contain", fixedWidth: 1.2, fixedHeight: 1.2 },
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const squashed = getRenderDiagnostics().filter((d) => d.code === "SQUASHED" && d.nodeId === "reg-fixed-img.s.icon");
    expect(squashed, squashed.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("deck-title default color resolves against a light deck without LOW_CONTRAST", () => {
    const slide: SlideV2 = {
      id: "reg-deck-title",
      children: [{ id: "reg-deck-title.t", type: "deck-title", text: "默认封面标题" } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const lowContrast = getRenderDiagnostics().filter((d) => d.code === "LOW_CONTRAST");
    expect(lowContrast, lowContrast.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("label component with tone:'neutral' resolves to a real color (no UNKNOWN_COLOR)", () => {
    const slide: SlideV2 = {
      id: "reg-label-tone",
      children: [{ id: "reg-label-tone.l", type: "label", text: "标签", tone: "neutral" } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const unknownColor = getRenderDiagnostics().filter((d) => d.code === "UNKNOWN_COLOR" && /neutral/i.test(d.message));
    expect(unknownColor, unknownColor.map((d) => d.message).join("\n")).toHaveLength(0);
  });
});
