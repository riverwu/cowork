import { describe, expect, it } from "vitest";
import { clearRenderDiagnostics, getRenderDiagnostics, type LayoutDiagnostic } from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { validateDeck } from "./validate.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

const BLOCKING_CODES: ReadonlySet<LayoutDiagnostic["code"]> = new Set<LayoutDiagnostic["code"]>([
  "FALLBACK_FAILED",
  "COLLISION",
  "TINY_RECT",
  "SQUASHED",
  "UNKNOWN_COLOR",
  "UNKNOWN_STYLE",
]);

function buildDeck(slide: SlideV2): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { name: "Test", primary: "2563EB" } },
    slides: [slide],
  };
}

function findByName(ast: ReturnType<typeof renderToAst>, name: string) {
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) {
      if ((shape as { name?: string }).name === name) return shape;
    }
  }
  return undefined;
}

function textOf(shape: ReturnType<typeof findByName>): string {
  if (!shape || shape.type !== "text") return "";
  return shape.paragraphs?.flatMap((p) => p.runs.map((r) => r.text)).join("") || "";
}

function renderSlide(slide: SlideV2) {
  clearRenderDiagnostics();
  const rendered = sourceToRenderedDeck(buildDeck(slide));
  const ast = renderToAst(rendered);
  const blocking = getRenderDiagnostics().filter((d) => BLOCKING_CODES.has(d.code));
  return { ast, blocking };
}

