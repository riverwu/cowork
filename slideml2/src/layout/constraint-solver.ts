import { Constraint, Expression, Operator, Solver, Strength, Variable } from "@lume/kiwi";
import type { RectLike } from "./geometry.js";

export type LayoutAxis = "horizontal" | "vertical";
export type LayoutStrength = "required" | "strong" | "medium" | "weak" | number;

export interface LayoutBox {
  id: string;
  x: Variable;
  y: Variable;
  w: Variable;
  h: Variable;
}

export interface SizePreference {
  minW?: number;
  idealW?: number;
  maxW?: number;
  minH?: number;
  idealH?: number;
  maxH?: number;
  minStrength?: LayoutStrength;
  idealStrength?: LayoutStrength;
  maxStrength?: LayoutStrength;
}

export interface StackConstraintOptions {
  axis?: LayoutAxis;
  gap?: number;
  padding?: number;
  fill?: boolean;
  stretchCrossAxis?: boolean;
}

export interface SplitConstraintOptions extends StackConstraintOptions {
  ratio?: number[];
  ratioStrength?: LayoutStrength;
}

export interface GridTrackItem {
  box: LayoutBox;
  row: number;
  col: number;
  rowSpan?: number;
  colSpan?: number;
}

export interface GridConstraintOptions {
  columns: number;
  rows: number;
  gap?: number;
  padding?: number;
  columnWeights?: number[];
  rowWeights?: number[];
  trackStrength?: LayoutStrength;
}

type KiwiTerm = Variable | Expression | number;

export class CassowaryLayoutSolver {
  private readonly solver = new Solver();
  private readonly boxes = new Map<string, LayoutBox>();

  box(id: string): LayoutBox {
    const existing = this.boxes.get(id);
    if (existing) return existing;
    const box: LayoutBox = {
      id,
      x: new Variable(`${id}.x`),
      y: new Variable(`${id}.y`),
      w: new Variable(`${id}.w`),
      h: new Variable(`${id}.h`),
    };
    this.boxes.set(id, box);
    this.ge(box.w, 0);
    this.ge(box.h, 0);
    return box;
  }

  eq(lhs: KiwiTerm, rhs: KiwiTerm, strength: LayoutStrength = "required"): Constraint {
    return this.add(lhs, Operator.Eq, rhs, strength);
  }

  ge(lhs: KiwiTerm, rhs: KiwiTerm, strength: LayoutStrength = "required"): Constraint {
    return this.add(lhs, Operator.Ge, rhs, strength);
  }

  le(lhs: KiwiTerm, rhs: KiwiTerm, strength: LayoutStrength = "required"): Constraint {
    return this.add(lhs, Operator.Le, rhs, strength);
  }

  pin(box: LayoutBox, rect: RectLike): void {
    this.eq(box.x, rect.x);
    this.eq(box.y, rect.y);
    this.eq(box.w, rect.w);
    this.eq(box.h, rect.h);
  }

  size(box: LayoutBox, preference: SizePreference): void {
    const minStrength = preference.minStrength ?? "strong";
    const idealStrength = preference.idealStrength ?? "medium";
    const maxStrength = preference.maxStrength ?? "strong";
    if (preference.minW !== undefined) this.ge(box.w, preference.minW, minStrength);
    if (preference.minH !== undefined) this.ge(box.h, preference.minH, minStrength);
    if (preference.maxW !== undefined) this.le(box.w, preference.maxW, maxStrength);
    if (preference.maxH !== undefined) this.le(box.h, preference.maxH, maxStrength);
    if (preference.idealW !== undefined) this.eq(box.w, preference.idealW, idealStrength);
    if (preference.idealH !== undefined) this.eq(box.h, preference.idealH, idealStrength);
  }

  contain(parent: LayoutBox, child: LayoutBox, padding = 0, strength: LayoutStrength = "required"): void {
    this.ge(child.x, parent.x.plus(padding), strength);
    this.ge(child.y, parent.y.plus(padding), strength);
    this.le(right(child), right(parent).minus(padding), strength);
    this.le(bottom(child), bottom(parent).minus(padding), strength);
  }

  stack(parent: LayoutBox, children: LayoutBox[], options: StackConstraintOptions = {}): void {
    if (children.length === 0) return;
    const axis = options.axis ?? "vertical";
    const gap = options.gap ?? 0;
    const padding = options.padding ?? 0;
    const fill = options.fill ?? true;
    const stretch = options.stretchCrossAxis ?? true;
    const mainStart = axis === "horizontal" ? "x" : "y";
    const mainSize = axis === "horizontal" ? "w" : "h";
    const crossStart = axis === "horizontal" ? "y" : "x";
    const crossSize = axis === "horizontal" ? "h" : "w";

    this.eq(children[0]![mainStart], parent[mainStart].plus(padding));
    for (let index = 1; index < children.length; index++) {
      const previous = children[index - 1]!;
      const current = children[index]!;
      this.eq(current[mainStart], previous[mainStart].plus(previous[mainSize]).plus(gap));
    }

    for (const child of children) {
      this.contain(parent, child, padding);
      if (stretch) {
        this.eq(child[crossStart], parent[crossStart].plus(padding));
        this.eq(child[crossSize], parent[crossSize].minus(padding * 2));
      }
    }

    const last = children[children.length - 1]!;
    const lastEnd = last[mainStart].plus(last[mainSize]);
    const parentEnd = parent[mainStart].plus(parent[mainSize]).minus(padding);
    if (fill) this.eq(lastEnd, parentEnd);
    else this.le(lastEnd, parentEnd);
  }

