/**
 * SlideML validator.
 *
 * Validates each slide's `slots` block against the layout's `slots` schema
 * and produces structured `SlidemlError`s. Errors point at
 * `slides[N].slots.<slot>` so callers can wire them into the agent loop.
 */

import type { DeckSpec, SlideSpec } from "./render/index.js";
import type { LoadedTheme, SlotSchema } from "./theme/types.js";

export interface SlidemlValidationError {
  code: string;
  slideIndex?: number;
  layout?: string;
  slot?: string;
  message: string;
  hint?: string;
}

export type ValidationOutcome =
  | { ok: true }
  | { ok: false; errors: SlidemlValidationError[] };

/** Validate a parsed deck against a loaded theme. Pure — no side effects. */
export function validateDeckSpec(spec: DeckSpec, theme: LoadedTheme): ValidationOutcome {
  const errors: SlidemlValidationError[] = [];

  // Theme-name sanity (informational; loader already enforced contract).
  if (spec.deck.theme !== theme.manifest.name) {
    errors.push({
      code: "THEME_NAME_MISMATCH",
      message: `Deck declares theme "${spec.deck.theme}" but the loaded theme is "${theme.manifest.name}".`,
      hint: "Either change the deck's theme name or load the matching theme.",
    });
  }

  // Defaults reference unknown tokens?
  if (spec.deck.defaults) {
    for (const [k, v] of Object.entries(spec.deck.defaults)) {
      if (!(k in theme.manifest.tokens)) {
        errors.push({ code: "UNKNOWN_TOKEN", message: `deck.defaults.${k} — token "${k}" is not defined by theme "${theme.manifest.name}".` });
      }
      if (!(v in theme.manifest.tokens)) {
        errors.push({ code: "UNKNOWN_TOKEN", message: `deck.defaults.${k} = "${v}" — referenced token does not exist in theme "${theme.manifest.name}".` });
      }
    }
  }

  spec.slides.forEach((slide, index) => validateSlide(slide, index, theme, errors));

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateSlide(
  slide: SlideSpec,
  index: number,
  theme: LoadedTheme,
  out: SlidemlValidationError[],
): void {
  const layout = theme.layouts.get(slide.layout);
  if (!layout) {
    out.push({
      code: "UNKNOWN_LAYOUT",
      slideIndex: index,
      layout: slide.layout,
      message: `Layout "${slide.layout}" not in theme "${theme.manifest.name}". Available: ${[...theme.layouts.keys()].join(", ")}.`,
    });
    return;
  }

  for (const [slotName, schema] of Object.entries(layout.slots)) {
    const value = slide.slots[slotName];
    const provided = slotName in slide.slots && value !== undefined && value !== null;

    if (!provided) {
      if (!schema.optional) {
        out.push({
          code: "SLOT_REQUIRED",
          slideIndex: index,
          layout: slide.layout,
          slot: slotName,
          message: `slides[${index}].slots.${slotName} is required by layout "${slide.layout}".`,
        });
      }
      continue;
    }

    validateSlotValue(value, schema, {
      code: "",
      slideIndex: index,
      layout: slide.layout,
      slot: slotName,
      message: "",
    }, out, theme);
  }

  // Reject extra slots the layout doesn't declare.
  for (const slotName of Object.keys(slide.slots)) {
    if (!(slotName in layout.slots)) {
      out.push({
        code: "EXTRA_KEY",
        slideIndex: index,
        layout: slide.layout,
        slot: slotName,
        message: `slides[${index}].slots.${slotName} is not declared by layout "${slide.layout}".`,
        hint: `Layout "${slide.layout}" declares: ${Object.keys(layout.slots).join(", ")}.`,
      });
    }
  }
}

function validateSlotValue(
  value: unknown,
  schema: SlotSchema,
  ctx: SlidemlValidationError,
  out: SlidemlValidationError[],
  theme: LoadedTheme,
): void {
  switch (schema.type) {
    case "text":
    case "markdown-inline":
      if (typeof value !== "string") {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} expected ${schema.type} (string), got ${typeOf(value)}.` });
        return;
      }
      if (schema.maxChars !== undefined && [...value].length > schema.maxChars) {
        // Include the offending VALUE so the agent sees what it's trimming —
        // without this, real-LLM testing showed agents re-emitting the same
        // 21-char string for 3 retries instead of shortening it.
        out.push({
          ...ctx,
          code: "SLOT_OVERFLOW",
          message: `${slotPath(ctx)} is ${[...value].length} chars, exceeds maxChars ${schema.maxChars}. Current value: ${quote(value)}`,
          hint: `Trim "${ctx.slot}" to at most ${schema.maxChars} characters.`,
        });
      }
      return;

    case "text-block":
      // Accept `string[]` and treat as paragraphs joined with blank lines —
      // real LLMs naturally reach for arrays when expressing "list of
      // points" content. Layouts must call `coerceTextBlock` on the slot
      // value to normalize before rendering.
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        const joined = (value as string[]).join("\n\n");
        if (schema.maxChars !== undefined && [...joined].length > schema.maxChars) {
          out.push({
            ...ctx,
            code: "SLOT_OVERFLOW",
            message: `${slotPath(ctx)} (joined paragraphs) is ${[...joined].length} chars, exceeds maxChars ${schema.maxChars}.`,
            hint: `Trim "${ctx.slot}" to at most ${schema.maxChars} characters.`,
          });
        }
        return;
      }
      if (typeof value !== "string") {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} expected text-block (string or string[]), got ${typeOf(value)}.` });
        return;
      }
      if (schema.maxChars !== undefined && [...value].length > schema.maxChars) {
        out.push({
          ...ctx,
          code: "SLOT_OVERFLOW",
          message: `${slotPath(ctx)} is ${[...value].length} chars, exceeds maxChars ${schema.maxChars}. Current first 60 chars: ${quote(value.slice(0, 60))}`,
          hint: `Trim "${ctx.slot}" to at most ${schema.maxChars} characters.`,
        });
      }
      return;

    case "bullets": {
      if (!Array.isArray(value)) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} expected an array, got ${typeOf(value)}.` });
        return;
      }
      if (value.length < schema.min) {
        out.push({ ...ctx, code: "SLOT_UNDERFLOW", message: `${slotPath(ctx)} has ${value.length} items, fewer than min ${schema.min}.` });
      }
      if (value.length > schema.max) {
        out.push({ ...ctx, code: "SLOT_OVERFLOW", message: `${slotPath(ctx)} has ${value.length} items, exceeds max ${schema.max}.` });
      }
      // Items can be strings or objects (e.g. KPI items in stat-grid-3). For
      // strings, enforce maxChars per item — and surface the offending text.
      value.forEach((item, i) => {
        if (typeof item === "string" && [...item].length > schema.itemMaxChars) {
          out.push({
            ...ctx,
            code: "SLOT_OVERFLOW",
            message: `${slotPath(ctx)}[${i}] is ${[...item].length} chars, exceeds itemMaxChars ${schema.itemMaxChars}. Current value: ${quote(item)}`,
            hint: `Trim this bullet to at most ${schema.itemMaxChars} characters.`,
          });
        }
      });
      return;
    }

    case "image-ref":
      // Bare-string shorthand: `image: "/path.png"` is treated as
      // `image: { src: "/path.png" }`. Real-LLM testing showed agents
      // reach for the bare-string form ~50% of the time on the first
      // try; auto-coercing in layouts (via `imageRefOf`) eliminates
      // the retry. Validator accepts both.
      if (typeof value === "string" && value.length > 0) return;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} expected image-ref { src, alt? } or a bare path string, got ${typeOf(value)}.` });
        return;
      }
      if (typeof (value as { src?: unknown }).src !== "string") {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.src is required (string).` });
      }
      return;

    case "chart-spec":
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} expected chart-spec mapping.` });
        return;
      }
      validateChartSpec(value as Record<string, unknown>, ctx, out);
      return;

    case "component-ref": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} expected component-ref { name, slots }.` });
        return;
      }
      const name = (value as { name?: unknown }).name;
      if (typeof name !== "string") {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.name (string) is required.` });
        return;
      }
      if (schema.allowed && !schema.allowed.includes(name)) {
        out.push({ ...ctx, code: "UNKNOWN_COMPONENT", message: `${slotPath(ctx)}.name "${name}" is not allowed here. Allowed: ${schema.allowed.join(", ")}.` });
      }
      if (!theme.components.has(name)) {
        out.push({ ...ctx, code: "UNKNOWN_COMPONENT", message: `Component "${name}" not registered in theme "${theme.manifest.name}".` });
      }
      return;
    }

    case "table":
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} expected table mapping.` });
        return;
      }
      if (!Array.isArray((value as { header?: unknown }).header)) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.header (array) is required.` });
      }
      if (!Array.isArray((value as { rows?: unknown }).rows)) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.rows (array of arrays) is required.` });
      }
      return;

    case "region": {
      // Polymorphic cell: { kind: "kpi"|"chart"|"table"|"text", ... }.
      // Shallow validation here (kind enum); deep shape enforcement
      // happens in the consuming layout because each kind has its own
      // shape that mirrors existing slot types.
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} expected a region object: { kind: "kpi"|"chart"|"table"|"text", ... }.` });
        return;
      }
      const kind = (value as { kind?: unknown }).kind;
      if (typeof kind !== "string" || !["kpi", "chart", "table", "text"].includes(kind)) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.kind must be one of "kpi", "chart", "table", "text".` });
      }
      return;
    }
  }
}

const CHART_TYPES = ["bar", "stacked-bar", "line", "area", "pie", "doughnut"] as const;
const Y_FORMATS = ["int", "decimal", "percent", "wanyuan", "yi"] as const;

function validateChartSpec(value: Record<string, unknown>, ctx: SlidemlValidationError, out: SlidemlValidationError[]): void {
  const type = value["type"];
  if (typeof type !== "string" || !(CHART_TYPES as readonly string[]).includes(type)) {
    out.push({
      ...ctx,
      code: "SLOT_TYPE_MISMATCH",
      message: `${slotPath(ctx)}.type must be one of ${CHART_TYPES.map((t) => `"${t}"`).join(", ")}.`,
    });
  }

  // `format` should be the OBJECT shape `{ y: <enum> }`. Real-LLM testing
  // showed agents sometimes emit `format: int` (a bare string) — catch
  // that here with a precise error so the agent fixes shape, not value.
  const format = value["format"];
  if (format !== undefined) {
    if (typeof format !== "object" || format === null || Array.isArray(format)) {
      out.push({
        ...ctx,
        code: "SLOT_TYPE_MISMATCH",
        message: `${slotPath(ctx)}.format must be an object \`{ y: "int" | "decimal" | "percent" | "wanyuan" | "yi" }\`, got ${typeOf(format)}.`,
        hint: `Replace \`format: ${typeof format === "string" ? quote(format as string) : "..."}\` with \`format: { y: ${typeof format === "string" ? quote(format as string) : '"int"'} }\`.`,
      });
    } else {
      const y = (format as { y?: unknown }).y;
      if (y !== undefined && (typeof y !== "string" || !(Y_FORMATS as readonly string[]).includes(y))) {
        out.push({
          ...ctx,
          code: "SLOT_TYPE_MISMATCH",
          message: `${slotPath(ctx)}.format.y must be one of ${Y_FORMATS.map((t) => `"${t}"`).join(", ")}.`,
        });
      }
    }
  }

  const data = value["data"];
  if (typeof data !== "object" || data === null) {
    out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.data { labels, series } is required.` });
    return;
  }
  const labels = (data as { labels?: unknown }).labels;
  if (!Array.isArray(labels) || labels.some((l) => typeof l !== "string")) {
    out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.data.labels must be string[].` });
  }
  const series = (data as { series?: unknown }).series;
  if (!Array.isArray(series) || series.length === 0) {
    out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.data.series must be a non-empty array.` });
    return;
  }
  // Track labels.length so we can flag mismatched series.values arrays —
  // a class of bug JSON Schema can't express (cross-field constraint).
  // Only run the alignment check when labels actually parsed successfully.
  const labelCount = Array.isArray(labels) && labels.every((l) => typeof l === "string")
    ? labels.length
    : null;

  series.forEach((s, i) => {
    if (typeof s !== "object" || s === null) {
      out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.data.series[${i}] must be { name, values }.` });
      return;
    }
    if (typeof (s as { name?: unknown }).name !== "string") {
      out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.data.series[${i}].name is required (string).` });
    }
    const values = (s as { values?: unknown }).values;
    if (!Array.isArray(values) || values.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.data.series[${i}].values must be number[].` });
      return;
    }
    if (labelCount !== null && values.length !== labelCount) {
      out.push({
        ...ctx,
        code: "SLOT_LENGTH_MISMATCH",
        message:
          `${slotPath(ctx)}.data.series[${i}].values has ${values.length} items but data.labels has ${labelCount}. ` +
          `Each series's values[] must align 1:1 with labels[].`,
        hint: `Pad/truncate values to length ${labelCount} or add/remove labels to match.`,
      });
    }
  });
}

function slotPath(ctx: SlidemlValidationError): string {
  return `slides[${ctx.slideIndex}].slots.${ctx.slot}`;
}

function typeOf(v: unknown): string {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  return typeof v;
}

function quote(s: string): string {
  return JSON.stringify(s.length > 80 ? s.slice(0, 80) + "…" : s);
}
