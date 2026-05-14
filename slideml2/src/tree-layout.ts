export interface TreeLayoutInputNode<T = unknown> {
  id: string;
  parentId?: string;
  width: number;
  height: number;
  data?: T;
}

export interface TreeLayoutOptions {
  siblingGap?: number;
  rootGap?: number;
  levelGap?: number;
  levelGapDecay?: number;
  minSiblingGap?: number;
  minRootGap?: number;
  minLevelGap?: number;
  maxWidth?: number;
  maxHeight?: number;
  spread?: boolean;
}

export interface TreeLayoutNode<T = unknown> {
  id: string;
  parentId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  centerX: number;
  centerY: number;
  depth: number;
  data?: T;
}

export interface TreeLayoutEdge {
  source: string;
  target: string;
  points: Array<{ x: number; y: number }>;
}

export interface TreeLayoutResult<T = unknown> {
  nodes: TreeLayoutNode<T>[];
  edges: TreeLayoutEdge[];
  width: number;
  height: number;
  depth: number;
  overflow: boolean;
  diagnostics: string[];
}

interface LayoutTreeNode<T> {
  id: string;
  parentId?: string;
  width: number;
  height: number;
  index: number;
  data?: T;
  children: LayoutTreeNode<T>[];
}

interface SubtreePlacement<T> {
  id: string;
  parentId?: string;
  centerX: number;
  depth: number;
  width: number;
  height: number;
  data?: T;
}

interface SubtreeLayout<T> {
  placements: SubtreePlacement<T>[];
  leftContour: number[];
  rightContour: number[];
  depth: number;
}

interface NormalizedOptions {
  siblingGap: number;
  rootGap: number;
  levelGap: number;
  levelGapDecay: number;
  minSiblingGap: number;
  minRootGap: number;
  minLevelGap: number;
  maxWidth?: number;
  maxHeight?: number;
  spread: boolean;
}

export function layoutTree<T = unknown>(nodes: TreeLayoutInputNode<T>[], options: TreeLayoutOptions = {}): TreeLayoutResult<T> {
  const base = normalizeOptions(options);
  const built = buildForest(nodes);
  let active = base;
  let arranged = arrangeForest(built.roots, active.rootGap, active.siblingGap);
  let result = materializeLayout(arranged, active, built.diagnostics);

  for (let attempt = 0; base.maxWidth !== undefined && result.width > base.maxWidth + 0.001 && attempt < 48; attempt++) {
    const horizontalRatio = Math.max(0, Math.min(1, base.maxWidth / Math.max(0.001, result.width)));
    active = {
      ...active,
      siblingGap: Math.max(base.minSiblingGap, active.siblingGap * horizontalRatio),
      rootGap: Math.max(base.minRootGap, active.rootGap * horizontalRatio),
    };
    arranged = arrangeForest(built.roots, active.rootGap, active.siblingGap);
    result = materializeLayout(arranged, active, built.diagnostics);
    if (active.siblingGap <= base.minSiblingGap + 0.0001 && active.rootGap <= base.minRootGap + 0.0001) break;
  }

  for (let attempt = 0; base.maxHeight !== undefined && result.height > base.maxHeight + 0.001 && attempt < 48; attempt++) {
    const verticalRatio = Math.max(0, Math.min(1, base.maxHeight / Math.max(0.001, result.height)));
    active = {
      ...active,
      levelGap: Math.max(base.minLevelGap, active.levelGap * verticalRatio),
    };
    arranged = arrangeForest(built.roots, active.rootGap, active.siblingGap);
    result = materializeLayout(arranged, active, built.diagnostics);
    if (active.levelGap <= base.minLevelGap + 0.0001) break;
  }

  if (base.spread && fitsWithinTarget(result, base)) {
    if (base.maxWidth !== undefined && result.width < base.maxWidth - 0.001) {
      const horizontal = spreadHorizontal(built.roots, active, built.diagnostics, result, base.maxWidth);
      active = horizontal.options;
      result = horizontal.result;
    }
    if (base.maxHeight !== undefined && result.height < base.maxHeight - 0.001) {
      const vertical = spreadVertical(built.roots, active, built.diagnostics, result, base.maxHeight);
      active = vertical.options;
      result = vertical.result;
    }
  }

  const overflow = (base.maxWidth !== undefined && result.width > base.maxWidth + 0.001)
    || (base.maxHeight !== undefined && result.height > base.maxHeight + 0.001);
  return { ...result, overflow };
}

