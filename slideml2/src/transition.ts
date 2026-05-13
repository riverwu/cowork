import type { SlideAst } from "./emitter/types.js";

export const SLIDE_TRANSITION_TYPES = ["none", "fade", "push", "wipe", "split", "cover", "uncover"] as const;
export const SLIDE_TRANSITION_DIRECTIONS = ["left", "right", "up", "down"] as const;

export type SlideTransitionType = typeof SLIDE_TRANSITION_TYPES[number];
export type SlideTransitionDirection = typeof SLIDE_TRANSITION_DIRECTIONS[number];

const TYPE_SET = new Set<string>(SLIDE_TRANSITION_TYPES);
const DIRECTION_SET = new Set<string>(SLIDE_TRANSITION_DIRECTIONS);
const SLIDE_IN_ALIASES = new Set(["slidein", "slide-in", "slide_in", "slide"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function canonicalTransitionType(value: unknown): SlideTransitionType | undefined {
  const token = normalizeToken(value);
  if (!token) return undefined;
  const normalized = token === "slideIn" ? "slidein" : token;
  if (TYPE_SET.has(normalized)) return normalized as SlideTransitionType;
  return undefined;
}

function canonicalDirection(value: unknown): SlideTransitionDirection | undefined {
  const token = normalizeToken(value);
  if (!token) return undefined;
  if (DIRECTION_SET.has(token)) return token as SlideTransitionDirection;
  switch (token) {
    case "fromLeft": return "left";
    case "fromRight": return "right";
    case "fromTop": return "up";
    case "fromBottom": return "down";
    case "toLeft": return "left";
    case "toRight": return "right";
    case "toTop": return "up";
    case "toBottom": return "down";
    default: return undefined;
  }
}

function isSlideInAlias(value: unknown): boolean {
  const token = normalizeToken(value);
  if (!token) return false;
  return SLIDE_IN_ALIASES.has(token === "slideIn" ? "slidein" : token);
}

function normalizeDurationMs(rec: Record<string, unknown>): number | undefined {
  if (typeof rec.durationMs === "number" && Number.isFinite(rec.durationMs)) return rec.durationMs;
  if (typeof rec.duration === "number" && Number.isFinite(rec.duration)) {
    // Agent-authored decks often use seconds (`duration:0.8`) while the AST
    // uses milliseconds. Values above 20 are almost certainly already ms.
    return rec.duration <= 20 ? rec.duration * 1000 : rec.duration;
  }
  return undefined;
}

/**
 * Normalize source-level transition authoring into the emitter's canonical
 * transition model. Keep this permissive for common authoring aliases, but do
 * not invent transitions for unrelated invalid values.
 */
export function normalizeSlideTransition(value: unknown): SlideAst["transition"] | undefined {
  if (!isRecord(value)) return undefined;

  const rec = value;
  const explicitType = canonicalTransitionType(rec.type);
  const explicitEffect = canonicalTransitionType(rec.effect);
  const directionAsEffect = canonicalTransitionType(rec.direction);
  const type = explicitType
    || explicitEffect
    || (isSlideInAlias(rec.type) ? directionAsEffect || "push" : undefined);

  const transition: NonNullable<SlideAst["transition"]> = {};
  if (type) transition.type = type;

  const durationMs = normalizeDurationMs(rec);
  if (durationMs !== undefined) transition.durationMs = durationMs;

  // When `direction` was used as the effect for `type:"slideIn"` (e.g.
  // direction:"push"), it is not also a spatial direction.
  const direction = isSlideInAlias(rec.type) && directionAsEffect
    ? undefined
    : canonicalDirection(rec.direction);
  if (direction) transition.direction = direction;

  return Object.keys(transition).length > 0 ? transition : undefined;
}

export function describeInvalidSlideTransition(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return "slide.transition must be an object.";
  if (normalizeSlideTransition(value)) return undefined;

  const type = normalizeToken(value.type);
  const effect = normalizeToken(value.effect);
  const direction = normalizeToken(value.direction);
  const parts = [
    type ? `type:${JSON.stringify(type)}` : undefined,
    effect ? `effect:${JSON.stringify(effect)}` : undefined,
    direction ? `direction:${JSON.stringify(direction)}` : undefined,
  ].filter(Boolean);
  return `slide.transition is not recognized${parts.length ? ` (${parts.join(", ")})` : ""}.`;
}
