/**
 * slideml2 design tokens · v1.0
 *
 * Semantic spatial primitives defined in pt and resolved to cm at use sites.
 * Components MUST NOT write literal spacing / radius / rail values — they
 * declare semantic intent via these tokens and the token layer resolves the
 * actual number (factoring in deck-level density context).
 *
 * Anchored on a 4-pt baseline grid (Carbon-style) with a 1.25× type ramp
 * (Refactoring UI hierarchy). The conversion factor 1 pt = 0.0353cm is fixed
 * for slideml2's cm-native rendering.
 *
 * See `slideml2/DESIGN.md` for the contract.
 */

/** 1pt in cm. */
export const PT_TO_CM = 0.0353;

/** Convert a pt value to cm, rounded to 3 decimals to avoid drift. */
export function pt(value: number): number {
  return Math.round(value * PT_TO_CM * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// spacing — 4pt baseline grid
// ---------------------------------------------------------------------------

/**
 * Spacing scale in pt. Components reference tokens by semantic name, never
 * literal numbers. Density context scales these (see densityScale).
 */
export const SPACING_PT = {
  /** 2pt — micro gap between chip rows, inline label/value, very tight inline */
  "2xs": 2,
  /** 4pt — chip / inline tighter than default */
  xs: 4,
  /** 8pt — rail surroundings, title-to-body */
  sm: 8,
  /** 12pt — default gap between components */
  md: 12,
  /** 16pt — between sections */
  lg: 16,
  /** 24pt — hero above/below */
  xl: 24,
  /** 32pt — art-directed slide whitespace */
  "2xl": 32,
} as const;

export type SpacingToken = keyof typeof SPACING_PT;

// ---------------------------------------------------------------------------
// radius — 3 levels only
// ---------------------------------------------------------------------------

/**
 * Corner radius scale in cm (not density-scaled — radii read absolute). The
 * three values are chosen to land near the most common pre-token usages so
 * the M2 migration produces minimal visual drift while still consolidating.
 */
export const RADIUS_CM = {
  /** 0.08cm — hairline chips, badges, pills */
  sm: 0.08,
  /** 0.14cm — cards, surfaces */
  md: 0.14,
  /** 0.24cm — oversized callouts, art-directed */
  lg: 0.24,
} as const;

export type RadiusToken = keyof typeof RADIUS_CM;

// ---------------------------------------------------------------------------
// rail / accent — 2 widths only
// ---------------------------------------------------------------------------

/**
 * Rail / accent line widths in pt. Two widths only — every other value (0.08,
 * 0.18, 0.2, 0.32 in the pre-token codebase) collapses to one of these.
 */
export const RAIL_PT = {
  /** 2pt — inline list-item rails, hairline accents */
  thin: 2,
  /** 6pt — emphasis rails (key-takeaway panel, paired cards) */
  thick: 6,
} as const;

export type RailToken = keyof typeof RAIL_PT;

// ---------------------------------------------------------------------------
// elevation — 3 levels
// ---------------------------------------------------------------------------

export const ELEVATION = {
  flat: "flat",
  raised: "raised",
  floating: "floating",
} as const;

export type ElevationToken = keyof typeof ELEVATION;

// ---------------------------------------------------------------------------
// density — deck/slide-level context, scales spacing only
// ---------------------------------------------------------------------------

export type Density = "comfortable" | "compact" | "dense";

/** Multiplier applied to spacing tokens when the active density differs. */
export const DENSITY_SCALE: Record<Density, number> = {
  comfortable: 1.0,
  compact: 0.83,
  dense: 0.67,
};

/** Resolve a density value with fallback to comfortable. */
export function normalizeDensity(value: unknown): Density {
  return value === "compact" || value === "dense" ? value : "comfortable";
}

// ---------------------------------------------------------------------------
// resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a spacing token to cm under the current density. Use this in
 * components instead of writing literal padding/gap numbers.
 */
export function spacing(token: SpacingToken, density: Density = "comfortable"): number {
  return pt(SPACING_PT[token] * DENSITY_SCALE[density]);
}

/** Resolve a radius token to cm (density-independent). */
export function radius(token: RadiusToken): number {
  return RADIUS_CM[token];
}

/** Resolve a rail/accent token to cm in pt (density-independent). */
export function rail(token: RailToken): number {
  return pt(RAIL_PT[token]);
}

// ---------------------------------------------------------------------------
// baseline grid
// ---------------------------------------------------------------------------

/** Default baseline grid unit in pt. M4 layout pass snaps to this. */
export const BASELINE_GRID_PT = 12;

export function baselineGrid(unitPt: number = BASELINE_GRID_PT): number {
  return pt(unitPt);
}

// ---------------------------------------------------------------------------
// layer — referenced by name; actual fill resolves at render time (M3)
// ---------------------------------------------------------------------------

/**
 * Layer depth tokens. Until M3 ships the cascade resolver, components may use
 * `layerFill(n)` to get a static fallback fill string compatible with the
 * existing theme color system. M3 will swap the resolver for a context-aware
 * version without changing call sites.
 */
export type LayerToken = 0 | 1 | 2 | 3;

/** Static fallback (pre-M3). Each level maps to the closest existing token. */
export function layerFill(level: LayerToken): string {
  switch (level) {
    case 0:
      return "background";
    case 1:
      return "surface";
    case 2:
      return "surface.subtle";
    case 3:
    default:
      // Depth-3+ should be frameless under the contract; return surface.subtle
      // as a static fallback. M3 will detect this and demote upstream.
      return "surface.subtle";
  }
}

// ---------------------------------------------------------------------------
// typographic emphasis tokens (tracking)
// ---------------------------------------------------------------------------

/**
 * Tracking tokens used by kicker / label nodes. The renderer maps these to
 * actual letter-spacing values; components only reference the names.
 */
export const TRACKING = {
  normal: "normal",
  wide: "wide",
  wider: "wider",
  widest: "widest",
} as const;

export type TrackingToken = keyof typeof TRACKING;
