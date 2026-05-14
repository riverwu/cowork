import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { clearRenderDiagnostics, getRenderDiagnostics } from "./diagnostics.js";
import { renderToAst, renderToPptx } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck } from "./types.js";
import { validateDeck } from "./validate.js";

function deck(children: Slideml2SourceDeck["slides"][number]["children"]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default" },
    slides: [{ id: "s", title: "Artifact legality", children }],
  };
}

describe("final artifact legality", () => {
  it("source slide transition aliases emit real PPTX transition XML", async () => {
    const source = deck([{ id: "s.body", type: "text", text: "Transition alias", style: "body" } as never]);
    source.slides[0]!.transition = { type: "slideIn", direction: "push", duration: 0.8 };

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-transition-alias-")), "transition.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");

    expect(slideXml).toContain("<p:transition");
    expect(slideXml).toContain('dur="800"');
    expect(slideXml).toContain("<p:push");
  });

  it("invalid slide transitions fail source validation instead of being silently dropped", () => {
    const source = deck([{ id: "s.body", type: "text", text: "Bad transition", style: "body" } as never]);
    source.slides[0]!.transition = { type: "spin" as never };

    const report = validateDeck(source);
    expect(report.ok).toBe(false);
    expect(report.errors.some((item) => item.code === "INVALID_SLIDE_TRANSITION")).toBe(true);
  });

  it("table-card object rows with columns.key emit real PPTX cell text", async () => {
    const source = deck([{
      id: "s.table",
      type: "table-card",
      title: "H1 KPI",
      rows: [
        { metric: "营收", h1_2024: "31,602", h1_2025: "29,214", delta: "-7.6%" },
        { metric: "人力成本", h1_2024: "10,103", h1_2025: "7,258", delta: "-28.1%" },
      ],
      columns: [
        { key: "metric", label: "指标", width: 2.4 },
        { key: "h1_2024", label: "H1-2024", width: 2.0 },
        { key: "h1_2025", label: "H1-2025", width: 2.0 },
        { key: "delta", label: "同比变化", width: 1.8 },
      ],
      caption: "Source: workbook",
    } as never]);

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-table-artifact-")), "table.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");

    expect(slideXml).toContain("指标");
    expect(slideXml).toContain("营收");
    expect(slideXml).toContain("31,602");
    expect(slideXml).toContain("-28.1%");
  });

  it("table-card object rows with encoding.columns emit real PPTX cell text", async () => {
    const source = deck([{
      id: "s.sources",
      type: "table-card",
      title: "数据来源清单",
      encoding: {
        columns: [
          { key: "source", label: "来源文件" },
          { key: "sheet", label: "工作表" },
          { key: "range", label: "数据范围" },
          { key: "description", label: "内容说明" },
        ],
      },
      rows: [
        {
          source: "25年上半年人力数据分析-V1.xlsx",
          sheet: "底表",
          range: "A1:S71",
          description: "月度底层数据",
        },
      ],
    } as never]);

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-table-encoding-artifact-")), "table.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");

    expect(slideXml).toContain("来源文件");
    expect(slideXml).toContain("25年上半年人力数据分析-V1.xlsx");
    expect(slideXml).toContain("A1:S71");
  });

  it("table-card object rows with headers emit body values", async () => {
    const source = deck([{
      id: "s.table",
      type: "table-card",
      title: "职能明细",
      headers: ["职能", "人数", "备注"],
      rows: [
        { "职能": "销售", "人数": "150", "备注": "含79外包" },
        { "职能": "研发", "人数": "55", "备注": "" },
        { "职能": { text: "合计", bold: true }, "人数": { text: "276", bold: true }, "备注": { text: "103外包", bold: true } },
      ],
    } as never]);

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-table-headers-object-")), "table.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");

    expect(slideXml).toContain("销售");
    expect(slideXml).toContain("150");
    expect(slideXml).toContain("含79外包");
    expect(slideXml).toContain("合计");
    expect(slideXml).toContain("103外包");
  });

  it("table-card object rows with display headers fuzzy-match common keys", async () => {
    const source = deck([{
      id: "s.table",
      type: "table-card",
      title: "H1 YoY Changes",
      headers: ["Metric", "H1-24", "H1-25", "YoY"],
      rows: [
        { metric: "Revenue", "H1-2024": "31,602", "H1-2025": "29,214", yoy: "-7.6%" },
        { metric: "HR Cost", "H1-2024": "10,103", "H1-2025": "7,258", yoy: "-28.1%" },
      ],
    } as never]);

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-table-headers-fuzzy-")), "table.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");

    expect(slideXml).toContain("Revenue");
    expect(slideXml).toContain("31,602");
    expect(slideXml).toContain("29,214");
    expect(slideXml).toContain("-28.1%");
  });

  it("table-card object rows fall back to object field order for display-only headers", async () => {
    const source = deck([{
      id: "s.table",
      type: "table-card",
      title: "Display headers",
      headers: ["Metric", "Amount"],
      rows: [
        { label: "Revenue", amount: "31,602", tone: "positive" },
        { label: "Cost", amount: "7,258", tone: "warning" },
      ],
    } as never]);

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-table-order-fallback-")), "table.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");

    expect(slideXml).toContain("Revenue");
    expect(slideXml).toContain("31,602");
    expect(slideXml).toContain("Cost");
    expect(slideXml).toContain("7,258");
  });

  it("table-card columns accept field/title aliases for hand-authored object rows", async () => {
    const source = deck([{
      id: "s.table",
      type: "table-card",
      title: "Alias columns",
      columns: [
        { field: "metric", title: "Metric" },
        { field: "h1_2025", title: "H1 2025" },
      ],
      rows: [
        { metric: "Revenue", h1_2025: "29,214" },
        { metric: "ROI", h1_2025: "4.02" },
      ],
    } as never]);

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-table-column-alias-")), "table.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");

    expect(slideXml).toContain("H1 2025");
    expect(slideXml).toContain("Revenue");
    expect(slideXml).toContain("29,214");
    expect(slideXml).toContain("4.02");
  });

  it("primitive tables accept data.headers and data.rows aliases", async () => {
    const source = deck([{
      id: "s.table",
      type: "table",
      data: {
        headers: ["Metric", "Value"],
        rows: [
          { metric: "Revenue", value: "31,602" },
          { metric: "ROI", value: "4.02" },
        ],
      },
    } as never]);

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-table-data-alias-")), "table.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");

    expect(slideXml).toContain("Revenue");
    expect(slideXml).toContain("31,602");
    expect(slideXml).toContain("ROI");
    expect(slideXml).toContain("4.02");
  });

  it("bound table encoding.columns accept field/header aliases", async () => {
    const source: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          metrics: {
            type: "inline-json",
            rows: [
              { metric: "Revenue", h1_2025: 29214 },
              { metric: "ROI", h1_2025: 4.02 },
            ],
          },
        },
      },
      slides: [{
        id: "s",
        title: "Bound aliases",
        children: [{
          id: "s.table",
          type: "table-card",
          bind: { source: "metrics" },
          encoding: {
            columns: [
              { field: "metric", header: "Metric" },
              { field: "h1_2025", header: "H1 2025", type: "number", format: "decimal" },
            ],
          },
        } as never],
      }],
    };

    const validation = validateDeck(source);
    expect(validation.errors, validation.errors.map((item) => item.message).join("\n")).toHaveLength(0);
    const out = join(mkdtempSync(join(tmpdir(), "slideml2-bound-table-alias-")), "table.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");

    expect(slideXml).toContain("H1 2025");
    expect(slideXml).toContain("29,214.0");
    expect(slideXml).toContain("4.02");
  });

  it("unmatched object-row tables report empty table data instead of passing silently", () => {
    clearRenderDiagnostics();
    const source = deck([{
      id: "s.table",
      type: "table-card",
      title: "Bad mapping",
      headers: ["Metric", "Value"],
      rows: [{ label: "", amount: "" }],
    } as never]);

    renderToAst(sourceToRenderedDeck(source));
    const diagnostic = getRenderDiagnostics().find((item) => item.code === "EMPTY_TABLE_DATA");
    expect(diagnostic).toMatchObject({
      severity: "error",
      code: "EMPTY_TABLE_DATA",
      nodeId: "s.table.table",
    });
  });

  it("bound table-card with partial column widths does not emit zero-width PPTX columns", async () => {
    const source: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          h1: {
            type: "inline-json",
            rows: [
              { metric: "营收(万元)", h1_2024: 31602, h1_2025: 29214, yoy: -7.6 },
              { metric: "人力成本(万元)", h1_2024: 10103, h1_2025: 7258, yoy: -28.2 },
            ],
          },
        },
      },
      slides: [{
        id: "s",
        title: "Partial widths",
        children: [{
          id: "s.table",
          type: "table-card",
          title: "H1关键指标对比",
          bind: { source: "h1" },
          encoding: {
            columns: [
              { key: "metric", label: "指标", type: "text", width: 2.5 },
              { key: "h1_2024", label: "H1-2024", type: "number", format: "decimal", align: "right" },
              { key: "h1_2025", label: "H1-2025", type: "number", format: "decimal", align: "right" },
              { key: "yoy", label: "YoY", type: "number", format: "decimal", align: "right" },
            ],
          },
        } as never],
      }],
    };
    const out = join(mkdtempSync(join(tmpdir(), "slideml2-partial-widths-")), "partial-widths.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const widths = Array.from(slideXml.matchAll(/<a:gridCol w="(\d+)"\/>/g)).map((match) => Number(match[1]));

    expect(widths).toHaveLength(4);
    expect(widths.every((width) => width > 0)).toBe(true);
    expect(widths[0]).toBeGreaterThan(widths[1]!);
    expect(slideXml).toContain("31,602.0");
    expect(slideXml).toContain("29,214.0");
  });

  it("data-bound tables nested in chart-with-rail slots emit real PPTX cell text", async () => {
    const source: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          h1: {
            type: "inline-json",
            rows: [
              { metric: "营收", h1_2024: 31602, h1_2025: 29214, yoy: -0.076 },
              { metric: "人力成本", h1_2024: 10103, h1_2025: 7258, yoy: -0.281 },
            ],
          },
        },
      },
      slides: [{
        id: "s",
        title: "Nested Binding",
        children: [{
          id: "s.rail",
          type: "chart-with-rail",
          evidence: {
            id: "s.chart",
            type: "chart-card",
            chartType: "bar",
            bind: { source: "h1" },
            encoding: { x: "metric", y: ["h1_2024", "h1_2025"] },
          },
          rail: {
            id: "s.table",
            type: "table-card",
            bind: { source: "h1" },
            encoding: {
              columns: [
                { key: "metric", label: "指标" },
                { key: "h1_2024", label: "2024 H1", type: "number", format: "int" },
                { key: "h1_2025", label: "2025 H1", type: "number", format: "int" },
                { key: "yoy", label: "YoY", type: "percent" },
              ],
            },
          },
        } as never],
      }],
    };

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-nested-binding-artifact-")), "nested.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");

    expect(slideXml).toContain("指标");
    expect(slideXml).toContain("营收");
    expect(slideXml).toContain("31,602");
    expect(slideXml).toContain("-28.1%");
  });

  it("pie charts emit data labels by default so slice text is not only in the legend", async () => {
    const source = deck([{
      id: "s.pie",
      type: "chart-card",
      title: "各职能人力占比",
      chartType: "pie",
      labels: ["销售", "研发", "售后"],
      series: [{ name: "人数", values: [150, 55, 29] }],
      variant: "frameless",
      at: [1, 2, 22, 8],
    } as never]);

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-pie-artifact-")), "pie.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");

    expect(chartXml).toContain('<c:showCatName val="1"/>');
    expect(chartXml).toContain('<c:showPercent val="1"/>');
    expect(chartXml).toContain("<c:dLbls>");
    expect(chartXml).not.toContain("<c:dLblPos");
    expect(chartXml.indexOf("<c:dLbls>")).toBeLessThan(chartXml.indexOf("<c:cat>"));
  });

  it("pie chart dataLabels controls emitted label content without PowerPoint-repairing position XML", async () => {
    const source = deck([{
      id: "s.pie",
      type: "chart-card",
      title: "职能分布",
      chartType: "pie",
      labels: ["销售", "研发", "售后"],
      series: [{ name: "人数", values: [150, 55, 29] }],
      dataLabels: {
        show: true,
        position: "outsideEnd",
        showValue: true,
        showCategoryName: true,
        showPercent: false,
        showLeaderLines: true,
      },
      variant: "frameless",
      at: [1, 2, 22, 8],
    } as never]);

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-pie-label-artifact-")), "pie-labels.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");

    expect(chartXml).toContain("<c:dLbls>");
    expect(chartXml).not.toContain("<c:dLblPos");
    expect(chartXml).toContain('<c:showVal val="1"/>');
    expect(chartXml).toContain('<c:showCatName val="1"/>');
    expect(chartXml).toContain('<c:showPercent val="0"/>');
    expect(chartXml).toContain('<c:showLeaderLines val="1"/>');
  });

  it("bar charts emit a default negative point color for negative values", async () => {
    const source = deck([{
      id: "s.bar",
      type: "chart-card",
      title: "同比变化",
      chartType: "bar",
      labels: ["营收", "毛利", "费用"],
      series: [{ name: "YoY", values: [-0.076, 0.02, -0.281] }],
      yFormat: "percent",
      variant: "frameless",
      at: [1, 2, 22, 8],
    } as never]);

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-negative-bar-artifact-")), "negative-bars.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");

    expect(chartXml).toMatch(/<c:dPt><c:idx val="0"\/>[\s\S]*<a:srgbClr val="B42318"\/>[\s\S]*<\/c:dPt>/);
    expect(chartXml).toMatch(/<c:dPt><c:idx val="2"\/>[\s\S]*<a:srgbClr val="B42318"\/>[\s\S]*<\/c:dPt>/);
  });

  it("negative bar chart-card remains readable inside split layouts", async () => {
    const source = deck([{
      id: "s.split",
      type: "split",
      direction: "horizontal",
      ratio: [0.66, 0.34],
      gap: 0.5,
      children: [
        {
          id: "s.chart",
          type: "chart-card",
          title: "渠道收入同比",
          chartType: "bar",
          labels: ["京东", "天猫", "抖音", "达播", "线下"],
          series: [{ name: "收入YoY", values: [-0.309, -0.161, -0.058, -0.336, -0.672] }],
          yFormat: "percent",
          dataLabels: { show: true, position: "outsideEnd", showValue: true },
          caption: "负值默认使用 danger 色。",
        },
        {
          id: "s.rail",
          type: "takeaway-list",
          items: ["线下经销降幅最大", "京东仍是高ROI渠道", "抖音收入小幅下降但ROI改善"],
        },
      ],
    } as never]);

    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(source));
    const diagnostics = getRenderDiagnostics();
    clearRenderDiagnostics();
    expect(diagnostics.filter((item) => item.severity === "error"), JSON.stringify(diagnostics)).toHaveLength(0);

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-negative-bar-split-")), "negative-bars-split.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");

    expect(chartXml).toContain('<c:barChart>');
    expect(chartXml).toMatch(/<c:dPt><c:idx val="0"\/>[\s\S]*<a:srgbClr val="B42318"\/>[\s\S]*<\/c:dPt>/);
    expect(chartXml).toContain('<c:dLblPos val="outEnd"/>');
  });

  it("pie charts with hidden slice labels produce an advisory diagnostic", () => {
    const source = deck([{
      id: "s.pie",
      type: "chart-card",
      title: "各职能人力占比",
      chartType: "pie",
      labels: ["销售", "研发", "售后"],
      series: [{ name: "人数", values: [150, 55, 29] }],
      showValues: false,
      variant: "frameless",
      at: [1, 2, 22, 8],
    } as never]);

    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(source));
    const diagnostics = getRenderDiagnostics();
    const hit = diagnostics.find((item) => item.code === "PIE_LABELS_HIDDEN" && item.nodeId === "s.pie.chart");
    clearRenderDiagnostics();

    expect(hit, JSON.stringify(diagnostics)).toBeDefined();
    expect(hit?.severity).toBe("warn");
    expect(hit?.measured?.rect).toMatchObject({ x: expect.any(Number), y: expect.any(Number), w: expect.any(Number), h: expect.any(Number) });
  });

  it("empty charts produce blocking diagnostics and still emit PowerPoint-safe chart XML", async () => {
    const source = deck([{
      id: "s.empty",
      type: "chart-card",
      title: "Empty chart",
      chartType: "bar",
      labels: [],
      series: [],
    } as never]);

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-empty-chart-")), "empty-chart.pptx");
    clearRenderDiagnostics();
    await renderToPptx(sourceToRenderedDeck(source), out);
    const diagnostics = getRenderDiagnostics();
    const hit = diagnostics.find((item) => item.code === "EMPTY_CHART_DATA" && item.nodeId === "s.empty.chart");
    clearRenderDiagnostics();

    const zip = await JSZip.loadAsync(readFileSync(out));
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");
    expect(hit, JSON.stringify(diagnostics)).toBeDefined();
    expect(hit?.severity).toBe("error");
    expect(chartXml).toContain("<c:barChart>");
    expect(chartXml).toContain("<c:v>No data</c:v>");
  });

  it("top-level anchored content cannot overlap a normal content region", () => {
    const source = deck([
      {
        id: "s.body",
        type: "stack",
        area: "content",
        children: [{ id: "s.body.text", type: "text", style: "paragraph", text: "This is the ordinary content region." }],
      },
      {
        id: "s.hero",
        type: "stack",
        anchor: "middle-left",
        width: 18,
        height: 5,
        zIndex: 1,
        children: [{ id: "s.hero.title", type: "text", style: "card-title", text: "Positioned hero" }],
      },
    ] as never);

    const report = validateDeck(source);
    expect(report.ok).toBe(false);
    expect(report.errors.some((item) => item.code === "TOP_LEVEL_LAYOUT_OVERLAP" && item.nodeName === "s.hero")).toBe(true);
  });

  it("charts below suggested readable size trigger advisory diagnostics", () => {
    const source = deck([{
      id: "s.chart",
      type: "chart",
      chartType: "bar",
      labels: ["京东", "天猫", "抖音"],
      series: [{ name: "ROI变化", values: [-0.397, -0.106, 0.297] }],
      at: [1, 3, 22, 1.8],
    } as never]);

    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(source));
    const diagnostics = getRenderDiagnostics();
    const hit = diagnostics.find((item) => item.code === "SQUASHED" && item.nodeId === "s.chart" && /Chart/.test(item.message));
    clearRenderDiagnostics();

    expect(hit, JSON.stringify(diagnostics)).toBeDefined();
    expect(hit?.severity).toBe("warn");
    expect(hit?.message).toMatch(/Chart .* assigned/);
    expect(hit?.suggestion).toMatch(/more vertical space|dominant area|split/i);
  });
});
