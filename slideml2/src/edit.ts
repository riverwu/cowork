import { getSlide } from "./layouts.js";
import { describeNodeType } from "./node-types.js";
import { findNode, removeNode } from "./inspect.js";
import type { DomNode, EditOp, InsertPosition, NodeType, RenderedDeck } from "./types.js";

export function applyEdits(deck: RenderedDeck, ops: EditOp[]): RenderedDeck {
  const clone = JSON.parse(JSON.stringify(deck)) as RenderedDeck;
  for (const op of ops) applyEdit(clone, op);
  return clone;
}

function applyEdit(deck: RenderedDeck, op: EditOp): void {
  const slide = getSlide(deck, op.slideId);
  if (op.op === "setSlideProp") {
    slide.dom[op.prop] = op.value;
    return;
  }
  if (op.op === "setNodeProp") {
    const node = findNode(slide.dom, op.nodeName);
    if (!node) throw new Error(`Node not found: ${op.nodeName}`);
    node[op.prop] = op.value;
    return;
  }
  if (op.op === "insertNode") {
    const parent = findNode(slide.dom, op.parentName);
    if (!parent) throw new Error(`Parent node not found: ${op.parentName}`);
    ensureCanAccept(parent, op.node);
    parent.children = insertChild(parent.children || [], op.node, op.position);
    return;
  }
  if (op.op === "deleteNode") {
    if (!removeNode(slide.dom, op.nodeName)) throw new Error(`Node not found: ${op.nodeName}`);
    return;
  }
}

function insertChild(children: DomNode[], node: DomNode, position: InsertPosition = "last"): DomNode[] {
  const next = [...children];
  if (position === "first") {
    next.unshift(node);
    return next;
  }
  if (position === "last") {
    next.push(node);
    return next;
  }
  if ("index" in position) {
    const index = clampIndex(position.index, next.length);
    next.splice(index, 0, node);
    return next;
  }
  const anchor = "before" in position ? position.before : position.after;
  const anchorIndex = next.findIndex((child) => child.id === anchor);
  if (anchorIndex < 0) throw new Error(`Anchor node not found: ${anchor}`);
  const insertIndex = "before" in position ? anchorIndex : anchorIndex + 1;
  next.splice(insertIndex, 0, node);
  return next;
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.min(Math.max(Math.trunc(index), 0), length);
}

function ensureCanAccept(parent: DomNode, child: DomNode): void {
  const info = describeNodeType(parent.type as NodeType);
  const childType = child.type as NodeType;
  if (!info.acceptsChildren?.includes(childType) && childType !== ("component" as NodeType)) {
    if (!isComponentLikeType(childType)) {
      throw new Error(`Node "${parent.id}" (${parent.type}) cannot accept child type "${child.type}"`);
    }
  }
}

function isComponentLikeType(type: string): boolean {
  return type === "component" || /^[a-z][a-z0-9-]+$/.test(type);
}
