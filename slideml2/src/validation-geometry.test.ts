import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isBlockingRenderDiagnostic, isQualityRenderDiagnostic } from "./diagnostic-codes.js";
import { clearRenderDiagnostics, getRenderDiagnostics } from "./diagnostics.js";
import { meaningfulOverlap } from "./layout/geometry.js";
import { measureDeck, renderToAst, renderToPptx } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { RenderedDeck, Slideml2SourceDeck } from "./types.js";
import { validateDeck } from "./validate.js";

interface RenderTreeNode {
  id?: string;
  fontSize?: number;
  children?: RenderTreeNode[];
  [key: string]: unknown;
}

function findRenderTreeNode(node: RenderTreeNode | undefined, id: string): RenderTreeNode | undefined {
  if (!node) return undefined;
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findRenderTreeNode(child, id);
    if (found) return found;
  }
  return undefined;
}

describe("validation geometry and diagnostic contracts", () => {
  const TINY_SVG = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiPjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiIGZpbGw9IiMyNTYzZWIiLz48L3N2Zz4=";

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
    expect(isQualityRenderDiagnostic("LOW_CONTRAST")).toBe(true);
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

  it("writes the measured semantic-cohort DOM into the render tree", async () => {
    const deck: RenderedDeck = {
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "cohort-tree",
        layout: "freeform",
        dom: {
          id: "cohort-tree.root",
          type: "slide",
          children: [{
            id: "cohort-tree.row",
            type: "stack",
            direction: "horizontal",
            gap: 0.25,
            at: [1, 1, 11.4, 1.7],
            children: [
              {
                id: "cohort-tree.a",
                type: "stack",
                role: "feature-card",
                direction: "vertical",
                padding: 0.28,
                gap: 0.12,
                children: [
                  { id: "cohort-tree.a.title", type: "text", text: "实验端", style: "card-title", fontSize: 16 },
                  { id: "cohort-tree.a.body", type: "text", text: "短说明。", style: "paragraph", fontSize: 14, autoFit: "shrink" },
                ],
              },
              {
                id: "cohort-tree.b",
                type: "stack",
                role: "feature-card",
                direction: "vertical",
                padding: 0.28,
                gap: 0.12,
                children: [
                  { id: "cohort-tree.b.title", type: "text", text: "理论端", style: "card-title", fontSize: 16 },
                  { id: "cohort-tree.b.body", type: "text", text: "这段说明故意很长，用来触发 measured cohort 的页面内一致压缩；render-tree 必须记录最终用于 PPTX 的 DOM。", style: "paragraph", fontSize: 14, autoFit: "shrink" },
                ],
              },
              {
                id: "cohort-tree.c",
                type: "stack",
                role: "feature-card",
                direction: "vertical",
                padding: 0.28,
                gap: 0.12,
                children: [
                  { id: "cohort-tree.c.title", type: "text", text: "传播端", style: "card-title", fontSize: 16 },
                  { id: "cohort-tree.c.body", type: "text", text: "短说明。", style: "paragraph", fontSize: 14, autoFit: "shrink" },
                ],
              },
            ],
          }],
        },
      }],
    };
    const dir = mkdtempSync(join(tmpdir(), "slideml2-cohort-tree-"));
    const out = join(dir, "deck.pptx");

    await renderToPptx(deck, out);
    const tree = JSON.parse(readFileSync(`${out}.render-tree.json`, "utf8")) as {
      slides: Array<{ dom?: RenderTreeNode; measured?: { layoutDecisions?: Array<{ nodeId?: string; notes?: string[] }> } }>;
    };
    const shortBody = findRenderTreeNode(tree.slides[0]?.dom, "cohort-tree.a.body");
    const denseBody = findRenderTreeNode(tree.slides[0]?.dom, "cohort-tree.b.body");
    const decisions = tree.slides[0]?.measured?.layoutDecisions || [];

    expect(shortBody?.fontSize).toBeLessThan(14);
    expect(denseBody?.fontSize).toBe(shortBody?.fontSize);
    expect(decisions.some((item) => item.nodeId === "cohort-tree.a" && item.notes?.some((note) => note.includes("semantic-cohort:")))).toBe(true);
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

  it("keeps fallback-shrunk short display text from inflating sibling ink overlap", () => {
    clearRenderDiagnostics();
    const measured = measureDeck({
      deck: {
        size: "16x9",
        theme: "default",
        brand: { name: "La Chute - Fall", primary: "2563EB" },
        themeOverride: {
          colors: {
            background: "#0A0A0A",
            surface: "#111111",
            "text.primary": "#E8E0D5",
            "text.secondary": "#8A8070",
            "brand.primary": "#B8933F",
            "gold.dark": "#6B5A2F",
            gold: "#B8933F",
            "gold.bright": "#E8C97A",
            "blue.muted": "#6B7A8A",
            danger: "#A05050",
          },
          text: {
            "slide-title": { fontFamily: "display", fontSize: 36, fontWeight: "bold", color: "#E8C97A" },
            "section-title": { fontFamily: "display", fontSize: 28, fontWeight: "bold", color: "#E8C97A" },
            "card-title": { fontFamily: "display", fontSize: 18, fontWeight: "bold", color: "#E8E0D5" },
            paragraph: { fontFamily: "text", fontSize: 16, lineSpacing: 1.5, color: "#E8E0D5" },
            caption: { fontFamily: "text", fontSize: 12, color: "#8A8070" },
            label: { fontFamily: "text", fontSize: 12, color: "#6B7A8A" },
            "metric-value": { fontFamily: "display", fontSize: 72, fontWeight: "bold", color: "#B8933F" },
          },
          layout: { titleTop: 0, titleHeight: 0, contentTop: 0.6, contentBottom: 13.8, pageMarginX: 1.5 },
          fonts: {
            latin: { display: "Georgia", text: "Georgia" },
            cjk: { display: "Noto Serif SC", text: "Noto Serif SC" },
          },
          chrome: { brandMark: "none" },
        },
      },
      slides: [{
        id: "ending-fit",
        layout: "freeform",
        dom: {
          id: "ending-fit.root",
          type: "slide",
          background: "#0A0A0A",
          children: [{
            id: "ending-fit.stack",
            type: "stack",
            align: "center",
            gap: 0.5,
            children: [
              { id: "ending-fit.sink", type: "text", text: "沉没", fontSize: 48, fontWeight: "bold", fontFamily: "display", color: "#6B7A8A", align: "center" },
              { id: "ending-fit.float", type: "text", text: "还是漂浮", fontSize: 48, fontWeight: "bold", fontFamily: "display", color: "#E8E0D5", align: "center" },
              { id: "ending-fit.spacer-1", type: "spacer", fixedHeight: 0.8 },
              { id: "ending-fit.body-1", type: "text", text: "阿姆斯特丹是一座低于海平面的城市。", fontSize: 15, fontFamily: "text", color: "#8A8070", align: "center", lineSpacing: 1.5 },
              { id: "ending-fit.body-2", type: "text", text: "克拉芒斯把自己沉入这座水下城市——是选择，也是隐喻。", fontSize: 15, fontFamily: "text", color: "#8A8070", align: "center", lineSpacing: 1.5 },
              { id: "ending-fit.body-3", type: "text", text: "我们活在自己的「堕落」之中。", fontSize: 15, fontFamily: "text", color: "#E8E0D5", align: "center", lineSpacing: 1.5 },
              { id: "ending-fit.body-4", type: "text", text: "问题在于：你是在下沉，还是在漂浮？", fontSize: 15, fontFamily: "text", color: "#E8E0D5", align: "center", lineSpacing: 1.5 },
              { id: "ending-fit.spacer-2", type: "spacer", fixedHeight: 1 },
              { id: "ending-fit.divider", type: "divider", direction: "horizontal", thickness: 0.5, color: "#6B5A2F", length: 8 },
              { id: "ending-fit.spacer-3", type: "spacer", fixedHeight: 0.8 },
              { id: "ending-fit.spacer-4", type: "spacer", fixedHeight: 0.5 },
              { id: "ending-fit.choice", type: "text", text: "Il faut choisir.", fontSize: 32, fontWeight: "bold", fontFamily: "display", color: "#E8C97A", align: "center" },
              { id: "ending-fit.spacer-5", type: "spacer", fixedHeight: 0.3 },
              { id: "ending-fit.must", type: "text", text: "必须选择。", fontSize: 16, fontFamily: "text", color: "#8A8070", align: "center" },
              { id: "ending-fit.spacer-6", type: "spacer", fixedHeight: 0.5 },
              { id: "ending-fit.brand", type: "brand-mark", text: "- Fin -", corner: "bottom-right", tone: "muted" },
            ],
          }],
        },
      }],
    });

    const diagnostics = getRenderDiagnostics();
    expect(diagnostics.some((item) =>
      item.code === "SIBLING_INK_OVERLAP"
      && String(item.nodeId || "").startsWith("ending-fit.")
    )).toBe(false);
    const nodes = measured[0]?.nodes || [];
    const choice = nodes.find((item) => item.id === "ending-fit.choice");
    const must = nodes.find((item) => item.id === "ending-fit.must");
    expect((choice?.visualRect?.y ?? 0) + (choice?.visualRect?.h ?? 0)).toBeLessThanOrEqual((must?.visualRect?.y ?? 0) + 0.02);
  });

  it("pre-shrinks mildly tight body text and does not emit blocking fit failure", () => {
    clearRenderDiagnostics();
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "body-prefit",
        layout: "freeform",
        dom: {
          id: "body-prefit.root",
          type: "slide",
          children: [{
            id: "body-prefit.text",
            type: "text",
            at: [1, 1, 7, 1.6],
            style: "paragraph",
            text: "This paragraph is just a little too long for its original body size but should remain readable after a small renderer-side font fit.",
          }],
        },
      }],
    });

    const diagnostics = getRenderDiagnostics();
    const repaired = diagnostics.find((item) => item.code === "TRUNCATED" && item.nodeId === "body-prefit.text");
    expect(repaired?.severity).toBe("warn");
    expect(repaired?.measured?.fitMethod).toBe("pre-shrink");
    expect(repaired?.measured?.finalFontSize).toBeGreaterThanOrEqual(8);
    expect(diagnostics.some((item) => item.code === "FALLBACK_FAILED" && item.nodeId === "body-prefit.text")).toBe(false);
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

  it("suppresses mild readable text squash instead of emitting an unreliable warning", () => {
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
    expect(hit).toBeUndefined();
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

  it("lets no-title slides use the title zone instead of starting at contentTop", () => {
    const measured = measureDeck(sourceToRenderedDeck({
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        themeOverride: {
          layout: { pageMarginX: 2, titleTop: 2.2, titleHeight: 1.2, contentTop: 3.8, contentBottom: 13 },
        },
      },
      slides: [{
        id: "no-title-prologue",
        children: [{ type: "text", text: "No title slide should not reserve title chrome." }],
      }],
    }));

    const content = measured[0].nodes.find((item) => item.id === "no-title-prologue.content");
    expect(content?.rect.y).toBeCloseTo(2.2, 3);
    expect(content?.rect.h).toBeCloseTo(10.8, 3);
  });

  it("treats explicit spacers as gap replacements in stacks", () => {
    const measured = measureDeck({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "spacer-gap",
        layout: "content",
        dom: {
          id: "spacer-gap.root",
          type: "slide",
          children: [{
            id: "spacer-gap.stack",
            type: "stack",
            area: "content",
            gap: 0.35,
            children: [
              { id: "spacer-gap.a", type: "shape", preset: "rect", fixedHeight: 1 },
              { id: "spacer-gap.spacer", type: "spacer", fixedHeight: 0.3 },
              { id: "spacer-gap.b", type: "shape", preset: "rect", fixedHeight: 1 },
            ],
          }],
        },
      }],
    });
    const byId = new Map(measured[0].nodes.map((item) => [item.id, item]));
    const a = byId.get("spacer-gap.a")!.rect;
    const spacer = byId.get("spacer-gap.spacer")!.rect;
    const b = byId.get("spacer-gap.b")!.rect;

    expect(spacer.y).toBeCloseTo(a.y + a.h, 3);
    expect(b.y).toBeCloseTo(spacer.y + spacer.h, 3);
  });

  it("keeps a naturally-authored no-title prologue quote renderable", () => {
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck({
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        themeOverride: {
          layout: { pageMarginX: 2, titleTop: 2.2, titleHeight: 1.2, contentTop: 3.8, contentBottom: 13 },
        },
      },
      slides: [{
        id: "prologue-quote",
        children: [{
          type: "two-column",
          ratio: [0.6, 0.4],
          gap: 0.6,
          left: { children: [{ type: "image-card", src: TINY_SVG, fit: "cover", alt: "landscape" }] },
          right: {
            children: [
              { type: "eyebrow", text: "序 · 地理", tone: "brand" },
              { type: "spacer", fixedHeight: 0.3 },
              { type: "h1", text: "在滇西北的群山之间，有一片被雪山托举的天空。" },
              { type: "spacer", fixedHeight: 0.4 },
              { type: "paragraph", text: "香格里拉，藏语意为\"心中的日月\"。平均海拔3449米，位于云南省迪庆藏族自治州，群峰耸立，三江并流。" },
              { type: "spacer", fixedHeight: 0.4 },
              { type: "quote", text: "云岭如一道银色的脊梁，横卧在滇西北的天际。", source: "高原行者" },
            ],
          },
        }],
      }],
    }));

    const blocking = getRenderDiagnostics().filter((item) => item.severity === "error");
    expect(blocking, blocking.map((item) => `${item.code}:${item.nodeId}`).join("\n")).toHaveLength(0);
    expect(getRenderDiagnostics().some((item) => item.code === "SIBLING_INK_OVERLAP" && String(item.nodeId || "").includes(".quote"))).toBe(false);
  });

  it("keeps a natural split rail with hero-stat and key-takeaway non-blocking", () => {
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck({
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "8B4513" },
        themeOverride: {
          colors: {
            brand: { primary: "8B4513" },
            background: "FDFAF6",
            surface: "FFFFFF",
            text: { primary: "2C2C2C", secondary: "6B6B6B", inverse: "FDFAF6" },
            divider: "E8E0D5",
            muted: "9A8F82",
          },
          text: {
            "slide-title": { fontSize: 32, fontWeight: "bold", color: "text.primary" },
            "section-title": { fontSize: 24, fontWeight: "semibold", color: "text.primary" },
            "card-title": { fontSize: 18, fontWeight: "semibold", color: "text.primary" },
            paragraph: { fontSize: 14, lineSpacing: 1.6, color: "text.primary" },
            caption: { fontSize: 11, color: "text.secondary" },
            "metric-value": { fontSize: 28, fontWeight: "bold", color: "brand.primary" },
          },
          layout: { pageMarginX: 1.5, titleTop: 1.2, titleHeight: 1.2, contentTop: 3.2, contentBottom: 13, defaultGap: 0.5 },
        },
      },
      slides: [{
        id: "snow-mountain",
        title: "梅里雪山 · 日照金山",
        children: [{
          type: "split",
          ratio: [0.6, 0.4],
          gap: 0.6,
          children: [
            { type: "image-card", src: TINY_SVG, fit: "cover", alt: "梅里雪山日照金山" },
            {
              type: "stack",
              gap: 0.4,
              children: [
                { type: "eyebrow", text: "神山", tone: "muted" },
                { type: "h1", text: "梅里雪山" },
                { type: "spacer", fixedHeight: 0.3 },
                { type: "hero-stat", value: "6,740m", label: "卡瓦格博峰海拔", caption: "云南最高峰 · 藏区八大神山之首" },
                { type: "spacer", fixedHeight: 0.3 },
                {
                  type: "key-takeaway",
                  headline: "当第一缕阳光洒向神山，金色的光芒如同神明的祝福——这一刻，你便会明白，什么是永恒。",
                  variant: "minimal",
                },
              ],
            },
          ],
        }],
      }],
    }));

    const diagnostics = getRenderDiagnostics();
    const blocking = diagnostics.filter((item) => item.severity === "error");
    expect(blocking, blocking.map((item) => `${item.code}:${item.nodeId}`).join("\n")).toHaveLength(0);
    expect(diagnostics.some((item) => item.code === "REGION_OVER_CAPACITY" && item.nodeId === "snow-mountain.node-1.2")).toBe(false);
    expect(diagnostics.some((item) => item.code === "SIBLING_INK_OVERLAP" && item.severity === "error")).toBe(false);
    expect(diagnostics.some((item) => item.code === "SQUASHED" && item.nodeId === "snow-mountain.node-1.2.4.value" && item.severity === "error")).toBe(false);
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
    expect(hit).toBeUndefined();
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

    const hit = getRenderDiagnostics().find((item) => (item.code === "OVERFLOW" || item.code === "TRUNCATED") && item.nodeId === "bullet-fit-drift.bullets");
    expect(hit?.severity).toBe("warn");
    expect(isBlockingRenderDiagnostic(hit?.code, hit?.severity)).toBe(false);
    expect(hit?.measured?.fitMethod).toBeDefined();
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

  it("reallocates compact kpi-grid value bands so two-line labels stay inside metric cards", () => {
    clearRenderDiagnostics();
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "8A2545" },
        themeOverride: {
          text: {
            "metric-value": { fontSize: 30.7, fontWeight: "bold", lineHeight: 0.96 },
            "metric-label": { fontSize: 14, lineHeight: 1.12 },
          },
        },
      },
      slides: [{
        id: "kpi-label-repair",
        children: [{
          id: "kpi-label-repair.kpis",
          type: "kpi-grid",
          at: [1, 1, 9.422, 2.24],
          columns: 3,
          variant: "compact",
          density: "compact",
          metrics: [
            { value: "碧塔海", label: "镜面湖泊，倒映冷杉" },
            { value: "属都湖", label: "晨雾栈道，穿行林间" },
            { value: "弥里塘", label: "牦牛牧场，远山如黛" },
          ],
        }],
      }],
    };

    const measured = measureDeck(sourceToRenderedDeck(deck))[0]?.nodes || [];
    const byId = new Map(measured.map((node) => [node.id, node]));
    const label = byId.get("kpi-label-repair.kpis-m1.label");
    const valueWrap = byId.get("kpi-label-repair.kpis-m1.value-wrap");
    const card = byId.get("kpi-label-repair.kpis-m1");
    expect(valueWrap?.rect.h).toBeGreaterThanOrEqual(0.61);
    expect((valueWrap?.rect.y ?? 0) - (card?.rect.y ?? 0)).toBeGreaterThanOrEqual(0.29);
    expect(label?.rect.h).toBeGreaterThan(0.34);
    expect((label?.visualRect?.y ?? 0) + (label?.visualRect?.h ?? 0)).toBeLessThanOrEqual((card?.rect.y ?? 0) + (card?.rect.h ?? 0) + 0.06);

    const blocking = getRenderDiagnostics().filter((item) =>
      item.severity === "error"
      && (item.nodeId?.startsWith("kpi-label-repair.kpis-m") || item.measured?.relationship?.includes("kpi-label-repair.kpis-m"))
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toHaveLength(0);
  });

  it("rejects compact kpi-grid repair when breathing room would be over-compressed", () => {
    clearRenderDiagnostics();
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "8A2545" },
        themeOverride: {
          text: {
            "metric-value": { fontSize: 30.7, fontWeight: "bold", lineHeight: 0.96 },
            "metric-label": { fontSize: 14, lineHeight: 1.12 },
          },
        },
      },
      slides: [{
        id: "kpi-label-overcompressed",
        children: [{
          id: "kpi-label-overcompressed.kpis",
          type: "kpi-grid",
          at: [1, 1, 9.422, 1.87],
          columns: 3,
          variant: "compact",
          density: "compact",
          metrics: [
            { value: "碧塔海", label: "镜面湖泊，倒映冷杉" },
            { value: "属都湖", label: "晨雾栈道，穿行林间" },
            { value: "弥里塘", label: "牦牛牧场，远山如黛" },
          ],
        }],
      }],
    };

    measureDeck(sourceToRenderedDeck(deck));
    const hit = getRenderDiagnostics().find((item) =>
      item.code === "FALLBACK_FAILED"
      && item.severity === "error"
      && item.nodeId === "kpi-label-overcompressed.kpis-m1"
      && item.measured?.fitMethod === "metric-card-repair-budget"
    );
    expect(hit?.message).toContain("minimum text breathing room");
    expect(hit?.measured?.needed).toBeGreaterThan(hit?.measured?.available ?? 999);
  });

  it("applies one cohort repair profile to compact numeric KPI peers", () => {
    clearRenderDiagnostics();
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "2563EB" },
        themeOverride: {
          text: {
            "metric-value": { fontSize: 30.7, fontWeight: "bold", lineHeight: 0.96 },
            "metric-label": { fontSize: 14, lineHeight: 1.12 },
          },
        },
      },
      slides: [{
        id: "kpi-cohort-repair",
        children: [{
          id: "kpi-cohort-repair.kpis",
          type: "kpi-grid",
          at: [1, 1, 12.2, 1.68],
          columns: 3,
          variant: "compact",
          density: "compact",
          metrics: [
            { value: "27 km", label: "隧道周长" },
            { value: "13.6 TeV", label: "质心能量" },
            { value: "$17B", label: "预算量级" },
          ],
        }],
      }],
    };

    const measured = measureDeck(sourceToRenderedDeck(deck))[0]?.nodes || [];
    const byId = new Map(measured.map((node) => [node.id, node]));
    const ids = [1, 2, 3].map((index) => `kpi-cohort-repair.kpis-m${index}`);
    const valueHeights = ids.map((id) => byId.get(`${id}.value-wrap`)?.rect.h.toFixed(3));
    const labelHeights = ids.map((id) => byId.get(`${id}.label`)?.rect.h.toFixed(3));
    expect(new Set(valueHeights).size).toBe(1);
    expect(new Set(labelHeights).size).toBe(1);
    expect(Number(valueHeights[0])).toBeLessThan(0.74);
    expect(Number(labelHeights[0])).toBeGreaterThan(0.34);
    expect(Number(labelHeights[0])).toBeLessThan(0.5);

    const diagnostics = getRenderDiagnostics().filter((item) =>
      ["FALLBACK_FAILED", "SQUASHED", "TRUNCATED"].includes(item.code)
      && ids.some((id) => String(item.nodeId || "").startsWith(id)),
    );
    expect(diagnostics, JSON.stringify(diagnostics, null, 2)).toHaveLength(0);
  });

  it("reports strict overflow when metric-card text ink escapes the card", () => {
    clearRenderDiagnostics();
    renderToAst({
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "8A2545" },
        themeOverride: {
          text: {
            "metric-value": { fontSize: 30.7, fontWeight: "bold", lineHeight: 0.96 },
            "metric-label": { fontSize: 14, lineHeight: 1.12 },
          },
        },
      },
      slides: [{
        id: "metric-ink-escape",
        layout: "freeform",
        dom: {
          id: "metric-ink-escape.root",
          type: "slide",
          children: [{
            id: "metric-ink-escape.card",
            type: "stack",
            role: "metric-card",
            direction: "vertical",
            gap: 0.1,
            padding: 0.4,
            at: [1, 1, 2.927, 2.169],
            children: [
              {
                id: "metric-ink-escape.card.value-wrap",
                type: "stack",
                direction: "vertical",
                fixedHeight: 1.36,
                children: [{
                  id: "metric-ink-escape.card.value",
                  type: "text",
                  text: "碧塔海",
                  style: "metric-value",
                  align: "center",
                  valign: "bottom",
                  autoFit: "shrink",
                  noWrap: true,
                }],
              },
              {
                id: "metric-ink-escape.card.label",
                type: "text",
                text: "镜面湖泊，倒映冷杉，晨雾栈道，穿行林间",
                style: "metric-label",
                fixedHeight: 0.34,
                align: "center",
                valign: "top",
                autoFit: "shrink",
              },
            ],
          }],
        },
      }],
    });

    const hit = getRenderDiagnostics().find((item) =>
      item.code === "OVERFLOW"
      && item.severity === "error"
      && item.nodeId === "metric-ink-escape.card.label"
    );
    expect(hit?.measured?.relationship).toContain("metric-ink-escape.card");
  });

  it("enforces elastic budgets for semantic components beyond metric cards", () => {
    clearRenderDiagnostics();
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "semantic-elastic-budget",
        layout: "freeform",
        dom: {
          id: "semantic-elastic-budget.root",
          type: "slide",
          children: [{
            id: "semantic-elastic-budget.card",
            type: "stack",
            role: "insight-card",
            direction: "vertical",
            gap: 0.18,
            padding: 0.4,
            at: [1, 1, 4.2, 0.95],
            children: [
              {
                id: "semantic-elastic-budget.card.title",
                type: "text",
                text: "A required insight title",
                style: "card-title",
                minHeight: 0.52,
                autoFit: "shrink",
              },
              {
                id: "semantic-elastic-budget.card.body",
                type: "text",
                text: "Required explanatory body copy that must keep readable breathing room inside the semantic card.",
                style: "paragraph",
                minHeight: 0.68,
                autoFit: "shrink",
              },
            ],
          }],
        },
      }],
    });

    const hit = getRenderDiagnostics().find((item) =>
      item.code === "FALLBACK_FAILED"
      && item.severity === "error"
      && item.nodeId === "semantic-elastic-budget.card"
      && item.measured?.fitMethod === "component-elastic-budget"
    );
    expect(hit?.message).toContain("elastic compression budget");
    expect(hit?.measured?.needed).toBeGreaterThan(hit?.measured?.available ?? 999);
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

  it("keeps intentional muted editorial text contrast quality-only", () => {
    const ast = renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "muted-editorial-contrast",
        layout: "freeform",
        dom: {
          id: "muted-editorial-contrast.root",
          type: "slide",
          background: "F7F4EE",
          children: [{
            id: "muted-editorial-contrast.body",
            type: "text",
            text: "香格里拉，藏语意为心中的日月。平均海拔3449米，群峰耸立，三江并流。",
            style: "paragraph",
            color: "9A8A7A",
            at: [1, 1, 9, 1.4],
          }],
        },
      }],
    });
    const hit = getRenderDiagnostics().find((item) =>
      item.code === "LOW_CONTRAST" && item.nodeId === "muted-editorial-contrast.body"
    );
    expect(hit?.severity).toBe("warn");
    expect(hit?.measured?.perceptualContrastLc).toBeGreaterThan(hit?.measured?.perceptualReadableFloorLc ?? 0);
    expect(isBlockingRenderDiagnostic(hit?.code, hit?.severity)).toBe(false);
    const shape = ast.slides[0]?.shapes.find((item) => item.type === "text" && item.name === "muted-editorial-contrast.body");
    expect(shape?.type).toBe("text");
    if (shape?.type === "text") {
      expect(shape.paragraphs[0]?.runs[0]?.color).toBe("9A8A7A");
    }
  });

  it("keeps genuinely unreadable low contrast blocking when it cannot be safely auto-fixed", () => {
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "unreadable-custom-contrast",
        layout: "freeform",
        dom: {
          id: "unreadable-custom-contrast.root",
          type: "slide",
          background: "FFFFFF",
          children: [{
            id: "unreadable-custom-contrast.body",
            type: "text",
            text: "Small body text cannot rely on this near-white custom gray.",
            style: "caption",
            fontSize: 10,
            color: "D0D0D0",
            at: [1, 1, 8, 0.8],
          }],
        },
      }],
    });
    const hit = getRenderDiagnostics().find((item) =>
      item.code === "LOW_CONTRAST" && item.nodeId === "unreadable-custom-contrast.body"
    );
    expect(hit?.severity).toBe("error");
    expect(isBlockingRenderDiagnostic(hit?.code, hit?.severity)).toBe(true);
  });

  it("evaluates translucent solid surfaces by their effective blended color", () => {
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "translucent-surface-contrast",
        layout: "freeform",
        dom: {
          id: "translucent-surface-contrast.root",
          type: "slide",
          background: "FFFFFF",
          children: [
            { id: "translucent-surface-contrast.tint", type: "shape", preset: "rect", fill: "000000", fillOpacity: 0.35, at: [1, 1, 8, 1.2] },
            { id: "translucent-surface-contrast.body", type: "text", text: "Black text on a translucent gray tint is readable.", style: "paragraph", color: "000000", at: [1.2, 1.15, 7.6, 0.8] },
          ],
        },
      }],
    });
    expect(getRenderDiagnostics().some((item) =>
      (item.code === "LOW_CONTRAST" || item.code === "LOW_CONTRAST_FIXED") && item.nodeId === "translucent-surface-contrast.body"
    )).toBe(false);
  });

  it("excludes layout-only spacers from collision diagnostics", () => {
    clearRenderDiagnostics();
    measureDeck({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "spacer-collision",
        layout: "freeform",
        dom: {
          id: "spacer-collision.root",
          type: "slide",
          children: [
            { id: "spacer-collision.space", type: "spacer", at: [1, 1, 7, 1] },
            { id: "spacer-collision.text", type: "text", text: "Visible text", style: "paragraph", at: [1, 1.2, 7, 1] },
          ],
        },
      }],
    });
    expect(getRenderDiagnostics().some((item) =>
      (item.code === "COLLISION" || item.code === "SIBLING_INK_OVERLAP")
      && (item.nodeId === "spacer-collision.space" || item.measured?.other?.nodeId === "spacer-collision.space")
    )).toBe(false);
  });

  it("does not treat top-level positioned spacers as source overlap blockers", () => {
    const report = validateDeck({
      slideml2: 2,
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "source-spacer-overlap",
        title: "Source spacer overlap",
        children: [
          { id: "source-spacer-overlap.body", type: "text", area: "content", text: "Real content in the content region.", style: "paragraph" },
          { id: "source-spacer-overlap.space", type: "spacer", at: [0, 0, 20, 11] },
        ],
      }],
    });
    expect(report.errors.some((item) => item.code === "TOP_LEVEL_LAYOUT_OVERLAP" && item.nodeName === "source-spacer-overlap.space")).toBe(false);
  });

  it("keeps thin divider-like shape overlaps non-blocking", () => {
    clearRenderDiagnostics();
    measureDeck({
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [{
        id: "thin-shape-overlap",
        layout: "freeform",
        dom: {
          id: "thin-shape-overlap.root",
          type: "slide",
          children: [
            { id: "thin-shape-overlap.text", type: "text", text: "A divider can pass near text without becoming a blocking collision.", style: "paragraph", at: [1, 1, 8, 0.9] },
            { id: "thin-shape-overlap.rule", type: "shape", preset: "rect", fill: "brand.primary", at: [1, 1.4, 8, 0.05] },
          ],
        },
      }],
    });
    expect(getRenderDiagnostics().some((item) =>
      (item.code === "COLLISION" || item.code === "SIBLING_INK_OVERLAP") && item.severity === "error"
    )).toBe(false);
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

  it("does not treat a first-painted full-slide band scrim as content collision", () => {
    clearRenderDiagnostics();
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "C8102E" } },
      slides: [{
        id: "cover-band-scrim",
        layout: "freeform",
        dom: {
          id: "cover-band-scrim.root",
          type: "slide",
          children: [
            {
              id: "cover-band-scrim.scrim",
              type: "band",
              fill: "1A1A2E",
              opacity: 0.55,
              children: [],
            },
            {
              id: "cover-band-scrim.copy",
              type: "stack",
              area: "content",
              gap: 0.3,
              children: [
                { id: "cover-band-scrim.eyebrow", type: "text", text: "云南 · 迪庆藏族自治州", style: "label", color: "D4A853" },
                { id: "cover-band-scrim.title", type: "text", text: "寻找梦中的香格里拉", style: "deck-title", color: "text.inverse" },
                { id: "cover-band-scrim.subtitle", type: "text", text: "高原的天空，雪山的呼吸，藏地的呢喃", style: "lead", color: "text.inverse" },
              ],
            },
          ],
        },
      }],
    });
    const blockingOverlaps = getRenderDiagnostics().filter((item) =>
      (item.code === "COLLISION" || item.code === "SIBLING_INK_OVERLAP" || item.code === "OVERLAY_OCCLUDES_FLOW")
      && (item.nodeId === "cover-band-scrim.scrim" || item.measured?.other?.nodeId === "cover-band-scrim.scrim")
    );
    expect(blockingOverlaps, JSON.stringify(blockingOverlaps, null, 2)).toHaveLength(0);
  });

  it("still reports a full-slide band that paints over existing content", () => {
    clearRenderDiagnostics();
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "C8102E" } },
      slides: [{
        id: "foreground-band-cover",
        layout: "freeform",
        dom: {
          id: "foreground-band-cover.root",
          type: "slide",
          children: [
            {
              id: "foreground-band-cover.copy",
              type: "text",
              area: "content",
              text: "This text is painted first and should not be covered by a later full-slide band.",
              style: "paragraph",
            },
            {
              id: "foreground-band-cover.scrim",
              type: "band",
              fill: "1A1A2E",
              opacity: 0.55,
              children: [],
            },
          ],
        },
      }],
    });
    const hit = getRenderDiagnostics().find((item) =>
      item.code === "COLLISION"
      && (item.nodeId === "foreground-band-cover.copy" || item.measured?.other?.nodeId === "foreground-band-cover.scrim")
    );
    expect(hit?.severity).toBe("error");
  });

  it("does not block readable stat-strip metric values on line-box target height alone", () => {
    clearRenderDiagnostics();
    renderToAst({
      deck: { size: "16x9", theme: "default", brand: { primary: "C8102E" } },
      slides: [{
        id: "stat-strip-readable",
        layout: "freeform",
        dom: {
          id: "stat-strip-readable.root",
          type: "slide",
          children: [{
            id: "stat-strip-readable.strip",
            type: "stack",
            at: [14.876, 5.508, 9.324, 2.05],
            direction: "horizontal",
            gap: 0.5,
            role: "stat-strip",
            align: "stretch",
            valign: "middle",
            children: [
              {
                id: "stat-strip-readable.0",
                type: "stack",
                direction: "vertical",
                gap: 0.15,
                align: "center",
                justify: "center",
                valign: "middle",
                fixedHeight: 2.05,
                layoutWeight: 4,
                children: [
                  { id: "stat-strip-readable.0.value", type: "text", text: "3,300", style: "metric-value", color: "brand.primary", align: "center", valign: "bottom", autoFit: "shrink", minHeight: 0.9 },
                  { id: "stat-strip-readable.0.label", type: "text", text: "平均海拔（米）", style: "metric-label", color: "text.muted", align: "center", valign: "top", autoFit: "shrink", minHeight: 0.36 },
                ],
              },
              { id: "stat-strip-readable.sep1", type: "shape", preset: "rect", fill: "divider", fixedWidth: 0.04, fixedHeight: 1.35, align: "center", valign: "middle" },
              {
                id: "stat-strip-readable.1",
                type: "stack",
                direction: "vertical",
                gap: 0.15,
                align: "center",
                justify: "center",
                valign: "middle",
                fixedHeight: 2.05,
                layoutWeight: 4,
                children: [
                  { id: "stat-strip-readable.1.value", type: "text", text: "13", style: "metric-value", color: "brand.primary", align: "center", valign: "bottom", autoFit: "shrink", minHeight: 0.9 },
                  { id: "stat-strip-readable.1.label", type: "text", text: "座海拔4000+山峰", style: "metric-label", color: "text.muted", align: "center", valign: "top", autoFit: "shrink", minHeight: 0.36 },
                ],
              },
              { id: "stat-strip-readable.sep2", type: "shape", preset: "rect", fill: "divider", fixedWidth: 0.04, fixedHeight: 1.35, align: "center", valign: "middle" },
              {
                id: "stat-strip-readable.2",
                type: "stack",
                direction: "vertical",
                gap: 0.15,
                align: "center",
                justify: "center",
                valign: "middle",
                fixedHeight: 2.05,
                layoutWeight: 4,
                children: [
                  { id: "stat-strip-readable.2.value", type: "text", text: "90%", style: "metric-value", color: "brand.primary", align: "center", valign: "bottom", autoFit: "shrink", minHeight: 0.9 },
                  { id: "stat-strip-readable.2.label", type: "text", text: "森林覆盖率", style: "metric-label", color: "text.muted", align: "center", valign: "top", autoFit: "shrink", minHeight: 0.36 },
                ],
              },
            ],
          }],
        },
      }],
    });
    const blocking = getRenderDiagnostics().filter((item) =>
      item.code === "SQUASHED"
      && item.severity === "error"
      && item.nodeId?.startsWith("stat-strip-readable.")
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toHaveLength(0);
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
