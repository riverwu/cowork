import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clearRenderDiagnostics, getRenderDiagnostics, type LayoutDiagnostic } from "./diagnostics.js";
import { renderToAst, renderToPptx } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck } from "./types.js";
import { validateDeck } from "./validate.js";

const BLOCKING = new Set<LayoutDiagnostic["code"]>([
  "FALLBACK_FAILED",
  "CODE_BLOCK_OVERFLOW",
  "COLLISION",
  "TITLE_OCCLUDED",
  "TINY_RECT",
  "SQUASHED",
  "SHAPE_INVISIBLE",
  "UNKNOWN_COLOR",
  "UNKNOWN_STYLE",
]);

describe("latest component coverage deck", () => {
  it("validates, renders, and exports a business/research deck using recent components", async () => {
    const deck = buildCoverageDeck();

    const validation = validateDeck(deck);
    expect(validation.errors, validation.errors.map((item) => `${item.code}: ${item.message}`).join("\n")).toHaveLength(0);

    const rendered = sourceToRenderedDeck(deck);
    const dataChart = findNode(rendered.slides[0]!.dom, "coverage.data.chart");
    const dataTable = findNode(rendered.slides[0]!.dom, "coverage.data.table");
    expect(dataChart?.data).toMatchObject({
      labels: ["Enterprise", "SMB"],
      series: [
        { name: "ARR", values: [92, 47], type: "bar" },
        { name: "Retention", values: [0.92, 0.87], type: "line", axis: "secondary" },
      ],
    });
    expect(dataTable?.headers).toEqual(["Segment", "ARR", "Retention", "Risk"]);

    clearRenderDiagnostics();
    const ast = renderToAst(rendered);
    const diagnostics = getRenderDiagnostics();
    expect(blockingDiagnostics(diagnostics), formatDiagnostics(diagnostics)).toHaveLength(0);

    const runs = allRunTexts(ast);
    const texts = runs.join("\n");
    const continuousText = runs.join("");
    expect(texts).toContain("ARR by segment");
    expect(texts).toContain("Research guardrails");
    expect(texts).toContain("tan α = sin α/cos α");
    expect(continuousText).toContain("return false");
    expect(texts).toContain("Reputation pressure and reporting");
    expect(texts).toContain("[1]");
    expect(texts).toContain("42%");

    const charts = ast.slides.flatMap((slide) => slide.shapes).filter((shape) => shape.type === "chart");
    const tables = ast.slides.flatMap((slide) => slide.shapes).filter((shape) => shape.type === "table");
    expect(charts.length).toBeGreaterThanOrEqual(1);
    expect(tables.length).toBeGreaterThanOrEqual(3);

    clearRenderDiagnostics();
    const outDir = mkdtempSync(join(tmpdir(), "slideml2-latest-components-"));
    const outPath = join(outDir, "coverage.pptx");
    const result = await renderToPptx(rendered, outPath);
    const exportDiagnostics = getRenderDiagnostics();
    expect(blockingDiagnostics(exportDiagnostics), formatDiagnostics(exportDiagnostics)).toHaveLength(0);
    expect(result.outputPath).toBe(outPath);
    expect(existsSync(outPath)).toBe(true);
    expect(statSync(outPath).size).toBeGreaterThan(10_000);
  });
});

