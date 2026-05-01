import type { DomNode, RenderedDeck } from "./types.js";

export interface InspectNode {
  id: string;
  type: string;
  fields: Record<string, unknown>;
  childIds: string[];
}

export function inspectDeck(deck: RenderedDeck, slideId?: string): { slides: Array<{ id: string; layout: string; nodes: InspectNode[] }> } {
  return {
    slides: deck.slides
      .filter((slide) => !slideId || slide.id === slideId)
      .map((slide) => ({
        id: slide.id,
        layout: slide.layout,
        nodes: flatten(slide.dom).map((node) => ({
          id: node.id,
          type: node.type,
          fields: nodeFields(node),
          childIds: (node.children || []).map((child) => child.id),
        })),
      })),
  };
}

export function flatten(node: DomNode): DomNode[] {
  return [node, ...(node.children || []).flatMap(flatten)];
}

export function findNode(root: DomNode, id: string): DomNode | null {
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export function removeNode(root: DomNode, id: string): boolean {
  if (!root.children) return false;
  const index = root.children.findIndex((child) => child.id === id);
  if (index >= 0) {
    root.children.splice(index, 1);
    return true;
  }
  return root.children.some((child) => removeNode(child, id));
}

function nodeFields(node: DomNode): Record<string, unknown> {
  const { id: _id, type: _type, children: _children, ...fields } = node;
  return fields;
}
