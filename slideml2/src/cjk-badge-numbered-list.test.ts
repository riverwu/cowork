import { describe, expect, it } from "vitest";
import { comparisonCard, featureCard, numberedList } from "./components.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode } from "./types.js";
import { validateDeck } from "./validate.js";

function child(node: DomNode, idSuffix: string): DomNode | undefined {
  return (node.children || []).find((item) => item.id.endsWith(idSuffix));
}

function find(node: DomNode, idSuffix: string): DomNode | undefined {
  if (node.id.endsWith(idSuffix)) return node;
  for (const item of node.children || []) {
    const found = find(item, idSuffix);
    if (found) return found;
  }
  return undefined;
}

describe("CJK badges and numbered list formatting", () => {
  it("sizes feature-card badges from CJK text instead of latin character count", () => {
    const node = featureCard("s", "f", {
      title: "垂直行业+政策红利",
      badge: "国内最高确定性",
    });
    const badge = child(node, ".badge");

    expect(badge?.fixedWidth).toBeGreaterThanOrEqual(2.9);
    expect(badge?.fixedHeight).toBeGreaterThanOrEqual(0.42);
  });

  it("keeps star-rating feature-card badges on one line", () => {
    const node = featureCard("s", "f", {
      title: "第一档机会",
      badge: "★★★★★",
    });
    const badge = child(node, ".badge");

    expect(badge?.fixedWidth).toBeGreaterThanOrEqual(2.3);
    expect(badge?.noWrap).toBe(true);
  });

  it("does not render prose or star-rating feature metrics as huge metric values", () => {
    const node = featureCard("s", "f", {
      title: "商业化确定性",
      metric: { value: "中国境内 ★★★★★", label: "确定性", tone: "positive" },
    });
    const value = find(node, ".metric.value");

    expect(value?.style).toBe("label");
    expect(value?.text).toBe("中国境内 ★★★★★");
  });

  it("uses the same CJK-aware chip sizing for comparison-card badges", () => {
    const node = comparisonCard("s", "c", "路径", [], {
      badge: "华人创业最高赔率",
    });
    const badge = child(node, ".badge");

    expect(badge?.fixedWidth).toBeGreaterThanOrEqual(3.2);
    expect(badge?.fixedHeight).toBeGreaterThanOrEqual(0.42);
  });

  it("preserves title/body hierarchy as rich runs in numbered-list items", () => {
    const node = numberedList("s", "n", [{
      title: "先国内后出海路径已死",
      body: "必须 Day 1 海外架构。",
    }]);
    const item = node.items?.[0] as { text?: string; runs?: Array<{ text: string; marks?: string[] }> };

    expect(item.text).toContain("先国内后出海路径已死：必须");
    expect(item.runs?.[0]).toMatchObject({ text: "先国内后出海路径已死", marks: ["bold"] });
    expect(item.runs?.[1]?.text).toContain("必须 Day 1");
  });

  it("keeps CJK sentence-ending punctuation attached to the previous glyph", () => {
    const ast = renderToAst(sourceToRenderedDeck({
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "s",
        children: [{ id: "s.t", type: "text", text: "长期赢家。" }],
      }],
    } as never));
    const shape = ast.slides[0]!.shapes.find((item) => item.name === "s.t") as { paragraphs?: Array<{ runs: Array<{ text?: string }> }> } | undefined;

    expect(shape?.paragraphs?.[0]?.runs?.[0]?.text).toBe("长期赢家\u2060。");
  });

  it("warns when three consecutive slides are authored as table-card-only pages", () => {
    const slides = [1, 2, 3].map((index) => ({
      id: `s${index}`,
      children: [
        { id: `s${index}.title`, type: "text", text: `Guide ${index}`, style: "section-title" },
        { id: `s${index}.table`, type: "table-card", headers: ["A"], rows: [["B"]] },
      ],
    }));

    const report = validateDeck({ slideml2: 2, deck: { size: "16x9", theme: "default" }, slides } as never);

    expect(report.ok).toBe(true);
    expect(report.warnings.some((warning) => warning.code === "REPEATED_TABLE_PAGE_ARCHETYPE")).toBe(true);
  });
});
