import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
  type LayoutDiagnostic,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { validateDeck, validateSlide } from "./validate.js";
import { findNode } from "./inspect.js";
import { expandComponent } from "./component-registry.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Regressions pinned from the uehi0g debug log
 * (`/Users/river/.cowork/debug-logs/2026-05-08T00-30-34-472-uehi0g/`).
 * Each `it` reproduces ONE class of bug observed in that run, so future
 * component refactors can't silently re-introduce them.
 */

const BLOCKING_CODES: ReadonlySet<LayoutDiagnostic["code"]> = new Set<LayoutDiagnostic["code"]>([
  "FALLBACK_FAILED",
  "COLLISION",
  "TINY_RECT",
  "SQUASHED",
  "LOW_CONTRAST",
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

function blocking(): LayoutDiagnostic[] {
  return getRenderDiagnostics().filter((d) => BLOCKING_CODES.has(d.code) && d.severity !== "info");
}

describe("uehi0g regressions", () => {
  it("5 callouts in a vertical stack render without FALLBACK_FAILED (auto-densify)", () => {
    // Original failure: 5-callout vstack on slide 19 produced 25 blocking
    // diagnostics (5×FALLBACK_FAILED + 10×SQUASHED + 10×TINY_RECT).
    // Fix: render's densifyCalloutSiblings stamps density:"compact" on
    // callouts whose stack/grid sibling count ≥ 4, and the callout factory
    // honors compact (drops accent shape, tighter padding, smaller body
    // style) so all 5 actually fit the standard ~10cm content area.
    const slide: SlideV2 = {
      id: "uehi0g-s19",
      title: "5条关键警示与红线",
      children: [{
        id: "uehi0g-s19.callouts",
        type: "stack",
        children: [
          { id: "uehi0g-s19.c1", type: "callout", title: "红线1：Manus 案例", body: "先国内后出海路径已死。Day 1 海外架构。", tone: "danger", variant: "card" },
          { id: "uehi0g-s19.c2", type: "callout", title: "红线2：中国基建市场", body: "15年规律：巨头垂直集成。无独立基建 SaaS。", tone: "danger", variant: "card" },
          { id: "uehi0g-s19.c3", type: "callout", title: "红线3：横向通用窗口关闭", body: "Cursor / Claude Code / 扣子已锁定。", tone: "warning", variant: "card" },
          { id: "uehi0g-s19.c4", type: "callout", title: "红线4：法律 / 反爬", body: "Cohere 案 + Cloudflare 屏蔽 AI 爬虫。", tone: "warning", variant: "card" },
          { id: "uehi0g-s19.c5", type: "callout", title: "红线5：模型定价归零", body: "DeepSeek V4 ¥0.02/M tokens。", tone: "warning", variant: "card" },
        ] as DomNode[],
      }],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    expect(blocking().map((d) => `${d.code} ${d.nodeId}: ${d.message}`).join("\n")).toBe("");
  });

  it("warning-list with 5 red-lines renders cleanly (the canonical replacement for the callout stack)", () => {
    const slide: SlideV2 = {
      id: "uehi0g-s19-warning",
      title: "5条关键警示与红线",
      children: [{
        id: "uehi0g-s19-warning.list",
        type: "warning-list",
        items: [
          { headline: "红线1：Manus 案例", detail: "先国内后出海路径已死。Day 1 海外架构。", tone: "danger" },
          { headline: "红线2：中国基建市场", detail: "15年规律：巨头垂直集成。", tone: "danger" },
          { headline: "红线3：横向通用窗口关闭", detail: "Cursor / Claude Code / 扣子已锁定。", tone: "warning" },
          { headline: "红线4：法律 / 反爬", detail: "Cohere 案 + Cloudflare 屏蔽 AI 爬虫。", tone: "warning" },
          { headline: "红线5：模型定价归零", detail: "DeepSeek V4 ¥0.02/M tokens。", tone: "warning" },
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    expect(blocking().map((d) => `${d.code} ${d.nodeId}`).join("\n")).toBe("");
  });

  it("matrix-2x2 with quadrantLabels only (no items) passes validation and renders", () => {
    // Original failure: agent wrote {quadrantLabels:{tl,tr,bl,br}, ...}
    // and was rejected with MISSING_REQUIRED_FIELD: matrix-2x2 requires items.
    // Fix: items now optional; either items or quadrantLabels must be set.
    const deck: Slideml2SourceDeck = buildDeckWithSlide({
      id: "uehi0g-s3",
      title: "判断1：Coding Agent 是入口",
      children: [{
        id: "uehi0g-s3.matrix",
        type: "matrix-2x2",
        xAxis: { low: "Coding Agent", high: "Office Agent" },
        yAxis: { low: "开发者市场", high: "白领市场" },
        quadrantLabels: {
          tl: "TAM $150 亿/年",
          tr: "TAM $3000 亿/年",
          bl: "Cursor / Claude Code",
          br: "通用 SaaS 被降级为数据后端",
        },
        quadrantTones: { tr: "positive", br: "warning" },
      } as unknown as DomNode],
    });
    const validation = validateDeck(deck);
    expect(validation.errors.filter((e) => e.code === "MISSING_REQUIRED_FIELD")).toHaveLength(0);
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck));
    expect(blocking().map((d) => d.code).join(",")).toBe("");
  });

  it("matrix-2x2 preserves neutral quadrantTones through component expansion", () => {
    const deck: Slideml2SourceDeck = buildDeckWithSlide({
      id: "uehi0g-neutral-matrix",
      children: [{
        id: "uehi0g-neutral-matrix.matrix",
        type: "matrix-2x2",
        xAxis: { low: "Low", high: "High" },
        yAxis: { low: "Low", high: "High" },
        quadrantLabels: { tl: "Top left", tr: "Top right", bl: "Neutral cell", br: "Bottom right" },
        quadrantTones: { bl: "neutral" },
      } as unknown as DomNode],
    });

    const expanded = expandComponent("uehi0g-neutral-matrix", deck.slides[0]!.children![0]!);
    const neutralCell = findNode(expanded, "uehi0g-neutral-matrix.matrix.bl");

    expect(neutralCell?.fill).toBe("surface.subtle");
    expect(neutralCell?.line).toBe("divider");
  });

  it("matrix-2x2 with neither items nor quadrantLabels produces a clear error", () => {
    const slide: SlideV2 = {
      id: "uehi0g-s3-empty",
      children: [{
        id: "uehi0g-s3-empty.matrix",
        type: "matrix-2x2",
        xAxis: { low: "x-low", high: "x-high" },
        yAxis: { low: "y-low", high: "y-high" },
      } as unknown as DomNode],
    };
    const report = validateSlide(slide);
    const missing = report.errors.filter((i) => i.code === "MISSING_REQUIRED_FIELD" && /quadrantLabels/.test(i.message));
    expect(missing).toHaveLength(1);
  });

  it("key-takeaway with inline numbered detail auto-splits to bullets", () => {
    // Original failure: agent passed detail:"1. 私有化 Agent 中台 2. 跨平台中立中间件 3. 开源 + 出海"
    // — rendered as a single wrapped paragraph. Fix: registry-level split
    // detects inline numeric/semicolon list shapes and converts to bullets.
    const deck = buildDeckWithSlide({
      id: "uehi0g-s5",
      children: [{
        id: "uehi0g-s5.takeaway",
        type: "key-takeaway",
        headline: "真正的中国 Agent infra 机会",
        detail: "1. 私有化 Agent 中台（第四范式路径）2. 跨平台中立中间件（Eval/Identity）3. 开源 + 出海（Zilliz/Sider 路径）",
        tone: "warning",
        variant: "panel",
      } as unknown as DomNode],
    });
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const slide = ast.slides[0]!;
    // The single-paragraph "detail" text node should NOT exist; instead a
    // bullets node carries 3 separate items.
    const bulletShape = slide.shapes.find((s) => {
      const name = (s as { name?: string }).name || "";
      return name.endsWith(".bullets") && name.includes("takeaway");
    }) as { paragraphs?: Array<{ runs: Array<{ text?: string }> }> } | undefined;
    expect(bulletShape, "expected bullets shape from auto-split detail").toBeTruthy();
    expect(bulletShape!.paragraphs!.length).toBe(3);
  });

  it("key-takeaway points alias renders as bullets", () => {
    const deck = buildDeckWithSlide({
      id: "uehi0g-s5-points",
      children: [{
        id: "uehi0g-s5-points.kt",
        type: "key-takeaway",
        headline: "三个机会",
        points: ["私有化中台", "跨平台中间件", "开源出海"],
      } as unknown as DomNode],
    });
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const slide = ast.slides[0]!;
    const bulletShape = slide.shapes.find((s) => {
      const name = (s as { name?: string }).name || "";
      return name.endsWith(".bullets") && name.includes("kt");
    }) as { paragraphs?: Array<{ runs: Array<{ text?: string }> }> } | undefined;
    expect(bulletShape).toBeTruthy();
    expect(bulletShape!.paragraphs!.length).toBe(3);
  });

  it("text node with embedded bullet runs surfaces TEXT_LOOKS_LIKE_BULLETS warning", () => {
    // Original failure: agent put `text:"• A\n• B\n• C"` inside a panel.
    // Fix: validator flags multi-line bullet-shaped text nodes.
    const slide: SlideV2 = {
      id: "uehi0g-s6",
      children: [{
        id: "uehi0g-s6.panel",
        type: "panel",
        children: [{
          id: "uehi0g-s6.items",
          type: "text",
          text: "• 通用 office Agent\n• 垂直行业 Agent\n• 个人/团队 productivity",
        }] as DomNode[],
      } as unknown as DomNode],
    };
    const report = validateSlide(slide);
    const flagged = [...report.errors, ...report.warnings, ...report.info].filter((i) => i.code === "TEXT_LOOKS_LIKE_BULLETS");
    expect(flagged.length).toBeGreaterThanOrEqual(1);
  });

  it("plain text with newline-separated records surfaces multiline-list warning", () => {
    const slide: SlideV2 = {
      id: "uehi0g-multiline-records",
      children: [{
        id: "uehi0g-multiline-records.card",
        type: "card",
        children: [{
          id: "uehi0g-multiline-records.text",
          type: "text",
          style: "caption",
          text: "垂直行业 Agent — 中国★★★★★ 出海★★★★\n出海 Productivity SaaS — Day 1 海外架构 ★★★★★\n私有化 Agent 中台 — 第四范式路径 ★★★★★",
        } as unknown as DomNode],
      } as unknown as DomNode],
    };
    const report = validateSlide(slide);
    const flagged = [...report.errors, ...report.warnings, ...report.info].filter((i) => i.code === "TEXT_LOOKS_LIKE_MULTILINE_LIST");
    expect(flagged.length).toBeGreaterThanOrEqual(1);
  });

  it("multi-line text intrinsic height grows with newline count", () => {
    // Original failure: text with embedded \n was sized as one wrapped line,
    // overflow swallowed by autoFit shrink. Fix: textIntrinsicHeight sums
    // wrap counts per hard segment, so the layout solver allocates room
    // for each line. Verify by comparing two slides where one text has
    // newlines and the other is the same characters as a single sentence.
    const noBreaks: SlideV2 = {
      id: "uehi0g-s6-height-flat",
      children: [{
        id: "uehi0g-s6-height-flat.t",
        type: "text",
        text: "Line A Line B Line C Line D Line E",
      } as unknown as DomNode],
    };
    const withBreaks: SlideV2 = {
      id: "uehi0g-s6-height-multi",
      children: [{
        id: "uehi0g-s6-height-multi.t",
        type: "text",
        text: "Line A\nLine B\nLine C\nLine D\nLine E",
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    const flat = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(noBreaks)));
    clearRenderDiagnostics();
    const multi = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(withBreaks)));
    const flatHeight = (flat.slides[0]!.shapes.find((s) => (s as { name?: string }).name === "uehi0g-s6-height-flat.t") as { xfrm?: { cy: number } } | undefined)?.xfrm?.cy ?? 0;
    const multiHeight = (multi.slides[0]!.shapes.find((s) => (s as { name?: string }).name === "uehi0g-s6-height-multi.t") as { xfrm?: { cy: number } } | undefined)?.xfrm?.cy ?? 0;
    expect(multiHeight, `multiline text should claim more vertical space than single-line equivalent (got flat=${flatHeight} multi=${multiHeight})`).toBeGreaterThan(flatHeight);
  });

  it("timeline with 8 horizontal simple events wraps to a 4×2 grid", () => {
    // Original failure: 8 horizontal items rendered as 5+3 misaligned grid;
    // metric-card values shrank to 18.5pt and labels to 7.2pt. Fix: when
    // simpleItems and itemCount > 6, force a 4-col grid.
    const slide: SlideV2 = {
      id: "uehi0g-s20",
      title: "关键里程碑时间线",
      children: [{
        id: "uehi0g-s20.tl",
        type: "timeline",
        direction: "horizontal",
        items: [
          { time: "2024 Q3", body: "Tavily $20M A" },
          { time: "2024 Q4", body: "Anthropic Computer Use" },
          { time: "2025 Q1", body: "web_search API" },
          { time: "2025 Q3", body: "Exa $85M" },
          { time: "2025 Q4", body: "Cohere 案判决" },
          { time: "2026 Q1", body: "Tavily $400M 收购" },
          { time: "2026 Q2", body: "Reducto B 轮" },
          { time: "2026 Q2", body: "Anthropic Memory" },
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const expanded = expandComponent("uehi0g-s20", slide.children![0]!);
    expect(expanded.type).toBe("stack");
    expect(expanded.children?.map((child) => child.role)).toEqual(["timeline-row", "timeline-row"]);
    expect(findNode(expanded, "uehi0g-s20.tl.0.body")?.minHeight).toBeGreaterThan(0.4);
    expect(blocking().map((d) => `${d.code} ${d.nodeId}`).join("\n")).toBe("");
  });

  it("axis-ruler with 8 horizontal items wraps into two rows instead of one 8-column strip", () => {
    const expanded = expandComponent("uehi0g-axis-wrap", {
      id: "uehi0g-axis-wrap.ar",
      type: "axis-ruler",
      direction: "horizontal",
      items: Array.from({ length: 8 }, (_, index) => ({
        label: `202${index}-Q${(index % 4) + 1}`,
        body: `Milestone ${index + 1}`,
      })),
    } as unknown as DomNode);

    expect(expanded.type).toBe("stack");
    expect(expanded.children?.map((child) => child.role)).toEqual(["axis-ruler-row", "axis-ruler-row"]);
    expect(findNode(expanded, "uehi0g-axis-wrap.ar.row0.items")?.columns).toBe(4);
  });

  it("dense numbered-grid uses one compact tone chip, not a second marker badge", () => {
    const expanded = expandComponent("uehi0g-numbered-dense", {
      id: "uehi0g-numbered-dense.grid",
      type: "numbered-grid",
      marker: { shape: "ring", variant: "solid", tone: "brand", size: "sm" },
      items: Array.from({ length: 6 }, (_, index) => ({
        title: `判断 ${index + 1}`,
        body: "一句解释，保持卡片可读。",
        tone: index === 5 ? "neutral" : "brand",
      })),
    } as unknown as DomNode);

    expect(findNode(expanded, "uehi0g-numbered-dense.grid.0.marker")).toBeNull();
    expect(findNode(expanded, "uehi0g-numbered-dense.grid.0.num")?.fixedWidth).toBeLessThan(0.7);
  });

  it("timeline with >5 horizontal rich items auto-flips to vertical layout shape", () => {
    // Original failure: 6+ horizontal rich-content items were forced into
    // a 5-col grid; the 6th item wrapped to a partial second row breaking
    // the visual spine. Fix: rich content + horizontal + items > 5 → flip
    // to vertical. The vertical timeline-step has a `.spine` child; the
    // horizontal grid step does not. Use that as the layout-shape signal.
    // We don't assert FALLBACK_FAILED because 6 metric-card rows in 10cm
    // is genuinely tight — the agent should split into two slides — but
    // the LAYOUT must at least flip to vertical so the spine is correct.
    const richContentItem = (label: string): DomNode => ({
      id: "",
      type: "metric-card",
      value: label,
      label: "context",
    });
    const slide: SlideV2 = {
      id: "uehi0g-s20-rich",
      children: [{
        id: "uehi0g-s20-rich.tl",
        type: "timeline",
        direction: "horizontal",
        items: [
          { time: "Q3", title: "A", content: richContentItem("$20M") },
          { time: "Q4", title: "B", content: richContentItem("Use") },
          { time: "Q1", title: "C", content: richContentItem("API") },
          { time: "Q3", title: "D", content: richContentItem("$85M") },
          { time: "Q4", title: "E", content: richContentItem("案") },
          { time: "Q1", title: "F", content: richContentItem("$400M") },
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    // Vertical timeline rows include a `.spine` shape per step; the horizontal
    // 5-col layout does NOT. Presence of the spine shape proves the flip.
    const spineCount = ast.slides[0]!.shapes.filter((s) => {
      const name = (s as { name?: string }).name || "";
      return /\.tl\.\d+\.dot$/.test(name);
    }).length;
    expect(spineCount, "6 rich horizontal items should flip to vertical (each row gets a spine dot)").toBeGreaterThanOrEqual(1);
  });

  it("process-flow horizontal with 3 steps does NOT stretch step cards to row height", () => {
    // Original failure: minHeight:2 + horizontal flex stretched each step
    // card to ~10cm (the parent row height); fill:"surface" painted a
    // 10cm grey card with body text shrunk to ~8pt. Fix: horizontal uses
    // maxHeight cap, body uses min/max instead of fixedHeight.
    const slide: SlideV2 = {
      id: "uehi0g-s4",
      title: "判断 2-4：模型方/MCP/通用收敛",
      children: [{
        id: "uehi0g-s4.flow",
        type: "process-flow",
        direction: "horizontal",
        variant: "cards",
        steps: [
          { title: "模型方 reverse acquisition", body: "Claude Code 通过 MCP 调用 SaaS → 用户入口变成 Claude" },
          { title: "MCP 是双刃剑", body: "中国 3 大子生态：扣子/百炼/飞书。独立 ISV 必须同时适配" },
          { title: "通用收敛 + 垂直深化", body: "模型方吃掉 80% 通用，但吃不动行业 workflow / 私有化 / 合规" },
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    expect(blocking().map((d) => `${d.code} ${d.nodeId}`).join("\n")).toBe("");
    // Step card surface (named `…step1-background` for `cards` variant)
    // should NOT be ≥9cm tall — that was the visible artifact: a 10.34cm
    // grey card painted around 1.7cm of centered content. The maxHeight
    // cap on the step + the matching change in childCrossRect keep the
    // card sized to actual content while still respecting the row's
    // valign:"middle" centering.
    const step1Bg = ast.slides[0]!.shapes.find((s) => (s as { name?: string }).name === "uehi0g-s4.flow.step1-background") as { xfrm?: { cy: number } } | undefined;
    expect(step1Bg, "expected a background shape for the cards-variant step").toBeTruthy();
    const heightCm = (step1Bg!.xfrm!.cy) / 360000;
    expect(heightCm, `step background height should size to content (≤5cm), not the parent row (~10cm); got ${heightCm}cm`).toBeLessThan(5);
  });

  it("executive-summary with 4 structured findings defaults to board variant", () => {
    // Original failure: default "memo" variant flattened structured findings
    // into a single bullet list, losing tone color and headline emphasis.
    // Fix: ≥4 findings with structured detail auto-selects "board".
    const slide: SlideV2 = {
      id: "uehi0g-s1",
      children: [{
        id: "uehi0g-s1.exec",
        type: "executive-summary",
        thesis: "四个对角线交叉点是高赔率方向",
        findings: [
          { headline: "判断1", detail: "Coding 是入口，Office 是真正目标" },
          { headline: "判断2", detail: "模型方 reverse acquisition" },
          { headline: "判断3", detail: "MCP 是双刃剑" },
          { headline: "判断4", detail: "通用收敛 + 垂直深化" },
        ],
        implication: "聚焦 4 个方向，避开通用 agent 与基建中间件",
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(buildDeckWithSlide(slide)));
    const slide0 = ast.slides[0]!;
    // Board mode emits `.findingN.headline` per finding. memo mode emits a
    // single `.findings` bullet list. Assert we got board.
    const findingHeadline = slide0.shapes.find((s) => (s as { name?: string }).name === "uehi0g-s1.exec.finding1.headline");
    expect(findingHeadline, "expected board variant (per-finding headline) for ≥4 structured findings").toBeTruthy();
  });
});
