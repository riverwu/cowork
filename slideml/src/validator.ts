/**
 * SlideML validator.
 *
 * Validates each slide's `slots` block against the layout's `slots` schema
 * and produces structured `SlidemlError`s. Errors point at
 * `slides[N].slots.<slot>` so callers can wire them into the agent loop.
 */

import type { DeckSpec, SlideSpec } from "./render/index.js";
import type { LoadedTheme, SlotSchema } from "./theme/types.js";
import { DENSITY, DENSITY_VALUES, type Density } from "./render/density.js";

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

/**
 * CJK glyphs occupy roughly 1.6× the visual width of a Latin character at
 * the same point size, so character-count budgets need a corresponding
 * boost when the deck language is CJK. Without this multiplier, agents
 * writing Chinese / Japanese / Korean content hit `SLOT_OVERFLOW` at
 * what would visually be a half-full column.
 *
 * Applied to `text` and `text-block` `maxChars` ceilings; bullet
 * `itemMaxChars` also benefits but bullets are typically already short.
 */
const CJK_BUDGET_MULTIPLIER = 1.6;

function isCjkLanguage(lang: string | undefined): boolean {
  return !!lang && /^(zh|ja|ko)/i.test(lang);
}

/** Resolve the slide-level density slot value to a Density enum (default normal). */
function pickDensity(value: unknown): Density {
  if (typeof value === "string" && (DENSITY_VALUES as readonly string[]).includes(value)) {
    return value as Density;
  }
  return "normal";
}

/** Per-density character budget (latin or CJK) for a single half-slide column. */
function budgetForDensity(density: Density, cjk: boolean): number {
  return cjk ? DENSITY[density].cjkBudget : DENSITY[density].latinBudget;
}

/**
 * Layout-level budget multiplier on top of the per-density column budget.
 *   half-column layouts (two-col-text-image, image-split-text, ...) → 1.0
 *   prose (single full-width column) → 1.5
 *   two-column-prose (full width, 2 columns) → 3.0
 *   letter (full-width body, generous margins, slightly narrower) → 1.3
 *
 * Layouts not in this map fall back to 1.0.
 */
const LAYOUT_BUDGET_MULTIPLIER: Record<string, number> = {
  "prose": 1.5,
  "two-column-prose": 3.0,
  "letter": 1.3,
};

function effectiveBudget(layout: string, density: Density, cjk: boolean): number {
  const base = budgetForDensity(density, cjk);
  const mult = LAYOUT_BUDGET_MULTIPLIER[layout] ?? 1.0;
  return Math.round(base * mult);
}

/**
 * Build a concrete next-step hint when DENSITY_OVERFLOW fires. Walks the
 * density ladder upward; if the densest preset (`micro`) still doesn't
 * have room, recommends switching to a single-column layout (prose) or
 * two-column-prose, with their effective budgets surfaced inline.
 */
