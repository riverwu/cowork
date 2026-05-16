import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { renderToAst, renderToPptx } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck } from "./types.js";
import { validateDeck } from "./validate.js";

function findNode(node: DomNode, id: string): DomNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

describe("agent-intuitive OOXML semantics", () => {
  it("preserves combo seriesOptions, shape child text, built-in area overrides, and cover content hyperlinks", async () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        themeOverride: {
          layout: {
            areas: {
              content: { x: 1, y: 2, w: 23.4, h: 10.6 },
              full: { left: 0, top: 0, right: 25.4, bottom: 14.288 },
            },
          },
        },
        dataSources: {
          releaseMetrics: {
            type: "inline-json",
            rows: [
              { phase: "Alpha", clients: 18, p95ms: 920 },
              { phase: "Beta", clients: 54, p95ms: 640 },
              { phase: "RC", clients: 91, p95ms: 510 },
            ],
          },
        },
      },
      slides: [
        {
          id: "cover",
          children: [{
            id: "cover.hero",
            type: "cover-composition",
            title: "AI 产品分析平台 Q4 发布准备度",
            subtitle: "季度业务复盘",
            content: { runs: [{ text: "跳到指标页", link: "#slide3" }] },
          }],
        },
        {
          id: "flow",
          children: [{
            id: "flow.group",
            type: "freeform-group",
            mode: "overlay",
            children: [
              {
                id: "flow.ingest",
                type: "shape",
                preset: "flowChartProcess",
                fill: "brand.primary",
                line: "brand.primary",
                at: [1.2, 4.5, 4.2, 1.4],
                text: { text: "Ingest telemetry", color: "text.inverse", fontSize: 11, fontWeight: 700, fontFamily: "display" },
              },
              {
                id: "flow.decision",
                type: "shape",
                preset: "flowChartDecision",
                fill: "warning",
                line: "warning",
                at: [7.2, 4.2, 4.2, 2.0],
                children: [
                  { id: "flow.decision.label", type: "text", text: "Quality Check", color: "text.inverse" },
                  { id: "flow.decision.prompt", type: "text", text: "Pass?", color: "text.inverse" },
                ],
              },
              {
                id: "flow.connector",
                type: "shape",
                preset: "straightConnector",
                line: { color: "brand.primary", width: 1.5 },
                tailEnd: { type: "triangle" },
                at: [5.4, 5.2, 1.8, 0],
              },
            ],
          }],
        },
        {
          id: "metrics",
          children: [{
            id: "metrics.chart",
            type: "chart-card",
            chartType: "combo",
            title: "Q4 发布指标趋势：客户数 vs P95 延迟",
            bind: { source: "releaseMetrics" },
            encoding: {
              x: "phase",
              seriesOptions: {
                primary: { chartType: "bar", y: "clients", seriesName: "活跃客户数" },
                secondary: { chartType: "line", y: "p95ms", seriesName: "P95延迟", axis: "secondary" },
              },
            },
            secondaryYAxis: { label: "P95 延迟 (ms)" },
            showLegend: true,
          }],
        },
        {
          id: "table",
          children: [{
            id: "table.card",
            type: "table-card",
            headers: ["Metric", "Action"],
            rows: [
              ["Readiness", { text: "Finish evidence package", padding: 8 }],
              ["Latency", { text: "Keep P95 under target", padding: 8 }],
            ],
            cellPadding: 6,
          }],
        },
      ],
    };

    const validation = validateDeck(deck);
    expect(validation.errors, validation.errors.map((item) => `${item.code}: ${item.message}`).join("\n")).toHaveLength(0);

    const rendered = sourceToRenderedDeck(deck);
    const chart = findNode(rendered.slides[2]!.dom, "metrics.chart");
    expect(chart?.series).toEqual([
      expect.objectContaining({ name: "活跃客户数", values: [18, 54, 91], type: "bar" }),
      expect.objectContaining({ name: "P95延迟", values: [920, 640, 510], type: "line", axis: "secondary" }),
    ]);

    const astText = allText(renderToAst(rendered)).join("\n");
    expect(astText).toContain("跳到指标页");
    expect(astText).toContain("Ingest telemetry");
    expect(astText).toContain("Quality Check");
    expect(astText).toContain("Pass?");

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-ooxml-agent-semantics-")), "deck.pptx");
    await renderToPptx(rendered, out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slide1Xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const slide1Rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    const slide2Xml = await zip.file("ppt/slides/slide2.xml")!.async("string");
    const slide4Xml = await zip.file("ppt/slides/slide4.xml")!.async("string");
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");

    expect(slide1Xml).toContain("跳到指标页");
    expect(slide1Xml).toContain("<a:hlinkClick");
    expect(slide1Rels).toContain("Target=\"../slides/slide3.xml\"");
    expect(slide2Xml).toContain("Ingest telemetry");
    expect(slide2Xml).toContain("Quality Check");
    expect(slide2Xml).toContain("Pass?");
    expect(slide4Xml).toContain("Finish evidence package");
    expect(slide4Xml).toContain('lIns="76200"');
    expect(slide4Xml).toContain('lIns="101600"');
    expect(slide4Xml).not.toContain('lIns="2160000"');
    expect(slide4Xml).not.toContain('lIns="2880000"');
    expect(chartXml.match(/<c:ser>/g)).toHaveLength(2);
    expect(chartXml).toContain("活跃客户数");
    expect(chartXml).toContain("P95延迟");
    expect(chartXml).toContain("<c:v>18</c:v>");
    expect(chartXml).toContain("<c:v>920</c:v>");
    expect(chartXml).toContain("P95 延迟 (ms)");
  });
});

function allText(ast: ReturnType<typeof renderToAst>): string[] {
  const out: string[] = [];
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) collectText(shape, out);
  }
  return out.filter(Boolean);
}

function collectText(shape: ReturnType<typeof renderToAst>["slides"][number]["shapes"][number], out: string[]): void {
  if ("paragraphs" in shape && Array.isArray(shape.paragraphs)) {
    for (const para of shape.paragraphs) {
      for (const run of para.runs) out.push(run.text);
    }
  }
  if ("children" in shape && Array.isArray(shape.children)) {
    for (const child of shape.children) collectText(child as ReturnType<typeof renderToAst>["slides"][number]["shapes"][number], out);
  }
}
