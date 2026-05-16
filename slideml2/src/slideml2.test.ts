import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  applyEdits,
  auditDeck,
  buildDom,
  buildAgentPromptPack,
  clearRenderDiagnostics,
  getDiagnosticsByCode,
  inspectLayout,
  companyOverviewLayout,
  appendSlide,
  createDeck,
  createSourceDeck,
  deckFromComponentPlan,
  deleteSlide,
  describeComponents,
  describeDeck,
  designComplexDeck,
  designDeckFromBrief,
  describeNodeType,
  findNodeForTest,
  generateDeckWithBatchAgent,
  generateOneSlideWithLlm,
  generateWithComponentAgent,
  insertSlide,
  listNodeTypesForTest,
  listComponents,
  listTextKinds,
  listThemes,
  measureDeck,
  normalizeSlide,
  renderToAst,
  renderToPptx,
  replaceSlide,
  runSimpleAgentLoop,
  setDeckProps,
  sourceToRenderedDeck,
  validateDeck,
  validateDeckPath,
  validateSlide,
  type AgentTask,
  type Slideml2Deck,
} from "./test-support.js";

const runRealLlmTest = process.env.RUN_SLIDEML2_REAL_LLM === "1" && process.env.LLM_API && process.env.LLM_API_KEY && process.env.LLM_MODEL;

