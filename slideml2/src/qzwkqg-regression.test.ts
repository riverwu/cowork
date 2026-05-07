import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
  type LayoutDiagnostic,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { validateDeck, validateSlide } from "./validate.js";
import { buildTheme, color, flattenColorOverrides, parseGradientExpression, resolveFill } from "./theme.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Regressions for the agent-friendliness gaps surfaced by the qzwkqg debug log.
 * Each test pins one expectation: themeOverride.colors nested form works,
 * gradients render, CSS named colors resolve, "#hex" works, h1 counts as a
 * hero title, FALLBACK_FAILED carries the constraining ancestor, etc.
 */

const baseDeck = { deck: { size: "16x9" as const, theme: "default", brand: { primary: "8B6914" } } };

function deckWith(slides: SlideV2[], themeOverride?: Slideml2SourceDeck["deck"]["themeOverride"]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { name: "Test", primary: "8B6914" }, themeOverride },
    slides,
  };
}

function blockingAfterRender(deck: Slideml2SourceDeck): LayoutDiagnostic[] {
  clearRenderDiagnostics();
  renderToAst(sourceToRenderedDeck(deck));
  const blocking: ReadonlySet<LayoutDiagnostic["code"]> = new Set([
    "FALLBACK_FAILED",
    "COLLISION",
    "TINY_RECT",
    "SQUASHED",
    "LOW_CONTRAST",
    "UNKNOWN_COLOR",
    "UNKNOWN_STYLE",
  ]);
  return getRenderDiagnostics().filter((d) => blocking.has(d.code) && d.severity !== "info");
}

