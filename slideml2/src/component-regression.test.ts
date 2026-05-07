import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
  type LayoutDiagnostic,
} from "./diagnostics.js";
import { renderToAst, measureDeck } from "./render.js";
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

function findRenderedByName(ast: ReturnType<typeof renderToAst>, name: string) {
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) {
      if ((shape as { name?: string }).name === name) return shape;
    }
  }
  return undefined;
}

function firstTextShapeContaining(ast: ReturnType<typeof renderToAst>, text: string) {
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) {
      if (shape.type !== "text") continue;
      const allText = shape.paragraphs?.flatMap((p) => p.runs.map((r) => r.text)).join("") || "";
      if (allText.includes(text)) return shape;
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

  it("kpi-grid uses stable index ids even when metric names repeat", () => {
    const slide: SlideV2 = {
      id: "reg-kpi-id",
      children: [{
        id: "reg-kpi-id.grid",
        type: "kpi-grid",
        metrics: [
          { name: "Same Label", value: "42%", label: "Same Label" },
          { name: "Same Label", value: "7", label: "Same Label" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const names = ast.slides[0].shapes.map((s) => (s as { name?: string }).name).filter(Boolean);
    expect(names).toContain("reg-kpi-id.grid-m1.value");
    expect(names).toContain("reg-kpi-id.grid-m2.value");
    expect(names.some((name) => name!.includes("Same Label"))).toBe(false);
  });

  it("two-column recursively validates left/right DomNodes", () => {
    const slide: SlideV2 = {
      id: "reg-two-col",
      children: [{
        id: "reg-two-col.tc",
        type: "two-column",
        left: { id: "reg-two-col.left", type: "missing-widget", text: "bad" },
        right: { id: "reg-two-col.right", type: "text", text: "ok" },
      } as unknown as SlideV2["children"][number]],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors.find((e) => e.path === "children[0].left" && e.code === "UNKNOWN_NODE_TYPE")).toBeDefined();
  });

  it("component enum props reject undocumented values instead of silently downgrading intent", () => {
    const slide: SlideV2 = {
      id: "reg-enum",
      children: [{
        id: "reg-enum.card",
        type: "insight-card",
        title: "资源",
        body: "保留作者原本想要的强调色意图。",
        tone: "accent2",
      } as unknown as SlideV2["children"][number]],
    };
    const report = validateSlide(slide, baseDeck);
    const hit = report.errors.find((e) => e.code === "INVALID_FIELD_USAGE" && e.path === "children[0].tone");
    expect(hit, JSON.stringify(report.errors)).toBeDefined();
    expect(hit!.message).toContain("insight-card.tone must be one of");
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

  it("image-card contain mode centers generated illustrations in a bounded inner frame", () => {
    const slide: SlideV2 = {
      id: "reg-image-card",
      children: [{
        id: "reg-image-card.figure",
        type: "image-card",
        src: TINY_PNG,
        title: "生成插图",
        fit: "contain",
      } as unknown as SlideV2["children"][number]],
    };
    const rendered = sourceToRenderedDeck(buildDeckWithSlide(slide));
    const ast = renderToAst(rendered);
    const image = findRenderedByName(ast, "reg-image-card.figure.image") as { xfrm?: { x: number; cx: number } } | undefined;
    const cardRect = measureDeck(rendered)[0]!.nodes.find((entry) => entry.id === "reg-image-card.figure")?.rect;
    expect(image?.xfrm, JSON.stringify(ast.slides[0].shapes, null, 2)).toBeDefined();
    expect(cardRect).toBeDefined();
    expect(image!.xfrm!.cx).toBeLessThan(cardRect!.w * 360000);
    expect(image!.xfrm!.x).toBeGreaterThan(cardRect!.x * 360000);
  });

  it("process-flow horizontal titles share a stable top alignment with uneven bodies", () => {
    const rendered = sourceToRenderedDeck(buildDeckWithSlide({
      id: "reg-flow",
      children: [{
        id: "reg-flow.p",
        type: "process-flow",
        direction: "horizontal",
        steps: [
          { title: "A", body: "短" },
          { title: "B", body: "这一步的说明文字明显更长，需要更多内部高度。" },
          { title: "C", body: "中等长度说明。" },
        ],
      } as unknown as SlideV2["children"][number]],
    }));
    const measured = measureDeck(rendered)[0]!.nodes;
    const ys = ["reg-flow.p.step1.title", "reg-flow.p.step2.title", "reg-flow.p.step3.title"]
      .map((id) => measured.find((entry) => entry.id === id)?.rect.y);
    expect(ys.every((y) => typeof y === "number"), JSON.stringify(measured)).toBe(true);
    expect(Math.max(...(ys as number[])) - Math.min(...(ys as number[]))).toBeLessThan(0.05);
  });

  it("comparison-table keeps feature labels in the left column", () => {
    const slide: SlideV2 = {
      id: "reg-cmp",
      children: [{
        id: "reg-cmp.table",
        type: "comparison-table",
        features: ["适用场景"],
        options: [
          { name: "方案 A", values: ["入门"] },
          { name: "方案 B", values: ["进阶"] },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const feature = firstTextShapeContaining(ast, "适用场景") as { xfrm?: { x: number } } | undefined;
    const option = firstTextShapeContaining(ast, "方案 A") as { xfrm?: { x: number } } | undefined;
    expect(feature?.xfrm).toBeDefined();
    expect(option?.xfrm).toBeDefined();
    expect(feature!.xfrm!.x).toBeLessThan(option!.xfrm!.x);
  });

  it("outline keeps authored numbers close to their chapter titles", () => {
    const rendered = sourceToRenderedDeck(buildDeckWithSlide({
      id: "reg-outline",
      title: "讲义目录",
      children: [{
        id: "reg-outline.list",
        type: "outline",
        items: [
          { number: "01", title: "全球癌症负担概览", body: "流行病学数据与主要癌种" },
          { number: "02", title: "免疫治疗", body: "ICI · CAR-T" },
          { number: "03", title: "靶向治疗", body: "KRAS · ADC" },
          { number: "04", title: "精准医疗与AI", body: "多组学" },
          { number: "05", title: "肿瘤生物学基础", body: "微环境" },
          { number: "06", title: "iGEM 参赛建议", body: "工程菌mRNA疫苗" },
        ],
      } as unknown as DomNode],
    }));
    const measured = measureDeck(rendered)[0]!.nodes;
    const num = measured.find((entry) => entry.id === "reg-outline.list.0.num")!.rect;
    const title = measured.find((entry) => entry.id === "reg-outline.list.0.title")!.rect;
    expect(title.x - (num.x + num.w)).toBeLessThan(0.6);
    expect(num.w).toBeLessThanOrEqual(1.1);
  });

  it("single full-slide chapter band is not constrained to the content rect", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default", brand: { primary: "E94560" } },
      slides: [{
        id: "reg-chapter-band",
        title: "",
        children: [{
          id: "reg-chapter-band.band",
          type: "band",
          tone: "brand",
          children: [{ id: "reg-chapter-band.band.title", type: "h1", text: "第二章 · 免疫治疗" }],
        } as unknown as DomNode],
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const band = findRenderedByName(ast, "reg-chapter-band.band-band") as { xfrm?: { x: number; y: number; cx: number; cy: number } } | undefined;
    expect(band?.xfrm).toBeDefined();
    expect(band!.xfrm!.x).toBe(0);
    expect(band!.xfrm!.y).toBe(0);
    expect(band!.xfrm!.cx).toBeGreaterThan(9000000);
    expect(band!.xfrm!.cy).toBeGreaterThan(5000000);
  });

  it("CSS-like theme cornerRadius values are normalized before rendering cards", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "2563EB" },
        themeOverride: { component: { card: { cornerRadius: 12 } } },
      },
      slides: [{
        id: "reg-radius",
        children: [{ id: "reg-radius.card", type: "card", children: [{ id: "reg-radius.card.t", type: "text", text: "x" }] } as unknown as DomNode],
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const card = findRenderedByName(ast, "reg-radius.card-card") as { cornerRadius?: number } | undefined;
    expect(card?.cornerRadius).toBe(0.12);
  });

  it("table-card propagates dark card fill into body cells so PPT does not default them to white", () => {
    const slide: SlideV2 = {
      id: "reg-table-fill",
      children: [{
        id: "reg-table-fill.tbl",
        type: "table-card",
        title: "ADC 药物全景",
        headers: ["ADC名称", "靶点"],
        rows: [["T-DXd", "HER2"]],
        fill: "#1A1A2E",
        line: "#E94560",
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const table = findRenderedByName(ast, "reg-table-fill.tbl.table") as { cells?: Array<Array<{ fill?: { color?: string } }>> } | undefined;
    expect(table?.cells?.[1]?.[0]?.fill?.color).toBe("1A1A2E");
  });

  it("dark theme semantic surfaces choose readable foregrounds before contrast auto-fix", () => {
    const darkDeck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "E94560" },
        themeOverride: {
          colors: {
            background: "0D1B2A",
            surface: "1A1A2E",
            "text.primary": "FFFFFF",
            "text.secondary": "E0E0E0",
          },
        },
      },
      slides: [{
        id: "reg-dark-surfaces",
        children: [{
          id: "reg-dark-surfaces.grid",
          type: "grid",
          columns: 2,
          gap: 0.35,
          children: [
            { id: "reg-dark-surfaces.band", type: "band", tone: "brand", fixedHeight: 2.2, children: [{ id: "reg-dark-surfaces.band.lead", type: "lead", text: "品牌色块上的副标题" }] },
            { id: "reg-dark-surfaces.insight", type: "insight-card", tone: "brand", headline: "PD-1", body: "程序性死亡受体-1" },
            { id: "reg-dark-surfaces.callout", type: "callout", tone: "warning", text: "核心挑战：CRS 与 ICANS 风险需要管理" },
            {
              id: "reg-dark-surfaces.cmp",
              type: "comparison-table",
              features: ["技术难度"],
              options: [
                { name: "方向一", values: ["中高"], recommended: true },
                { name: "方向二", values: ["中"], recommended: false },
              ],
            },
          ],
        } as unknown as DomNode],
      }],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(darkDeck));
    const contrastFixes = getRenderDiagnostics().filter((d) => d.code === "LOW_CONTRAST_FIXED" || d.code === "LOW_CONTRAST");
    expect(contrastFixes, contrastFixes.map((d) => `${d.nodeId}: ${d.message}`).join("\n")).toHaveLength(0);
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

  it("semantic deck-title preserves authored at coordinates after component expansion", () => {
    const slide: SlideV2 = {
      id: "cover",
      children: [{ id: "cover.title", type: "deck-title", text: "封面标题", at: [1.5, 4.3, 20, 1.5] } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const title = findRenderedByName(ast, "cover.title") as { xfrm?: { x: number; y: number; cx: number; cy: number } } | undefined;
    expect((title?.xfrm?.x || 0) / 360000).toBeCloseTo(1.5, 2);
    expect((title?.xfrm?.y || 0) / 360000).toBeCloseTo(4.3, 2);
    expect((title?.xfrm?.cx || 0) / 360000).toBeCloseTo(20, 2);
    expect((title?.xfrm?.cy || 0) / 360000).toBeCloseTo(1.5, 2);
  });

  it("theme lineHeight is emitted as paragraph line spacing for ordinary text", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "2563EB" },
        themeOverride: { text: { paragraph: { fontSize: 13, lineHeight: 1.6 } } },
      },
      slides: [{
        id: "typography",
        children: [{ id: "typography.body", type: "text", text: "一段普通正文", style: "paragraph" }],
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const body = findRenderedByName(ast, "typography.body") as { paragraphs?: Array<{ lineSpacingHalfPt?: number }> } | undefined;
    expect(body?.paragraphs?.[0]?.lineSpacingHalfPt).toBeCloseTo(13 * 1.6 * 2, 2);
  });

  it("executive-summary findings use readable bullet spacing by default", () => {
    const slide: SlideV2 = {
      id: "summary",
      children: [{
        id: "summary.exec",
        type: "executive-summary",
        headline: "核心摘要",
        findings: [
          { headline: "设计统一性战略", detail: "通过量变积累用户信任。" },
          { headline: "MEGA争议启示", detail: "激进创新需要循序渐进。" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const findings = findRenderedByName(ast, "summary.exec.findings") as { paragraphs?: Array<{ lineSpacingHalfPt?: number; spaceAfterHalfPt?: number; runs: Array<{ sizeHalfPt?: number }> }> } | undefined;
    expect(findings?.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt).toBeGreaterThanOrEqual(20);
    expect(findings?.paragraphs?.[0]?.lineSpacingHalfPt).toBeGreaterThan(26);
    expect(findings?.paragraphs?.[0]?.spaceAfterHalfPt).toBeGreaterThanOrEqual(10);
  });

  it("executive-summary preserves all findings instead of silently dropping after four", () => {
    const slide: SlideV2 = {
      id: "summary-many",
      children: [{
        id: "summary-many.exec",
        type: "executive-summary",
        headline: "核心摘要",
        findings: [
          { headline: "垂直证据型 search", detail: "金融/医疗/保险" },
          { headline: "多模态 search", detail: "Visual/Video for agents" },
          { headline: "Commerce 聚合层", detail: "ACP/UCP协议中间层" },
          { headline: "非英语区域化", detail: "日/印度/巴西/印尼" },
          { headline: "Memory原生搜索", detail: "记忆注入query改写层" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const findings = findRenderedByName(ast, "summary-many.exec.findings") as { paragraphs?: Array<{ runs: Array<{ text?: string }> }> } | undefined;
    const text = findings?.paragraphs?.map((p) => p.runs.map((r) => r.text || "").join("")).join("\n") || "";
    expect(findings?.paragraphs).toHaveLength(5);
    expect(text).toContain("Memory原生搜索");
  });

  it("reports bullet lists whose PowerPoint paragraph spacing would overlap", () => {
    const slide: SlideV2 = {
      id: "tight-bullets",
      children: [{
        id: "tight-bullets.list",
        type: "bullets",
        fixedHeight: 2.16,
        items: [
          "垂直证据型 search: 金融/医疗/保险，客单价$30K MRR",
          "多模态 search: Visual/Video for agents，18个月内必有$50M ARR玩家",
          "Commerce 聚合层: ACP/UCP协议中间层，Plaid模式",
          "非英语区域化: 日/印度/巴西/印尼，白纸市场",
        ],
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const failures = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED" && d.nodeId === "tight-bullets.list");
    expect(failures.map((d) => d.message).join("\n")).toContain("PowerPoint would compress paragraph spacing");
  });

  it("reports mixed CJK/English table rows that need more height than assigned", () => {
    const slide: SlideV2 = {
      id: "tight-table",
      children: [{
        id: "tight-table.table",
        type: "table",
        fixedHeight: 3.77,
        headers: ["场景", "数据", "含义"],
        rows: [
          ["Anthropic多agent", "~15x tokens vs 单agent", "1 lead + 3-5 subagent，每个并行调用3+工具"],
          ["Manus Wide Research", "单任务100+并行agent", "每个agent独立检索，调用量指数级增长"],
          ["You.com Research API", "1000+推理回合", "单次$15，1000万token"],
          ["Cloudflare数据", "ClaudeBot每referral抓取23,951页", "crawler:human从2:1到'tens of thousands to one'"],
          ["Vision agent", "比API agent多用45x tokens", "多模态带来更大搜索需求"],
        ],
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const failures = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED" && d.nodeId === "tight-table.table");
    expect(failures.map((d) => d.message).join("\n")).toContain("row");
  });

  it("numbered-grid keeps 3-up long body text readable instead of shrinking to caption size", () => {
    const slide: SlideV2 = {
      id: "numbered-readable",
      title: "创业窗口与投资判断",
      children: [{
        id: "windows",
        type: "numbered-grid",
        columns: 3,
        items: [
          { title: "EU 主权云版 Browserbase", body: "EU AWS Sovereign Cloud €7.8B + GDPR；与 OVHcloud/Scaleway 合作，切入德/法 fintech/医疗政府场景" },
          { title: "亚洲本地基建（日/印）", body: "日本无本地 Browserbase，金融/医疗/政府 Agent 化空白；印度 UPI/Aadhaar Agent 化" },
          { title: "垂直专用 Agent Browser", body: "金融/医疗/游戏，可审计 replay + HIPAA BAA 等垂直合规，Anchor 已做金融" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const body = findRenderedByName(ast, "numbered-readable.windows.0.body") as { paragraphs?: Array<{ runs: Array<{ sizeHalfPt?: number }> }> } | undefined;
    expect(body?.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt).toBeGreaterThanOrEqual(20);
    const severeShrink = getRenderDiagnostics().filter((d) => d.code === "TRUNCATED" && d.severity === "error" && /windows\.\d+\.body/.test(String(d.nodeId || "")));
    expect(severeShrink, severeShrink.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("fact-list strip gives long facts enough height for readable text", () => {
    const slide: SlideV2 = {
      id: "fact-strip-readable",
      title: "投资判断",
      children: [{
        id: "invest",
        type: "fact-list",
        variant: "strip",
        items: [
          { label: "最该跟踪", fact: "Browser Use（86k stars，下一轮 $300-500M）、Anchor Browser（8200 团队）、Steel.dev（欧洲自托管）" },
          { label: "18 个月格局", fact: "Browserbase 走向 IPO（2027 末估值 $1.5-2.5B），开源派分化，法律风险压制激进打法，合规玩家受益" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const fact = findRenderedByName(ast, "fact-strip-readable.invest.1.fact") as { paragraphs?: Array<{ runs: Array<{ sizeHalfPt?: number }> }> } | undefined;
    expect(fact?.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt).toBeGreaterThanOrEqual(19);
  });

  it("stat-strip separators stay centered on the stat text block when parent height grows", () => {
    const slide: SlideV2 = {
      id: "stat-align",
      children: [{
        id: "wrap",
        type: "stack",
        direction: "vertical",
        fixedHeight: 5,
        children: [{
          id: "stats",
          type: "stat-strip",
          items: [
            { value: "3", label: "核心赛道" },
            { value: "$300M+", label: "头部估值" },
            { value: "2026-2027", label: "黄金窗口" },
          ],
        }],
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const value = findRenderedByName(ast, "stat-align.stats.1.value") as { xfrm?: { y: number; cy: number } } | undefined;
    const label = findRenderedByName(ast, "stat-align.stats.1.label") as { xfrm?: { y: number; cy: number } } | undefined;
    const sep = findRenderedByName(ast, "stat-align.stats.sep1") as { xfrm?: { y: number; cy: number } } | undefined;
    expect(value?.xfrm && label?.xfrm && sep?.xfrm).toBeTruthy();
    const textCenter = (value!.xfrm!.y + label!.xfrm!.y + label!.xfrm!.cy) / 2;
    const sepCenter = sep!.xfrm!.y + sep!.xfrm!.cy / 2;
    expect(Math.abs(textCenter - sepCenter) / 360000).toBeLessThan(0.25);
  });

  it("comparison-list basis becomes a readable statement when no separate title is present", () => {
    const slide: SlideV2 = {
      id: "comparison",
      children: [{
        id: "comparison.list",
        type: "comparison-list",
        basis: "内饰战略从「效率」转向「豪华」",
        items: [
          { title: "过去", body: "效率优先" },
          { title: "未来", body: "豪华升级" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const basis = findRenderedByName(ast, "comparison.list.basis") as { paragraphs?: Array<{ runs: Array<{ sizeHalfPt?: number }> }> } | undefined;
    expect(basis?.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt).toBeGreaterThanOrEqual(26);
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
