import type { DomNode } from "../types.js";
import {
  solveConstraintLayout,
  type ConstraintLayoutKind,
  type ConstraintLayoutNode,
  type ConstraintLayoutResult,
} from "./constraint-layout.js";
import type { LayoutAxis, LayoutStrength, SizePreference } from "./constraint-solver.js";
import type { RectLike } from "./geometry.js";

export interface DomConstraintLayoutOptions {
  defaultLeafMeasure?: SizePreference;
  defaultContainerType?: ConstraintLayoutKind;
  includeLayeredChildren?: boolean;
  measureNode?: (node: DomNode, parentAxis: LayoutAxis | undefined) => SizePreference | undefined;
  splitRatioStrength?: LayoutStrength;
  stackWeightStrength?: LayoutStrength;
  gridTrackStrength?: LayoutStrength;
}

export interface DomConstraintLayoutResult extends ConstraintLayoutResult {
  ir: ConstraintLayoutNode;
}

export function domNodeToConstraintLayoutNode(
  node: DomNode,
  options: DomConstraintLayoutOptions = {},
): ConstraintLayoutNode {
  return convertDomNode(node, options, undefined);
}

export function solveDomConstraintLayout(
  root: DomNode,
  bounds: RectLike,
  options: DomConstraintLayoutOptions = {},
): DomConstraintLayoutResult {
  const ir = domNodeToConstraintLayoutNode(root, options);
  return { ir, ...solveConstraintLayout(ir, bounds) };
}

function convertDomNode(
  node: DomNode,
  options: DomConstraintLayoutOptions,
  parentAxis: LayoutAxis | undefined,
): ConstraintLayoutNode {
  const children = domChildren(node, options);
  const kind = layoutKind(node, children.length, options);
  const axis = kind === "stack" || kind === "split" ? layoutAxis(node, kind) : undefined;
  const convertedChildren = children.map((child) => convertDomNode(child, options, axis));
  const measure = options.measureNode?.(node, parentAxis)
    ?? measureFromDomNode(node, parentAxis)
    ?? (convertedChildren.length === 0 ? cloneSizePreference(options.defaultLeafMeasure) : undefined);

  return stripUndefined({
    id: safeNodeId(node),
    type: kind,
    direction: axis,
    gap: dimension(node.gap),
    padding: dimension(node.layoutPadding) ?? dimension(node.padding),
    fill: typeof node.fillLayout === "boolean" ? node.fillLayout : typeof node.fill === "boolean" ? node.fill : undefined,
    stretchCrossAxis: stretchCrossAxis(node),
    weights: kind === "stack" ? childLayoutWeights(children) : undefined,
    weightStrength: kind === "stack" ? options.stackWeightStrength ?? "medium" : undefined,
    ratio: kind === "split" ? splitRatio(node, children) : undefined,
    ratioStrength: kind === "split" ? options.splitRatioStrength ?? "medium" : undefined,
    columns: kind === "grid" ? positiveInteger(node.columns) ?? 2 : undefined,
    rows: kind === "grid" ? positiveInteger(node.rows) : undefined,
    columnWeights: kind === "grid" ? numericArray(node.columnWeights ?? node.colWeights) : undefined,
    rowWeights: kind === "grid" ? numericArray(node.rowWeights) : undefined,
    trackStrength: kind === "grid" ? options.gridTrackStrength ?? "weak" : undefined,
    row: nonNegativeInteger(node.row),
    col: nonNegativeInteger(node.col ?? node.column),
    rowSpan: positiveInteger(node.rowSpan ?? node.rowspan),
    colSpan: positiveInteger(node.colSpan ?? node.colspan),
    measure,
    children: convertedChildren.length > 0 ? convertedChildren : undefined,
  });
}

function domChildren(node: DomNode, options: DomConstraintLayoutOptions): DomNode[] {
  const children = Array.isArray(node.children) ? node.children : [];
  if (options.includeLayeredChildren) return children;
  return children.filter((child) => child.layer !== "behind" && child.layer !== "above");
}