  split(parent: LayoutBox, children: LayoutBox[], options: SplitConstraintOptions = {}): void {
    this.stack(parent, children, { ...options, fill: true });
    const ratio = normalizedWeights(options.ratio, children.length);
    if (!ratio) return;

    const axis = options.axis ?? "horizontal";
    const mainSize = axis === "horizontal" ? "w" : "h";
    const gap = options.gap ?? 0;
    const padding = options.padding ?? 0;
    const available = parent[mainSize].minus(gap * Math.max(0, children.length - 1) + padding * 2);
    const strength = options.ratioStrength ?? "strong";

    children.forEach((child, index) => {
      this.eq(child[mainSize], available.multiply(ratio[index]!), strength);
    });
  }

  grid(parent: LayoutBox, items: GridTrackItem[], options: GridConstraintOptions): void {
    if (options.columns <= 0 || options.rows <= 0) throw new Error("Grid must have positive row and column counts.");
    const gap = options.gap ?? 0;
    const padding = options.padding ?? 0;
    const colW = createTrackVariables("col", options.columns);
    const rowH = createTrackVariables("row", options.rows);
    const availableW = parent.w.minus(gap * Math.max(0, options.columns - 1) + padding * 2);
    const availableH = parent.h.minus(gap * Math.max(0, options.rows - 1) + padding * 2);

    for (const track of [...colW, ...rowH]) this.ge(track, 0);
    this.eq(sum(colW), availableW);
    this.eq(sum(rowH), availableH);

    addTrackPreferences(this, colW, availableW, options.columnWeights, options.trackStrength);
    addTrackPreferences(this, rowH, availableH, options.rowWeights, options.trackStrength);

    for (const item of items) {
      const colSpan = clampSpan(item.colSpan ?? 1, options.columns - item.col);
      const rowSpan = clampSpan(item.rowSpan ?? 1, options.rows - item.row);
      this.eq(item.box.x, parent.x.plus(padding + item.col * gap).plus(sum(colW.slice(0, item.col))));
      this.eq(item.box.y, parent.y.plus(padding + item.row * gap).plus(sum(rowH.slice(0, item.row))));
      this.eq(item.box.w, sum(colW.slice(item.col, item.col + colSpan)).plus(gap * Math.max(0, colSpan - 1)));
      this.eq(item.box.h, sum(rowH.slice(item.row, item.row + rowSpan)).plus(gap * Math.max(0, rowSpan - 1)));
      this.contain(parent, item.box, padding);
    }
  }

  solve(): Map<string, RectLike> {
    this.solver.updateVariables();
    const solved = new Map<string, RectLike>();
    for (const [id, box] of this.boxes) {
      solved.set(id, {
        x: box.x.value(),
        y: box.y.value(),
        w: box.w.value(),
        h: box.h.value(),
      });
    }
    return solved;
  }

  private add(lhs: KiwiTerm, operator: Operator, rhs: KiwiTerm, strength: LayoutStrength): Constraint {
    const constraint = new Constraint(toConstraintLhs(lhs), operator, rhs, strengthValue(strength));
    this.solver.addConstraint(constraint);
    return constraint;
  }
}

function strengthValue(strength: LayoutStrength): number {
  if (typeof strength === "number") return strength;
  if (strength === "required") return Strength.required;
  if (strength === "strong") return Strength.strong;
  if (strength === "medium") return Strength.medium;
  return Strength.weak;
}

function toConstraintLhs(term: KiwiTerm): Expression | Variable {
  return typeof term === "number" ? new Expression(term) : term;
}

function right(box: LayoutBox): Expression {
  return box.x.plus(box.w);
}

function bottom(box: LayoutBox): Expression {
  return box.y.plus(box.h);
}

function sum(terms: Array<Variable | Expression>): Expression {
  let expr = new Expression(0);
  for (const term of terms) expr = expr.plus(term);
  return expr;
}

function normalizedWeights(values: number[] | undefined, count: number): number[] | undefined {
  if (!values || values.length !== count) return undefined;
  const positive = values.map((value) => Number.isFinite(value) && value > 0 ? value : 0);
  const total = positive.reduce((acc, value) => acc + value, 0);
  if (total <= 0) return undefined;
  return positive.map((value) => value / total);
}

function createTrackVariables(prefix: string, count: number): Variable[] {
  return Array.from({ length: count }, (_, index) => new Variable(`${prefix}${index}`));
}

function addTrackPreferences(
  solver: CassowaryLayoutSolver,
  tracks: Variable[],
  available: Expression,
  weights: number[] | undefined,
  strength: LayoutStrength = "weak",
): void {
  const normalized = normalizedWeights(weights, tracks.length);
  if (!normalized) return;
  tracks.forEach((track, index) => {
    solver.eq(track, available.multiply(normalized[index]!), strength);
  });
}

function clampSpan(span: number, available: number): number {
  return Math.max(1, Math.min(Math.floor(span), Math.max(1, available)));
}
