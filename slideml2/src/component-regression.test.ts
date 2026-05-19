import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
  type LayoutDiagnostic,
} from "./diagnostics.js";
import { renderToAst, measureDeck, renderToPptx, layoutDecisionsForSlide } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { validateDeck, validateSlide } from "./validate.js";
import { expandComponent } from "./component-registry.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Targeted regressions for component bugs discovered in the wuur34 debug log
 * and during the surfaceTrail/cluster work. Each test pins one small claim
 * about how the renderer or validator should behave; they protect against
 * accidental reverts from future component refactors.
 */

const baseDeck = { deck: { size: "16x9" as const, theme: "default", brand: { primary: "2563EB" } } };

const TINY_PNG = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiPjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiIGZpbGw9IiMyNTYzZWIiLz48L3N2Zz4=";

const BLOCKING_CODES: ReadonlySet<LayoutDiagnostic["code"]> = new Set<LayoutDiagnostic["code"]>([
  "FALLBACK_FAILED",
  "COLLISION",
  "TINY_RECT",
  "SQUASHED",
  "UNKNOWN_COLOR",
  "UNKNOWN_STYLE",
]);

function buildDeckWithSlide(slide: SlideV2): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { name: "Test", primary: "2563EB" } },
    slides: [slide],
  };
}

function findShapeByName(ast: ReturnType<typeof renderToAst>, name: string) {
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) {
      if (shape.type === "text" && shape.name === name) return shape;
      if (shape.type === "shape" && shape.name === name) return shape;
    }
  }
  return undefined;
}

function findRenderedByName(ast: ReturnType<typeof renderToAst>, name: string) {
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) {
      if ((shape as { name?: string }).name === name) return shape;
    }
  }
  return undefined;
}

function firstTextShapeContaining(ast: ReturnType<typeof renderToAst>, text: string) {
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) {
      if (shape.type !== "text") continue;
      const allText = shape.paragraphs?.flatMap((p) => p.runs.map((r) => r.text)).join("") || "";
      if (allText.includes(text)) return shape;
    }
  }
  return undefined;
}

function firstRenderedShapeContaining(ast: ReturnType<typeof renderToAst>, text: string) {
  const textShape = firstTextShapeContaining(ast, text);
  if (textShape) return textShape;
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) {
      if (shape.type !== "table") continue;
      const cells = (shape as { cells?: Array<Array<{ runs?: Array<{ text?: string }> }>> }).cells || [];
      const allText = cells.flatMap((row) => row.flatMap((cell) => (cell.runs || []).map((run) => run.text || ""))).join("");
      if (allText.includes(text)) return shape;
    }
  }
  return undefined;
}

function findRunColor(ast: ReturnType<typeof renderToAst>, name: string): string | undefined {
  const shape = findShapeByName(ast, name);
  if (!shape || shape.type !== "text") return undefined;
  return shape.paragraphs?.[0]?.runs?.[0]?.color;
}

function shapeRectCm(shape: { xfrm?: { x?: number; y?: number; cx?: number; cy?: number } } | undefined) {
  const xfrm = shape?.xfrm;
  if (!xfrm) return undefined;
  return {
    x: (xfrm.x ?? 0) / 360000,
    y: (xfrm.y ?? 0) / 360000,
    w: (xfrm.cx ?? 0) / 360000,
    h: (xfrm.cy ?? 0) / 360000,
  };
}

function firstRunSizeHalfPt(shape: unknown): number | undefined {
  const textShape = shape as { paragraphs?: Array<{ runs?: Array<{ sizeHalfPt?: number }> }> } | undefined;
  return textShape?.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt;
}

function findDomNode(node: DomNode | undefined, id: string): DomNode | undefined {
  if (!node) return undefined;
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findDomNode(child, id);
    if (found) return found;
  }
  return undefined;
}