function layoutKind(node: DomNode, childCount: number, options: DomConstraintLayoutOptions): ConstraintLayoutKind {
  if (node.type === "stack" || node.type === "split" || node.type === "grid") return node.type;
  if (childCount > 0) return options.defaultContainerType ?? "stack";
  return "box";
}

function layoutAxis(node: DomNode, kind: "stack" | "split"): LayoutAxis {
  if (node.direction === "horizontal" || node.direction === "vertical") return node.direction;
  return kind === "split" ? "horizontal" : "vertical";
}

function safeNodeId(node: DomNode): string {
  return typeof node.id === "string" && node.id ? node.id : "constraint-node";
}

function stretchCrossAxis(node: DomNode): boolean | undefined {
  if (typeof node.stretchCrossAxis === "boolean") return node.stretchCrossAxis;
  if (node.align === "stretch" || node.valign === "stretch") return true;
  if (node.align === "start" || node.align === "left" || node.align === "center" || node.align === "right" || node.align === "end") return false;
  if (node.valign === "start" || node.valign === "top" || node.valign === "middle" || node.valign === "bottom" || node.valign === "end") return false;
  return undefined;
}

function splitRatio(node: DomNode, children: DomNode[]): number[] | undefined {
  const authored = numericArray(node.ratio);
  if (authored && authored.length === children.length && authored.every((value) => value > 0)) return authored;
  const weights = childLayoutWeights(children);
  if (weights && weights.every((value) => value > 0)) return weights;
  if (children.length === 2) return [0.62, 0.38];
  if (children.length === 3) return [0.4, 0.3, 0.3];
  return children.length > 0 ? children.map(() => 1) : undefined;
}

function childLayoutWeights(children: DomNode[]): number[] | undefined {
  const weights = children.map((child) => dimension(child.layoutWeight) ?? 0);
  return weights.some((weight) => weight > 0) ? weights : undefined;
}

function measureFromDomNode(node: DomNode, parentAxis: LayoutAxis | undefined): SizePreference | undefined {
  const fixedW = dimension(node.fixedWidth) ?? dimension(node.width);
  const fixedH = dimension(node.fixedHeight) ?? dimension(node.height);
  const minW = dimension(node.minWidth);
  const minH = dimension(node.minHeight);
  const maxW = dimension(node.maxWidth);
  const maxH = dimension(node.maxHeight);
  const idealW = dimension(node.idealWidth) ?? dimension(node.preferredWidth) ?? dimension(node.basisWidth);
  const idealH = dimension(node.idealHeight) ?? dimension(node.preferredHeight) ?? dimension(node.basisHeight);
  const basis = dimension(node.basis);

  const measure = stripUndefined<SizePreference>({
    minW: fixedW ?? minW,
    idealW: fixedW ?? idealW ?? (parentAxis === "horizontal" ? basis : undefined),
    maxW: fixedW ?? maxW,
    minH: fixedH ?? minH,
    idealH: fixedH ?? idealH ?? (parentAxis === "vertical" ? basis : undefined),
    maxH: fixedH ?? maxH,
    minStrength: fixedW !== undefined || fixedH !== undefined ? "strong" : undefined,
    idealStrength: fixedW !== undefined || fixedH !== undefined ? "strong" : undefined,
    maxStrength: fixedW !== undefined || fixedH !== undefined ? "strong" : undefined,
  });

  return Object.keys(measure).length > 0 ? measure : undefined;
}

function cloneSizePreference(value: SizePreference | undefined): SizePreference | undefined {
  return value ? { ...value } : undefined;
}

function numericArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.map(dimension);
  return out.every((item): item is number => item !== undefined) ? out : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = dimension(value);
  if (parsed === undefined) return undefined;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const parsed = dimension(value);
  if (parsed === undefined) return undefined;
  const rounded = Math.floor(parsed);
  return rounded >= 0 ? rounded : undefined;
}

function dimension(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const match = /^(-?\d+(?:\.\d+)?)\s*(?:cm)?$/i.exec(trimmed);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stripUndefined<T extends object>(value: T): T {
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) delete record[key];
  }
  return value;
}
