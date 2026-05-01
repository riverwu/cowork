/**
 * Layout inspector: returns per-node measurements and solver decisions for
 * debugging layout/overflow problems. Independent from `inspectDeck` (which
 * exposes raw DOM fields, not measured rects).
 */
import type { RenderedDeck } from "./types.js";
import { measureDeck, layoutDecisionsForSlide } from "./render.js";

export interface InspectedLayoutNode {
  id: string;
  type: string;
  rect: { x: number; y: number; w: number; h: number };
  intrinsic?: { mainAxis: "vertical" | "horizontal"; basis: number; min: number; max: number; weight: number };
  applied?: "fit" | "shrink" | "demote" | "drop" | "truncate";
  notes?: string[];
}

export interface InspectedSlideLayout {
  slideId: string;
  nodes: InspectedLayoutNode[];
}

export function inspectLayout(deck: RenderedDeck, slideId?: string): InspectedSlideLayout[] {
  const measured = measureDeck(deck);
  const filter = slideId ? measured.filter((m) => m.slideId === slideId) : measured;
  return filter.map(({ slideId: id, nodes }) => {
    const decisions = layoutDecisionsForSlide(deck, id);
    return {
      slideId: id,
      nodes: nodes.map((node) => {
        const decision = decisions.get(node.id);
        const out: InspectedLayoutNode = {
          id: node.id,
          type: node.type,
          rect: { x: round(node.rect.x), y: round(node.rect.y), w: round(node.rect.w), h: round(node.rect.h) },
        };
        if (decision) {
          if (decision.intrinsic) out.intrinsic = decision.intrinsic;
          if (decision.applied) out.applied = decision.applied;
          if (decision.notes && decision.notes.length > 0) out.notes = decision.notes;
        }
        return out;
      }),
    };
  });
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