function normalizeOptions(options: TreeLayoutOptions): NormalizedOptions {
  return {
    siblingGap: positive(options.siblingGap, 0.34),
    rootGap: positive(options.rootGap, positive(options.siblingGap, 0.34) * 1.35),
    levelGap: positive(options.levelGap, 0.38),
    levelGapDecay: positive(options.levelGapDecay, 0.90),
    minSiblingGap: positive(options.minSiblingGap, 0.10),
    minRootGap: positive(options.minRootGap, positive(options.minSiblingGap, 0.10)),
    minLevelGap: positive(options.minLevelGap, 0.14),
    maxWidth: finitePositive(options.maxWidth),
    maxHeight: finitePositive(options.maxHeight),
    spread: options.spread === true,
  };
}

function fitsWithinTarget<T>(result: TreeLayoutResult<T>, options: NormalizedOptions): boolean {
  return (options.maxWidth === undefined || result.width <= options.maxWidth + 0.001)
    && (options.maxHeight === undefined || result.height <= options.maxHeight + 0.001);
}

function spreadHorizontal<T>(
  roots: LayoutTreeNode<T>[],
  options: NormalizedOptions,
  diagnostics: string[],
  current: TreeLayoutResult<T>,
  targetWidth: number,
): { options: NormalizedOptions; result: TreeLayoutResult<T> } {
  const make = (multiplier: number) => {
    const nextOptions = {
      ...options,
      siblingGap: options.siblingGap * multiplier,
      rootGap: options.rootGap * multiplier,
    };
    const next = materializeLayout(arrangeForest(roots, nextOptions.rootGap, nextOptions.siblingGap), nextOptions, diagnostics);
    return { options: nextOptions, result: next };
  };
  return maximizeWithoutOverflow(current, options, targetWidth, (result) => result.width, make);
}

function spreadVertical<T>(
  roots: LayoutTreeNode<T>[],
  options: NormalizedOptions,
  diagnostics: string[],
  current: TreeLayoutResult<T>,
  targetHeight: number,
): { options: NormalizedOptions; result: TreeLayoutResult<T> } {
  const make = (multiplier: number) => {
    const nextOptions = { ...options, levelGap: options.levelGap * multiplier };
    const next = materializeLayout(arrangeForest(roots, nextOptions.rootGap, nextOptions.siblingGap), nextOptions, diagnostics);
    return { options: nextOptions, result: next };
  };
  return maximizeWithoutOverflow(current, options, targetHeight, (result) => result.height, make);
}