describe("themeOverride.colors flattening (P0)", () => {
  it("flattens nested {brand:{primary}} into {brand.primary}", () => {
    const flat = flattenColorOverrides({ brand: { primary: "8B6914", secondary: "CD853F" }, text: { muted: "7A7A7A" } });
    expect(flat).toMatchObject({ "brand.primary": "8B6914", "brand.secondary": "CD853F", "text.muted": "7A7A7A" });
  });

  it("strips '#' prefix and accepts 3-char hex shorthand on flatten", () => {
    const flat = flattenColorOverrides({ surface: "#FFF", "text.primary": "#1A1A1A" });
    expect(flat["surface"]).toBe("FFFFFF");
    expect(flat["text.primary"]).toBe("1A1A1A");
  });

  it("validate emits info when nested form is used (no error)", () => {
    const deck = deckWith([], { colors: { brand: { primary: "8B6914" }, text: { primary: "1A1A1A" } } as any });
    const report = validateDeck(deck);
    expect(report.errors).toHaveLength(0);
    expect(report.info.find((i) => i.code === "THEME_COLORS_NESTED_FLATTENED")).toBeDefined();
  });

  it("renders cleanly with nested themeOverride.colors (regression for the qzwkqg crash)", () => {
    const deck = deckWith([{
      id: "rg-nested",
      title: "Nested theme",
      children: [{ id: "rg-nested.t", type: "text", text: "Body", style: "paragraph", color: "text.primary" } as DomNode],
    }], {
      colors: {
        brand: { primary: "8B6914", secondary: "CD853F" },
        text: { primary: "1A1A1A", secondary: "4A4A4A", muted: "5A5A5A" },
      } as any,
    });
    const blocking = blockingAfterRender(deck);
    expect(blocking, blocking.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("auto-fixes themeOverride text.muted metric labels on light surfaces", () => {
    const slide: SlideV2 = {
      id: "rg-muted-metric",
      children: [{
        id: "rg-muted-metric.grid",
        type: "kpi-grid",
        metrics: [
          { value: "10%", label: "印刷术前欧洲识字率" },
          { value: "70%", label: "今日全球识字率" },
        ],
      } as unknown as DomNode],
    };
    const blocking = blockingAfterRender(deckWith([slide], {
      colors: {
        surface: "F7FAFC",
        text: { primary: "1A202C", muted: "718096" },
      } as any,
    }));
    expect(blocking.filter((d) => d.code === "LOW_CONTRAST"), blocking.map((d) => d.message).join("\n")).toHaveLength(0);
  });
});

describe("validation robustness for agent-authored ids", () => {
  it("reports missing text ids without throwing during text kind inference", () => {
    const slide: SlideV2 = {
      id: "rg-missing-id",
      children: [
        { type: "text", text: "No id here" } as unknown as DomNode,
      ],
    };
    const report = validateSlide(slide);
    expect(report.errors.some((e) => e.code === "MISSING_NODE_ID")).toBe(true);
    expect(report.errors.some((e) => e.code === "MISSING_NODE_TYPE")).toBe(false);
  });
});

describe("color() defensive resolution (P0)", () => {
  it("returns a valid hex when given a non-string (does not throw)", () => {
    const theme = buildTheme({}, "default");
    const result = color(theme, { primary: "8B6914" } as unknown as string, "text.primary");
    expect(result).toMatch(/^[0-9A-F]{6}$/);
  });

  it("strips '#' from hex inputs", () => {
    const theme = buildTheme({}, "default");
    expect(color(theme, "#B8860B")).toBe("B8860B");
    expect(color(theme, "#fff")).toBe("FFFFFF");
  });

  it("resolves CSS named colors", () => {
    const theme = buildTheme({}, "default");
    expect(color(theme, "white")).toBe("FFFFFF");
    expect(color(theme, "black")).toBe("000000");
    expect(color(theme, "blue")).toBe("2563EB");
  });
});

describe("gradient parsing + rendering (P0)", () => {
  it("parses linear-gradient with degrees and three stops", () => {
    const theme = buildTheme({}, "default");
    const parsed = parseGradientExpression(theme, "linear-gradient(135deg, #1A1A1A 0%, #2C3E50 50%, #1E4D6B 100%)");
    expect(parsed).toBeDefined();
    expect(parsed!.kind).toBe("linear");
    expect(parsed!.angle).toBe(135);
    expect(parsed!.stops).toHaveLength(3);
    expect(parsed!.stops[0]!.color).toBe("1A1A1A");
    expect(parsed!.stops[2]!.position).toBe(100);
  });

  it("parses linear-gradient(to right, token1, token2)", () => {
    const theme = buildTheme({ primary: "2563EB" }, "default");
    const parsed = parseGradientExpression(theme, "linear-gradient(to right, brand.primary, brand.primary.tint)");
    expect(parsed).toBeDefined();
    expect(parsed!.angle).toBe(90);
    expect(parsed!.stops).toHaveLength(2);
    // stops[0] should resolve to the brand primary hex
    expect(parsed!.stops[0]!.color).toBe("2563EB");
  });

  it("parses radial-gradient", () => {
    const theme = buildTheme({}, "default");
    const parsed = parseGradientExpression(theme, "radial-gradient(circle at center, FFFFFF 0%, 000000 100%)");
    expect(parsed).toBeDefined();
    expect(parsed!.kind).toBe("radial");
    expect(parsed!.stops).toHaveLength(2);
  });

  it("resolveFill returns a gradient FillSpec for gradient strings", () => {
    const theme = buildTheme({}, "default");
    const fill = resolveFill(theme, "linear-gradient(135deg, #1A1A1A 0%, #2C3E50 100%)", "background");
    expect(fill.type).toBe("gradient");
  });

  it("resolveFill falls back to solid for unknown gradient syntax (no crash)", () => {
    const theme = buildTheme({}, "default");
    const fill = resolveFill(theme, "linear-gradient(does-not-parse)", "background");
    expect(fill.type).toBe("solid");
  });

  it("slide.background.fill linear-gradient renders without LOW_CONTRAST issues for inverse text", () => {
    const slide: SlideV2 = {
      id: "rg-grad",
      background: { fill: "linear-gradient(135deg, #1A1A1A 0%, #2C3E50 50%, #1E4D6B 100%)" } as unknown as SlideV2["background"],
      children: [{ id: "rg-grad.t", type: "text", text: "白色标题", style: "deck-title", color: "text.inverse" } as DomNode],
    };
    const blocking = blockingAfterRender(deckWith([slide]));
    expect(blocking, blocking.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("slide.background {type:'solid', color} renders without UNKNOWN_COLOR", () => {
    const slide: SlideV2 = {
      id: "rg-solid-bg",
      background: { type: "solid", color: "#6366F1" } as unknown as SlideV2["background"],
      children: [{ id: "rg-solid-bg.t", type: "text", text: "白色标题", style: "deck-title", color: "text.inverse" } as DomNode],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deckWith([slide])));
    expect(ast.slides[0]!.background).toEqual({ type: "solid", color: "6366F1" });
    expect(getRenderDiagnostics().filter((d) => d.code === "UNKNOWN_COLOR")).toHaveLength(0);
  });
});

describe("constrainedBy ancestor surfacing (P1)", () => {
  it("FALLBACK_FAILED on a stack inside a fixedHeight panel includes the ancestor in constrainedBy", () => {
    const slide: SlideV2 = {
      id: "rg-fixed",
      children: [{
        id: "rg-fixed.panel",
        type: "panel",
        tone: "tinted",
        fixedHeight: 1.6,
        children: [{
          id: "rg-fixed.panel.body",
          type: "stack",
          direction: "vertical",
          gap: 0.3,
          children: [
            { id: "rg-fixed.panel.body.t1", type: "text", text: "标题占两行的较长文本", style: "card-title" },
            { id: "rg-fixed.panel.body.t2", type: "text", text: "其它说明也是较长的解释段落", style: "paragraph" },
            { id: "rg-fixed.panel.body.t3", type: "text", text: "再多一行说明就肯定装不下了", style: "paragraph" },
          ],
        } as DomNode],
      } as unknown as DomNode],
    };
    const diags = (() => {
      clearRenderDiagnostics();
      renderToAst(sourceToRenderedDeck(deckWith([slide])));
      return getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED");
    })();
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const hit = diags.find((d) => d.constrainedBy?.ancestorId === "rg-fixed.panel");
    expect(hit, JSON.stringify(diags.map((d) => ({ id: d.nodeId, c: d.constrainedBy }))) ).toBeDefined();
    expect(hit!.constrainedBy!.prop).toBe("fixedHeight");
    expect(hit!.constrainedBy!.value).toBe(1.6);
    expect(hit!.suggestion).toMatch(/rg-fixed\.panel\.fixedHeight/);
  });
});

describe("table row fitting diagnostics", () => {
  it("allocates table row height by content instead of equal rows when total height is enough", () => {
    const slide: SlideV2 = {
      id: "rg-table-fit",
      children: [{
        id: "rg-table-fit.table",
        type: "table",
        headers: ["持有者", "论点", "评估结论"],
        rows: [
          ["李飞飞", "AI熟练度>好文凭", "混淆使用与创新，名校仍是主要筛选标准"],
          ["马斯克", "医学院没意义", "过度简化，医疗包含AI难以替代的维度"],
          ["黄仁勋", "不需要CS博士", "言行矛盾——英伟达仍优先招募顶尖人才"],
        ],
      } as DomNode],
    };
    const blocking = blockingAfterRender(deckWith([slide]));
    expect(blocking.filter((d) => d.nodeId === "rg-table-fit.table"), blocking.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("keeps slideId on table fallback diagnostics emitted during render", () => {
    const slide: SlideV2 = {
      id: "rg-table-fail",
      children: [{
        id: "rg-table-fail.table",
        type: "table",
        fixedHeight: 1.2,
        headers: ["列A", "列B"],
        rows: [
          ["很长的单元格文本很长的单元格文本很长的单元格文本很长的单元格文本", "同样很长的说明文字同样很长的说明文字同样很长的说明文字"],
          ["短", "短"],
        ],
      } as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deckWith([slide])));
    const hit = getRenderDiagnostics().find((d) => d.code === "FALLBACK_FAILED" && d.nodeId === "rg-table-fail.table");
    expect(hit).toBeDefined();
    expect(hit!.slideId).toBe("rg-table-fail");
  });
});

describe("process-flow auto-orient + minHeight (P1)", () => {
  it("renders cleanly with 4 steps in a narrow right column (no SQUASHED)", () => {
    const slide: SlideV2 = {
      id: "rg-flow",
      children: [{
        id: "rg-flow.split",
        type: "split",
        direction: "horizontal",
        ratio: [0.7, 0.3],
        gap: 0.4,
        area: "content",
        children: [
          { id: "rg-flow.split.left", type: "text", text: "左侧主图区域占大头", style: "paragraph" } as DomNode,
          {
            id: "rg-flow.split.right",
            type: "process-flow",
            steps: [
              { title: "春秋争霸", body: "" },
              { title: "百家争鸣", body: "" },
              { title: "秦汉统一", body: "" },
              { title: "丝路开通", body: "" },
            ],
          } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    };
    const blocking = blockingAfterRender(deckWith([slide]));
    expect(blocking.filter((d) => d.code === "SQUASHED"), blocking.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("vertical timeline with 4 items: step container constraint is named in the diagnostic", () => {
    const slide: SlideV2 = {
      id: "rg-timeline",
      children: [{
        id: "rg-timeline.t",
        type: "timeline",
        direction: "vertical",
        items: [
          { time: "9000年前", title: "裴李岗文化", body: "早期农耕聚落" },
          { time: "5000年前", title: "仰韶文化", body: "彩陶文化，粟作农业" },
          { time: "4000年前", title: "龙山文化", body: "城址出现，铜器使用" },
          { time: "4000年前", title: "夏王朝", body: "中国进入文明时代" },
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    expect(() => renderToAst(sourceToRenderedDeck(deckWith([slide])))).not.toThrow();
    // The crucial change: titles no longer have a fixedHeight that was
    // absolutely too tall, so the step container's intrinsic title size now
    // shrinks via autoFit instead of demanding a full 0.58cm before the body.
    // We allow DROPs (synthetic content area is tight) but the slide must at
    // least render without aborting, and individual steps' title heights must
    // be flexible.
    const time = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED" && d.constrainedBy);
    // Either no FALLBACK_FAILED, or the failed ones are explicit about which
    // ancestor constrained them.
    if (time.length > 0) expect(time[0]!.suggestion).toMatch(/Drop or raise/);
  });
});

describe("timeline component (qzwkqg s3) renders cleanly", () => {
  it("vertical 4-item timeline with bodies under the qzwkqg themeOverride: 0 FALLBACK_FAILED, 0 DROP", () => {
    const deck = {
      slideml2: 2 as const,
      deck: {
        size: "16x9" as const,
        theme: "default",
        brand: { name: "中华文明", primary: "8B6914" },
        themeOverride: {
          colors: {
            // The exact nested form the agent wrote in qzwkqg.
            brand: { primary: "8B6914", secondary: "CD853F" },
            background: "F5F0E1",
            surface: "FFFFFF",
            text: { primary: "2C2C2C", secondary: "555555", muted: "888888" },
          } as any,
          text: {
            "slide-title": { fontSize: 36, fontWeight: "bold", color: "text.primary" } as any,
            paragraph: { fontSize: 16, lineHeight: 1.5, color: "text.secondary" },
          },
          layout: { pageMarginX: 0.6, titleTop: 0.5, contentTop: 1.32, contentBottom: 7.54, defaultGap: 0.3 },
        },
      },
      slides: [{
        id: "s3",
        title: "黄河文明发展脉络",
        children: [{
          id: "s3.timeline",
          type: "timeline" as const,
          direction: "vertical",
          items: [
            { date: "约9000年前", title: "裴李岗文化", body: "早期农耕聚落" },
            { date: "约5000年前", title: "仰韶文化", body: "彩陶文化，粟作农业" },
            { date: "约4000年前", title: "龙山文化", body: "城址出现，铜器使用" },
            { date: "约4000年前", title: "夏王朝", body: "中国进入文明时代" },
          ],
        } as any],
      }],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck as Slideml2SourceDeck));
    const diags = getRenderDiagnostics();
    const fallback = diags.filter((d) => d.code === "FALLBACK_FAILED");
    const drops = diags.filter((d) => d.code === "DROP");
    expect(fallback, fallback.map((d) => d.message).join("\n")).toHaveLength(0);
    expect(drops, drops.map((d) => d.message).join("\n")).toHaveLength(0);
  });
});

describe("composite components: dense-row + chrome+padding audit", () => {
  /**
   * Regression for the qzwkqg timeline-step bug: when a factory returns a
   * chromeless flow group (plain stack/grid with a role marker) AND the role
   * has theme.component[role].fill+line (which makes the renderer paint a
   * card frame around every instance), AND the role is used in a high-density
   * vertical layout (timeline / step list), the combined chrome + padding
   * silently steals enough inner height to make the layout impossible.
   *
   * This test exercises every composite component that the registry knows how
   * to expand, instantiates 4 of them in a tight vertical column inside a
   * narrow grid cell, and asserts the layout doesn't catastrophically fail
   * with FALLBACK_FAILED.
   */
  const denseRolesToCheck = [
    { type: "timeline", buildItems: () => Array.from({ length: 4 }, (_, i) => ({ time: `T${i}`, title: `项目${i + 1}`, body: `简短说明${i + 1}` })), props: { direction: "vertical" } },
    { type: "process-flow", buildItems: () => Array.from({ length: 4 }, (_, i) => ({ title: `步骤${i + 1}`, body: `做${i + 1}件事` })), props: { direction: "vertical" } },
    { type: "checklist", buildItems: () => Array.from({ length: 5 }, (_, i) => ({ text: `检查项 ${i + 1}`, status: i % 2 === 0 ? "checked" : "unchecked" })), props: {} },
    { type: "bar-list", buildItems: () => Array.from({ length: 5 }, (_, i) => ({ label: `项目 ${i + 1}`, value: (i + 1) * 15 })), props: {} },
    { type: "numbered-list", buildItems: () => Array.from({ length: 5 }, (_, i) => `要点 ${i + 1}`), props: {} },
  ];

  for (const spec of denseRolesToCheck) {
    it(`${spec.type} renders 4-5 items vertically without FALLBACK_FAILED`, () => {
      const itemKey = spec.type === "timeline" || spec.type === "process-flow" ? (spec.type === "timeline" ? "items" : "steps") : "items";
      const slide: SlideV2 = {
        id: `audit-${spec.type}`,
        title: "Density audit",
        children: [{
          id: `audit-${spec.type}.body`,
          type: spec.type as DomNode["type"],
          ...(spec.props as Record<string, unknown>),
          [itemKey]: spec.buildItems(),
        } as unknown as DomNode],
      };
      clearRenderDiagnostics();
      renderToAst(sourceToRenderedDeck(deckWith([slide])));
      const fallback = getRenderDiagnostics().filter((d) => d.code === "FALLBACK_FAILED");
      expect(fallback, fallback.map((d) => d.message).join("\n")).toHaveLength(0);
    });
  }
});

describe("DUPLICATE_HERO_TITLE includes h1 / title-lockup / section-title (P2)", () => {
  it("flags slide.title + body h1 as duplicate", () => {
    const slide: SlideV2 = {
      id: "rg-dup-h1",
      title: "封面",
      children: [{ id: "rg-dup-h1.h", type: "h1", text: "正文封面" } as unknown as DomNode],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors.find((e) => e.code === "DUPLICATE_HERO_TITLE")).toBeDefined();
  });

  it("flags slide.title + section-title styled text as duplicate", () => {
    const slide: SlideV2 = {
      id: "rg-dup-section",
      title: "第一章",
      children: [{ id: "rg-dup-section.t", type: "text", text: "第二章", style: "section-title" } as DomNode],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors.find((e) => e.code === "DUPLICATE_HERO_TITLE")).toBeDefined();
  });

  it("allows slide.title to duplicate the body hero title as metadata", () => {
    const slide: SlideV2 = {
      id: "rg-dup-same-title",
      title: "封面",
      children: [{ id: "rg-dup-same-title.h", type: "h1", text: "封面" } as unknown as DomNode],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors.find((e) => e.code === "DUPLICATE_HERO_TITLE")).toBeUndefined();
  });
});
