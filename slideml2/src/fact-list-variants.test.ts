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

describe("fact-list variants", () => {
  it("2-3 prose items default to list with per-item rail + label/fact/interpretation/source ids", () => {
    const { ast, blocking } = renderSlide({
      id: "fl-list",
      children: [{
        id: "fl-list.f",
        type: "fact-list",
        title: "三条观察",
        items: [
          { label: "观察一", value: "海拔 3300m", fact: "高反风险显著，建议第一天降低强度。", interpretation: "对老年团尤为关键。", tone: "warning" },
          { label: "观察二", value: "气候多变", fact: "上午晴朗下午阵雨，需备雨具。" },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(findByName(ast, "fl-list.f.title")).toBeDefined();
    expect(findByName(ast, "fl-list.f.1.accent")).toBeDefined();
    expect(findByName(ast, "fl-list.f.1.label")).toBeDefined();
    expect(findByName(ast, "fl-list.f.1.value")).toBeDefined();
    expect(findByName(ast, "fl-list.f.1.fact")).toBeDefined();
    expect(findByName(ast, "fl-list.f.1.interpretation")).toBeDefined();
  });

  it("numeric values auto-pick stat variant; value renders at hero size with tone color", () => {
    const { ast, blocking } = renderSlide({
      id: "fl-stat",
      children: [{
        id: "fl-stat.f",
        type: "fact-list",
        items: [
          { label: "净利率", value: "12.5", unit: "%", delta: "+3pp YoY", fact: "在线营销驱动，效率提升", tone: "positive" },
          { label: "毛利率", value: "48.9", unit: "%", delta: "-2pp YoY", fact: "成本上行压制" },
          { label: "ROE", value: "18.2", unit: "%", delta: "+1pp", fact: "资本回报稳健", tone: "positive" },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(textOf(findByName(ast, "fl-stat.f.1.value"))).toContain("12.5");
    expect(textOf(findByName(ast, "fl-stat.f.1.value"))).toContain("%");
    expect(textOf(findByName(ast, "fl-stat.f.1.delta"))).toContain("+3pp");
    expect(textOf(findByName(ast, "fl-stat.f.1.label"))).toBe("净利率");
  });

  it("URL/file-path values auto-pick sources variant with numbered prefixes", () => {
    const { ast, blocking } = renderSlide({
      id: "fl-src",
      children: [{
        id: "fl-src.f",
        type: "fact-list",
        title: "数据来源",
        items: [
          { label: "财务报表", value: "FY2024_annual.xlsx", fact: "公司官网披露的全年合并报表" },
          { label: "研究报告", value: "https://example.com/research/q3", fact: "第三方券商研报，需登录" },
          { label: "宏观数据", value: "/data/macro/cpi.csv", fact: "央行月度 CPI 序列" },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(textOf(findByName(ast, "fl-src.f.1.num"))).toBe("1.");
    expect(textOf(findByName(ast, "fl-src.f.3.num"))).toBe("3.");
    expect(textOf(findByName(ast, "fl-src.f.1.label"))).toBe("财务报表");
    expect(textOf(findByName(ast, "fl-src.f.1.value"))).toContain("FY2024_annual.xlsx");
  });

  it("sources variant with numbered:false suppresses the number prefix", () => {
    const { ast, blocking } = renderSlide({
      id: "fl-src-nonum",
      children: [{
        id: "fl-src-nonum.f",
        type: "fact-list",
        variant: "sources",
        numbered: false,
        items: [
          { label: "报告", value: "report.pdf" },
          { label: "数据", value: "dataset.csv" },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(findByName(ast, "fl-src-nonum.f.1.num")).toBeUndefined();
    expect(findByName(ast, "fl-src-nonum.f.1.label")).toBeDefined();
  });

  it("4+ short items auto-flow into grid variant with per-cell surface", () => {
    const { ast, blocking } = renderSlide({
      id: "fl-grid",
      children: [{
        id: "fl-grid.f",
        type: "fact-list",
        items: [
          { label: "A", fact: "第一条" },
          { label: "B", fact: "第二条" },
          { label: "C", fact: "第三条" },
          { label: "D", fact: "第四条" },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(findByName(ast, "fl-grid.f.1.label")).toBeDefined();
    expect(findByName(ast, "fl-grid.f.4.label")).toBeDefined();
  });

  it("legacy variant:'list' with 5+ items still auto-promotes to grid (backward-compat)", () => {
    const { ast, blocking } = renderSlide({
      id: "fl-legacy",
      children: [{
        id: "fl-legacy.f",
        type: "fact-list",
        variant: "list",
        items: [
          { label: "A", fact: "第一条" },
          { label: "B", fact: "第二条" },
          { label: "C", fact: "第三条" },
          { label: "D", fact: "第四条" },
          { label: "E", fact: "第五条" },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(findByName(ast, "fl-legacy.f.5.label")).toBeDefined();
  });

  it("strip variant produces side-by-side cells; fact stays at body size (≥9.5pt)", () => {
    const { ast, blocking } = renderSlide({
      id: "fl-strip",
      children: [{
        id: "fl-strip.f",
        type: "fact-list",
        variant: "strip",
        items: [
          { label: "Q3", value: "+18%", fact: "三季度收入同比", tone: "positive" },
          { label: "Q4", value: "+12%", fact: "四季度收入同比" },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    const fact = findByName(ast, "fl-strip.f.1.fact");
    expect(fact?.type).toBe("text");
    if (fact?.type === "text") {
      const size = fact.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt ?? 0;
      expect(size).toBeGreaterThanOrEqual(19);
    }
  });

  it("top-level source renders as a small footer note", () => {
    const { ast, blocking } = renderSlide({
      id: "fl-footer",
      children: [{
        id: "fl-footer.f",
        type: "fact-list",
        title: "几个数据点",
        items: [
          { label: "A", fact: "第一条" },
          { label: "B", fact: "第二条" },
        ],
        source: "数据来源：FY2024 财报",
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(textOf(findByName(ast, "fl-footer.f.source"))).toContain("FY2024 财报");
  });

  it("rejects unknown variant values with INVALID_FIELD_USAGE", () => {
    const deck = buildDeck({
      id: "fl-bad",
      children: [{
        id: "fl-bad.f",
        type: "fact-list",
        variant: "splash" as unknown as string,
        items: [{ label: "x", fact: "y" }],
      } as unknown as DomNode],
    });
    const report = validateDeck(deck);
    expect(report.errors.some((e) => e.code === "INVALID_FIELD_USAGE" && String(e.path || "").endsWith(".variant"))).toBe(true);
  });

  it("explicit variant:'columns' is mapped to list (legacy alias)", () => {
    const { ast, blocking } = renderSlide({
      id: "fl-cols",
      children: [{
        id: "fl-cols.f",
        type: "fact-list",
        variant: "columns" as unknown as string,
        items: [
          { label: "X", fact: "第一条" },
          { label: "Y", fact: "第二条" },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(findByName(ast, "fl-cols.f.1.label")).toBeDefined();
  });
});
