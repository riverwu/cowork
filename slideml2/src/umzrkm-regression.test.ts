import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
} from "./diagnostics.js";
import { processFlow, sectionBreak, stepCard, comparisonCard, profileCard, badge } from "./components.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Regression for the umzrkm debug log (2026-05-03 10:30). Agent rebranded
 * the deck to a mid-saturation teal (5B8A8A) on a light background
 * (E8F3F3); 10 text nodes ended up at 3.4:1 contrast across multiple
 * components because their default color was brand.primary. Same root
 * cause across:
 *   - process-flow step.title
 *   - axis-ruler label
 *   - stepCard.step
 *   - comparisonCard.title
 *   - profileCard.role
 *   - sectionBreak.accent
 * Also covered: band-as-divider when agent passes `height:0.05` (alias),
 * badge fixedWidth honors CJK character width.
 */

const TEAL = "5B8A8A";
const BG = "E8F3F3";

function deck(slides: SlideV2[]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: "default",
      brand: { name: "umzrkm", primary: TEAL },
      themeOverride: { colors: { background: BG, surface: "FFFFFF" } },
    },
    slides,
  };
}

function findRunByText(shapes: Array<{ type: string }>, needle: string) {
  for (const sh of shapes) {
    if (sh.type !== "text") continue;
    const t = sh as { paragraphs?: Array<{ runs: Array<{ text: string; color?: string; bold?: boolean }> }> };
    for (const p of t.paragraphs || []) {
      for (const r of p.runs || []) {
        if (r.text === needle || r.text.includes(needle)) return r;
      }
    }
  }
  return undefined;
}

describe("umzrkm: composite component title defaults are now contrast-safe", () => {
  it("process-flow step.title uses text.primary (not brand.primary)", () => {
    const node = processFlow("s", "pf", {
      steps: [
        { title: "八王之乱", body: "西晋皇室内战削弱国力" },
        { title: "永嘉之乱", body: "311年匈奴攻破洛阳" },
      ],
    }) as DomNode;
    // First child of stack is the first step (which contains title text)
    const firstStep = (node.children || [])[0]!;
    const titleNode = (firstStep.children || []).find((c) => c.id?.endsWith(".title"))!;
    expect(titleNode.color).toBe("text.primary");
  });

  it("rendering a process-flow on the umzrkm theme produces ZERO LOW_CONTRAST blocks on step titles", () => {
    const slide: SlideV2 = {
      id: "wei-jin",
      title: "魏晋南北朝",
      children: [
        processFlow("wei-jin", "flow", {
          steps: [
            { title: "八王之乱", body: "西晋皇室内战削弱国力" },
            { title: "永嘉之乱", body: "311年匈奴攻破洛阳" },
            { title: "衣冠南渡", body: "北方士族大规模南迁建康" },
            { title: "侨州郡县", body: "朝廷设立北方移民安置制度" },
          ],
        }) as DomNode,
      ],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide])));
    const lc = getRenderDiagnostics().filter((d) => d.code === "LOW_CONTRAST");
    const onTitles = lc.filter((d) =>
      typeof d.message === "string"
      && /八王之乱|永嘉之乱|衣冠南渡|侨州郡县/.test(d.message)
    );
    expect(onTitles).toEqual([]);
  });

  it("axis-ruler label uses text.primary so 6 era labels survive contrast on light bg", () => {
    const slide: SlideV2 = {
      id: "overview",
      title: "宏观脉络",
      children: [{
        id: "overview.tl",
        type: "axis-ruler",
        direction: "horizontal",
        items: [
          { label: "先秦", body: "黄河流域为文明核心" },
          { label: "秦汉", body: "统一南北" },
          { label: "魏晋南北朝", body: "南迁第一次高峰" },
          { label: "隋唐", body: "南北文化大融合" },
          { label: "两宋", body: "经济重心南移完成" },
          { label: "明清", body: "人口与文化全面渗透" },
        ],
      } as unknown as DomNode],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide])));
    const lc = getRenderDiagnostics().filter((d) => d.code === "LOW_CONTRAST");
    const onLabels = lc.filter((d) =>
      typeof d.message === "string"
      && /先秦|秦汉|魏晋南北朝|隋唐|两宋|明清/.test(d.message)
    );
    expect(onLabels).toEqual([]);
  });

  it("stepCard.step now defaults to text.primary", () => {
    const node = stepCard("s", "sc", "01", "标题", "正文") as DomNode;
    const stepLabel = (node.children || []).find((c) => c.id?.endsWith(".step"))!;
    expect(stepLabel.color).toBe("text.primary");
  });

  it("comparisonCard.title now defaults to text.primary", () => {
    const node = comparisonCard("s", "cc", "比较标题", ["a", "b"]) as DomNode;
    const titleNode = (node.children || []).find((c) => c.id?.endsWith(".title"))!;
    expect(titleNode.color).toBe("text.primary");
  });

  it("profileCard.role uses text.muted (away from brand.primary)", () => {
    const node = profileCard("s", "pc", { image: "/x.png", name: "测试", role: "工程师" }) as DomNode;
    const roleNode = (node.children || []).find((c) => c.id?.endsWith(".role"))!;
    expect(roleNode.color).toBe("text.muted");
  });

  it("sectionBreak.accent uses text.primary by default", () => {
    const node = sectionBreak("s", "sb", { title: "新章节", accent: "EYEBROW" }) as DomNode;
    const accent = (node.children || []).find((c) => c.id?.endsWith(".accent"))!;
    expect(accent.color).toBe("text.primary");
  });
});

