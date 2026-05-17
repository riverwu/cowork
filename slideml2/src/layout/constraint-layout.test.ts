import { describe, expect, it } from "vitest";
import { solveConstraintLayout, type ConstraintLayoutNode } from "./constraint-layout.js";

describe("solveConstraintLayout", () => {
  it("solves a nested stack with an inner split", () => {
    const tree: ConstraintLayoutNode = {
      id: "root",
      type: "stack",
      gap: 0.4,
      padding: 0.2,
      children: [
        { id: "title", measure: { minH: 0.8, idealH: 0.9, maxH: 1.1 } },
        {
          id: "body",
          type: "split",
          direction: "horizontal",
          gap: 0.5,
          ratio: [0.7, 0.3],
          ratioStrength: "medium",
          children: [
            { id: "chart", measure: { minW: 7.5, minH: 4.0 } },
            { id: "rail", measure: { minW: 2.6, minH: 3.0 } },
          ],
        },
      ],
    };

    const result = solveConstraintLayout(tree, { x: 0, y: 0, w: 14, h: 7 });
    const title = result.rects.get("title")!;
    const body = result.rects.get("body")!;
    const chart = result.rects.get("chart")!;
    const rail = result.rects.get("rail")!;

    expect(result.pressures).toHaveLength(0);
    expect(title.y).toBeCloseTo(0.2);
    expect(body.y).toBeCloseTo(title.y + title.h + 0.4);
    expect(body.h).toBeGreaterThan(4.0);
    expect(chart.x).toBeCloseTo(body.x);
    expect(rail.x).toBeCloseTo(chart.x + chart.w + 0.5);
    expect(chart.w).toBeGreaterThan(rail.w);
    expect(chart.h).toBeCloseTo(rail.h);
  });

  it("reports size pressure when the solved layout violates readable minimums", () => {
    const tree: ConstraintLayoutNode = {
      id: "root",
      type: "stack",
      gap: 0.5,
      children: [
        { id: "a", measure: { minH: 2.2 } },
        { id: "b", measure: { minH: 2.2 } },
      ],
    };

    const result = solveConstraintLayout(tree, { x: 0, y: 0, w: 5, h: 3 });
    expect(result.pressures.some((pressure) => pressure.constraint === "minH")).toBe(true);
  });

  it("auto-places grid children and preserves row-span readable height", () => {
    const tree: ConstraintLayoutNode = {
      id: "grid",
      type: "grid",
      columns: 3,
      gap: 0.3,
      columnWeights: [0.5, 0.25, 0.25],
      rowWeights: [0.5, 0.5],
      children: [
        { id: "hero", rowSpan: 2, measure: { minH: 4.7, minW: 5.8 } },
        { id: "k1", measure: { minH: 1.0 } },
        { id: "k2", measure: { minH: 1.0 } },
        { id: "k3", measure: { minH: 1.0 } },
        { id: "k4", measure: { minH: 1.0 } },
      ],
    };

    const result = solveConstraintLayout(tree, { x: 0, y: 0, w: 12, h: 5.4 });
    const hero = result.rects.get("hero")!;
    const k1 = result.rects.get("k1")!;
    const k4 = result.rects.get("k4")!;

    expect(result.pressures).toHaveLength(0);
    expect(hero.h).toBeGreaterThanOrEqual(4.7);
    expect(hero.w).toBeGreaterThan(k1.w);
    expect(k4.y).toBeGreaterThan(k1.y);
  });
});
