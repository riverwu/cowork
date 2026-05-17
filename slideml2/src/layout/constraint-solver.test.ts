import { describe, expect, it } from "vitest";
import { CassowaryLayoutSolver } from "./constraint-solver.js";

describe("CassowaryLayoutSolver", () => {
  it("solves a vertical stack with fixed parent bounds and readable child minimums", () => {
    const solver = new CassowaryLayoutSolver();
    const parent = solver.box("parent");
    const a = solver.box("a");
    const b = solver.box("b");

    solver.pin(parent, { x: 1, y: 2, w: 10, h: 6 });
    solver.size(a, { minH: 2, idealH: 3 });
    solver.size(b, { minH: 1, idealH: 2 });
    solver.stack(parent, [a, b], { axis: "vertical", gap: 0.5, padding: 0.25 });

    const solved = solver.solve();
    expect(solved.get("a")).toMatchObject({ x: 1.25, y: 2.25, w: 9.5 });
    expect(solved.get("b")!.y).toBeCloseTo(solved.get("a")!.y + solved.get("a")!.h + 0.5);
    expect(solved.get("a")!.h).toBeGreaterThanOrEqual(2);
    expect(solved.get("b")!.h).toBeGreaterThanOrEqual(1);
    expect(solved.get("b")!.y + solved.get("b")!.h).toBeCloseTo(7.75);
  });

  it("keeps split ratio soft so minimum readable size can override it", () => {
    const solver = new CassowaryLayoutSolver();
    const parent = solver.box("parent");
    const left = solver.box("left");
    const right = solver.box("right");

    solver.pin(parent, { x: 0, y: 0, w: 10, h: 4 });
    solver.size(left, { minW: 6.8 });
    solver.size(right, { minW: 1.2 });
    solver.split(parent, [left, right], {
      axis: "horizontal",
      gap: 0.5,
      ratio: [0.5, 0.5],
      ratioStrength: "medium",
    });

    const solved = solver.solve();
    expect(solved.get("left")!.w).toBeGreaterThanOrEqual(6.8);
    expect(solved.get("right")!.w).toBeGreaterThanOrEqual(1.2);
    expect(solved.get("right")!.x).toBeCloseTo(solved.get("left")!.w + 0.5);
    expect(solved.get("left")!.w + solved.get("right")!.w + 0.5).toBeCloseTo(10);
  });

  it("uses grid track variables so spanning children contribute across rows", () => {
    const solver = new CassowaryLayoutSolver();
    const parent = solver.box("parent");
    const hero = solver.box("hero");
    const top = solver.box("top");
    const bottom = solver.box("bottom");

    solver.pin(parent, { x: 0, y: 0, w: 12, h: 6 });
    solver.size(hero, { minH: 5.2, minW: 6 });
    solver.size(top, { minH: 1.2 });
    solver.size(bottom, { minH: 1.2 });
    solver.grid(parent, [
      { box: hero, row: 0, col: 0, rowSpan: 2, colSpan: 1 },
      { box: top, row: 0, col: 1 },
      { box: bottom, row: 1, col: 1 },
    ], {
      columns: 2,
      rows: 2,
      gap: 0.4,
      columnWeights: [0.62, 0.38],
      rowWeights: [0.5, 0.5],
    });

    const solved = solver.solve();
    expect(solved.get("hero")!.h).toBeGreaterThanOrEqual(5.2);
    expect(solved.get("hero")!.y).toBeCloseTo(0);
    expect(solved.get("bottom")!.y).toBeGreaterThan(solved.get("top")!.y);
    expect(solved.get("hero")!.w).toBeGreaterThan(solved.get("top")!.w);
    expect(solved.get("top")!.x).toBeGreaterThan(solved.get("hero")!.x + solved.get("hero")!.w);
  });
});
