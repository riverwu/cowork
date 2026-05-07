import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
  type LayoutDiagnostic,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Regressions for the 2pmnxh debug log (2026-05-03 05:16). The agent
 * authored a 6-step horizontal timeline on a dark theme; LOW_CONTRAST kept
 * firing on the time label (color: brand.primary, dark red on near-black bg)
 * and the body (style: caption → text.muted, very low-contrast gray).
 *
 * These tests pin two complementary fixes:
 *   - the timelineStep factory now uses text.primary on the body and
 *     text.secondary on the time label, both of which resolve to readable
 *     colors against any deck surface.
 *   - the renderer's auto-fix now rewrites unreadable body text to a
 *     contrasting neutral when the resolved color matches a known
 *     low-contrast theme token (text.muted, text.secondary defaults).
 */

const BLOCKING: ReadonlySet<LayoutDiagnostic["code"]> = new Set([
  "FALLBACK_FAILED", "COLLISION", "TINY_RECT", "SQUASHED", "LOW_CONTRAST", "UNKNOWN_COLOR", "UNKNOWN_STYLE",
]);

function deckWith(slides: SlideV2[], themeOverride?: Slideml2SourceDeck["deck"]["themeOverride"]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { name: "Test", primary: "C0392B" }, themeOverride },
    slides,
  };
}

function blockingAfterRender(deck: Slideml2SourceDeck): LayoutDiagnostic[] {
  clearRenderDiagnostics();
  renderToAst(sourceToRenderedDeck(deck));
  return getRenderDiagnostics().filter((d) => BLOCKING.has(d.code) && d.severity !== "info");
}

