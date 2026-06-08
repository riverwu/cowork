/**
 * Slide-level chrome & chromatic budget audit · M5.3 + M5.4
 *
 * DESIGN.md §5.5 and §2.5 constrain a slide to:
 *   - at most one "loud" component (elevation:raised|floating OR chromatic-tone surface)
 *   - at most one chromatic moment (a single tone color used in surfaces)
 *
 * This pass scans the expanded slide tree post-cascade and emits warnings
 * when a slide blows either budget. It does NOT auto-demote — that's a more
 * invasive change deferred to a future PR. The warnings give agents direct
 * feedback so they can pick a less chromatically-busy layout.
 */
import type { DomNode } from "./types.js";
import { pushDiagnostic } from "./diagnostics.js";

// Tinted surface tokens organized by tone family. Each unique family that
// appears on a slide counts as one chromatic moment.
const CHROMATIC_FAMILIES: Record<string, string> = {
  "brand.tint": "brand",
  "tinted": "brand",
  "tinted.tint": "brand",
  "success.tint": "positive",
  "warning.tint": "warning",
  "danger.tint": "danger",
  "info.tint": "info",
  // Solid tone surfaces (banner-style)
  "brand.primary": "brand",
  "success": "positive",
  "warning": "warning",
  "danger": "danger",
  "info": "info",
};

const NEUTRAL_FILLS = new Set<string>([
  "surface",
  "surface.subtle",
  "surface.elevated",
  "background",
  "transparent",
]);

function fillFamily(fill: unknown): string | null {
  if (typeof fill !== "string") return null;
  return CHROMATIC_FAMILIES[fill] ?? null;
}

// Only container-type nodes ever count as "loud" — a bare `type: "shape"`
// with a tone fill is a decoration (rail, accent dot, etc.), not a chrome
// moment that exhausts the slide's emphasis budget.
const CONTAINER_TYPES = new Set<string>(["stack", "grid", "card", "panel", "band", "frame", "inset"]);

function isLoud(node: DomNode): boolean {
  if (typeof node.type !== "string" || !CONTAINER_TYPES.has(node.type)) return false;
  const elevation = (node as Record<string, unknown>).elevation;
  const hasRaisedElevation = elevation === "raised" || elevation === "floating";
  const fillFam = fillFamily(node.fill);
  if (hasRaisedElevation && (fillFam !== null || (typeof node.fill === "string" && !NEUTRAL_FILLS.has(node.fill)))) {
    return true;
  }
  // A chromatic surface (banner-style fill) is loud even without elevation.
  if (fillFam !== null && !NEUTRAL_FILLS.has(String(node.fill))) {
    return true;
  }
  return false;
}

// Roles whose loud children should be treated as ONE shared chromatic moment
// rather than N independent ones — the component itself is a "grid of
// intentional tone variation" (e.g. key-takeaway grid mini cards).
const SHARED_COMPONENT_ROLES = new Set<string>([
  "key-takeaway",        // grid variant wraps multiple key-takeaway-items
  "fact-list",           // grid variant wraps multiple fact rows
  "comparison-list",     // paired / options variants wrap multiple cards
  "kpi-grid",
  "matrix-2x2",
  "executive-summary",
  "swot-matrix",
]);

function walk(node: DomNode, hits: { loud: Array<{ id: string; family: string | null }>; families: Map<string, string> }, inSharedComponent: boolean): void {
  if (!node || typeof node !== "object") return;

  // If this node opens a "shared component" boundary, its loud descendants
  // collapse into ONE slide-level moment (counted on the parent role, not per
  // child). Walking continues into children but with the suppression flag set.
  const role = typeof (node as Record<string, unknown>).role === "string" ? (node as Record<string, unknown>).role as string : "";
  const opensSharedComponent = SHARED_COMPONENT_ROLES.has(role);

  if (isLoud(node) && !inSharedComponent) {
    const family = fillFamily(node.fill);
    hits.loud.push({ id: typeof node.id === "string" ? node.id : "(unnamed)", family });
    if (family) {
      const existing = hits.families.get(family);
      if (!existing) hits.families.set(family, typeof node.id === "string" ? node.id : "(unnamed)");
    }
  } else if (opensSharedComponent) {
    // Even when the outer container itself isn't painted loud, register one
    // slide-level moment for the component as a whole — using its first
    // chromatic descendant's family if any.
    const childFamily = findFirstChromaticFamily(node);
    if (childFamily) {
      hits.loud.push({ id: typeof node.id === "string" ? node.id : "(unnamed)", family: childFamily });
      const existing = hits.families.get(childFamily);
      if (!existing) hits.families.set(childFamily, typeof node.id === "string" ? node.id : "(unnamed)");
    }
  }

  if (Array.isArray(node.children)) {
    const nextInside = inSharedComponent || opensSharedComponent;
    for (const child of node.children) walk(child, hits, nextInside);
  }
}

/**
 * Recurse looking for the first chromatic SURFACE family inside a node.
 *
 * Only container-type nodes contribute — a bare `type: "shape"` or `"divider"`
 * carrying a tone fill is a rail / accent / dot / hairline (decoration) and
 * DESIGN.md §2.5 explicitly allows it without spending the chromatic moment
 * budget. We still recurse through non-container nodes so we can find a
 * container child further down, but we don't consume their own fill.
 */
function findFirstChromaticFamily(node: DomNode): string | null {
  if (!node || typeof node !== "object") return null;
  if (typeof node.type === "string" && CONTAINER_TYPES.has(node.type)) {
    const family = fillFamily(node.fill);
    if (family) return family;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const result = findFirstChromaticFamily(child);
      if (result) return result;
    }
  }
  return null;
}

export function auditSlideBudgets(slideRoot: DomNode, slideId: string): void {
  const hits = { loud: [] as Array<{ id: string; family: string | null }>, families: new Map<string, string>() };
  walk(slideRoot, hits, false);

  // M5.3 — single loud component per slide
  if (hits.loud.length > 1) {
    const ids = hits.loud.map((h) => h.id).join(", ");
    pushDiagnostic({
      severity: "warn",
      code: "CHROME_BUDGET_EXCEEDED",
      slideId,
      nodeId: hits.loud[1]?.id,
      message: `Slide has ${hits.loud.length} loud (chromatic / elevated) components; the DESIGN.md contract caps loud chrome at 1 per slide. Affected nodes: ${ids}`,
      suggestion: "Demote the secondary components to a frameless / minimal variant, or move them to a sibling slide.",
    });
  }

  // M5.4 — single chromatic moment per slide
  if (hits.families.size > 1) {
    const families = Array.from(hits.families.entries()).map(([f, id]) => `${f}(${id})`).join(", ");
    pushDiagnostic({
      severity: "warn",
      code: "CHROMATIC_BUDGET_EXCEEDED",
      slideId,
      nodeId: Array.from(hits.families.values())[1],
      message: `Slide carries ${hits.families.size} distinct chromatic tone families on surfaces; DESIGN.md §2.5 reserves chromatic tone for a single signal per slide. Found: ${families}`,
      suggestion: "Reserve color for the single most-important signal; switch the others to neutral surface or move the tone to a rail / text accent.",
    });
  }
}
