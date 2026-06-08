import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { isBlockingRenderDiagnostic } from "./diagnostic-codes.js";
import { clearRenderDiagnostics, getRenderDiagnostics, type LayoutDiagnostic } from "./diagnostics.js";
import { renderToAst, renderToPptx } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";
import { validateDeck } from "./validate.js";

const SVG_IMAGE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MDAiIGhlaWdodD0iNDUwIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjQ1MCIgZmlsbD0iI0Y4RkFGQyIvPjxyZWN0IHg9IjYwIiB5PSI2MCIgd2lkdGg9IjY4MCIgaGVpZ2h0PSIzMzAiIHJ4PSIyNCIgZmlsbD0iIzI1NjNFQiIvPjxjaXJjbGUgY3g9IjIwMCIgY3k9IjIwMCIgcj0iNjAiIGZpbGw9IiNGRkZGRkYiIG9wYWNpdHk9Ii44NSIvPjxyZWN0IHg9IjMyMCIgeT0iMTUwIiB3aWR0aD0iMzIwIiBoZWlnaHQ9IjQwIiByeD0iOCIgZmlsbD0iI0ZGRkZGRiIgb3BhY2l0eT0iLjg1Ii8+PHJlY3QgeD0iMzIwIiB5PSIyMjAiIHdpZHRoPSIyMjAiIGhlaWdodD0iMzYiIHJ4PSI4IiBmaWxsPSIjRkZGRkZGIiBvcGFjaXR5PSIuNjUiLz48L3N2Zz4=";

const STRUCTURAL_COMPONENTS: Array<{ name: string; node: DomNode; expected: string }> = [
  {
    name: "section-header",
    expected: "局部标题",
    node: {
      id: "one.component",
      type: "section-header",
      eyebrow: "FRAME",
      title: "局部标题",
      subtitle: "这个区域说明主视觉应该如何阅读。",
      level: "h1",
      tone: "brand",
    } as DomNode,
  },
  {
    name: "figure",
    expected: "增长证据",
    node: {
      id: "one.component",
      type: "figure",
      title: "增长证据",
      chartType: "bar",
      labels: ["A", "B", "C"],
      series: [{ name: "Revenue", values: [18, 26, 41] }],
      caption: "三组样本均保持上升。",
      source: "Synthetic test data",
    } as DomNode,
  },
  {
    name: "rail-block",
    expected: "阅读提示",
    node: {
      id: "one.component",
      type: "rail-block",
      title: "阅读提示",
      body: "先看峰值，再看尾部风险。",
      items: ["主指标达标", "风险集中在长尾"],
      footer: "Owner: Data team",
      variant: "panel",
    } as DomNode,
  },
  {
    name: "evidence-block",
    expected: "主张优先",
    node: {
      id: "one.component",
      type: "evidence-block",
      claim: "主张优先",
      proofText: "样本覆盖三类典型场景，阻断诊断为 0。",
      interpretation: "这说明组件可以作为更大布局中的局部论证单元。",
      source: "render smoke test",
    } as DomNode,
  },
  {
    name: "key-value-list",
    expected: "参数",
    node: {
      id: "one.component",
      type: "key-value-list",
      title: "参数",
      items: [
        { key: "Region", value: "APAC" },
        { key: "Sample", value: "128" },
        { key: "Confidence", value: "High", tone: "positive" },
      ],
    } as DomNode,
  },
  {
    name: "module-strip",
    expected: "三个支撑点",
    node: {
      id: "one.component",
      type: "module-strip",
      title: "三个支撑点",
      items: [
        { value: "0", title: "阻断错误", body: "主流程干净", tone: "positive" },
        { value: "6", title: "结构组件", body: "覆盖中阶组合" },
        { value: "3", title: "测试层级", body: "单页/压力/e2e" },
      ],
    } as DomNode,
  },
];