describe("component regressions", () => {
  it("ctaButton renders text.inverse hex on a brand-fill surface", () => {
    const slide: SlideV2 = {
      id: "reg-cta",
      children: [{ id: "reg-cta.btn", type: "cta", text: "立即开始", tone: "brand" }],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const runColor = findRunColor(ast, "reg-cta.btn");
    // text.inverse resolves to FFFFFF in the default theme.
    expect(runColor, JSON.stringify(ast.slides[0].shapes, null, 2)).toBe("FFFFFF");
    const blocking = getRenderDiagnostics().filter((d) => BLOCKING_CODES.has(d.code) && d.severity !== "info");
    expect(blocking, JSON.stringify(blocking)).toHaveLength(0);
  });

  it("feature-card renders generated raster iconSrc as a contain-fit image", () => {
    const slide: SlideV2 = {
      id: "icons",
      title: "Generated icons",
      children: [
        {
          id: "icons.feature",
          type: "feature-card",
          title: "Risk Control",
          body: "Use the generated icon as the feature cue.",
          iconSrc: TINY_PNG,
          variant: "card",
        },
      ],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const icon = findRenderedByName(ast, "icons.feature.icon");
    expect(icon?.type).toBe("image");
    expect((icon as { fit?: string } | undefined)?.fit).toBe("contain");
  });

  it("feature-card compact surface still reserves internal padding", () => {
    const slide: SlideV2 = {
      id: "feature-pad",
      title: "Feature padding",
      children: [
        {
          id: "feature-pad.card",
          type: "feature-card",
          title: "敕勒川",
          body: "阴山南麓的草原空间。",
          variant: "compact",
          surface: { fill: "#1A2A3A", line: "#3A4A5A" },
        },
      ],
    };
    const measured = measureDeck(sourceToRenderedDeck(buildDeckWithSlide(slide)))[0]!.nodes;
    const card = measured.find((n) => n.id === "feature-pad.card")?.rect;
    const icon = measured.find((n) => n.id === "feature-pad.card.icon")?.rect;
    const title = measured.find((n) => n.id === "feature-pad.card.title")?.rect;
    expect(card).toBeDefined();
    expect(icon).toBeUndefined();
    expect(title).toBeDefined();
    expect(title!.x - card!.x).toBeGreaterThanOrEqual(0.24);
  });

  it("feature-card horizontal layout places decoration left of text without auto switching", () => {
    const slide: SlideV2 = {
      id: "feature-horizontal",
      title: "Feature horizontal",
      children: [
        {
          id: "feature-horizontal.card",
          type: "feature-card",
          title: "空间层级",
          body: "川、山、天、野依次展开。",
          layout: "horizontal",
          variant: "compact",
          decoration: { kind: "shape", shape: "diamond", size: "md", color: "brand.primary", background: "brand.tint" },
          surface: { fill: "#1A2A3A", line: "#3A4A5A" },
        } as unknown as DomNode,
      ],
    };
    const measured = measureDeck(sourceToRenderedDeck(buildDeckWithSlide(slide)))[0]!.nodes;
    const icon = measured.find((n) => n.id === "feature-horizontal.card.icon")?.rect;
    const title = measured.find((n) => n.id === "feature-horizontal.card.title")?.rect;
    expect(icon).toBeDefined();
    expect(title).toBeDefined();
    expect(title!.x).toBeGreaterThan(icon!.x + icon!.w + 0.18);
  });

  it("feature-card does not draw a default icon when decoration is omitted", () => {
    const slide: SlideV2 = {
      id: "feature-plain",
      title: "Plain feature",
      children: [
        {
          id: "feature-plain.card",
          type: "feature-card",
          title: "No implicit ornament",
          body: "Plain text card.",
          variant: "card",
        } as unknown as DomNode,
      ],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    expect(findRenderedByName(ast, "feature-plain.card.icon")).toBeUndefined();
    expect(findRenderedByName(ast, "feature-plain.card.marker")).toBeUndefined();
  });

  it("feature-card compact without decoration keeps title and body vertical", () => {
    const card = expandComponent("feature-compact-plain", {
      id: "feature-compact-plain.card",
      type: "feature-card",
      title: "Plain compact",
      body: "Body should sit below the title, not beside it.",
      variant: "compact",
    } as unknown as DomNode);
    expect(card.direction).toBe("vertical");
    expect(card.children?.find((child) => child.id.endsWith(".content"))).toBeUndefined();
  });

  it("feature-card decoration:none disables explicit decoration output", () => {
    const slide: SlideV2 = {
      id: "feature-none",
      title: "No decoration",
      children: [
        {
          id: "feature-none.card",
          type: "feature-card",
          title: "No icon",
          body: "Plain text card.",
          decoration: { kind: "none" },
          variant: "card",
        } as unknown as DomNode,
      ],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    expect(findRenderedByName(ast, "feature-none.card.icon")).toBeUndefined();
    expect(findRenderedByName(ast, "feature-none.card.marker")).toBeUndefined();
  });

  it("invalid child nodes validate with format guidance and do not synthesize empty text", () => {
    const deck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "invalid-child",
        children: ["bare text is not a node" as unknown as DomNode],
      }],
    } as Slideml2SourceDeck;
    const report = validateDeck(deck);
    const invalid = report.errors.find((item) => item.code === "INVALID_NODE");
    expect(invalid?.suggestedFix).toContain("{id:'body', type:'text'");
    expect(() => renderToAst(sourceToRenderedDeck(deck))).not.toThrow();
    const rendered = sourceToRenderedDeck(deck);
    expect(findDomNode(rendered.slides[0]!.dom, "invalid-child.node-1")?.type).toBe("fragment");
  });

  it("component surface line:none is honored on feature-card and other cards", () => {
    const slide: SlideV2 = {
      id: "card-border",
      title: "Card borders",
      children: [
        { id: "card-border.feature", type: "feature-card", title: "Feature", body: "No border.", variant: "compact", fill: "#123456", line: "none" } as unknown as DomNode,
        { id: "card-border.metric", type: "metric-card", value: "42", label: "No border", fill: "#123456", line: "none" } as unknown as DomNode,
      ],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const featureBg = findRenderedByName(ast, "card-border.feature-background") as { line?: unknown } | undefined;
    const metricBg = findRenderedByName(ast, "card-border.metric-background") as { line?: unknown } | undefined;
    expect(featureBg).toBeDefined();
    expect(metricBg).toBeDefined();
    expect(featureBg?.line).toBeUndefined();
    expect(metricBg?.line).toBeUndefined();
  });

  it("raw card panel frame and shape honor surface line controls", () => {
    const slide: SlideV2 = {
      id: "surface-pass",
      title: "Surface passthrough",
      children: [
        {
          id: "surface-pass.stack",
          type: "stack",
          direction: "vertical",
          gap: 0.2,
          children: [
            {
              id: "surface-pass.card",
              type: "card",
              fixedHeight: 0.85,
              surface: { fill: "#123456", borderColor: "#ABCDEF", borderWidth: 2, borderStyle: "dot" },
              children: [],
            },
            {
              id: "surface-pass.panel",
              type: "panel",
              fixedHeight: 0.85,
              surface: { fill: "#123456", line: "none" },
              children: [],
            },
            {
              id: "surface-pass.frame",
              type: "frame",
              fixedHeight: 0.4,
              surface: { line: "none" },
              children: [],
            },
            {
              id: "surface-pass.shape",
              type: "shape",
              preset: "rect",
              fixedHeight: 0.85,
              fill: "#123456",
              line: { color: "none" },
            },
            {
              id: "surface-pass.shape-border",
              type: "shape",
              preset: "rect",
              fixedHeight: 0.55,
              fill: "none",
              line: "#ABCDEF",
              borderWidth: 3,
              borderStyle: "dash",
            },
            {
              id: "surface-pass.text-fill-none",
              type: "text",
              text: "Transparent text box",
              fixedHeight: 0.45,
              fill: "none",
              line: "#ABCDEF",
              lineWidth: 3,
              lineDash: "dash",
            },
            {
              id: "surface-pass.divider",
              type: "divider",
              fixedHeight: 0.2,
              line: "#ABCDEF",
              lineDash: "dash",
            },
            {
              id: "surface-pass.divider-none",
              type: "divider",
              fixedHeight: 0.2,
              line: "none",
            },
            {
              id: "surface-pass.box",
              type: "stack",
              fixedHeight: 0.85,
              surface: { fill: "#123456", border: { color: "#ABCDEF", width: 2, style: "dash" } },
              children: [{ id: "surface-pass.box.text", type: "text", text: "Box", style: "label" }],
            },
          ],
        } as unknown as DomNode,
      ],
    };

    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const card = findRenderedByName(ast, "surface-pass.card-card") as { line?: { dash?: string; color?: string; width?: number } } | undefined;
    const panel = findRenderedByName(ast, "surface-pass.panel-panel") as { line?: unknown } | undefined;
    const frame = findRenderedByName(ast, "surface-pass.frame-frame") as { line?: unknown; fill?: { type?: string } } | undefined;
    const shape = findRenderedByName(ast, "surface-pass.shape") as { line?: unknown } | undefined;
    const shapeBorder = findRenderedByName(ast, "surface-pass.shape-border") as { line?: { color?: string; width?: number; dash?: string }; fill?: { type?: string } } | undefined;
    const textFillNone = findRenderedByName(ast, "surface-pass.text-fill-none") as { line?: { color?: string; width?: number; dash?: string }; fill?: { type?: string } } | undefined;
    const divider = findRenderedByName(ast, "surface-pass.divider") as { line?: { color?: string; dash?: string } } | undefined;
    const dividerNone = findRenderedByName(ast, "surface-pass.divider-none") as { line?: unknown } | undefined;
    const boxBg = findRenderedByName(ast, "surface-pass.box-background") as { line?: { color?: string; dash?: string; width?: number } } | undefined;
    expect(card?.line?.color).toBe("ABCDEF");
    expect(card?.line?.dash).toBe("dot");
    expect(card?.line?.width).toBeGreaterThan(20000);
    expect(panel?.line).toBeUndefined();
    expect(frame?.line).toBeUndefined();
    expect(frame?.fill?.type).toBe("none");
    expect(shape?.line).toBeUndefined();
    expect(shapeBorder?.fill?.type).toBe("none");
    expect(shapeBorder?.line?.color).toBe("ABCDEF");
    expect(shapeBorder?.line?.width).toBeGreaterThan(30000);
    expect(shapeBorder?.line?.dash).toBe("dash");
    expect(textFillNone?.fill?.type).toBe("none");
    expect(textFillNone?.line?.color).toBe("ABCDEF");
    expect(textFillNone?.line?.width).toBeGreaterThan(30000);
    expect(textFillNone?.line?.dash).toBe("dash");
    expect(divider?.line?.color).toBe("ABCDEF");
    expect(divider?.line?.dash).toBe("dash");
    expect(dividerNone?.line).toBeUndefined();
    expect(boxBg?.line?.color).toBe("ABCDEF");
    expect(boxBg?.line?.dash).toBe("dash");
    expect(boxBg?.line?.width).toBeGreaterThan(20000);
    const unknownColor = getRenderDiagnostics().filter((d) => d.code === "UNKNOWN_COLOR");
    expect(unknownColor, JSON.stringify(unknownColor)).toHaveLength(0);
  });

  it("nested surface padding participates in wrapper layout measurement", () => {
    const slide: SlideV2 = {
      id: "surface-padding",
      title: "Surface padding",
      children: [
        {
          id: "surface-padding.card",
          type: "card",
          fixedHeight: 2.2,
          surface: { fill: "#123456", padding: 0.8 },
          children: [
            { id: "surface-padding.card.text", type: "text", text: "Inner text", style: "paragraph" },
          ],
        } as unknown as DomNode,
      ],
    };
    const measured = measureDeck(sourceToRenderedDeck(buildDeckWithSlide(slide)))[0]!.nodes;
    const card = measured.find((n) => n.id === "surface-padding.card")?.rect;
    const text = measured.find((n) => n.id === "surface-padding.card.text")?.rect;
    expect(card).toBeDefined();
    expect(text).toBeDefined();
    expect(text!.x - card!.x).toBeGreaterThanOrEqual(0.75);
    expect(text!.y - card!.y).toBeGreaterThanOrEqual(0.75);
  });

  it("table-card nested surface fill is forwarded to the table body", () => {
    const slide: SlideV2 = {
      id: "table-surface",
      title: "Table surface",
      children: [
        {
          id: "table-surface.tbl",
          type: "table-card",
          headers: ["Metric", "Value"],
          rows: [["A", "1"]],
          surface: { fill: "#123456" },
        } as unknown as DomNode,
      ],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const table = findRenderedByName(ast, "table-surface.tbl.table") as { cells?: Array<Array<{ fill?: { color?: string } }>> } | undefined;
    expect(table?.cells?.[1]?.[0]?.fill?.color).toBe("123456");
  });

  it("table fills accept fill:none without treating it as a color token", () => {
    const slide: SlideV2 = {
      id: "table-fill-none",
      title: "Table transparent fill",
      children: [
        {
          id: "table-fill-none.tbl",
          type: "table-card",
          headers: ["Metric", "Value"],
          rows: [[{ text: "A", fill: "none" }, "1"]],
          surface: { fill: "none", line: "#ABCDEF" },
          borderColor: "none",
        } as unknown as DomNode,
      ],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const table = findRenderedByName(ast, "table-fill-none.tbl.table") as { cells?: Array<Array<{ fill?: { type?: string; color?: string } }>>; borders?: Record<string, unknown> } | undefined;
    expect(table?.cells?.[1]?.[0]?.fill?.type).toBe("none");
    expect(table?.cells?.[1]?.[1]?.fill?.type).toBe("none");
    expect(table?.borders?.left).toBe("none");
    expect(table?.borders?.right).toBe("none");
    const unknownColor = getRenderDiagnostics().filter((d) => d.code === "UNKNOWN_COLOR");
    expect(unknownColor, JSON.stringify(unknownColor)).toHaveLength(0);
  });

  it("image border aliases and none-style modifiers are honored", () => {
    const slide: SlideV2 = {
      id: "image-surface",
      title: "Image modifiers",
      children: [
        {
          id: "image-surface.img",
          type: "image",
          src: TINY_PNG,
          alt: "modifier test",
          borderColor: "#ABCDEF",
          borderWidth: 2,
          borderStyle: "dash",
          lineOpacity: 0.4,
          opacity: 0.72,
          overlay: { color: "none", alpha: 0.2 },
          shadow: { color: "none" },
        } as unknown as DomNode,
      ],
    };

    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const image = findRenderedByName(ast, "image-surface.img") as { border?: { color?: string; width?: number; dash?: string; alpha?: number }; opacity?: number; overlay?: unknown; shadow?: unknown } | undefined;
    expect(image?.border?.color).toBe("ABCDEF");
    expect(image?.border?.width).toBeGreaterThan(20000);
    expect(image?.border?.dash).toBe("dash");
    expect(image?.border?.alpha).toBe(0.4);
    expect(image?.opacity).toBe(0.72);
    expect(image?.overlay).toBeUndefined();
    expect(image?.shadow).toBeUndefined();
    const unknownColor = getRenderDiagnostics().filter((d) => d.code === "UNKNOWN_COLOR");
    expect(unknownColor, JSON.stringify(unknownColor)).toHaveLength(0);
  });

  it("feature-card keeps generated iconSrc when a marker is also present", () => {
    const slide: SlideV2 = {
      id: "icons-marker",
      title: "Generated icons with marker",
      children: [
        {
          id: "icons-marker.feature",
          type: "feature-card",
          title: "Risk Control",
          iconSrc: TINY_PNG,
          marker: { shape: "rounded-square", tone: "brand", variant: "tint" },
          variant: "card",
        },
      ],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    expect(findRenderedByName(ast, "icons-marker.feature.icon")?.type).toBe("image");
    expect(findRenderedByName(ast, "icons-marker.feature.marker")?.type).toBe("shape");
  });

  it("feature-card semantic tone maps to a real theme color", () => {
    const slide: SlideV2 = {
      id: "feature-tone",
      title: "Feature tone",
      children: [
        {
          id: "feature-tone.card",
          type: "feature-card",
          title: "Positive signal",
          body: "Semantic tone should not be treated as a raw color token.",
          tone: "positive",
          variant: "card",
        } as unknown as DomNode,
      ],
    };

    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const unknownTone = getRenderDiagnostics().filter((d) => d.code === "UNKNOWN_COLOR" && /positive/i.test(d.message));
    expect(unknownTone).toHaveLength(0);
  });

  it("feature-card semantic tone uses an accessible title accent token", () => {
    const slide: SlideV2 = {
      id: "feature-warning-title",
      title: "Feature warning tone",
      children: [
        {
          id: "feature-warning-title.card",
          type: "feature-card",
          title: "日照金山",
          body: "10月至次年4月，金色持续数分钟",
          tone: "warning",
          variant: "card",
        } as unknown as DomNode,
      ],
    };

    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    expect(findRunColor(ast, "feature-warning-title.card.title")).toBe("B45309");
    const titleContrastFix = getRenderDiagnostics().filter((d) =>
      d.code === "LOW_CONTRAST_FIXED" && d.nodeId === "feature-warning-title.card.title"
    );
    expect(titleContrastFix).toHaveLength(0);
  });

  it("feature-card titleColor still allows explicit title color override", () => {
    const slide: SlideV2 = {
      id: "feature-title-color",
      title: "Feature title color",
      children: [
        {
          id: "feature-title-color.card",
          type: "feature-card",
          title: "Explicit token",
          body: "Local override should win over semantic tone.",
          tone: "warning",
          titleColor: "brand.primary",
          variant: "card",
        } as unknown as DomNode,
      ],
    };

    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    expect(findRunColor(ast, "feature-title-color.card.title")).toBe("2563EB");
  });

  it("ctaButton with link still inherits node.color into content runs", () => {
    const slide: SlideV2 = {
      id: "reg-cta-link",
      children: [{ id: "reg-cta-link.btn", type: "cta", text: "前往", tone: "brand", link: "https://example.com" } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const runColor = findRunColor(ast, "reg-cta-link.btn");
    expect(runColor).toBe("FFFFFF");
  });

  it("process-flow compact density applies to a three-step vertical card flow", () => {
    const slide: SlideV2 = {
      id: "compact-flow",
      title: "市场地图：三层结构",
      children: [
        {
          id: "compact-flow.flow",
          type: "process-flow",
          variant: "cards",
          direction: "vertical",
          density: "compact",
          steps: [
            { title: "应用层", body: "通用Office Agent / 垂直行业Agent / 出海Productivity", status: "brand" },
            { title: "平台层", body: "Agent OS / MCP Gateway / 协议层(MCP/A2A/ACP)", status: "brand" },
            { title: "基础设施层", body: "巨头垂直集成：Runtime/Browser/Memory/Eval/模型", status: "brand" },
          ],
        } as unknown as DomNode,
        {
          id: "compact-flow.note",
          type: "source-note",
          text: "中国基建层不出独立SaaS——15年历史规律：云监控/训练infra/向量库/CI/CD均被巨头内置",
        } as unknown as DomNode,
      ],
    };

    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const failed = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED" && d.slideId === "compact-flow");
    expect(failed, JSON.stringify(failed, null, 2)).toHaveLength(0);
  });

  it("profile-card with default photo size does not emit SQUASHED on the photo", () => {
    const slide: SlideV2 = {
      id: "reg-profile",
      children: [{
        id: "reg-profile.card",
        type: "profile-card",
        image: TINY_PNG,
        name: "张三",
        role: "工程师",
        bio: "短简介。",
      }],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const squashed = getRenderDiagnostics().filter((d) => d.code === "SQUASHED");
    expect(squashed, squashed.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("title-lockup with tone:'inverse' is wrapped in a brand-fill band so the text stays readable", () => {
    const slide: SlideV2 = {
      id: "reg-lockup",
      children: [{
        id: "reg-lockup.lock",
        type: "title-lockup",
        title: "封面标题",
        subtitle: "副标题",
        tone: "inverse",
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    // A band shape ('roundRect' or 'rect' rendered via renderBand) carrying the
    // brand fill should appear in the rendered shapes — that's how the inverse
    // text stays readable on a default light deck.
    const hasBrandFill = ast.slides[0].shapes.some((shape) => shape.type === "shape" && shape.fill?.type === "solid" && (shape.fill.color === "2563EB"));
    expect(hasBrandFill, JSON.stringify(ast.slides[0].shapes.map((s) => s.type === "shape" ? { fill: s.fill } : { type: s.type }))).toBe(true);
    const blocking = getRenderDiagnostics().filter((d) => BLOCKING_CODES.has(d.code) && d.severity !== "info");
    expect(blocking, blocking.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("LOW_CONTRAST clusters by (fg,bg,fontBucket) with surfaceTrail", () => {
    const slide: SlideV2 = {
      id: "reg-cluster",
      children: [{
        id: "reg-cluster.row",
        type: "stack",
        direction: "vertical",
        gap: 0.2,
        area: "content",
        children: [
          { id: "reg-cluster.row.a", type: "text", text: "白字一", style: "paragraph", color: "text.inverse" },
          { id: "reg-cluster.row.b", type: "text", text: "白字二", style: "paragraph", color: "text.inverse" },
          { id: "reg-cluster.row.c", type: "text", text: "白字三", style: "paragraph", color: "text.inverse" },
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    // Whether the auto-fix fired or not, the cluster diagnostic structure
    // (surfaceTrail + aggregated.affectedNodes) must hold for both
    // LOW_CONTRAST and LOW_CONTRAST_FIXED.
    const lowContrast = getRenderDiagnostics().filter((d) => d.code === "LOW_CONTRAST" || d.code === "LOW_CONTRAST_FIXED");
    expect(lowContrast, JSON.stringify(lowContrast.map((d) => d.message))).toHaveLength(1);
    expect(lowContrast[0]!.surfaceTrail?.length, "surfaceTrail should describe slide.bg → surface → text.color").toBeGreaterThanOrEqual(2);
    expect(lowContrast[0]!.aggregated?.count).toBe(3);
    expect(lowContrast[0]!.aggregated?.affectedNodes.map((n) => n.nodeId)).toEqual(
      expect.arrayContaining(["reg-cluster.row.a", "reg-cluster.row.b", "reg-cluster.row.c"]),
    );
  });

  it("LOW_CONTRAST surfaceTrail picks band fill when text sits on a band even with rounding noise", () => {
    const slide: SlideV2 = {
      id: "reg-band-trail",
      children: [{
        id: "reg-band-trail.band",
        type: "band",
        fill: "111827",
        height: 5,
        children: [{
          id: "reg-band-trail.band.title",
          type: "text",
          text: "白色标题",
          style: "slide-title",
          color: "text.inverse",
        }],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const lowContrast = getRenderDiagnostics().filter((d) => d.code === "LOW_CONTRAST");
    // White on near-black band must be readable; if the contrast checker
    // ever reverts to comparing against the slide bg, this test fails.
    expect(lowContrast, lowContrast.map((d) => `[${d.code}] ${d.message} trail=${(d.surfaceTrail || []).join(" → ")}`).join("\n")).toHaveLength(0);
  });

  it("section-break.accent with a literal label string does NOT trip INVALID_FIELD_USAGE", () => {
    const slide: SlideV2 = {
      id: "reg-accent-ok",
      children: [{ id: "reg-accent-ok.s", type: "section-break", title: "第一章", accent: "PART 01" } as unknown as SlideV2["children"][number]],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors, JSON.stringify(report.errors)).toHaveLength(0);
  });

  it("section-break.accent with a token-shaped string trips INVALID_FIELD_USAGE", () => {
    const slide: SlideV2 = {
      id: "reg-accent-bad",
      children: [{ id: "reg-accent-bad.s", type: "section-break", title: "第一章", accent: "brand.primary" } as unknown as SlideV2["children"][number]],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors.find((e) => e.code === "INVALID_FIELD_USAGE")).toBeDefined();
  });

  it("kpi-grid uses stable index ids even when metric names repeat", () => {
    const slide: SlideV2 = {
      id: "reg-kpi-id",
      children: [{
        id: "reg-kpi-id.grid",
        type: "kpi-grid",
        metrics: [
          { name: "Same Label", value: "42%", label: "Same Label" },
          { name: "Same Label", value: "7", label: "Same Label" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const names = ast.slides[0].shapes.map((s) => (s as { name?: string }).name).filter(Boolean);
    expect(names).toContain("reg-kpi-id.grid-m1.value");
    expect(names).toContain("reg-kpi-id.grid-m2.value");
    expect(names.some((name) => name!.includes("Same Label"))).toBe(false);
  });

  it("two-column recursively validates left/right DomNodes", () => {
    const slide: SlideV2 = {
      id: "reg-two-col",
      children: [{
        id: "reg-two-col.tc",
        type: "two-column",
        left: { id: "reg-two-col.left", type: "missing-widget", text: "bad" },
        right: { id: "reg-two-col.right", type: "text", text: "ok" },
      } as unknown as SlideV2["children"][number]],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors.find((e) => e.path === "children[0].left" && e.code === "UNKNOWN_NODE_TYPE")).toBeDefined();
  });

  it("component enum props reject undocumented values instead of silently downgrading intent", () => {
    const slide: SlideV2 = {
      id: "reg-enum",
      children: [{
        id: "reg-enum.card",
        type: "insight-card",
        title: "资源",
        body: "保留作者原本想要的强调色意图。",
        tone: "accent2",
      } as unknown as SlideV2["children"][number]],
    };
    const report = validateSlide(slide, baseDeck);
    const hit = report.errors.find((e) => e.code === "INVALID_FIELD_USAGE" && e.path === "children[0].tone");
    expect(hit, JSON.stringify(report.errors)).toBeDefined();
    expect(hit!.message).toContain("insight-card.tone must be one of");
  });

  it("explanation-block accepts minimal as a no-chrome alias for plain", () => {
    const slide: SlideV2 = {
      id: "reg-explain-minimal",
      children: [{
        id: "reg-explain-minimal.exp",
        type: "explanation-block",
        title: "Why",
        body: "Keep agent-authored minimal explanation blocks renderable.",
        variant: "minimal",
        tone: "brand",
      } as unknown as SlideV2["children"][number]],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors, JSON.stringify(report.errors)).toHaveLength(0);
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    expect(findRenderedByName(ast, "reg-explain-minimal.exp.rail")).toBeUndefined();
    expect(findRenderedByName(ast, "reg-explain-minimal.exp.title")?.type).toBe("text");
  });

  it("text style type aliases are reported with the precise canonical rewrite", () => {
    const slide: SlideV2 = {
      id: "reg-style-as-type",
      children: [{ id: "reg-style-as-type.x", type: "paragraph" as unknown as SlideV2["children"][number]["type"], text: "abc" }],
    };
    const report = validateSlide(slide, baseDeck);
    const hit = report.warnings.find((e) => e.code === "TEXT_STYLE_TYPE_ALIAS_NORMALIZED");
    expect(hit, JSON.stringify(report.warnings)).toBeDefined();
    expect(`${hit!.message} ${hit!.suggestedFix || ""}`).toMatch(/style:"paragraph"/);
  });

  it("h2 component (not a misuse) validates cleanly", () => {
    const slide: SlideV2 = {
      id: "reg-h2",
      children: [{ id: "reg-h2.title", type: "h2", text: "卡片标题" } as unknown as SlideV2["children"][number]],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors, JSON.stringify(report.errors)).toHaveLength(0);
  });

  it("profile-card.name (a documented field) is NOT flagged as LEGACY_NODE_NAME", () => {
    const slide: SlideV2 = {
      id: "reg-profile-name",
      children: [{
        id: "reg-profile-name.card",
        type: "profile-card",
        image: TINY_PNG,
        name: "李四",
      } as unknown as SlideV2["children"][number]],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors.find((e) => e.code === "LEGACY_NODE_NAME"), JSON.stringify(report.errors)).toBeUndefined();
  });

  it("non-component {type:'stack'} with a name field still trips LEGACY_NODE_NAME", () => {
    const slide: SlideV2 = {
      id: "reg-legacy-name",
      children: [{
        id: "reg-legacy-name.stack",
        type: "stack",
        direction: "vertical",
        gap: 0.2,
        name: "legacy-name-field",
        children: [{ id: "reg-legacy-name.stack.t", type: "text", text: "x", style: "paragraph" }],
      } as unknown as SlideV2["children"][number]],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors.find((e) => e.code === "LEGACY_NODE_NAME"), JSON.stringify(report.errors)).toBeDefined();
  });

  it("text.color bare hex is allowed with a theme-token warning", () => {
    const slide: SlideV2 = {
      id: "reg-hex",
      children: [{ id: "reg-hex.t", type: "text", text: "红字", color: "FF0000", style: "paragraph" }],
    };
    const report = validateSlide(slide, baseDeck);
    const hit = report.warnings.find((e) => e.code === "RAW_TEXT_HEX_COLOR");
    expect(hit).toBeDefined();
    expect(report.errors.find((e) => e.code === "RAW_TEXT_HEX_COLOR")).toBeUndefined();
    expect(`${hit!.message} ${hit!.suggestedFix || ""}`).toMatch(/theme tokens|#RRGGBB|bare RRGGBB/i);
  });

  it("band.fill hex is allowed (no validation error)", () => {
    const slide: SlideV2 = {
      id: "reg-band-hex",
      children: [{
        id: "reg-band-hex.band",
        type: "band",
        fill: "111827",
        height: 5,
        children: [{ id: "reg-band-hex.band.t", type: "text", text: "白字", style: "slide-title", color: "text.inverse" }],
      } as unknown as DomNode],
    };
    const deck = buildDeckWithSlide(slide);
    const report = validateDeck(deck);
    expect(report.errors.filter((e) => e.code === "RAW_TEXT_HEX_COLOR"), JSON.stringify(report.errors)).toHaveLength(0);
  });

  it("explicit fixedWidth/fixedHeight on an image exempts it from SQUASHED", () => {
    const slide: SlideV2 = {
      id: "reg-fixed-img",
      children: [{
        id: "reg-fixed-img.s",
        type: "stack",
        direction: "vertical",
        gap: 0.2,
        children: [
          { id: "reg-fixed-img.s.icon", type: "image", src: TINY_PNG, alt: "icon", fit: "contain", fixedWidth: 1.2, fixedHeight: 1.2 },
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const squashed = getRenderDiagnostics().filter((d) => d.code === "SQUASHED" && d.nodeId === "reg-fixed-img.s.icon");
    expect(squashed, squashed.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("explicit absolute image rects are allowed for small decorative ornaments", () => {
    const slide: SlideV2 = {
      id: "reg-ornament-img",
      children: [
        { id: "reg-ornament-img.top-left", type: "image", src: TINY_PNG, alt: "corner ornament", fit: "contain", layer: "behind", at: [0.2, 0.2, 2.4, 2.4] },
        { id: "reg-ornament-img.top-right", type: "image", src: TINY_PNG, alt: "corner ornament", fit: "contain", layer: "behind", at: [22.8, 0.2, 2.4, 2.4] },
      ],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const squashed = getRenderDiagnostics().filter((d) => d.code === "SQUASHED" && d.nodeId?.startsWith("reg-ornament-img."));
    expect(squashed, squashed.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("image-card contain mode centers generated illustrations in a bounded inner frame", () => {
    const slide: SlideV2 = {
      id: "reg-image-card",
      children: [{
        id: "reg-image-card.figure",
        type: "image-card",
        src: TINY_PNG,
        title: "生成插图",
        fit: "contain",
      } as unknown as SlideV2["children"][number]],
    };
    const rendered = sourceToRenderedDeck(buildDeckWithSlide(slide));
    const ast = renderToAst(rendered);
    const image = findRenderedByName(ast, "reg-image-card.figure.image") as { xfrm?: { x: number; cx: number } } | undefined;
    const cardRect = measureDeck(rendered)[0]!.nodes.find((entry) => entry.id === "reg-image-card.figure")?.rect;
    expect(image?.xfrm, JSON.stringify(ast.slides[0].shapes, null, 2)).toBeDefined();
    expect(cardRect).toBeDefined();
    expect(image!.xfrm!.cx).toBeLessThan(cardRect!.w * 360000);
    expect(image!.xfrm!.x).toBeGreaterThan(cardRect!.x * 360000);
  });

  it("process-flow horizontal titles share a stable top alignment with uneven bodies", () => {
    const rendered = sourceToRenderedDeck(buildDeckWithSlide({
      id: "reg-flow",
      children: [{
        id: "reg-flow.p",
        type: "process-flow",
        direction: "horizontal",
        steps: [
          { title: "A", body: "短" },
          { title: "B", body: "这一步的说明文字明显更长，需要更多内部高度。" },
          { title: "C", body: "中等长度说明。" },
        ],
      } as unknown as SlideV2["children"][number]],
    }));
    const measured = measureDeck(rendered)[0]!.nodes;
    const ys = ["reg-flow.p.step1.title", "reg-flow.p.step2.title", "reg-flow.p.step3.title"]
      .map((id) => measured.find((entry) => entry.id === id)?.rect.y);
    expect(ys.every((y) => typeof y === "number"), JSON.stringify(measured)).toBe(true);
    expect(Math.max(...(ys as number[])) - Math.min(...(ys as number[]))).toBeLessThan(0.05);
  });

  it("process-flow card variant renders numbered stage chips and per-card accent by default", () => {
    const slide: SlideV2 = {
      id: "reg-designed-flow",
      title: "上线流程",
      children: [{
        id: "reg-designed-flow.p",
        type: "process-flow",
        direction: "horizontal",
        variant: "cards",
        steps: [
          { title: "Plan", body: "Define scope" },
          { title: "Build", body: "Ship the first version" },
          { title: "Review", body: "Measure and iterate" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const chip = findRenderedByName(ast, "reg-designed-flow.p.step1.number");
    const accent = findRenderedByName(ast, "reg-designed-flow.p.step1.accent");
    const blocking = getRenderDiagnostics().filter((d) => BLOCKING_CODES.has(d.code) && d.severity !== "info");

    expect(chip?.type).toBe("text");
    expect(chip && chip.type === "text" ? chip.paragraphs?.[0]?.runs?.[0]?.text : "").toBe("01");
    expect(accent?.type).toBe("shape");
    expect(blocking, JSON.stringify(blocking, null, 2)).toHaveLength(0);
  });

  it("process-flow supports generated iconSrc markers and configurable line connectors", () => {
    const slide: SlideV2 = {
      id: "reg-icon-flow",
      title: "图标流程",
      children: [{
        id: "reg-icon-flow.p",
        type: "process-flow",
        direction: "horizontal",
        variant: "cards",
        marker: "icon",
        connector: "line",
        connectorDash: "dash",
        connectorColor: "divider",
        steps: [
          { title: "Collect", body: "整理素材", iconSrc: TINY_PNG },
          { title: "Analyze", body: "形成判断", iconSrc: TINY_PNG },
          { title: "Deliver", body: "输出结论", iconSrc: TINY_PNG },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const icon = findRenderedByName(ast, "reg-icon-flow.p.step1.icon");
    const connector = findRenderedByName(ast, "reg-icon-flow.p.arrow1");
    const stepBackground = findRenderedByName(ast, "reg-icon-flow.p.step1-background");

    expect(icon?.type).toBe("image");
    expect((icon as { fit?: string } | undefined)?.fit).toBe("contain");
    expect(connector?.type).toBe("shape");
    expect((connector as { preset?: string } | undefined)?.preset).toBe("line");
    expect((connector as { line?: { dash?: string } } | undefined)?.line?.dash).toBe("dash");
    expect(stepBackground?.type).toBe("shape");
    const connectorXfrm = (connector as { xfrm?: { y: number; cy: number } } | undefined)?.xfrm;
    const stepXfrm = (stepBackground as { xfrm?: { y: number; cy: number } } | undefined)?.xfrm;
    expect(connectorXfrm).toBeDefined();
    expect(stepXfrm).toBeDefined();
    const connectorCenterY = connectorXfrm!.y + connectorXfrm!.cy / 2;
    const stepCenterY = stepXfrm!.y + stepXfrm!.cy / 2;
    expect(Math.abs(connectorCenterY - stepCenterY)).toBeLessThan(180000);
  });

  it("process-flow card variant gives rich horizontal steps enough card height", () => {
    const rendered = sourceToRenderedDeck(buildDeckWithSlide({
      id: "reg-rich-flow",
      children: [{
        id: "reg-rich-flow.p",
        type: "process-flow",
        direction: "horizontal",
        variant: "cards",
        density: "compact",
        steps: [
          { title: "基础设施层", body: "Runtime/Sandbox/Browser\nMemory/Eval/Identity/Router\n模型+Inference", icon: "ellipse", bullets: ["巨头垂直集成", "中国无独立SaaS"] },
          { title: "平台层", body: "Agent OS/工作平台\nMCP Gateway/Tool市场", icon: "roundRect", bullets: ["生态主战场"] },
          { title: "应用层", body: "通用 Office Agent\n垂直行业 Agent", icon: "triangle", bullets: ["用户付钱的地方"] },
        ],
      } as unknown as SlideV2["children"][number]],
    }));
    const measured = measureDeck(rendered)[0]!.nodes;
    const step = measured.find((entry) => entry.id === "reg-rich-flow.p.step1")?.rect;
    const title = measured.find((entry) => entry.id === "reg-rich-flow.p.step1.title")?.rect;
    const body = measured.find((entry) => entry.id === "reg-rich-flow.p.step1.body")?.rect;

    expect(step?.h).toBeGreaterThanOrEqual(3.1);
    expect(title?.x).toBeCloseTo(body?.x ?? 0, 1);
  });

  it("process-flow wraps rich 4-step card guidance into two readable rows", () => {
    const rendered = sourceToRenderedDeck(buildDeckWithSlide({
      id: "reg-long-flow",
      children: [{
        id: "reg-long-flow.p",
        type: "process-flow",
        direction: "horizontal",
        variant: "cards",
        steps: [
          { title: "地理选择", body: "优先出海，只有强政策红利和客户关系才留国内。" },
          { title: "方向选择", body: "垂直行业、私有化中台、桌面工作台优先，避免横向通用工具。" },
          { title: "GTM 节奏", body: "Day 1 海外架构，先做付费闭环，再扩大品类。" },
          { title: "绝对不做", body: "不要做横向 Manus、纯基建 SaaS、模型 Router 或普通 wrapper。" },
        ],
      } as unknown as SlideV2["children"][number]],
    }));
    const measured = measureDeck(rendered)[0]!.nodes;
    const step1 = measured.find((entry) => entry.id === "reg-long-flow.p.step1")?.rect;
    const step2 = measured.find((entry) => entry.id === "reg-long-flow.p.step2")?.rect;
    const step3 = measured.find((entry) => entry.id === "reg-long-flow.p.step3")?.rect;
    const step4 = measured.find((entry) => entry.id === "reg-long-flow.p.step4")?.rect;

    expect(step1?.h).toBeGreaterThan(3.0);
    expect((step2?.x ?? 0) - (step1?.x ?? 0)).toBeGreaterThan(5);
    expect((step3?.y ?? 0) - (step1?.y ?? 0)).toBeGreaterThan(3);
    expect(step4?.y).toBeCloseTo(step3?.y ?? 0, 1);
  });

  it("takeaway-list uses two columns for 4 detailed takeaways plus a closing quote", () => {
    const rendered = sourceToRenderedDeck(buildDeckWithSlide({
      id: "reg-final-takeaways",
      title: "最终建议与行动指南",
      children: [
        {
          id: "reg-final-takeaways.list",
          type: "takeaway-list",
          items: [
            { headline: "出海是最高赔率窗口", detail: "Day 1海外架构，避开国内围剿，享受海外高付费，先做付费闭环再扩大品类。" },
            { headline: "国内走垂直行业", detail: "行业know-how、合规和数据壁垒共同形成护城河，不能套用美国SaaS逻辑。" },
            { headline: "不要做横向基建", detail: "横向office Agent、独立Router和普通wrapper都会被平台或模型厂商压缩空间。" },
            { headline: "聚焦五个方向", detail: "出海Productivity、垂直行业Agent、私有化中台、桌面工作台、跨平台中立中间件。" },
          ],
        } as unknown as SlideV2["children"][number],
        {
          id: "reg-final-takeaways.quote",
          type: "quote",
          text: "不要试图做最大，要试图做最深。",
          source: "报告核心洞察",
        } as unknown as SlideV2["children"][number],
      ],
    }));
    clearRenderDiagnostics();
    const measured = measureDeck(rendered)[0]!.nodes;
    const blocking = getRenderDiagnostics().filter((d) => BLOCKING_CODES.has(d.code));
    const first = measured.find((entry) => entry.id === "reg-final-takeaways.list.0")?.rect;
    const second = measured.find((entry) => entry.id === "reg-final-takeaways.list.1")?.rect;
    const third = measured.find((entry) => entry.id === "reg-final-takeaways.list.2")?.rect;

    expect(blocking, blocking.map((d) => d.message).join("\n")).toHaveLength(0);
    expect((second?.x ?? 0) - (first?.x ?? 0)).toBeGreaterThan(5);
    expect((third?.y ?? 0) - (first?.y ?? 0)).toBeGreaterThan(1.5);
  });

  it("comparison-table keeps feature labels in the left column", () => {
    const slide: SlideV2 = {
      id: "reg-cmp",
      children: [{
        id: "reg-cmp.table",
        type: "comparison-table",
        features: ["适用场景"],
        options: [
          { name: "方案 A", values: ["入门"] },
          { name: "方案 B", values: ["进阶"] },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const feature = firstTextShapeContaining(ast, "适用场景") as { xfrm?: { x: number } } | undefined;
    const option = firstTextShapeContaining(ast, "方案 A") as { xfrm?: { x: number } } | undefined;
    expect(feature?.xfrm).toBeDefined();
    expect(option?.xfrm).toBeDefined();
    expect(feature!.xfrm!.x).toBeLessThan(option!.xfrm!.x);
  });

  it("comparison-table accepts object feature labels without rendering [object Object]", () => {
    const slide: SlideV2 = {
      id: "reg-cmp-object",
      children: [{
        id: "reg-cmp-object.table",
        type: "comparison-table",
        features: [
          { label: "重力势能", value: "$U = mgh$", note: "地面附近" },
          { name: "弹性势能", value: "$U = 1/2kx^2$" },
        ],
        options: [
          { name: "公式", values: ["U = mgh", "U = 1/2kx^2"] },
          { name: "适用条件", values: ["g 恒定", "线性弹簧"] },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    expect(firstTextShapeContaining(ast, "[object Object]")).toBeUndefined();
    expect(firstTextShapeContaining(ast, "重力势能")).toBeDefined();
    expect(firstTextShapeContaining(ast, "弹性势能")).toBeDefined();
  });

  it("comparison-table reads natural row objects keyed by option names", () => {
    const slide: SlideV2 = {
      id: "reg-cmp-rows",
      children: [{
        id: "reg-cmp-rows.table",
        type: "comparison-table",
        features: ["成立", "ARR", "AI定位"],
        options: ["Gamma", "Beautiful.ai", "Canva"],
        rows: [
          { feature: "成立", Gamma: "2020", "Beautiful.ai": "2018", Canva: "2013" },
          { feature: "ARR", Gamma: "$1.02亿", "Beautiful.ai": "~$2,000万", Canva: "$35亿" },
          { feature: "AI定位", Gamma: "AI原生全格式", "Beautiful.ai": "模板AI", Canva: "设计驱动+AI" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    for (const value of ["2020", "$1.02亿", "$35亿", "AI原生全格式", "设计驱动+AI"]) {
      expect(firstTextShapeContaining(ast, value), `missing ${value}`).toBeDefined();
    }
  });

  it("comparison-table can infer features and options from natural row records", () => {
    const slide: SlideV2 = {
      id: "reg-cmp-infer",
      children: [{
        id: "reg-cmp-infer.table",
        type: "comparison-table",
        rows: [
          { feature: "ARR", Gamma: "$1.02亿", Canva: "$35亿" },
          { feature: "团队", Gamma: "52人", Canva: "4,500人" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors).toEqual([]);
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    for (const value of ["ARR", "Gamma", "Canva", "$35亿", "52人"]) {
      expect(firstTextShapeContaining(ast, value), `missing ${value}`).toBeDefined();
    }
  });

  it("chart-with-rail accepts flat chart/rail fields without dropping the chart or rail details", () => {
    const slide: SlideV2 = {
      id: "reg-flat-rail",
      children: [{
        id: "reg-flat-rail.crisis",
        type: "chart-with-rail",
        chartType: "bar",
        chartTitle: "平台玩家 vs Gamma 规模对比",
        chartData: {
          labels: ["Microsoft AI", "Canva", "Gamma"],
          series: [{ name: "ARR", values: ["500", "35", "1.02"] }],
        },
        chartTone: "danger",
        showValues: true,
        railTitle: "威胁：Microsoft & Canva",
        railBody: "平台玩家拥有更大的渠道和用户基础。",
        evidence: {
          type: "text",
          source: "公开财报及公司披露",
          text: "Office 15亿月活用户，Canva 4,500人团队",
        },
        keyTakeaway: {
          headline: "这不是同一位面的竞争",
          detail: "渠道、数据、用户习惯全是平台的优势。",
          tone: "danger",
        },
      } as unknown as SlideV2["children"][number]],
    };
    const source = buildDeckWithSlide(slide);
    source.deck.themeOverride = {
      colors: {
        background: "0B0C10",
        surface: "0B0C10",
        "text.primary": "F0EDE5",
        "text.secondary": "B0B0B0",
      },
    };
    const ast = renderToAst(sourceToRenderedDeck(source));
    const chart = ast.slides[0].shapes.find((shape) => shape.type === "chart") as { labels?: string[]; series?: Array<{ values: number[] }>; textColor?: string; axisTextColor?: string; dataLabelColor?: string } | undefined;
    expect(chart?.labels).toEqual(["Microsoft AI", "Canva", "Gamma"]);
    expect(chart?.series?.[0]?.values).toEqual([500, 35, 1.02]);
    expect(chart?.textColor).toBe("F0EDE5");
    expect(chart?.axisTextColor).toBe("B0B0B0");
    expect(chart?.dataLabelColor).toBe("F0EDE5");
    for (const text of ["平台玩家 vs Gamma 规模对比", "Microsoft & Canva", "平台玩家拥有更大的渠道", "这不是同一位面的竞争", "公开财报及公司披露"]) {
      expect(firstTextShapeContaining(ast, text), `missing ${text}`).toBeDefined();
    }
  });

  it("chart-with-rail accepts structured railBody nodes without forcing a schema repair loop", () => {
    const slide: SlideV2 = {
      id: "reg-rail-structured-body",
      children: [{
        id: "reg-rail-structured-body.mix",
        type: "chart-with-rail",
        chartType: "pie",
        chartTitle: "各职能人力占比",
        chartData: {
          labels: ["销售", "研发", "售后"],
          series: [{ name: "人数", values: [150, 55, 29] }],
        },
        railTitle: "各职能人数",
        railBody: [
          { type: "text", text: "在编+外包合计 276 人，销售占比超半数。", style: "caption" },
          { type: "spacer", fixedHeight: 0.12 },
          {
            type: "table-card",
            density: "compact",
            rows: [
              ["职能", "人数", "占比"],
              ["销售", "150人", "54.3%"],
              ["研发", "55人", "19.9%"],
            ],
          },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const validation = validateSlide(slide, baseDeck);
    expect(validation.errors, JSON.stringify(validation.errors, null, 2)).toEqual([]);
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    for (const text of ["各职能人力占比", "各职能人数", "在编+外包合计", "销售", "150人", "54.3%"]) {
      expect(firstRenderedShapeContaining(ast, text), `missing ${text}`).toBeDefined();
    }
  });

  it("chart-with-rail compact takeaway does not let a wrapped headline collide with bullets", () => {
    const slide: SlideV2 = {
      id: "reg-rail-takeaway",
      title: "半年度营收&人力同比",
      children: [{
        id: "reg-rail-takeaway.node-1",
        type: "chart-with-rail",
        chartType: "bar",
        title: "H1 2024 vs H1 2025 核心指标对比",
        layout: "rail-right",
        ratio: [0.62, 0.38],
        evidence: {
          type: "chart-card",
          chartType: "bar",
          title: "",
          labels: ["营收(未税)", "人力成本", "HC(avg)", "人数", "ROI"],
          series: [
            { name: "h1_2024", values: [31600, 10100, 328, 328, 3.13] },
            { name: "h1_2025", values: [29200, 7300, 271, 271, 4.02] },
          ],
          showLegend: true,
        },
        keyTakeaway: {
          headline: "营收降7.6%，成本压降28.2%",
          detail: "营收：-7.6%（3.16亿→2.92亿）；人力成本压缩超四分之一（-28.2%）；HC减少17%（328人→271人）；人效提升+8.9%；ROI改善+28.7%。",
        },
      } as unknown as SlideV2["children"][number]],
    };
    const rendered = sourceToRenderedDeck(buildDeckWithSlide(slide));
    const ast = renderToAst(rendered);
    const headlineShape = findRenderedByName(ast, "reg-rail-takeaway.node-1.rail.keyTakeaway.headline") as Extract<(typeof ast.slides)[number]["shapes"][number], { type: "text" }> | undefined;
    const headlineRun = headlineShape?.type === "text" ? headlineShape.paragraphs?.[0]?.runs?.[0] : undefined;
    expect(headlineRun?.sizeHalfPt).toBeLessThanOrEqual(28);

    const measured = measureDeck(rendered)[0]!.nodes;
    const headline = measured.find((entry) => entry.id === "reg-rail-takeaway.node-1.rail.keyTakeaway.headline")?.rect;
    const bullets = measured.find((entry) => entry.id === "reg-rail-takeaway.node-1.rail.keyTakeaway.bullets")?.rect;
    expect(headline).toBeDefined();
    expect(bullets).toBeDefined();
    expect(bullets!.y).toBeGreaterThanOrEqual(headline!.y + headline!.h + 0.1);
  });

  it("org-chart normalizes oversized node styles so labels and role text stay readable", () => {
    const slide: SlideV2 = {
      id: "reg-org-style",
      children: [{
        id: "reg-org-style.chart",
        type: "org-chart",
        titleStyle: "section-title",
        bodyStyle: "bullet",
        detail: "compact",
        nodes: [
          { id: "ops", name: "运营委员会", role: "林晨、周予", badge: { text: "经营", tone: "brand" } },
          { id: "success", name: "客户成功部", role: "陈晓、王曼、刘一", badge: { text: "32人", tone: "positive" } },
          { id: "key", name: "重点客户组", parent: "success" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const texts: string[] = [];
    const walk = (shape: unknown) => {
      const rec = shape as { type?: string; paragraphs?: Array<{ runs: Array<{ text: string }> }>; children?: unknown[] };
      if (rec.type === "text") texts.push(rec.paragraphs?.flatMap((p) => p.runs.map((r) => r.text)).join("") || "");
      for (const child of rec.children || []) walk(child);
    };
    for (const shape of ast.slides[0].shapes) walk(shape);
    const textContent = texts.join("\n").replace(/\u2060/g, "");
    expect(textContent).toContain("运营委员会");
    expect(textContent).toContain("客户成功部");
    expect(textContent).toContain("林晨、周予");
    expect(textContent).toContain("陈晓、王曼、刘一");
  });

  it("long quote in a split prologue keeps quote text and source renderable", () => {
    const slide: SlideV2 = {
      id: "reg-quote-prologue",
      title: "高原的天空，比梦更远",
      children: [{
        id: "reg-quote-prologue.split",
        type: "split",
        direction: "horizontal",
        ratio: [0.55, 0.45],
        gap: 0.5,
        children: [
          { id: "reg-quote-prologue.image", type: "image", src: TINY_PNG, fit: "cover" } as unknown as DomNode,
          {
            id: "reg-quote-prologue.right",
            type: "stack",
            gap: 0.5,
            children: [
              { id: "reg-quote-prologue.eyebrow", type: "eyebrow", text: "藏地 · 秘境", tone: "brand" },
              { id: "reg-quote-prologue.h1", type: "h1", text: "高原的天空，\n比梦更远" },
              {
                id: "reg-quote-prologue.quote",
                type: "quote",
                text: "当你站在这片高原上，头顶是触手可及的蔚蓝，脚下是延续千年的草甸与牧歌，香格里拉便不再是一个地名——它是你心中，那片从未抵达却始终在召唤的所在。",
                source: "《香格里拉纪行》",
              },
              { id: "reg-quote-prologue.divider", type: "divider", color: "brand.primary", thickness: 1.5, length: 3 },
              {
                id: "reg-quote-prologue.body",
                type: "text",
                text: "海拔 3300 米，天空蓝得近乎透明，经幡在风中吟唱。这里是云南迪庆藏族聚居区，是詹姆斯·希尔顿笔下\"消失的地平线\"。",
              },
            ],
          } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    };

    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const quoteText = findRenderedByName(ast, "reg-quote-prologue.quote.text");
    const quoteSource = findRenderedByName(ast, "reg-quote-prologue.quote.source");
    const quoteBlocking = getRenderDiagnostics().filter((d) =>
      d.severity === "error" && String(d.nodeId || "").includes("reg-quote-prologue.quote")
    );

    expect(quoteText?.type).toBe("text");
    expect(quoteSource?.type).toBe("text");
    expect(((quoteText as { xfrm?: { cy?: number } } | undefined)?.xfrm?.cy || 0)).toBeGreaterThan(0);
    expect(((quoteSource as { xfrm?: { cy?: number } } | undefined)?.xfrm?.cy || 0)).toBeGreaterThan(0);
    expect(quoteBlocking, quoteBlocking.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("semantic narrative components do not block in a split rail for mild internal fit pressure", () => {
    const long = "当你站在这片高原上，头顶是触手可及的蔚蓝，脚下是延续千年的草甸与牧歌，香格里拉便不再是一个地名，它是心中那片从未抵达却始终召唤的所在。";
    const body = "海拔 3300 米，天空蓝得近乎透明，经幡在风中吟唱。这里也是无数旅人心中那道永远指向高原的光。";
    const cases: Array<{ id: string; component: DomNode }> = [
      { id: "plain-callout", component: { id: "plain-callout.c", type: "callout", text: long, tone: "warning" } as unknown as DomNode },
      { id: "card-callout", component: { id: "card-callout.c", type: "callout", title: "旅途提示", body: long, tone: "warning", variant: "card" } as unknown as DomNode },
      { id: "banner-callout", component: { id: "banner-callout.c", type: "callout", title: "旅途提示", body: long, tone: "brand", variant: "banner" } as unknown as DomNode },
      {
        id: "insight-proof",
        component: {
          id: "insight-proof.c",
          type: "insight-card",
          badge: "观察",
          headline: "高原经验来自天空、风和路",
          detail: long,
          bullets: ["蓝天提供第一印象", "草甸形成叙事线索", "藏地文化承担情绪锚点"],
          tone: "brand",
        } as unknown as DomNode,
      },
      {
        id: "outline-rail",
        component: {
          id: "outline-rail.c",
          type: "outline",
          items: [
            { title: "天空", body: "蓝天与云影" },
            { title: "草甸", body: "自然地貌" },
            { title: "文化", body: "藏地生活" },
            { title: "路线", body: "抵达方式" },
          ],
        } as unknown as DomNode,
      },
    ];

    for (const item of cases) {
      const slide: SlideV2 = {
        id: item.id,
        title: "高原的天空，比梦更远",
        children: [{
          id: `${item.id}.split`,
          type: "split",
          direction: "horizontal",
          ratio: [0.55, 0.45],
          gap: 0.5,
          children: [
            { id: `${item.id}.image`, type: "image", src: TINY_PNG, fit: "cover" } as unknown as DomNode,
            {
              id: `${item.id}.right`,
              type: "stack",
              gap: 0.5,
              children: [
                { id: `${item.id}.eyebrow`, type: "eyebrow", text: "藏地 · 秘境", tone: "brand" },
                { id: `${item.id}.h1`, type: "h1", text: "高原的天空，\n比梦更远" },
                item.component,
                { id: `${item.id}.body`, type: "text", text: body },
              ],
            } as unknown as DomNode,
          ],
        } as unknown as DomNode],
      };
      clearRenderDiagnostics();
      renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
      const errors = getRenderDiagnostics().filter((d) => d.severity === "error");
      expect(errors, `${item.id}\n${errors.map((d) => `${d.code} ${d.nodeId}: ${d.message}`).join("\n")}`).toHaveLength(0);
    }
  });

  it("semantic prose components accept natural field aliases without dropping content", () => {
    const cases: Array<{ id: string; component: DomNode; expected: string[] }> = [
      {
        id: "alias-quote",
        component: { id: "alias-quote.c", type: "quote", statement: "高原不是目的地，而是一种缓慢进入内心的方式。", author: "旅行者手记" } as unknown as DomNode,
        expected: ["高原不是目的地", "旅行者手记"],
      },
      {
        id: "alias-definition",
        component: { id: "alias-definition.c", type: "definition-card", title: "香格里拉", body: "一个地理地点，也是一套关于远方、净土和高原生活的文化想象。" } as unknown as DomNode,
        expected: ["香格里拉", "一个地理地点"],
      },
      {
        id: "alias-key",
        component: { id: "alias-key.c", type: "key-takeaway", text: "真正的体验不来自单一景点，而来自天空、道路和文化节奏的共同作用。", items: ["第一天降低活动强度", "保留天气和交通缓冲"] } as unknown as DomNode,
        expected: ["真正的体验", "第一天降低活动强度"],
      },
      {
        id: "alias-exec",
        component: { id: "alias-exec.c", type: "executive-summary", takeaways: [{ title: "自然景观是入口", body: "蓝天和草甸建立第一印象" }], recommendation: "优先设计低强度首日路线" } as unknown as DomNode,
        expected: ["自然景观是入口", "优先设计低强度"],
      },
      {
        id: "alias-fact",
        component: { id: "alias-fact.c", type: "fact-list", facts: [{ metric: "海拔", value: "3300m", description: "高反风险需要被纳入行程设计" }] } as unknown as DomNode,
        expected: ["海拔", "高反风险"],
      },
      {
        id: "alias-comparison",
        component: { id: "alias-comparison.c", type: "comparison-list", options: [{ name: "自驾", description: "自由度高但风险自担", pros: ["节奏可控"] }, { name: "跟团", description: "组织稳定" }] } as unknown as DomNode,
        expected: ["自驾", "节奏可控"],
      },
      {
        id: "alias-glossary",
        component: { id: "alias-glossary.c", type: "glossary", entries: [{ term: "经幡", desc: "风中持续出现的文化符号" }] } as unknown as DomNode,
        expected: ["经幡", "风中持续"],
      },
      {
        id: "alias-qa",
        component: { id: "alias-qa.c", type: "q-and-a", faqs: [{ question: "第一次去需要注意什么？", answer: "先适应海拔，减少第一天活动强度。" }] } as unknown as DomNode,
        expected: ["第一次去", "先适应海拔"],
      },
    ];

    for (const item of cases) {
      clearRenderDiagnostics();
      const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide({ id: item.id, children: [item.component] })));
      const renderedText = ast.slides.flatMap((slide) => slide.shapes)
        .filter((shape): shape is Extract<(typeof ast.slides)[number]["shapes"][number], { type: "text" }> => shape.type === "text")
        .map((shape) => shape.paragraphs?.flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join("") || "");
      const missing = item.expected.filter((text) => !renderedText.some((value) => value.includes(text)));
      const errors = getRenderDiagnostics().filter((d) => d.severity === "error");
      expect(missing, `${item.id}\n${renderedText.join("\n")}`).toHaveLength(0);
      expect(errors, `${item.id}\n${errors.map((d) => `${d.code} ${d.nodeId}: ${d.message}`).join("\n")}`).toHaveLength(0);
    }
  });

  it("outline keeps authored numbers close to their chapter titles", () => {
    const rendered = sourceToRenderedDeck(buildDeckWithSlide({
      id: "reg-outline",
      title: "讲义目录",
      children: [{
        id: "reg-outline.list",
        type: "outline",
        items: [
          { number: "01", title: "全球癌症负担概览", body: "流行病学数据与主要癌种" },
          { number: "02", title: "免疫治疗", body: "ICI · CAR-T" },
          { number: "03", title: "靶向治疗", body: "KRAS · ADC" },
          { number: "04", title: "精准医疗与AI", body: "多组学" },
          { number: "05", title: "肿瘤生物学基础", body: "微环境" },
          { number: "06", title: "iGEM 参赛建议", body: "工程菌mRNA疫苗" },
        ],
      } as unknown as DomNode],
    }));
    const measured = measureDeck(rendered)[0]!.nodes;
    const num = measured.find((entry) => entry.id === "reg-outline.list.0.num")!.rect;
    const title = measured.find((entry) => entry.id === "reg-outline.list.0.title")!.rect;
    expect(title.x - (num.x + num.w)).toBeLessThan(0.6);
    expect(num.w).toBeLessThanOrEqual(1.1);
  });

  it("chapter-divider does not synthesize a top-right number by default", () => {
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide({
      id: "reg-chapter-divider",
      children: [{
        id: "reg-chapter-divider.chapter",
        type: "chapter-divider",
        title: "Research background",
        subtitle: "Context reset without a chapter label",
      } as unknown as DomNode],
    })));

    const names = ast.slides[0]!.shapes.map((shape) => String((shape as { name?: string }).name || ""));
    expect(names.some((name) => name.endsWith(".num"))).toBe(false);
    expect(firstTextShapeContaining(ast, "Research background")).toBeDefined();
  });

  it("chapter-divider renders an explicit chapter number and suppresses duplicate slide.title", () => {
    const rendered = sourceToRenderedDeck(buildDeckWithSlide({
      id: "reg-chapter-number",
      title: "AI strategy",
      children: [{
        id: "reg-chapter-number.chapter",
        type: "chapter-divider",
        chapter: "03",
        title: "AI strategy",
        tone: "brand",
      } as unknown as DomNode],
    }));
    const ast = renderToAst(rendered);
    const num = ast.slides[0]!.shapes.find((shape) => String((shape as { name?: string }).name || "").endsWith(".num"));

    expect(JSON.stringify(num)).toContain("03");
    expect(findDomNode(rendered.slides[0]!.dom, "reg-chapter-number.title")).toBeUndefined();
  });

  it("chapter-divider rejects nested placement and invalid current indexes", () => {
    const report = validateDeck(buildDeckWithSlide({
      id: "reg-bad-chapter",
      children: [{
        id: "reg-bad-chapter.grid",
        type: "grid",
        columns: 2,
        children: [{
          id: "reg-bad-chapter.grid.chapter",
          type: "chapter-divider",
          title: "Nested reset",
          sections: ["A", "B"],
          current: 2,
        }],
      } as unknown as DomNode],
    }));
    const codes = report.errors.map((error) => error.code);

    expect(codes).toContain("COMPONENT_MUST_BE_TOP_LEVEL");
    expect(codes).toContain("CHAPTER_DIVIDER_CURRENT_OUT_OF_RANGE");
  });

  it("single full-slide chapter band is not constrained to the content rect", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default", brand: { primary: "E94560" } },
      slides: [{
        id: "reg-chapter-band",
        title: "",
        children: [{
          id: "reg-chapter-band.band",
          type: "band",
          tone: "brand",
          children: [{ id: "reg-chapter-band.band.title", type: "h1", text: "第二章 · 免疫治疗" }],
        } as unknown as DomNode],
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const band = findRenderedByName(ast, "reg-chapter-band.band-band") as { xfrm?: { x: number; y: number; cx: number; cy: number } } | undefined;
    expect(band?.xfrm).toBeDefined();
    expect(band!.xfrm!.x).toBe(0);
    expect(band!.xfrm!.y).toBe(0);
    expect(band!.xfrm!.cx).toBeGreaterThan(9000000);
    expect(band!.xfrm!.cy).toBeGreaterThan(5000000);
  });

  it("CSS-like theme cornerRadius values are normalized before rendering cards", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "2563EB" },
        themeOverride: { component: { card: { cornerRadius: 12 } } },
      },
      slides: [{
        id: "reg-radius",
        children: [{ id: "reg-radius.card", type: "card", children: [{ id: "reg-radius.card.t", type: "text", text: "x" }] } as unknown as DomNode],
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const card = findRenderedByName(ast, "reg-radius.card-card") as { cornerRadius?: number } | undefined;
    expect(card?.cornerRadius).toBe(0.12);
  });

  it("CSS-like node cornerRadius values are normalized before rendering", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "reg-node-radius",
        children: [
          { id: "reg-node-radius.card", type: "card", cornerRadius: 12, children: [{ id: "reg-node-radius.card.t", type: "text", text: "x" }] },
          { id: "reg-node-radius.shape", type: "shape", preset: "roundRect", fill: "brand.primary", cornerRadius: 8, fixedHeight: 0.8 },
        ] as unknown as DomNode[],
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const card = findRenderedByName(ast, "reg-node-radius.card-card") as { cornerRadius?: number } | undefined;
    const shape = findRenderedByName(ast, "reg-node-radius.shape") as { cornerRadius?: number } | undefined;
    expect(card?.cornerRadius).toBe(0.12);
    expect(shape?.cornerRadius).toBe(0.08);
  });

  it("table-card propagates dark card fill into body cells so PPT does not default them to white", () => {
    const slide: SlideV2 = {
      id: "reg-table-fill",
      children: [{
        id: "reg-table-fill.tbl",
        type: "table-card",
        title: "ADC 药物全景",
        headers: ["ADC名称", "靶点"],
        rows: [["T-DXd", "HER2"]],
        fill: "#1A1A2E",
        line: "#E94560",
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const table = findRenderedByName(ast, "reg-table-fill.tbl.table") as { cells?: Array<Array<{ fill?: { color?: string } }>> } | undefined;
    expect(table?.cells?.[1]?.[0]?.fill?.color).toBe("1A1A2E");
  });

  it("dark theme semantic surfaces choose readable foregrounds before contrast auto-fix", () => {
    const darkDeck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "E94560" },
        themeOverride: {
          colors: {
            background: "0D1B2A",
            surface: "1A1A2E",
            "text.primary": "FFFFFF",
            "text.secondary": "E0E0E0",
          },
        },
      },
      slides: [{
        id: "reg-dark-surfaces",
        children: [{
          id: "reg-dark-surfaces.grid",
          type: "grid",
          columns: 2,
          gap: 0.35,
          children: [
            { id: "reg-dark-surfaces.band", type: "band", tone: "brand", fixedHeight: 2.2, children: [{ id: "reg-dark-surfaces.band.lead", type: "lead", text: "品牌色块上的副标题" }] },
            { id: "reg-dark-surfaces.insight", type: "insight-card", tone: "brand", headline: "PD-1", body: "程序性死亡受体-1" },
            { id: "reg-dark-surfaces.callout", type: "callout", tone: "warning", text: "核心挑战：CRS 与 ICANS 风险需要管理" },
            {
              id: "reg-dark-surfaces.cmp",
              type: "comparison-table",
              features: ["技术难度"],
              options: [
                { name: "方向一", values: ["中高"], recommended: true },
                { name: "方向二", values: ["中"], recommended: false },
              ],
            },
          ],
        } as unknown as DomNode],
      }],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(darkDeck));
    const contrastFixes = getRenderDiagnostics().filter((d) => d.code === "LOW_CONTRAST_FIXED" || d.code === "LOW_CONTRAST");
    expect(contrastFixes, contrastFixes.map((d) => `${d.nodeId}: ${d.message}`).join("\n")).toHaveLength(0);
  });

  it("deck-title default color resolves against a light deck without LOW_CONTRAST", () => {
    const slide: SlideV2 = {
      id: "reg-deck-title",
      children: [{ id: "reg-deck-title.t", type: "deck-title", text: "默认封面标题" } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const lowContrast = getRenderDiagnostics().filter((d) => d.code === "LOW_CONTRAST");
    expect(lowContrast, lowContrast.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("semantic deck-title preserves authored at coordinates after component expansion", () => {
    const slide: SlideV2 = {
      id: "cover",
      children: [{ id: "cover.title", type: "deck-title", text: "封面标题", at: [1.5, 4.3, 20, 1.5] } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const title = findRenderedByName(ast, "cover.title") as { xfrm?: { x: number; y: number; cx: number; cy: number } } | undefined;
    expect((title?.xfrm?.x || 0) / 360000).toBeCloseTo(1.5, 2);
    expect((title?.xfrm?.y || 0) / 360000).toBeCloseTo(4.3, 2);
    expect((title?.xfrm?.cx || 0) / 360000).toBeCloseTo(20, 2);
    expect((title?.xfrm?.cy || 0) / 360000).toBeCloseTo(1.5, 2);
  });

  it("cover-composition without hero stat gives long cover titles enough width", () => {
    const slide: SlideV2 = {
      id: "cover",
      background: "1E3A5F",
      children: [{
        id: "cover.cv",
        type: "cover-composition",
        title: "AI Agent 机会总图",
        subtitle: "最终综合报告 v1.0",
        eyebrow: "4份深度调研",
        tone: "inverse",
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const coverTitleShrink = getRenderDiagnostics().filter((d) => d.nodeId === "cover.cv.title" && d.code === "TRUNCATED");
    expect(coverTitleShrink, coverTitleShrink.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("cover-composition honors visual geometry and uses a translucent inverse scrim", () => {
    const slide: SlideV2 = {
      id: "cover-visual",
      children: [{
        id: "cover-visual.cv",
        type: "cover-composition",
        title: "Visual cover",
        tone: "inverse",
        visual: {
          src: TINY_PNG,
          fit: "contain",
          anchor: "bottom-right",
          width: 6,
          height: 4,
          opacity: 0.6,
        },
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const visual = findRenderedByName(ast, "cover-visual.cv.visual") as { type?: string; fit?: string; opacity?: number; xfrm?: { cx: number; cy: number } } | undefined;
    const scrim = findRenderedByName(ast, "cover-visual.cv.scrim") as { fill?: { alpha?: number } } | undefined;
    expect(visual?.type).toBe("image");
    expect(visual?.fit).toBe("contain");
    expect(visual?.opacity).toBe(0.6);
    expect((visual?.xfrm?.cx || 0) / 360000).toBeCloseTo(6, 2);
    expect((visual?.xfrm?.cy || 0) / 360000).toBeCloseTo(4, 2);
    expect(scrim?.fill?.alpha).toBeCloseTo(0.42, 2);
  });

  it("cover-composition treats decorative visual placeholders as motif hints, not image paths", async () => {
    const slide: SlideV2 = {
      id: "cover-decorative-visual",
      children: [{
        id: "cover-decorative-visual.cv",
        type: "cover-composition",
        title: "Decorative cover",
        tone: "inverse",
        decor: "shapes",
        visual: {
          src: "decorative",
          fit: "fill",
        },
      } as unknown as SlideV2["children"][number]],
    };
    const rendered = sourceToRenderedDeck(buildDeckWithSlide(slide));
    const ast = renderToAst(rendered);
    expect(findRenderedByName(ast, "cover-decorative-visual.cv.visual")).toBeUndefined();
    expect(findRenderedByName(ast, "cover-decorative-visual.cv.decor.0.mark")).toBeTruthy();
    const outDir = mkdtempSync(join(tmpdir(), "slideml2-cover-decorative-"));
    await expect(renderToPptx(rendered, join(outDir, "deck.pptx"))).resolves.toMatchObject({
      outputPath: join(outDir, "deck.pptx"),
    });
  });

  it("callout preserves text as body when a title is provided", () => {
    const slide: SlideV2 = {
      id: "callout-body",
      children: [{
        id: "callout-body.c",
        type: "callout",
        title: "警示",
        text: "不要继承旧风格",
        variant: "card",
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    expect(firstTextShapeContaining(ast, "警示")).toBeTruthy();
    expect(firstTextShapeContaining(ast, "不要继承旧风格")).toBeTruthy();
  });

  it("key-takeaway long business detail wraps before shrinking to unreadable text", () => {
    const slide: SlideV2 = {
      id: "s3",
      children: [{
        id: "s3.kt",
        type: "key-takeaway",
        headline: "Coding Agent 是入口，Office 是真正目标市场",
        detail: "TAM：$150亿（coding）→ $3000亿（office）= 20倍空间。Claude Code 接入 office 是定位重构，不是功能升级。",
        tone: "brand",
        variant: "banner",
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const detailShrink = getRenderDiagnostics().filter((d) => d.nodeId === "s3.kt.detail" && d.code === "TRUNCATED" && d.severity === "error");
    expect(detailShrink, detailShrink.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("stack fallback does not double-count gap when checking minimum child demand", () => {
    const slide: SlideV2 = {
      id: "gap-fit",
      children: [{
        id: "gap-fit.stack",
        type: "stack",
        direction: "vertical",
        fixedHeight: 1.6,
        gap: 0.3,
        children: [
          { id: "gap-fit.stack.a", type: "text", text: "第一行", style: "caption", minHeight: 0.65, autoFit: "shrink" },
          { id: "gap-fit.stack.b", type: "text", text: "第二行", style: "caption", minHeight: 0.65, autoFit: "shrink" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const failures = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED" && d.nodeId === "gap-fit.stack");
    expect(failures, failures.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("narrative split regions share compression budget instead of crushing the final takeaway", () => {
    const slide: SlideV2 = {
      id: "s07",
      children: [{
        type: "evidence-layout",
        headline: "K2-18b：可能含有生命迹象？",
        layout: "sidecar",
        ratio: [0.58, 0.42],
        evidence: {
          type: "stack",
          gap: 0.5,
          children: [
            {
              type: "kpi-grid",
              metrics: [
                { value: "124光年", label: "距离地球", status: "狮子座方向" },
                { value: "8.6x", label: "地球质量", status: "超级地球" },
                { value: "0-40°C", label: "表面温度估计", status: "宜居带内" },
              ],
              columns: 3,
              variant: "compact",
            },
            {
              type: "quote",
              text: "K2-18b是迄今为止唯一一颗同时拥有水和适宜温度的大气层的系外行星。这是寻找地外生命历史上的里程碑。",
              source: "— 剑桥大学天文研究所",
            },
          ],
        },
        insight: {
          type: "stack",
          gap: 0.4,
          children: [
            { type: "h1", text: "大气中的惊喜" },
            { type: "text", text: "2023-2025年，韦伯望远镜对K2-18b的大气进行了前所未有的详细分析，发现了：" },
            {
              type: "bullets",
              items: [
                "甲烷（CH₄）和二氧化碳（CO₂）——含碳分子的确凿证据",
                "二甲基硫醚（DMS）——地球上主要由海洋浮游生物产生",
                "缺乏氨（NH₃）——暗示其大气下方可能存在液态水海洋",
              ],
            },
            {
              type: "key-takeaway",
              headline: "氢海行星假说",
              detail: "科学家推测K2-18b是一个「氢海世界」——厚氢气大气包裹着全球性海洋，温度压力条件可能适合某些微生物生存。",
              tone: "brand",
              variant: "minimal",
            },
          ],
        },
      } as unknown as DomNode],
    };
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        brand: { name: "Space", primary: "2563EB" },
        themeOverride: {
          colors: {
            "brand.primary": "D4A843",
            surface: "0B0C10",
            "text.primary": "F0EDE5",
            background: "0B0C10",
          },
          text: {
            "section-title": { fontSize: 36, fontWeight: "bold", color: "D4A843" },
            "card-title": { fontSize: 18, fontWeight: "bold", color: "F0EDE5" },
            paragraph: { fontSize: 14, color: "E0DCD3", lineSpacing: 1.6 },
            bullet: { fontSize: 14, color: "E0DCD3", lineSpacing: 1.5 },
            "metric-value": { fontSize: 48, fontWeight: "bold", color: "D4A843" },
            "metric-label": { fontSize: 14, color: "B0B0B0" },
          },
          layout: { pageMarginX: 1.5, contentTop: 2.2, contentBottom: 13, defaultGap: 0.5 },
        },
      },
      slides: [slide],
    };
    const rendered = sourceToRenderedDeck(deck);
    clearRenderDiagnostics();
    const ast = renderToAst(rendered);
    const blocking = getRenderDiagnostics().filter((d) =>
      d.severity === "error" && (d.code === "COLLISION" || d.code === "SIBLING_INK_OVERLAP" || d.code === "FALLBACK_FAILED" || d.code === "SQUASHED")
    );
    expect(blocking, blocking.map((d) => d.message).join("\n")).toHaveLength(0);

    const measured = measureDeck(rendered)[0]!.nodes;
    const intro = measured.find((n) => n.id === "s07.node-1.insight.2")?.rect;
    const bullets = measured.find((n) => n.id === "s07.node-1.insight.3")?.rect;
    const takeaway = measured.find((n) => n.id === "s07.node-1.insight.4")?.rect;
    expect(intro?.h).toBeGreaterThan(2.2);
    expect(bullets?.h).toBeGreaterThan(2.6);
    expect(takeaway?.h).toBeGreaterThan(4.0);
    expect(takeaway?.h).toBeLessThan(5.1);

    const detail = findRenderedByName(ast, "s07.node-1.insight.4.detail") as { xfrm?: { cy: number }; paragraphs?: Array<{ runs: Array<{ sizeHalfPt?: number }> }> } | undefined;
    const measuredDetail = measured.find((n) => n.id === "s07.node-1.insight.4.detail")?.rect;
    const renderedBullets = shapeRectCm(findRenderedByName(ast, "s07.node-1.insight.3") as { xfrm?: { x?: number; y?: number; cx?: number; cy?: number } } | undefined);
    const renderedTakeawayHeadline = shapeRectCm(findRenderedByName(ast, "s07.node-1.insight.4.headline") as { xfrm?: { x?: number; y?: number; cx?: number; cy?: number } } | undefined);
    expect(renderedBullets).toBeDefined();
    expect(renderedTakeawayHeadline).toBeDefined();
    expect(renderedTakeawayHeadline!.y).toBeGreaterThanOrEqual(renderedBullets!.y + renderedBullets!.h - 0.02);
    expect(detail?.xfrm?.cy ? detail.xfrm.cy / 360000 : 0).toBeGreaterThan(2.0);
    expect(Math.abs((detail?.xfrm?.cy ? detail.xfrm.cy / 360000 : 0) - (measuredDetail?.h ?? 0))).toBeLessThan(0.05);
    expect(detail?.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt ?? 0).toBeGreaterThanOrEqual(24);
  });

  it("kpi-grid renders authored status notes and keeps compact CJK values readable", () => {
    const slide: SlideV2 = {
      id: "jwst-kpis",
      children: [{
        id: "grid",
        type: "kpi-grid",
        at: [1, 1, 14, 2.5],
        columns: 3,
        variant: "compact",
        metrics: [
          { value: "135亿年", label: "可观测宇宙年龄", status: "大爆炸后仅3亿年" },
          { value: "6.5米", label: "主镜直径", status: "18块六边形镜片" },
          { value: "100倍", label: "哈勃灵敏度提升", status: "红外波段" },
        ],
      } as unknown as DomNode],
    };

    clearRenderDiagnostics();
    const deck = sourceToRenderedDeck(buildDeckWithSlide(slide));
    const ast = renderToAst(deck);
    expect(firstTextShapeContaining(ast, "大爆炸后仅3亿年")).toBeTruthy();
    expect(firstTextShapeContaining(ast, "18块六边形镜片")).toBeTruthy();
    expect(firstTextShapeContaining(ast, "红外波段")).toBeTruthy();
    expect(firstRunSizeHalfPt(findRenderedByName(ast, "jwst-kpis.grid-m1.value"))).toBeGreaterThanOrEqual(40);

    const measured = measureDeck(deck)[0]?.nodes || [];
    const byId = new Map(measured.map((node) => [node.id, node]));
    const firstCard = byId.get("jwst-kpis.grid-m1");
    const firstStatus = byId.get("jwst-kpis.grid-m1.status");
    expect(firstStatus?.visualRect).toBeTruthy();
    expect((firstStatus?.visualRect?.y ?? 0) + (firstStatus?.visualRect?.h ?? 0)).toBeLessThanOrEqual((firstCard?.rect.y ?? 0) + (firstCard?.rect.h ?? 0) + 0.06);

    const blocking = getRenderDiagnostics().filter((d) =>
      d.severity === "error"
      && ["FALLBACK_FAILED", "SQUASHED", "TRUNCATED", "OVERFLOW"].includes(d.code)
      && String(d.nodeId || "").startsWith("jwst-kpis.grid-m"),
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toHaveLength(0);
  });

  it("tight explanation-block peers reduce chrome before crushing titles", () => {
    const slide: SlideV2 = {
      id: "explanation-title-fit",
      children: [{
        id: "explanation-title-fit.stack",
        type: "stack",
        at: [1, 1, 10.2, 5.2],
        gap: 0.32,
        children: [
          {
            id: "explanation-title-fit.a",
            type: "explanation-block",
            title: "层级问题 (Hierarchy Problem)",
            body: "为什么Higgs质量与Planck质量之间差17个数量级？量子修正应把Higgs质量推向Planck尺度。这是当前理论最核心的不自洽。",
            tone: "danger",
            variant: "panel",
          },
          {
            id: "explanation-title-fit.b",
            type: "explanation-block",
            title: "强CP问题",
            body: "QCD理论允许CP破坏项，但实验测到的中子电偶极矩几乎为零。轴子是主要候选解释，且恰好也是暗物质候选者。",
            tone: "warning",
            variant: "panel",
          },
        ],
      } as unknown as DomNode],
    };

    const rendered = sourceToRenderedDeck(buildDeckWithSlide(slide));
    clearRenderDiagnostics();
    renderToAst(rendered);
    const squashed = getRenderDiagnostics().filter((d) => d.code === "SQUASHED");
    expect(squashed, squashed.map((d) => d.message).join("\n")).toHaveLength(0);
    const measured = measureDeck(rendered)[0]!.nodes;
    for (const id of ["explanation-title-fit.a.title", "explanation-title-fit.b.title"]) {
      expect(measured.find((node) => node.id === id)?.rect.h).toBeGreaterThanOrEqual(0.33);
    }
  });

  it("single-column key-takeaway cohorts keep matching text slots typographically consistent", () => {
    const slide: SlideV2 = {
      id: "kt-cohort",
      children: [{
        id: "kt-cohort.grid",
        type: "grid",
        columns: 1,
        gap: 0.3,
        children: [
          {
            id: "kt-cohort.first",
            type: "key-takeaway",
            headline: "TRAPPIST-1：七颗地球大小的行星",
            detail: "距离地球仅39光年，7颗岩石行星中有3颗位于宜居带——研究系外行星大气的最佳实验室。",
            variant: "minimal",
          },
          {
            id: "kt-cohort.second",
            type: "key-takeaway",
            headline: "K2-18b：海洋世界的候选者",
            detail: "8.6倍地球质量的「超级地球」，韦伯在其大气中探测到了甲烷、二氧化碳，以及可能来自生命的二甲基硫醚（DMS）。",
            variant: "minimal",
          },
        ],
      } as unknown as DomNode],
    };

    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const firstHeadline = firstRunSizeHalfPt(findRenderedByName(ast, "kt-cohort.first.headline"));
    const secondHeadline = firstRunSizeHalfPt(findRenderedByName(ast, "kt-cohort.second.headline"));
    const firstDetail = firstRunSizeHalfPt(findRenderedByName(ast, "kt-cohort.first.detail"));
    const secondDetail = firstRunSizeHalfPt(findRenderedByName(ast, "kt-cohort.second.detail"));
    expect(firstHeadline).toBeDefined();
    expect(secondHeadline).toBeDefined();
    expect(firstDetail).toBeDefined();
    expect(secondDetail).toBeDefined();
    expect(Math.abs(firstHeadline! - secondHeadline!)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(firstDetail! - secondDetail!)).toBeLessThanOrEqual(0.01);
  });

  it("multi-column semantic cohorts keep repeated key-takeaways consistent by row and text slot", () => {
    const slide: SlideV2 = {
      id: "kt-multi",
      children: [{
        id: "kt-multi.grid",
        type: "grid",
        at: [1, 1, 12.2, 6.2],
        columns: 2,
        gap: 0.3,
        children: [
          { id: "kt-multi.a", type: "key-takeaway", headline: "观测超过理论", detail: "新一代望远镜持续发现理论模型无法快速解释的异常对象。", variant: "minimal" },
          { id: "kt-multi.b", type: "key-takeaway", headline: "模型需要回炉", detail: "当样本数量、波段覆盖和时间分辨率同时提升，早期宇宙、行星大气和星系演化中的旧假设会在同一页上被集中挑战。", variant: "minimal" },
          { id: "kt-multi.c", type: "key-takeaway", headline: "证据链更长", detail: "单个结论需要跨仪器、跨波段、跨团队复核。", variant: "minimal" },
          { id: "kt-multi.d", type: "key-takeaway", headline: "解释更谨慎", detail: "更好的数据不一定立刻给出答案，但会更快暴露模型的边界。", variant: "minimal" },
        ],
      } as unknown as DomNode],
    };

    const rendered = sourceToRenderedDeck(buildDeckWithSlide(slide));
    const ast = renderToAst(rendered);
    const headlineSizes = ["a", "b", "c", "d"].map((id) => firstRunSizeHalfPt(findRenderedByName(ast, `kt-multi.${id}.headline`)));
    const detailSizes = ["a", "b", "c", "d"].map((id) => firstRunSizeHalfPt(findRenderedByName(ast, `kt-multi.${id}.detail`)));
    expect(new Set(headlineSizes.map((size) => size?.toFixed(3))).size).toBe(1);
    expect(new Set(detailSizes.map((size) => size?.toFixed(3))).size).toBe(1);

    const measured = measureDeck(rendered)[0]?.nodes || [];
    const rectById = new Map(measured.map((node) => [node.id, node.rect]));
    const cardHeights = ["a", "b", "c", "d"].map((id) => rectById.get(`kt-multi.${id}`)?.h.toFixed(3));
    expect(new Set(cardHeights).size).toBe(1);
  });

  it("semantic cohort uses fitted text size from the dense peer across feature-card siblings", () => {
    const body =
      "这段文字故意比其他卡片长很多，用来模拟一页中三个同类卡片只有一个需要自适应收缩的情况；最终三张卡片的正文应该共享同一字号，而不是只有这一张变小。";
    const slide: SlideV2 = {
      id: "feature-cohort",
      children: [{
        id: "feature-cohort.grid",
        type: "grid",
        at: [1, 1, 12.3, 2.55],
        columns: 3,
        gap: 0.35,
        children: [
          {
            id: "feature-cohort.a",
            type: "stack",
            role: "feature-card",
            direction: "vertical",
            gap: 0.12,
            padding: 0.28,
            fill: "surface",
            children: [
              { id: "feature-cohort.a.title", type: "text", text: "实验端", style: "card-title", autoFit: "shrink" },
              { id: "feature-cohort.a.body", type: "text", text: "探测器更灵敏，数据更多。", style: "paragraph", fontSize: 14, autoFit: "shrink" },
            ],
          },
          {
            id: "feature-cohort.b",
            type: "stack",
            role: "feature-card",
            direction: "vertical",
            gap: 0.12,
            padding: 0.28,
            fill: "surface",
            children: [
              { id: "feature-cohort.b.title", type: "text", text: "理论端", style: "card-title", autoFit: "shrink" },
              { id: "feature-cohort.b.body", type: "text", text: body, style: "paragraph", fontSize: 14, autoFit: "shrink" },
            ],
          },
          {
            id: "feature-cohort.c",
            type: "stack",
            role: "feature-card",
            direction: "vertical",
            gap: 0.12,
            padding: 0.28,
            fill: "surface",
            children: [
              { id: "feature-cohort.c.title", type: "text", text: "传播端", style: "card-title", autoFit: "shrink" },
              { id: "feature-cohort.c.body", type: "text", text: "解释必须更谨慎。", style: "paragraph", fontSize: 14, autoFit: "shrink" },
            ],
          },
        ],
      } as unknown as DomNode],
    };

    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const bodySizes = ["a", "b", "c"].map((id) => firstRunSizeHalfPt(findRenderedByName(ast, `feature-cohort.${id}.body`)));
    expect(new Set(bodySizes.map((size) => size?.toFixed(3))).size).toBe(1);
    expect(bodySizes[0]).toBeLessThan(28);
  });

  it("generic metric-card cohorts align value and label bands outside kpi-grid", () => {
    const slide: SlideV2 = {
      id: "metric-generic",
      children: [{
        id: "metric-generic.grid",
        type: "grid",
        at: [1, 1, 12.1, 1.75],
        columns: 3,
        gap: 0.25,
        children: [
          { id: "metric-generic.a", type: "metric-card", value: "134亿", label: "光年距离", variant: "compact", density: "compact" },
          { id: "metric-generic.b", type: "metric-card", value: "2.9亿", label: "年", variant: "compact", density: "compact" },
          { id: "metric-generic.c", type: "metric-card", value: "1,600", label: "光年直径", variant: "compact", density: "compact" },
        ],
      } as unknown as DomNode],
    };

    const measured = measureDeck(sourceToRenderedDeck(buildDeckWithSlide(slide)))[0]?.nodes || [];
    const rectById = new Map(measured.map((node) => [node.id, node.rect]));
    const ids = ["a", "b", "c"].map((id) => `metric-generic.${id}`);
    expect(new Set(ids.map((id) => rectById.get(`${id}.value-wrap`)?.h.toFixed(3))).size).toBe(1);
    expect(new Set(ids.map((id) => rectById.get(`${id}.label`)?.y.toFixed(3))).size).toBe(1);
  });

  it("page-level semantic cohorts normalize matching components across separate regions", () => {
    const slide: SlideV2 = {
      id: "page-cohort",
      children: [{
        id: "page-cohort.split",
        type: "split",
        direction: "horizontal",
        ratio: [0.5, 0.5],
        gap: 0.5,
        children: [
          {
            id: "page-cohort.left",
            type: "stack",
            children: [
              {
                id: "page-cohort.left.kt",
                type: "key-takeaway",
                headline: "实验先行",
                detail: "观测数据不断刷新理论边界，新的异常比解释出现得更快。",
                variant: "minimal",
              },
            ],
          },
          {
            id: "page-cohort.right",
            type: "stack",
            children: [
              {
                id: "page-cohort.right.kt",
                type: "key-takeaway",
                headline: "理论滞后",
                detail: "当一页中的另一个同类组件因为内容更长而需要字体收缩时，页面级 cohort 应该同步更新同一语义位置的字号，否则左右两边会显得像两套不同模板。",
                variant: "minimal",
              },
            ],
          },
        ],
      } as unknown as DomNode],
    };

    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const leftDetail = firstRunSizeHalfPt(findRenderedByName(ast, "page-cohort.left.kt.detail"));
    const rightDetail = firstRunSizeHalfPt(findRenderedByName(ast, "page-cohort.right.kt.detail"));
    expect(leftDetail).toBeDefined();
    expect(rightDetail).toBeDefined();
    expect(Math.abs(leftDetail! - rightDetail!)).toBeLessThanOrEqual(0.01);

    const rendered = sourceToRenderedDeck(buildDeckWithSlide(slide));
    measureDeck(rendered);
    const decisions = layoutDecisionsForSlide(rendered, "page-cohort");
    expect(decisions.get("page-cohort.left.kt")?.notes?.some((note) => note.includes("semantic-cohort:") && note.includes("scope=slide"))).toBe(true);
    expect(decisions.get("page-cohort.right.kt")?.notes?.some((note) => note.includes("semantic-cohort:") && note.includes("scope=slide"))).toBe(true);
  });

  it("page-level semantic cohorts normalize a same-standing subset when another region is not a peer", () => {
    const slide: SlideV2 = {
      id: "subset-page-cohort",
      children: [{
        id: "subset-page-cohort.split",
        type: "split",
        direction: "horizontal",
        ratio: [0.42, 0.42, 0.16],
        gap: 0.35,
        children: [
          {
            id: "subset-page-cohort.left",
            type: "stack",
            layoutWeight: 1,
            children: [{
              id: "subset-page-cohort.left.kt",
              type: "key-takeaway",
              headline: "同等主区 A",
              detail: "短文本本来会保持更大的字号。",
              variant: "minimal",
            }],
          },
          {
            id: "subset-page-cohort.middle",
            type: "stack",
            layoutWeight: 1,
            children: [{
              id: "subset-page-cohort.middle.kt",
              type: "key-takeaway",
              headline: "同等主区 B",
              detail: "这个同等主区里的文本明显更长，因此它会触发字号压缩；同等地位的左侧主区应该共享这一组排版预算，而不是保持一套不同字号。",
              variant: "minimal",
            }],
          },
          {
            id: "subset-page-cohort.note",
            type: "stack",
            layoutWeight: 0.35,
            children: [{ id: "subset-page-cohort.note.text", type: "text", text: "旁注区域不是同等主内容。" }],
          },
        ],
      } as unknown as DomNode],
    };

    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const leftDetail = firstRunSizeHalfPt(findRenderedByName(ast, "subset-page-cohort.left.kt.detail"));
    const middleDetail = firstRunSizeHalfPt(findRenderedByName(ast, "subset-page-cohort.middle.kt.detail"));
    expect(leftDetail).toBeDefined();
    expect(middleDetail).toBeDefined();
    expect(Math.abs(leftDetail! - middleDetail!)).toBeLessThanOrEqual(0.01);
  });

  it("page-level semantic cohorts match slots despite optional non-semantic decoration", () => {
    const slide: SlideV2 = {
      id: "decorated-slot-cohort",
      children: [{
        id: "decorated-slot-cohort.split",
        type: "split",
        direction: "horizontal",
        ratio: [0.5, 0.5],
        gap: 0.5,
        children: [
          {
            id: "decorated-slot-cohort.left",
            type: "stack",
            children: [
              { id: "decorated-slot-cohort.left.rule", type: "divider", fixedHeight: 0.05 },
              {
                id: "decorated-slot-cohort.left.kt",
                type: "key-takeaway",
                headline: "有装饰元素",
                detail: "短文本。",
                variant: "minimal",
              },
            ],
          },
          {
            id: "decorated-slot-cohort.right",
            type: "stack",
            children: [{
              id: "decorated-slot-cohort.right.kt",
              type: "key-takeaway",
              headline: "无装饰元素",
              detail: "右侧没有前置装饰元素，但它和左侧 key-takeaway 是同一语义槽位，应该按语义 slot 对齐字号，而不是被 child index 干扰。",
              variant: "minimal",
            }],
          },
        ],
      } as unknown as DomNode],
    };

    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const leftDetail = firstRunSizeHalfPt(findRenderedByName(ast, "decorated-slot-cohort.left.kt.detail"));
    const rightDetail = firstRunSizeHalfPt(findRenderedByName(ast, "decorated-slot-cohort.right.kt.detail"));
    expect(leftDetail).toBeDefined();
    expect(rightDetail).toBeDefined();
    expect(Math.abs(leftDetail! - rightDetail!)).toBeLessThanOrEqual(0.01);
  });

  it("semantic cohorts respect authored component cohort groups", () => {
    const slide: SlideV2 = {
      id: "authored-group-cohort",
      children: [{
        id: "authored-group-cohort.grid",
        type: "grid",
        at: [1, 1, 12, 2.4],
        columns: 2,
        gap: 0.35,
        children: [
          {
            id: "authored-group-cohort.a",
            type: "key-takeaway",
            cohortGroup: "primary",
            headline: "不同结构组",
            detail: "短文本应该保持自身字号。",
            variant: "minimal",
          },
          {
            id: "authored-group-cohort.b",
            type: "key-takeaway",
            cohortGroup: "secondary",
            headline: "不同结构组",
            detail: "这个文本明显更长，用来确认 agent 明确声明的不同 cohortGroup 不会因为组件类型相同就被统一压缩到同一字号。",
            variant: "minimal",
          },
        ],
      } as unknown as DomNode],
    };

    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const firstDetail = firstRunSizeHalfPt(findRenderedByName(ast, "authored-group-cohort.a.detail"));
    const secondDetail = firstRunSizeHalfPt(findRenderedByName(ast, "authored-group-cohort.b.detail"));
    expect(firstDetail).toBeDefined();
    expect(secondDetail).toBeDefined();
    expect(firstDetail! - secondDetail!).toBeGreaterThan(2);
  });

  it("page-level semantic cohorts do not force peers across unequal regions", () => {
    const detail = "同一类结论在窄栏里需要更多换行。宽栏可以保持更舒展的正文尺度。这里使用连续说明来制造宽窄差异并避免被自动拆成列表。".repeat(2);
    const slide: SlideV2 = {
      id: "unequal-page-cohort",
      children: [{
        id: "unequal-page-cohort.split",
        type: "split",
        direction: "horizontal",
        ratio: [0.5, 0.5],
        gap: 0.5,
        children: [
          {
            id: "unequal-page-cohort.left",
            type: "stack",
            children: [{
              id: "unequal-page-cohort.left.kt",
              type: "key-takeaway",
              headline: "同类组件，空间不同",
              detail,
              variant: "minimal",
            }],
          },
          {
            id: "unequal-page-cohort.right",
            type: "stack",
            fixedHeight: 3,
            children: [{
              id: "unequal-page-cohort.right.kt",
              type: "key-takeaway",
              headline: "同类组件，空间不同",
              detail,
              variant: "minimal",
            }],
          },
        ],
      } as unknown as DomNode],
    };

    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const leftDetail = firstRunSizeHalfPt(findRenderedByName(ast, "unequal-page-cohort.left.kt.detail"));
    const rightDetail = firstRunSizeHalfPt(findRenderedByName(ast, "unequal-page-cohort.right.kt.detail"));
    expect(leftDetail).toBeDefined();
    expect(rightDetail).toBeDefined();
    expect(leftDetail! - rightDetail!).toBeGreaterThan(2);
  });

  it("page-level semantic cohorts do not force peers across unequal split ratios", () => {
    const detail = "同一类结论在窄栏里需要更多换行。宽栏可以保持更舒展的正文尺度。这里使用连续说明来制造宽窄差异并避免被自动拆成列表。".repeat(2);
    const slide: SlideV2 = {
      id: "unequal-ratio-cohort",
      children: [{
        id: "unequal-ratio-cohort.split",
        type: "split",
        direction: "horizontal",
        ratio: [0.66, 0.34],
        gap: 0.5,
        children: [
          {
            id: "unequal-ratio-cohort.left",
            type: "stack",
            children: [{
              id: "unequal-ratio-cohort.left.kt",
              type: "key-takeaway",
              headline: "同类组件，区域更宽",
              detail: "宽区域里的短文本应该保持更大的正文。",
              variant: "minimal",
            }],
          },
          {
            id: "unequal-ratio-cohort.right",
            type: "stack",
            children: [{
              id: "unequal-ratio-cohort.right.kt",
              type: "key-takeaway",
              headline: "同类组件，区域更窄",
              detail,
              variant: "minimal",
            }],
          },
        ],
      } as unknown as DomNode],
    };

    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const leftDetail = firstRunSizeHalfPt(findRenderedByName(ast, "unequal-ratio-cohort.left.kt.detail"));
    const rightDetail = firstRunSizeHalfPt(findRenderedByName(ast, "unequal-ratio-cohort.right.kt.detail"));
    expect(leftDetail).toBeDefined();
    expect(rightDetail).toBeDefined();
    expect(leftDetail! - rightDetail!).toBeGreaterThan(2);
  });

  it("semantic cohorts grow back from an early compressed pass when the final region has room", () => {
    const slide: SlideV2 = {
      id: "cohort-growback",
      children: [{
        type: "evidence-layout",
        headline: "引力波：聆听宇宙的声音",
        layout: "sidecar",
        ratio: [0.6, 0.4],
        evidence: {
          type: "stack",
          gap: 0.5,
          children: [
            { type: "h1", text: "爱因斯坦的终极预言" },
            {
              type: "text",
              text: "1916年，爱因斯坦预言了引力波的存在——当大质量物体加速运动时，它们会在时空结构中激起涟漪，以光速向外传播。整整100年后的2016年，LIGO首次直接探测到了引力波。",
            },
            { type: "spacer", fixedHeight: 0.3 },
            {
              type: "quote",
              text: "引力波不仅是发现，它是一扇全新的窗户——我们第一次能「听见」宇宙，而不只是「看见」它。",
            },
          ],
        },
        insight: {
          type: "stack",
          gap: 0.4,
          children: [
            {
              id: "cohort-growback.first",
              type: "key-takeaway",
              headline: "2023年：脉冲星计时阵列",
              detail: "利用遍布银河系的毫秒脉冲星作为天然钟表，科学家们首次「听到」了来自超大质量黑洞合并产生的超低频引力波背景——这是一种宇宙级别的「嗡嗡声」。",
              tone: "brand",
              variant: "minimal",
            },
            {
              id: "cohort-growback.second",
              type: "key-takeaway",
              headline: "2025年：国际合作深化",
              detail: "中国、欧洲、印度、澳大利亚、北美五大脉冲星计时阵列首次同步发布数据，人类对引力波宇宙的探测进入了多信使天文学新纪元。",
              tone: "info",
              variant: "minimal",
            },
          ],
        },
      } as unknown as DomNode],
    };
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        brand: { name: "Space", primary: "2563EB" },
        themeOverride: {
          colors: {
            "brand.primary": "D4A843",
            surface: "0B0C10",
            "text.primary": "F0EDE5",
            background: "0B0C10",
          },
          text: {
            "section-title": { fontSize: 36, fontWeight: "bold", color: "D4A843" },
            "card-title": { fontSize: 18, fontWeight: "bold", color: "F0EDE5" },
            paragraph: { fontSize: 14, color: "E0DCD3", lineSpacing: 1.6 },
          },
          layout: { pageMarginX: 1.5, contentTop: 2.2, contentBottom: 13, defaultGap: 0.5 },
        },
      },
      slides: [slide],
    };

    const ast = renderToAst(sourceToRenderedDeck(deck));
    const firstDetail = firstRunSizeHalfPt(findRenderedByName(ast, "cohort-growback.first.detail"));
    const secondDetail = firstRunSizeHalfPt(findRenderedByName(ast, "cohort-growback.second.detail"));
    expect(firstDetail).toBeDefined();
    expect(secondDetail).toBeDefined();
    expect(Math.min(firstDetail!, secondDetail!)).toBeGreaterThanOrEqual(23);
  });

  it("quote blocks grow text into spacious assigned regions", () => {
    const slide: SlideV2 = {
      id: "quote-grow",
      children: [{
        id: "quote-grow.q",
        type: "quote",
        text: "它看起来完全不像我们预测的那样。",
        fixedHeight: 3.2,
      } as unknown as DomNode],
    };

    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const quote = findRenderedByName(ast, "quote-grow.q.text");
    expect(firstRunSizeHalfPt(quote)).toBeGreaterThanOrEqual(56);
    expect(shapeRectCm(quote as { xfrm?: { x?: number; y?: number; cx?: number; cy?: number } } | undefined)?.h ?? 0).toBeGreaterThan(2.0);
  });

  it("narrative budget accounts for layout glue before protecting the final takeaway", () => {
    const slide: SlideV2 = {
      id: "budget-glue",
      children: [{
        id: "budget-glue.split",
        type: "split",
        direction: "horizontal",
        ratio: [0.56, 0.44],
        gap: 0.55,
        children: [
          {
            id: "budget-glue.left",
            type: "stack",
            gap: 0.35,
            children: [
              { id: "budget-glue.left.title", type: "h2", text: "观测证据" },
              { id: "budget-glue.left.body", type: "text", text: "左侧区域承载图像、数据表或证据摘要，不参与右侧叙事区域的统一压缩预算。" },
            ],
          },
          {
            id: "budget-glue.right",
            type: "stack",
            gap: 0.35,
            children: [
              { id: "budget-glue.title", type: "h1", text: "右侧叙事需要统一压缩" },
              { id: "budget-glue.intro", type: "text", text: "当标题、导语、列表和结论同时存在时，布局不应该让前面的内容先占满空间，再把最后的关键结论压缩到不可读。" },
              { id: "budget-glue.glue", type: "spacer", fixedHeight: 0.2, layoutGlue: true },
              {
                id: "budget-glue.bullets",
                type: "bullets",
                items: [
                  "导语和列表可以进入 compact/shrink 模式，但要和结论共享预算",
                  "layoutGlue 产生的节奏空间必须先计入总预算，再统一求解",
                  "关键结论应保留足够的文字高度，而不是只剩一个很小的注脚",
                ],
              },
              {
                id: "budget-glue.takeaway",
                type: "key-takeaway",
                headline: "统一预算优先于局部贪心",
                detail: "区域内所有叙事子块一起压缩，才能保持视觉一致性和阅读优先级。",
                tone: "brand",
                variant: "minimal",
              },
            ],
          },
        ],
      } as unknown as DomNode],
    };

    clearRenderDiagnostics();
    const rendered = sourceToRenderedDeck(buildDeckWithSlide(slide));
    const ast = renderToAst(rendered);
    const blocking = getRenderDiagnostics().filter((d) =>
      d.severity === "error" && (d.code === "COLLISION" || d.code === "SIBLING_INK_OVERLAP" || d.code === "FALLBACK_FAILED" || d.code === "SQUASHED")
    );
    expect(blocking, blocking.map((d) => d.message).join("\n")).toHaveLength(0);

    const measured = measureDeck(rendered)[0]!.nodes;
    const glue = measured.find((n) => n.id === "budget-glue.glue")?.rect;
    const takeaway = measured.find((n) => n.id === "budget-glue.takeaway")?.rect;
    const detail = findRenderedByName(ast, "budget-glue.takeaway.detail") as { xfrm?: { cy: number }; paragraphs?: Array<{ runs: Array<{ sizeHalfPt?: number }> }> } | undefined;
    expect(glue?.h).toBeGreaterThanOrEqual(0.18);
    expect(takeaway?.h).toBeGreaterThan(3.0);
    expect(detail?.xfrm?.cy ? detail.xfrm.cy / 360000 : 0).toBeGreaterThan(1.35);
    expect(detail?.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt ?? 0).toBeGreaterThanOrEqual(22);
  });

  it("narrative budget reports infeasible readable floors instead of silently scaling below them", () => {
    const slide: SlideV2 = {
      id: "budget-infeasible",
      children: [{
        id: "budget-infeasible.split",
        type: "split",
        direction: "horizontal",
        ratio: [0.64, 0.36],
        gap: 0.6,
        children: [
          { id: "budget-infeasible.left", type: "text", text: "Evidence column" },
          {
            id: "budget-infeasible.right",
            type: "stack",
            gap: 0.42,
            children: [
              { id: "budget-infeasible.title", type: "h1", text: "过载叙事区域" },
              { id: "budget-infeasible.lead", type: "text", text: "这个区域故意放入过多文字，用来验证当可读 floor 总和超过可用高度时，渲染器必须给出明确诊断，而不是静默把每一块都缩到不可读。" },
              {
                id: "budget-infeasible.bullets",
                type: "bullets",
                items: [
                  "第一条说明会很长，迫使右侧窄列发生换行，并抬高 bullets 的可读 floor。",
                  "第二条继续增加压力，模拟 agent 在同一页中过度塞入多个论点的情况。",
                  "第三条还要保留上下文，避免压缩算法只优化最后一个组件而忽略整体阅读。",
                  "第四条确保总 floor 明显超过右半区域高度。",
                ],
              },
              {
                id: "budget-infeasible.takeaway",
                type: "key-takeaway",
                headline: "必须暴露不可满足状态",
                detail: "当区域预算已经不可满足，正确行为是报告 REGION_BUDGET_INFEASIBLE，并给出拆页、删减或降低优先级的提示。",
                tone: "brand",
                variant: "minimal",
              },
            ],
          },
        ],
      } as unknown as DomNode],
    };
    const deck = buildDeckWithSlide(slide);
    deck.deck.themeOverride = {
      text: {
        "section-title": { fontSize: 42, lineSpacing: 1.1 },
        paragraph: { fontSize: 17, lineSpacing: 1.65 },
        bullet: { fontSize: 17, lineSpacing: 1.55 },
      },
      layout: {
        contentTop: 2.4,
        contentBottom: 12.2,
        regionBudget: {
          bodyScale: 0.92,
          leadScale: 0.92,
          bulletScale: 0.90,
          bulletMinPt: 13,
          keyTakeawayMinCm: 4.8,
          keyTakeawayMaxCm: 6.2,
          keyTakeawayMaxAvailableRatio: 0.7,
        },
      },
    };

    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck));
    const diagnostic = getRenderDiagnostics().find((d) => d.code === "REGION_BUDGET_INFEASIBLE" && d.nodeId === "budget-infeasible.right");
    expect(diagnostic).toBeTruthy();
    expect(diagnostic?.measured?.budgetDeficitCm ?? 0).toBeGreaterThan(0);
    expect(diagnostic?.suggestion || "").toContain("split");
  });

  it("numbered-grid supports a normal 2x2 business summary under a key takeaway", () => {
    const slide: SlideV2 = {
      id: "exec-2x2",
      title: "核心结论：四个高赔率对角线机会",
      children: [
        {
          id: "exec-2x2.thesis",
          type: "key-takeaway",
          headline: "不做下一个 Cursor/Claude Code，不做中国版 Mem0/Browserbase",
          detail: "这两个方向都被巨头预占，创业者应该聚焦四个对角线交叉点",
          tone: "brand",
          variant: "banner",
        } as unknown as DomNode,
        {
          id: "exec-2x2.grid",
          type: "numbered-grid",
          columns: 2,
          marker: { shape: "diamond", variant: "tint", tone: "brand", size: "sm" },
          items: [
            { title: "垂直行业 + 政策红利", body: "保险理赔 / 财税 / 医疗 / 政务", tone: "positive" },
            { title: "出海 Productivity SaaS", body: "Day 1 海外架构，避开国内围剿", tone: "positive" },
            { title: "跨平台中立中间件", body: "Eval / Identity，巨头互不兼容创造的缝隙", tone: "warning" },
            { title: "私有化 Agent 中台", body: "第四范式路径，央企/金融合规", tone: "brand" },
          ],
        } as unknown as DomNode,
      ],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const failures = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED" && d.slideId === "exec-2x2");
    expect(failures, failures.map((d) => d.message).join("\n")).toHaveLength(0);
    const body = findRenderedByName(ast, "exec-2x2.grid.0.body") as { paragraphs?: Array<{ runs: Array<{ sizeHalfPt?: number }> }> } | undefined;
    expect(body?.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt).toBeGreaterThanOrEqual(20);
  });

  it("numbered-grid accepts string marker aliases in validation", () => {
    const deck = buildDeckWithSlide({
      id: "marker-alias",
      title: "Marker aliases",
      children: [{
        id: "marker-alias.grid",
        type: "numbered-grid",
        marker: "chip",
        items: [
          { title: "A", body: "Alpha" },
          { title: "B", body: "Beta" },
        ],
      } as unknown as DomNode],
    });

    const validation = validateDeck(deck);
    expect(validation.errors.map((error) => error.code)).not.toContain("INVALID_FIELD_USAGE");
  });

  it("bar-list auto-compacts five-item lists so mixed slides do not collapse", () => {
    const slide: SlideV2 = {
      id: "dense-bars",
      title: "渠道结构和关键动作",
      children: [{
        id: "dense-bars.bars",
        type: "bar-list",
        fixedHeight: 5.18,
        sort: "desc",
        items: [
          { label: "线上直营", value: 42, valueLabel: "42%" },
          { label: "平台分销", value: 25, valueLabel: "25%" },
          { label: "企业客户", value: 16, valueLabel: "16%" },
          { label: "线下门店", value: 11, valueLabel: "11%" },
          { label: "其他渠道", value: 6, valueLabel: "6%" },
        ],
      } as unknown as DomNode],
    };

    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const failures = getRenderDiagnostics().filter((diagnostic) =>
      diagnostic.nodeId?.startsWith("dense-bars.bars")
      && ["FALLBACK_FAILED", "SQUASHED", "TINY_RECT"].includes(diagnostic.code)
    );
    expect(failures, failures.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("rich callout body in a business split gets enough height before text shrink", () => {
    const slide: SlideV2 = {
      id: "s3",
      title: "判断 1：Coding Agent 是入口，Office 是真正目标市场",
      children: [{
        id: "s3.split",
        type: "split",
        direction: "horizontal",
        ratio: [0.55, 0.45],
        gap: 0.55,
        children: [
          {
            id: "s3.split.left",
            type: "stack",
            gap: 0.35,
            children: [
              { id: "s3.left.h", type: "h2", text: "TAM 20-30 倍扩容空间" },
              {
                id: "s3.left.stat",
                type: "stat-strip",
                items: [
                  { value: "$150 亿/年", label: "Coding Agent TAM" },
                  { value: "$3000 亿/年", label: "Office Agent TAM" },
                ],
                tone: "brand",
              },
              {
                id: "s3.left.note",
                type: "callout",
                title: "定位重构信号",
                body: "Claude Code 接入 office 文档不是功能升级，是「定位重构」；模型方下一波增长只能来自 office 知识工作者市场。",
                tone: "warning",
                variant: "card",
              },
            ],
          },
          {
            id: "s3.split.right",
            type: "stack",
            gap: 0.35,
            children: [
              { id: "s3.right.h", type: "h2", text: "谁是最大输家候选" },
              { id: "s3.right.ins1", type: "insight-card", headline: "Microsoft Copilot", body: "用户入口变成 Claude", tone: "danger" },
              { id: "s3.right.ins2", type: "insight-card", headline: "Notion / Salesforce", body: "降级为数据后端", tone: "warning" },
            ],
          },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const calloutShrink = getRenderDiagnostics().filter((d) => d.nodeId === "s3.left.note.body" && d.code === "TRUNCATED" && d.severity === "error");
    expect(calloutShrink, calloutShrink.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("theme lineHeight is emitted as paragraph line spacing for ordinary text", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "2563EB" },
        themeOverride: { text: { paragraph: { fontSize: 13, lineHeight: 1.6 } } },
      },
      slides: [{
        id: "typography",
        children: [{ id: "typography.body", type: "text", text: "一段普通正文", style: "paragraph" }],
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const body = findRenderedByName(ast, "typography.body") as { paragraphs?: Array<{ lineSpacingHalfPt?: number }> } | undefined;
    expect(body?.paragraphs?.[0]?.lineSpacingHalfPt).toBeCloseTo(13 * 1.6 * 2, 2);
  });

  it("node lineSpacing <= 3 is treated as a multiplier, not an absolute point value", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "line-spacing",
        children: [{
          id: "line-spacing.body",
          type: "text",
          text: "第一行会换行，第二行不应该压在第一行上。",
          fontSize: 11,
          lineSpacing: 1.7,
        }],
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const body = findRenderedByName(ast, "line-spacing.body") as { paragraphs?: Array<{ lineSpacingHalfPt?: number }> } | undefined;
    expect(body?.paragraphs?.[0]?.lineSpacingHalfPt).toBeCloseTo(11 * 1.7 * 2, 2);
  });

  it("node lineSpacing can tighten a loose theme paragraph default", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "2563EB" },
        themeOverride: { text: { paragraph: { fontSize: 11, lineHeight: 1.8 } } },
      },
      slides: [{
        id: "line-spacing-override",
        children: [{
          id: "line-spacing-override.body",
          type: "text",
          text: "第一行\n第二行\n第三行",
          style: "paragraph",
          fontSize: 11,
          lineSpacing: 1.5,
        }],
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const body = findRenderedByName(ast, "line-spacing-override.body") as { paragraphs?: Array<{ lineSpacingHalfPt?: number }> } | undefined;
    expect(body?.paragraphs?.[0]?.lineSpacingHalfPt).toBeCloseTo(11 * 1.5 * 2, 2);
  });

  it("editorial mirror slide does not warn on readable quote text and keeps brand mark on one line", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        brand: { name: "堕落", primary: "C9A96E" },
        themeOverride: {
          colors: {
            "surface.primary": "1A1A1A",
            "text.primary": "E8E4D9",
            "text.secondary": "9E9689",
          },
          text: {
            paragraph: { fontSize: 14, lineHeight: 1.8, color: "text.secondary" },
            label: { fontSize: 10.5, color: "text.secondary" },
          },
          layout: { contentTop: 1.2, contentBottom: 13.5, titleTop: 0, titleHeight: 0, defaultGap: 0.6, columnGap: 0.5, pageMarginX: 1.2 },
          fonts: {
            latin: { display: ["Georgia", "Times New Roman"], text: ["Georgia", "Times New Roman"] },
            cjk: { display: ["Noto Serif SC", "STSong", "SimSun"], text: ["Noto Serif SC", "STSong", "SimSun"] },
          },
        },
      },
      slides: [{
        id: "mirror",
        background: { fill: "1A1A1A" },
        children: [
          {
            id: "mirror.node-1",
            type: "split",
            direction: "horizontal",
            ratio: [0.42, 0.58],
            gap: 1.0,
            area: "content",
            children: [
              { id: "mirror.node-1.1", type: "image", src: TINY_PNG, fit: "cover" },
              {
                id: "mirror.node-1.2",
                type: "stack",
                gap: 0.35,
                children: [
                  { id: "mirror.node-1.2.1", type: "spacer", fixedHeight: 0.3 },
                  { id: "mirror.node-1.2.2", type: "text", text: "镜  子", fontSize: 36, color: "E8E4D9", letterSpacing: 12 },
                  { id: "mirror.node-1.2.3", type: "text", text: "阿姆斯特丹的运河就是克拉芒斯的镜子。", fontSize: 12, color: "C9A96E", letterSpacing: 2 },
                  {
                    id: "mirror.node-1.2.4",
                    type: "text",
                    text: "水面不会说谎。倒影中的面孔是真实的。\n\n克拉芒斯住在运河边，说「水是最好的忏悔室」。在雾里和威士忌中，他对陌生人——也就是我们——不断倾诉和解剖自己。\n\n不是在寻求宽恕。只是想让另一个人也看到自己的倒影。",
                    fontSize: 11,
                    lineSpacing: 1.6,
                    color: "A09988",
                  },
                  {
                    id: "mirror.node-1.2.5",
                    type: "text",
                    text: "Aucun homme n'est innocent.\nEt il n'y en a pas non plus\nqui soit seul coupable.",
                    fontSize: 11,
                    lineSpacing: 1.5,
                    fontStyle: "italic",
                    color: "E8E4D9",
                  },
                ],
              },
            ],
          } as unknown as DomNode,
          { id: "mirror.node-2", type: "brand-mark", text: "The Fall · Albert Camus", corner: "bottom-right" } as unknown as DomNode,
        ],
      }],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const diagnostics = getRenderDiagnostics();
    expect(diagnostics.filter((d) => d.nodeId === "mirror.node-1.2.5" && (d.code === "OVERFLOW" || d.code === "TRUNCATED"))).toHaveLength(0);
    expect(diagnostics.filter((d) => d.nodeId === "mirror.node-2" && d.code === "TRUNCATED")).toHaveLength(0);
    const mark = findRenderedByName(ast, "mirror.node-2") as { xfrm?: { cx: number; cy: number }; paragraphs?: Array<{ runs: Array<{ sizeHalfPt?: number }> }> } | undefined;
    expect(mark?.xfrm?.cx).toBeGreaterThan(4.2 * 360000);
    expect(mark?.xfrm?.cy).toBeGreaterThanOrEqual(0.55 * 360000);
    expect(mark?.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt).toBeGreaterThanOrEqual(20);
  });

  it("validator rejects ignored CSS-style spacing fields and px-like primitive gaps", () => {
    const slide: SlideV2 = {
      id: "unit-footguns",
      children: [{
        id: "unit-footguns.grid",
        type: "grid",
        columns: 3,
        gap: 8,
        padding: 16,
        children: [
          { id: "unit-footguns.a", type: "text", text: "A" },
          { id: "unit-footguns.b", type: "text", text: "B", lineSpacing: 4 },
          { id: "unit-footguns.c", type: "text", text: "C", marginBottom: 12 },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors.map((e) => e.code)).toContain("LAYOUT_GAP_TOO_LARGE");
    expect(report.errors.map((e) => e.code)).toContain("LAYOUT_PADDING_TOO_LARGE");
    expect(report.errors.map((e) => e.code)).toContain("LINE_SPACING_AMBIGUOUS_UNIT");
    expect(report.errors.map((e) => e.code)).toContain("UNSUPPORTED_NODE_SPACING_FIELD");
  });

  it("executive-summary findings use readable bullet spacing by default", () => {
    const slide: SlideV2 = {
      id: "summary",
      children: [{
        id: "summary.exec",
        type: "executive-summary",
        headline: "核心摘要",
        findings: [
          { headline: "设计统一性战略", detail: "通过量变积累用户信任。" },
          { headline: "MEGA争议启示", detail: "激进创新需要循序渐进。" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const findings = findRenderedByName(ast, "summary.exec.findings") as { paragraphs?: Array<{ lineSpacingHalfPt?: number; spaceAfterHalfPt?: number; runs: Array<{ sizeHalfPt?: number }> }> } | undefined;
    expect(findings?.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt).toBeGreaterThanOrEqual(20);
    expect(findings?.paragraphs?.[0]?.lineSpacingHalfPt).toBeGreaterThan(26);
    expect(findings?.paragraphs?.[0]?.spaceAfterHalfPt).toBeGreaterThanOrEqual(10);
  });

  it("executive-summary preserves all findings instead of silently dropping after four", () => {
    const slide: SlideV2 = {
      id: "summary-many",
      children: [{
        id: "summary-many.exec",
        type: "executive-summary",
        headline: "核心摘要",
        findings: [
          { headline: "垂直证据型 search", detail: "金融/医疗/保险" },
          { headline: "多模态 search", detail: "Visual/Video for agents" },
          { headline: "Commerce 聚合层", detail: "ACP/UCP协议中间层" },
          { headline: "非英语区域化", detail: "日/印度/巴西/印尼" },
          { headline: "Memory原生搜索", detail: "记忆注入query改写层" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    // ≥4 structured findings now auto-select the "board" variant — each
    // finding renders as its own headline+detail card under a grid named
    // ".findings". Earlier the default was "memo" (single bullet list);
    // both treatments must preserve all 5 findings.
    const collected: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const headline = findRenderedByName(ast, `summary-many.exec.finding${i}.headline`) as { paragraphs?: Array<{ runs: Array<{ text?: string }> }> } | undefined;
      if (headline) collected.push(headline.paragraphs?.[0]?.runs.map((r) => r.text || "").join("") || "");
    }
    if (collected.length === 5) {
      expect(collected.join("|")).toContain("Memory原生搜索");
      return;
    }
    // Fallback: explicit memo variant (or any path that emits a single
    // bullet list under .findings) should still surface every entry.
    const findings = findRenderedByName(ast, "summary-many.exec.findings") as { paragraphs?: Array<{ runs: Array<{ text?: string }> }> } | undefined;
    const text = findings?.paragraphs?.map((p) => p.runs.map((r) => r.text || "").join("")).join("\n") || "";
    expect(findings?.paragraphs).toHaveLength(5);
    expect(text).toContain("Memory原生搜索");
  });

  it("repairs mildly tight bullet lists with measured pre-shrink instead of blocking", () => {
    const slide: SlideV2 = {
      id: "tight-bullets",
      children: [{
        id: "tight-bullets.list",
        type: "bullets",
        fixedHeight: 2.16,
        items: [
          "垂直证据型 search: 金融/医疗/保险，客单价$30K MRR",
          "多模态 search: Visual/Video for agents，18个月内必有$50M ARR玩家",
          "Commerce 聚合层: ACP/UCP协议中间层，Plaid模式",
          "非英语区域化: 日/印度/巴西/印尼，白纸市场",
        ],
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const diagnostics = getRenderDiagnostics().filter((d) => d.nodeId === "tight-bullets.list");
    expect(diagnostics.some((d) => d.code === "FALLBACK_FAILED" && d.severity === "error")).toBe(false);
    const repair = diagnostics.find((d) => d.code === "TRUNCATED" && d.severity === "warn");
    expect(repair?.measured?.fitMethod).toBe("pre-shrink");
    expect(repair?.measured?.finalFontSize).toBeGreaterThanOrEqual(7.5);
  });

  it("reports mixed CJK/English table rows that need more height than assigned", () => {
    const slide: SlideV2 = {
      id: "tight-table",
      children: [{
        id: "tight-table.table",
        type: "table",
        fixedHeight: 3.77,
        headers: ["场景", "数据", "含义"],
        rows: [
          ["Anthropic多agent", "~15x tokens vs 单agent", "1 lead + 3-5 subagent，每个并行调用3+工具"],
          ["Manus Wide Research", "单任务100+并行agent", "每个agent独立检索，调用量指数级增长"],
          ["You.com Research API", "1000+推理回合", "单次$15，1000万token"],
          ["Cloudflare数据", "ClaudeBot每referral抓取23,951页", "crawler:human从2:1到'tens of thousands to one'"],
          ["Vision agent", "比API agent多用45x tokens", "多模态带来更大搜索需求"],
        ],
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const failures = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED" && d.nodeId === "tight-table.table");
    expect(failures.map((d) => d.message).join("\n")).toContain("row");
  });

  it("auto-fits dense one-line comparison tables before escalating to hard failure", () => {
    const slide: SlideV2 = {
      id: "dense-table",
      children: [{
        id: "dense-table.table",
        type: "table",
        fixedHeight: 5.15,
        headers: ["公司", "融资", "ARR", "定价", "核心差异化", "评级"],
        rows: [
          ["Reducto", "$108M", "未披露", "$0.015/页", "CV+VLM ParseBench", "★★★★"],
          ["LlamaParse", "$27.5M", "未披露", "$0.00125-0.11/页", "OSS引流 Agentic", "★★★"],
          ["Unstructured.io", "$68M", "$7.7M", "开源+付费", "Down round $200M", "避开"],
          ["Mistral OCR", "N/A", "N/A", "$2/1000页", "价格杀手 win rate", "商品化拐点"],
          ["Extend", "$17M", "增长中", "全栈定价", "自研LLM+工作流", "★★★★"],
          ["Veryfi", "$32M", "$20-30M", "$0.01/页", "金融垂直合规", "★★★"],
        ],
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const failures = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED" && d.nodeId === "dense-table.table");
    const repaired = getRenderDiagnostics().filter((d) => d.code === "TRUNCATED" && d.nodeId === "dense-table.table");
    expect(failures).toHaveLength(0);
    expect(repaired.map((d) => d.message).join("\n")).toContain("font scaled");
  });

  it("numbered-grid keeps 3-up long body text readable instead of shrinking to caption size", () => {
    const slide: SlideV2 = {
      id: "numbered-readable",
      title: "创业窗口与投资判断",
      children: [{
        id: "windows",
        type: "numbered-grid",
        columns: 3,
        items: [
          { title: "EU 主权云版 Browserbase", body: "EU AWS Sovereign Cloud €7.8B + GDPR；与 OVHcloud/Scaleway 合作，切入德/法 fintech/医疗政府场景" },
          { title: "亚洲本地基建（日/印）", body: "日本无本地 Browserbase，金融/医疗/政府 Agent 化空白；印度 UPI/Aadhaar Agent 化" },
          { title: "垂直专用 Agent Browser", body: "金融/医疗/游戏，可审计 replay + HIPAA BAA 等垂直合规，Anchor 已做金融" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const body = findRenderedByName(ast, "numbered-readable.windows.0.body") as { paragraphs?: Array<{ runs: Array<{ sizeHalfPt?: number }> }> } | undefined;
    expect(body?.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt).toBeGreaterThanOrEqual(20);
    const severeShrink = getRenderDiagnostics().filter((d) => d.code === "TRUNCATED" && d.severity === "error" && /windows\.\d+\.body/.test(String(d.nodeId || "")));
    expect(severeShrink, severeShrink.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("fact-list strip gives long facts enough height for readable text", () => {
    const slide: SlideV2 = {
      id: "fact-strip-readable",
      title: "投资判断",
      children: [{
        id: "invest",
        type: "fact-list",
        variant: "strip",
        items: [
          { label: "最该跟踪", fact: "Browser Use（86k stars，下一轮 $300-500M）、Anchor Browser（8200 团队）、Steel.dev（欧洲自托管）" },
          { label: "18 个月格局", fact: "Browserbase 走向 IPO（2027 末估值 $1.5-2.5B），开源派分化，法律风险压制激进打法，合规玩家受益" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const fact = findRenderedByName(ast, "fact-strip-readable.invest.1.fact") as { paragraphs?: Array<{ runs: Array<{ sizeHalfPt?: number }> }> } | undefined;
    expect(fact?.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt).toBeGreaterThanOrEqual(19);
  });

  it("stat-strip separators stay centered on the stat text block when parent height grows", () => {
    const slide: SlideV2 = {
      id: "stat-align",
      children: [{
        id: "wrap",
        type: "stack",
        direction: "vertical",
        fixedHeight: 5,
        children: [{
          id: "stats",
          type: "stat-strip",
          items: [
            { value: "3", label: "核心赛道" },
            { value: "$300M+", label: "头部估值" },
            { value: "2026-2027", label: "黄金窗口" },
          ],
        }],
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const value = findRenderedByName(ast, "stat-align.stats.1.value") as { xfrm?: { y: number; cy: number } } | undefined;
    const label = findRenderedByName(ast, "stat-align.stats.1.label") as { xfrm?: { y: number; cy: number } } | undefined;
    const sep = findRenderedByName(ast, "stat-align.stats.sep1") as { xfrm?: { y: number; cy: number } } | undefined;
    expect(value?.xfrm && label?.xfrm && sep?.xfrm).toBeTruthy();
    const textCenter = (value!.xfrm!.y + label!.xfrm!.y + label!.xfrm!.cy) / 2;
    const sepCenter = sep!.xfrm!.y + sep!.xfrm!.cy / 2;
    expect(Math.abs(textCenter - sepCenter) / 360000).toBeLessThan(0.25);
  });

  it("comparison-list basis becomes a readable statement when no separate title is present", () => {
    const slide: SlideV2 = {
      id: "comparison",
      children: [{
        id: "comparison.list",
        type: "comparison-list",
        basis: "内饰战略从「效率」转向「豪华」",
        items: [
          { title: "过去", body: "效率优先" },
          { title: "未来", body: "豪华升级" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const basis = findRenderedByName(ast, "comparison.list.basis") as { paragraphs?: Array<{ runs: Array<{ sizeHalfPt?: number }> }> } | undefined;
    expect(basis?.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt).toBeGreaterThanOrEqual(26);
  });

  it("label component with tone:'neutral' resolves to a real color (no UNKNOWN_COLOR)", () => {
    const slide: SlideV2 = {
      id: "reg-label-tone",
      children: [{ id: "reg-label-tone.l", type: "label", text: "标签", tone: "neutral" } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const unknownColor = getRenderDiagnostics().filter((d) => d.code === "UNKNOWN_COLOR" && /neutral/i.test(d.message));
    expect(unknownColor, unknownColor.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("numbered-list accepts structured title/body items without rendering [object Object]", () => {
    const slide: SlideV2 = {
      id: "numbered-objects",
      title: "Agent 时代的本质判断",
      children: [{
        id: "judgments",
        type: "numbered-list",
        density: "compact",
        items: [
          { number: "01", title: "Coding agent 是入口", body: "office 是真正的目标市场" },
          { number: "02", title: "模型方 reverse acquisition", body: "入口变成 Claude，不是 SaaS" },
          { number: "03", title: "垂直合规深化", body: "行业 workflow 和真实世界 action 是护城河" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    const validation = validateDeck(buildDeckWithSlide(slide));
    expect(validation.errors, JSON.stringify(validation.errors, null, 2)).toHaveLength(0);
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    expect(firstTextShapeContaining(ast, "[object Object]")).toBeUndefined();
    expect(firstTextShapeContaining(ast, "Coding agent 是入口")).toBeDefined();
    expect(firstTextShapeContaining(ast, "office 是真正的目标市场")).toBeDefined();
  });

  it("table-card keeps a realistic 7-row business red-flag table renderable", () => {
    const slide: SlideV2 = {
      id: "dense-table-card",
      title: "第四档：不推荐方向",
      children: [{
        id: "r3.table",
        type: "table-card",
        title: "避开的方向（红灯区）",
        headers: ["方向", "评级", "原因"],
        rows: [
          ["横向通用 office Agent（中国版 Glean）", "★★", "钉钉/飞书已封顶"],
          ["横向客服 Agent（中国版 Decagon）", "★", "大厂免费 + 容联七陌占 53%"],
          ["个人 EA / AI 助理（中国版 Lindy）", "★★", "被 Kimi/豆包封顶"],
          ["通用 IDP / OCR API", "★★", "Mistral OCR $2/1000 页商品化"],
          ["多模型 Router 独立产品", "不是产品", "是 feature 不是产品，OpenRouter ~$30M ARR 封顶"],
          ["Agent infra 独立 SaaS（中国境内）", "不成立", "巨头垂直集成，参考 15 年规律"],
          ["被监管打回的先国内后出海", "已死", "Manus 红线（2026-04-27 发改委叫停）"],
        ],
        insight: "不做通用、不做基建 SaaS、不做横向",
        caption: "来源：综合调研 + 关键修正",
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const failures = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED" && d.nodeId === "dense-table-card.r3.table.table");
    expect(failures, failures.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("timeline with 8 simple events uses a compact grid timeline without blocking diagnostics", () => {
    const slide: SlideV2 = {
      id: "timeline-8",
      title: "关键里程碑时间线（2024-2026）",
      children: [{
        id: "tl.timeline",
        type: "timeline",
        direction: "vertical",
        items: [
          { time: "2024-Q3", body: "Tavily Series A $20M" },
          { time: "2024-Q4", body: "Anthropic Computer Use 发布" },
          { time: "2025-Q1", body: "Anthropic web_search API 上线" },
          { time: "2025-Q3", body: "Exa $85M · You.com $100M" },
          { time: "2025-Q4", body: "Cohere 案判决 · Coze 开源" },
          { time: "2026-Q1", body: "Tavily 被 $400M 收购 · 智谱 IPO" },
          { time: "2026-Q2", body: "Reducto B 轮 $75M · Anthropic Memory" },
          { time: "2026-04-27", body: "Manus 红线：发改委叫停 Meta 收购" },
        ],
      } as unknown as SlideV2["children"][number]],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const blocking = getRenderDiagnostics().filter((d) => BLOCKING_CODES.has(d.code) && d.severity !== "info");
    expect(blocking, blocking.map((d) => `${d.code} ${d.nodeId}: ${d.message}`).join("\n")).toHaveLength(0);
  });

  it("normalizes common authoring aliases without blocking component use", () => {
    const slide: SlideV2 = {
      id: "authoring-aliases",
      children: [
        {
          id: "authoring-aliases.columns",
          type: "two-column",
          ratio: 55,
          left: { children: [{ id: "authoring-aliases.left.title", type: "caption", text: "北朝民歌" }] },
          right: { children: [{ id: "authoring-aliases.right.body", type: "text", style: "paragraph", text: "天似穹庐，笼盖四野。" }] },
        } as unknown as DomNode,
      ],
    };
    const deck = buildDeckWithSlide(slide);
    const validation = validateDeck(deck);
    expect(validation.errors, JSON.stringify(validation.errors, null, 2)).toHaveLength(0);
    expect(validation.warnings.some((item) => item.code === "TEXT_STYLE_TYPE_ALIAS_NORMALIZED")).toBe(true);

    const rendered = sourceToRenderedDeck(deck);
    const columns = findDomNode(rendered.slides[0].dom, "authoring-aliases.columns");
    const left = columns?.left as DomNode | undefined;
    const caption = left?.children?.[0];
    expect(columns?.ratio).toEqual([55, 45]);
    expect(caption?.type).toBe("text");
    expect(caption?.style).toBe("caption");
  });

  it("does not treat cover-composition full-bleed visual/scrim as top-level content overlap", () => {
    const slide: SlideV2 = {
      id: "cover-overlap",
      children: [
        {
          id: "cover-overlap.cover",
          type: "cover-composition",
          title: "敕勒川",
          subtitle: "阴山下的草原史诗",
          tone: "inverse",
          visual: { src: TINY_PNG, fillSlide: true, scrimOpacity: 0.35 },
        } as unknown as DomNode,
        {
          id: "cover-overlap.caption",
          type: "caption",
          text: "国家地理风格 · 开篇页",
          at: [24.8, 17.4, 7.2, 0.5],
        } as unknown as DomNode,
      ],
    };
    const validation = validateDeck(buildDeckWithSlide(slide));
    const topLevelOverlaps = [...validation.errors, ...validation.warnings].filter((item) => item.code === "TOP_LEVEL_LAYOUT_OVERLAP");
    expect(topLevelOverlaps, JSON.stringify(topLevelOverlaps, null, 2)).toHaveLength(0);
  });

  it("honors themeOverride text colors before contrast repair", () => {
    const deck = {
      ...buildDeckWithSlide({
        id: "theme-text-color",
        background: { fill: "111827" },
        children: [{
          id: "theme-text-color.title",
          type: "text",
          style: "slide-title",
          text: "风吹草低见牛羊",
          at: [1.2, 1.2, 20, 1.4],
        } as unknown as DomNode],
      }),
      deck: {
        ...baseDeck.deck,
        themeOverride: {
          text: {
            "slide-title": { color: "F5F0E8" },
            paragraph: { color: "E5E7EB" },
          },
        },
      },
    } as Slideml2SourceDeck;
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck));
    expect(findRunColor(ast, "theme-text-color.title")).toBe("F5F0E8");
    const titleContrastRepairs = getRenderDiagnostics().filter((d) =>
      d.code === "LOW_CONTRAST_FIXED" && d.nodeId === "theme-text-color.title"
    );
    expect(titleContrastRepairs, JSON.stringify(titleContrastRepairs, null, 2)).toHaveLength(0);
  });

  it("renders primitive card.body instead of silently dropping it", () => {
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide({
      id: "card-body",
      children: [{
        id: "card-body.item",
        type: "card",
        title: "空间即视角",
        body: "川→山→天→野，镜头由近及远",
        fixedHeight: 3.2,
      } as unknown as DomNode],
    })));
    expect(firstTextShapeContaining(ast, "空间即视角")).toBeTruthy();
    expect(firstTextShapeContaining(ast, "川→山→天→野")).toBeTruthy();
    const parentChildCollisions = getRenderDiagnostics().filter((d) =>
      (d.code === "COLLISION" || d.code === "SIBLING_INK_OVERLAP")
      && d.nodeId === "card-body.item"
      && d.measured?.other?.nodeId === "card-body.item.body"
    );
    expect(parentChildCollisions, JSON.stringify(parentChildCollisions, null, 2)).toHaveLength(0);
  });
});