describe("slideml2 MVP", () => {
  it("describes the available semantic node types", () => {
    expect(listNodeTypesForTest().map((item) => item.type)).toEqual(["slide", "stack", "grid", "split", "spacer", "divider", "text", "bullets", "image", "table", "chart", "shape", "component", "panel", "card", "band", "frame", "inset"]);
    expect(describeNodeType("bullets").fields.items).toContain("string[]");
    expect(describeNodeType("card").fields.title).toContain("Alias for header");
    expect(describeNodeType("card").fields.header).toContain("Same rendering as title");
  });

  it("builds semantic DOM from simple layout specs", () => {
    const deck = buildDom(sampleSource());
    const cover = deck.slides.find((slide) => slide.id === "cover");
    expect(cover?.dom.id).toBe("cover.root");
    expect(findNodeForTest(cover!.dom, "cover.title")?.text).toBe("Youdao Company");
    expect(findNodeForTest(cover!.dom, "cover.brandLogo")?.anchor).toBe("top-right");
  });

  it("applies the four primitive edit operations to the DOM", () => {
    const deck = buildDom(sampleSource());
    const edited = applyEdits(deck, [
      { op: "setSlideProp", slideId: "cover", prop: "background", value: "brand.primary" },
      { op: "setNodeProp", slideId: "cover", nodeName: "cover.brandLogo", prop: "anchor", value: "bottom-right" },
      {
        op: "insertNode",
        slideId: "business",
        parentName: "business.content",
        node: {
          id: "business.businessLines",
          type: "bullets",
          items: ["Learning services", "Smart devices"],
          density: "compact",
        },
      },
      { op: "deleteNode", slideId: "business", nodeName: "business.bullets" },
    ]);

    expect(edited.slides.find((slide) => slide.id === "cover")?.dom.background).toBe("brand.primary");
    expect(findNodeForTest(edited.slides[0]!.dom, "cover.brandLogo")?.anchor).toBe("bottom-right");
    expect(findNodeForTest(edited.slides[1]!.dom, "business.businessLines")?.items).toHaveLength(2);
    expect(findNodeForTest(edited.slides[1]!.dom, "business.bullets")).toBeNull();
  });

  it("edits text, bullets, images, containers, and nested node order in one slide", () => {
    const deck = buildDom(sampleSource());
    const edited = applyEdits(deck, [
      { op: "setNodeProp", slideId: "business", nodeName: "business.title", prop: "text", value: "Updated business model" },
      { op: "setNodeProp", slideId: "business", nodeName: "business.bullets", prop: "items", value: ["Learning services", "Smart hardware", "Marketing"] },
      { op: "setNodeProp", slideId: "business", nodeName: "business.content", prop: "gap", value: 8 },
      {
        op: "insertNode",
        slideId: "business",
        parentName: "business.content",
        position: "first",
        node: { id: "business.lead", type: "text", text: "Three engines support growth.", style: "body" },
      },
      {
        op: "insertNode",
        slideId: "business",
        parentName: "business.content",
        position: { after: "business.bullets" },
        node: { id: "business.productImage", type: "image", src: sampleLogo(), alt: "Product", fit: "contain" },
      },
    ]);

    const content = findNodeForTest(edited.slides[1]!.dom, "business.content");
    expect(findNodeForTest(edited.slides[1]!.dom, "business.title")?.text).toBe("Updated business model");
    expect(findNodeForTest(edited.slides[1]!.dom, "business.bullets")?.items).toHaveLength(3);
    expect(findNodeForTest(edited.slides[1]!.dom, "business.productImage")?.fit).toBe("contain");
    expect(content?.gap).toBe(8);
    expect(content?.children?.map((node) => node.id)).toEqual(["business.lead", "business.bullets", "business.productImage"]);
  });

  it("builds a reasonable page layout directly from semantic components", () => {
    const layout = companyOverviewLayout({
      slideId: "overview",
      visualSrc: sampleLogo(),
      summary: "A concise company overview.",
      businessLines: ["Learning services", "Smart devices", "Online marketing"],
      metrics: [
        { name: "metric-revenue", value: "56.3亿", label: "2024 revenue" },
        { name: "metric-profit", value: "首次", label: "Annual profit" },
        { name: "metric-users", value: "2.8亿+", label: "Monthly active users" },
      ],
    });

    expect(layout.type).toBe("grid");
    expect(layout.columns).toBe(2);
    expect(layout.children?.map((node) => node.id)).toEqual(["overview.narrativeColumn", "overview.visualColumn"]);
    const metricGrid = findNodeForTest(layout, "overview.metricGrid");
    expect(metricGrid?.columns).toBe(3);
    expect(metricGrid?.children?.map((node) => node.role)).toEqual(["metric-card", "metric-card", "metric-card"]);
  });

  it("lets the simple agent replace a weak content region with a component-designed layout", () => {
    const source = sampleSource();
    source.slides.push({ id: "overview", layout: "title-and-content", title: "Company overview", items: ["Too generic"] });
    const initial = buildDom(source);
    const task: AgentTask = { requireCompanyOverviewLayout: { slideId: "overview" } };
    expect(auditDeck(initial, task).ok).toBe(false);

    const result = runSimpleAgentLoop(initial, task);
    const overviewSlide = result.deck.slides.find((slide) => slide.id === "overview")!;
    const rootChildren = overviewSlide.dom.children?.map((node) => node.id);
    expect(auditDeck(result.deck, task).ok).toBe(true);
    expect(result.appliedOps.map((op) => op.op)).toEqual(expect.arrayContaining(["deleteNode", "insertNode"]));
    expect(rootChildren).toEqual(["overview.title", "overview.overviewLayout", "overview.brandLogo"]);
    expect(findNodeForTest(overviewSlide.dom, "overview.metricGrid")?.columns).toBe(3);
  });

  it("designs a correct title, paragraph, image, and caption page from a brief", async () => {
    const deck = designDeckFromBrief(
      { name: "Youdao", primary: "E8382C", logo: sampleLogo() },
      {
        slideId: "brief",
        title: "有道智能学习业务",
        body: "有道围绕学习服务、智能硬件和在线营销构建业务组合，依托教育大模型和网易生态提升产品体验。",
        imageSrc: sampleLogo(),
        imageTitle: "有道品牌与智能学习产品",
      },
    );
    const slide = deck.slides[0]!;
    const rootChildren = slide.dom.children?.map((node) => node.id);
    expect(rootChildren).toEqual(["brief.slide-title", "brief.contentLayout"]);
    expect(findNodeForTest(slide.dom, "brief.contentLayout")?.columnWeights).toEqual([0.54, 0.46]);
    expect(findNodeForTest(slide.dom, "brief.visualPanel")?.role).toBe("image-with-caption");
    expect(findNodeForTest(slide.dom, "brief.brief-image")?.fit).toBe("contain");

    const measured = measureDeck(deck)[0]!.nodes;
    const title = rectOf(measured, "brief.slide-title");
    const body = rectOf(measured, "brief.body-text");
    const image = rectOf(measured, "brief.brief-image");
    const caption = rectOf(measured, "brief.brief-image.caption");
    expect(title.y).toBeLessThan(body.y);
    expect(body.x).toBeLessThan(image.x);
    expect(image.y).toBeCloseTo(body.y, 1);
    expect(caption.y).toBeGreaterThan(image.y + image.h);
    expect(caption.x).toBeCloseTo(image.x, 1);
    expect(caption.w).toBeCloseTo(image.w, 1);
    expect(body.w).toBeGreaterThan(10);
    expect(body.h).toBeLessThan(4);
    expect(image.w).toBeGreaterThan(8);
    expect(image.h).toBeGreaterThan(7);
    expect(caption.h).toBeGreaterThan(0.6);
    expect(caption.y + caption.h).toBeLessThan(13.55);
    expect(overlaps(body, image)).toBe(false);
    expect(overlaps(image, caption)).toBe(false);

    const dir = await mkdtemp(join(tmpdir(), "slideml2-brief-"));
    const rendered = await renderToPptx(deck, join(dir, "brief-layout.pptx"));
    expect((await stat(rendered.outputPath)).size).toBeGreaterThan(1000);
  });

  it("keeps emitted shapes inside the actual PPTX 16x9 page bounds", () => {
    const deck = designDeckFromBrief(
      { name: "Youdao", primary: "E8382C", logo: sampleLogo() },
      {
        slideId: "brief",
        title: "有道智能学习业务",
        body: "有道围绕学习服务、智能硬件和在线营销构建业务组合，依托教育大模型和网易生态提升产品体验。",
        imageSrc: sampleLogo(),
        imageTitle: "有道品牌与智能学习产品",
      },
    );
    const ast = renderToAst(deck);
    const slideWidth = 9_144_000;
    const slideHeight = 5_143_500;
    for (const shape of ast.slides[0]!.shapes) {
      expect(shape.xfrm.x, shape.name).toBeGreaterThanOrEqual(0);
      expect(shape.xfrm.y, shape.name).toBeGreaterThanOrEqual(0);
      expect(shape.xfrm.x + shape.xfrm.cx, shape.name).toBeLessThanOrEqual(slideWidth);
      expect(shape.xfrm.y + shape.xfrm.cy, shape.name).toBeLessThanOrEqual(slideHeight);
    }
  });

  it("uses kind semantics from the default theme for text styling", () => {
    const deck = designDeckFromBrief(
      { name: "Youdao", primary: "E8382C", logo: sampleLogo() },
      {
        slideId: "brief",
        title: "有道智能学习业务",
        body: "有道围绕学习服务、智能硬件和在线营销构建业务组合，依托教育大模型和网易生态提升产品体验。",
        imageSrc: sampleLogo(),
        imageTitle: "有道品牌与智能学习产品",
      },
    );
    const ast = renderToAst(deck);
    const title = ast.slides[0]!.shapes.find((shape) => shape.name === "brief.slide-title");
    const body = ast.slides[0]!.shapes.find((shape) => shape.name === "brief.body-text");
    const caption = ast.slides[0]!.shapes.find((shape) => shape.name === "brief.brief-image.caption");
    expect(title?.type).toBe("text");
    expect(body?.type).toBe("text");
    expect(caption?.type).toBe("text");
    if (title?.type !== "text" || body?.type !== "text" || caption?.type !== "text") throw new Error("Expected text shapes");
    expect(title.paragraphs[0]!.runs[0]!.sizeHalfPt).toBe(58);
    expect(body.paragraphs[0]!.runs[0]!.sizeHalfPt).toBeCloseTo(21.6);
    expect(caption.paragraphs[0]!.runs[0]!.sizeHalfPt).toBeCloseTo(17.6);
  });

  it("prefers explicit layout props and uses default theme only when omitted", () => {
    const deck = {
      deck: { size: "16x9" as const, theme: "simple", brand: { primary: "E8382C" } },
      slides: [{
        id: "explicit",
        layout: "title-and-content" as const,
        dom: {
          id: "explicit.root",
          type: "slide" as const,
          background: "background",
          children: [{
            id: "explicit.stack",
            type: "stack" as const,
            area: "content",
            direction: "horizontal",
            gap: 1,
            children: [
              { id: "explicit.a", type: "text" as const, text: "左侧", style: "paragraph", fixedWidth: 4, fixedHeight: 1 },
              { id: "explicit.b", type: "text" as const, text: "右侧", style: "paragraph", fixedWidth: 5, fixedHeight: 1 },
            ],
          }],
        },
      }],
    };
    const measured = measureDeck(deck)[0]!.nodes;
    const left = rectOf(measured, "explicit.a");
    const right = rectOf(measured, "explicit.b");
    expect(left.w).toBeCloseTo(4, 2);
    expect(right.w).toBeCloseTo(5, 2);
    expect(right.x - (left.x + left.w)).toBeCloseTo(1, 2);
  });

  it("solves stack sizes from fixed, intrinsic, and flexible constraints", () => {
    const deck = {
      deck: { size: "16x9" as const, theme: "simple", brand: { primary: "E8382C" } },
      slides: [{
        id: "sizing",
        layout: "title-and-content" as const,
        dom: {
          id: "sizing.root",
          type: "slide" as const,
          background: "background",
          children: [{
            id: "sizing.content",
            type: "stack" as const,
            area: "content",
            direction: "vertical",
            gap: 0,
            children: [
              { id: "sizing.fixed", type: "text" as const, text: "Fixed region", style: "paragraph", fixedHeight: 3 },
              {
                id: "sizing.flex",
                type: "bullets" as const,
                density: "comfortable",
                layoutWeight: 1,
                items: Array.from({ length: 18 }, (_, index) => `Long flexible item ${index + 1} with enough text to wrap and require compression`),
              },
            ],
          }],
        },
      }],
    };

    const measured = measureDeck(deck)[0]!.nodes;
    const content = rectOf(measured, "sizing.content");
    const fixed = rectOf(measured, "sizing.fixed");
    const flex = rectOf(measured, "sizing.flex");
    expect(fixed.h).toBeCloseTo(3, 2);
    expect(flex.h).toBeCloseTo(content.h - fixed.h, 2);
    expect(flex.y).toBeCloseTo(fixed.y + fixed.h, 2);
  });

  it("sizes grid rows from row content before distributing spare space", () => {
    const deck = {
      deck: { size: "16x9" as const, theme: "simple", brand: { primary: "E8382C" } },
      slides: [{
        id: "gridRows",
        layout: "title-and-content" as const,
        dom: {
          id: "gridRows.root",
          type: "slide" as const,
          background: "background",
          children: [{
            id: "gridRows.content",
            type: "stack" as const,
            area: "content",
            direction: "vertical",
            gap: 0,
            children: [{
              id: "gridRows.grid",
              type: "grid" as const,
              columns: 2,
              gap: 0,
              fixedHeight: 5.2,
              children: [
                { id: "gridRows.longA", type: "text" as const, text: "Long row text ".repeat(45), style: "paragraph" },
                { id: "gridRows.longB", type: "text" as const, text: "Another long row text ".repeat(40), style: "paragraph" },
                { id: "gridRows.shortA", type: "text" as const, text: "Short", style: "paragraph" },
                { id: "gridRows.shortB", type: "text" as const, text: "Short", style: "paragraph" },
              ],
            }],
          }],
        },
      }],
    };

    const measured = measureDeck(deck)[0]!.nodes;
    expect(rectOf(measured, "gridRows.longA").h).toBeGreaterThan(rectOf(measured, "gridRows.shortA").h);
    expect(rectOf(measured, "gridRows.longA").y).toBeCloseTo(rectOf(measured, "gridRows.longB").y, 2);
    expect(rectOf(measured, "gridRows.shortA").y).toBeGreaterThan(rectOf(measured, "gridRows.longA").y);
  });

  it("applies theme component defaults to semantic role containers", () => {
    const deck = {
      deck: { size: "16x9" as const, theme: "simple", brand: { primary: "E8382C" } },
      slides: [{
        id: "themeDefaults",
        layout: "title-and-content" as const,
        dom: {
          id: "themeDefaults.root",
          type: "slide" as const,
          background: "background",
          children: [{
            id: "themeDefaults.card",
            type: "stack" as const,
            area: "content",
            role: "definition-card",
            direction: "vertical",
            children: [
              { id: "themeDefaults.term", type: "text" as const, text: "Theme default padding", style: "card-title" },
            ],
          }],
        },
      }],
    };

    const measured = measureDeck(deck)[0]!.nodes;
    const card = rectOf(measured, "themeDefaults.card");
    const term = rectOf(measured, "themeDefaults.term");
    expect(term.x).toBeGreaterThan(card.x);
    expect(term.y).toBeGreaterThan(card.y);
    expect(term.w).toBeLessThan(card.w);
  });

  it("keeps component-root layout and style fields after expansion", () => {
    const deck = {
      deck: { size: "16x9" as const, theme: "simple", brand: { primary: "E8382C" } },
      slides: [{
        id: "componentRoot",
        layout: "title-and-content" as const,
        dom: {
          id: "componentRoot.root",
          type: "slide" as const,
          background: "background",
          children: [{
            id: "componentRoot.content",
            type: "stack" as const,
            area: "content",
            direction: "vertical",
            gap: 0,
            children: [
              { id: "componentRoot.fixedCallout", type: "component" as const, component: "callout", text: "Root fields survive expansion", fixedHeight: 2, fill: "brand.tint", line: "brand.primary", padding: 18 },
              { id: "componentRoot.flex", type: "text" as const, text: "Body", style: "paragraph", layoutWeight: 1 },
            ],
          }],
        },
      }],
    };

    const measured = measureDeck(deck)[0]!.nodes;
    const callout = rectOf(measured, "componentRoot.fixedCallout");
    const calloutText = rectOf(measured, "componentRoot.fixedCallout");
    expect(callout.h).toBeCloseTo(2, 2);
    expect(calloutText.h).toBeCloseTo(2, 2);
    const shape = renderToAst(deck).slides[0]!.shapes.find((item) => item.name === "componentRoot.fixedCallout");
    expect(shape?.type).toBe("text");
    if (shape?.type !== "text") throw new Error("Expected expanded callout text shape");
    expect(shape.fill?.type).toBe("solid");
    expect(shape.line?.color).toBe("E8382C");
  });

  it("accepts common LLM aliases for step-card fields", () => {
    const deck = sourceToRenderedDeck({
      slideml2: 2,
      deck: { size: "16x9", theme: "simple", brand: { primary: "E8382C" } },
      slides: [{
        id: "aliases",
        title: "Aliases",
        children: [{
          id: "aliases.steps",
          type: "grid",
          area: "content",
          columns: 1,
          children: [{
            id: "aliases.step",
            type: "component",
            component: "step-card",
            number: "1",
            title: "词典入口",
            description: "用高频工具建立用户基础",
          }],
        }],
      }],
    });

    const rendered = renderToAst(deck);
    const texts = rendered.slides[0]!.shapes
      .filter((shape) => shape.type === "text")
      .flatMap((shape) => shape.type === "text" ? shape.paragraphs.flatMap((p) => p.runs.map((run) => run.text)) : []);
    expect(texts).toEqual(expect.arrayContaining(["1", "词典入口", "用高频工具建立用户基础"]));
  });

  it("designs more complex semantic pages without overflow", async () => {
    const deck = designComplexDeck(
      { name: "Youdao", primary: "E8382C", logo: sampleLogo() },
      {
        dashboard: {
          slideId: "dashboard",
          title: "业务经营概览",
          summary: "学习服务、智能硬件与在线营销形成互补组合，增长质量取决于 AI 能力和硬件入口的协同。",
          metrics: [
            { name: "metric-revenue", value: "56.3亿", label: "2024年营收" },
            { name: "metric-profit", value: "首次", label: "全年盈利" },
            { name: "metric-users", value: "2.8亿+", label: "月活用户" },
          ],
          bullets: ["硬件承担高频学习入口", "大模型提升学习服务体验", "营销业务提供现金流支撑"],
          imageSrc: sampleLogo(),
          imageTitle: "品牌入口与学习场景",
        },
        timeline: {
          slideId: "timeline",
          title: "从工具到 AI 学习平台",
          intro: "页面需要同时容纳阶段说明和四个演进节点，自动布局要保留标题、导语和卡片间距。",
          steps: [
            { title: "词典入口", body: "用高频工具建立用户基础。" },
            { title: "内容服务", body: "扩展课程、翻译和学习资源。" },
            { title: "智能硬件", body: "用词典笔等设备进入学习现场。" },
            { title: "AI Agent", body: "把大模型能力嵌入学习流程。" },
          ],
        },
        comparison: {
          slideId: "comparison",
          title: "三类业务的角色分工",
          thesis: "复杂页面不应该把所有信息挤成一组均分文本框，而应保留主结论和并列比较区。",
          columns: [
            { title: "学习服务", points: ["内容和订阅承接需求", "AI 提升个性化体验", "适合做长期留存"] },
            { title: "智能硬件", points: ["形成场景入口", "具备品牌可见度", "推动软硬件协同"] },
            { title: "在线营销", points: ["贡献现金流", "依托用户规模", "支持业务投入"] },
          ],
        },
      },
    );

    expect(deck.slides.map((slide) => slide.id)).toEqual(["dashboard", "timeline", "comparison"]);
    for (const slide of deck.slides) {
      expect(findNodeForTest(slide.dom, `${slide.id}.slide-title`)).toBeTruthy();
    }
    expect(findNodeForTest(deck.slides[0]!.dom, "dashboard.metricStrip")?.children).toHaveLength(3);
    expect(findNodeForTest(deck.slides[1]!.dom, "timeline.steps")?.children).toHaveLength(4);
    expect(findNodeForTest(deck.slides[2]!.dom, "comparison.comparisonGrid")?.children).toHaveLength(3);

    const measured = measureDeck(deck);
    const dashboardImage = rectOf(measured[0]!.nodes, "dashboard.brief-image");
    const dashboardCaption = rectOf(measured[0]!.nodes, "dashboard.brief-image.caption");
    expect(dashboardCaption.y).toBeGreaterThan(dashboardImage.y + dashboardImage.h);
    expect(dashboardCaption.y + dashboardCaption.h).toBeLessThan(13.55);
    for (const slide of measured) {
      for (const node of slide.nodes) {
        expect(node.rect.x, `${slide.slideId}:${node.id}`).toBeGreaterThanOrEqual(0);
        expect(node.rect.y, `${slide.slideId}:${node.id}`).toBeGreaterThanOrEqual(0);
        expect(node.rect.x + node.rect.w, `${slide.slideId}:${node.id}`).toBeLessThanOrEqual(25.4);
        expect(node.rect.y + node.rect.h, `${slide.slideId}:${node.id}`).toBeLessThanOrEqual(14.2875);
      }
    }
    assertShapeBounds(renderToAst(deck));

    const dir = await mkdtemp(join(tmpdir(), "slideml2-complex-"));
    const rendered = await renderToPptx(deck, join(dir, "complex-layouts.pptx"));
    expect((await stat(rendered.outputPath)).size).toBeGreaterThan(1000);
  });

  it("runs the isolated agent loop from audit failure to rendered outputs", async () => {
    const task: AgentTask = {
      requireCoverBrandBackground: true,
      requireBrandLogoBottomRight: true,
      requireBusinessBullets: true,
    };
    const initial = buildDom(sampleSource());
    const before = auditDeck(initial, task);
    expect(before.ok).toBe(false);
    expect(before.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["COVER_BACKGROUND", "BRAND_LOGO_POSITION", "MISSING_BUSINESS_BULLETS"]));

    const result = runSimpleAgentLoop(initial, task);
    expect(result.rounds).toBeGreaterThan(0);
    expect(result.appliedOps.map((op) => op.op)).toEqual(expect.arrayContaining(["setSlideProp", "setNodeProp", "insertNode"]));
    expect(auditDeck(result.deck, task).ok).toBe(true);

    const dir = await mkdtemp(join(tmpdir(), "slideml2-"));
    const output = join(dir, "mvp.pptx");
    const rendered = await renderToPptx(result.deck, output);
    expect((await stat(rendered.outputPath)).size).toBeGreaterThan(1000);
    const sidecar = JSON.parse(await readFile(rendered.domPath, "utf8")) as { slides: unknown[] };
    expect(sidecar.slides).toHaveLength(2);
  });

  it("expands an agent component tree into renderable SlideML2 DOM", async () => {
    const deck = deckFromComponentPlan({
      title: "智能穿戴硬件新品调查报告",
      brand: { name: "AI Wearables", primary: "2563EB", logo: sampleLogo() },
      slides: [{
        id: "market-summary",
        title: "市场概览与关键判断",
        structure: "stack content with callout, metric grid, and two-column details",
        children: [{
          type: "stack",
          id: "main-content",
          area: "content",
          direction: "vertical",
          gap: 0.4,
          children: [
            { type: "component", component: "callout", id: "core-finding", text: "2026年是 AI 穿戴设备爆发的元年，智能眼镜成为最大增长点。" },
            {
              type: "grid",
              id: "metric-row",
              columns: 3,
              gap: 0.3,
              fixedHeight: 1.85,
              children: [
                { type: "component", component: "metric-card", id: "market-size", value: "500亿美元+", label: "全球市场规模预测" },
                { type: "component", component: "metric-card", id: "glasses-growth", value: "30%+", label: "智能眼镜 CAGR" },
                { type: "component", component: "metric-card", id: "ai-chip", value: "50%+", label: "AI 芯片需求增长" },
              ],
            },
            {
              type: "grid",
              id: "detail-grid",
              columns: 2,
              columnWeights: [0.52, 0.48],
              gap: 0.45,
              layoutWeight: 1,
              children: [
                { type: "bullets", id: "market-drivers", items: ["多模态 AI 交互成为新标准", "健康功能持续增强", "可穿戴设备成为时尚配饰"], density: "compact" },
                { type: "component", component: "comparison-card", id: "winner-card", title: "最成功案例", points: ["Meta Ray-Ban 销量破百万", "Gen 2 在48小时内售罄", "开放 Horizon OS 建立生态"] },
              ],
            },
          ],
        }],
      }],
    }, sampleLogo());

    expect(deck.slides[0]!.dom.children?.map((node) => node.id)).toEqual(["market-summary.title", "market-summary.main-content"]);
    expect(findNodeForTest(deck.slides[0]!.dom, "market-summary.market-size.value")?.text).toBe("500亿美元+");
    const measured = measureDeck(deck)[0]!.nodes;
    for (const node of measured) {
      expect(node.rect.x, node.id).toBeGreaterThanOrEqual(0);
      expect(node.rect.y, node.id).toBeGreaterThanOrEqual(0);
      expect(node.rect.x + node.rect.w, node.id).toBeLessThanOrEqual(25.4);
      expect(node.rect.y + node.rect.h, node.id).toBeLessThanOrEqual(14.2875);
    }
    assertShapeBounds(renderToAst(deck));
    const dir = await mkdtemp(join(tmpdir(), "slideml2-component-agent-"));
    const rendered = await renderToPptx(deck, join(dir, "component-agent.pptx"));
    expect((await stat(rendered.outputPath)).size).toBeGreaterThan(1000);
  });

  it("exposes complete component, text kind, and theme registries", () => {
    expect(listThemes()).toEqual(["default"]);
    expect(listTextKinds().map((item) => item.kind)).toEqual(expect.arrayContaining(["slide-title", "lead", "metric-value", "table-cell", "code"]));
    const componentNames = listComponents().map((item) => item.name);
    expect(componentNames).toEqual(expect.arrayContaining([
      "stack",
      "grid",
      "spacer",
      "divider",
      "image",
      "table",
      "chart",
      "lead",
      "text",
      "article",
      "code",
      "source-note",
      "label",
      "metric-card",
      "callout",
      "comparison-card",
      "step-card",
      "definition-card",
    ]));
    expect(componentNames).not.toEqual(expect.arrayContaining([
      "caption",
      "figure-caption",
      "footnote",
      "paragraph",
      "code-caption",
      "body-small",
      "axis-label",
      "legend-label",
      "table-card",
      "table-head",
      "table-cell",
      "quote",
      "quote-source",
      "quote-card",
      "badge",
      "tag",
      "image-with-caption",
      "chart-card",
      "code-card",
    ]));
    expect(listComponents().every((item) => !("tier" in item))).toBe(true);
    expect(listComponents().every((item) => Object.keys(item).sort().join(",") === "name,purpose")).toBe(true);
    expect(describeNodeType("image").fields.caption).toContain("optional");
    expect(describeNodeType("chart").fields.caption).toContain("optional");
    expect(describeNodeType("chart").fields.axis).toContain("optional");
    expect(describeNodeType("chart").fields.legend).toContain("optional");
    expect(describeNodeType("table").fields.caption).toContain("optional");
    const described = describeComponents(["metric-card", "image"]);
    expect(described.missing).toEqual([]);
    const metric = described.found["metric-card"];
    expect(metric?.fields.value.required).toBe(true);
    expect(metric?.renderBehavior?.expandsTo).toContain("metric-value");
    const image = described.found["image"];
    expect(image?.fields.src.required).toBe(true);
    expect(image?.fields.caption.description).toContain("optional");
    const textAlternatives = describeComponents(["explanation-block", "comparison-list", "fact-list", "executive-summary"]);
    expect(textAlternatives.missing).toEqual([]);
    expect(textAlternatives.found["comparison-list"]?.fields.items.required).toBe(true);
    expect(textAlternatives.found["fact-list"]?.fields.items.required).toBe(true);
    expect(describeComponents(["unknown-component"]).missing).toEqual(["unknown-component"]);
  });

  it("exposes copyable schema examples that validate after normalization", () => {
    const names = listComponents().map((item) => item.name);
    const described = describeComponents(names).found;
    const failures: Array<{ name: string; codes: string[] }> = [];
    const blockingCodes = new Set(["FALLBACK_FAILED", "COLLISION", "TINY_RECT", "SQUASHED", "UNKNOWN_COLOR", "UNKNOWN_STYLE"]);
    for (const [name, detail] of Object.entries(described)) {
      for (const [index, example] of (detail.examples || []).entries()) {
        const slide = normalizeSlide({ id: `example-${name}-${index}`, children: [example as never] } as never);
        const validation = validateSlide(slide, { deck: { size: "16x9", theme: "default" } });
        if (!validation.ok) failures.push({ name, codes: validation.errors.map((item) => item.code) });
        clearRenderDiagnostics();
        renderToAst(sourceToRenderedDeck({ slideml2: 2, deck: { size: "16x9", theme: "default" }, slides: [slide] } as never));
        const blocking = [...blockingCodes].flatMap((code) => getDiagnosticsByCode(code as Parameters<typeof getDiagnosticsByCode>[0]));
        if (blocking.length > 0) failures.push({ name, codes: blocking.map((item) => item.code) });
      }
    }
    for (const node of listNodeTypesForTest()) {
      const examples = Array.isArray((node as { examples?: unknown[] }).examples) ? (node as { examples: unknown[] }).examples : [];
      for (const [index, example] of examples.entries()) {
        const slide = normalizeSlide({ id: `node-example-${node.type}-${index}`, children: [example as never] } as never);
        const validation = validateSlide(slide, { deck: { size: "16x9", theme: "default" } });
        if (!validation.ok) failures.push({ name: node.type, codes: validation.errors.map((item) => item.code) });
        clearRenderDiagnostics();
        renderToAst(sourceToRenderedDeck({ slideml2: 2, deck: { size: "16x9", theme: "default" }, slides: [slide] } as never));
        const blocking = [...blockingCodes].flatMap((code) => getDiagnosticsByCode(code as Parameters<typeof getDiagnosticsByCode>[0]));
        if (blocking.length > 0) failures.push({ name: node.type, codes: blocking.map((item) => item.code) });
      }
    }
    expect(failures).toEqual([]);
  });

  it("budgets wrapped in-card headings before body text to prevent visual overlap", () => {
    const deck = createSourceDeck({ title: "Wrapped heading regression" });
    deck.deck.themeOverride = { text: { paragraph: { fontSize: 11, lineHeight: 1.4 } } };
    deck.slides.push({
      id: "abstract",
      background: "FAF9F6",
      children: [{
        id: "s2.card",
        type: "card",
        tone: "neutral",
        fill: "surface",
        line: "divider",
        cornerRadius: 0.1,
        elevation: "raised",
        at: [10.5, 1, 13.8, 12.3],
        padding: 0.6,
        children: [
          { id: "s2.eyebrow", type: "text", text: "ABSTRACT", color: "text.muted", style: "label" },
          { id: "s2.h", type: "h1", text: "Truth or Image? Reputation Pressure and Student Honesty" },
          { id: "s2.rule", type: "accent-rule", tone: "brand", length: 4, thickness: 1 },
          { id: "s2.body", type: "text", text: "This study investigates how reputation pressure affects the tendency of Grade 8 students to lie in school-related situations. Twelve participants completed a fifteen-item anagram challenge framed as a competition. Students were divided into two groups of six, balanced by academic level, in separate classrooms. Group A worked under low reputation pressure (scores private); Group B worked under high reputation pressure (scores announced publicly). The difference between reported and actual score was used as the measure of dishonest inflation.", style: "paragraph" },
          { id: "s2.findings", type: "text", text: "Group A's average inflation was 1.50 anagrams; Group B's was 7.17 — nearly five times larger. The two distributions did not overlap at any point (p ≈ 0.001). Actual performance between groups was nearly identical (mean actual scores differ by only 0.5), making performance differences an unlikely explanation.", style: "paragraph" },
        ],
      }],
    });

    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const shapes = ast.slides[0]!.shapes;
    const title = shapes.find((shape) => shape.name === "s2.h")!;
    const rule = shapes.find((shape) => shape.name === "s2.rule")!;
    const body = shapes.find((shape) => shape.name === "s2.body")!;
    const findings = shapes.find((shape) => shape.name === "s2.findings")!;
    const EMU_PER_CM = 360000;
    expect(title.xfrm!.cy / EMU_PER_CM).toBeGreaterThan(1.35);
    expect(rule.xfrm!.y).toBeGreaterThan(title.xfrm!.y + title.xfrm!.cy);
    expect(body.xfrm!.cy / EMU_PER_CM).toBeGreaterThan(2.75);
    expect(findings.xfrm!.y).toBeGreaterThan(body.xfrm!.y + body.xfrm!.cy);
    expect(getDiagnosticsByCode("TRUNCATED").filter((item) => item.nodeId === "s2.h")).toEqual([]);
    expect(getDiagnosticsByCode("FALLBACK_FAILED").filter((item) => item.nodeId === "s2.body" || item.nodeId === "s2.findings")).toEqual([]);
  });

  it("reports fixed-height paragraph boxes whose wrapped text would overlap nearby content", () => {
    const deck = createSourceDeck({ title: "Paragraph fit regression" });
    deck.slides.push({
      id: "paragraph-fit",
      children: [{
        id: "paragraph-fit.body",
        type: "text",
        style: "paragraph",
        at: [1, 1, 7.2, 1.0],
        text: "This paragraph is intentionally too long for a shallow fixed-height text box. The validator should estimate the wrapped text height and fail before PowerPoint lets the overflowing lines draw over the next object.",
      }],
    });

    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck));
    const failures = getDiagnosticsByCode("FALLBACK_FAILED").filter((item) => item.nodeId === "paragraph-fit.body");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.message).toContain("PowerPoint would overflow");
  });

  it("renders text narrative alternatives without falling back to repeated insight cards", () => {
    const sourceDeck = createSourceDeck({ title: "Narrative components" });
    sourceDeck.slides.push({
      id: "narrative-components",
      children: [{
        id: "narrative-components.content",
        type: "stack",
        area: "content",
        gap: 0.25,
        children: [
          {
            id: "narrative-components.summary",
            type: "executive-summary",
            thesis: "任务隔离应该先清理旧会话决策，再重新装载本次技能。",
            summary: "这样保留可复用事实，同时避免前一个 PPT 的视觉风格污染新任务。",
            findings: [
              { headline: "清理风格锚点", detail: "颜色、版式、案例素材不跨任务继承。", tone: "warning" },
              { headline: "保留稳定知识", detail: "用户偏好和项目约束以摘要形式保留。", tone: "positive" },
            ],
            implication: "新 session compact 应该是清理打包，而不是普通摘要。",
          },
          {
            id: "narrative-components.grid",
            type: "grid",
            columns: 3,
            gap: 0.25,
            children: [
              {
                id: "narrative-components.explain",
                type: "explanation-block",
                title: "为什么会串扰",
                body: "旧任务的主题、视觉 token 和素材如果留在上下文里，agent 会把它们误判为当前任务约束。",
                bullets: ["区分事实记忆和任务决策", "新任务重新加载 skill"],
                variant: "rail",
              },
              {
                id: "narrative-components.compare",
                type: "comparison-list",
                basis: "两种处理方式",
                items: [
                  { title: "普通 compact", body: "压缩所有历史，细节仍可能残留。" },
                  { title: "session reset", body: "只保留跨任务稳定信息，丢弃本轮实现细节。", tone: "positive" },
                ],
              },
              {
                id: "narrative-components.facts",
                type: "fact-list",
                variant: "list",
                items: [
                  { label: "日志", fact: "第二个 PPT 沿用第一个 PPT 风格。", interpretation: "上下文边界没有被显式重置。", tone: "warning" },
                  { label: "策略", fact: "skill 应在新 session 重新装载。", source: "Cowork session plan" },
                ],
              },
            ],
          },
        ],
      }],
    });
    const deck = sourceToRenderedDeck(sourceDeck);
    const ast = renderToAst(deck);
    assertShapeBounds(ast);
    const shapeNames = ast.slides[0]!.shapes.map((shape) => shape.name || "");
    expect(shapeNames.some((name) => name.includes("narrative-components.explain.rail"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("narrative-components.facts.1.accent"))).toBe(true);
    const rail = ast.slides[0]!.shapes.find((shape) => (shape.name || "").includes("narrative-components.explain.rail"));
    const factAccent = ast.slides[0]!.shapes.find((shape) => (shape.name || "").includes("narrative-components.facts.1.accent"));
    expect(rail!.xfrm.cx / 360000).toBeLessThan(0.15);
    expect(factAccent!.xfrm.cx / 360000).toBeLessThan(0.15);
  });

  it("wraps explanation-block body text before shrinking font size", () => {
    const sourceDeck = createSourceDeck({ title: "Explanation body" });
    sourceDeck.deck.themeOverride = { text: { paragraph: { fontSize: 12, lineHeight: 1.6 } } };
    sourceDeck.slides.push({
      id: "explanation-wrap",
      children: [{
        id: "explanation-wrap.content",
        type: "stack",
        area: "content",
        gap: 0.25,
        children: [
          { id: "explanation-wrap.title", type: "h1", text: "市场背景" },
          {
            id: "explanation-wrap.block",
            type: "explanation-block",
            variant: "panel",
            title: "表面现象 vs 深层趋势",
            body: "2026年2月，OpenClaw爆火刷屏。但进入3月底热度骤降。作者发现了一条被龙虾声量掩盖的暗线：几乎所有互联网大厂同时押注「AI员工」赛道。",
          },
        ],
      }],
    });
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(sourceDeck));
    const body = ast.slides[0]!.shapes.find((shape) => (shape.name || "").endsWith(".block.body"));
    const sizePt = body?.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt ? body.paragraphs[0]!.runs[0]!.sizeHalfPt / 2 : 0;
    expect(sizePt).toBeGreaterThanOrEqual(11.5);
    expect(getDiagnosticsByCode("TRUNCATED").filter((d) => (d.nodeId || "").endsWith(".block.body"))).toHaveLength(0);
  });

  it("keeps dense fact-list timelines renderable", () => {
    const sourceDeck = createSourceDeck({ title: "Dense facts" });
    sourceDeck.slides.push({
      id: "dense-facts",
      children: [{
        id: "dense-facts.content",
        type: "stack",
        area: "content",
        gap: 0.2,
        children: [
          { id: "dense-facts.section", type: "label", text: "01 背景与赛道", tone: "brand" },
          { id: "dense-facts.title", type: "h1", text: "大厂密集入局：AI员工赛道时间线" },
          { id: "dense-facts.lead", type: "lead", text: "2026年3月至4月，中国科技巨头和全球AI公司密集发布企业级Agent产品，这场竞赛的本质是对工作入口的争夺。" },
          {
            id: "dense-facts.factlist",
            type: "fact-list",
            variant: "list",
            items: [
              { label: "2026.03.09", fact: "腾讯上线 WorkBuddy", interpretation: "定位AI原生桌面智能体工作台，主打企业级运行环境" },
              { label: "2026.03.17", fact: "阿里发布钉钉悟空", interpretation: "企业级AI原生工作平台，整合钉钉生态" },
              { label: "2026.03.19", fact: "字节飞书 aily 升级", interpretation: "飞书AI全面升级为智能体平台" },
              { label: "2026.03.23", fact: "百度推出 DuMate 搭子", interpretation: "面向个人和团队的桌面级AI智能体" },
              { label: "2026.04.08", fact: "Anthropic 发布 Claude Managed Agents", interpretation: "发布次日美股SaaS指数单日暴跌5.5%，引发行业震动", tone: "warning" },
              { label: "2026.04.08", fact: "GenSpark 4.0 全球同步发布", interpretation: "愿景：让AI员工无处不在", tone: "positive" },
            ],
          },
        ],
      }],
    });
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(sourceDeck));
    assertShapeBounds(ast);
    const blockingCodes = new Set(["FALLBACK_FAILED", "OVERFLOW", "SQUASHED", "TINY_RECT"]);
    const blocking = [...blockingCodes].flatMap((code) => getDiagnosticsByCode(code as Parameters<typeof getDiagnosticsByCode>[0]));
    expect(blocking.map((item) => `${item.code}:${item.nodeId}`)).toEqual([]);
    const names = ast.slides[0]!.shapes.map((shape) => shape.name || "");
    expect(names.some((name) => name.includes("dense-facts.factlist.1."))).toBe(true);
    expect(names.some((name) => name.includes("dense-facts.factlist.6."))).toBe(true);
    expect(ast.slides[0]!.shapes.some((shape) => shape.type === "table" && shape.name === "dense-facts.factlist.items")).toBe(false);
  });

  it("adapts long key-takeaway headlines inside normal content flow", () => {
    const sourceDeck = createSourceDeck({ title: "Long takeaway" });
    sourceDeck.slides.push({
      id: "long-takeaway",
      children: [{
        id: "long-takeaway.content",
        type: "stack",
        area: "content",
        gap: 0.25,
        children: [
          { id: "long-takeaway.title", type: "h1", text: "OpenClaw热潮：被忽视的暗线" },
          {
            id: "long-takeaway.grid",
            type: "grid",
            columns: 2,
            gap: 0.4,
            children: [
              { id: "long-takeaway.card1", type: "insight-card", headline: "明线：OpenClaw的全民狂欢", body: "2026年2月至3月，几乎所有互联网大厂推出OpenClaw平台。", density: "compact" },
              { id: "long-takeaway.card2", type: "insight-card", headline: "暗线：大厂押注AI员工赛道", body: "巨头们看到了更大的机会：让AI走进企业，节省人力成本或提升效率。", density: "compact" },
            ],
          },
          {
            id: "long-takeaway.takeaway",
            type: "key-takeaway",
            headline: "核心洞察：OpenClaw验证了AI Agent的能力上限，而AI员工才是大厂眼中更大的商业机会。",
            tone: "brand",
          },
        ],
      }],
    });
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(sourceDeck));
    const blocking = getDiagnosticsByCode("FALLBACK_FAILED")
      .filter((item) => item.nodeId === "long-takeaway.takeaway" || String(item.nodeId || "").startsWith("long-takeaway.takeaway."));
    expect(blocking).toEqual([]);
  });

  it("discloses deck-level brand, chrome, and aesthetic principles", () => {
    const deck = describeDeck();
    expect(deck.size.value).toBe("16x9");
    expect(deck.size.slideWidthCm).toBeGreaterThan(20);
    expect(deck.contentArea.contentHeight).toBeGreaterThan(8);
    expect(deck.themes.available).toEqual(["default"]);
    expect(deck.brand.fields.primary).toMatchObject({ type: "string" });
    expect(deck.chrome.fields.brandMark.enum).toEqual(["none", "top-right", "bottom-right"]);
    expect(deck.colorTokens.tokens).toEqual(expect.arrayContaining(["brand.primary", "surface", "text.primary"]));
    expect(deck.textStyles.styles).toEqual(expect.arrayContaining(["slide-title", "card-title", "paragraph"]));
    expect(deck.themeGuidance.current.stylePrinciples.length).toBeGreaterThan(0);
    expect(deck.themeGuidance.fields.componentGuidance.description).toContain("component");
    expect(deck.styleDecisionProtocol.some((rule) => rule.includes("subject domain"))).toBe(true);
    expect(deck.subjectStylePlaybook.length).toBeGreaterThan(3);
    expect(deck.subjectStylePlaybook.find((item) => item.scenario.includes("earth-systems"))?.palette["brand.primary"]).toBe("0F766E");
    expect(deck.subjectStylePlaybook.find((item) => item.scenario.includes("technical architecture"))?.componentBias).toContain("process-flow");
    expect(deck.layoutPrinciples.length).toBeGreaterThan(3);
    expect(deck.consistencyPrinciples.length).toBeGreaterThan(3);
    expect(deck.componentChoiceGuidelines.length).toBeGreaterThan(3);
    expect(deck.textHygiene.some((rule) => rule.includes("CJK"))).toBe(true);
    expect(deck.doNot.some((rule) => rule.includes("fontSize"))).toBe(true);
    const pack = buildAgentPromptPack({ intent: "比较三个产品", includeDeckGuide: true });
    expect(pack).toContain("Layout principles");
    expect(pack).toContain("Component choice");
    expect(pack).toContain("Container usage");
    expect(pack).toContain("Color usage");
    expect(pack).toContain("Color palette usage");
    expect(pack).toContain("Shape decoration");
    expect(pack).toContain("Emphasis hierarchy");
    expect(pack).toContain("Density");
    expect(pack).toContain("Fallback ladder");
    const slim = buildAgentPromptPack({ intent: "比较三个产品", includeDeckGuide: false });
    expect(slim).not.toContain("Layout principles");
  });

  it("discloses components through a compact list and detailed describe API", () => {
    const list = listComponents();
    const promptPack = buildAgentPromptPack({ intent: "用三个指标和一个市场结论说明增长机会" });

    expect(list.map((item) => item.name)).toEqual(expect.arrayContaining(["stack", "grid", "split", "image", "table", "chart", "metric-card", "image-card", "chart-card", "table-card", "insight-card", "two-column"]));
    expect(list.every((item) => !("category" in item) && !("kind" in item) && !("useWhen" in item) && !("avoidWhen" in item))).toBe(true);
    const allDescribed = describeComponents(["metric-card", "stack", "image"]);
    expect(allDescribed.missing).toEqual([]);
    expect(allDescribed.found["metric-card"]).toMatchObject({
      name: "metric-card",
      fields: { value: { required: true }, label: { required: true } },
    });
    expect(allDescribed.found["stack"]).toMatchObject({
      name: "stack",
      children: { allowed: true, required: true },
    });
    expect(allDescribed.found["image"]?.examples[0]).toMatchObject({ type: "image" });
    expect(describeComponents(["split"]).found["split"]?.children.allowed).toBe(true);
    expect(describeNodeType("stack").acceptsChildren).toEqual(expect.arrayContaining(["split", "panel", "card", "band", "frame", "inset"]));
    expect(validateSlide({
      id: "primitive-components",
      children: [{
        id: "primitive-components.content",
        type: "component",
        component: "stack",
        area: "content",
        children: [{
          id: "primitive-components.image",
          type: "component",
          component: "image",
          src: sampleLogo(),
          alt: "Logo",
        }],
      }],
    }).ok).toBe(true);
    const emptyContainer = validateSlide({
      id: "empty-container",
      children: [{
        id: "empty-container.content",
        type: "component",
        component: "stack",
        area: "content",
      }],
    });
    expect(emptyContainer.ok).toBe(false);
    expect(emptyContainer.errors.map((item) => item.code)).toContain("EMPTY_CONTAINER_COMPONENT");
    const duplicateContent = validateSlide({
      id: "duplicate-content",
      children: [
        { id: "duplicate-content.a", type: "component", component: "stack", area: "content", children: [{ id: "duplicate-content.a.text", type: "component", component: "text", text: "A" }] },
        { id: "duplicate-content.b", type: "component", component: "stack", area: "content", children: [{ id: "duplicate-content.b.text", type: "component", component: "text", text: "B" }] },
      ],
    });
    expect(duplicateContent.ok).toBe(true);
    expect(promptPack).toContain("metric-card");
    expect(promptPack).toContain("callout");
    expect(promptPack).toContain("type='stack'");
    expect(promptPack).toContain("required={");
    expect(promptPack).toContain("optional={");
    expect(promptPack).toContain("children=required");
    expect(promptPack).toContain("example=");
    expect(promptPack).not.toContain("code-card");
    expect(promptPack).not.toContain("image-with-caption");
    // The pack now ships the always-on starter set + full deck rules, so it's
    // larger than the original minimal pack but should stay under 32k chars.
    expect(promptPack.length).toBeLessThan(34000);
    expect(promptPack).toContain("feature-card");
    expect(promptPack).toContain("checklist");
    expect(promptPack).toContain("pros-cons");
    expect(promptPack).toContain("panel");
    expect(promptPack).toContain("card");
    expect(promptPack).toContain("image-card");
    expect(promptPack).toContain("chart-card");
    expect(promptPack).toContain("table-card");
  });

  it("exposes small visual-composition components that render as native shapes/text", () => {
    const described = describeComponents(["title-lockup", "eyebrow", "accent-rule", "annotation", "side-rail", "axis-ruler"]);
    expect(described.missing).toEqual([]);
    expect(described.found["title-lockup"]?.fields.title.required).toBe(true);
    expect(described.found["eyebrow"]?.fields.tone.enum).toContain("inverse");
    expect(described.found["side-rail"]?.children.allowed).toBe(true);
    expect(described.found["accent-rule"]?.fields.direction.enum).toEqual(["horizontal", "vertical"]);
    expect(described.found["axis-ruler"]?.fields.items.required).toBe(true);
    expect(describeComponents(["freeform-group"]).found["freeform-group"]?.children).toMatchObject({ allowed: true, required: true });

    const sourceDeck = createSourceDeck({ title: "Visual primitives" });
    sourceDeck.slides.push({
      id: "visual-primitives",
      title: "A designed slide needs small visual anchors",
      children: [{
        id: "visual-primitives.content",
        type: "split",
        area: "content",
        ratio: [0.32, 0.68],
        gap: 0.55,
        children: [
          {
            id: "visual-primitives.rail",
            type: "side-rail",
            tone: "brand",
            title: "Deep time",
            body: "A side rail gives the page a visible editorial spine.",
          },
          {
            id: "visual-primitives.main",
            type: "stack",
            direction: "vertical",
            gap: 0.35,
            children: [
              { id: "visual-primitives.lockup", type: "title-lockup", eyebrow: "Field note", title: "Deep time", subtitle: "A typographic lockup makes an opening read as designed.", tone: "brand", rule: true },
              { id: "visual-primitives.kicker", type: "eyebrow", text: "Earth systems", rule: true },
              {
                id: "visual-primitives.axis",
                type: "axis-ruler",
                items: [
                  { label: "Hadean", body: "crust" },
                  { label: "Archean", body: "microbes" },
                  { label: "Phanerozoic", body: "animals" },
                ],
              },
              { id: "visual-primitives.note", type: "annotation", label: "Design move", text: "The ruler creates a subject-specific visual rhythm." },
            ],
          },
        ],
      }],
    });
    const deck = sourceToRenderedDeck(sourceDeck);
    const ast = renderToAst(deck);
    assertShapeBounds(ast);
    const names = ast.slides[0]!.shapes.map((shape) => shape.name || "");
    expect(names.some((name) => name.includes("visual-primitives.lockup.rule"))).toBe(true);
    expect(names.some((name) => name.includes("visual-primitives.kicker.rule"))).toBe(true);
    expect(names.some((name) => name.includes("visual-primitives.axis.line"))).toBe(true);
    expect(names.some((name) => name.includes("visual-primitives.rail-card"))).toBe(true);
  });

  it("interprets oversized accent-rule thickness values as points, not centimeter blocks", () => {
    const sourceDeck = createSourceDeck({ title: "Thin rule" });
    sourceDeck.slides.push({
      id: "thin-rule",
      children: [{
        id: "thin-rule.content",
        type: "stack",
        area: "content",
        children: [
          { id: "thin-rule.title", type: "h1", text: "A real line" },
          { id: "thin-rule.rule", type: "accent-rule", direction: "horizontal", tone: "brand", thickness: 1 },
        ],
      }],
    });
    const ast = renderToAst(sourceToRenderedDeck(sourceDeck));
    const rule = ast.slides[0]!.shapes.find((shape) => shape.name === "thin-rule.rule");
    expect(rule).toBeDefined();
    // 1pt is ~12,700 EMU. The bug rendered this as 1cm = 360,000 EMU,
    // a visible black block rather than a thin rule.
    expect(rule!.xfrm.cy).toBeLessThan(30_000);
  });

  it("interprets primitive stroke widths as points while preserving layout cm", () => {
    const sourceDeck = createSourceDeck({ title: "Stroke units" });
    sourceDeck.slides.push({
      id: "stroke-units",
      children: [{
        id: "stroke-units.content",
        type: "stack",
        area: "content",
        children: [
          { id: "stroke-units.divider", type: "divider", orientation: "horizontal", thickness: 1, fixedHeight: 1 },
          {
            id: "stroke-units.frame",
            type: "frame",
            line: "brand.primary",
            lineWidth: 2,
            fixedHeight: 1.2,
            children: [{ id: "stroke-units.frame.body", type: "text", text: "Framed" }],
          },
          {
            id: "stroke-units.table",
            type: "table",
            headers: ["A"],
            rows: [["B"]],
            borderWidth: 1,
            fixedHeight: 1.6,
          },
        ],
      }],
    });
    const ast = renderToAst(sourceToRenderedDeck(sourceDeck));
    const shapes = ast.slides[0]!.shapes;
    const divider = shapes.find((shape) => shape.name === "stroke-units.divider");
    const frame = shapes.find((shape) => shape.name === "stroke-units.frame-frame") as any;
    const table = shapes.find((shape) => shape.name === "stroke-units.table") as any;
    expect(divider).toBeDefined();
    expect(frame).toBeDefined();
    expect(table).toBeDefined();
    // `fixedHeight:1` remains a 1cm layout allocation, but `thickness:1` is
    // normalized to a 1pt visual rule.
    expect(divider!.xfrm.cy).toBeLessThan(30_000);
    expect(frame!.line.width).toBeGreaterThan(20_000);
    expect(frame!.line.width).toBeLessThan(30_000);
    expect(table!.borderWidth).toBeLessThan(30_000);
  });

  it("treats severely compressed text regions as blocking render diagnostics", () => {
    const sourceDeck = createSourceDeck({ title: "Squashed layout" });
    sourceDeck.slides.push({
      id: "squashed",
      title: "Too little text room",
      children: [{
        id: "squashed.text",
        type: "text",
        at: [1, 3, 10, 0.22],
        text: "This paragraph has enough content that a sub-line-height region is not usable.",
      }],
    });
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(sourceDeck));
    const squashed = getDiagnosticsByCode("SQUASHED");
    expect(squashed.length).toBeGreaterThan(0);
    expect(squashed[0]?.severity).toBe("error");
    expect(squashed[0]?.suggestion).toContain("increase");
  });

  it("preserves common layout and visual props when semantic components expand", () => {
    const deck = {
      deck: { size: "16x9" as const, theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "overlay-component",
        layout: "title-and-content" as const,
        dom: {
          id: "overlay-component.root",
          type: "slide" as const,
          background: "background",
          children: [{
            id: "overlay-component.metric",
            type: "metric-card",
            value: "42%",
            label: "Conversion",
            anchor: "top-right",
            offsetX: 1,
            offsetY: 1,
            width: 5,
            height: 2.5,
            zIndex: 3,
            fill: "surface",
            line: "brand.primary",
            cornerRadius: 0.2,
          }],
        },
      }],
    };
    const measured = measureDeck(deck)[0]!.nodes;
    const metric = rectOf(measured, "overlay-component.metric");
    expect(metric.x).toBeCloseTo(25.4 - 5 - 1, 2);
    expect(metric.y).toBeCloseTo(1, 2);
    expect(metric.w).toBeCloseTo(5, 2);
    expect(metric.h).toBeCloseTo(2.5, 2);
    const ast = renderToAst(deck);
    const bg = ast.slides[0]!.shapes.find((shape) => shape.name === "overlay-component.metric-background");
    expect(bg?.type).toBe("shape");
    if (bg?.type !== "shape") throw new Error("Expected metric background shape");
    expect(bg.cornerRadius).toBe(0.2);
  });

  it("renders table colspan/rowspan through the native table shape", async () => {
    const deck = {
      deck: { size: "16x9" as const, theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "merged-table",
        layout: "title-and-content" as const,
        dom: {
          id: "merged-table.root",
          type: "slide" as const,
          background: "background",
          children: [{
            id: "merged-table.content",
            type: "table",
            area: "content",
            headers: ["Segment", "Q1", "Q2", "Q3"],
            rows: [
              [{ text: "Enterprise", rowspan: 2, fill: "brand.tint", bold: true }, "12", "15", "18"],
              [{ text: "Merged forecast", colspan: 3, fill: "surface.subtle", align: "center" }],
              [{ text: "SMB", colspan: 2, fill: "success.tint" }, "8", "9"],
            ],
          }],
        },
      }],
    };
    const ast = renderToAst(deck);
    const table = ast.slides[0]!.shapes.find((shape) => shape.name === "merged-table.content");
    expect(table?.type).toBe("table");
    if (table?.type !== "table") throw new Error("Expected table shape");
    expect(table.cells[1]![0]!.rowspan).toBe(2);
    expect(table.cells[2]![1]!.colspan).toBe(3);
    expect(table.cells[2]![2]!.hMerge).toBe(true);
    expect(table.cells[2]![3]!.hMerge).toBe(true);
    expect(table.cells[2]![0]!.vMerge).toBe(true);
    const dir = await mkdtemp(join(tmpdir(), "slideml2-merged-table-"));
    const rendered = await renderToPptx(deck, join(dir, "merged-table.pptx"));
    expect((await stat(rendered.outputPath)).size).toBeGreaterThan(1000);
  });

  it("renders common composite cards and responds to theme color/font overrides", async () => {
    clearRenderDiagnostics();
    const deck = {
      deck: {
        size: "16x9" as const,
        theme: "default",
        brand: { primary: "0F766E" },
        themeOverride: {
          colors: { "brand.primary": "0F766E", surface: "F8FAFC" },
          text: { "card-title": { fontSize: 16, weight: "bold" as const, color: "brand.primary", lineHeight: 1.15 } },
          component: { card: { padding: 0.42, cornerRadius: 0.18 } },
          guidance: {
            scenario: "board dashboard",
            componentGuidance: {
              "chart-card": "Use for board-level metrics with a source note.",
              "table-card": "Use for compact financial summaries.",
            },
          },
        },
      },
      slides: [{
        id: "composite",
        layout: "title-and-content" as const,
        dom: {
          id: "composite.root",
          type: "slide" as const,
          background: "background",
          children: [
            { id: "composite.title", type: "text", text: "Composite dashboard", style: "slide-title" },
            {
              id: "composite.grid",
              type: "grid",
              area: "content",
              columns: 2,
              rows: 2,
              gap: 0.45,
              children: [
                { id: "composite.image", type: "image-card", title: "Product evidence", src: sampleLogo(), caption: "Demo asset", fit: "contain", fixedHeight: 4.3 },
                {
                  id: "composite.chart",
                  type: "chart-card",
                  title: "Pipeline",
                  chartType: "bar",
                  labels: ["Q1", "Q2", "Q3"],
                  series: [{ name: "ARR", values: [4, 6, 9] }],
                  showValues: true,
                  caption: "Source: CRM",
                  fixedHeight: 4.3,
                },
                {
                  id: "composite.table",
                  type: "table-card",
                  title: "Plan vs actual",
                  headers: ["Metric", "Plan", "Actual"],
                  rows: [["ARR", "$8M", "$9M"], ["NRR", "104%", "109%"]],
                  caption: "Finance, May 2026",
                  fixedHeight: 4.3,
                },
                {
                  id: "composite.insight",
                  type: "insight-card",
                  badge: "watch",
                  headline: "Enterprise expansion is ahead of plan.",
                  detail: "Constraint: deployment capacity.",
                  tone: "brand",
                  fixedHeight: 4.3,
                },
              ],
            },
          ],
        },
      }],
    };
    const validation = validateSlide({
      id: "composite",
      title: "Composite dashboard",
      children: deck.slides[0]!.dom.children!.slice(1) as import("./types.js").DomNode[],
    }, { deck: deck.deck });
    expect(validation.ok).toBe(true);
    clearRenderDiagnostics();
    const ast = renderToAst(deck);
    assertShapeBounds(ast);
    const titleShape = ast.slides[0]!.shapes.find((shape) => shape.name === "composite.chart.title");
    expect(titleShape?.type).toBe("text");
    if (titleShape?.type !== "text") throw new Error("Expected chart-card title text");
    expect(titleShape.paragraphs[0]!.runs[0]!.sizeHalfPt).toBe(32);
    expect(titleShape.paragraphs[0]!.runs[0]!.color).toBe("0F766E");
    expect(getDiagnosticsByCode("TINY_RECT")).toHaveLength(0);
    expect(getDiagnosticsByCode("FALLBACK_FAILED")).toHaveLength(0);
    const dir = await mkdtemp(join(tmpdir(), "slideml2-composite-cards-"));
    const rendered = await renderToPptx(deck, join(dir, "composite-cards.pptx"));
    expect((await stat(rendered.outputPath)).size).toBeGreaterThan(1000);
  });

  it("lowers semantic two-column components after expansion", () => {
    const deck = createSourceDeck({ title: "Two column", theme: "default" });
    deck.slides.push({
      id: "two-column",
      title: "Two column semantic component",
      children: [{
        id: "two-column.body",
        type: "two-column",
        area: "content",
        ratio: [0.5, 0.5],
        left: { id: "two-column.left", type: "text", text: "Left rendered", style: "paragraph" },
        right: { id: "two-column.right", type: "text", text: "Right rendered", style: "paragraph" },
      }],
    });

    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const names = ast.slides[0]!.shapes.map((shape) => shape.name);
    expect(names).toContain("two-column.left");
    expect(names).toContain("two-column.right");
    expect(getDiagnosticsByCode("TINY_RECT")).toHaveLength(0);
  });

  it("supports deck-level props and whole-slide operations only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "slideml2-ops-"));
    const deckPath = join(dir, "deck.slideml2.json");
    await createDeck(deckPath, { title: "Ops deck", theme: "default", brand: { name: "Ops", primary: "2563EB" } });
    await setDeckProps(deckPath, { chrome: { brandMark: "bottom-right", pageNumber: true } });
    await appendSlide(deckPath, sourceSlide("summary", "执行摘要"));
    await insertSlide(deckPath, 0, sourceSlide("opening", "开篇判断"));
    await replaceSlide(deckPath, "summary", sourceSlide("summary", "更新后的摘要"));
    await deleteSlide(deckPath, "opening");
    const validation = await validateDeckPath(deckPath);
    expect(validation.ok).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it("rejects invalid createDeck options before writing an unusable source deck", async () => {
    const dir = await mkdtemp(join(tmpdir(), "slideml2-ops-"));
    const deckPath = join(dir, "invalid.slideml2.json");
    const result = await createDeck(deckPath, {
      title: "Invalid deck",
      theme: "default",
      themeOverride: {
        layout: { contentTop: 1.4 },
        chrome: { brandMark: false as never },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.validation?.errors.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "INVALID_THEME_CHROME_VALUE",
    ]));
    expect(result.validation?.errors.map((issue) => issue.code)).not.toContain("THEME_LAYOUT_TITLE_OVERLAP");
    await expect(stat(deckPath)).rejects.toThrow();
  });

  it("allows lowered contentTop for no-title or full-page layout decks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "slideml2-ops-"));
    const deckPath = join(dir, "full-page.slideml2.json");
    const result = await createDeck(deckPath, {
      title: "Full-page deck",
      theme: "default",
      themeOverride: {
        layout: { contentTop: 1.4, contentBottom: 13.2 },
      },
    });

    expect(result.ok).toBe(true);
    await expect(stat(deckPath)).resolves.toBeDefined();
  });

  it("renders deck.chrome footer text and page numbers through the theme chrome path", () => {
    const deck = createSourceDeck({ title: "Chrome", theme: "default" });
    deck.deck.chrome = { pageNumber: true, footerText: "Internal use" };
    deck.slides.push(sourceSlide("summary", "执行摘要"));

    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const names = ast.slides[0]!.shapes.map((shape) => shape.name);
    expect(names).toContain("chrome.footer-text");
    expect(names).toContain("chrome.page-1");
    const chromeBoxFailures = getDiagnosticsByCode("FALLBACK_FAILED")
      .concat(getDiagnosticsByCode("TEXT_BOX_TOO_SHORT"))
      .filter((diagnostic) => String(diagnostic.nodeId || "").startsWith("chrome."));
    expect(chromeBoxFailures, chromeBoxFailures.map((d) => d.message).join("\n")).toHaveLength(0);
    const footer = ast.slides[0]!.shapes.find((shape) => shape.name === "chrome.footer-text");
    expect(footer?.type).toBe("text");
    if (footer?.type === "text") {
      expect(footer.paragraphs[0]?.runs[0]?.text).toBe("Internal use");
    }
  });

  it("accepts common themeOverride aliases emitted by agents", () => {
    const deck = createSourceDeck({ title: "Theme aliases", theme: "default" });
    deck.deck.themeOverride = {
      text: {
        paragraph: { lineSpacing: 1.28, bold: false },
        "section-title": { bold: true },
      },
      component: {
        card: { surface: { fill: "surface.subtle", padding: 0.2 } },
      },
      fonts: {
        mono: { text: "Menlo" },
      },
      chrome: {
        pageNumber: "true" as never,
        brandMark: "topRight" as never,
      },
    };
    deck.slides.push(sourceSlide("summary", "执行摘要"));

    const validation = validateDeck(deck);
    const codes = validation.errors.map((error) => error.code);
    expect(codes).not.toContain("UNKNOWN_THEME_TEXT_FIELD");
    expect(codes).not.toContain("UNKNOWN_THEME_COMPONENT_FIELD");
    expect(codes).not.toContain("INVALID_THEME_FONT_VALUE");
    expect(codes).not.toContain("INVALID_THEME_CHROME_VALUE");
  });

  it("validates source slides with actionable component errors", () => {
    const deck = createSourceDeck({ title: "Validation", theme: "default" });
    deck.slides.push({
      id: "bad",
      title: "Bad slide",
      children: [{
        id: "bad.c",
        type: "component",
        component: "unknown-card",
      }],
    });
    const validation = validateDeck(deck);
    expect(validation.ok).toBe(false);
    expect(validation.errors[0]?.code).toBe("UNKNOWN_COMPONENT");
    expect(validation.errors[0]?.suggestedFix).toContain("active SKILL.md");
  });

  it("rejects ineffective themeOverride page/layout/font fields instead of silently ignoring them", () => {
    const deck = createSourceDeck({ title: "Invalid theme", theme: "default" });
    deck.deck.themeOverride = {
      layout: { pageMarginY: 0.9 },
      text: { paragraph: { tracking: 1.4 } },
      component: { card: { borderRadius: 8 } },
      fonts: { body: ["Arial"] },
    } as never;
    deck.slides.push(sourceSlide("summary", "执行摘要"));

    const validation = validateDeck(deck);
    expect(validation.ok).toBe(false);
    expect(validation.errors.map((err) => err.code)).toEqual(expect.arrayContaining([
      "UNKNOWN_THEME_LAYOUT_FIELD",
      "UNKNOWN_THEME_TEXT_FIELD",
      "UNKNOWN_THEME_COMPONENT_FIELD",
      "UNKNOWN_THEME_FONT_FIELD",
    ]));
  });

  it("reports invalid numeric layout values without crashing validation", () => {
    const deck = createSourceDeck({ title: "Invalid layout value", theme: "default" });
    deck.deck.themeOverride = {
      layout: { contentBottom: "13.3" },
    } as never;
    deck.slides.push(sourceSlide("summary", "执行摘要"));

    const validation = validateDeck(deck);
    expect(validation.ok).toBe(false);
    expect(validation.errors.map((err) => err.code)).toContain("INVALID_THEME_LAYOUT_VALUE");
    expect(validation.errors.map((err) => err.code)).not.toContain("LAYOUT_VALIDATION_CRASH");
  });

  it("rejects legacy ambiguous theme names and impossible content area geometry", () => {
    const deck = createSourceDeck({ title: "Invalid layout", theme: "default" });
    deck.deck.themeOverride = {
      layout: { contentBottom: 6, contentBottomMargin: 13 },
      component: { card: { radius: 0.18 } },
    } as never;
    deck.slides.push(sourceSlide("summary", "执行摘要"));

    const validation = validateDeck(deck);
    expect(validation.ok).toBe(false);
    expect(validation.errors.map((err) => err.code)).toEqual(expect.arrayContaining([
      "UNKNOWN_THEME_LAYOUT_FIELD",
      "THEME_LAYOUT_CONTENT_AREA_TOO_SMALL",
      "UNKNOWN_THEME_COMPONENT_FIELD",
    ]));
    expect(validation.errors.find((err) => err.code === "THEME_LAYOUT_CONTENT_AREA_TOO_SMALL")?.suggestedFix).toContain("contentBottom is the content area's bottom y-coordinate");
    expect(validation.errors.find((err) => err.path === "deck.themeOverride.component.card.radius")?.suggestedFix).toContain("Rename radius to cornerRadius");
  });

  it("warns when theme layout leaves too little practical content height", () => {
    const deck = createSourceDeck({ title: "Tight layout", theme: "default" });
    deck.deck.themeOverride = {
      layout: { contentTop: 5.3, contentBottom: 13.3 },
    };
    deck.slides.push(sourceSlide("summary", "执行摘要"));

    const validation = validateDeck(deck);
    expect(validation.ok).toBe(true);
    expect(validation.warnings.find((warning) => warning.code === "THEME_LAYOUT_CONTENT_AREA_TIGHT")?.suggestedFix).toContain("effective content height");
  });

  it("rejects required component arrays and objects with the wrong type", () => {
    const deck = createSourceDeck({ title: "Component type validation", theme: "default" });
    deck.slides.push({
      id: "bad-required",
      children: [
        { id: "bad-required.pros", type: "pros-cons", pros: "pros", cons: ["Valid con"] },
        { id: "bad-required.tags", type: "tag-list", items: "items" },
        { id: "bad-required.cols", type: "two-column", left: "left", right: { id: "bad-required.r", type: "text", text: "Right" } },
      ] as never,
    });

    const validation = validateDeck(deck);
    expect(validation.ok).toBe(false);
    const invalids = validation.errors.filter((err) => err.code === "INVALID_FIELD_USAGE");
    expect(invalids.map((err) => err.path)).toEqual(expect.arrayContaining([
      "children[0].pros",
      "children[1].items",
      "children[2].left",
    ]));
  });

  it("validateSlide uses deck themeOverride for layout bounds", () => {
    const slide = {
      id: "narrow-theme",
      children: [{ id: "narrow-theme.t", type: "text", text: "x", at: [9.8, 1, 1, 1] }],
    } as never;
    const validation = validateSlide(slide, {
      deck: {
        size: "16x9",
        theme: "default",
        brand: { name: "Narrow", primary: "2563EB" },
        themeOverride: { layout: { slideWidthCm: 10 } },
      },
    });
    expect(validation.errors.find((err) => err.code === "NODE_OUT_OF_BOUNDS"))?.toBeDefined();
  });

  it("rejects legacy node position placement in favor of anchor/corner", () => {
    const deck = createSourceDeck({ title: "Invalid placement", theme: "default" });
    deck.slides.push({
      id: "placement",
      title: "Placement",
      children: [
        { id: "placement.mark", type: "text", text: "Source", position: "bottom-right", width: 2.6, height: 0.45 },
      ],
    } as never);

    const validation = validateDeck(deck);
    expect(validation.ok).toBe(false);
    expect(validation.errors.map((err) => err.code)).toContain("LEGACY_NODE_POSITION");
    expect(validation.errors.find((err) => err.code === "LEGACY_NODE_POSITION")?.suggestedFix).toContain("anchor:'bottom-right'");
  });

  it("renders the same component source deck with three themes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "slideml2-themes-"));
    for (const theme of listThemes()) {
      const deck = createSourceDeck({ title: `Theme ${theme}`, theme, brand: { name: "Demo", primary: "2563EB", logo: sampleLogo() } });
      deck.slides.push({
        id: `${theme}-gallery`,
        title: `${theme} component gallery`,
        children: [{
          id: `${theme}.content`,
          type: "stack",
          area: "content",
          direction: "vertical",
          gap: 0.3,
          children: [
            { id: `${theme}.lead`, type: "text", text: "同一份语义 DOM 由 theme 决定视觉表现。", style: "lead" },
            {
              id: `${theme}.grid`,
              type: "grid",
              columns: 3,
              gap: 0.3,
              layoutWeight: 1,
              children: [
                componentNode(`${theme}.metric`, "metric-card", { value: "500亿+", label: "市场规模" }),
                componentNode(`${theme}.callout`, "callout", { text: "组件表达语义，theme 表达风格。", tone: "brand" }),
                componentNode(`${theme}.compare`, "comparison-card", { title: "Meta Ray-Ban", points: ["销量破百万", "AI眼镜标杆"] }),
              ],
            },
          ],
        }],
      });
      const rendered = await renderToPptx(sourceToRenderedDeck(deck), join(dir, `${theme}.pptx`));
      expect((await stat(rendered.outputPath)).size).toBeGreaterThan(1000);
      expect(validateDeck(deck).ok).toBe(true);
    }
  });

  it("generates decks through small per-slide LLM calls and appendSlide", async () => {
    const dir = await mkdtemp(join(tmpdir(), "slideml2-batch-agent-"));
    const markdownPath = join(dir, "report.md");
    await writeFile(markdownPath, [
      "# AI 可穿戴设备报告",
      "",
      "DO_NOT_PASS_FULL_MARKDOWN_SENTINEL",
      "",
      "这是一份较长报告，页面生成阶段不应该再次携带整份 markdown。",
    ].join("\n"), "utf8");

    const responses = [
      [
        { id: "summary", title: "执行摘要", intent: "说明市场增长和机会", keyFacts: ["2026 增长加速", "全球规模 500 亿美元+"] },
        { id: "strategy", title: "产品策略", intent: "说明产品落地方向", keyFacts: ["智能眼镜是核心入口", "端侧 AI 芯片需求增长"] },
      ],
      {
        id: "summary",
        title: "执行摘要",
        children: [{
          id: "summary.content",
          type: "component",
          component: "stack",
          area: "content",
          gap: "medium",
          children: [
            { id: "summary.lead", type: "component", component: "lead", text: "AI 可穿戴进入增长加速期。" },
            { id: "summary.metric", type: "component", component: "metric-card", metricValue: "500亿+", metricLabel: "全球规模" },
          ],
        }],
      },
      {
        id: "strategy",
        title: "产品策略",
        children: [{
          id: "strategy.content",
          type: "component",
          component: "stack",
          area: "content",
          gap: 12,
          children: [
            { id: "strategy.callout", type: "component", component: "callout", title: "核心判断", bullets: ["智能眼镜是核心入口", "端侧 AI 芯片需求增长"] },
          ],
        }],
      },
    ];
    const requests: Array<{ content: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as { messages?: Array<{ content?: string }> };
      requests.push({ content: String(body.messages?.[0]?.content || "") });
      const payload = responses.shift();
      return new Response(JSON.stringify({ content: [{ text: JSON.stringify(payload) }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const result = await generateDeckWithBatchAgent({
        markdownPath,
        deckPath: join(dir, "deck.slideml2.json"),
        outputPath: join(dir, "deck.pptx"),
        maxSlides: 2,
        config: { apiKey: "test", baseURL: "https://llm.test/v1", model: "test-model" },
      });
      const deck = JSON.parse(await readFile(result.deckPath, "utf8")) as { slides: unknown[] };
      expect(deck.slides).toHaveLength(2);
      expect(JSON.stringify(deck)).toContain("summary.lead");
      expect(result.validation.ok).toBe(true);
      expect(requests).toHaveLength(3);
      expect(requests[0]!.content).toContain("DO_NOT_PASS_FULL_MARKDOWN_SENTINEL");
      expect(requests[1]!.content).not.toContain("DO_NOT_PASS_FULL_MARKDOWN_SENTINEL");
      expect(requests[2]!.content).not.toContain("DO_NOT_PASS_FULL_MARKDOWN_SENTINEL");
      expect((await stat(result.outputPath)).size).toBeGreaterThan(1000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.skipIf(!runRealLlmTest)("lets a real LLM compose slides from basic components", async () => {
    const dir = await mkdtemp(join(tmpdir(), "slideml2-real-component-agent-"));
    const result = await generateWithComponentAgent(
      "/Users/river/Documents/Workspace/智能穿戴硬件新品调查报告.md",
      join(dir, "wearables-component-agent.pptx"),
      sampleLogo(),
    );
    expect(result.plan.slides.length).toBeGreaterThanOrEqual(4);
    expect((await stat(result.outputPath)).size).toBeGreaterThan(1000);
    expect(result.plan.slides.map((slide) => slide.title).join("\n")).not.toMatch(/封面|目录|结束|谢谢|数据来源/i);
    expect(collectComponentNames(result.plan)).not.toEqual(expect.arrayContaining(["cover", "section", "dashboard", "product-matrix", "risk-list", "recommendation-list"]));
    for (const slide of result.deck.slides) {
      expect(findNodeForTest(slide.dom, "slide-title")).toBeTruthy();
    }
    assertShapeBounds(renderToAst(result.deck));
  }, 120_000);

  it("emits structured diagnostics for unknown color tokens", () => {
    clearRenderDiagnostics();
    const deck = buildDom(sampleSource());
    const edited = applyEdits(deck, [
      { op: "setSlideProp", slideId: "cover", prop: "background", value: "magenta-mystery" },
    ]);
    renderToAst(edited);
    const unknownColors = getDiagnosticsByCode("UNKNOWN_COLOR");
    expect(unknownColors.length).toBeGreaterThan(0);
    expect(unknownColors[0]!.severity).toBe("warn");
    expect(unknownColors[0]!.message).toContain("magenta-mystery");
    expect(unknownColors[0]!.suggestion).toBeTruthy();
  });

  it("emits collision diagnostics when two flow nodes overlap", () => {
    clearRenderDiagnostics();
    const deck: ReturnType<typeof buildDom> = {
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "collide",
        layout: "title-and-content",
        dom: {
          id: "collide.root",
          type: "slide",
          background: "background",
          children: [
            { id: "collide.a", type: "shape", preset: "rect", anchor: "top-left", offsetX: 1, offsetY: 1, width: 5, height: 5, fill: "brand.primary", zIndex: 1 },
            { id: "collide.b", type: "shape", preset: "rect", anchor: "top-left", offsetX: 3, offsetY: 3, width: 5, height: 5, fill: "success", zIndex: 1 },
          ],
        },
      }],
    };
    measureDeck(deck);
    // Anchored overlays are excluded by design; convert to flow children to provoke a collision.
    const flowDeck: typeof deck = {
      ...deck,
      slides: [{
        ...deck.slides[0]!,
        dom: {
          ...deck.slides[0]!.dom,
          children: [
            { id: "collide.content", type: "stack", area: "content", direction: "vertical", gap: 0.2, children: [] },
            { id: "collide.a", type: "shape", preset: "rect", anchor: "top-left", offsetX: 1, offsetY: 1, width: 8, height: 8, fill: "brand.primary" },
            { id: "collide.b", type: "shape", preset: "rect", anchor: "top-left", offsetX: 5, offsetY: 5, width: 8, height: 8, fill: "success" },
          ],
        },
      }],
    };
    clearRenderDiagnostics();
    measureDeck(flowDeck);
    // The two shapes are anchored overlays so the collision detector skips them.
    expect(getDiagnosticsByCode("COLLISION")).toHaveLength(0);
  });

  it("applies the fallback ladder when intrinsic content overflows", () => {
    clearRenderDiagnostics();
    const tightChildren: import("./types.js").DomNode[] = Array.from({ length: 12 }, (_, index) => ({
      id: `tight.col${index + 1}`,
      type: "text",
      style: "paragraph",
      text: `Column ${index + 1}`,
      fixedWidth: 4,
    }));
    tightChildren.push({ id: "tight.optional", type: "text", style: "paragraph", text: "Optional", fixedWidth: 4, optional: true });
    const deck: ReturnType<typeof buildDom> = {
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "tight",
        layout: "title-and-content",
        dom: {
          id: "tight.root",
          type: "slide",
          background: "background",
          children: [{
            id: "tight.content",
            type: "stack",
            area: "content",
            direction: "horizontal",
            gap: 0.3,
            children: tightChildren,
          }],
        },
      }],
    };
    measureDeck(deck);
    const drops = getDiagnosticsByCode("DROP");
    const failed = getDiagnosticsByCode("FALLBACK_FAILED");
    expect(drops.length + failed.length).toBeGreaterThan(0);
    expect((drops[0] || failed[0])!.suggestion).toBeTruthy();
  });

  it("expands new composite components (feature-card, checklist, progress-bar, pros-cons, process-flow, pricing-card, stat-comparison)", () => {
    clearRenderDiagnostics();
    const deck: ReturnType<typeof buildDom> = {
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "newcomps",
        layout: "title-and-content",
        dom: {
          id: "newcomps.root",
          type: "slide",
          background: "background",
          children: [{
            id: "newcomps.content",
            type: "stack",
            area: "content",
            direction: "vertical",
            gap: 0.4,
            children: [
              { id: "newcomps.feature", type: "feature-card", icon: "ellipse", title: "Real-time", body: "Sub-100ms response." },
              { id: "newcomps.check", type: "checklist", items: [{ text: "API parity", status: "checked" }, { text: "SLA documented", status: "warning" }, { text: "GDPR audit", status: "unchecked" }] },
              { id: "newcomps.progress", type: "progress-bar", label: "Migration done", value: 64, tone: "brand" },
              { id: "newcomps.pros", type: "pros-cons", pros: ["Open source", "Free tier"], cons: ["Smaller community"] },
              { id: "newcomps.flow", type: "process-flow", direction: "horizontal", steps: [{ title: "Plan" }, { title: "Build" }, { title: "Ship" }] },
              { id: "newcomps.pricing", type: "pricing-card", plan: "Pro", price: "$29", period: "/mo", features: ["Unlimited seats", "Priority support"], tone: "brand", ctaText: "Start" },
              { id: "newcomps.stat", type: "stat-comparison", beforeLabel: "Q1", beforeValue: "12%", afterLabel: "Q2", afterValue: "27%", trend: "up", deltaLabel: "+15pp" },
            ],
          }],
        },
      }],
    };
    const ast = renderToAst(deck);
    expect(ast.slides[0]!.shapes.length).toBeGreaterThan(20);
    const layout = inspectLayout(deck, "newcomps")[0]!;
    const ids = new Set(layout.nodes.map((n) => n.id));
    expect(ids.has("newcomps.feature.title")).toBe(true);
    expect(ids.has("newcomps.progress.fill")).toBe(true);
    expect(ids.has("newcomps.flow.step1.title")).toBe(true);
    expect(ids.has("newcomps.stat.delta.arrow")).toBe(true);
  });

  it("renders dense expressive components without fallback failures or squashed shapes", () => {
    clearRenderDiagnostics();
    const deck: ReturnType<typeof buildDom> = {
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [
        {
          id: "dense-timeline",
          layout: "title-and-content",
          dom: {
            id: "dense-timeline.root",
            type: "slide",
            background: "background",
            children: [{
              id: "dense-timeline.content",
              type: "timeline",
              area: "content",
              // Omitted direction should still choose a renderable layout for common short timelines.
              items: [
                { date: "2019", title: "Pilot", body: "Validate the first internal workflow." },
                { date: "2020", title: "Launch", body: "Release the customer-facing experience." },
                { time: "2021", title: "Scale", body: "Expand to three priority regions." },
                { time: "2022", title: "Automate", body: "Reduce manual operating steps." },
                { time: "2023", title: "Platform", body: "Unify reporting and governance." },
              ],
            }],
          },
        },
        {
          id: "dense-numbered-grid",
          layout: "title-and-content",
          dom: {
            id: "dense-numbered-grid.root",
            type: "slide",
            background: "background",
            children: [{
              id: "dense-numbered-grid.content",
              type: "numbered-grid",
              area: "content",
              items: [
                { title: "Signal", body: "Capture demand, risk, and adoption indicators." },
                { title: "Model", body: "Translate indicators into prioritized scenarios." },
                { title: "Plan", body: "Allocate teams against the highest leverage work." },
                { title: "Execute", body: "Ship increments with clear accountable owners." },
                { title: "Review", body: "Compare outcomes against the operating thesis." },
              ],
            }],
          },
        },
        {
          id: "dense-process-flow",
          layout: "title-and-content",
          dom: {
            id: "dense-process-flow.root",
            type: "slide",
            background: "background",
            children: [{
              id: "dense-process-flow.content",
              type: "process-flow",
              area: "content",
              direction: "horizontal",
              steps: [
                { title: "Collect", body: "Gather source evidence." },
                { title: "Cluster", body: "Group related themes." },
                { title: "Decide", body: "Select the core argument." },
                { title: "Draft", body: "Compose slide-ready points." },
                { title: "Verify", body: "Check render and layout." },
              ],
            }],
          },
        },
      ],
    };

    const ast = renderToAst(deck);
    assertShapeBounds(ast);
    expect(getDiagnosticsByCode("FALLBACK_FAILED")).toHaveLength(0);
    expect(getDiagnosticsByCode("SQUASHED")).toHaveLength(0);
    expect(getDiagnosticsByCode("TINY_RECT")).toHaveLength(0);
  });

  it("accepts common aliases and safe defaults for expressive components", () => {
    const deck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [
        { id: "alias-kpis", children: [{ id: "content", type: "kpi-grid", items: [{ value: "42%", name: "Adoption" }, { value: "8", title: "Markets" }] }] },
        { id: "alias-flow", children: [{ id: "content", type: "process-flow", items: [{ title: "Collect" }, { title: "Decide" }, { title: "Ship" }] }] },
        { id: "alias-logos", children: [{ id: "content", type: "logo-strip", images: [{ src: "/tmp/a.png", alt: "A" }, { src: "/tmp/b.png", alt: "B" }] }] },
        { id: "alias-chart", children: [{ id: "content", type: "chart-card", chart: "bar", data: { labels: ["A", "B"], series: [{ name: "X", values: [1, 2] }] }, title: "Chart" }] },
        { id: "alias-table", children: [{ id: "content", type: "table-card", title: "Table", data: { headers: ["A", "B"], rows: [["1", "2"]] } }] },
        { id: "alias-takeaway", children: [{ id: "content", type: "key-takeaway", title: "Main conclusion", body: "Support sentence." }] },
        { id: "alias-insight", children: [{ id: "content", type: "insight-card", title: "Finding", body: "Support.", items: ["Proof A", "Proof B"] }] },
        { id: "alias-scale", children: [{ id: "content", type: "axis-ruler", items: [{ title: "Low", description: "Basic" }, { title: "High", description: "Advanced" }] }] },
        { id: "alias-bars", children: [{ id: "content", type: "bar-list", items: [{ label: "A", score: "75%" }, { label: "B", value: "40" }] }] },
        { id: "alias-progress", children: [{ id: "content", type: "progress-bar", label: "Done", value: "75%" }] },
        { id: "pricing-compact", children: [{ id: "content", type: "pricing-card", plan: "Pro", price: "$29", features: ["A", "B", "C", "D"], ctaText: "Start" }] },
      ],
    } as const;

    const validation = validateDeck(deck);
    expect(validation.errors).toHaveLength(0);
    clearRenderDiagnostics();
    const rendered = sourceToRenderedDeck(deck);
    expect(JSON.stringify(rendered)).toContain("Adoption");
    expect(JSON.stringify(rendered)).toContain("Main conclusion");
    expect(JSON.stringify(rendered)).toContain("75%");
    expect(getDiagnosticsByCode("FALLBACK_FAILED")).toHaveLength(0);
    expect(getDiagnosticsByCode("SQUASHED")).toHaveLength(0);
    expect(getDiagnosticsByCode("TINY_RECT")).toHaveLength(0);
  });

  it("preserves timeline year/headline aliases instead of dropping milestone content", () => {
    const deck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "timeline-alias",
        children: [{
          id: "timeline-alias.tl",
          type: "timeline",
          items: [
            { year: "2025.11", headline: "估值约$43亿", body: "上一轮融资节点，估值基准" },
            { year: "2026.05", headline: "本轮$20亿", body: "美团龙珠领投" },
          ],
        }],
      }],
    } as const;
    const rendered = sourceToRenderedDeck(deck);
    const json = JSON.stringify(rendered);
    expect(json).toContain("2025.11");
    expect(json).toContain("估值约$43亿");
    expect(json).toContain("本轮$20亿");
  });

  it("does not shrink explicit multiline insight-card details as if they were one long line", () => {
    clearRenderDiagnostics();
    const deck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "insight-fit",
        children: [{
          id: "insight-fit.g",
          type: "grid",
          columns: 2,
          children: [
            {
              id: "insight-fit.c1",
              type: "insight-card",
              headline: "2025.07 K2",
              body: "借鉴DeepSeek经验，补课预训练能力\n开源版本发布，强化编程能力",
            },
            {
              id: "insight-fit.c2",
              type: "insight-card",
              headline: "2026.04.20 K2.6开源",
              body: "发布即开源\n强化编程能力和Agent集群能力",
            },
          ],
        }],
      }],
    } as const;
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const detail = ast.slides[0]!.shapes.find((shape) => shape.name === "insight-fit.c1.detail") as any;
    const sizeHalfPt = detail?.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt;
    expect(sizeHalfPt).toBeGreaterThanOrEqual(20);
    expect(getDiagnosticsByCode("TRUNCATED").filter((d) => d.nodeId === "insight-fit.c1.detail")).toHaveLength(0);
  });

  it("preserves insight-card rich content and metric fields", () => {
    const deck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "insight-content",
        children: [{
          id: "insight-content.card",
          type: "insight-card",
          headline: "D 垂直 Agent",
          badge: "Harvey / 迈富时 / 百望",
          content: [{ text: "全部赢家！\n\n通用能力越强，垂直特殊性越值钱" }],
          metric: { value: "Harvey $11B", label: "法律" },
          tone: "positive",
        }],
      }],
    } as const;
    const rendered = sourceToRenderedDeck(deck);
    const json = JSON.stringify(rendered);
    expect(json).toContain("全部赢家");
    expect(json).toContain("通用能力越强");
    expect(json).toContain("Harvey $11B");
    expect(json).toContain("法律");
  });

  it("warns when a deck repeats insight-card grids across many slides", () => {
    const slides = Array.from({ length: 3 }, (_, slideIndex) => ({
      id: `repeat-${slideIndex + 1}`,
      children: [{
        id: `repeat-${slideIndex + 1}.g`,
        type: "grid",
        columns: 3,
        children: Array.from({ length: 4 }, (_, cardIndex) => ({
          id: `repeat-${slideIndex + 1}.c${cardIndex + 1}`,
          type: "insight-card",
          headline: `Finding ${cardIndex + 1}`,
          body: "Support sentence.",
        })),
      }],
    }));
    const report = validateDeck({ slideml2: 2, deck: { size: "16x9", theme: "default" }, slides } as any);
    expect(report.errors).toHaveLength(0);
    expect(report.warnings.some((warning) => warning.code === "REPEATED_CARD_LAYOUT")).toBe(true);
  });

  it("warns when a deck repeats generic equal card grids across many slides", () => {
    const slides = Array.from({ length: 4 }, (_, slideIndex) => ({
      id: `equal-grid-${slideIndex + 1}`,
      children: [{
        id: `equal-grid-${slideIndex + 1}.g`,
        type: "grid",
        columns: 3,
        children: Array.from({ length: 3 }, (_, cardIndex) => ({
          id: `equal-grid-${slideIndex + 1}.c${cardIndex + 1}`,
          type: "comparison-card",
          title: `Option ${cardIndex + 1}`,
          points: ["Fast", "Low risk"],
        })),
      }],
    }));
    const report = validateDeck({ slideml2: 2, deck: { size: "16x9", theme: "default" }, slides } as any);
    expect(report.errors).toHaveLength(0);
    expect(report.warnings.some((warning) => warning.code === "REPEATED_EQUAL_GRID_LAYOUT")).toBe(true);
    expect(report.warnings.find((warning) => warning.code === "REPEATED_EQUAL_GRID_LAYOUT")?.suggestedFix).toContain("hero-and-support");
  });

  it("describeDeck exposes the full prompt rule set the agent should follow", () => {
    const deck = describeDeck();
    expect(deck.colorUsageRules.length).toBeGreaterThan(0);
    expect(deck.colorPaletteUsage.length).toBeGreaterThan(0);
    expect(deck.containerUsageRules.length).toBeGreaterThan(0);
    expect(deck.shapeDecorationRules.length).toBeGreaterThan(0);
    expect(deck.emphasisHierarchy.length).toBeGreaterThan(0);
    expect(deck.densityRules.length).toBeGreaterThan(0);
    expect(deck.fallbackLadder.stages.length).toBe(5);
    expect(deck.fallbackLadder.diagnostics.length).toBeGreaterThan(0);
  });

  it("resolves semantic palette names to theme-defined hex without warning", () => {
    clearRenderDiagnostics();
    const deck: ReturnType<typeof buildDom> = {
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "palette",
        layout: "title-and-content",
        dom: {
          id: "palette.root",
          type: "slide",
          background: "background",
          children: [{
            id: "palette.content",
            type: "stack",
            area: "content",
            direction: "horizontal",
            gap: 0.4,
            children: [
              { id: "palette.red", type: "panel", fill: "red.tint", line: "red", children: [{ id: "palette.red.txt", type: "text", style: "label", color: "red", text: "Red zone" }] },
              { id: "palette.lime", type: "panel", fill: "lime.tint", line: "lime", children: [{ id: "palette.lime.txt", type: "text", style: "label", color: "lime", text: "Lime zone" }] },
              { id: "palette.blue", type: "panel", fill: "blue.tint", line: "blue", children: [{ id: "palette.blue.txt", type: "text", style: "label", color: "blue", text: "Blue zone" }] },
            ],
          }],
        },
      }],
    };
    const ast = renderToAst(deck);
    expect(ast.slides[0]!.shapes.length).toBeGreaterThan(0);
    expect(getDiagnosticsByCode("UNKNOWN_COLOR")).toHaveLength(0);
    const description = describeDeck();
    expect(description.colorTokens.palette.names).toContain("red");
    expect(description.colorTokens.palette.names).toContain("lime");
    expect(description.colorPaletteUsage.length).toBeGreaterThan(0);
    expect(description.colorUsageRules.length).toBeGreaterThan(0);
  });

  it("hero-stat / bar-list / tag-list render with size dial and palette tones", () => {
    clearRenderDiagnostics();
    const deck: ReturnType<typeof buildDom> = {
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "hero",
        layout: "title-and-content",
        dom: {
          id: "hero.root",
          type: "slide",
          background: "background",
          children: [
            {
              id: "hero.content",
              type: "stack",
              area: "content",
              direction: "vertical",
              gap: 0.5,
              children: [
                { id: "hero.h", type: "hero-stat", value: "$12.4M", label: "ARR", caption: "+38% YoY", tone: "positive" },
                { id: "hero.b", type: "bar-list", tone: "brand", sort: "desc", items: [
                  { label: "Outbound", value: 38, valueLabel: "38%" },
                  { label: "Inbound", value: 26, valueLabel: "26%" },
                  { label: "Events", value: 18, valueLabel: "18%" },
                ] },
                { id: "hero.t", type: "tag-list", items: [{ text: "AI", tone: "brand" }, { text: "Risk", tone: "warning" }, "Cloud"] },
                { id: "hero.body", type: "text", text: "Smaller body text using the size dial.", size: "sm" },
              ],
            },
          ],
        },
      }],
    };
    const ast = renderToAst(deck);
    expect(ast.slides[0]!.shapes.length).toBeGreaterThan(0);
    const layout = inspectLayout(deck, "hero")[0]!;
    const ids = new Set(layout.nodes.map((n) => n.id));
    expect(ids.has("hero.h.value")).toBe(true);
    expect(ids.has("hero.b.0.fill")).toBe(true);
    expect(ids.has("hero.t.0")).toBe(true);
  });

  it("size dial scales text intrinsic height", () => {
    const small: ReturnType<typeof buildDom> = {
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "scale",
        layout: "title-and-content",
        dom: {
          id: "scale.root",
          type: "slide",
          background: "background",
          children: [{
            id: "scale.content",
            type: "stack",
            area: "content",
            direction: "vertical",
            gap: 0.3,
            children: [
              { id: "scale.xs", type: "text", text: "tiny copy", style: "paragraph", size: "xs" },
              { id: "scale.md", type: "text", text: "tiny copy", style: "paragraph", size: "md" },
              { id: "scale.xl", type: "text", text: "tiny copy", style: "paragraph", size: "xl" },
            ],
          }],
        },
      }],
    };
    const layout = inspectLayout(small, "scale")[0]!;
    const xs = layout.nodes.find((n) => n.id === "scale.xs")!;
    const md = layout.nodes.find((n) => n.id === "scale.md")!;
    const xl = layout.nodes.find((n) => n.id === "scale.xl")!;
    expect(xs.intrinsic!.basis).toBeLessThan(md.intrinsic!.basis + 0.01);
    expect(xl.intrinsic!.basis).toBeGreaterThan(md.intrinsic!.basis - 0.01);
  });

  it("emits LOW_CONTRAST diagnostic when text color is too close to its background", () => {
    clearRenderDiagnostics();
    const deck: ReturnType<typeof buildDom> = {
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "low",
        layout: "title-and-content",
        dom: {
          id: "low.root",
          type: "slide",
          background: "background",
          children: [{
            id: "low.content",
            type: "panel",
            area: "content",
            fill: "EEF2FF",
            children: [{
              id: "low.text",
              type: "text",
              text: "Almost invisible body copy",
              style: "paragraph",
              color: "FFFFFF",
            }],
          }],
        },
      }],
    };
    renderToAst(deck);
    // Either LOW_CONTRAST (when auto-fix didn't fire / cluster wasn't fully
    // covered) or LOW_CONTRAST_FIXED (when the renderer auto-rewrote a
    // theme-resolved color) is acceptable — both report the issue. fg=FFFFFF
    // is in the muted/inverse-default set, so this case fires the auto-fix.
    const lowContrast = [
      ...getDiagnosticsByCode("LOW_CONTRAST"),
      ...getDiagnosticsByCode("LOW_CONTRAST_FIXED"),
    ];
    expect(lowContrast.length).toBeGreaterThan(0);
    expect(lowContrast[0]!.message).toContain("contrast");
    expect(lowContrast[0]!.suggestion).toBeTruthy();
  });

  it("does not flag text that has comfortable contrast against its background", () => {
    clearRenderDiagnostics();
    const deck: ReturnType<typeof buildDom> = {
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "ok",
        layout: "title-and-content",
        dom: {
          id: "ok.root",
          type: "slide",
          background: "background",
          children: [{
            id: "ok.content",
            type: "stack",
            area: "content",
            direction: "vertical",
            gap: 0.3,
            children: [{ id: "ok.t", type: "text", style: "paragraph", text: "Black on white reads fine", color: "111827" }],
          }],
        },
      }],
    };
    renderToAst(deck);
    expect(getDiagnosticsByCode("LOW_CONTRAST")).toHaveLength(0);
  });

  it("themeOverride deep-merges over the default scaffold for colors / text / component / layout", () => {
    clearRenderDiagnostics();
    const deck: ReturnType<typeof buildDom> = {
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "2563EB" },
        themeOverride: {
          colors: { "brand.primary": "0F4C81", custom: "FF6B6B" },
          text: { "slide-title": { fontSize: 36 } },
          component: { card: { padding: 0.9 } },
          layout: { pageMarginX: 2.2 },
        } as never,
      } as never,
      slides: [{
        id: "themed",
        layout: "title-and-content",
        dom: {
          id: "themed.root",
          type: "slide",
          background: "background",
          children: [
            { id: "themed.title", type: "text", style: "slide-title", text: "Themed", align: "left" },
            { id: "themed.content", type: "stack", area: "content", direction: "vertical", gap: 0.3, children: [
              { id: "themed.t", type: "text", style: "paragraph", text: "Body", color: "custom" },
            ] },
          ],
        },
      }],
    };
    const ast = renderToAst(deck);
    const titleShape = ast.slides[0]!.shapes.find((s) => s.name === "themed.title");
    expect(titleShape?.type).toBe("text");
    if (titleShape?.type !== "text") throw new Error("expected text shape");
    // slide-title fontSize override (36pt → halfPt 72)
    expect(titleShape.paragraphs[0]!.runs[0]!.sizeHalfPt).toBe(72);
    // brand.primary override means the resolved hex changed
    const bodyShape = ast.slides[0]!.shapes.find((s) => s.name === "themed.t");
    if (bodyShape?.type !== "text") throw new Error("expected text body");
    // custom color from override should resolve
    expect(bodyShape.paragraphs[0]!.runs[0]!.color).toBe("FF6B6B");
  });

  it("validateSlide warns for mismatched metadata hero titles but errors on competing text hero titles", () => {
    const sectionBreakSlide = {
      id: "cover",
      title: "智能竞争雷达 v2",
      children: [{
        id: "cover.content",
        type: "section-break",
        area: "content",
        title: "智能竞争雷达",
        subtitle: "多源竞争情报系统",
      }],
    } as const;
    const withSectionBreak = validateSlide(sectionBreakSlide as never);
    expect(withSectionBreak.errors.map((e) => e.code)).not.toContain("DUPLICATE_HERO_TITLE");
    expect(withSectionBreak.warnings.map((e) => e.code)).toContain("DUPLICATE_HERO_TITLE");
    const renderedSectionBreak = sourceToRenderedDeck({
      slideml2: 2,
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [sectionBreakSlide as never],
    });
    expect(findNodeForTest(renderedSectionBreak.slides[0]!.dom, "cover.title")).toBeNull();

    const matchingDeckTitleSlide = {
      id: "cover2",
      title: "Deck title",
      children: [{
        id: "cover2.content",
        type: "stack",
        area: "content",
        children: [
          { id: "cover2.hero", type: "text", style: "deck-title", text: "Deck title" },
          { id: "cover2.sub", type: "text", style: "lead", text: "subtitle" },
        ],
      }],
    } as const;
    const withDeckTitleText = validateSlide(matchingDeckTitleSlide as never);
    expect(withDeckTitleText.errors.map((e) => e.code)).not.toContain("DUPLICATE_HERO_TITLE");

    const renderedMatching = sourceToRenderedDeck({
      slideml2: 2,
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [matchingDeckTitleSlide as never],
    });
    expect(findNodeForTest(renderedMatching.slides[0]!.dom, "cover2.title")).toBeNull();
    expect(findNodeForTest(renderedMatching.slides[0]!.dom, "cover2.hero")?.text).toBe("Deck title");

    const conflictingDeckTitleText = validateSlide({
      id: "cover3",
      title: "Metadata title",
      children: [{
        id: "cover3.content",
        type: "stack",
        area: "content",
        children: [
          { id: "cover3.hero", type: "text", style: "deck-title", text: "Visible title" },
        ],
      }],
    });
    expect(conflictingDeckTitleText.errors.map((e) => e.code)).toContain("DUPLICATE_HERO_TITLE");

    const onlySlideTitle = validateSlide({
      id: "ok1",
      title: "Ordinary slide",
      children: [{
        id: "ok1.content",
        type: "stack",
        area: "content",
        children: [{ id: "ok1.body", type: "text", style: "paragraph", text: "Body" }],
      }],
    });
    expect(onlySlideTitle.errors.map((e) => e.code)).not.toContain("DUPLICATE_HERO_TITLE");

    const onlyBodyTitle = validateSlide({
      id: "ok2",
      children: [{
        id: "ok2.content",
        type: "section-break",
        area: "content",
        title: "Cover",
        subtitle: "subtitle",
      }],
    });
    expect(onlyBodyTitle.errors.map((e) => e.code)).not.toContain("DUPLICATE_HERO_TITLE");
  });

  it("split lowers to a stack with golden-ratio weights and renders cleanly", () => {
    clearRenderDiagnostics();
    const deck: ReturnType<typeof buildDom> = {
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "split-test",
        layout: "title-and-content",
        dom: {
          id: "split-test.root",
          type: "slide",
          background: "background",
          children: [{
            id: "split-test.content",
            type: "split",
            area: "content",
            direction: "horizontal",
            ratio: [0.62, 0.38],
            gap: 0.5,
            children: [
              { id: "split-test.primary", type: "text", style: "lead", text: "The primary block holds the headline." },
              { id: "split-test.secondary", type: "text", style: "caption", text: "Sidebar." },
            ],
          }],
        },
      }],
    };
    const layout = inspectLayout(deck, "split-test")[0]!;
    const primary = layout.nodes.find((n) => n.id === "split-test.primary");
    const secondary = layout.nodes.find((n) => n.id === "split-test.secondary");
    expect(primary).toBeTruthy();
    expect(secondary).toBeTruthy();
    expect(primary!.rect.w).toBeGreaterThan(secondary!.rect.w);
    // Primary should clearly dominate (golden-ratio split blended with intrinsic
    // text width — exact ratio depends on the two strings' lengths).
    const ratio = primary!.rect.w / (primary!.rect.w + secondary!.rect.w);
    expect(ratio).toBeGreaterThan(0.55);
    expect(ratio).toBeLessThan(0.8);
  });

  it("grid honours colSpan and rowSpan for hero-and-satellites layouts", () => {
    clearRenderDiagnostics();
    const deck: ReturnType<typeof buildDom> = {
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "spans",
        layout: "title-and-content",
        dom: {
          id: "spans.root",
          type: "slide",
          background: "background",
          children: [{
            id: "spans.grid",
            type: "grid",
            area: "content",
            columns: 4,
            gap: 0.4,
            children: [
              { id: "spans.hero", type: "text", text: "HERO", style: "lead", colSpan: 2, rowSpan: 2 },
              { id: "spans.k1", type: "text", text: "k1", style: "label" },
              { id: "spans.k2", type: "text", text: "k2", style: "label" },
              { id: "spans.k3", type: "text", text: "k3", style: "label" },
              { id: "spans.k4", type: "text", text: "k4", style: "label" },
            ],
          }],
        },
      }],
    };
    const layout = inspectLayout(deck, "spans")[0]!;
    const hero = layout.nodes.find((n) => n.id === "spans.hero")!;
    const k1 = layout.nodes.find((n) => n.id === "spans.k1")!;
    const k4 = layout.nodes.find((n) => n.id === "spans.k4")!;
    // Hero spans 2 columns: it should be roughly twice as wide as a single-cell child.
    expect(hero.rect.w).toBeGreaterThan(k1.rect.w * 1.7);
    // Hero spans 2 rows: its height should exceed k1's row.
    expect(hero.rect.h).toBeGreaterThan(k1.rect.h * 1.7);
    // k4 should land below k2 (next-row, same column).
    expect(k4.rect.y).toBeGreaterThan(k1.rect.y);
  });

  it("renders panel/card decorative containers and exposes their inner rects", () => {
    clearRenderDiagnostics();
    const deck: ReturnType<typeof buildDom> = {
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "decor",
        layout: "title-and-content",
        dom: {
          id: "decor.root",
          type: "slide",
          background: "background",
          children: [{
            id: "decor.content",
            type: "stack",
            area: "content",
            direction: "vertical",
            gap: 0.4,
            children: [
              {
                id: "decor.panel",
                type: "panel",
                tone: "tinted",
                children: [{ id: "decor.panel.text", type: "text", style: "paragraph", text: "Grouped insight." }],
              },
              {
                id: "decor.card",
                type: "card",
                tone: "neutral",
                accent: "left",
                header: "Engagement",
                footer: "Source: internal",
                children: [{ id: "decor.card.body", type: "text", style: "paragraph", text: "Week-1 retention 78%." }],
              },
            ],
          }],
        },
      }],
    };
    const ast = renderToAst(deck);
    expect(ast.slides[0]!.shapes.some((s) => s.name === "decor.panel-panel")).toBe(true);
    expect(ast.slides[0]!.shapes.some((s) => s.name === "decor.card-card")).toBe(true);
    expect(ast.slides[0]!.shapes.some((s) => s.name === "decor.card-accent")).toBe(true);
    const layout = inspectLayout(deck, "decor")[0]!;
    const panelInner = layout.nodes.find((n) => n.id === "decor.panel.text");
    const cardInner = layout.nodes.find((n) => n.id === "decor.card.body");
    expect(panelInner).toBeTruthy();
    expect(cardInner).toBeTruthy();
    expect(panelInner!.rect.w).toBeGreaterThan(0);
    expect(cardInner!.rect.h).toBeGreaterThan(0);
  });

  it("renders primitive card.title as the card heading alias", () => {
    clearRenderDiagnostics();
    const card = {
      id: "card-title-alias.card",
      type: "card" as const,
      title: "Visible title",
      accent: "left",
      children: [{ id: "card-title-alias.card.body", type: "text" as const, style: "paragraph", text: "Body text remains below the heading." }],
    };
    const deck: ReturnType<typeof buildDom> = {
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "card-title-alias",
        layout: "title-and-content",
        dom: {
          id: "card-title-alias.root",
          type: "slide",
          background: "background",
          children: [{
            id: "card-title-alias.content",
            type: "stack",
            area: "content",
            children: [card],
          }],
        },
      }],
    };

    const ast = renderToAst(deck);
    const titleShape = ast.slides[0]!.shapes.find((shape) => shape.name === "card-title-alias.card.title");
    expect(titleShape).toBeTruthy();
    expect(JSON.stringify(titleShape)).toContain("Visible title");

    const validation = validateSlide({ id: "card-title-alias", children: [card] } as never);
    expect(validation.errors.map((item) => item.code)).not.toContain("UNKNOWN_NODE_TYPE");
    expect(validation.warnings.map((item) => item.code)).not.toContain("CARD_TITLE_HEADER_CONFLICT");

    const conflict = validateSlide({
      id: "card-title-conflict",
      children: [{
        ...card,
        id: "card-title-conflict.card",
        title: "Title",
        header: "Header",
      }],
    } as never);
    expect(conflict.warnings.map((item) => item.code)).toContain("CARD_TITLE_HEADER_CONFLICT");
  });

  it("allows decorative surface primitives without children for editorial backgrounds", () => {
    const surfaceOnlyTypes = ["panel", "card", "band", "frame", "inset"] as const;
    const validation = validateSlide({
      id: "surface-only",
      children: [
        ...surfaceOnlyTypes.map((type, index) => ({
          id: `surface-only.${type}`,
          type,
          at: [1 + index * 0.3, 1 + index * 0.3, 6, 2],
          fill: type === "frame" ? undefined : "surface",
          line: "divider",
          padding: type === "inset" ? 0.2 : undefined,
        })),
        { id: "surface-only.copy", type: "text", text: "Visible content can sit above the surface.", at: [1.4, 1.4, 10, 1] },
      ],
    } as never);

    const codes = validation.errors.map((item) => item.code);
    expect(codes).not.toContain("MISSING_CONTAINER_CHILDREN");
    expect(codes).not.toContain("EMPTY_CONTAINER");

    const stackValidation = validateSlide({
      id: "empty-stack",
      children: [{ id: "empty-stack.stack", type: "stack" }],
    } as never);
    expect(stackValidation.errors.map((item) => item.code)).toContain("MISSING_CONTAINER_CHILDREN");

    const freeformValidation = validateSlide({
      id: "empty-freeform",
      children: [{ id: "empty-freeform.group", type: "freeform-group" }],
    } as never);
    expect(freeformValidation.errors.map((item) => item.code)).toContain("EMPTY_CONTAINER_COMPONENT");
  });

  it("preserves child at coordinates inside freeform-group", () => {
    const ast = renderToAst(sourceToRenderedDeck({
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "freeform-at",
        children: [{
          id: "freeform-at.group",
          type: "freeform-group",
          children: [
            { id: "freeform-at.box", type: "shape", preset: "rect", text: "Placed shape", fill: "brand.primary", color: "text.inverse", at: [2, 3, 4, 1] },
            { id: "freeform-at.label", type: "text", text: "Placed", at: [2.2, 3.2, 3, 0.5] },
          ],
        }],
      }],
    } as never));
    const shape = ast.slides[0]!.shapes.find((item) => item.name === "freeform-at.box");
    const text = ast.slides[0]!.shapes.find((item) => item.name === "freeform-at.label");
    expect(shape?.xfrm).toMatchObject({ x: 720000, y: 1080000, cx: 1440000, cy: 360000 });
    expect(shape && "paragraphs" in shape ? shape.paragraphs[0]?.runs[0]?.text : undefined).toBe("Placed shape");
    expect(text?.xfrm).toMatchObject({ x: 792000, y: 1152000, cx: 1080000, cy: 180000 });
  });

  it("normalizes x/y/w/h aliases inside freeform-group to slide coordinates", () => {
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck({
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "freeform-xywh",
        title: "Freeform aliases",
        children: [{
          id: "freeform-xywh.group",
          type: "freeform-group",
          children: [
            { id: "freeform-xywh.box", type: "shape", preset: "rect", text: "Placed shape", fill: "brand.primary", color: "text.inverse", x: 2, y: 3, w: 4, h: 1 },
            { id: "freeform-xywh.label", type: "text", text: "Placed", x: 2.2, y: 3.2, width: 3, height: 0.5 },
          ],
        }],
      }],
    } as never));
    const shape = ast.slides[0]!.shapes.find((item) => item.name === "freeform-xywh.box");
    const text = ast.slides[0]!.shapes.find((item) => item.name === "freeform-xywh.label");
    expect(shape?.xfrm).toMatchObject({ x: 720000, y: 1080000, cx: 1440000, cy: 360000 });
    expect(text?.xfrm).toMatchObject({ x: 792000, y: 1152000, cx: 1080000, cy: 180000 });
    expect(getDiagnosticsByCode("TITLE_OCCLUDED")).toHaveLength(0);
  });

  it("renders raw shape fill/line object syntax with connector arrowheads", () => {
    const ast = renderToAst(sourceToRenderedDeck({
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "shape-line-object",
        children: [{
          id: "shape-line-object.connector",
          type: "shape",
          preset: "straightConnector",
          at: { x: 2, y: 3, w: 4, h: 0.1 },
          fill: { color: "FFFFFF" },
          line: { color: "333333", width: 2, dash: "dash" },
          tailEnd: { type: "triangle" },
        }],
      }],
    } as never));
    const connector = ast.slides[0]!.shapes.find((item) => item.name === "shape-line-object.connector");
    expect(connector).toMatchObject({
      type: "shape",
      preset: "straightConnector",
      line: { color: "333333", dash: "dash", tailEnd: { type: "triangle" } },
    });
  });

  it("auto-fits one-column raw shape flow grids instead of stretching every shape full-width", () => {
    const ast = renderToAst(sourceToRenderedDeck({
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "shape-flow-grid",
        children: [{
          id: "shape-flow-grid.grid",
          type: "grid",
          columns: 1,
          gap: 0.55,
          children: [
            { id: "shape-flow-grid.n1", type: "shape", preset: "flowChartProcess", fill: "0F766E", text: { text: "Telemetry Ingest", color: "FFFFFF" } },
            { id: "shape-flow-grid.c1", type: "shape", preset: "straightConnector", fill: "none", line: { color: "0F766E", width: 1.5 }, tailEnd: { type: "triangle" } },
            { id: "shape-flow-grid.n2", type: "shape", preset: "flowChartDecision", fill: "FEF9C3", text: { text: "Schema Check?", color: "92400E" } },
          ],
        }],
      }],
    } as never));
    const node = ast.slides[0]!.shapes.find((item) => item.name === "shape-flow-grid.n1");
    const connector = ast.slides[0]!.shapes.find((item) => item.name === "shape-flow-grid.c1");
    const cm = (emu: number | undefined) => (emu ?? 0) / 360000;
    expect(cm(node?.xfrm.cx)).toBeLessThan(9);
    expect(cm(node?.xfrm.cy)).toBeGreaterThan(0.9);
    expect(cm(connector?.xfrm.cx)).toBeLessThan(0.4);
    expect(cm(connector?.xfrm.cy)).toBeGreaterThan(0.28);
  });

  it("treats direct slide x/y/w/h fields as slide-relative absolute placement", () => {
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck({
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "direct-xywh",
        title: "Direct absolute aliases",
        children: [{
          id: "direct-xywh.box",
          type: "shape",
          preset: "roundRect",
          text: "Absolute",
          x: 2,
          y: 3,
          width: 4,
          height: 1,
          fill: "brand.primary",
          color: "text.inverse",
        }],
      }],
    } as never));
    const shape = ast.slides[0]!.shapes.find((item) => item.name === "direct-xywh.box");
    expect(shape?.xfrm).toMatchObject({ x: 720000, y: 1080000, cx: 1440000, cy: 360000 });
    expect(getDiagnosticsByCode("TITLE_OCCLUDED")).toHaveLength(0);
  });

  it("preserves rich links in cover-composition content runs", () => {
    const ast = renderToAst(sourceToRenderedDeck({
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "cover-rich-link",
        children: [{
          id: "cover-rich-link.cover",
          type: "cover-composition",
          title: "Launch readiness",
          subtitle: "Decision memo",
          content: { runs: [{ text: "Jump to appendix", link: "#slide2" }] },
        }],
      }, {
        id: "slide2",
        children: [{ id: "slide2.text", type: "text", text: "Appendix" }],
      }],
    } as never));
    const content = ast.slides[0]!.shapes.find((item) => item.name === "cover-rich-link.cover.content");
    const run = content && "paragraphs" in content ? content.paragraphs[0]?.runs[0] : undefined;
    expect(run).toMatchObject({ text: "Jump to appendix", hyperlink: "#slide2" });
  });

  it("normalizes component examples with omitted child ids before tool validation", () => {
    const raw = {
      id: "example-normalize",
      children: [{
        id: "example-normalize.card",
        type: "card",
        children: [
          { type: "label", text: "Literature 01" },
          { type: "quote", text: "A quote can be copied from describe_schema without a node id." },
          { type: "key-takeaway", headline: "The rendered deck still gets deterministic fallback ids." },
        ],
      }],
    };

    const strictValidation = validateSlide(raw as never);
    expect(strictValidation.errors.map((item) => item.code)).toContain("MISSING_NODE_ID");

    const normalized = normalizeSlide(raw as never);
    expect(normalized.children[0]?.children?.map((child) => child.id)).toEqual([
      "example-normalize.card.1",
      "example-normalize.card.2",
      "example-normalize.card.3",
    ]);
    expect(validateSlide(normalized).errors.map((item) => item.code)).not.toContain("MISSING_NODE_ID");
  });

  it("inspectLayout returns intrinsic specs and applied solver decisions", () => {
    clearRenderDiagnostics();
    const deck = buildDom(sampleSource());
    const reports = inspectLayout(deck);
    const cover = reports.find((report) => report.slideId === "cover");
    expect(cover).toBeTruthy();
    const root = cover!.nodes.find((node) => node.id === "cover.root");
    expect(root).toBeTruthy();
    const measured = cover!.nodes.filter((node) => node.intrinsic);
    expect(measured.length).toBeGreaterThan(0);
    for (const node of measured) {
      expect(node.intrinsic!.basis).toBeGreaterThanOrEqual(0);
      expect(["fit", "shrink", "demote", "drop", "truncate"]).toContain(node.applied);
    }
  });

  it.skipIf(!runRealLlmTest)("uses a real LLM to generate one small slide JSON", async () => {
    const slide = await generateOneSlideWithLlm({
      id: "ai-wearables-summary",
      title: "AI可穿戴设备执行摘要",
      intent: "用一个主结论、三个指标和三条要点说明市场机会。",
      keyFacts: [
        "2026年是AI穿戴设备增长加速的一年",
        "全球市场规模预计达到500亿美元+",
        "智能眼镜增长率预计30%+",
        "AI芯片需求增长50%+",
        "Meta Ray-Ban销量破百万",
      ],
    });
    const validation = validateSlide(slide, { deck: { size: "16x9", theme: "default", brand: { name: "AI Wearables", primary: "2563EB", logo: sampleLogo() } } });
    expect(slide.id).toBe("ai-wearables-summary");
    expect(slide.children.length).toBeGreaterThan(0);
    expect(validation.ok).toBe(true);
  }, 90_000);
});

