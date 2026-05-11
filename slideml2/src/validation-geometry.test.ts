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
    expect(isBlockingRenderDiagnostic("SIBLING_INK_OVERLAP", "warn")).toBe(true);
    expect(isBlockingRenderDiagnostic("FALLBACK_FAILED", "warn")).toBe(true);
    expect(isBlockingRenderDiagnostic("OVERFLOW", "warn")).toBe(false);
    expect(isBlockingRenderDiagnostic("CUSTOM_ERROR", "error")).toBe(true);
    expect(isQualityRenderDiagnostic("TIGHT_GAP")).toBe(true);
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
    expect(hit?.measured?.overlapAreaCm2).toBeGreaterThan(0.05);
    expect(hit?.measured?.relationship).toBe("leaf-ink-overlap");
    expect(hit?.measured?.other?.nodeId).toBe("collision.b");
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
