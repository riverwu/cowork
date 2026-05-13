import { describe, expect, it } from "vitest";
import { clearRenderDiagnostics, getRenderDiagnostics } from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";
import { validateDeck } from "./validate.js";

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

const WIDE_SVG_DATA_URL = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="160"><rect width="800" height="160" fill="#2563eb"/></svg>').toString("base64")}`;

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
    expect(chartFit?.severity).toBe("error");
    expect(chartFit?.suggestion).toMatch(/4\.8x3\.0cm|60-75%|follow-up slide/i);
    expect(chartFit?.measured).toMatchObject({ minWidthCm: 4.8, minHeightCm: 3, labelCount: 5 });
    expect(chartFit?.measured?.outerNeededHeightCm).toBeGreaterThan(chartFit?.measured?.bodyNeededHeightCm ?? 0);
  });

  it("low-density bar chart near the recommended height warns instead of blocking the slide", () => {
    const slide: SlideV2 = {
      id: "compact-bar",
      title: "三组部署对比",
      children: [{
        id: "compact.chart",
        type: "chart-card",
        at: [1.2, 2.4, 9.0, 3.55],
        chartType: "bar",
        title: "Incident Count",
        labels: ["Pilot", "Expansion", "Enterprise"],
        series: [{ name: "Incidents", values: [9, 6, 3] }],
        showLegend: false,
      } as never],
    };
    const diagnostics = allDiagnostics(slide);
    const chartFit = diagnostics.find((d) => d.code === "SQUASHED" && d.nodeId === "compact-bar.compact.chart.chart");
    expect(chartFit, diagnostics.map((d) => `${d.severity}:${d.code}:${d.nodeId}:${d.message}`).join("\n")).toBeDefined();
    expect(chartFit?.severity).toBe("warn");
    expect(chartFit?.measured?.hardMinHeightCm).toBeLessThan(chartFit?.measured?.minHeightCm ?? 0);
  });

  it("overloaded evidence slides emit page-level split guidance before repeated local squeezing", () => {
    const slide: SlideV2 = {
      id: "evidence-overload",
      title: "Structured Evidence Panels Reduce Diagnostic Review Latency",
      children: [
        {
          id: "ev.chart",
          type: "chart-card",
          chartType: "bar",
          title: "Incident Count by Deployment Segment",
          labels: ["Pilot", "Expansion", "Enterprise"],
          series: [{ name: "Incidents", values: [9, 6, 3] }],
          caption: "Source: internal benchmark",
        } as never,
        {
          id: "ev.table",
          type: "table-card",
          title: "Segment Performance Summary",
          density: "compact",
          headers: ["Segment", "ARR", "Retention", "Incidents"],
          rows: [
            ["Pilot", "12.4", "78%", "9"],
            ["Expansion", "18.7", "84%", "6"],
            ["Enterprise", "31.2", "91%", "3"],
          ],
          caption: "N=120 cases per segment",
        } as never,
        {
          id: "ev.equation",
          type: "equation",
          label: "F1 Score",
          latex: "F_1 = \\frac{2 \\cdot \\text{Precision} \\cdot \\text{Recall}}{\\text{Precision} + \\text{Recall}}",
          caption: "Diagnostic accuracy metric",
        } as never,
        {
          id: "ev.citation",
          type: "callout",
          tone: "brand",
          content: [{ text: "Smith et al. 2025 reported lower review latency with structured evidence panels." }],
        } as never,
      ],
    };
    const diagnostics = allDiagnostics(slide);
    const page = diagnostics.find((d) => d.code === "PAGE_OVER_CAPACITY");
    expect(page, diagnostics.map((d) => `${d.severity}:${d.code}:${d.nodeId}:${d.message}:${d.suggestion}`).join("\n")).toBeDefined();
    expect(page?.suggestion).toMatch(/Split this page|follow-up slide|move secondary support/i);
    expect(page?.measured?.componentCount).toBeGreaterThanOrEqual(3);
    expect(page?.measured?.components?.some((item) => item.role === "chart-card")).toBe(true);
    expect(page?.measured?.components?.some((item) => item.role === "table-card")).toBe(true);
    expect(page?.measured?.components?.some((item) => item.role === "equation")).toBe(true);
  });

  it("overloaded split rails emit region-level guidance even when the whole page has capacity", () => {
    const slide: SlideV2 = {
      id: "rail-overload",
      title: "Research Evidence — Platform Performance by Segment",
      children: [{
        type: "split",
        direction: "horizontal",
        ratio: 0.58,
        gap: 0.5,
        children: [
          {
            type: "table-card",
            title: "Segment Performance",
            density: "compact",
            headers: ["Segment", "ARR ($M)", "Retention", "Incidents"],
            rows: [
              ["Pilot", "12.4", "78%", "9"],
              ["Expansion", "18.7", "84%", "6"],
              ["Enterprise", "31.2", "91%", "3"],
            ],
            caption: "Source: SignalLab internal platform data",
          },
          {
            type: "stack",
            gap: 0.35,
            children: [
              { type: "equation", size: "sm", latex: "F_1 = 2 \\cdot \\frac{P \\times R}{P + R}", align: "center" },
              {
                type: "explanation-block",
                title: "Model Quality",
                body: "F1 Score = 89% (Precision 91%, Recall 87%). Target SLA: F1 >= 85%. Reviewed quarterly by clinical governance board.",
                tone: "brand",
                variant: "panel",
              },
              { type: "quote", text: "Structured evidence panels significantly reduce diagnostic review latency.", source: "Smith et al. 2025" },
              { type: "source-note", text: "Smith et al. 2025 reported latency reduction. Internal: triage 42 to 18 min across 120 cases." },
            ],
          },
        ],
      } as never],
    };
    const diagnostics = allDiagnostics(slide);
    const region = diagnostics.find((d) => d.code === "REGION_OVER_CAPACITY");
    expect(region, diagnostics.map((d) => `${d.severity}:${d.code}:${d.nodeId}:${d.message}:${d.suggestion}`).join("\n")).toBeDefined();
    expect(region?.suggestion).toMatch(/region-level capacity|follow-up slide|rebalance the split/i);
    expect(region?.measured?.relationship).toBe("split-region-capacity");
    expect(region?.measured?.components?.some((item) => item.role === "equation")).toBe(true);
  });

  it("two-column accepts left/right children shorthand and normalizes embedded ids", () => {
    const report = validateDeck({
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "two-col-short",
        title: "Two-column shorthand",
        children: [{
          id: "two-col",
          type: "two-column",
          left: {
            children: [
              { type: "chart-card", chartType: "bar", labels: ["A", "B"], series: [{ name: "S", values: [1, 2] }] },
            ],
          },
          right: {
            children: [
              { type: "text", text: "Interpretation rail" },
            ],
          },
        } as never],
      }],
    });
    const schemaErrors = report.errors.filter((issue) => issue.code === "MISSING_NODE_ID" || issue.code === "MISSING_NODE_TYPE");
    expect(schemaErrors, report.errors.map((issue) => `${issue.code}:${issue.path}:${issue.message}`).join("\n")).toHaveLength(0);
    const diagnostics = allDiagnostics({
      id: "two-col-short",
      title: "Two-column shorthand",
      children: [{
        id: "two-col",
        type: "two-column",
        left: { children: [{ type: "text", text: "Left shorthand body" }] },
        right: { children: [{ type: "text", text: "Right shorthand body" }] },
      } as never],
    });
    expect(diagnostics.some((d) => /MISSING_NODE/.test(d.code))).toBe(false);
  });

  it("accepts common numeric column type aliases in data encodings", () => {
    const report = validateDeck({
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          segments: {
            rows: [
              { segment: "Pilot", arr: 12.4, incidents: 9 },
              { segment: "Expansion", arr: 18.7, incidents: 6 },
            ],
          },
        },
      },
      slides: [{
        id: "column-aliases",
        title: "Column type aliases",
        children: [{
          id: "alias.table",
          type: "table-card",
          bind: { source: "segments" },
          encoding: {
            columns: [
              { key: "segment", label: "Segment" },
              { key: "arr", label: "ARR", type: "decimal" },
              { key: "incidents", label: "Incidents", type: "int" },
            ],
          },
        } as never],
      }],
    });
    expect(report.errors.filter((issue) => issue.code === "INVALID_DATA_ENCODING_COLUMN_TYPE"), report.errors.map((issue) => `${issue.code}:${issue.path}`).join("\n")).toHaveLength(0);
  });

  it("chart-card flags overly flat multi-series line charts even when minimum height passes", () => {
    const slide: SlideV2 = {
      id: "line-aspect",
      title: "LobsterAI 用户留存分析",
      children: [
        {
          id: "subtitle",
          type: "text",
          kind: "paragraph",
          content: "4 个 Cohort 的 7 日留存曲线与关键指标摘要。",
          color: "text.muted",
        } as never,
        {
          id: "chart-cohort",
          type: "chart-card",
          title: "各 Cohort 7日留存曲线",
          chartType: "line",
          labels: ["次日", "2日", "3日", "4日", "5日", "6日", "7日"],
          series: [
            { name: "05-03", values: [62, 48, 41, 35, 31, 28, 24] },
            { name: "05-04", values: [59, 46, 39, 34, 29, 25, 22] },
            { name: "05-05", values: [56, 43, 37, 31, 27, 23, 20] },
            { name: "05-06", values: [54, 41, 35, 29, 25, 21, 18] },
          ],
          xAxis: { title: "留存天数" },
          yAxis: { title: "留存率（%）", min: 0, max: 70, numberFormat: "int", gridlines: true },
          legend: { show: true, position: "bottom" },
        } as never,
        {
          id: "kpi-strip",
          type: "kpi-grid",
          columns: 4,
          metrics: [
            { value: "62%", label: "首日最佳" },
            { value: "24%", label: "7日留存" },
            { value: "-6pp", label: "尾部差距" },
            { value: "4组", label: "Cohort" },
          ],
        } as never,
      ],
    };
    const diagnostics = allDiagnostics(slide);
    const chartFit = diagnostics.find((d) => d.code === "SQUASHED" && d.nodeId === "line-aspect.chart-cohort.chart");
    expect(chartFit, diagnostics.map((d) => `${d.code}:${d.nodeId}:${d.message}:${d.suggestion}`).join("\n")).toBeDefined();
    expect(chartFit?.severity).toBe("error");
    expect(chartFit?.message).toMatch(/aspect ratio|too flat|needs about/i);
    expect(chartFit?.suggestion).toMatch(/target about|reduce body width|rail|follow-up slide/i);
    expect(chartFit?.measured?.minHeightCm).toBeLessThanOrEqual(chartFit?.measured?.available ?? 0);
    expect(chartFit?.measured?.aspectRatio).toBeGreaterThan(chartFit?.measured?.maxAspectRatio ?? 99);
    expect(chartFit?.measured?.needed).toBeGreaterThan(chartFit?.measured?.available ?? 0);
  });

  it("chart-with-rail warns when the evidence region loses the dominant share", () => {
    const slide: SlideV2 = {
      id: "evidence-ratio",
      title: "证据页比例失衡",
      children: [{
        id: "rail-heavy",
        type: "chart-with-rail",
        ratio: [0.34, 0.66],
        evidence: {
          id: "rail-heavy.chart",
          type: "chart-card",
          title: "收入结构",
          chartType: "bar",
          labels: ["A", "B", "C"],
          series: [{ name: "收入", values: [12, 18, 9] }],
        },
        headline: "解释区过宽",
        detail: "这页的证据对象应该主导页面，而不是被解释栏挤压。解释内容可以放到下一页或者缩短为几个要点。",
      } as never],
    };
    const diagnostics = allDiagnostics(slide);
    const evidenceRatio = diagnostics.find((d) => d.code === "EVIDENCE_REGION_TOO_SMALL");
    expect(evidenceRatio, diagnostics.map((d) => `${d.severity}:${d.code}:${d.nodeId}:${d.message}:${d.suggestion}`).join("\n")).toBeDefined();
    expect(evidenceRatio?.suggestion).toMatch(/adjust the split\/ratio|follow-up slide/i);
    expect(evidenceRatio?.measured?.evidenceRatio).toBeLessThan(evidenceRatio?.measured?.recommendedRatio ?? 0);
  });

  it("image-card reports source/frame aspect mismatch instead of silently distorting evidence", () => {
    const slide: SlideV2 = {
      id: "image-ratio",
      title: "图片比例检查",
      children: [{
        id: "photo",
        type: "image-card",
        at: [1.0, 2.0, 4.0, 6.8],
        src: WIDE_SVG_DATA_URL,
        title: "宽幅证据图",
        fit: "fill",
      } as never],
    };
    const diagnostics = allDiagnostics(slide);
    const aspect = diagnostics.find((d) => d.code === "IMAGE_ASPECT_MISMATCH");
    expect(aspect, diagnostics.map((d) => `${d.severity}:${d.code}:${d.nodeId}:${d.message}:${d.suggestion}`).join("\n")).toBeDefined();
    expect(aspect?.severity).toBe("error");
    expect(aspect?.suggestion).toMatch(/fit:'contain'|match the source aspect ratio/i);
    expect(aspect?.measured?.sourceAspectRatio).toBeGreaterThan(aspect?.measured?.frameAspectRatio ?? 99);
  });

  it("process-flow capacity diagnostics preserve process semantics and suggest layout repair", () => {
    const slide: SlideV2 = {
      id: "flow-capacity",
      title: "流程卡片容量检查",
      children: [{
        id: "tight-flow",
        type: "process-flow",
        at: [1.0, 3.0, 7.2, 2.2],
        variant: "cards",
        direction: "horizontal",
        steps: [
          { title: "定义口径", body: "补充数据边界、样本条件和统计假设。", bullets: ["统一字段", "确认周期"] },
          { title: "清洗数据", body: "识别缺失值、异常值与重复记录。", bullets: ["保留审计轨迹", "输出日志"] },
          { title: "建模对比", body: "比较基线、分群和显著性结果。", bullets: ["保留置信区间", "解释偏差"] },
          { title: "发布结论", body: "形成页面叙事与后续行动建议。", bullets: ["标注来源", "同步负责人"] },
        ],
      } as never],
    };
    const diagnostics = allDiagnostics(slide);
    const capacity = diagnostics.find((d) => d.code === "PROCESS_FLOW_OVER_CAPACITY");
    expect(capacity, diagnostics.map((d) => `${d.severity}:${d.code}:${d.nodeId}:${d.message}:${d.suggestion}`).join("\n")).toBeDefined();
    expect(capacity?.suggestion).toMatch(/Keep process-flow semantics|vertical direction|scale:'sm'/i);
    expect(capacity?.measured?.stepCount).toBe(4);
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
    const featureGuidance = diagnostics.find((d) => d.code === "FEATURE_CARD_OVER_CAPACITY");
    expect(featureGuidance, diagnostics.map((d) => `${d.code}:${d.nodeId}:${d.suggestion}`).join("\n")).toBeDefined();
    expect(featureGuidance?.suggestion).toMatch(/fewer columns|split feature groups|density:'compact'/i);
    expect(featureGuidance?.nodeId).toBe("feature.card");
    const bodyDrop = diagnostics.find((d) => d.code === "DROP" && d.nodeId === "feature-overload.feature.card.body");
    expect(bodyDrop, diagnostics.map((d) => `${d.code}:${d.nodeId}`).join("\n")).toBeUndefined();
  });
});
