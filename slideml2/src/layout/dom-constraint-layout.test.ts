import { describe, expect, it } from "vitest";
import type { DomNode } from "../types.js";
import { domNodeToConstraintLayoutNode, solveDomConstraintLayout } from "./dom-constraint-layout.js";

describe("domNodeToConstraintLayoutNode", () => {
  it("maps unknown leaf nodes to boxes with authored size contracts", () => {
    const ir = domNodeToConstraintLayoutNode({
      id: "chart",
      type: "chart",
      fixedWidth: "4cm",
      minHeight: 2,
    });

    expect(ir.type).toBe("box");
    expect(ir.measure).toMatchObject({
      minW: 4,
      idealW: 4,
      maxW: 4,
      minH: 2,
    });
  });

  it("solves real DomNode stack and split fields without lowering split first", () => {
    const dom: DomNode = {
      id: "root",
      type: "stack",
      direction: "vertical",
      gap: 0.3,
      padding: 0.2,
      children: [
        { id: "title", type: "text", fixedHeight: 0.65 },
        {
          id: "body",
          type: "split",
          direction: "horizontal",
          gap: 0.4,
          ratio: [0.5, 0.5],
          children: [
            { id: "chart", type: "chart", minWidth: 6.8, minHeight: 3.2 },
            { id: "rail", type: "stack", minWidth: 2.2, children: [
              { id: "rail.title", type: "text", fixedHeight: 0.5 },
              { id: "rail.body", type: "text", minHeight: 1.2 },
            ] },
          ],
        },
      ],
    };

    const result = solveDomConstraintLayout(dom, { x: 0, y: 0, w: 10, h: 6 });
    const title = result.rects.get("title")!;
    const body = result.rects.get("body")!;
    const chart = result.rects.get("chart")!;
    const rail = result.rects.get("rail")!;

    expect(result.ir.children?.[1]?.type).toBe("split");
    expect(result.pressures).toHaveLength(0);
    expect(title.h).toBeCloseTo(0.65);
    expect(body.y).toBeCloseTo(title.y + title.h + 0.3);
    expect(chart.w).toBeGreaterThanOrEqual(6.8);
    expect(rail.w).toBeGreaterThanOrEqual(2.2);
    expect(rail.x).toBeCloseTo(chart.x + chart.w + 0.4);
  });
});

describe("solveDomConstraintLayout", () => {
  it("maps layoutWeight to stack weights while fixed siblings keep their size", () => {
    const dom: DomNode = {
      id: "row",
      type: "stack",
      direction: "horizontal",
      gap: 0.2,
      children: [
        { id: "fixed", type: "shape", fixedWidth: 2 },
        { id: "primary", type: "text", layoutWeight: 2 },
        { id: "secondary", type: "text", layoutWeight: 1 },
      ],
    };

    const result = solveDomConstraintLayout(dom, { x: 0, y: 0, w: 11, h: 2 });
    const fixed = result.rects.get("fixed")!;
    const primary = result.rects.get("primary")!;
    const secondary = result.rects.get("secondary")!;

    expect(result.ir.weights).toEqual([0, 2, 1]);
    expect(fixed.w).toBeCloseTo(2);
    expect(primary.w / secondary.w).toBeCloseTo(2, 4);
    expect(fixed.w + primary.w + secondary.w + 0.4).toBeCloseTo(11);
  });

  it("keeps grid row and column spans in the constraint IR", () => {
    const dom: DomNode = {
      id: "grid",
      type: "grid",
      columns: 3,
      gap: 0.25,
      columnWeights: [0.55, 0.25, 0.2],
      children: [
        { id: "hero", type: "image", rowSpan: 2, colSpan: 2, minHeight: 4.1 },
        { id: "kpi1", type: "text", minHeight: 1.0 },
        { id: "kpi2", type: "text", minHeight: 1.0 },
      ],
    };

    const result = solveDomConstraintLayout(dom, { x: 0, y: 0, w: 12, h: 5 });
    const hero = result.rects.get("hero")!;
    const kpi1 = result.rects.get("kpi1")!;
    const kpi2 = result.rects.get("kpi2")!;

    expect(result.pressures).toHaveLength(0);
    expect(result.ir.children?.[0]?.rowSpan).toBe(2);
    expect(result.ir.children?.[0]?.colSpan).toBe(2);
    expect(hero.h).toBeGreaterThanOrEqual(4.1);
    expect(hero.w).toBeGreaterThan(kpi1.w);
    expect(kpi2.y).toBeGreaterThan(kpi1.y);
  });
});
