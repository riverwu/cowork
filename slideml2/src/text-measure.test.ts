import { describe, expect, it } from "vitest";
import { createHeuristicTextMeasurer, createMetricPackTextMeasurer, PT_TO_CM } from "./text-measure.js";
import { buildTheme } from "./theme.js";

describe("heuristic text measurement", () => {
  const theme = buildTheme({ primary: "2563EB" });
  const measurer = createHeuristicTextMeasurer(theme);

  it("uses the shared point-to-centimeter constant for line height", () => {
    expect(measurer.lineHeight(10, 1.2)).toBeCloseTo(10 * PT_TO_CM * 1.2, 8);
  });

  it("wrapLines is consistent with textWidth and unbreakableWidth", () => {
    const text = "Revenue acceleration / platform expansion";
    const fontPt = 12;
    const maxWidthCm = 3.2;
    const metrics = measurer.wrapLines(text, fontPt, "bold", maxWidthCm);
    const expectedWidth = measurer.textWidth(text, fontPt, "bold");
    const expectedUnbreakable = measurer.unbreakableWidth(text, fontPt, "bold");

    expect(metrics.widthCm).toBeCloseTo(expectedWidth, 8);
    expect(metrics.unbreakableCm).toBeCloseTo(expectedUnbreakable, 8);
    expect(metrics.lines).toBeGreaterThanOrEqual(Math.ceil(expectedWidth / maxWidthCm));
    expect(metrics.lines).toBeGreaterThanOrEqual(Math.ceil(expectedUnbreakable / maxWidthCm));
  });

  it("treats CJK glyphs as breakable while preserving their visual width", () => {
    const text = "香格里拉雪山草甸";
    const width = measurer.textWidth(text, 14);
    const unbreakable = measurer.unbreakableWidth(text, 14);
    const wrapped = measurer.wrapLines(text, 14, undefined, 1.4);

    expect(width).toBeGreaterThan(14 * PT_TO_CM * 4);
    expect(unbreakable).toBeCloseTo(measurer.textWidth("香", 14), 6);
    expect(wrapped.lines).toBeGreaterThan(1);
  });

  it("breaks long Latin technical tokens at useful punctuation", () => {
    const text = "https://example.com/research/data-set/version-2026";
    const width = measurer.textWidth(text, 10);
    const unbreakable = measurer.unbreakableWidth(text, 10);
    const wrapped = measurer.wrapLines(text, 10, undefined, 2.4);

    expect(unbreakable).toBeLessThan(width * 0.45);
    expect(wrapped.lines).toBeLessThan(Math.ceil(width / 2.4) + 2);
  });

  it("keeps CJK closing punctuation with the preceding segment", () => {
    const text = "「香格里拉」雪山草甸";
    const unbreakable = measurer.unbreakableWidth(text, 14);
    expect(unbreakable).toBeGreaterThan(measurer.textWidth("香", 14));
    expect(unbreakable).toBeLessThan(measurer.textWidth("香格里拉", 14));
  });

  it("keeps CJK opening punctuation with the following segment", () => {
    const text = "雪山（草甸）湖泊";
    const unbreakable = measurer.unbreakableWidth(text, 14);
    expect(unbreakable).toBeGreaterThan(measurer.textWidth("雪", 14));
    expect(unbreakable).toBeLessThan(measurer.textWidth("雪山（草甸）", 14));
  });

  it("keeps unpunctuated Latin identifiers as overflow-causing unbreakable tokens", () => {
    const text = "supercalifragilisticexpialidocious";
    const width = measurer.textWidth(text, 10);
    const wrapped = measurer.wrapLines(text, 10, undefined, 1.2);

    expect(measurer.unbreakableWidth(text, 10)).toBeCloseTo(width, 8);
    expect(wrapped.lines).toBe(1);
    expect(wrapped.unbreakableCm).toBeGreaterThan(1.2);
  });
});

describe("metric-pack text measurement", () => {
  const theme = buildTheme({ primary: "2563EB" });
  const measurer = createMetricPackTextMeasurer(theme);

  it("uses per-glyph advances for proportional fonts", () => {
    const narrow = measurer.textWidth("iiiiiiii", 12);
    const wide = measurer.textWidth("WWWWWWWW", 12);
    expect(wide).toBeGreaterThan(narrow * 2);
  });

  it("applies common kerning pairs when measuring Latin text", () => {
    const kerned = measurer.textWidth("AV", 24);
    const separate = measurer.textWidth("A", 24) + measurer.textWidth("V", 24);
    expect(kerned).toBeLessThan(separate);
  });

  it("resolves CJK aliases to CJK-width metrics", () => {
    const cjkTheme = buildTheme({ primary: "2563EB" }, "default", {
      fonts: { cjk: { text: ["Microsoft YaHei"], display: ["Microsoft YaHei"] } },
    });
    const cjk = createMetricPackTextMeasurer(cjkTheme);
    const width = cjk.textWidth("香格里拉", 14);
    expect(width).toBeCloseTo(4 * 14 * PT_TO_CM, 1);
  });

  it("treats system-ui CJK font aliases as CJK-width, not Arial-width", () => {
    const cjkTheme = buildTheme({ primary: "2563EB" }, "default", {
      fonts: { cjk: { text: ["system-ui"], display: ["system-ui"] } },
    });
    const cjk = createMetricPackTextMeasurer(cjkTheme);
    const width = cjk.textWidth("质量检查阶段", 10, "bold");

    expect(width).toBeGreaterThan(10 * PT_TO_CM * 5);
  });

  it("wraps over-wide mixed CJK/Latin segments instead of treating them as one line", () => {
    const text = "关键约束：质量检查失败（虚线）→ 回到数据完善阶段；GA 判定需 Release Controls readiness ≥ 85 且 P95 延迟 < 500ms 且可靠性 ≥ 99.5%";
    const wrapped = measurer.wrapLines(text, 10, "bold", 12.1);

    expect(wrapped.widthCm).toBeGreaterThan(12.1);
    expect(wrapped.lines).toBeGreaterThanOrEqual(3);
  });

  it("uses font-specific ascent and descent as the natural line-height floor", () => {
    const arial = measurer.ascentDescent(12, "Arial");
    const georgia = measurer.ascentDescent(12, "Georgia");

    expect(arial.ascentCm).toBeGreaterThan(arial.descentCm);
    expect(georgia.ascentCm).toBeGreaterThan(georgia.descentCm);
    expect(Math.abs(arial.ascentCm - georgia.ascentCm)).toBeGreaterThan(0.001);
    expect(measurer.lineHeight(12, 0.85, "Arial")).toBeCloseTo(arial.ascentCm + arial.descentCm, 8);
  });

  it("caps tall CJK font bboxes to a PowerPoint-like line box", () => {
    const metrics = measurer.ascentDescent(12, "Microsoft YaHei");
    const rawNatural = metrics.ascentCm + metrics.descentCm;
    const capped = measurer.lineHeight(12, 0.85, "Microsoft YaHei");

    expect(rawNatural).toBeGreaterThan(12 * PT_TO_CM * 1.25);
    expect(capped).toBeLessThan(rawNatural);
    expect(capped).toBeCloseTo(12 * PT_TO_CM * 1.12, 6);
  });

  it("honors explicit lineHeight above the natural font floor", () => {
    const tall = measurer.lineHeight(12, 1.5, "Microsoft YaHei");
    expect(tall).toBeCloseTo(12 * PT_TO_CM * 1.5, 8);
  });
});
