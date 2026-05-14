import { describe, expect, it } from "vitest";
import type { Shape } from "./emitter/types.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Regression for the yajush debug log (2026-05-03 08:36):
 *
 *   "要求在页脚加修饰图片，但是实际上图片被加到页面中间"
 *
 * The agent placed a decorative image at slide level with
 * `anchor:"bottom-right"` expecting a small footer-corner
 * stamp. ensureContentArea wrapped EVERY child into the content-area stack,
 * so the image flowed inside the content rect and got stretched to fill it
 * (~21.8cm × 6-8cm), instead of `rectForSlideChild` placing it at the
 * bottom-right corner.
 *
 * Fix: source-deck.ts splits overlay-style children (anchor or
 * anchored image) out of the content stack. They stay at slide level so
 * `rectForSlideChild` gives them anchored rects.
 */

const EMU_PER_CM = 360000;
const SLIDE_W_CM = 25.4;
const SLIDE_H_CM = 14.288;

function deck(slides: SlideV2[]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { name: "Yajush", primary: "8B0000" } },
    slides,
  };
}

function findImage(shapes: Shape[], src: string) {
  return shapes.find((s) => s.type === "image" && (s.src === src || (typeof s.name === "string" && s.name.includes(src))));
}

function findText(shapes: Shape[], text: string) {
  return shapes.find((s) =>
    s.type === "text" && s.paragraphs?.some((p) => p.runs.some((r) => r.text === text)),
  );
}