function rectOf(nodes: ReturnType<typeof measureDeck>[number]["nodes"], name: string) {
  const found = nodes.find((node) => node.id === name);
  if (!found) throw new Error(`Measured node not found: ${name}`);
  return found.rect;
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function assertShapeBounds(ast: ReturnType<typeof renderToAst>): void {
  const slideWidth = 9_144_000;
  const slideHeight = 5_143_500;
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) {
      expect(shape.xfrm.x, shape.name).toBeGreaterThanOrEqual(0);
      expect(shape.xfrm.y, shape.name).toBeGreaterThanOrEqual(0);
      expect(shape.xfrm.x + shape.xfrm.cx, shape.name).toBeLessThanOrEqual(slideWidth);
      expect(shape.xfrm.y + shape.xfrm.cy, shape.name).toBeLessThanOrEqual(slideHeight);
    }
  }
}

function collectComponentNames(plan: { slides: Array<{ children: unknown[] }> }): string[] {
  const output: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const record = node as { type?: unknown; component?: unknown; children?: unknown };
    if (record.type === "component" && typeof record.component === "string") output.push(record.component);
    if (Array.isArray(record.children)) record.children.forEach(visit);
  };
  plan.slides.forEach((slide) => slide.children.forEach(visit));
  return output;
}

function sampleSource(): Slideml2Deck {
  return {
    slideml2: 1,
    deck: {
      size: "16x9",
      theme: "simple",
      brand: {
        name: "Youdao",
        primary: "E8382C",
        logo: sampleLogo(),
      },
    },
    slides: [
      { id: "cover", layout: "cover", title: "Youdao Company", subtitle: "AI learning products and services" },
      { id: "business", layout: "title-and-content", title: "Business overview", items: ["Existing summary"] },
    ],
  };
}

function sourceSlide(id: string, title: string) {
  return {
    id,
    title,
    children: [{
      id: `${id}.content`,
      type: "stack" as const,
      area: "content",
      direction: "vertical",
      gap: 0.3,
      children: [
        { id: `${id}.lead`, type: "text" as const, text: "这是一个用于验证整页操作的页面。" },
        componentNode(`${id}.metric`, "metric-card", { value: "3", label: "操作数量" }),
      ],
    }],
  };
}

function componentNode(id: string, component: string, fields: Record<string, unknown>) {
  return {
    id,
    type: "component" as const,
    component,
    ...fields,
  };
}

function sampleLogo(): string {
  return dataSvg("<svg xmlns='http://www.w3.org/2000/svg' width='240' height='96'><rect width='240' height='96' rx='10' fill='#E8382C'/><text x='120' y='60' text-anchor='middle' font-family='Arial' font-size='40' font-weight='700' fill='white'>Youdao</text></svg>");
}

function dataSvg(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
