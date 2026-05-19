import { describe, expect, it } from "vitest";
import {
  applyAgentSurface,
  checklist,
  keyTakeaway,
  legend,
  numberedGrid,
  quoteBlock,
  sectionBreak,
} from "./components.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

function deck(slides: SlideV2[]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
    slides,
  };
}

const EMU_PER_CM = 360000;

type AnyShape = { type: string; name?: string; preset?: string; xfrm?: { x: number; y: number; cx: number; cy: number }; fill?: { type: string; color?: string }; line?: { color: string; width: number; dash?: string }; cornerRadius?: number; shadow?: { blur?: number }; paragraphs?: Array<{ runs: Array<{ text: string; color?: string; bold?: boolean }> }> };

function findShape(shapes: AnyShape[], idSuffix: string): AnyShape | undefined {
  return shapes.find((s) => typeof s.name === "string" && s.name.endsWith(idSuffix));
}

describe("PR4: applyAgentSurface helper merges options into wrapper nodes", () => {
  it("flat shorthand fields land on the node", () => {
    const node: DomNode = { id: "x", type: "stack", children: [] };
    const out = applyAgentSurface(node, { fill: "FFF", borderColor: "111", borderWidth: 0.06, cornerRadius: 0.2, elevation: "raised" });
    expect(out.fill).toBe("FFF");
    expect(out.line).toBe("111");
    expect(out.lineWidth).toBe(0.06);
    expect(out.cornerRadius).toBe(0.2);
    expect(out.elevation).toBe("raised");
  });

  it("surface:{ border:{...} } object shape wins on conflict", () => {
    const node: DomNode = { id: "x", type: "stack", children: [] };
    const out = applyAgentSurface(node, {
      borderColor: "AAA",
      borderWidth: 0.02,
      surface: { border: { color: "BBB", width: 0.08, style: "dash", cornerRadius: 0.3 }, elevation: "floating", padding: 0.6 },
    });
    expect(out.line).toBe("BBB");
    expect(out.lineWidth).toBe(0.08);
    expect(out.dash).toBe("dash");
    expect(out.cornerRadius).toBe(0.3);
    expect(out.elevation).toBe("floating");
    expect(out.padding).toBe(0.6);
  });

  it("lineDash/borderStyle:'solid' clears an inherited dashed stroke", () => {
    const node: DomNode = { id: "x", type: "stack", dash: "dot", children: [] };
    const lineSolid = applyAgentSurface(node, { lineDash: "solid" });
    expect(lineSolid.lineDash).toBe("solid");
    expect(lineSolid.dash).toBeUndefined();

    const borderSolid = applyAgentSurface(node, { surface: { border: { style: "solid" } } });
    expect(borderSolid.borderStyle).toBe("solid");
    expect(borderSolid.dash).toBeUndefined();
  });

  it("accent:'none' is preserved so agents can disable default accent bars", () => {
    const node: DomNode = { id: "x", type: "card", accent: "left", children: [] };
    const out = applyAgentSurface(node, { accent: "none" });
    expect(out.accent).toBe("none");
  });

  it("does not modify defaults the agent didn't set", () => {
    const node: DomNode = { id: "x", type: "stack", fill: "default-fill", children: [] };
    const out = applyAgentSurface(node, {});
    expect(out.fill).toBe("default-fill");
    expect(out.line).toBeUndefined();
  });
});

describe("PR4: keyTakeaway visual upgrade", () => {
  it("default elevation is raised (shadow present after wrap)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [keyTakeaway("s", "kt", { headline: "重大发现", detail: "说明" })],
    };
    // keyTakeaway is itself a stack with fill/line/elevation; the renderer
    // wraps it through containerBackgroundShape. Just assert the node's
    // elevation field made it into the source DOM.
    const node = slide.children![0] as DomNode;
    expect(node.elevation).toBe("raised");
  });

  it("accent bar is 0.18cm tall and 3.2cm long", () => {
    const node = keyTakeaway("s", "kt", { headline: "x" }) as DomNode;
    const accent = (node.children || []).find((c) => c.id === "s.kt.accent")!;
    expect(accent.fixedHeight).toBe(0.18);
    expect(accent.fixedWidth).toBe(3.2);
  });

  it("agent-supplied borderColor flows through applyAgentSurface", () => {
    const node = keyTakeaway("s", "kt", { headline: "x", borderColor: "DC2626", borderWidth: 0.05 }) as DomNode;
    expect(node.line).toBe("DC2626");
    expect(node.lineWidth).toBe(0.05);
  });

  it("agent-supplied surface:{elevation:\"floating\"} overrides default raised", () => {
    const node = keyTakeaway("s", "kt", { headline: "x", surface: { elevation: "floating" } }) as DomNode;
    expect(node.elevation).toBe("floating");
  });
});