function maximizeWithoutOverflow<T>(
  current: TreeLayoutResult<T>,
  options: NormalizedOptions,
  target: number,
  measure: (result: TreeLayoutResult<T>) => number,
  make: (multiplier: number) => { options: NormalizedOptions; result: TreeLayoutResult<T> },
): { options: NormalizedOptions; result: TreeLayoutResult<T> } {
  const epsilon = 0.001;
  const initial = measure(current);
  let best = { options, result: current };
  let low = 1;
  let high = 1;
  let last = initial;
  let overshot = false;

  for (let step = 0; step < 18; step++) {
    high *= 2;
    const candidate = make(high);
    const value = measure(candidate.result);
    if (value <= target + epsilon) {
      if (value > measure(best.result) + epsilon) {
        best = candidate;
        low = high;
      }
      if (target - value <= epsilon) return best;
      if (value <= last + epsilon) return best;
      last = value;
      continue;
    }
    overshot = true;
    break;
  }

  if (!overshot) return best;

  for (let step = 0; step < 36; step++) {
    const mid = (low + high) / 2;
    const candidate = make(mid);
    const value = measure(candidate.result);
    if (value <= target + epsilon) {
      if (value > measure(best.result) + epsilon) best = candidate;
      low = mid;
    } else {
      high = mid;
    }
  }
  return best;
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function buildForest<T>(input: TreeLayoutInputNode<T>[]): { roots: LayoutTreeNode<T>[]; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const byId = new Map<string, LayoutTreeNode<T>>();
  input.forEach((node, index) => {
    if (!node.id || byId.has(node.id)) {
      diagnostics.push(`duplicate-or-empty-id:${node.id || index}`);
      return;
    }
    byId.set(node.id, {
      id: node.id,
      parentId: node.parentId,
      width: positive(node.width, 1),
      height: positive(node.height, 0.7),
      index,
      data: node.data,
      children: [],
    });
  });

  const roots: LayoutTreeNode<T>[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (!parent || parent.id === node.id || createsCycle(node, byId)) {
      if (node.parentId && !parent) diagnostics.push(`missing-parent:${node.id}->${node.parentId}`);
      if (node.parentId && parent && createsCycle(node, byId)) diagnostics.push(`cycle:${node.id}->${node.parentId}`);
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }
  for (const node of byId.values()) node.children.sort((a, b) => a.index - b.index);
  return { roots: roots.sort((a, b) => a.index - b.index), diagnostics };
}

function createsCycle<T>(node: LayoutTreeNode<T>, byId: Map<string, LayoutTreeNode<T>>): boolean {
  const seen = new Set<string>([node.id]);
  let parentId = node.parentId;
  while (parentId) {
    if (seen.has(parentId)) return true;
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId;
  }
  return false;
}

function arrangeForest<T>(roots: LayoutTreeNode<T>[], rootGap: number, siblingGap = rootGap): SubtreeLayout<T> {
  const layouts = roots.map((root) => layoutSubtree(root, siblingGap));
  return mergeSubtrees(layouts, rootGap);
}

function layoutSubtree<T>(node: LayoutTreeNode<T>, siblingGap: number): SubtreeLayout<T> {
  if (node.children.length === 0) {
    return {
      placements: [{
        id: node.id,
        parentId: node.parentId,
        centerX: 0,
        depth: 0,
        width: node.width,
        height: node.height,
        data: node.data,
      }],
      leftContour: [-node.width / 2],
      rightContour: [node.width / 2],
      depth: 1,
    };
  }

  const children = mergeSubtrees(node.children.map((child) => layoutSubtree(child, siblingGap)), siblingGap);
  const childCenter = contourCenter(children);
  const shiftedChildren = shiftSubtree(children, -childCenter, 1);
  return {
    placements: [{
      id: node.id,
      parentId: node.parentId,
      centerX: 0,
      depth: 0,
      width: node.width,
      height: node.height,
      data: node.data,
    }, ...shiftedChildren.placements],
    leftContour: mergeOwnContour(-node.width / 2, shiftedChildren.leftContour),
    rightContour: mergeOwnContour(node.width / 2, shiftedChildren.rightContour),
    depth: shiftedChildren.depth,
  };
}

function mergeSubtrees<T>(layouts: SubtreeLayout<T>[], gap: number): SubtreeLayout<T> {
  if (layouts.length === 0) return { placements: [], leftContour: [], rightContour: [], depth: 0 };
  const placements: SubtreePlacement<T>[] = [];
  let leftContour: number[] = [];
  let rightContour: number[] = [];
  let depth = 0;
  layouts.forEach((layout, index) => {
    const offset = index === 0 ? 0 : contourOffset(leftContour, rightContour, layout, gap);
    placements.push(...layout.placements.map((placement) => ({ ...placement, centerX: placement.centerX + offset })));
    leftContour = mergeContour(leftContour, layout.leftContour, offset, Math.min);
    rightContour = mergeContour(rightContour, layout.rightContour, offset, Math.max);
    depth = Math.max(depth, layout.depth);
  });
  return { placements, leftContour, rightContour, depth };
}

function contourOffset<T>(left: number[], right: number[], next: SubtreeLayout<T>, gap: number): number {
  let offset = 0;
  const shared = Math.min(right.length, next.leftContour.length);
  for (let depth = 0; depth < shared; depth++) {
    offset = Math.max(offset, right[depth]! + gap - next.leftContour[depth]!);
  }
  return offset;
}

function mergeContour(base: number[], next: number[], offset: number, op: (a: number, b: number) => number): number[] {
  const merged = base.slice();
  next.forEach((value, index) => {
    merged[index] = merged[index] === undefined ? value + offset : op(merged[index]!, value + offset);
  });
  return merged;
}

function mergeOwnContour(own: number, childContour: number[]): number[] {
  return [own, ...childContour];
}

function contourCenter<T>(layout: SubtreeLayout<T>): number {
  const left = Math.min(...layout.leftContour);
  const right = Math.max(...layout.rightContour);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
  return (left + right) / 2;
}

function shiftSubtree<T>(layout: SubtreeLayout<T>, dx: number, depthOffset = 0): SubtreeLayout<T> {
  return {
    placements: layout.placements.map((placement) => ({
      ...placement,
      centerX: placement.centerX + dx,
      depth: placement.depth + depthOffset,
    })),
    leftContour: layout.leftContour.map((value) => value + dx),
    rightContour: layout.rightContour.map((value) => value + dx),
    depth: layout.depth + depthOffset,
  };
}

function materializeLayout<T>(layout: SubtreeLayout<T>, options: NormalizedOptions, diagnostics: string[]): TreeLayoutResult<T> {
  const levelHeights: number[] = [];
  for (const placement of layout.placements) {
    levelHeights[placement.depth] = Math.max(levelHeights[placement.depth] || 0, placement.height);
  }
  const levelY: number[] = [];
  let cursorY = 0;
  for (let depth = 0; depth < levelHeights.length; depth++) {
    levelY[depth] = cursorY;
    const nextGap = Math.max(options.minLevelGap, options.levelGap * Math.pow(options.levelGapDecay, depth));
    cursorY += (levelHeights[depth] || 0) + (depth < levelHeights.length - 1 ? nextGap : 0);
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const placement of layout.placements) {
    minX = Math.min(minX, placement.centerX - placement.width / 2);
    maxX = Math.max(maxX, placement.centerX + placement.width / 2);
  }
  if (!Number.isFinite(minX)) minX = 0;
  if (!Number.isFinite(maxX)) maxX = 0;

  const byId = new Map<string, TreeLayoutNode<T>>();
  const nodes = layout.placements.map((placement) => {
    const levelHeight = levelHeights[placement.depth] || placement.height;
    const x = placement.centerX - placement.width / 2 - minX;
    const y = (levelY[placement.depth] || 0) + (levelHeight - placement.height) / 2;
    const node: TreeLayoutNode<T> = {
      id: placement.id,
      parentId: placement.parentId,
      x,
      y,
      w: placement.width,
      h: placement.height,
      centerX: x + placement.width / 2,
      centerY: y + placement.height / 2,
      depth: placement.depth,
      data: placement.data,
    };
    byId.set(node.id, node);
    return node;
  });
  const edges = nodes
    .filter((node) => node.parentId && byId.has(node.parentId))
    .map((target) => {
      const source = byId.get(target.parentId!)!;
      const sourceBottom = { x: source.centerX, y: source.y + source.h };
      const targetTop = { x: target.centerX, y: target.y };
      const midY = sourceBottom.y + Math.max(0.06, (targetTop.y - sourceBottom.y) / 2);
      return {
        source: source.id,
        target: target.id,
        points: [
          sourceBottom,
          { x: sourceBottom.x, y: midY },
          { x: targetTop.x, y: midY },
          targetTop,
        ],
      };
    });
  const height = nodes.reduce((max, node) => Math.max(max, node.y + node.h), 0);
  return {
    nodes,
    edges,
    width: Math.max(0, maxX - minX),
    height,
    depth: levelHeights.length,
    overflow: false,
    diagnostics,
  };
}
