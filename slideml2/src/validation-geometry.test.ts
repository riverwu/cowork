import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isBlockingRenderDiagnostic, isQualityRenderDiagnostic } from "./diagnostic-codes.js";
import { clearRenderDiagnostics, getRenderDiagnostics } from "./diagnostics.js";
import { meaningfulOverlap } from "./layout/geometry.js";
import { measureDeck, renderToAst, renderToPptx } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck } from "./types.js";

describe("validation geometry and diagnostic contracts", () => {
  it("uses one meaningful-overlap threshold for tangent and real overlap cases", () => {
    expect(meaningfulOverlap(
      { x: 0, y: 0, w: 2, h: 2 },
      { x: 2, y: 0, w: 2, h: 2 },
    )).toBeUndefined();

    const overlap = meaningfulOverlap(
      { x: 0, y: 0, w: 2, h: 2 },
      { x: 1.2, y: 0.6, w: 2, h: 2 },
    );
    expect(overlap?.areaCm2).toBeGreaterThan(0.05);
    expect(overlap?.ratioOfSmaller).toBeGreaterThan(0);
  });

  it("keeps blocking and quality diagnostic classification centralized", () => {
    expect(isBlockingRenderDiagnostic("SIBLING_INK_OVERLAP", "error")).toBe(true);
    expect(isBlockingRenderDiagnostic("FALLBACK_FAILED", "warn")).toBe(false);
    expect(isBlockingRenderDiagnostic("FALLBACK_FAILED")).toBe(true);
    expect(isBlockingRenderDiagnostic("LOW_CONTRAST", "error")).toBe(true);
    expect(isBlockingRenderDiagnostic("LOW_CONTRAST", "warn")).toBe(false);
    expect(isBlockingRenderDiagnostic("OVERFLOW", "warn")).toBe(false);
    expect(isBlockingRenderDiagnostic("CUSTOM_ERROR", "error")).toBe(true);
    expect(isQualityRenderDiagnostic("TIGHT_GAP")).toBe(true);
    expect(isQualityRenderDiagnostic("FALLBACK_FAILED")).toBe(true);
    expect(isQualityRenderDiagnostic("SIBLING_INK_OVERLAP")).toBe(true);
    expect(isQualityRenderDiagnostic("TINY_RECT")).toBe(true);
  });

  it("emits structured overlap metrics for collision diagnostics", () => {
    clearRenderDiagnostics();
    measureDeck({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "collision",
        layout: "freeform",
        dom: {
          id: "collision.root",
          type: "slide",
          children: [
            { id: "collision.a", type: "text", text: "A", style: "paragraph" },
            { id: "collision.b", type: "text", text: "B", style: "paragraph" },
          ],
        },
      }],
    });
    const hit = getRenderDiagnostics().find((item) => item.code === "COLLISION" && item.nodeId === "collision.a");
    expect(hit?.severity).toBe("error");
    expect(hit?.measured?.overlapAreaCm2).toBeGreaterThan(0.05);
    expect(hit?.measured?.relationship).toBe("leaf-ink-overlap");
    expect(hit?.measured?.other?.nodeId).toBe("collision.b");
  });

  it("keeps mildly compressed h2 headings out of blocking diagnostics", () => {
    clearRenderDiagnostics();
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "mild-h2-squash",
        layout: "freeform",
        dom: {
          id: "mild-h2-squash.root",
          type: "slide",
          children: [
            { id: "mild-h2-squash.heading", type: "text", text: "数据假设", style: "h2", at: [1, 1, 10, 0.38] },
          ],
        },
      }],
    });
    expect(getRenderDiagnostics().some((item) => item.code === "SQUASHED" && item.severity === "error")).toBe(false);
  });

  it("does not block title-adjacent hairlines as title occlusion", () => {
    clearRenderDiagnostics();
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "title-hairline",
        layout: "freeform",
        dom: {
          id: "title-hairline.root",
          type: "slide",
          children: [
            { id: "title-hairline.title", type: "text", text: "Quarterly Results", style: "slide-title", at: [1, 1, 10, 0.8] },
            { id: "title-hairline.rule", type: "shape", preset: "rect", fill: "brand.primary", line: "none", at: [1, 1.72, 10, 0.06] },
          ],
        },
      }],
    });
    expect(getRenderDiagnostics().some((item) => item.code === "TITLE_OCCLUDED")).toBe(false);
  });

  it("infers positioned callout text so renderer-side shrink can absorb mixed CJK and Latin wrapping", () => {
    clearRenderDiagnostics();
    measureDeck(sourceToRenderedDeck({
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        themeOverride: {
          fonts: {
            latin: { text: ["Arial"], display: ["Arial"] },
            cjk: { text: ["system-ui"], display: ["system-ui"] },
          },
        },
      },
      slides: [{
        id: "positioned-callout-text",
        title: "Callout text",
        children: [{
          type: "freeform-group",
          children: [{
            id: "calloutText",
            type: "text",
            text: "关键约束：质量检查失败（虚线）→ 回到数据完善阶段；GA 判定需 Release Controls readiness ≥ 85 且 P95 延迟 < 500ms 且可靠性 ≥ 99.5%",
            fontSize: 10,
            fontWeight: "bold",
            at: [0.6, 11.5, 12.1, 1.1],
          }],
        }],
      }],
    }));

    expect(getRenderDiagnostics().some((item) => item.code === "FALLBACK_FAILED" && item.nodeId === "calloutText")).toBe(false);
  });

  it("reports positioned overlays that visually cover flow text", () => {
    clearRenderDiagnostics();
    measureDeck(sourceToRenderedDeck({
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "overlay-text",
        title: "Overlay text",
        children: [
          { id: "overlay-text.body", type: "text", text: "Quality gate explanation should stay readable when a freeform diagram is present.", style: "paragraph" },
          { id: "overlay-text.box", type: "shape", preset: "rect", fill: "brand.primary", at: [1.2, 2.55, 3.2, 1.2] },
        ],
      }],
    }));
    const hit = getRenderDiagnostics().find((item) => item.code === "OVERLAY_OCCLUDES_FLOW" && item.nodeId === "overlay-text.box");
    expect(hit?.severity).toBe("error");
    expect(hit?.measured?.other?.nodeId).toBe("overlay-text.body");
  });

  it("clears render diagnostics at the start of each renderToAst run", () => {
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "diagnostic-state",
        layout: "freeform",
        dom: {
          id: "diagnostic-state.root",
          type: "slide",
          children: [
            { id: "diagnostic-state.a", type: "text", text: "A", style: "paragraph" },
            { id: "diagnostic-state.b", type: "text", text: "B", style: "paragraph" },
          ],
        },
      }],
    });
    expect(getRenderDiagnostics().some((item) => item.code === "COLLISION")).toBe(true);

    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "diagnostic-state-clean",
        layout: "content",
        dom: {
          id: "diagnostic-state-clean.root",
          type: "slide",
          children: [
            { id: "diagnostic-state-clean.body", type: "text", area: "content", text: "A clean slide.", style: "paragraph" },
          ],
        },
      }],
    });
    expect(getRenderDiagnostics().some((item) => item.code === "COLLISION")).toBe(false);
  });

  it("keeps separate collision diagnostics for one node overlapping multiple peers", () => {
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "multi-collision",
        layout: "freeform",
        dom: {
          id: "multi-collision.root",
          type: "slide",
          children: [
            { id: "multi-collision.a", type: "text", text: "A", style: "paragraph" },
            { id: "multi-collision.b", type: "text", text: "B", style: "paragraph" },
            { id: "multi-collision.c", type: "text", text: "C", style: "paragraph" },
          ],
        },
      }],
    });
    const peers = getRenderDiagnostics()
      .filter((item) => item.code === "COLLISION" && item.nodeId === "multi-collision.a")
      .map((item) => item.measured?.other?.nodeId);
    expect(new Set(peers)).toEqual(new Set(["multi-collision.b", "multi-collision.c"]));
  });

  it("writes measured nodes and slide diagnostics into the render tree", async () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "tree",
        title: "Measured tree",
        children: [
          { id: "tree.body", type: "text", area: "content", text: "Measured render tree body.", style: "paragraph" },
        ],
      }],
    };
    const dir = mkdtempSync(join(tmpdir(), "slideml2-validate-"));
    const out = join(dir, "deck.pptx");

    clearRenderDiagnostics();
    await renderToPptx(sourceToRenderedDeck(deck), out);
    const tree = JSON.parse(readFileSync(`${out}.render-tree.json`, "utf8")) as {
      slides: Array<{ measured?: { nodes?: Array<{ id: string; rect?: unknown; inkRect?: unknown; visualRect?: unknown; visualRole?: string; diagnostics?: unknown[] }> } }>;
    };
    const measured = tree.slides[0]?.measured;
    expect(measured?.nodes?.some((node) => node.id === "tree.body" && node.rect && node.inkRect && node.visualRect && node.visualRole === "text")).toBe(true);
    expect(Array.isArray(measured?.diagnostics)).toBe(true);
  });

  it("keeps ink rects independent from slot rects for overflowing text", () => {
    const measured = measureDeck({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "ink-overflow",
        layout: "freeform",
        dom: {
          id: "ink-overflow.root",
          type: "slide",
          children: [{
            id: "ink-overflow.body",
            type: "text",
            at: [1, 1, 4, 0.45],
            text: "This paragraph intentionally needs several wrapped lines inside a tiny fixed-height slot.",
            style: "paragraph",
          }],
        },
      }],
    });
    const body = measured[0]?.nodes.find((node) => node.id === "ink-overflow.body");
    expect(body?.inkRect?.h).toBeGreaterThan(body?.rect.h ?? 0);
    expect(body?.visualRect?.h).toBe(body?.inkRect?.h);
  });

  it("uses tight visual rects for short text instead of the full layout slot", () => {
    const measured = measureDeck({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "tight-text",
        layout: "freeform",
        dom: {
          id: "tight-text.root",
          type: "slide",
          children: [{
            id: "tight-text.label",
            type: "text",
            at: [1, 1, 10, 2],
            text: "OK",
            align: "center",
            valign: "middle",
            style: "paragraph",
          }],
        },
      }],
    });
    const label = measured[0]?.nodes.find((node) => node.id === "tight-text.label");
    expect(label?.visualRect?.w).toBeLessThan((label?.rect.w ?? 0) / 2);
    expect(label?.visualRect?.x).toBeGreaterThan(label?.rect.x ?? 0);
  });

  it("estimates visual text ink without invisible textbox padding", () => {
    const measured = measureDeck({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "plain-ink",
        layout: "freeform",
        dom: {
          id: "plain-ink.root",
          type: "slide",
          children: [{
            id: "plain-ink.label",
            type: "text",
            at: [1, 1, 5, 1],
            text: "Single line",
            style: "paragraph",
          }],
        },
      }],
    });
    const label = measured[0]?.nodes.find((node) => node.id === "plain-ink.label");
    expect(label?.inkRect?.h).toBeGreaterThan(0.45);
    expect(label?.inkRect?.h).toBeLessThan(0.72);
  });

  it("does not treat tall CJK font bboxes as squashed in normal label slots", () => {
    renderToAst({
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "2563EB" },
        themeOverride: {
          fonts: { cjk: { text: ["Microsoft YaHei"], display: ["Microsoft YaHei"] } },
        },
      },
      slides: [{
        id: "cjk-label-fit",
        layout: "freeform",
        dom: {
          id: "cjk-label-fit.root",
          type: "slide",
          children: [{
            id: "cjk-label-fit.label",
            type: "text",
            at: [1, 1, 4, 0.5],
            text: "香格里拉",
            style: "label",
            autoFit: "shrink",
          }],
        },
      }],
    });
    const diagnostics = getRenderDiagnostics();
    expect(diagnostics.some((item) => item.code === "SQUASHED" && item.nodeId === "cjk-label-fit.label")).toBe(false);
  });

  it("still reports genuinely too-short CJK text using measured ink fit", () => {
    renderToAst({
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "2563EB" },
        themeOverride: {
          fonts: { cjk: { text: ["Microsoft YaHei"], display: ["Microsoft YaHei"] } },
        },
      },
      slides: [{
        id: "cjk-label-short",
        layout: "freeform",
        dom: {
          id: "cjk-label-short.root",
          type: "slide",
          children: [{
            id: "cjk-label-short.label",
            type: "text",
            at: [1, 1, 4, 0.16],
            text: "香格里拉",
            style: "label",
            autoFit: "shrink",
          }],
        },
      }],
    });
    const hit = getRenderDiagnostics().find((item) => item.code === "SQUASHED" && item.nodeId === "cjk-label-short.label");
    expect(hit?.measured?.minHeightCm).toBeGreaterThan(0.16);
  });

  it("keeps one-line display text size when only the slot height is tight", () => {
    const ast = renderToAst({
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "2563EB" },
        themeOverride: { text: { "card-title": { fontSize: 16, lineHeight: 1.15, weight: 700 } } },
      },
      slides: [{
        id: "display-height-only",
        layout: "freeform",
        dom: {
          id: "display-height-only.root",
          type: "slide",
          children: [{
            id: "display-height-only.title",
            type: "text",
            at: [1, 1, 5, 0.5],
            text: "Revenue",
            style: "card-title",
            autoFit: "shrink",
          }],
        },
      }],
    });
    const shape = ast.slides[0]?.shapes.find((item) => item.name === "display-height-only.title");
    if (shape?.type !== "text") throw new Error("expected rendered text shape");
    expect(shape.paragraphs[0]?.runs[0]?.sizeHalfPt).toBe(32);
    expect(getRenderDiagnostics().some((item) => item.code === "TRUNCATED" && item.nodeId === "display-height-only.title")).toBe(false);
  });

  it("uses textbox reserve for needed-height but not for painted text ink", () => {
    const measured = measureDeck({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "surface-ink",
        layout: "freeform",
        dom: {
          id: "surface-ink.root",
          type: "slide",
          children: [{
            id: "surface-ink.badge",
            type: "text",
            at: [1, 1, 4, 0.46],
            text: "STATUS",
            style: "label",
            fill: "surface.subtle",
            cornerRadius: 0.16,
            autoFit: "shrink",
          }],
        },
      }],
    });
    const badge = measured[0]?.nodes.find((node) => node.id === "surface-ink.badge");
    expect(badge?.visualRect?.h).toBeCloseTo(badge?.rect.h ?? 0, 6);
    expect(badge?.inkRect?.h).toBeLessThan((badge?.rect.h ?? 0) + 0.04);
    expect(getRenderDiagnostics().some((item) => item.code === "SQUASHED" && item.nodeId === "surface-ink.badge")).toBe(false);
  });

  it("applies autoFit shrink to measured ink rects without emitting duplicate diagnostics", () => {
    clearRenderDiagnostics();
    const measured = measureDeck({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "autofit-ink",
        layout: "freeform",
        dom: {
          id: "autofit-ink.root",
          type: "slide",
          children: [
            {
              id: "autofit-ink.title",
              type: "text",
              at: [1, 1, 5.2, 0.75],
              text: "A Medium Length Title",
              style: "card-title",
              autoFit: "shrink",
            },
            {
              id: "autofit-ink.neighbor",
              type: "text",
              at: [1, 1.82, 5.2, 0.5],
              text: "Below",
              style: "label",
            },
          ],
        },
      }],
    });
    const title = measured[0]?.nodes.find((node) => node.id === "autofit-ink.title");
    expect(title?.visualRect?.h).toBeLessThanOrEqual((title?.rect.h ?? 0) + 0.03);
    expect(getRenderDiagnostics().filter((item) => item.code === "TRUNCATED" && item.nodeId === "autofit-ink.title")).toHaveLength(0);
  });

  it("remeasures fallback-applied autoFit shrink before collision checks", () => {
    clearRenderDiagnostics();
    const measured = measureDeck({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "fallback-shrink",
        layout: "freeform",
        dom: {
          id: "fallback-shrink.root",
          type: "slide",
          children: [{
            id: "fallback-shrink.stack",
            type: "stack",
            at: [1, 1, 6, 2.1],
            direction: "vertical",
            gap: 0.05,
            children: [
              {
                id: "fallback-shrink.long",
                type: "text",
                text: "This paragraph is intentionally long enough that the fallback ladder must shrink its measured text before the sibling below is placed.",
                style: "paragraph",
              },
              {
                id: "fallback-shrink.short",
                type: "text",
                text: "Below",
                style: "label",
              },
            ],
          }],
        },
      }],
    });
    const diagnostics = getRenderDiagnostics();
    const long = measured[0]?.nodes.find((node) => node.id === "fallback-shrink.long");
    expect(diagnostics.some((item) => item.code === "TRUNCATED" && item.nodeId === "fallback-shrink.long")).toBe(true);
    expect(diagnostics.some((item) => item.code === "FALLBACK_FAILED" && item.nodeId === "fallback-shrink.stack")).toBe(false);
    expect(diagnostics.some((item) => item.code === "SIBLING_INK_OVERLAP" && item.nodeId === "fallback-shrink.long")).toBe(false);
    expect(long?.visualRect?.h).toBeLessThanOrEqual((long?.rect.h ?? 0) + 0.03);
  });

  it("reports text and bullet squash diagnostics with minimum readable dimensions", () => {
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "squash-measured",
        layout: "freeform",
        dom: {
          id: "squash-measured.root",
          type: "slide",
          children: [
            {
              id: "squash-measured.text",
              type: "text",
              at: [1, 1, 5, 0.2],
              text: "This paragraph has too little height.",
              style: "paragraph",
            },
            {
              id: "squash-measured.bullets",
              type: "bullets",
              at: [7, 1, 1.0, 1.2],
              items: ["First", "Second"],
            },
          ],
        },
      }],
    });
    const diagnostics = getRenderDiagnostics();
    const text = diagnostics.find((item) => item.code === "SQUASHED" && item.nodeId === "squash-measured.text");
    const bullets = diagnostics.find((item) => item.code === "SQUASHED" && item.nodeId === "squash-measured.bullets");
    expect(text?.measured?.minHeightCm).toBeGreaterThan(0.2);
    expect(bullets?.measured?.minWidthCm).toBe(1.4);
  });

  it("downgrades mild readable text squash to warning instead of blocking", () => {
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck({
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "2563EB" },
        themeOverride: {
          text: { "slide-title": { fontSize: 24, fontWeight: "bold", color: "1E293B" } },
          layout: { pageMarginX: 0.8, titleTop: 0.5, titleHeight: 0.7, contentTop: 1.4, contentBottom: 13 },
        },
      },
      slides: [{
        id: "mild-title-squash",
        title: "核心发现摘要",
        children: [{ type: "text", text: "正文", area: "content" }],
      }],
    }));

    const hit = getRenderDiagnostics().find((item) => item.code === "SQUASHED" && item.nodeId === "mild-title-squash.title");
    expect(hit?.severity).toBe("warn");
    expect(isBlockingRenderDiagnostic(hit?.code, hit?.severity)).toBe(false);
  });

  it("does not block when slide-level title chrome is intentionally zero-height", () => {
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck({
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "2563EB" },
        themeOverride: {
          layout: { titleTop: 0.5, titleHeight: 0, contentTop: 0.9, contentBottom: 13.0 },
        },
      },
      slides: [{
        id: "metadata-title",
        title: "各职能人力占比",
        children: [{
          type: "split",
          ratio: [0.55, 0.45],
          direction: "horizontal",
          children: [
            { type: "chart-card", chartType: "doughnut", title: "各职能人力占比", data: { labels: ["销售", "研发"], series: [{ name: "value", values: [150, 55] }] } },
            { type: "key-takeaway", headline: "销售占HC的54%", detail: "外包比例较高，建议复核渠道产出。", tone: "warning", variant: "panel" },
          ],
        }],
      }],
    }));

    const titleTiny = getRenderDiagnostics().find((item) => item.code === "TINY_RECT" && item.nodeId === "metadata-title.title");
    expect(titleTiny?.severity).toBe("warn");
    expect(isBlockingRenderDiagnostic(titleTiny?.code, titleTiny?.severity)).toBe(false);
  });

  it("treats mild readable-height pressure in auto-oriented process cards as a warning", () => {
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck({
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "2563EB" },
        themeOverride: {
          layout: { pageMarginX: 0.9, titleTop: 0.5, titleHeight: 1, contentTop: 1.7, contentBottom: 13.2, defaultGap: 0.3, columnGap: 0.4 },
        },
      },
      slides: [{
        id: "pipeline",
        title: "AI Diagnostics Pipeline",
        children: [
          {
            type: "process-flow",
            direction: "horizontal",
            connector: "arrow",
            variant: "cards",
            density: "comfortable",
            steps: [
              { title: "Data Ingest", body: "Structured intake from EHR, imaging, and lab feeds", status: "done", icon: "cloud" },
              { title: "Validation", body: "Completeness & plausibility checks against clinical rules", status: "done", icon: "check" },
              { title: "Model Scoring", body: "Multi-task transformer scores probability and urgency", status: "active", icon: "star-5" },
              { title: "Reviewer Feedback", body: "Clinician review with structured evidence panel", status: "pending", icon: "callout" },
            ],
          },
          {
            type: "stat-flow",
            steps: [
              { value: "42 min", label: "Baseline Triage" },
              { connector: "->" },
              { value: "18 min", label: "With SignalLab", tone: "positive" },
              { connector: "=" },
              { value: "57%", label: "Time Saved" },
            ],
          },
          { type: "source-note", text: "Internal benchmark: median triage time across 120 cases, Q1 2025." },
        ],
      }],
    }));

    const diagnostics = getRenderDiagnostics();
    expect(diagnostics.some((item) => item.code === "FALLBACK_FAILED" && item.severity === "error" && String(item.nodeId).startsWith("pipeline.node-1.step"))).toBe(false);
    expect(diagnostics.some((item) => item.code === "OVERFLOW" && String(item.nodeId).startsWith("pipeline.node-1.step"))).toBe(true);
  });

  it("treats readable source notes capacity drift as warnings, not blocking failures", () => {
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "sources",
        title: "数据来源说明",
        children: [
          {
            type: "explanation-block",
            title: "数据来源",
            variant: "panel",
            bullets: [
              "Excel 文件：25年上半年人力数据分析-V1.xlsx",
              "Sheet「底表」：A1:S71，月度销售/成本/HC/人效（2024.01–2025.06）",
              "Sheet「主要发现」：职能人力占比、半年度同比、渠道分析、整体发现",
            ],
          },
          {
            type: "fact-list",
            title: "数据引用索引",
            items: [
              { label: "第2页 KPI总览", value: "主要发现 B19:F23" },
              { label: "第3页 职能占比", value: "主要发现 B4:B10" },
              { label: "第4页 H1同比", value: "主要发现 B19:F23" },
              { label: "第5页 渠道分析", value: "主要发现 B29:V34" },
              { label: "第6页 管理建议", value: "主要发现 B40:B48" },
            ],
          },
          {
            type: "source-note",
            text: "Excel 路径：inputs/25年上半年人力数据分析-V1.xlsx；数据截至 2025 年 6 月",
            align: "left",
          },
        ],
      }],
    }));

    const diagnostics = getRenderDiagnostics();
    const blocking = diagnostics.filter((item) => isBlockingRenderDiagnostic(item.code, item.severity));
    expect(blocking).toHaveLength(0);
    expect(diagnostics.some((item) => item.code === "SQUASHED" && item.nodeId === "sources.node-1.title" && item.severity === "error")).toBe(false);
    expect(diagnostics.some((item) => item.code === "FALLBACK_FAILED" && item.nodeId === "sources.node-1.bullets")).toBe(false);
  });

  it("downgrades very small single-line title height drift to warning", () => {
    clearRenderDiagnostics();
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "short-title-drift",
        layout: "freeform",
        dom: {
          id: "short-title-drift.root",
          type: "slide",
          children: [{
            id: "short-title-drift.title",
            type: "text",
            text: "数据来源",
            style: "card-title",
            at: [2.38, 3.53, 20.64, 0.44],
          }],
        },
      }],
    });

    const hit = getRenderDiagnostics().find((item) => item.code === "SQUASHED" && item.nodeId === "short-title-drift.title");
    expect(hit?.severity).toBe("warn");
    expect(isBlockingRenderDiagnostic(hit?.code, hit?.severity)).toBe(false);
  });

  it("downgrades readable bullet overflow drift to warning", () => {
    clearRenderDiagnostics();
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "bullet-fit-drift",
        layout: "freeform",
        dom: {
          id: "bullet-fit-drift.root",
          type: "slide",
          children: [{
            id: "bullet-fit-drift.bullets",
            type: "bullets",
            at: [2.38, 4.13, 20.64, 2.1],
            items: [
              "Excel 文件：25年上半年人力数据分析-V1.xlsx",
              "Sheet「底表」：A1:S71，月度销售/成本/HC/人效（2024.01–2025.06）",
              "Sheet「主要发现」：职能人力占比、半年度同比、渠道分析、整体发现",
            ],
          }],
        },
      }],
    });

    const hit = getRenderDiagnostics().find((item) => item.code === "OVERFLOW" && item.nodeId === "bullet-fit-drift.bullets");
    expect(hit?.severity).toBe("warn");
    expect(isBlockingRenderDiagnostic(hit?.code, hit?.severity)).toBe(false);
  });

  it("preserves optional metric labels and reports capacity failure to the agent", () => {
    clearRenderDiagnostics();
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "metric-label-drop",
        layout: "freeform",
        dom: {
          id: "metric-label-drop.root",
          type: "slide",
          children: [{
            id: "metric-label-drop.metric",
            type: "stack",
            role: "metric-card",
            direction: "vertical",
            gap: 0.1,
            at: [1, 1, 3, 0.8],
            children: [
              {
                id: "metric-label-drop.metric.value-wrap",
                type: "stack",
                direction: "vertical",
                fixedHeight: 1.15,
                children: [{
                  id: "metric-label-drop.metric.value",
                  type: "text",
                  text: "276",
                  style: "metric-value",
                  autoFit: "shrink",
                }],
              },
              {
                id: "metric-label-drop.metric.label",
                type: "text",
                text: "总人数",
                style: "metric-label",
                fixedHeight: 0.72,
                optional: true,
              },
            ],
          }],
        },
      }],
    });

    const diagnostics = getRenderDiagnostics();
    expect(diagnostics.some((item) => item.code === "DROP" && item.nodeId === "metric-label-drop.metric.label")).toBe(false);
    const hit = diagnostics.find((item) => item.code === "FALLBACK_FAILED" && item.nodeId === "metric-label-drop.metric");
    expect(hit?.severity).toBe("error");
    expect(isBlockingRenderDiagnostic(hit?.code, hit?.severity)).toBe(true);
  });

  it("uses the widest paragraph instead of concatenating paragraphs for ink width", () => {
    const measured = measureDeck({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "paragraph-width",
        layout: "freeform",
        dom: {
          id: "paragraph-width.root",
          type: "slide",
          children: [{
            id: "paragraph-width.copy",
            type: "text",
            at: [1, 1, 8, 2],
            style: "paragraph",
            paragraphs: [
              { text: "Short line" },
              { text: "Another short" },
            ],
          }],
        },
      }],
    });
    const copy = measured[0]?.nodes.find((node) => node.id === "paragraph-width.copy");
    expect(copy?.visualRect?.w).toBeLessThan(4);
  });

  it("keeps kpi-grid metric-card value and label bands aligned across peers", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "kpi-align",
        children: [{
          id: "kpis",
          type: "kpi-grid",
          variant: "card",
          metrics: [
            { value: "$8.6B", label: "No-code AI platform market", delta: "2034 forecast $75B", status: "positive" },
            { value: "$28.7B", label: "Broad low-code/no-code market", delta: "CAGR ~26%", status: "positive" },
            { value: "$7B+", label: "AI coding tools market", delta: "CAGR ~22%", status: "positive" },
            { value: "70-75%", label: "Enterprise apps built with low-code", delta: "2026", status: "brand" },
          ],
        }],
      }],
    };
    const measured = measureDeck(sourceToRenderedDeck(deck))[0]?.nodes || [];
    const rectById = new Map(measured.map((node) => [node.id, node.rect]));
    const ids = [1, 2, 3, 4].map((index) => `kpi-align.kpis-m${index}`);
    const valueYs = ids.map((id) => rectById.get(`${id}.value-wrap`)?.y);
    const valueHs = ids.map((id) => rectById.get(`${id}.value-wrap`)?.h);
    const labelYs = ids.map((id) => rectById.get(`${id}.label`)?.y);
    const deltaYs = ids.map((id) => rectById.get(`${id}.delta`)?.y);

    expect(new Set(valueYs.map((value) => value?.toFixed(3))).size).toBe(1);
    expect(new Set(valueHs.map((value) => value?.toFixed(3))).size).toBe(1);
    expect(new Set(labelYs.map((value) => value?.toFixed(3))).size).toBe(1);
    expect(new Set(deltaYs.map((value) => value?.toFixed(3))).size).toBe(1);
  });

  it("reports foreground overlays that occlude flow text using visual rects", () => {
    clearRenderDiagnostics();
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "overlay-occlusion",
        layout: "freeform",
        dom: {
          id: "overlay-occlusion.root",
          type: "slide",
          children: [
            {
              id: "overlay-occlusion.body",
              type: "text",
              area: "content",
              text: "Visible content that should remain readable after layout validation.",
              style: "paragraph",
            },
            {
              id: "overlay-occlusion.blocker",
              type: "shape",
              at: [1.6, 2.4, 8, 1.6],
              fill: "FFFFFF",
              line: { color: "FFFFFF", width: 0 },
            },
          ],
        },
      }],
    });
    expect(getRenderDiagnostics().some((item) => item.code === "OVERLAY_OCCLUDES_FLOW" && item.nodeId === "overlay-occlusion.blocker")).toBe(true);
  });

  it("reports layer-above overlays that cover flow content", () => {
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "above-occlusion",
        layout: "freeform",
        dom: {
          id: "above-occlusion.root",
          type: "slide",
          children: [
            {
              id: "above-occlusion.body",
              type: "text",
              area: "content",
              text: "Readable flow text should not be covered by a foreground layer.",
              style: "paragraph",
            },
            {
              id: "above-occlusion.blocker",
              type: "shape",
              layer: "above",
              at: [1.6, 2.4, 8, 1.6],
              fill: "FFFFFF",
              line: { color: "FFFFFF", width: 0 },
            },
          ],
        },
      }],
    });
    expect(getRenderDiagnostics().some((item) => item.code === "OVERLAY_OCCLUDES_FLOW" && item.nodeId === "above-occlusion.blocker")).toBe(true);
  });

  it("reports nested layer-above overlays that cover their container flow content", () => {
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "nested-above-occlusion",
        layout: "content",
        dom: {
          id: "nested-above-occlusion.root",
          type: "slide",
          children: [{
            id: "nested-above-occlusion.card",
            type: "card",
            area: "content",
            fill: "FFFFFF",
            children: [
              {
                id: "nested-above-occlusion.text",
                type: "text",
                text: "Important flow content inside the card.",
                style: "paragraph",
              },
              {
                id: "nested-above-occlusion.mask",
                type: "shape",
                layer: "above",
                fill: "FFFFFF",
                line: { color: "FFFFFF", width: 0 },
              },
            ],
          }],
        },
      }],
    });
    expect(getRenderDiagnostics().some((item) => item.code === "OVERLAY_OCCLUDES_FLOW" && item.nodeId === "nested-above-occlusion.mask")).toBe(true);
  });

  it("does not treat negative zIndex slide overlays as foreground occlusion", () => {
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "negative-z-overlay",
        layout: "freeform",
        dom: {
          id: "negative-z-overlay.root",
          type: "slide",
          children: [
            {
              id: "negative-z-overlay.body",
              type: "text",
              area: "content",
              text: "Readable flow text should not be blocked by a behind overlay.",
              style: "paragraph",
            },
            {
              id: "negative-z-overlay.backdrop",
              type: "shape",
              at: [1.4, 2.2, 8, 2],
              zIndex: -1,
              fill: "FFFFFF",
              line: { color: "FFFFFF", width: 0 },
            },
          ],
        },
      }],
    });
    expect(getRenderDiagnostics().some((item) => item.code === "OVERLAY_OCCLUDES_FLOW" && item.nodeId === "negative-z-overlay.backdrop")).toBe(false);
  });

  it("keeps auto-fixed low contrast quality-only", () => {
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "contrast-severity",
        layout: "title-and-content",
        dom: {
          id: "contrast-severity.root",
          type: "slide",
          background: "background",
          children: [{
            id: "contrast-severity.panel",
            type: "panel",
            area: "content",
            fill: "EEF2FF",
            children: [{
              id: "contrast-severity.body",
              type: "text",
              text: "This text is still present but not readable enough.",
              style: "paragraph",
              color: "FFFFFF",
            }],
          }],
        },
      }],
    });
    const hit = getRenderDiagnostics().find((item) =>
      (item.code === "LOW_CONTRAST" || item.code === "LOW_CONTRAST_FIXED") && item.nodeId === "contrast-severity.body"
    );
    expect(hit?.code).toBe("LOW_CONTRAST_FIXED");
    expect(hit?.severity).toBe("warn");
    expect(isBlockingRenderDiagnostic(hit?.code, hit?.severity)).toBe(false);
  });

  it("keeps unresolved invisible shapes blocking and fixed invisible shapes as warnings", () => {
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "shape-visibility-severity",
        layout: "freeform",
        dom: {
          id: "shape-visibility-severity.root",
          type: "slide",
          children: [
            {
              id: "shape-visibility-severity.unfixed",
              type: "shape",
              at: [1, 1, 3, 2],
              fill: "FFFFFF",
              line: { color: "FFFFFF", width: 0, dash: "dash" },
            },
            {
              id: "shape-visibility-severity.fixed",
              type: "shape",
              at: [5, 1, 0.3, 0.3],
              fill: "FFFFFF",
              line: { color: "FFFFFF", width: 0 },
            },
          ],
        },
      }],
    });
    const diagnostics = getRenderDiagnostics();
    const unfixed = diagnostics.find((item) => item.code === "SHAPE_INVISIBLE" && item.nodeId === "shape-visibility-severity.unfixed");
    const fixed = diagnostics.find((item) => item.code === "SHAPE_INVISIBLE_FIXED" && item.nodeId === "shape-visibility-severity.fixed");
    expect(unfixed?.severity).toBe("error");
    expect(isBlockingRenderDiagnostic(unfixed?.code, unfixed?.severity)).toBe(true);
    expect(fixed?.severity).toBe("warn");
    expect(isBlockingRenderDiagnostic(fixed?.code, fixed?.severity)).toBe(false);
  });

  it("downgrades low-alpha foreground overlays to decorative overlap", () => {
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "low-alpha-overlay",
        layout: "freeform",
        dom: {
          id: "low-alpha-overlay.root",
          type: "slide",
          children: [
            {
              id: "low-alpha-overlay.body",
              type: "text",
              area: "content",
              text: "Readable flow text can sit under a very light tint.",
              style: "paragraph",
            },
            {
              id: "low-alpha-overlay.tint",
              type: "shape",
              at: [1.4, 2.2, 8, 2],
              fill: "FFFFFF",
              fillOpacity: 0.12,
              line: { color: "FFFFFF", width: 0 },
            },
          ],
        },
      }],
    });
    const diagnostics = getRenderDiagnostics();
    const hit = diagnostics.find((item) => item.code === "DECORATIVE_OVERLAP" && item.nodeId === "low-alpha-overlay.tint");
    expect(hit?.severity).toBe("info");
    expect(diagnostics.some((item) => item.code === "OVERLAY_OCCLUDES_FLOW" && item.nodeId === "low-alpha-overlay.tint")).toBe(false);
  });

  it("reports direct slide-root sibling container overlap", () => {
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "root-container-overlap",
        layout: "content",
        dom: {
          id: "root-container-overlap.root",
          type: "slide",
          children: [
            {
              id: "root-container-overlap.cardA",
              type: "card",
              area: "content",
              fixedWidth: 8,
              fixedHeight: 4,
              fill: "F8FAFC",
              children: [{ id: "root-container-overlap.cardA.text", type: "text", text: "Card A", style: "paragraph" }],
            },
            {
              id: "root-container-overlap.cardB",
              type: "card",
              area: "content",
              fixedWidth: 8,
              fixedHeight: 4,
              fill: "FFFFFF",
              children: [{ id: "root-container-overlap.cardB.text", type: "text", text: "Card B", style: "paragraph" }],
            },
          ],
        },
      }],
    });
    const hit = getRenderDiagnostics().find((item) => item.code === "STRUCTURAL_OVERLAP" && item.nodeId === "root-container-overlap.cardA");
    expect(hit).toBeDefined();
    expect(hit?.constrainedBy?.ancestorId).toBe("root-container-overlap.cardA");
  });

  it("does not double-report overlay cards as structural overlap", () => {
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "overlay-container-overlap",
        layout: "content",
        dom: {
          id: "overlay-container-overlap.root",
          type: "slide",
          children: [
            {
              id: "overlay-container-overlap.flow",
              type: "card",
              area: "content",
              fill: "FFFFFF",
              children: [{ id: "overlay-container-overlap.flow.text", type: "text", text: "Readable flow content", style: "paragraph" }],
            },
            {
              id: "overlay-container-overlap.overlay",
              type: "card",
              at: [1.2, 1.4, 10, 3],
              fill: "F8FAFC",
              children: [
                {
                  id: "overlay-container-overlap.overlay.mask",
                  type: "shape",
                  fill: "F8FAFC",
                  line: { color: "F8FAFC", width: 0 },
                  fixedHeight: 2.2,
                },
              ],
            },
          ],
        },
      }],
    });
    const diagnostics = getRenderDiagnostics();
    expect(diagnostics.some((item) => item.code === "STRUCTURAL_OVERLAP" && item.nodeId === "overlay-container-overlap.overlay")).toBe(false);
    expect(diagnostics.some((item) => item.code === "OVERLAY_OCCLUDES_FLOW" && item.nodeId === "overlay-container-overlap.overlay.mask")).toBe(true);
  });

  it("downgrades decorative overlaps instead of blocking layout", () => {
    clearRenderDiagnostics();
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "decorative-overlap",
        layout: "freeform",
        dom: {
          id: "decorative-overlap.root",
          type: "slide",
          children: [
            {
              id: "decorative-overlap.body",
              type: "text",
              area: "content",
              text: "Decorative artwork can share space with copy when it is explicitly marked as decoration.",
              style: "paragraph",
            },
            {
              id: "decorative-overlap.decor",
              type: "shape",
              at: [1.6, 2.4, 8, 1.6],
              fill: "F3F4F6",
              line: { color: "F3F4F6", width: 0 },
            },
          ],
        },
      }],
    });
    const hit = getRenderDiagnostics().find((item) => item.code === "DECORATIVE_OVERLAP" && item.nodeId === "decorative-overlap.decor");
    expect(hit?.severity).toBe("info");
    expect(isBlockingRenderDiagnostic(hit?.code || "", hit?.severity || "info")).toBe(false);
  });
});
