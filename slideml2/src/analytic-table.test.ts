import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { describeComponents } from "./component-registry.js";
import { clearRenderDiagnostics, getRenderDiagnostics } from "./diagnostics.js";
import { renderToAst, renderToPptx } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck } from "./types.js";
import { validateDeck } from "./validate.js";

const EMU_PER_CM = 360000;

function deck(children: Slideml2SourceDeck["slides"][number]["children"]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
    slides: [{ id: "s", title: "Analytic table", children }],
  };
}

function findNode(node: DomNode, id: string): DomNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

describe("analytic-table", () => {
  it("is exposed as a business table component with cell visuals", () => {
    const result = describeComponents(["analytic-table"]);
    expect(result.missing).toHaveLength(0);
    expect(result.found["analytic-table"]?.purpose).toContain("Business analysis table");
    expect(result.found["analytic-table"]?.fields.columns.description).toContain("visual");
    expect(result.found["analytic-table"]?.fields.columns.description).toContain("traffic-light");
    expect(result.found["analytic-table"]?.guidance?.join(" ")).toContain("cell");
  });

  it("renders formatted business cells as native table content", async () => {
    const source = deck([{
      id: "s.performance",
      type: "analytic-table",
      title: "区域经营表现",
      variant: "frameless",
      density: "compact",
      columns: [
        { key: "region", label: "区域", width: 1.2 },
        { key: "revenue", label: "收入", format: "currencyCompact", visual: "bar", width: 1.8 },
        { key: "yoy", label: "同比", format: "percent", visual: "delta", width: 1.0 },
        { key: "completion", label: "完成率", format: "percent", visual: "progress", width: 1.8 },
        { key: "trend", label: "趋势", visual: "sparkline", width: 1.4 },
        { key: "status", label: "状态", visual: "badge", width: 1.0 },
        { key: "risk", label: "风险", format: "percent", visual: "heat", width: 1.0 },
      ],
      rows: [
        { region: "华东", revenue: 2_747_000, yoy: 0.124, completion: 0.78, trend: [60, 64, 72, 71, 83], status: "达标", risk: 0.21 },
        { region: "华南", revenue: 1_982_000, yoy: -0.031, completion: 0.61, trend: [58, 56, 55, 59, 57], status: "预警", risk: 0.58 },
        { region: "华北", revenue: 1_226_000, yoy: 0.008, completion: 0.52, trend: [42, 44, 46, 45, 48], status: "风险", risk: 0.83 },
        { region: "合计", revenue: 5_955_000, yoy: 0.045, completion: 0.69, trend: [160, 164, 173, 175, 188], status: "跟踪", risk: 0.44, summary: true },
      ],
      caption: "Source: regional operating review",
    } as never]);

    const validation = validateDeck(source);
    expect(validation.errors, validation.errors.map((item) => `${item.code}: ${item.message}`).join("\n")).toHaveLength(0);

    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(source));
    const diagnostics = getRenderDiagnostics();
    expect(diagnostics.filter((item) => item.severity === "error"), JSON.stringify(diagnostics)).toHaveLength(0);

    const table = ast.slides[0]!.shapes.find((shape) => shape.type === "table");
    expect(table?.type).toBe("table");
    if (!table || table.type !== "table") throw new Error("Expected analytic-table to render a native table shape.");

    const row = table.cells[1]!;
    const rowText = row.map((cell) => cell.runs.map((run) => run.text).join("")).join("|");
    expect(rowText).toContain("华东");
    expect(rowText).toContain("¥274.7万");
    expect(rowText).toContain("+12.4%");
    expect(rowText).toContain("78%");
    expect(rowText).toContain("达标");
    expect(rowText).toContain("█");
    expect(rowText).toContain("▁");

    const yoyCell = row[2]!;
    expect(yoyCell.align).toBe("right");
    expect(yoyCell.runs[0]?.color).toBeDefined();
    const badgeCell = row[5]!;
    expect(badgeCell.align).toBe("center");
    expect(badgeCell.fill?.type).toBe("solid");

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-analytic-table-")), "analytic-table.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain("区域经营表现");
    expect(slideXml).toContain("华东");
    expect(slideXml).toContain("¥274.7万");
    expect(slideXml).toContain("+12.4%");
  });

  it("renders composed visual cells as real shapes for visual QA", async () => {
    const source = deck([{
      id: "s.composed",
      type: "analytic-table",
      title: "区域经营表现",
      variant: "frameless",
      density: "compact",
      renderMode: "composed",
      columns: [
        { key: "region", label: "区域", width: 1.1 },
        { key: "revenue", label: "收入", format: "currencyCompact", visual: "bar", width: 1.8 },
        { key: "yoy", label: "同比", format: "percent", visual: "delta", width: 1.0 },
        { key: "completion", label: "完成率", format: "percent", visual: "progress", width: 1.8 },
        { key: "trend", label: "趋势", visual: "sparkline", width: 1.3 },
        { key: "status", label: "状态", visual: "badge", width: 1.0 },
        { key: "risk", label: "风险", format: "percent", visual: "heat", width: 0.9 },
      ],
      columnGroups: [
        { label: "区域", columns: ["region"] },
        { label: "经营表现", columns: ["revenue", "yoy", "completion"], tone: "brand" },
        { label: "质量信号", from: "trend", to: "risk" },
      ],
      rows: [
        { region: "华东", revenue: 2_747_000, yoy: 0.124, completion: 0.78, trend: [60, 64, 72, 71, 83], status: "达标", risk: 0.21 },
        { region: "华南", revenue: 1_982_000, yoy: -0.031, completion: 0.61, trend: [58, 56, 55, 59, 57], status: "预警", risk: 0.58 },
      ],
    } as never]);

    const validation = validateDeck(source);
    expect(validation.errors, validation.errors.map((item) => `${item.code}: ${item.message}`).join("\n")).toHaveLength(0);

    clearRenderDiagnostics();
    const rendered = sourceToRenderedDeck(source);
    const ast = renderToAst(rendered);
    const diagnostics = getRenderDiagnostics();
    expect(diagnostics.filter((item) => item.severity === "error"), JSON.stringify(diagnostics)).toHaveLength(0);
    expect(ast.slides[0]!.shapes.some((shape) => shape.type === "table")).toBe(false);

    const shapes = ast.slides[0]!.shapes;
    const realVisualShapes = shapes.filter((shape) => shape.type === "shape" && /(?:\.fill|\.trend\.\d+)$/.test(String(shape.name || "")));
    expect(realVisualShapes.length, JSON.stringify(shapes.map((shape) => ({ type: shape.type, name: shape.name })))).toBeGreaterThanOrEqual(14);
    const heatCells = shapes.filter((shape) => shape.type === "text" && /\.table\.r\d+\.c6$/.test(String(shape.name || "")));
    expect(heatCells).toHaveLength(2);
    expect(heatCells.every((shape) => shape.type === "text" && shape.fill?.type === "solid")).toBe(true);
    const visibleText = shapes
      .filter((shape) => shape.type === "text")
      .flatMap((shape) => shape.type === "text" ? shape.paragraphs.flatMap((p) => p.runs.map((run) => run.text)) : [])
      .join("");
    expect(visibleText).toContain("区域经营表现");
    expect(visibleText).toContain("经营表现");
    expect(visibleText).toContain("¥274.7万");
    expect(visibleText).toContain("+12.4%");
    expect(visibleText).toContain("78%");
    expect(visibleText).toContain("达标");
    expect(visibleText).toContain("21%");

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-analytic-table-composed-")), "analytic-table-composed.pptx");
    await renderToPptx(rendered, out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain("区域经营表现");
    expect(slideXml).toContain("达标");
    expect(slideXml).not.toContain("<a:tbl>");
  });

  it("supports compact composed visual cells without value labels", () => {
    const source = deck([{
      id: "s.compactVisual",
      type: "analytic-table",
      title: "渠道健康度",
      variant: "frameless",
      density: "compact",
      renderMode: "composed",
      columns: [
        { key: "channel", label: "渠道", width: 1.1 },
        { key: "sales", label: "销售", format: "currencyCompact", visual: "bar", width: 0.9 },
        { key: "completion", label: "进度", format: "percent", visual: { type: "progress", showValue: false }, width: 0.9 },
        { key: "trend", label: "趋势", visual: "sparkline", width: 1.0 },
        { key: "status", label: "状态", visual: "badge", width: 1.0 },
      ],
      rows: [
        { channel: "直营网", sales: 888_000, completion: { value: 0.42, valueLabel: "42%" }, trend: { values: [31, 36, 42, 45] }, status: { value: "warning", text: "预警中" } },
        { channel: "代理商", sales: 1_256_000, completion: { value: 0.76, valueLabel: "76%" }, trend: { values: [52, 55, 61, 68] }, status: "达标" },
      ],
    } as never]);

    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(source));
    const diagnostics = getRenderDiagnostics();
    expect(diagnostics.filter((item) => item.severity === "error"), JSON.stringify(diagnostics)).toHaveLength(0);

    const shapes = ast.slides[0]!.shapes;
    const hiddenValueLabels = shapes.filter((shape) => shape.type === "text" && /\.table\.r\d+\.c[12]\.value$/.test(String(shape.name || "")));
    expect(hiddenValueLabels).toHaveLength(0);
    const fills = shapes.filter((shape) => shape.type === "shape" && /\.table\.r\d+\.c[12]\.fill$/.test(String(shape.name || "")));
    const trendBars = shapes.filter((shape) => shape.type === "shape" && /\.table\.r\d+\.c3\.trend\.\d+$/.test(String(shape.name || "")));
    expect(fills).toHaveLength(4);
    expect(trendBars).toHaveLength(8);
    const visibleText = shapes
      .filter((shape) => shape.type === "text")
      .flatMap((shape) => shape.type === "text" ? shape.paragraphs.flatMap((p) => p.runs.map((run) => run.text)) : [])
      .join("");
    expect(visibleText).toContain("渠道健康度");
    expect(visibleText).toContain("直营网");
    expect(visibleText).toContain("预警中");
    expect(visibleText).toContain("达标");
    expect(visibleText).not.toContain("¥88.8万");
    expect(visibleText).not.toContain("42%");
  });

  it("renders a realistic office operating review table", async () => {
    const source = deck([{
      id: "s.officeReview",
      type: "analytic-table",
      title: "Q3 区域经营例会",
      variant: "frameless",
      density: "compact",
      renderMode: "composed",
      columns: [
        { key: "region", label: "区域", width: 1.05 },
        { key: "owner", label: "负责人", width: 1.0 },
        { key: "revenue", label: "收入", format: "currencyCompact", visual: "bar", width: 1.5 },
        { key: "attainment", label: "达成率", format: "percent", visual: "progress", width: 1.35 },
        { key: "yoy", label: "同比", format: "percent", visual: "delta", width: 0.95 },
        { key: "health", label: "健康度", visual: "traffic-light", width: 1.05 },
        { key: "forecast", label: "下月预测", visual: { type: "range", domainMin: 0, domainMax: 120 }, width: 1.75 },
        { key: "mix", label: "收入结构", visual: { type: "stack", showValue: false }, width: 1.55 },
      ],
      columnGroups: [
        { label: "责任区", columns: ["region", "owner"] },
        { label: "经营结果", columns: ["revenue", "attainment", "yoy"] },
        { label: "下月预判", columns: ["health", "forecast", "mix"] },
      ],
      rows: [
        {
          region: "华东",
          owner: "Lina",
          revenue: 2_747_000,
          attainment: { value: 0.86, valueLabel: "86%" },
          yoy: 0.124,
          health: { value: "green", text: "健康" },
          forecast: { low: 84, high: 108, value: 96, target: 100, display: "84-108%" },
          mix: { values: [{ label: "续费", value: 48, tone: "brand" }, { label: "新签", value: 34, tone: "positive" }, { label: "渠道", value: 18, tone: "warning" }] },
        },
        {
          region: "华南",
          owner: "Chen",
          revenue: 1_982_000,
          attainment: { value: 0.73, valueLabel: "73%" },
          yoy: -0.031,
          health: { value: "amber", text: "关注" },
          forecast: { low: 62, high: 91, value: 74, target: 95, display: "62-91%" },
          mix: { values: [{ label: "续费", value: 41, tone: "brand" }, { label: "新签", value: 21, tone: "positive" }, { label: "渠道", value: 38, tone: "warning" }] },
        },
        {
          region: "华北",
          owner: "Wang",
          revenue: 1_226_000,
          attainment: { value: 0.58, valueLabel: "58%" },
          yoy: -0.087,
          health: { value: "red", text: "风险" },
          forecast: { low: 45, high: 72, value: 61, target: 88, display: "45-72%" },
          mix: { values: [{ label: "续费", value: 55, tone: "brand" }, { label: "新签", value: 16, tone: "danger" }, { label: "渠道", value: 29, tone: "warning" }] },
        },
        {
          region: "西区",
          owner: "Mia",
          revenue: 1_568_000,
          attainment: { value: 0.79, valueLabel: "79%" },
          yoy: 0.052,
          health: { value: "green", text: "稳定" },
          forecast: { low: 70, high: 99, value: 82, target: 96, display: "70-99%" },
          mix: { values: [{ label: "续费", value: 36, tone: "brand" }, { label: "新签", value: 44, tone: "positive" }, { label: "渠道", value: 20, tone: "warning" }] },
        },
      ],
      insight: "华北需要单独拆解新签不足，华南关注渠道质量。",
      caption: "Source: Q3 regional operating review pack",
    } as never]);

    const validation = validateDeck(source);
    expect(validation.errors, validation.errors.map((item) => `${item.code}: ${item.message}`).join("\n")).toHaveLength(0);

    clearRenderDiagnostics();
    const rendered = sourceToRenderedDeck(source);
    const ast = renderToAst(rendered);
    const diagnostics = getRenderDiagnostics();
    expect(diagnostics.filter((item) => item.severity === "error"), JSON.stringify(diagnostics)).toHaveLength(0);
    expect(ast.slides[0]!.shapes.some((shape) => shape.type === "table")).toBe(false);

    const shapes = ast.slides[0]!.shapes;
    expect(shapes.filter((shape) => shape.type === "shape" && /\.dot$/.test(String(shape.name || "")))).toHaveLength(4);
    expect(shapes.filter((shape) => shape.type === "shape" && /\.valueMarker$/.test(String(shape.name || "")))).toHaveLength(4);
    expect(shapes.filter((shape) => shape.type === "shape" && /\.target$/.test(String(shape.name || "")))).toHaveLength(4);
    expect(shapes.filter((shape) => shape.type === "shape" && /\.seg\d+$/.test(String(shape.name || ""))).length).toBeGreaterThanOrEqual(12);
    expect(shapes.filter((shape) => shape.type === "shape" && /\.fill$/.test(String(shape.name || "")))).toHaveLength(8);
    const bodyCellHeights = shapes
      .filter((shape) => /table\.r\d+\.c\d+(?:-background)?$/.test(String(shape.name || "")))
      .map((shape) => shape.xfrm.cy / EMU_PER_CM);
    expect(Math.max(...bodyCellHeights)).toBeLessThanOrEqual(1.05);

    const visibleText = shapes
      .filter((shape) => shape.type === "text")
      .flatMap((shape) => shape.type === "text" ? shape.paragraphs.flatMap((p) => p.runs.map((run) => run.text)) : [])
      .join("");
    expect(visibleText).toContain("Q3 区域经营例会");
    expect(visibleText).toContain("经营结果");
    expect(visibleText).toContain("下月预判");
    expect(visibleText).toContain("华东");
    expect(visibleText).toContain("¥274.7万");
    expect(visibleText).toContain("+12.4%");
    expect(visibleText).toContain("84-108%");
    expect(visibleText).toContain("华北需要单独拆解新签不足");

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-analytic-table-office-")), "analytic-table-office-review.pptx");
    await renderToPptx(rendered, out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain("Q3 区域经营例会");
    expect(slideXml).toContain("华北");
    expect(slideXml).not.toContain("<a:tbl>");
  });

  it("renders expanded business visual types in native and composed modes", async () => {
    const columns = [
      { key: "initiative", label: "事项", width: 1.3 },
      { key: "status", label: "灯号", visual: "traffic-light", width: 1.0 },
      { key: "rank", label: "排序", visual: "rank", width: 1.0 },
      { key: "window", label: "区间", visual: { type: "range", domainMin: 0, domainMax: 100 }, width: 1.8 },
      { key: "mix", label: "构成", visual: { type: "stacked-bar", showValue: false }, width: 1.6 },
    ];
    const rows = [
      {
        initiative: "渠道升级",
        status: { value: "green", text: "健康" },
        rank: { value: 1, label: "优先" },
        window: { low: 35, high: 72, value: 58, target: 80, display: "35-72" },
        mix: { values: [{ label: "直营", value: 42, tone: "brand" }, { label: "代理", value: 33, tone: "positive" }, { label: "其他", value: 25, tone: "warning" }] },
      },
      {
        initiative: "库存治理",
        status: { value: "red", text: "风险" },
        rank: { value: 3, label: "跟进" },
        window: { low: 12, high: 44, value: 32, target: 60, display: "12-44" },
        mix: { values: [20, 30, 50] },
      },
    ];
    const nativeSource = deck([{ id: "s.expandedNative", type: "analytic-table", title: "扩展视觉", variant: "frameless", density: "compact", columns, rows } as never]);
    const composedSource = deck([{ id: "s.expandedComposed", type: "analytic-table", title: "扩展视觉", variant: "frameless", density: "compact", renderMode: "composed", columns, rows } as never]);

    clearRenderDiagnostics();
    const nativeAst = renderToAst(sourceToRenderedDeck(nativeSource));
    const nativeDiagnostics = getRenderDiagnostics();
    expect(nativeDiagnostics.filter((item) => item.severity === "error"), JSON.stringify(nativeDiagnostics)).toHaveLength(0);
    const table = nativeAst.slides[0]!.shapes.find((shape) => shape.type === "table");
    if (!table || table.type !== "table") throw new Error("Expected expanded native analytic-table to render a table shape.");
    const nativeText = table.cells.flatMap((row) => row.flatMap((cell) => cell.runs.map((run) => run.text))).join("");
    expect(nativeText).toContain("●");
    expect(nativeText).toContain("#1");
    expect(nativeText).toContain("35-72");
    expect(nativeText).toContain("█");

    clearRenderDiagnostics();
    const rendered = sourceToRenderedDeck(composedSource);
    const composedAst = renderToAst(rendered);
    const composedDiagnostics = getRenderDiagnostics();
    expect(composedDiagnostics.filter((item) => item.severity === "error"), JSON.stringify(composedDiagnostics)).toHaveLength(0);
    expect(composedAst.slides[0]!.shapes.some((shape) => shape.type === "table")).toBe(false);
    const shapes = composedAst.slides[0]!.shapes;
    expect(shapes.filter((shape) => shape.type === "shape" && /\.dot$/.test(String(shape.name || "")))).toHaveLength(2);
    expect(shapes.filter((shape) => shape.type === "text" && /\.chip$/.test(String(shape.name || "")))).toHaveLength(2);
    expect(shapes.filter((shape) => shape.type === "shape" && /\.range\d+$/.test(String(shape.name || ""))).length).toBeGreaterThanOrEqual(2);
    expect(shapes.filter((shape) => shape.type === "shape" && /\.valueMarker$/.test(String(shape.name || "")))).toHaveLength(2);
    expect(shapes.filter((shape) => shape.type === "shape" && /\.target$/.test(String(shape.name || "")))).toHaveLength(2);
    expect(shapes.filter((shape) => shape.type === "shape" && /\.seg\d+$/.test(String(shape.name || ""))).length).toBeGreaterThanOrEqual(6);
    const bodyCellHeights = shapes
      .filter((shape) => /table\.r\d+\.c\d+(?:-background)?$/.test(String(shape.name || "")))
      .map((shape) => shape.xfrm.cy / EMU_PER_CM);
    expect(Math.max(...bodyCellHeights)).toBeLessThanOrEqual(1.05);
    const composedText = shapes
      .filter((shape) => shape.type === "text")
      .flatMap((shape) => shape.type === "text" ? shape.paragraphs.flatMap((p) => p.runs.map((run) => run.text)) : [])
      .join("");
    expect(composedText).toContain("健康");
    expect(composedText).toContain("#1");
    expect(composedText).toContain("35-72");

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-analytic-table-expanded-")), "analytic-table-expanded.pptx");
    await renderToPptx(rendered, out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain("扩展视觉");
    expect(slideXml).not.toContain("<a:tbl>");
  });

  it("keeps bound rows raw so analytic visuals can scale and format them", () => {
    const source: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          regions: {
            type: "inline-json",
            rows: [
              { region: "华东", revenue: 2_747_000, yoy: 0.124, completion: 0.78 },
              { region: "华南", revenue: 1_982_000, yoy: -0.031, completion: 0.61 },
            ],
          },
        },
      },
      slides: [{
        id: "bound",
        title: "Bound analytic table",
        children: [{
          id: "bound.table",
          type: "analytic-table",
          title: "区域表现",
          bind: { source: "regions" },
          encoding: {
            columns: [
              { key: "region", label: "区域" },
              { key: "revenue", label: "收入", format: "currencyCompact", visual: "bar" },
              { key: "yoy", label: "同比", format: "percent", visual: "delta" },
              { key: "completion", label: "完成率", format: "percent", visual: "progress" },
            ],
          },
        } as never],
      }],
    };

    const rendered = sourceToRenderedDeck(source);
    const boundNode = findNode(rendered.slides[0]!.dom, "bound.table");
    expect(boundNode?.rows).toEqual([
      { region: "华东", revenue: 2_747_000, yoy: 0.124, completion: 0.78 },
      { region: "华南", revenue: 1_982_000, yoy: -0.031, completion: 0.61 },
    ]);

    clearRenderDiagnostics();
    const ast = renderToAst(rendered);
    const diagnostics = getRenderDiagnostics();
    expect(diagnostics.filter((item) => item.severity === "error"), JSON.stringify(diagnostics)).toHaveLength(0);
    const table = ast.slides[0]!.shapes.find((shape) => shape.type === "table");
    if (!table || table.type !== "table") throw new Error("Expected bound analytic-table to render a native table shape.");
    const text = table.cells.flatMap((row) => row.flatMap((cell) => cell.runs.map((run) => run.text))).join("");
    expect(text).toContain("¥274.7万");
    expect(text).toContain("+12.4%");
    expect(text).toContain("61%");
  });

  it("supports grouped business headers with colspan cells", async () => {
    const source = deck([{
      id: "s.grouped",
      type: "analytic-table",
      title: "区域经营表现",
      variant: "frameless",
      columns: [
        { key: "region", label: "区域", width: 1.1 },
        { key: "revenue", label: "收入", format: "currencyCompact", visual: "bar", width: 1.7 },
        { key: "yoy", label: "同比", format: "percent", visual: "delta", width: 1.0 },
        { key: "completion", label: "完成率", format: "percent", visual: "progress", width: 1.7 },
        { key: "trend", label: "趋势", visual: "sparkline", width: 1.2 },
        { key: "status", label: "状态", visual: "badge", width: 1.0 },
      ],
      columnGroups: [
        { label: "区域", columns: ["region"] },
        { label: "经营表现", columns: ["revenue", "yoy", "completion"], tone: "brand" },
        { label: "质量信号", from: "trend", to: "status", tone: "neutral" },
      ],
      rows: [
        { region: "华东", revenue: 2_747_000, yoy: 0.124, completion: 0.78, trend: [60, 64, 72, 71, 83], status: "达标" },
        { region: "华南", revenue: 1_982_000, yoy: -0.031, completion: 0.61, trend: [58, 56, 55, 59, 57], status: "预警" },
      ],
    } as never]);

    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(source));
    const diagnostics = getRenderDiagnostics();
    expect(diagnostics.filter((item) => item.severity === "error"), JSON.stringify(diagnostics)).toHaveLength(0);
    const table = ast.slides[0]!.shapes.find((shape) => shape.type === "table");
    if (!table || table.type !== "table") throw new Error("Expected grouped analytic-table to render a native table shape.");

    expect(table.cells[0]![0]!.runs[0]?.text).toBe("区域");
    expect(table.cells[0]![1]!.runs[0]?.text).toBe("经营表现");
    expect(table.cells[0]![1]!.colspan).toBe(3);
    expect(table.cells[0]![4]!.runs[0]?.text).toBe("质量信号");
    expect(table.cells[0]![4]!.colspan).toBe(2);
    expect(table.cells[1]!.map((cell) => cell.runs.map((run) => run.text).join(""))).toEqual(["区域", "收入", "同比", "完成率", "趋势", "状态"]);

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-analytic-table-groups-")), "analytic-table-groups.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain("经营表现");
    expect(slideXml).toContain("质量信号");
    expect(slideXml).toContain('gridSpan="3"');
    expect(slideXml).toContain('gridSpan="2"');
  });
});