describe("mid-level structural components", () => {
  it("renders each component on a single slide without blocking diagnostics", () => {
    for (const fixture of STRUCTURAL_COMPONENTS) {
      const source = deckWith([{
        id: `single-${fixture.name}`,
        title: `Single ${fixture.name}`,
        children: [fixture.node],
      }]);

      const { ast, diagnostics } = renderChecked(source);
      expect(blockingDiagnostics(diagnostics), `${fixture.name}\n${formatDiagnostics(diagnostics)}`).toHaveLength(0);
      expect(allText(ast).join("\n")).toContain(fixture.expected);
    }
  });

  it("keeps structural components usable under split/grid/rail layout pressure", () => {
    const source = deckWith([pressureSlide()]);
    const { ast, diagnostics } = renderChecked(source);

    expect(blockingDiagnostics(diagnostics), formatDiagnostics(diagnostics)).toHaveLength(0);
    const text = allText(ast).join("\n");
    for (const expected of [
      "结构组件压力测试",
      "主证据区域",
      "关键读取",
      "Fit",
      "参数",
      "局部论证",
      "辅助模块",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("exports an end-to-end PPTX deck containing the structural components", async () => {
    const source = deckWith([
      pressureSlide(),
      {
        id: "structural-gallery",
        title: "结构组件组合页",
        children: [{
          id: "structural-gallery.grid",
          type: "grid",
          columns: 2,
          gap: 0.42,
          children: [
            {
              id: "structural-gallery.figure",
              type: "figure",
              title: "图像证据",
              src: SVG_IMAGE,
              caption: "图片证据被约束在可伸缩 figure 内。",
              source: "Generated SVG fixture",
              variant: "card",
            },
            {
              id: "structural-gallery.evidence",
              type: "evidence-block",
              claim: "局部论证可以与图像并列",
              proof: {
                id: "structural-gallery.evidence.kv",
                type: "key-value-list",
                columns: 2,
                items: [
                  { key: "Layout", value: "grid" },
                  { key: "Density", value: "compact" },
                  { key: "Surface", value: "panel" },
                  { key: "Export", value: "pptx" },
                ],
              },
              interpretation: "proof 子节点继续使用全局布局预算。",
            },
            {
              id: "structural-gallery.strip",
              type: "module-strip",
              colSpan: 2,
              title: "辅助模块",
              density: "compact",
              items: [
                { title: "Header", body: "统一局部标题" },
                { title: "Figure", body: "统一证据块" },
                { title: "Rail", body: "统一侧栏解释" },
                { title: "KV", body: "统一事实对齐" },
              ],
            },
          ],
        } as DomNode],
      },
    ]);

    const validation = validateDeck(source);
    expect(validation.errors, validation.errors.map((item) => `${item.code}: ${item.message}`).join("\n")).toHaveLength(0);

    clearRenderDiagnostics();
    const rendered = sourceToRenderedDeck(source);
    renderToAst(rendered);
    expect(blockingDiagnostics(getRenderDiagnostics()), formatDiagnostics(getRenderDiagnostics())).toHaveLength(0);

    clearRenderDiagnostics();
    const out = join(mkdtempSync(join(tmpdir(), "slideml2-structural-components-")), "structural-components.pptx");
    await renderToPptx(rendered, out);
    const exportDiagnostics = getRenderDiagnostics();
    expect(blockingDiagnostics(exportDiagnostics), formatDiagnostics(exportDiagnostics)).toHaveLength(0);
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(10_000);

    const zip = await JSZip.loadAsync(readFileSync(out));
    const slide1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const slide2 = await zip.file("ppt/slides/slide2.xml")!.async("string");
    expect(slide1).toContain("结构组件压力测试");
    expect(slide1).toContain("关键读取");
    expect(slide2).toContain("结构组件组合页");
    expect(slide2).toContain("图像证据");
    expect(slide2).toContain("辅助模块");
  });
});

function pressureSlide(): SlideV2 {
  return {
    id: "structural-pressure",
    title: "结构组件压力测试",
    children: [{
      id: "structural-pressure.split",
      type: "split",
      direction: "horizontal",
      ratio: [0.64, 0.36],
      gap: 0.36,
      children: [
        {
          id: "structural-pressure.main",
          type: "stack",
          direction: "vertical",
          gap: 0.24,
          children: [
            {
              id: "structural-pressure.header",
              type: "section-header",
              eyebrow: "PRIMARY",
              title: "主证据区域",
              subtitle: "在普通 stack 中保持标题、视觉和辅助模块的弹性。",
              level: "h1",
            },
            {
              id: "structural-pressure.figure",
              type: "figure",
              title: "趋势图",
              chartType: "line",
              labels: ["Q1", "Q2", "Q3", "Q4"],
              series: [{ name: "Fit", values: [42, 54, 61, 73] }],
              caption: "主图需要比下方模块获得更高布局优先级。",
              variant: "compact",
            },
            {
              id: "structural-pressure.strip",
              type: "module-strip",
              title: "辅助模块",
              density: "compact",
              items: [
                { value: "+31pp", title: "Fit", body: "趋势改善", tone: "positive" },
                { value: "2", title: "Warnings", body: "可选信息", tone: "warning" },
                { value: "0", title: "Blockers", body: "无阻断", tone: "positive" },
              ],
            },
          ],
        },
        {
          id: "structural-pressure.rail",
          type: "side-rail",
          title: "关键读取",
          body: "侧栏区域故意偏窄，用来验证 rail-block、key-value-list 和 evidence-block 的组合弹性。",
          tone: "tinted",
          children: [
            {
              id: "structural-pressure.rail.block",
              type: "rail-block",
              title: "解读顺序",
              body: "先看主趋势，再看异常项。",
              items: ["趋势持续", "风险可解释"],
              density: "compact",
              variant: "plain",
            },
            {
              id: "structural-pressure.rail.kv",
              type: "key-value-list",
              title: "参数",
              density: "compact",
              items: [
                { key: "Owner", value: "Design systems" },
                { key: "Mode", value: "split + rail" },
                { key: "Fit", value: "Pass", tone: "positive" },
                { key: "Density", value: "Compact" },
                { key: "Risk", value: "Medium", tone: "warning" },
              ],
            },
            {
              id: "structural-pressure.rail.evidence",
              type: "evidence-block",
              claim: "局部论证",
              proofText: "证明文本保持一行优先，必要时参与 shrink。",
              interpretation: "不会要求整页模板才能使用。",
              variant: "compact",
            },
          ],
        },
      ],
    } as DomNode],
  };
}

function deckWith(slides: SlideV2[]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: "default",
      brand: { name: "Structural Components", primary: "2563EB" },
    },
    slides,
  };
}

function renderChecked(source: Slideml2SourceDeck): { ast: ReturnType<typeof renderToAst>; diagnostics: LayoutDiagnostic[] } {
  const validation = validateDeck(source);
  expect(validation.errors, validation.errors.map((item) => `${item.code}: ${item.message}`).join("\n")).toHaveLength(0);
  clearRenderDiagnostics();
  const ast = renderToAst(sourceToRenderedDeck(source));
  const diagnostics = getRenderDiagnostics();
  return { ast, diagnostics };
}

function blockingDiagnostics(diagnostics: LayoutDiagnostic[]): LayoutDiagnostic[] {
  return diagnostics.filter((diag) => isBlockingRenderDiagnostic(diag.code, diag.severity));
}

function formatDiagnostics(diagnostics: LayoutDiagnostic[]): string {
  return diagnostics.map((diag) => `${diag.severity}:${diag.code}:${diag.slideId || ""}:${diag.nodeId || ""}:${diag.message}`).join("\n");
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
