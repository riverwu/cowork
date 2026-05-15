import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { isBlockingRenderDiagnostic } from "./diagnostic-codes.js";
import { clearRenderDiagnostics, getRenderDiagnostics, type LayoutDiagnostic } from "./diagnostics.js";
import { renderToAst, renderToPptx } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck } from "./types.js";
import { validateDeck } from "./validate.js";

const FIXTURE_URL = new URL("../examples/org-pyramid-office-e2e.json", import.meta.url);

describe("office foundation org-chart + pyramid + funnel e2e", () => {
  it("validates, lays out, and exports a deck that contains org-chart, pyramid, and funnel", async () => {
    const source = JSON.parse(readFileSync(FIXTURE_URL, "utf8")) as Slideml2SourceDeck;
    const validation = validateDeck(source);
    expect(validation.errors, validation.errors.map((item) => `${item.code}: ${item.message}`).join("\n")).toHaveLength(0);

    clearRenderDiagnostics();
    const rendered = sourceToRenderedDeck(source);
    const ast = renderToAst(rendered);
    const layoutDiagnostics = getRenderDiagnostics();
    expect(blockingDiagnostics(layoutDiagnostics), formatDiagnostics(layoutDiagnostics)).toHaveLength(0);

    const text = allText(ast).join("\n");
    for (const expected of [
      "客户运营组织与经营看板",
      "运营委员会",
      "客户成功部",
      "重点客户组",
      "经营成熟度金字塔",
      "北极星指标",
      "增长抓手",
      "低触达运营",
      "执行底座",
      "客户转化漏斗",
      "目标账户触达",
      "销售线索确认",
      "方案评估",
      "签约与扩容",
      "ARR",
      "准时率92%",
      "108%",
    ]) {
      expect(text).toContain(expected);
    }

    const shapeNames = allShapes(ast).map((shape) => shape.name || "");
    expect(shapeNames.some((name) => name.includes("org-pyramid-org.diagram.edge."))).toBe(true);
    expect(shapeNames.some((name) => name.includes("org-pyramid-org.diagram.level.0.0.out-port"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("org-pyramid-org.diagram.level.1.0.in-port"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("org-pyramid-org.diagram.level.1.0.badge.0"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("org-pyramid-pyramid.diagram.level.0.shape"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("org-pyramid-pyramid.diagram.level.0.icon"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("org-pyramid-pyramid.diagram.level.0.metric"))).toBe(false);
    expect(shapeNames.some((name) => name.includes("org-pyramid-pyramid.diagram.level.1.badge.0"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("org-pyramid-funnel.diagram.stage.0.shape"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("org-pyramid-funnel.diagram.stage.1.content.0"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("org-pyramid-funnel.diagram.stage.1.content.1"))).toBe(true);

    clearRenderDiagnostics();
    const out = join(mkdtempSync(join(tmpdir(), "slideml2-org-pyramid-e2e-")), "org-pyramid-office-e2e.pptx");
    await renderToPptx(rendered, out);
    const exportDiagnostics = getRenderDiagnostics();
    expect(blockingDiagnostics(exportDiagnostics), formatDiagnostics(exportDiagnostics)).toHaveLength(0);
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(12_000);

    const zip = await JSZip.loadAsync(readFileSync(out));
    const orgXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const pyramidXml = await zip.file("ppt/slides/slide2.xml")!.async("string");
    const funnelXml = await zip.file("ppt/slides/slide3.xml")!.async("string");

    expect(orgXml).toContain("<p:grpSp>");
    expect(orgXml).toContain("<p:cxnSp>");
    expect(orgXml).toContain("<a:stCxn");
    expect(orgXml).toContain("<a:endCxn");
    expect(orgXml).toContain('prst="bentConnector3"');
    expect(orgXml).toContain('name="org-pyramid-org.diagram.level.0.0"');
    expect(orgXml).toContain('name="org-pyramid-org.diagram.level.0.0.out-port"');
    expect(orgXml).toContain('name="org-pyramid-org.diagram.level.1.0.in-port"');
    expect(orgXml).toContain("客户成功部");

    expect(pyramidXml).toContain("<p:grpSp>");
    expect(pyramidXml).toContain('prst="trapezoid"');
    expect(pyramidXml).toContain('name="org-pyramid-pyramid.diagram.level.0.shape"');
    expect(pyramidXml).toContain('name="org-pyramid-pyramid.diagram.level.1.badge.0"');
    expect(pyramidXml).toContain("增长抓手");
    expect(pyramidXml).toContain("低触达运营");
    expect(pyramidXml).toContain("准时率92%");
    expect(shapeXmlByName(pyramidXml, "org-pyramid-pyramid.diagram.level.0.title")).toContain('sz="1100"');
    expect(shapeXmlByName(pyramidXml, "org-pyramid-pyramid.diagram.level.0.body")).not.toContain("normAutofit");

    expect(funnelXml).toContain("<p:grpSp>");
    expect(funnelXml).toContain('prst="trapezoid"');
    expect(funnelXml).toContain('flipV="1"');
    expect(funnelXml).toContain('name="org-pyramid-funnel.diagram.stage.0.shape"');
    expect(funnelXml).toContain('name="org-pyramid-funnel.diagram.stage.1.content.0"');
    expect(funnelXml).toContain('name="org-pyramid-funnel.diagram.stage.1.content.1"');
    expect(funnelXml).toContain("销售线索确认");
    expect(funnelXml).toContain("520个商机");
    expect(funnelXml).toContain("签约与扩容");
    expect(funnelXml).toContain("ARR");
    expect(shapeXmlByName(funnelXml, "org-pyramid-funnel.diagram.stage.0.title")).toContain('sz="1100"');
    expect(shapeXmlByName(funnelXml, "org-pyramid-funnel.diagram.stage.1.body")).not.toContain("normAutofit");
  });
});

function blockingDiagnostics(diagnostics: LayoutDiagnostic[]): LayoutDiagnostic[] {
  return diagnostics.filter((diag) => isBlockingRenderDiagnostic(diag.code, diag.severity));
}

function formatDiagnostics(diagnostics: LayoutDiagnostic[]): string {
  return diagnostics.map((diag) => `${diag.severity}:${diag.code}:${diag.nodeId || ""}:${diag.message}`).join("\n");
}

function allText(ast: ReturnType<typeof renderToAst>): string[] {
  const out: string[] = [];
  for (const shape of allShapes(ast)) {
    if (shape.type === "text") {
      for (const para of shape.paragraphs) {
        for (const run of para.runs) out.push(run.text);
      }
    }
  }
  return out.filter(Boolean);
}

function allShapes(ast: ReturnType<typeof renderToAst>): ReturnType<typeof renderToAst>["slides"][number]["shapes"] {
  const out: ReturnType<typeof renderToAst>["slides"][number]["shapes"] = [];
  const visit = (shape: ReturnType<typeof renderToAst>["slides"][number]["shapes"][number]) => {
    out.push(shape);
    if ("children" in shape && Array.isArray(shape.children)) {
      for (const child of shape.children) visit(child as ReturnType<typeof renderToAst>["slides"][number]["shapes"][number]);
    }
  };
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) visit(shape);
  }
  return out;
}

function shapeXmlByName(slideXml: string, name: string): string {
  const marker = `name="${name}"`;
  const index = slideXml.indexOf(marker);
  if (index < 0) return "";
  const start = slideXml.lastIndexOf("<p:sp", index);
  const end = slideXml.indexOf("</p:sp>", index);
  if (start < 0 || end < 0) return "";
  return slideXml.slice(start, end + "</p:sp>".length);
}