function nextDensitySuggestion(
  slotName: string,
  current: Density,
  charCount: number,
  cjk: boolean,
  currentLayout: string,
): string {
  // Try denser presets at the current layout first.
  const denser: Density[] = DENSITY_VALUES.slice(DENSITY_VALUES.indexOf(current) + 1);
  for (const d of denser) {
    if (charCount <= effectiveBudget(currentLayout, d, cjk)) {
      return `Set "density: ${d}" (budget ${effectiveBudget(currentLayout, d, cjk)} ${cjk ? "CJK" : "latin"} chars) on this slide.`;
    }
  }
  // Beyond micro on this layout — recommend wider single-column or two-column prose.
  const proseBudget = effectiveBudget("prose", "micro", cjk);
  const twoColProseBudget = effectiveBudget("two-column-prose", "micro", cjk);
  if (currentLayout !== "prose" && charCount <= proseBudget) {
    return `Densest preset on "${currentLayout}" is too small; switch layout to "prose" (single column, ~${proseBudget} chars at micro density).`;
  }
  if (currentLayout !== "two-column-prose" && charCount <= twoColProseBudget) {
    return `Switch layout to "two-column-prose" (two full columns, ~${twoColProseBudget} chars at micro density).`;
  }
  return `Content (${charCount} chars) exceeds even two-column-prose at micro density (~${twoColProseBudget}). Split this slot across multiple slides.`;
}

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

  const cjk = isCjkLanguage(spec.deck.language);
  spec.slides.forEach((slide, index) => validateSlide(slide, index, theme, errors, cjk));

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateSlide(
  slide: SlideSpec,
  index: number,
  theme: LoadedTheme,
  out: SlidemlValidationError[],
  cjk: boolean,
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
    }, out, theme, cjk, slide.slots);
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
        hint: extraKeyHint(slide.layout, slotName, Object.keys(layout.slots)),
      });
    }
  }

  // Common-misuse check: chart-with-takeaway with chart that looks like
  // an image-ref instead of a chart-spec. Validator's chart-spec branch
  // emits SLOT_TYPE_MISMATCH on the type field, but the better hint is
  // "use image-with-takeaway instead". Detect + add a leading hint.
  if (slide.layout === "chart-with-takeaway") {
    const c = slide.slots["chart"];
    if (c && typeof c === "object" && !Array.isArray(c)) {
      const o = c as { type?: unknown; image?: unknown; src?: unknown };
      const looksLikeImage = (o.type === "image") || typeof o.image === "string" || typeof o.src === "string";
      if (looksLikeImage) {
        out.push({
          code: "LAYOUT_MISMATCH",
          slideIndex: index,
          layout: slide.layout,
          slot: "chart",
          message: `slides[${index}] uses layout "chart-with-takeaway" but the chart payload looks like an image (chart.type === "image" or chart.image / chart.src is set).`,
          hint: `chart-with-takeaway expects a typed chart-spec ({ type: "bar" | "line" | ..., data: { labels, series } }). For a static image (PNG/JPG of a chart), switch to layout: "image-with-takeaway" — same takeaway panel, image instead of native chart.`,
        });
      }
    }
  }
}

/**
 * Build a friendly hint for EXTRA_KEY. Detects common slot-name
 * confusions and suggests the right layout instead of just listing the
 * declared slots.
 */
function extraKeyHint(layoutName: string, slotName: string, declared: string[]): string {
  // Closing layout was missing image until recently — agents still
  // sometimes ask for hero-style closes via the wrong slot.
  if (layoutName === "closing" && (slotName === "background" || slotName === "bg")) {
    return `Use slot "image" instead — closing now supports an optional full-bleed background image.`;
  }
  // chart-spec slots with image-shaped extra keys: handled separately
  // by the LAYOUT_MISMATCH check in validateSlide.
  return `Layout "${layoutName}" declares: ${declared.join(", ")}.`;
}

