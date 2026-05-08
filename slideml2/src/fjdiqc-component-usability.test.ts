import { describe, expect, it } from "vitest";
import { clearRenderDiagnostics, getRenderDiagnostics, type LayoutDiagnostic } from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { validateSlide } from "./validate.js";
import type { DomNode, RenderedDeck, Slideml2SourceDeck, SlideV2 } from "./types.js";

const baseDeck = { deck: { size: "16x9" as const, theme: "default", brand: { primary: "1E3A5F" } } };
const BLOCKING = new Set<LayoutDiagnostic["code"]>([
  "FALLBACK_FAILED",
  "COLLISION",
  "TINY_RECT",
  "SQUASHED",
  "LOW_CONTRAST",
  "UNKNOWN_COLOR",
  "UNKNOWN_STYLE",
]);

function deckWith(slide: SlideV2): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: "default",
      brand: { name: "Business", primary: "1E3A5F" },
      themeOverride: {
        layout: { contentTop: 2.6, contentBottom: 13.35, pageMarginX: 1.25 },
        text: { paragraph: { fontSize: 12, lineHeight: 1.35 } },
      },
    },
    slides: [slide],
  };
}

function blockingAfterRender(deck: Slideml2SourceDeck): LayoutDiagnostic[] {
  clearRenderDiagnostics();
  renderToAst(sourceToRenderedDeck(deck));
  return getRenderDiagnostics().filter((d) => d.severity === "error" || BLOCKING.has(d.code));
}

function findNode(node: DomNode | undefined, id: string): DomNode | undefined {
  if (!node) return undefined;
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return undefined;
}

function shapeText(shape: unknown): string {
  const textShape = shape as { type?: string; paragraphs?: Array<{ runs?: Array<{ text?: string }> }> };
  if (textShape.type !== "text") return "";
  return (textShape.paragraphs || []).flatMap((p) => p.runs || []).map((r) => r.text || "").join("");
}

describe("fjdiqc component usability regressions", () => {
  it("bar-list preserves authored star labels and accepts neutral tone", () => {
    const slide: SlideV2 = {
      id: "fj-stars",
      children: [{
        id: "fj-stars.ratings",
        type: "bar-list",
        tone: "neutral",
        items: [
          { label: "第一档", value: "★★★★★", tone: "success" },
          { label: "第二档", value: "★★★★", tone: "brand" },
          { label: "第三档", value: "★★★", tone: "neutral" },
          { label: "警示", value: "⚠️", tone: "danger" },
        ],
      } as unknown as DomNode],
    };
    const validation = validateSlide(slide, baseDeck);
    expect(validation.errors.map((e) => e.code)).not.toContain("INVALID_FIELD_USAGE");

    const ast = renderToAst(sourceToRenderedDeck(deckWith(slide)));
    const renderedTexts = ast.slides[0]!.shapes.map(shapeText).filter(Boolean);
    expect(renderedTexts).toContain("★★★★★");
    expect(renderedTexts).toContain("★★★★");
    expect(renderedTexts).toContain("★★★");
    expect(renderedTexts).toContain("⚠️");
    expect(renderedTexts.filter((text) => text === "0")).toHaveLength(0);
  });

  it("h1 can coexist with slide.title, while cover-composition suppresses injected metadata title", () => {
    const ordinary: SlideV2 = {
      id: "fj-h1",
      title: "市场三层结构：应用层是创业主战场",
      children: [{ id: "fj-h1.body-title", type: "h1", text: "三层结构决定价值分布" } as unknown as DomNode],
    };
    expect(validateSlide(ordinary, baseDeck).errors.map((e) => e.code)).not.toContain("DUPLICATE_HERO_TITLE");

    const cover: SlideV2 = {
      id: "fj-cover",
      title: "AI Agent 时代机会总图",
      background: "1E3A5F",
      children: [{
        id: "fj-cover.lockup",
        type: "cover-composition",
        title: "AI Agent 时代机会总图",
        subtitle: "最终综合报告",
        tone: "inverse",
      } as unknown as DomNode],
    };
    const rendered: RenderedDeck = sourceToRenderedDeck(deckWith(cover));
    expect(findNode(rendered.slides[0]!.dom, "fj-cover.title")).toBeUndefined();
  });

  it("short text-bearing bands auto-reduce padding instead of squashing children", () => {
    const slide: SlideV2 = {
      id: "fj-band",
      title: "市场三层结构：应用层是创业主战场",
      children: [
        {
          id: "fj-band.layer1",
          type: "band",
          tone: "brand",
          height: 1.5,
          children: [
            { id: "fj-band.layer1.label", type: "label", text: "应用层 · 巨头主战场 + 创业主战场", tone: "brand" },
            { id: "fj-band.layer1.content", type: "text", text: "通用Office Agent（巨头）| 垂直行业Agent（创业）| 个人/团队Productivity（出海）", style: "paragraph" },
          ],
        },
        {
          id: "fj-band.layer2",
          type: "band",
          tone: "warning",
          height: 1.5,
          children: [
            { id: "fj-band.layer2.label", type: "label", text: "平台层 · 生态主战场", tone: "warning" },
            { id: "fj-band.layer2.content", type: "text", text: "Agent OS/工作平台 | MCP Gateway/Tool市场 | 协议层（MCP/A2A/ACP）", style: "paragraph" },
          ],
        },
        {
          id: "fj-band.layer3",
          type: "band",
          tone: "neutral",
          height: 1.5,
          children: [
            { id: "fj-band.layer3.label", type: "label", text: "基础设施层 · 巨头垂直集成", tone: "neutral" },
            { id: "fj-band.layer3.content", type: "text", text: "Runtime/Sandbox/Browser | Memory/Eval/Identity/Router | 模型+Inference", style: "paragraph" },
          ],
        },
      ] as unknown as DomNode[],
    };
    const blocking = blockingAfterRender(deckWith(slide));
    expect(blocking, blocking.map((d) => `${d.code} ${d.nodeId}: ${d.message}`).join("\n")).toHaveLength(0);
  });
});
