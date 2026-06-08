/**
 * Layer cascade pass · M3
 *
 * Walks a fully-expanded slide DomNode subtree and enforces the layer depth
 * contract from DESIGN.md §2.1 / §5.4:
 *
 *   layer.0 = slide background
 *   layer.1 = first surface layer (direct child of slide)
 *   layer.2 = surface nested inside layer.1
 *   layer.3+ = forced demote (strip fill / line / cornerRadius / elevation)
 *
 * Detection heuristic: a node is "surface-bearing" when it carries a fill
 * token matching the surface family (surface*, *.tint, brand.tint, etc.) or
 * when it explicitly declares `layer: N`. The pass tracks the running depth
 * and, when a node would land at effective layer ≥ 3, demotes its chrome to
 * frameless and emits a `LAYER_DEPTH_EXCEEDED` diagnostic.
 *
 * This is a render-side correction, not a source-level rewrite — components
 * keep authoring as if they're at layer.1; the cascade handles the nesting.
 */
import type { DomNode } from "./types.js";
import { pushDiagnostic } from "./diagnostics.js";

// Tokens that paint a surface (and therefore consume a layer level).
const SURFACE_FILL_TOKENS = new Set<string>([
  "surface",
  "surface.subtle",
  "surface.elevated",
  "brand.tint",
  "success.tint",
  "warning.tint",
  "danger.tint",
  "info.tint",
  "neutral.tint",
  // tinted helpers from the auto palette
  "tinted",
  "tinted.tint",
]);

/** Maximum allowed effective layer depth. Depth = 3 is the demotion threshold. */
const MAX_LAYER_DEPTH = 2;

function hasSurfaceFill(node: DomNode): boolean {
  if (typeof node.fill === "string" && SURFACE_FILL_TOKENS.has(node.fill)) return true;
  return false;
}

function declaresExplicitLayer(node: DomNode): number | undefined {
  const value = (node as Record<string, unknown>).layer;
  // Skip the renderer's "layer:behind/above" overlay flag (a string semantic).
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 3) {
    return Math.floor(value);
  }
  return undefined;
}

function demote(node: DomNode): DomNode {
  // Strip the chrome that paints a surface. Keep accent rails (they're a
  // separate decoration, not a fill) and keep all content fields intact.
  const out: DomNode = { ...node };
  if (typeof out.fill === "string" && SURFACE_FILL_TOKENS.has(out.fill)) {
    delete out.fill;
  }
  if (out.line === "divider" || out.line === "transparent") {
    delete out.line;
  }
  if (out.elevation === "raised" || out.elevation === "floating") {
    out.elevation = "flat";
  }
  if (typeof out.cornerRadius === "number") {
    delete out.cornerRadius;
  }
  return out;
}

interface CascadeContext {
  /** Slide id for diagnostic routing. */
  slideId: string;
  /** Whether to emit LAYER_DEPTH_EXCEEDED warnings. Default true. */
  emitDiagnostics: boolean;
}

function walk(node: DomNode, parentDepth: number, ctx: CascadeContext): DomNode {
  if (!node || typeof node !== "object") return node;

  const explicit = declaresExplicitLayer(node);
  const isSurfaceBearing = hasSurfaceFill(node);

  // Effective depth for THIS node:
  //   - if it carries surface fill OR declares its own layer, it occupies a level
  //   - otherwise it inherits parent depth
  let myDepth = parentDepth;
  let bearsLayer = false;
  if (explicit !== undefined) {
    myDepth = Math.max(parentDepth, explicit);
    bearsLayer = true;
  } else if (isSurfaceBearing) {
    myDepth = parentDepth + 1;
    bearsLayer = true;
  }

  let out: DomNode = node;
  if (bearsLayer && myDepth > MAX_LAYER_DEPTH) {
    out = demote(node);
    if (ctx.emitDiagnostics) {
      pushDiagnostic({
        severity: "warn",
        code: "LAYER_DEPTH_EXCEEDED",
        slideId: ctx.slideId,
        nodeId: typeof node.id === "string" ? node.id : undefined,
        message: `Surface depth ${myDepth} exceeds the design contract (max ${MAX_LAYER_DEPTH}). The node's fill/line/cornerRadius were removed so nested cards don't accumulate visual chrome.`,
        suggestion: "Move the inner surface up one level, switch to a frameless variant, or split the slide so nested layers stay shallow.",
      });
    }
    // Demoted nodes don't increment depth for their children either.
    myDepth = parentDepth;
  }

  // Recurse into children with the (possibly incremented) depth.
  const childDepth = bearsLayer && myDepth <= MAX_LAYER_DEPTH ? myDepth : parentDepth;
  if (Array.isArray(out.children)) {
    out = { ...out, children: out.children.map((c) => walk(c, childDepth, ctx)) };
  }
  return out;
}

/**
 * Apply layer cascade to a slide-level DomNode subtree. Returns a new tree
 * with depth-3+ surfaces demoted. The slide root itself counts as layer.0.
 */
export function applyLayerCascade(slideRoot: DomNode, slideId: string, emitDiagnostics: boolean = true): DomNode {
  return walk(slideRoot, 0, { slideId, emitDiagnostics });
}