function validateSlotValue(
  value: unknown,
  schema: SlotSchema,
  ctx: SlidemlValidationError,
  out: SlidemlValidationError[],
  theme: LoadedTheme,
  cjk: boolean,
  slideSlots: Record<string, unknown>,
): void {
  switch (schema.type) {
    case "text":
    case "markdown-inline":
      if (typeof value !== "string") {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} expected ${schema.type} (string), got ${typeOf(value)}.` });
        return;
      }
      if (schema.maxChars !== undefined) {
        const effectiveMax = cjk ? Math.round(schema.maxChars * CJK_BUDGET_MULTIPLIER) : schema.maxChars;
        if ([...value].length > effectiveMax) {
          // Include the offending VALUE so the agent sees what it's trimming.
          out.push({
            ...ctx,
            code: "SLOT_OVERFLOW",
            message: `${slotPath(ctx)} is ${[...value].length} chars, exceeds ${cjk ? "CJK-adjusted " : ""}maxChars ${effectiveMax}${cjk ? ` (${schema.maxChars} × 1.6 CJK)` : ""}. Current value: ${quote(value)}`,
            hint: `Trim "${ctx.slot}" to at most ${effectiveMax} characters.`,
          });
        }
      }
      return;

    case "text-block": {
      // Three accepted shapes:
      //   1. plain string — split on blank lines into paragraphs.
      //   2. string[] — joined with paragraph breaks.
      //   3. (string | { kind, text })[] — typed paragraphs (Tier 3a).
      // Each typed paragraph picks distinctive styling at render time.
      const PARA_KINDS = new Set(["quote", "note", "callout", "h2"]);
      // Density-aware budget — when the slide declares a `density` slot,
      // the effective char budget for this text-block is the density
      // preset's per-column budget (latin or CJK), NOT the layout's hard
      // maxChars ceiling. The maxChars ceiling stays as a safety cap at
      // the densest setting; here we surface DENSITY_OVERFLOW with
      // concrete next-step suggestions so the agent can iterate.
      const declaredDensity = pickDensity(slideSlots["density"]);
      const densityBudget = effectiveBudget(ctx.layout!, declaredDensity, cjk);
      const cjkNote = cjk ? ` (CJK)` : "";
      let total = 0;
      let bad = false;
      let preview = "";
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") {
            total += [...item].length + 2;
            if (!preview && item.length > 0) preview = item.slice(0, 60);
          } else if (item && typeof item === "object" && !Array.isArray(item)) {
            const o = item as { kind?: unknown; text?: unknown };
            if (typeof o.text !== "string") { bad = true; break; }
            if (o.kind !== undefined && (typeof o.kind !== "string" || !PARA_KINDS.has(o.kind))) {
              bad = true; break;
            }
            total += [...o.text].length + 2;
            if (!preview && o.text.length > 0) preview = o.text.slice(0, 60);
          } else {
            bad = true; break;
          }
        }
      } else if (typeof value !== "string") {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} expected text-block (string, string[], or Array<{kind,text}>), got ${typeOf(value)}.` });
        return;
      } else {
        total = [...value].length;
        preview = value.slice(0, 60);
      }
      if (bad) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} accepts string | string[] | Array<string | { kind: 'quote'|'note'|'callout'|'h2', text: string }>.` });
        return;
      }
      // Density-aware soft check (DENSITY_OVERFLOW). Only fires when the
      // layout actually declares a density slot — layouts without density
      // (e.g. quote, hero-stat) still rely on the hard maxChars below.
      const layoutHasDensity = !!theme.layouts.get(ctx.layout!)?.slots["density"]
        && (theme.layouts.get(ctx.layout!)!.slots["density"] as { type: string }).type === "enum";
      if (layoutHasDensity && total > densityBudget) {
        out.push({
          ...ctx,
          code: "DENSITY_OVERFLOW",
          message:
            `${slotPath(ctx)} is ${total} chars, exceeds density="${declaredDensity}"${cjkNote} budget ${densityBudget}.`,
          hint: nextDensitySuggestion(ctx.slot!, declaredDensity, total, cjk, ctx.layout!),
        });
        return;
      }
      // Hard maxChars ceiling — disaster cap that prevents truly oversized input.
      const effectiveMax = schema.maxChars !== undefined
        ? (cjk ? Math.round(schema.maxChars * CJK_BUDGET_MULTIPLIER) : schema.maxChars)
        : undefined;
      if (effectiveMax !== undefined && total > effectiveMax) {
        out.push({
          ...ctx,
          code: "SLOT_OVERFLOW",
          message: `${slotPath(ctx)} is ${total} chars, exceeds maxChars ${effectiveMax}${cjkNote}. First 60 chars: ${quote(preview)}`,
          hint: `Trim "${ctx.slot}" to at most ${effectiveMax} characters, or switch to a denser layout (prose / two-column-prose).`,
        });
      }
      return;
    }

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
      // Items can be:
      //   - plain strings
      //   - object items with a `text` field (nested bullet form: { text, sub? })
      //   - object items WITHOUT `text` (e.g. KPI tile data { value, label })
      // Only enforce itemMaxChars on strings and on the `.text` field of
      // text-shaped objects. Other object shapes pass through unchecked
      // (the layout that consumes them validates further).
      const validateItem = (item: unknown, path: string, depth: number): void => {
        if (typeof item === "string") {
          if ([...item].length > schema.itemMaxChars) {
            out.push({
              ...ctx,
              code: "SLOT_OVERFLOW",
              message: `${path} is ${[...item].length} chars, exceeds itemMaxChars ${schema.itemMaxChars}. Current value: ${quote(item)}`,
              hint: `Trim this bullet to at most ${schema.itemMaxChars} characters.`,
            });
          }
          return;
        }
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const o = item as { text?: unknown; sub?: unknown };
          if (typeof o.text === "string") {
            if ([...o.text].length > schema.itemMaxChars) {
              out.push({
                ...ctx,
                code: "SLOT_OVERFLOW",
                message: `${path}.text is ${[...o.text].length} chars, exceeds itemMaxChars ${schema.itemMaxChars}.`,
              });
            }
            if (o.sub !== undefined) {
              if (depth >= 1) {
                out.push({
                  ...ctx,
                  code: "SLOT_TYPE_MISMATCH",
                  message: `${path}.sub: bullets can only nest 2 levels deep.`,
                });
                return;
              }
              if (!Array.isArray(o.sub)) {
                out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${path}.sub must be an array.` });
                return;
              }
              o.sub.forEach((s, i) => validateItem(s, `${path}.sub[${i}]`, depth + 1));
            }
          }
        }
      };
      value.forEach((item, i) => validateItem(item, `${slotPath(ctx)}[${i}]`, 0));
      return;
    }

    case "image-ref": {
      // Bare-string shorthand: `image: "/path.png"` is treated as
      // `image: { src: "/path.png" }`. Real-LLM testing showed agents
      // reach for the bare-string form ~50% of the time on the first
      // try; auto-coercing in layouts (via `imageRefOf`) eliminates
      // the retry. Validator accepts both.
      if (typeof value === "string" && value.length > 0) return;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} expected image-ref { src, alt?, shape?, border?, overlay? } or a bare path string, got ${typeOf(value)}.` });
        return;
      }
      const o = value as Record<string, unknown>;
      const hasSrc = typeof o.src === "string" || typeof o.url === "string" || typeof o.svg === "string";
      if (!hasSrc) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} requires one of: src (path/URL), url (alias), or svg (inline SVG markup).` });
      }
      if (o.svg !== undefined && typeof o.svg !== "string") {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.svg must be an SVG markup string (e.g. "<svg viewBox=...>...</svg>").` });
      }
      if (o.shape !== undefined && o.shape !== "square" && o.shape !== "rounded" && o.shape !== "circle") {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.shape must be "square" | "rounded" | "circle".` });
      }
      if (o.border !== undefined) {
        if (typeof o.border !== "object" || o.border === null || Array.isArray(o.border) || typeof (o.border as { color?: unknown }).color !== "string") {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.border must be an object { color, width? }.` });
        }
      }
      if (o.overlay !== undefined) {
        if (typeof o.overlay !== "object" || o.overlay === null || Array.isArray(o.overlay) || typeof (o.overlay as { color?: unknown }).color !== "string") {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.overlay must be an object { color, alpha? }.` });
        }
      }
      return;
    }

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

    case "table": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} expected table mapping.` });
        return;
      }
      const t = value as { header?: unknown; rows?: unknown };
      if (!Array.isArray(t.header)) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.header (array) is required.` });
      }
      if (!Array.isArray(t.rows)) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.rows (array of arrays) is required.` });
        return;
      }
      const align = (t as { align?: unknown }).align;
      if (align !== undefined) {
        const ALIGNS = new Set(["left", "center", "right"]);
        if (!Array.isArray(align) || align.some((a) => typeof a !== "string" || !ALIGNS.has(a))) {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.align must be Array<"left" | "center" | "right">.` });
        }
      }
      // Cells: each cell may be a string OR { value, emphasis? } where
      // emphasis is one of ok|warn|bad|highlight|up|down|flat. Anything
      // else gets coerced to string at render time, so don't error — only
      // validate the explicit-shape case.
      const TABLE_EMPHASIS = new Set(["ok", "warn", "bad", "highlight", "up", "down", "flat"]);
      (t.rows as unknown[]).forEach((row, ri) => {
        if (!Array.isArray(row)) {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.rows[${ri}] must be an array of cells.` });
          return;
        }
        row.forEach((cell, ci) => {
          if (typeof cell === "string" || typeof cell === "number") return;
          if (cell && typeof cell === "object" && !Array.isArray(cell)) {
            const c = cell as { value?: unknown; emphasis?: unknown };
            if (c.value !== undefined && typeof c.value !== "string" && typeof c.value !== "number") {
              out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.rows[${ri}][${ci}].value must be a string or number.` });
            }
            if (c.emphasis !== undefined && (typeof c.emphasis !== "string" || !TABLE_EMPHASIS.has(c.emphasis))) {
              out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.rows[${ri}][${ci}].emphasis must be one of ${[...TABLE_EMPHASIS].join(", ")}.` });
            }
          }
        });
      });
      return;
    }

    case "enum": {
      if (typeof value !== "string") {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} expected one of: ${schema.values.join(" | ")}.` });
        return;
      }
      if (!schema.values.includes(value)) {
        out.push({
          ...ctx,
          code: "SLOT_TYPE_MISMATCH",
          message: `${slotPath(ctx)} = ${quote(value)} is not allowed. Pick one of: ${schema.values.map(quote).join(", ")}.`,
        });
      }
      return;
    }

    case "region": {
      // Polymorphic cell — 8 kinds (kpi/chart/table/text/bullets/image/code/quote).
      // Shallow validation here (kind enum + per-kind required-field check);
      // deep shape enforcement happens at render time.
      const REGION_KINDS = ["kpi", "chart", "table", "text", "bullets", "image", "code", "quote", "sparkline", "progress"];
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} expected a region object: { kind: ${REGION_KINDS.map((k) => `"${k}"`).join("|")}, ... }.` });
        return;
      }
      const v = value as Record<string, unknown>;
      const kind = v.kind;
      if (typeof kind !== "string" || !REGION_KINDS.includes(kind)) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.kind must be one of ${REGION_KINDS.map((k) => `"${k}"`).join(", ")}.` });
        return;
      }
      // Per-kind required-field check.
      const missing: Record<string, string[]> = {
        kpi:       ["value", "label"],
        chart:     ["chart"],
        table:     ["table"],
        text:      ["body"],
        bullets:   ["items"],
        image:     ["image"],
        code:      ["code"],
        quote:     ["text"],
        sparkline: ["values"],
        progress:  ["value"],
      };
      const need = missing[kind] ?? [];
      for (const field of need) {
        if (!(field in v) || v[field] === undefined || v[field] === null) {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} (kind="${kind}") is missing required field "${field}".` });
        }
      }
      // Specific shape spot-checks (cheap, agent-actionable).
      if (kind === "bullets" && "items" in v && !Array.isArray(v.items)) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} (kind="bullets").items must be a string[].` });
      }
      if (kind === "code" && "code" in v && typeof v.code !== "string") {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} (kind="code").code must be a string.` });
      }
      if (kind === "sparkline" && "values" in v) {
        if (!Array.isArray(v.values) || v.values.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} (kind="sparkline").values must be number[].` });
        }
      }
      if (kind === "progress" && "value" in v) {
        if (typeof v.value !== "number" || v.value < 0 || v.value > 1) {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} (kind="progress").value must be a number 0..1.` });
        }
      }
      return;
    }
  }
}

const CHART_TYPES = ["bar", "stacked-bar", "line", "area", "pie", "doughnut", "combo", "scatter", "waterfall"] as const;
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

  const isScatter = type === "scatter";
  const isCombo = type === "combo";
  series.forEach((s, i) => {
    if (typeof s !== "object" || s === null) {
      out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.data.series[${i}] must be { name, values }.` });
      return;
    }
    if (typeof (s as { name?: unknown }).name !== "string") {
      out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.data.series[${i}].name is required (string).` });
    }
    const seriesType = (s as { type?: unknown }).type;
    if (isCombo) {
      if (seriesType !== undefined && seriesType !== "bar" && seriesType !== "line") {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.data.series[${i}].type must be "bar" or "line" for combo charts.` });
      }
    } else if (seriesType !== undefined) {
      out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.data.series[${i}].type is only valid when chart type is "combo".` });
    }
    if (isScatter) {
      const points = (s as { points?: unknown }).points;
      if (points !== undefined) {
        if (!Array.isArray(points) || points.some((p) => typeof p !== "object" || p === null || typeof (p as { x?: unknown }).x !== "number" || typeof (p as { y?: unknown }).y !== "number")) {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.data.series[${i}].points must be Array<{ x: number; y: number }>.` });
        }
        return; // scatter with points doesn't need values[]
      }
    }
    const values = (s as { values?: unknown }).values;
    const isWaterfall = type === "waterfall";
    const valuesValid = Array.isArray(values) && values.every((n) => {
      if (typeof n === "number" && Number.isFinite(n)) return true;
      // Waterfall-only escape hatch: `null` marks a "total" bar.
      return isWaterfall && n === null;
    });
    if (!valuesValid) {
      out.push({
        ...ctx,
        code: "SLOT_TYPE_MISMATCH",
        message: isWaterfall
          ? `${slotPath(ctx)}.data.series[${i}].values must be Array<number | null> (null marks a 'total' bar).`
          : `${slotPath(ctx)}.data.series[${i}].values must be number[].`,
      });
      return;
    }
    if (!isScatter && labelCount !== null && (values as unknown[]).length !== labelCount) {
      out.push({
        ...ctx,
        code: "SLOT_LENGTH_MISMATCH",
        message:
          `${slotPath(ctx)}.data.series[${i}].values has ${(values as unknown[]).length} items but data.labels has ${labelCount}. ` +
          `Each series's values[] must align 1:1 with labels[].`,
        hint: `Pad/truncate values to length ${labelCount} or add/remove labels to match.`,
      });
    }
  });

  // Annotations — optional list of { at? | range?, label, style? }.
  const annotations = value["annotations"];
  if (annotations !== undefined) {
    if (!Array.isArray(annotations)) {
      out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.annotations must be an array.` });
    } else {
      const STYLES = ["callout", "marker", "band"];
      annotations.forEach((a, i) => {
        if (typeof a !== "object" || a === null || Array.isArray(a)) {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.annotations[${i}] must be an object.` });
          return;
        }
        const o = a as Record<string, unknown>;
        if (typeof o.label !== "string") {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.annotations[${i}].label is required (string).` });
        }
        if (o.at === undefined && o.range === undefined) {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.annotations[${i}] must include either "at" (number) or "range" ([start, end]).` });
        }
        if (o.at !== undefined && typeof o.at !== "number") {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.annotations[${i}].at must be a number.` });
        }
        if (o.range !== undefined && (!Array.isArray(o.range) || o.range.length !== 2 || o.range.some((n) => typeof n !== "number"))) {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.annotations[${i}].range must be [start, end] of two numbers.` });
        }
        if (o.style !== undefined && (typeof o.style !== "string" || !STYLES.includes(o.style))) {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.annotations[${i}].style must be one of ${STYLES.join(", ")}.` });
        }
      });
    }
  }
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