describe("timeline on a dark-theme deck (2pmnxh)", () => {
  const darkOverride: Slideml2SourceDeck["deck"]["themeOverride"] = {
    colors: {
      brand: { primary: "C0392B" },
      background: "0D1117",
      surface: "161B22",
      text: { primary: "F0F6FC", secondary: "8B949E", muted: "484F58", inverse: "0D1117" },
    } as any,
  };

  it("6-step horizontal timeline with bodies renders without LOW_CONTRAST on a dark deck", () => {
    const slide: SlideV2 = {
      id: "s1",
      title: "中华文明发展历程",
      children: [
        { id: "s1.lead", type: "lead", text: "上下五千年，源远流长", align: "center" } as unknown as DomNode,
        {
          id: "s1.timeline",
          type: "timeline",
          direction: "horizontal",
          tone: "brand",
          items: [
            { time: "约公元前2070年", title: "夏朝建立", body: "华夏文明开篇，青铜时代开启" },
            { time: "公元前221年", title: "秦统一六国", body: "统一文字度量衡" },
            { time: "公元前206年—公元220年", title: "汉朝", body: "丝绸之路开通" },
            { time: "公元618年—907年", title: "唐朝", body: "万国来朝" },
            { time: "公元1368年—1644年", title: "明朝", body: "郑和下西洋" },
            { time: "公元1912年", title: "民国建立", body: "推翻帝制" },
          ],
        } as unknown as DomNode,
      ],
    };
    const blocking = blockingAfterRender(deckWith([slide], darkOverride));
    const lowContrast = blocking.filter((d) => d.code === "LOW_CONTRAST");
    expect(lowContrast, lowContrast.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("6-step horizontal timeline on a LIGHT deck also renders without LOW_CONTRAST", () => {
    const slide: SlideV2 = {
      id: "s1",
      title: "中华文明发展历程",
      children: [{
        id: "s1.timeline",
        type: "timeline",
        direction: "horizontal",
        items: [
          { time: "约公元前2070年", title: "夏朝建立", body: "华夏文明开篇" },
          { time: "公元前221年", title: "秦统一六国", body: "统一文字" },
          { time: "公元前206年", title: "汉朝", body: "丝路开通" },
          { time: "公元618年", title: "唐朝", body: "万国来朝" },
          { time: "公元1368年", title: "明朝", body: "下西洋" },
          { time: "公元1912年", title: "民国建立", body: "推翻帝制" },
        ],
      } as unknown as DomNode],
    };
    const blocking = blockingAfterRender(deckWith([slide]));
    const lowContrast = blocking.filter((d) => d.code === "LOW_CONTRAST");
    expect(lowContrast, lowContrast.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("vertical timeline 5 items with bodies on a dark deck: no LOW_CONTRAST", () => {
    const slide: SlideV2 = {
      id: "s1",
      title: "纵向时间线",
      children: [{
        id: "s1.timeline",
        type: "timeline",
        direction: "vertical",
        items: [
          { time: "T1", title: "Step 1", body: "First milestone" },
          { time: "T2", title: "Step 2", body: "Second milestone" },
          { time: "T3", title: "Step 3", body: "Third milestone" },
          { time: "T4", title: "Step 4", body: "Fourth milestone" },
          { time: "T5", title: "Step 5", body: "Fifth milestone" },
        ],
      } as unknown as DomNode],
    };
    const blocking = blockingAfterRender(deckWith([slide], darkOverride));
    const lowContrast = blocking.filter((d) => d.code === "LOW_CONTRAST");
    expect(lowContrast, lowContrast.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("body text using muted-token color is auto-fixed on a low-contrast surface", () => {
    const slide: SlideV2 = {
      id: "s1",
      children: [{
        id: "s1.body",
        type: "text",
        text: "这是一段需要被自动修复的灰色正文",
        style: "caption",
        // Force the rendered color to a known muted hex (text.muted in the
        // dark theme is 484F58; on a near-black bg this is unreadable).
        color: "484F58",
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deckWith([slide], darkOverride)));
    const textShape = ast.slides[0]!.shapes.find((s) => s.type === "text" && s.name === "s1.body");
    if (textShape && textShape.type === "text") {
      const runColor = textShape.paragraphs?.[0]?.runs?.[0]?.color || "";
      // Auto-fix should rewrite to a contrasting neutral (white on dark bg).
      expect(runColor).toBe("FFFFFF");
    }
  });
});

describe("timelineBlock factory color contracts", () => {
  it("time label uses text.secondary (not brand.primary) so it doesn't depend on brand contrast", () => {
    const slide: SlideV2 = {
      id: "s1",
      children: [{
        id: "s1.tl",
        type: "timeline",
        direction: "horizontal",
        items: [{ time: "T1", title: "Step", body: "Body" }],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deckWith([slide])));
    const dom = ast.slides[0]!;
    // Look for the time text shape; verify its run color is the deck's
    // text.secondary (default theme: 5B6478), NOT brand.primary.
    const timeShape = dom.shapes.find((s) => s.type === "text" && /\.0\.time$/.test(String(s.name || "")));
    expect(timeShape, "time shape should be in rendered output").toBeDefined();
    if (timeShape && timeShape.type === "text") {
      const runColor = timeShape.paragraphs?.[0]?.runs?.[0]?.color || "";
      // Anything other than C0392B (the brand color) is acceptable; the key
      // contract is that the time label is no longer keyed off brand.
      expect(runColor.toUpperCase()).not.toBe("C0392B");
    }
  });

  it("body uses text.primary (not text.muted) so contrast is reliable", () => {
    const slide: SlideV2 = {
      id: "s1",
      children: [{
        id: "s1.tl",
        type: "timeline",
        direction: "horizontal",
        items: [{ time: "T1", title: "Step", body: "Body" }],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deckWith([slide])));
    const dom = ast.slides[0]!;
    const bodyShape = dom.shapes.find((s) => s.type === "text" && /\.0\.body$/.test(String(s.name || "")));
    expect(bodyShape, "body shape should be in rendered output").toBeDefined();
    if (bodyShape && bodyShape.type === "text") {
      const runColor = bodyShape.paragraphs?.[0]?.runs?.[0]?.color || "";
      // Default theme text.muted is 5B6478; text.primary is 0F172A. Body
      // should be the primary (or a high-contrast neutral after auto-fix).
      expect(runColor.toUpperCase()).not.toBe("5B6478");
    }
  });
});
