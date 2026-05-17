import {
  CassowaryLayoutSolver,
  type LayoutAxis,
  type LayoutStrength,
  type SizePreference,
} from "./constraint-solver.js";
import type { RectLike } from "./geometry.js";

export type ConstraintLayoutKind = "box" | "stack" | "split" | "grid";

export interface ConstraintLayoutNode {
  id: string;
  type?: ConstraintLayoutKind;
  direction?: LayoutAxis;
  gap?: number;
  padding?: number;
  fill?: boolean;
  stretchCrossAxis?: boolean;
  ratio?: number[];
  ratioStrength?: LayoutStrength;
  columns?: number;
  rows?: number;
  columnWeights?: number[];
  rowWeights?: number[];
  trackStrength?: LayoutStrength;
  row?: number;
  col?: number;
  rowSpan?: number;
  colSpan?: number;
  measure?: SizePreference;
  children?: ConstraintLayoutNode[];
}

export interface ConstraintLayoutPressure {
  nodeId: string;
  constraint: "minW" | "minH" | "maxW" | "maxH";
  expected: number;
  actual: number;
  delta: number;
}

export interface ConstraintLayoutResult {
  rects: Map<string, RectLike>;
  pressures: ConstraintLayoutPressure[];
}

export function solveConstraintLayout(root: ConstraintLayoutNode, bounds: RectLike): ConstraintLayoutResult {
  const solver = new CassowaryLayoutSolver();
  const nodes = new Map<string, ConstraintLayoutNode>();
  const rootBox = buildNode(solver, root, nodes);
  solver.pin(rootBox, bounds);
  const rects = solver.solve();
  return {
    rects,
    pressures: measurePressures(nodes, rects),
  };
}

function buildNode(solver: CassowaryLayoutSolver, node: ConstraintLayoutNode, nodes: Map<string, ConstraintLayoutNode>) {
  if (!node.id) throw new Error("Constraint layout node is missing id.");
  if (nodes.has(node.id)) throw new Error(`Duplicate constraint layout node id '${node.id}'.`);
  nodes.set(node.id, node);
  const box = solver.box(node.id);
  if (node.measure) solver.size(box, node.measure);

  const children = node.children || [];
  for (const child of children) buildNode(solver, child, nodes);

  const kind = node.type ?? (children.length > 0 ? "stack" : "box");
  if (kind === "stack") {
    solver.stack(box, children.map((child) => solver.box(child.id)), {
      axis: node.direction,
      gap: node.gap,
      padding: node.padding,
      fill: node.fill,
      stretchCrossAxis: node.stretchCrossAxis,
    });
  } else if (kind === "split") {
    solver.split(box, children.map((child) => solver.box(child.id)), {
      axis: node.direction,
      gap: node.gap,
      padding: node.padding,
      fill: true,
      stretchCrossAxis: node.stretchCrossAxis,
      ratio: node.ratio,
      ratioStrength: node.ratioStrength,
    });
  } else if (kind === "grid") {
    const placement = placeGridChildren(children, node.columns ?? 2, node.rows);
    solver.grid(
      box,
      placement.items.map((item) => ({
        box: solver.box(item.node.id),
        row: item.row,
        col: item.col,
        rowSpan: item.rowSpan,
        colSpan: item.colSpan,
      })),
      {
        columns: placement.columns,
        rows: placement.rows,
        gap: node.gap,
        padding: node.padding,
        columnWeights: node.columnWeights,
        rowWeights: node.rowWeights,
        trackStrength: node.trackStrength,
      },
    );
  }

  return box;
}

interface GridPlacement {
  node: ConstraintLayoutNode;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

function placeGridChildren(children: ConstraintLayoutNode[], rawColumns: number, declaredRows?: number): {
  columns: number;
  rows: number;
  items: GridPlacement[];
} {
  const columns = Math.max(1, Math.floor(rawColumns));
  const occupied: boolean[][] = [];
  const items: GridPlacement[] = [];

  for (const child of children) {
    const colSpan = clampSpan(child.colSpan ?? 1, columns);
    const rowSpan = Math.max(1, Math.floor(child.rowSpan ?? 1));
    if (isNonNegativeInteger(child.row) && isNonNegativeInteger(child.col)) {
      const row = child.row;
      const col = child.col;
      if (col + colSpan > columns) throw new Error(`Grid child '${child.id}' exceeds column count.`);
      if (!isFree(occupied, row, col, rowSpan, colSpan)) throw new Error(`Grid child '${child.id}' overlaps another explicit grid child.`);
      mark(occupied, row, col, rowSpan, colSpan);
      items.push({ node: child, row, col, rowSpan, colSpan });
      continue;
    }

    let placed = false;
    for (let row = 0; !placed; row++) {
      for (let col = 0; col + colSpan <= columns; col++) {
        if (!isFree(occupied, row, col, rowSpan, colSpan)) continue;
        mark(occupied, row, col, rowSpan, colSpan);
        items.push({ node: child, row, col, rowSpan, colSpan });
        placed = true;
        break;
      }
    }
  }

  const usedRows = items.reduce((max, item) => Math.max(max, item.row + item.rowSpan), 0);
  const rows = Math.max(1, declaredRows ?? 0, usedRows);
  if (declaredRows !== undefined && usedRows > declaredRows) {
    throw new Error(`Grid needs ${usedRows} row(s), but rows is ${declaredRows}.`);
  }

  return { columns, rows, items };
}

function isFree(occupied: boolean[][], row: number, col: number, rowSpan: number, colSpan: number): boolean {
  for (let r = row; r < row + rowSpan; r++) {
    const line = occupied[r] || [];
    for (let c = col; c < col + colSpan; c++) {
      if (line[c]) return false;
    }
  }
  return true;
}

function mark(occupied: boolean[][], row: number, col: number, rowSpan: number, colSpan: number): void {
  for (let r = row; r < row + rowSpan; r++) {
    if (!occupied[r]) occupied[r] = [];
    for (let c = col; c < col + colSpan; c++) occupied[r]![c] = true;
  }
}

function clampSpan(span: number, columns: number): number {
  return Math.max(1, Math.min(Math.floor(span), columns));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function measurePressures(nodes: Map<string, ConstraintLayoutNode>, rects: Map<string, RectLike>): ConstraintLayoutPressure[] {
  const pressures: ConstraintLayoutPressure[] = [];
  for (const [id, node] of nodes) {
    const rect = rects.get(id);
    const measure = node.measure;
    if (!rect || !measure) continue;
    pushPressure(pressures, id, "minW", measure.minW, rect.w, (expected, actual) => expected - actual);
    pushPressure(pressures, id, "minH", measure.minH, rect.h, (expected, actual) => expected - actual);
    pushPressure(pressures, id, "maxW", measure.maxW, rect.w, (expected, actual) => actual - expected);
    pushPressure(pressures, id, "maxH", measure.maxH, rect.h, (expected, actual) => actual - expected);
  }
  return pressures;
}

function pushPressure(
  out: ConstraintLayoutPressure[],
  nodeId: string,
  constraint: ConstraintLayoutPressure["constraint"],
  expected: number | undefined,
  actual: number,
  deltaFn: (expected: number, actual: number) => number,
): void {
  if (expected === undefined) return;
  const delta = deltaFn(expected, actual);
  if (delta <= 0.01) return;
  out.push({ nodeId, constraint, expected, actual, delta });
}