describe("yajush: footer/corner image placement (slide-level overlays)", () => {
  it("image with anchor:bottom-right at slide level renders at bottom-right corner, not stretched", () => {
    const slide: SlideV2 = {
      id: "history",
      title: "历史",
      children: [
        { id: "history.body", type: "text", text: "正文段落。" },
        // Footer decoration the agent intends as a small bottom-right stamp.
        {
          id: "history.seal",
          type: "image",
          src: "/tmp/seal.png",
          anchor: "bottom-right",
          width: 2.4,
          height: 1.0,
        },
      ],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const sealShape = ast.slides[0].shapes.find((s) => s.type === "image" && (s as { src?: string }).src === "/tmp/seal.png") as
      | { type: "image"; xfrm: { x: number; y: number; cx: number; cy: number } }
      | undefined;
    expect(sealShape, "seal image must be rendered").toBeDefined();
    if (!sealShape) return;

    const xCm = sealShape.xfrm.x / EMU_PER_CM;
    const yCm = sealShape.xfrm.y / EMU_PER_CM;
    const wCm = sealShape.xfrm.cx / EMU_PER_CM;
    const hCm = sealShape.xfrm.cy / EMU_PER_CM;

    // Width / height honor the agent-specified 2.4×1.0cm — NOT stretched
    // to ~21.8cm (the content-rect width that the bug produced).
    expect(wCm).toBeCloseTo(2.4, 1);
    expect(hCm).toBeCloseTo(1.0, 1);

    // Located in the bottom-right corner of the slide (within ~1cm margin).
    expect(SLIDE_W_CM - (xCm + wCm)).toBeLessThan(1.2);
    expect(SLIDE_H_CM - (yCm + hCm)).toBeLessThan(1.2);
  });

  it("image with anchor:bottom-right at slide level uses anchored rect", () => {
    const slide: SlideV2 = {
      id: "anchored",
      title: "锚定",
      children: [
        { id: "anchored.body", type: "text", text: "正文。" },
        {
          id: "anchored.stamp",
          type: "image",
          src: "/tmp/stamp.png",
          anchor: "bottom-right",
          width: 1.8,
          height: 1.8,
          offsetX: 0.5,
          offsetY: 0.5,
        },
      ],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const shape = ast.slides[0].shapes.find((s) => s.type === "image" && (s as { src?: string }).src === "/tmp/stamp.png") as
      | { type: "image"; xfrm: { x: number; y: number; cx: number; cy: number } }
      | undefined;
    expect(shape).toBeDefined();
    if (!shape) return;

    const wCm = shape.xfrm.cx / EMU_PER_CM;
    const hCm = shape.xfrm.cy / EMU_PER_CM;
    expect(wCm).toBeCloseTo(1.8, 1);
    expect(hCm).toBeCloseTo(1.8, 1);
    // Bottom-right with a 0.5cm offset.
    const xCm = shape.xfrm.x / EMU_PER_CM;
    const yCm = shape.xfrm.y / EMU_PER_CM;
    expect(SLIDE_W_CM - (xCm + wCm)).toBeCloseTo(0.5, 1);
    expect(SLIDE_H_CM - (yCm + hCm)).toBeCloseTo(0.5, 1);
  });

  it("brand-mark renders a footer label at bottom-right without hand-coded at coordinates", () => {
    const slide: SlideV2 = {
      id: "brand",
      title: "品牌角标",
      children: [
        { id: "brand.body", type: "text", text: "正文。" },
        {
          id: "brand.youdao",
          type: "brand-mark",
          text: "有道 Youdao",
          corner: "bottom-right",
        },
      ],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const mark = findText(ast.slides[0].shapes, "有道 Youdao");
    expect(mark).toBeDefined();
    if (!mark?.xfrm) return;

    const xCm = mark.xfrm.x / EMU_PER_CM;
    const yCm = mark.xfrm.y / EMU_PER_CM;
    const wCm = mark.xfrm.cx / EMU_PER_CM;
    const hCm = mark.xfrm.cy / EMU_PER_CM;
    expect(SLIDE_W_CM - (xCm + wCm)).toBeCloseTo(0.75, 1);
    expect(SLIDE_H_CM - (yCm + hCm)).toBeCloseTo(0.55, 1);
    expect(xCm).toBeGreaterThan(20);
  });

  it("anchor:bottom-right places plain text overlays", () => {
    const slide: SlideV2 = {
      id: "positioned",
      title: "定位别名",
      children: [
        { id: "positioned.body", type: "text", text: "正文。" },
        {
          id: "positioned.mark",
          type: "text",
          text: "Source",
          style: "label",
          anchor: "bottom-right",
          width: 2.6,
          height: 0.45,
          offsetX: 0.6,
          offsetY: 0.5,
        },
      ],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const mark = findText(ast.slides[0].shapes, "Source");
    expect(mark).toBeDefined();
    if (!mark?.xfrm) return;

    const xCm = mark.xfrm.x / EMU_PER_CM;
    const yCm = mark.xfrm.y / EMU_PER_CM;
    const wCm = mark.xfrm.cx / EMU_PER_CM;
    const hCm = mark.xfrm.cy / EMU_PER_CM;
    expect(SLIDE_W_CM - (xCm + wCm)).toBeCloseTo(0.6, 1);
    expect(SLIDE_H_CM - (yCm + hCm)).toBeCloseTo(0.5, 1);
  });

  it("flow children (text/etc.) still wrap into the content stack alongside an overlay image", () => {
    const slide: SlideV2 = {
      id: "mixed",
      title: "混合",
      children: [
        { id: "mixed.h", type: "h2", text: "小节标题" },
        { id: "mixed.body", type: "text", text: "段落正文。" },
        { id: "mixed.seal", type: "image", src: "/tmp/seal.png", anchor: "bottom-right", width: 2.0, height: 1.0 },
      ],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const shapes = ast.slides[0].shapes;

    const seal = shapes.find((s) => s.type === "image" && (s as { src?: string }).src === "/tmp/seal.png") as
      | { type: "image"; xfrm: { x: number; cx: number } }
      | undefined;
    expect(seal).toBeDefined();
    if (!seal) return;
    // Seal stays small (2cm), not stretched across the slide.
    expect(seal.xfrm.cx / EMU_PER_CM).toBeCloseTo(2.0, 1);

    // The body text is laid out inside the content area (left edge near
    // pageMarginX≈1.5cm), proving overlay split didn't break flow.
    const bodyText = shapes.find((s) => s.type === "text" && Array.isArray((s as { paragraphs?: unknown[] }).paragraphs)) as
      | { type: "text"; xfrm: { x: number } }
      | undefined;
    expect(bodyText).toBeDefined();
    if (!bodyText) return;
    expect(bodyText.xfrm.x / EMU_PER_CM).toBeLessThan(3);
  });

  it("when slide already declares an explicit area:content stack, overlay split does not run", () => {
    // If the agent has already structured the slide with their own content
    // stack, ensureContentArea returns children verbatim. An image inside
    // such a stack is *intentionally* part of the flow and should NOT be
    // promoted to overlay.
    const slide: SlideV2 = {
      id: "explicit",
      title: "显式",
      children: [
        {
          id: "explicit.stack",
          type: "stack",
          area: "content",
          direction: "vertical",
          children: [
            { id: "explicit.text", type: "text", text: "段落。" },
            { id: "explicit.inline-img", type: "image", src: "/tmp/inline.png", anchor: "bottom-right" },
          ],
        },
      ],
    };
    // Should not throw and should produce a slide.
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    expect(ast.slides.length).toBe(1);
  });
});