describe("PR4: quoteBlock decorative ornament", () => {
  it("adds a ❝ ornament node by default", () => {
    const node = quoteBlock("s", "q", "重要的话") as DomNode;
    const ornament = (node.children || []).find((c) => c.id === "s.q.ornament");
    expect(ornament).toBeDefined();
    expect(ornament!.text).toBe("\u201C");
  });

  it("ornament:false suppresses the decorative quote", () => {
    const node = quoteBlock("s", "q", "x", undefined, { ornament: false }) as DomNode;
    const ornament = (node.children || []).find((c) => c.id === "s.q.ornament");
    expect(ornament).toBeUndefined();
  });
});

describe("PR4: legend bigger markers + readable labels", () => {
  it("default dot is 0.55cm (was 0.40cm)", () => {
    const node = legend("s", "l", { items: [{ label: "A", color: "red" }, { label: "B", color: "blue" }] }) as DomNode;
    const firstItem = (node.children || [])[0]!;
    const dot = (firstItem.children || []).find((c) => c.id === "s.l.0.dot")!;
    expect(dot.fixedWidth).toBe(0.55);
    expect(dot.fixedHeight).toBe(0.55);
  });

  it("marker:\"square\" emits a rect with subtle radius", () => {
    const node = legend("s", "l", { items: [{ label: "A", color: "red" }], marker: "square" }) as DomNode;
    const dot = ((node.children || [])[0]!.children || []).find((c) => c.id === "s.l.0.dot")!;
    expect(dot.preset).toBe("rect");
    expect(dot.cornerRadius).toBe(0.15);
  });

  it("marker:\"bar\" emits a long rounded rect", () => {
    const node = legend("s", "l", { items: [{ label: "A", color: "red" }], marker: "bar" }) as DomNode;
    const dot = ((node.children || [])[0]!.children || []).find((c) => c.id === "s.l.0.dot")!;
    expect(dot.preset).toBe("rect");
    expect(dot.fixedWidth).toBe(0.85);
    expect(dot.fixedHeight).toBe(0.22);
  });

  it("label color is text.primary (was text.muted)", () => {
    const node = legend("s", "l", { items: [{ label: "A", color: "red" }] }) as DomNode;
    const label = ((node.children || [])[0]!.children || []).find((c) => c.id === "s.l.0.label")!;
    expect(label.color).toBe("text.primary");
  });
});

describe("PR4: numberedGrid number chip", () => {
  it("default chip style: number renders as a circular brand-fill chip with inverse text", () => {
    const node = numberedGrid("s", "ng", {
      items: [{ title: "第一项" }, { title: "第二项" }],
    }) as DomNode;
    const firstItem = (node.children || [])[0]!;
    // Chip is wrapped in a left-anchored .num.wrap container so positioning
    // doesn't conflict with the chip's own text-align (96vi8n slide 23 fix).
    const wrap = (firstItem.children || []).find((c) => c.id === "s.ng.0.num.wrap")!;
    const num = (wrap.children || []).find((c) => c.id === "s.ng.0.num")!;
    expect(num.fill).toBe("brand.primary");
    expect(num.color).toBe("text.inverse");
    expect(num.cornerRadius).toBe(0.5);
    expect(num.fixedWidth).toBeGreaterThan(0);
  });

  it("numberStyle:\"plain\" reverts to the colored numeral", () => {
    const node = numberedGrid("s", "ng", {
      items: [{ title: "x" }],
      numberStyle: "plain",
    }) as DomNode;
    const num = ((node.children || [])[0]!.children || []).find((c) => c.id === "s.ng.0.num")!;
    expect(num.style).toBe("metric-value");
    expect(num.fill).toBeUndefined();
  });

  it("agent surface customization flows through to outer grid", () => {
    const node = numberedGrid("s", "ng", {
      items: [{ title: "x" }],
      borderColor: "111",
      cornerRadius: 0.3,
    }) as DomNode;
    expect(node.line).toBe("111");
    expect(node.cornerRadius).toBe(0.3);
  });
});

