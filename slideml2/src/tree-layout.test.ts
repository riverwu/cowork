import { describe, expect, it } from "vitest";
import { layoutTree, type TreeLayoutNode } from "./tree-layout.js";

describe("variable-size tree layout", () => {
  it("keeps variable-width subtrees non-overlapping and centered under parents", () => {
    const result = layoutTree([
      { id: "root", width: 3.2, height: 1.0 },
      { id: "sales", parentId: "root", width: 2.4, height: 0.9 },
      { id: "success", parentId: "root", width: 3.1, height: 0.9 },
      { id: "west", parentId: "sales", width: 1.7, height: 0.7 },
      { id: "east", parentId: "sales", width: 1.9, height: 0.7 },
      { id: "renewals", parentId: "success", width: 2.2, height: 0.7 },
    ], { siblingGap: 0.28, rootGap: 0.5, levelGap: 0.36 });

    expect(result.overflow).toBe(false);
    expect(result.edges).toHaveLength(5);
    expect(noSameLevelOverlap(result.nodes)).toBe(true);

    const sales = byId(result.nodes, "sales");
    const west = byId(result.nodes, "west");
    const east = byId(result.nodes, "east");
    const success = byId(result.nodes, "success");
    const renewals = byId(result.nodes, "renewals");
    expect(Math.abs(sales.centerX - ((west.centerX + east.centerX) / 2))).toBeLessThan(0.08);
    expect(renewals.centerX).toBeCloseTo(success.centerX, 6);
  });

  it("compresses gaps before reporting overflow", () => {
    const nodes = [
      { id: "root", width: 2.4, height: 0.9 },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `child-${index}`,
        parentId: "root",
        width: 1.2,
        height: 0.65,
      })),
    ];
    const loose = layoutTree(nodes, { siblingGap: 0.5, levelGap: 0.4 });
    const fitted = layoutTree(nodes, { siblingGap: 0.5, minSiblingGap: 0.08, levelGap: 0.4, maxWidth: 9.4 });
    expect(fitted.width).toBeLessThan(loose.width);
    expect(fitted.overflow).toBe(false);
    expect(noSameLevelOverlap(fitted.nodes)).toBe(true);
  });

  it("spreads sibling and level gaps to use available space without scaling nodes", () => {
    const nodes = [
      { id: "root", width: 2.6, height: 0.9 },
      { id: "sales", parentId: "root", width: 1.5, height: 0.7 },
      { id: "success", parentId: "root", width: 1.7, height: 0.7 },
      { id: "ops", parentId: "root", width: 1.4, height: 0.7 },
      { id: "west", parentId: "sales", width: 1.1, height: 0.55 },
      { id: "east", parentId: "sales", width: 1.1, height: 0.55 },
      { id: "renewals", parentId: "success", width: 1.35, height: 0.55 },
    ];
    const compact = layoutTree(nodes, { siblingGap: 0.2, rootGap: 0.3, levelGap: 0.2 });
    const spread = layoutTree(nodes, {
      siblingGap: 0.2,
      rootGap: 0.3,
      levelGap: 0.2,
      maxWidth: 13,
      maxHeight: 5.2,
      spread: true,
    });

    expect(spread.overflow).toBe(false);
    expect(spread.width).toBeGreaterThan(compact.width + 2);
    expect(spread.width).toBeLessThanOrEqual(13.001);
    expect(spread.height).toBeGreaterThan(compact.height + 1);
    expect(spread.height).toBeLessThanOrEqual(5.201);
    expect(byId(spread.nodes, "root").w).toBeCloseTo(byId(compact.nodes, "root").w, 6);
    expect(noSameLevelOverlap(spread.nodes)).toBe(true);
  });
});

function byId(nodes: TreeLayoutNode[], id: string): TreeLayoutNode {
  const found = nodes.find((node) => node.id === id);
  if (!found) throw new Error(`Missing ${id}`);
  return found;
}

function noSameLevelOverlap(nodes: TreeLayoutNode[]): boolean {
  const byDepth = new Map<number, TreeLayoutNode[]>();
  nodes.forEach((node) => {
    const level = byDepth.get(node.depth) || [];
    level.push(node);
    byDepth.set(node.depth, level);
  });
  for (const level of byDepth.values()) {
    const sorted = [...level].sort((a, b) => a.x - b.x);
    for (let index = 1; index < sorted.length; index++) {
      if (sorted[index - 1]!.x + sorted[index - 1]!.w > sorted[index]!.x + 0.001) return false;
    }
  }
  return true;
}