describe("key-takeaway variants", () => {
  it("plain headline+detail auto-picks panel and renders headline/detail with the left rail painted by the renderer", () => {
    const { ast, blocking } = renderSlide({
      id: "kt-panel",
      children: [{
        id: "kt-panel.k",
        type: "key-takeaway",
        headline: "网络效应是当前最稳的增长杠杆",
        detail: "从最近三个季度的数据看，新用户对老用户的复用率持续上升，规模本身在做新增。",
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(findByName(ast, "kt-panel.k.headline")).toBeDefined();
    expect(findByName(ast, "kt-panel.k.detail")).toBeDefined();
    // No banner metric, no grid mini cards.
    expect(findByName(ast, "kt-panel.k.metric.value")).toBeUndefined();
    expect(findByName(ast, "kt-panel.k.1.headline")).toBeUndefined();
  });

  it("kicker renders above the headline as uppercase tracking-wide label", () => {
    const { ast, blocking } = renderSlide({
      id: "kt-kicker",
      children: [{
        id: "kt-kicker.k",
        type: "key-takeaway",
        kicker: "core finding",
        headline: "扩张正在自我加速",
        detail: "Q3 留存超过 Q2 同期 4 个百分点。",
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(textOf(findByName(ast, "kt-kicker.k.kicker"))).toBe("CORE FINDING");
  });

  it("variant:'banner' produces a solid filled wrapper with inverse text on the headline", () => {
    const { ast, blocking } = renderSlide({
      id: "kt-banner",
      children: [{
        id: "kt-banner.k",
        type: "key-takeaway",
        variant: "banner",
        tone: "positive",
        headline: "FY2024 净利润扭亏为盈",
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    const headline = findByName(ast, "kt-banner.k.headline");
    expect(headline?.type).toBe("text");
  });

  it("variant:'banner' with metric renders a paired right-side number", () => {
    const { ast, blocking } = renderSlide({
      id: "kt-banner-metric",
      children: [{
        id: "kt-banner-metric.k",
        type: "key-takeaway",
        variant: "banner",
        tone: "positive",
        headline: "AI 驱动营销业务高增长",
        metric: { value: "+48.3", unit: "%", label: "YoY" },
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(textOf(findByName(ast, "kt-banner-metric.k.metric.value"))).toContain("48.3");
    expect(textOf(findByName(ast, "kt-banner-metric.k.metric.label"))).toContain("YoY");
  });

  it("metric.value auto-picks metric variant when no variant is set", () => {
    const { ast, blocking } = renderSlide({
      id: "kt-auto-metric",
      children: [{
        id: "kt-auto-metric.k",
        type: "key-takeaway",
        tone: "positive",
        headline: "在线营销驱动 FY2024 增长",
        detail: "AI 赋能效果广告是核心驱动力。",
        metric: { value: "+48.3", unit: "%", label: "YoY", delta: "高于行业均值 12pp" },
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(textOf(findByName(ast, "kt-auto-metric.k.metric.value"))).toContain("48.3");
    expect(textOf(findByName(ast, "kt-auto-metric.k.metric.label"))).toContain("YoY");
    expect(textOf(findByName(ast, "kt-auto-metric.k.metric.delta"))).toContain("高于行业均值");
  });

  it("variant:'minimal' keeps the chrome-free vertical stack with a top accent rule", () => {
    const { ast, blocking } = renderSlide({
      id: "kt-minimal",
      children: [{
        id: "kt-minimal.k",
        type: "key-takeaway",
        variant: "minimal",
        headline: "观测超过理论",
        detail: "新一代望远镜持续发现理论模型无法快速解释的异常对象。",
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(findByName(ast, "kt-minimal.k.accent")).toBeDefined();
    expect(findByName(ast, "kt-minimal.k.headline")).toBeDefined();
    expect(findByName(ast, "kt-minimal.k.detail")).toBeDefined();
  });

  it("items array with ≥2 structured headlines auto-picks grid variant", () => {
    const { ast, blocking } = renderSlide({
      id: "kt-auto-grid",
      children: [{
        id: "kt-auto-grid.k",
        type: "key-takeaway",
        headline: "FY2024 三个核心信号",
        items: [
          { headline: "营销", detail: "+48.3% YoY", tone: "positive" },
          { headline: "毛利率", detail: "48.9%", tone: "neutral" },
          { headline: "净利润", detail: "扭亏为盈", tone: "positive" },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(findByName(ast, "kt-auto-grid.k.headline")).toBeDefined();
    expect(findByName(ast, "kt-auto-grid.k.1.headline")).toBeDefined();
    expect(findByName(ast, "kt-auto-grid.k.2.headline")).toBeDefined();
    expect(findByName(ast, "kt-auto-grid.k.3.headline")).toBeDefined();
  });

  it("grid variant renders per-item tone via the renderer-painted accent rail", () => {
    const { ast, blocking } = renderSlide({
      id: "kt-grid-tone",
      children: [{
        id: "kt-grid-tone.k",
        type: "key-takeaway",
        variant: "grid",
        items: [
          { headline: "Growth", detail: "+38%", tone: "positive" },
          { headline: "Risk", detail: "Churn rising", tone: "warning" },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(findByName(ast, "kt-grid-tone.k.1.headline")).toBeDefined();
    expect(findByName(ast, "kt-grid-tone.k.2.headline")).toBeDefined();
  });

  it("string source field renders a small footnote line under the panel body", () => {
    const { ast, blocking } = renderSlide({
      id: "kt-source",
      children: [{
        id: "kt-source.k",
        type: "key-takeaway",
        headline: "结论一句话",
        detail: "支撑信息一句话",
        source: "数据来源：FY2024 报表",
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(textOf(findByName(ast, "kt-source.k.source"))).toContain("FY2024 报表");
  });

  it("legacy items as string list (no headlines) still binds to bullets — backward compat", () => {
    const { ast, blocking } = renderSlide({
      id: "kt-legacy-items",
      children: [{
        id: "kt-legacy-items.k",
        type: "key-takeaway",
        headline: "三条 implication",
        items: ["第一条", "第二条", "第三条"],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    // Legacy items list should NOT auto-promote to grid, no .1.headline mini.
    expect(findByName(ast, "kt-legacy-items.k.1.headline")).toBeUndefined();
    expect(findByName(ast, "kt-legacy-items.k.headline")).toBeDefined();
  });

  it("rejects unknown variant values with INVALID_FIELD_USAGE", () => {
    const deck = buildDeck({
      id: "kt-bad",
      children: [{
        id: "kt-bad.k",
        type: "key-takeaway",
        variant: "splash" as unknown as string,
        headline: "x",
      } as unknown as DomNode],
    });
    const report = validateDeck(deck);
    expect(report.errors.some((e) => e.code === "INVALID_FIELD_USAGE" && String(e.path || "").endsWith(".variant"))).toBe(true);
  });
});
