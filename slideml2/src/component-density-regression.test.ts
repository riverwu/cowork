import { describe, expect, it } from "vitest";
import { clearRenderDiagnostics, getRenderDiagnostics } from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";

const BLOCKING = new Set(["FALLBACK_FAILED", "SQUASHED", "TINY_RECT", "TRUNCATED"]);

function deck(slide: SlideV2): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default" },
    slides: [slide],
  };
}

function blockingDiagnostics(slide: SlideV2) {
  clearRenderDiagnostics();
  renderToAst(sourceToRenderedDeck(deck(slide)));
  return getRenderDiagnostics().filter((d) => d.severity === "error" && BLOCKING.has(d.code));
}

function allDiagnostics(slide: SlideV2) {
  clearRenderDiagnostics();
  renderToAst(sourceToRenderedDeck(deck(slide)));
  return getRenderDiagnostics();
}

describe("dense data component regressions from live PPT flow", () => {
  it("stat-strip keeps CJK business metrics readable without value squashing", () => {
    const slide: SlideV2 = {
      id: "financials",
      title: "财务亮点：首次实现全年盈利，AI商业化突破",
      children: [{
        id: "fin.stats",
        type: "stat-strip",
        items: [
          { value: "56.3亿", label: "2024收入", tone: "brand" },
          { value: "8220万", label: "经营利润", tone: "positive" },
          { value: "-19.6%", label: "智能设备变化", tone: "warning" },
        ],
      } as never],
    };
    const blocking = blockingDiagnostics(slide);
    expect(blocking, blocking.map((d) => `${d.code}:${d.nodeId}:${d.message}`).join("\n")).toHaveLength(0);
  });

  it("stat-strip narrow cells rely on real text fit instead of generic container width", () => {
    const slide: SlideV2 = {
      id: "eco",
      title: "生态资源",
      children: [{
        id: "eco.strip",
        type: "stat-strip",
        at: [20.5, 2.0, 1.75, 2.05],
        items: [
          { value: "3座", label: "国家公园", tone: "positive" },
        ],
      } as never],
    };
    const diagnostics = allDiagnostics(slide);
    const squashedErrors = diagnostics.filter((d) => d.code === "SQUASHED" && d.severity === "error");
    expect(squashedErrors, diagnostics.map((d) => `${d.severity}:${d.code}:${d.nodeId}:${d.message}`).join("\n")).toHaveLength(0);
  });

  it("kpi-grid handles mixed CJK units and negative percentages without compressed value boxes", () => {
    const slide: SlideV2 = {
      id: "kpis",
      title: "关键经营指标",
      children: [{
        id: "kpis.grid",
        type: "kpi-grid",
        columns: 3,
        metrics: [
          { value: "56.3亿", label: "年度收入", trend: "up" },
          { value: "8220万", label: "经营利润", trend: "up" },
          { value: "-19.6%", label: "智能设备收入变化", trend: "down" },
        ],
      } as never],
    };
    const blocking = blockingDiagnostics(slide);
    expect(blocking, blocking.map((d) => `${d.code}:${d.nodeId}:${d.message}`).join("\n")).toHaveLength(0);
  });

  it("numbered equations keep the equation number in a small readable slot", () => {
    const slide: SlideV2 = {
      id: "equations",
      title: "牛顿第二定律",
      children: [{
        id: "eq.wrap",
        type: "grid",
        columns: 2,
        gap: 0.35,
        children: [
          { id: "eq.one", type: "equation", label: "微分形式", latex: "F=\\frac{dp}{dt}", number: "2.1" },
          { id: "eq.two", type: "equation", label: "恒质量形式", latex: "F=ma", number: "2.2" },
        ],
      } as never],
    };
    const blocking = blockingDiagnostics(slide);
    expect(blocking, blocking.map((d) => `${d.code}:${d.nodeId}:${d.message}`).join("\n")).toHaveLength(0);
  });

  it("four compact numbered equations fit as a 2x2 formula grid", () => {
    const slide: SlideV2 = {
      id: "formula-grid",
      title: "核心公式速记",
      children: [{
        id: "formula.grid",
        type: "grid",
        columns: 2,
        gap: 0.28,
        children: [
          { id: "formula.one", type: "equation", label: "动量定理", latex: "F=\\frac{dp}{dt}", number: "1", size: "sm" },
          { id: "formula.two", type: "equation", label: "恒质量", latex: "F=ma", number: "2", size: "sm" },
          { id: "formula.three", type: "equation", label: "万有引力", latex: "F=G\\frac{m_1m_2}{r^2}", number: "3", size: "sm" },
          { id: "formula.four", type: "equation", label: "机械能", latex: "E_k+E_p=\\frac12mv^2+mgh", number: "4", size: "sm" },
        ],
      } as never],
    };
    const blocking = blockingDiagnostics(slide);
    expect(blocking, blocking.map((d) => `${d.code}:${d.nodeId}:${d.message}`).join("\n")).toHaveLength(0);
  });

  it("table-card overflow reports an actionable row/column capacity diagnostic", () => {
    const longCell = "该指标需要解释统计口径、同比变化、业务含义和风险边界，不能压成单行。";
    const slide: SlideV2 = {
      id: "dense-table",
      title: "财务指标表",
      children: [{
        id: "dense.table-card",
        type: "table-card",
        title: "核心指标",
        fixedHeight: 2.2,
        headers: ["指标", "说明", "影响"],
        rows: [
          ["收入", longCell, longCell],
          ["利润", longCell, longCell],
          ["现金流", longCell, longCell],
          ["研发", longCell, longCell],
        ],
      } as never],
    };
    const diagnostics = allDiagnostics(slide);
    const tableFit = diagnostics.find((d) => d.code === "FALLBACK_FAILED" && /Table/.test(d.message));
    expect(tableFit, diagnostics.map((d) => `${d.code}:${d.nodeId}:${d.message}:${d.suggestion}`).join("\n")).toBeDefined();
    expect(tableFit?.suggestion).toMatch(/4\.5-6cm|rowHeights|columns|paginate|widen/i);
    expect(tableFit?.measured).toMatchObject({ dataRowCount: 4, columnCount: 3 });
    expect(typeof tableFit?.measured?.estimatedVisibleRowsFit).toBe("number");
  });

  it("chart-card overflow reports explicit body-size and layout-ratio guidance", () => {
    const slide: SlideV2 = {
      id: "chart-too-short",
      title: "渠道趋势",
      children: [{
        id: "tight.chart",
        type: "chart-card",
        fixedHeight: 2.4,
        chartType: "bar",
        labels: ["天猫", "京东", "抖音", "达播", "线下"],
        series: [{ name: "ROI", values: [27.4, 28.3, 10.3, 9.6, 2.7] }],
      } as never],
    };
    const diagnostics = allDiagnostics(slide);
    const chartFit = diagnostics.find((d) => d.code === "SQUASHED" && /Chart/.test(d.message));
    expect(chartFit, diagnostics.map((d) => `${d.code}:${d.nodeId}:${d.message}:${d.suggestion}`).join("\n")).toBeDefined();
    expect(chartFit?.suggestion).toMatch(/4\.8x3\.0cm|60-75%|follow-up slide/i);
    expect(chartFit?.measured).toMatchObject({ minWidthCm: 4.8, minHeightCm: 3, labelCount: 5 });
  });

  it("overloaded feature-cards give component-specific repair guidance", () => {
    const longBody = "支持长文本说明、证据标签和补充指标，但在四列网格里必须拆分，否则会丢失主体说明。";
    const slide: SlideV2 = {
      id: "feature-overload",
      title: "能力矩阵",
      children: [{
        id: "feature.card",
        type: "feature-card",
        variant: "card",
        at: [1.0, 3.0, 1.3, 0.8],
        title: "能力密度过高",
        body: longBody,
        proof: "需要保留的证据说明",
        tags: ["数据", "模型", "流程"],
      } as never],
    };
    const diagnostics = allDiagnostics(slide);
    const featureGuidance = diagnostics.find((d) => /feature-card/i.test(d.suggestion || ""));
    expect(featureGuidance, diagnostics.map((d) => `${d.code}:${d.nodeId}:${d.suggestion}`).join("\n")).toBeDefined();
    expect(featureGuidance?.suggestion).toMatch(/fewer columns|split feature groups|density:'compact'/i);
  });
});