describe("PR4: sectionBreak accent rule", () => {
  it("emits a visible top accent rule shape", () => {
    const node = sectionBreak("s", "sb", { title: "新章节" }) as DomNode;
    const rule = (node.children || []).find((c) => c.id === "s.sb.rule")!;
    expect(rule).toBeDefined();
    expect(rule.preset).toBe("rect");
    expect(rule.fixedHeight).toBe(0.08);
    expect(rule.fixedWidth).toBe(4.0);
    expect(rule.fill).toBe("brand.primary");
  });

  it("accent eyebrow uses tracking:\"wide\"", () => {
    const node = sectionBreak("s", "sb", { title: "x", accent: "EYEBROW" }) as DomNode;
    const eyebrow = (node.children || []).find((c) => c.id === "s.sb.accent")!;
    expect(eyebrow.tracking).toBe("wide");
  });
});

describe("PR4: checklist chip markers", () => {
  it("default markStyle:\"chip\" renders the mark as a rounded chip", () => {
    const node = checklist("s", "ck", [
      { text: "完成", status: "checked" },
      { text: "未完成", status: "unchecked" },
    ]) as DomNode;
    const item0 = (node.children || [])[0]!;
    const mark = (item0.children || []).find((c) => c.id === "s.ck.0.mark")!;
    expect(mark.fill).toBe("success");
    expect(mark.cornerRadius).toBe(0.18);
    expect(mark.color).toBe("text.inverse");
    expect(mark.weight).toBe("bold");
  });

  it("markStyle:\"plain\" reverts to colored glyph (no fill)", () => {
    const node = checklist("s", "ck", [{ text: "x", status: "checked" }], "comfortable", { markStyle: "plain" }) as DomNode;
    const mark = ((node.children || [])[0]!.children || []).find((c) => c.id === "s.ck.0.mark")!;
    expect(mark.fill).toBeUndefined();
    expect(mark.color).toBe("success");
  });

  it("omitted status renders a neutral marker instead of a completed checkmark", () => {
    const node = checklist("s", "ck", [{ text: "待确认" }]) as DomNode;
    const mark = ((node.children || [])[0]!.children || []).find((c) => c.id === "s.ck.0.mark")!;
    expect(mark.text).toBe("•");
    expect(mark.fill).toBe("surface.subtle");
    expect(mark.color).toBe("text.muted");
  });
});

describe("PR4: end-to-end render of upgraded components", () => {
  it("a slide built with several upgraded components renders without diagnostics", () => {
    const slide: SlideV2 = {
      id: "demo",
      title: "升级展示",
      children: [
        keyTakeaway("demo", "kt", { headline: "营收增长 25%", detail: "源于新业务线扩张" }) as DomNode,
        legend("demo", "lg", { items: [{ label: "A", color: "red" }, { label: "B", color: "blue" }, { label: "C", color: "green" }] }) as DomNode,
        sectionBreak("demo", "sb", { title: "下一节" }) as DomNode,
      ],
    };
    expect(() => renderToAst(sourceToRenderedDeck(deck([slide])))).not.toThrow();
  });

  it("legend rendered to AST has 3 markers at expected size", () => {
    const slide: SlideV2 = {
      id: "demo",
      title: "x",
      children: [legend("demo", "lg", { items: [{ label: "A", color: "FF0000" }, { label: "B", color: "00FF00" }, { label: "C", color: "0000FF" }] }) as DomNode],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    const shapes = ast.slides[0].shapes as AnyShape[];
    const ellipses = shapes.filter((s) => s.type === "shape" && s.preset === "ellipse");
    expect(ellipses.length).toBe(3);
    for (const e of ellipses) {
      // 0.55cm in EMU = 198000
      expect(e.xfrm!.cx).toBe(Math.round(0.55 * EMU_PER_CM));
    }
    void findShape;
  });
});