describe("umzrkm: theme tokens count as theme-resolved (auto-fix tier extension)", () => {
  it("a readable custom-branded text.color=brand.primary warning is not auto-fixed", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.label",
        type: "text",
        // Small label text using brand.primary is below WCAG but still above
        // the perceptual unreadable floor. It should warn without changing
        // the agent's branded color.
        text: "需要可读的文字",
        style: "label",
        color: "brand.primary",
      }],
    };
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck([slide])));
    const lc = getRenderDiagnostics().filter((d) => d.code === "LOW_CONTRAST");
    const fixed = getRenderDiagnostics().filter((d) => d.code === "LOW_CONTRAST_FIXED");
    expect(lc.every((d) => d.severity === "warn")).toBe(true);
    expect(lc.length).toBeGreaterThan(0);
    expect(fixed).toHaveLength(0);
  });
});

describe("umzrkm: height/width alias normalize to fixedHeight/fixedWidth", () => {
  it("a band node with `height:0.05` renders as a thin divider (no padding stretching it)", () => {
    const slide: SlideV2 = {
      id: "cover",
      children: [{
        id: "cover.line",
        type: "band",
        tone: "brand",
        height: 0.05,
        children: [],
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const shapes = ast.slides[0].shapes as Array<{ type: string; name?: string; xfrm?: { cy: number } }>;
    const band = shapes.find((s) => typeof s.name === "string" && s.name.endsWith("-band"));
    expect(band).toBeDefined();
    // 0.05cm band → cy in EMU = 0.05 * 360000 = 18000
    expect(band!.xfrm!.cy).toBe(Math.round(0.05 * 360000));
  });

  it("a shape with `width:2.0` aliases to fixedWidth", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.bar",
        type: "shape",
        preset: "rect",
        fill: "brand.primary",
        width: 2.0,
        height: 0.4,
      } as unknown as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const shapes = ast.slides[0].shapes as Array<{ type: string; preset?: string; xfrm?: { cx: number; cy: number } }>;
    const rect = shapes.find((s) => s.type === "shape" && s.preset === "rect" && s.xfrm?.cy === Math.round(0.4 * 360000));
    expect(rect?.xfrm?.cx).toBe(Math.round(2.0 * 360000));
  });
});

describe("umzrkm: badge fixedWidth honors CJK character width", () => {
  it("a 4-char CJK badge gets ≥3cm wide (was capped at 1.62cm)", () => {
    const node = badge("s", "b", { text: "南宋时代" }) as DomNode;
    expect(typeof node.fixedWidth).toBe("number");
    expect((node.fixedWidth as number)).toBeGreaterThanOrEqual(2.9);
  });

  it("a short Chinese badge \"粮食\" gets ~2cm (CJK 0.55cm/char + 0.9 padding)", () => {
    const node = badge("s", "b", { text: "粮食" }) as DomNode;
    // 2 * 0.55 + 0.9 = 2.0cm (clamped to min 1.6)
    expect((node.fixedWidth as number)).toBeGreaterThanOrEqual(1.6);
    expect((node.fixedWidth as number)).toBeLessThan(2.5);
  });

  it("a long latin badge stays under the 6cm cap", () => {
    const node = badge("s", "b", { text: "VERY LONG LATIN BADGE TEXT" }) as DomNode;
    expect((node.fixedWidth as number)).toBeLessThanOrEqual(6);
  });
});