function buildCoverageDeck(): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: "default",
      brand: { name: "Coverage Lab", primary: "2563EB" },
      themeOverride: {
        colors: {
          brand: { primary: "2563EB", secondary: "0F766E" },
          background: "F8FAFC",
          surface: "FFFFFF",
          "surface.subtle": "EEF2FF",
          text: { primary: "111827", secondary: "475569", muted: "64748B", inverse: "FFFFFF" },
          divider: "CBD5E1",
          success: "15803D",
          warning: "B45309",
          danger: "B91C1C",
        },
        text: {
          "slide-title": { fontSize: 26, lineHeight: 1.05, weight: 700 },
          "card-title": { fontSize: 13, lineHeight: 1.12, weight: 700 },
          paragraph: { fontSize: 10.5, lineHeight: 1.24 },
          caption: { fontSize: 8.8, lineHeight: 1.18 },
          label: { fontSize: 8.6, lineHeight: 1.12, weight: 700 },
        },
        layout: {
          pageMarginX: 1.05,
          titleTop: 0.76,
          titleHeight: 1.15,
          contentTop: 2.25,
          contentBottom: 13.1,
          defaultGap: 0.36,
          areas: {
            contentLeft: { x: 1.05, y: 2.25, w: 11.7, h: 10.85 },
            contentRight: { x: 13.15, y: 2.25, w: 11.2, h: 10.85 },
            topBand: { x: 1.05, y: 2.25, w: 23.3, h: 4.85 },
            bottomBand: { x: 1.05, y: 7.35, w: 23.3, h: 5.75 },
          },
        },
        component: {
          card: { cornerRadius: 0.2, line: "divider", lineOpacity: 0.75 },
          panel: { cornerRadius: 0.18, fill: "surface", line: "divider" },
        },
        chart: { series: ["brand.primary", "success", "warning", "danger"] },
      },
      dataSources: {
        pipelineRaw: {
          type: "inline-json",
          rows: [
            { segment: "Enterprise", quarter: "Q1", arr: 42, retention: 0.91, risk: "low" },
            { segment: "Enterprise", quarter: "Q2", arr: 50, retention: 0.93, risk: "low" },
            { segment: "SMB", quarter: "Q1", arr: 21, retention: 0.86, risk: "medium" },
            { segment: "SMB", quarter: "Q2", arr: 26, retention: 0.88, risk: "medium" },
          ],
        },
        pipeline: {
          type: "computed",
          source: "pipelineRaw",
          columns: {
            arrWithUnit: { op: "concat", values: [{ field: "arr" }, { value: "M" }], separator: "" },
          },
        },
      },
      references: [
        {
          id: "smith2024",
          authors: ["A. Smith", "J. Chen"],
          year: 2024,
          title: "Reputation pressure and reporting",
          venue: "Journal of Classroom Methods",
        },
      ],
      footnotes: [{ id: "pipeline-risk", text: "Risk combines retention volatility and quarter-over-quarter ARR variance." }],
    },
    slides: [
      {
        id: "coverage-data",
        title: "Data-bound business dashboard",
        children: [
          {
            id: "coverage.data.chart",
            type: "chart-card",
            area: "contentLeft",
            chartType: "combo",
            title: "ARR by segment",
            badge: "DATA",
            bind: {
              source: "pipeline",
              groupBy: "segment",
              aggregate: {
                arr: { op: "sum", field: "arr" },
                retention: { op: "avg", field: "retention" },
              },
              sort: "-arr",
            },
            encoding: {
              x: "segment",
              y: ["arr", "retention"],
              seriesOptions: {
                arr: { name: "ARR", type: "bar" },
                retention: { name: "Retention", type: "line", axis: "secondary", trendLine: true },
              },
            },
            caption: "Inline JSON source resolved through deck.dataSources.",
            yFormat: "int",
            showLegend: true,
          },
          {
            id: "coverage.data.right",
            type: "stack",
            area: "contentRight",
            direction: "vertical",
            gap: 0.32,
            children: [
              {
                id: "coverage.data.hero",
                type: "hero-stat",
                bind: { source: "pipeline", groupBy: "segment", aggregate: { arr: { op: "sum", field: "arr" } }, sort: "-arr", limit: 1 },
                encoding: { value: "arr", label: "segment" },
                caption: "largest ARR segment",
                tone: "brand",
                fixedHeight: 2.3,
              },
              {
                id: "coverage.data.strip",
                type: "stat-strip",
                bind: { source: "pipeline", sort: "-arr", limit: 3 },
                encoding: { value: "arrWithUnit", label: "quarter" },
                fixedHeight: 1.45,
              },
              {
                id: "coverage.data.table",
                type: "table-card",
                title: "Operating view",
                badge: "TABLE",
                bind: {
                  source: "pipeline",
                  groupBy: "segment",
                  aggregate: {
                    ARR: { op: "sum", field: "arr" },
                    Retention: { op: "avg", field: "retention" },
                    Risk: { op: "first", field: "risk" },
                  },
                  sort: "-ARR",
                },
                encoding: {
                  columns: [
                    { key: "segment", label: "Segment", width: 1.3 },
                    { key: "ARR", label: "ARR", type: "currency", format: "int", align: "right", width: 1.0 },
                    { key: "Retention", label: "Retention", type: "percent", format: "percent", align: "right", width: 1.1 },
                    { key: "Risk", label: "Risk", width: 0.9 },
                  ],
                },
                caption: "Risk definition is normalized across teams.",
                density: "compact",
                layoutWeight: 1,
              },
            ],
          },
        ],
      },
      {
        id: "coverage-flow",
        title: "Designed process and timeline",
        children: [{
          id: "coverage.flow.stack",
          type: "stack",
          area: "content",
          direction: "vertical",
          gap: 0.48,
          children: [
            {
              id: "coverage.flow.process",
              type: "process-flow",
              direction: "horizontal",
              variant: "cards",
              connector: "chevron",
              placement: "top",
              spread: "balanced",
              fixedHeight: 4.65,
              steps: [
                { title: "Scope", body: "Lock audience, decision, and required evidence.", status: "brand", owner: "PM", time: "D0" },
                { title: "Model", body: "Map data into semantic SlideML2 components.", status: "positive", owner: "Agent", time: "D1" },
                { title: "Validate", body: "Run schema, render diagnostics, and visual fit gates.", status: "warning", owner: "QA", time: "D2" },
                { title: "Publish", body: "Export PPTX and attach traceable assets.", status: "neutral", owner: "Ops", time: "D3" },
              ],
            },
            {
              id: "coverage.flow.timeline",
              type: "timeline",
              direction: "horizontal",
              fixedHeight: 4.95,
              items: [
                { time: "Week 1", title: "Discovery", body: "Brief, data audit, success criteria.", tone: "brand" },
                { time: "Week 2", title: "Authoring", body: "Component-first slides with data binding.", tone: "positive" },
                { time: "Week 3", title: "Review", body: "Diagnostics, citations, layout polish.", tone: "warning" },
                { time: "Week 4", title: "Delivery", body: "PPTX package and reproducible report.", tone: "neutral" },
              ],
            },
          ],
        }],
      },
      {
        id: "coverage-science",
        title: "Research guardrails with formula and code",
        children: [
          {
            id: "coverage.science.left",
            type: "stack",
            area: "contentLeft",
            direction: "vertical",
            gap: 0.36,
            children: [
              {
                id: "coverage.science.text",
                type: "callout",
                title: "Finding",
                variant: "card",
                tone: "brand",
                content: [
                  { text: "Effect size " },
                  { kind: "math", latex: "\\frac{x_1}{\\sigma^2}" },
                  { text: " is consistent with prior reporting pressure evidence " },
                  { kind: "cite", refId: "smith2024" },
                  { text: " and improves " },
                  { kind: "token", value: 0.42, format: "percent", tone: "positive" },
                  { text: "." },
                ],
                fixedHeight: 2.35,
              },
              {
                id: "coverage.science.eq1",
                type: "equation",
                label: "Trigonometric identity",
                latex: "\\sin^2\\alpha + \\cos^2\\alpha = 1",
                number: "1",
                fontSize: 15,
                caption: "Editable math fallback rather than a raster image.",
                fixedHeight: 2.35,
              },
              {
                id: "coverage.science.eq2",
                type: "equation",
                label: "Ratio form",
                latex: "\\tan\\alpha = \\frac{\\sin\\alpha}{\\cos\\alpha}",
                fontSize: 13,
                fixedHeight: 1.65,
              },
              {
                id: "coverage.science.refs",
                type: "bibliography",
                title: "References",
                fixedHeight: 2.05,
              },
            ],
          },
          {
            id: "coverage.science.code",
            type: "code-block",
            area: "contentRight",
            title: "C++ conflict check",
            language: "cpp",
            code: [
              "// queen conflict check",
              "bool isValid(int row, int col) {",
              "  for (int prevRow = 0; prevRow < row; ++prevRow) {",
              "    int prevCol = board[prevRow];",
              "    if (prevCol == col) return false;",
              "    if (prevRow - prevCol == row - col) return false;",
              "    if (prevRow + prevCol == row + col) return false;",
              "  }",
              "  return true;",
              "}",
              "",
              "void backtrack(int row) {",
              "  if (row == N) { solutions.push_back(board); return; }",
              "  for (int col = 0; col < N; ++col) {",
              "    if (isValid(row, col)) {",
              "      board[row] = col;",
              "      backtrack(row + 1);",
              "      board[row] = -1;",
              "    }",
              "  }",
              "}",
            ].join("\n"),
            density: "tiny",
            fontSize: 6.2,
            columns: 2,
            showLineNumbers: true,
            highlightLines: [2, { start: 5, end: 7 }],
            caption: "Long listings must fit or produce CODE_BLOCK_OVERFLOW.",
          },
        ],
      },
      {
        id: "coverage-table",
        title: "Citations and footnotes inside tables",
        children: [{
          id: "coverage.table",
          type: "table-card",
          area: "content",
          title: "Evidence matrix",
          badge: "M3",
          density: "compact",
          rows: [
            [{ text: "Claim" }, { text: "Evidence" }, { text: "Implication" }],
            [
              { text: "Reputation pressure" },
              { runs: [{ text: "Reported in " }, { kind: "cite", refId: "smith2024" }] },
              { text: "Make score visibility explicit.", footnoteRefs: ["pipeline-risk"] },
            ],
            [
              { text: "Formula fidelity" },
              { runs: [{ kind: "math", latex: "\\Delta = 7.17" }] },
              { text: "Use editable math runs instead of screenshots." },
            ],
            [
              { text: "Code fidelity" },
              { text: "Syntax-highlighted code-block with deterministic overflow checks." },
              { text: "Split pages when listing exceeds capacity." },
            ],
          ],
          colWidths: [0.24, 0.38, 0.38],
          caption: "Table cells support rich runs, citations, math, and footnote references.",
        }],
      },
    ],
  };
}

type RenderedNode = ReturnType<typeof sourceToRenderedDeck>["slides"][number]["dom"];

function findNode(node: RenderedNode, id: string): RenderedNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findNode(child as RenderedNode, id);
    if (found) return found;
  }
  return undefined;
}

function allRunTexts(ast: ReturnType<typeof renderToAst>): string[] {
  const out: string[] = [];
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) {
      if (shape.type === "text") {
        for (const para of shape.paragraphs) for (const run of para.runs) out.push(run.text);
      } else if (shape.type === "table") {
        for (const row of shape.cells) for (const cell of row) for (const run of cell.runs) out.push(run.text);
      }
    }
  }
  return out;
}

function blockingDiagnostics(diagnostics: LayoutDiagnostic[]): LayoutDiagnostic[] {
  return diagnostics.filter((item) => item.severity === "error" || BLOCKING.has(item.code));
}

function formatDiagnostics(diagnostics: LayoutDiagnostic[]): string {
  return diagnostics
    .map((item) => `${item.severity}:${item.code} slide=${item.slideId || ""} node=${item.nodeId || ""} ${item.message || ""}`)
    .join("\n");
}
