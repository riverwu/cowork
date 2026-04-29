/**
 * SlideML validator.
 *
 * Validates each slide's `slots` block against the layout's `slots` schema
 * and produces structured `SlidemlError`s. Errors point at
 * `slides[N].slots.<slot>` so callers can wire them into the agent loop.
 */

import type { DeckSpec, SlideSpec } from "./render/index.js";
import type { LoadedTheme, SlotSchema } from "./theme/types.js";
import { maxCharBudget } from "./render/density.js";

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

/**
 * Layout-level budget multiplier on top of the half-column max char
 * budget (which already includes autoFit headroom).
 *   half-column layouts (visual-with-text, …) → 1.0
 *   prose with columns: 1 (default) → 1.5 (single full-width column)
 *   prose with columns: 2            → 3.0 (full width × 2 columns)
 *   letter (full-width body, generous margins, slightly narrower) → 1.3
 *
 * Layouts not in this map fall back to 1.0.
 */
function layoutBudgetMultiplier(layout: string, slots?: Record<string, unknown>): number {
  if (layout === "prose") {
    const cols = slots && (slots["columns"] === "2" || slots["columns"] === 2) ? 2 : 1;
    return cols === 2 ? 3.0 : 1.5;
  }
  if (layout === "letter") return 1.3;
  return 1.0;
}

function effectiveBudget(
  layout: string,
  cjk: boolean,
  slots?: Record<string, unknown>,
): number {
  return Math.round(maxCharBudget(cjk) * layoutBudgetMultiplier(layout, slots));
}

function isTitleLikeTextSlot(slot: string | undefined): boolean {
  return slot === "title" || slot === "subtitle" || slot === "eyebrow" ||
    slot === "leftTitle" || slot === "rightTitle" || slot === "xLabel" ||
    slot === "yLabel" || slot === "term" || slot === "label" ||
    slot === "signature" || slot === "signRole" || slot === "recipient";
}

function cjkAdjustedMax(schemaMax: number, cjk: boolean, slot?: string): number {
  // Fixed-height titles/labels should not receive the 1.6x prose budget
  // boost: their render boxes do not get taller, so long CJK titles would
  // validate then clip or shrink to unreadable sizes.
  if (!cjk || isTitleLikeTextSlot(slot)) return schemaMax;
  return Math.round(schemaMax * CJK_BUDGET_MULTIPLIER);
}

/**
 * Build a remediation hint when an item-count exceeds a `bullets` slot's
 * `max`. Lists alternative layouts in the loaded theme whose primary
 * bullets slot can hold AT LEAST `count` items, ordered by smallest-
 * sufficient first (closest match). Always tells the agent the silent-
 * trim anti-pattern is wrong, and suggests splitting across slides
 * when no single layout fits.
 *
 * Why this matters: when key-point's max=4 fires on 7 items, the
 * default LLM behaviour is to silently drop 3 items — the user never
 * sees them. Surfacing concrete alternatives + the split option pushes
 * the agent toward preserving content.
 */
function bulletCountOverflowHint(
  theme: LoadedTheme,
  currentLayout: string,
  currentSlot: string,
  count: number,
  currentMax: number,
): string {
  const candidates: Array<{ layout: string; slot: string; max: number }> = [];
  for (const [layoutName, loaded] of theme.layouts) {
    if (layoutName === currentLayout) continue;
    for (const [slotName, schema] of Object.entries(loaded.slots)) {
      if (schema.type === "bullets" && schema.max >= count) {
        candidates.push({ layout: layoutName, slot: slotName, max: schema.max });
      }
    }
  }
  // Smallest-sufficient first — closer matches lead.
  candidates.sort((a, b) => a.max - b.max);
  const top = candidates.slice(0, 4)
    .map((c) => `"${c.layout}" (${c.slot}, max ${c.max})`)
    .join(", ");
  const splits = Math.ceil(count / currentMax);
  const suggestions: string[] = [
    `DO NOT silently drop items — the user expected all ${count} to appear.`,
  ];
  if (top) {
    suggestions.push(`Switch layout to one with higher capacity: ${top}.`);
  }
  suggestions.push(
    `Or split into ${splits} slides of "${currentLayout}" (≤${currentMax} items each), giving each section a continuation title.`,
  );
  return suggestions.join(" ");
}

/**
 * Build a concrete next-step hint when SLOT_OVERFLOW fires on a text-
 * block. Tries `prose` (1 column) first, then `prose` with columns: 2,
 * then recommends splitting the slide. All capacities are reported as
 * the *single* maxChars ceiling (already autoFit-aware).
 */
function nextLayoutForOverflow(
  currentLayout: string,
  charCount: number,
  cjk: boolean,
  currentMax: number,
): string {
  const proseMax = effectiveBudget("prose", cjk);
  const twoColProseMax = effectiveBudget("prose", cjk, { columns: "2" });
  if (currentLayout !== "prose" && charCount <= proseMax) {
    return `Switch layout to "prose" — capacity ~${proseMax} ${cjk ? "CJK" : "latin"} chars (vs current ${currentMax}).`;
  }
  if (charCount <= twoColProseMax) {
    return `Switch layout to "prose" with columns: 2 — capacity ~${twoColProseMax} ${cjk ? "CJK" : "latin"} chars.`;
  }
  return `Content (${charCount} chars) exceeds even prose with columns: 2 (~${twoColProseMax}). Split this slot across multiple slides.`;
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

  validateLayoutCrossSlotRules(slide, index, out);

  // (chart-with-takeaway misuse check removed: that layout was folded
  // into visual-with-caption with the polymorphic `visual` slot — agents
  // now pass any visual kind to the same layout, so the kind-mismatch
  // problem this hint guarded against no longer exists.)
}

function validateLayoutCrossSlotRules(
  slide: SlideSpec,
  index: number,
  out: SlidemlValidationError[],
): void {
  if (slide.layout === "dashboard") {
    const cells = slide.slots["cells"];
    const named = ["tl", "tr", "bl", "br"].filter((k) => slide.slots[k] !== undefined && slide.slots[k] !== null);
    if (!Array.isArray(cells) && named.length < 2) {
      out.push({
        code: "SLOT_REQUIRED",
        slideIndex: index,
        layout: slide.layout,
        slot: "cells",
        message: `slides[${index}].slots must provide dashboard "cells" (2-8 regions) or at least two of tl/tr/bl/br.`,
        hint: `Prefer cells: [{ kind: ... }, ...] for variable dashboards; use tl/tr/bl/br only for a fixed 2x2 dashboard.`,
      });
    }
  }
  if (slide.layout === "split") {
    const cells = slide.slots["cells"] === "3" ? 3 : 2;
    if (cells === 3 && (slide.slots["cell3"] === undefined || slide.slots["cell3"] === null)) {
      out.push({
        code: "SLOT_REQUIRED",
        slideIndex: index,
        layout: slide.layout,
        slot: "cell3",
        message: `slides[${index}].slots.cell3 is required when split.cells is "3".`,
        hint: `Use cells: "2" for a two-region split, or provide cell3 for a three-region split.`,
      });
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
        const effectiveMax = cjkAdjustedMax(schema.maxChars, cjk, ctx.slot);
        if ([...value].length > effectiveMax) {
          // Include the offending VALUE so the agent sees what it's trimming.
          out.push({
            ...ctx,
            code: "SLOT_OVERFLOW",
            message: `${slotPath(ctx)} is ${[...value].length} chars, exceeds maxChars ${effectiveMax}. Current value: ${quote(value)}`,
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
      // Single MAX char ceiling per slot, sized to densest readable
      // preset × autoFit headroom. Render-time autoFit absorbs spillover
      // up to ~+40%; anything beyond that gets SLOT_OVERFLOW with a
      // hint to split the slide or pick a denser layout.
      const cjkNote = cjk ? ` (CJK)` : "";
      let total = 0;
      // Visible-line count: every non-empty source line takes vertical space
      // when rendered (single \n inside a paragraph still forces a line
      // break, e.g. when the agent inlines a `· bullet` list inside one
      // text-block paragraph). Char count alone misses this — a 200-char
      // body with 8 short bullets overflows where 200 chars of one
      // paragraph would fit. Track lines so layouts that declare
      // `maxLines` can flag it before render.
      let visibleLines = 0;
      const countLinesInString = (s: string): number =>
        s.split("\n").map((l) => l.trim()).filter(Boolean).length;
      let bad = false;
      let preview = "";
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") {
            total += [...item].length + 2;
            visibleLines += countLinesInString(item);
            if (!preview && item.length > 0) preview = item.slice(0, 60);
          } else if (item && typeof item === "object" && !Array.isArray(item)) {
            const o = item as { kind?: unknown; text?: unknown };
            if (typeof o.text !== "string") { bad = true; break; }
            if (o.kind !== undefined && (typeof o.kind !== "string" || !PARA_KINDS.has(o.kind))) {
              bad = true; break;
            }
            total += [...o.text].length + 2;
            visibleLines += countLinesInString(o.text);
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
        visibleLines = countLinesInString(value);
        preview = value.slice(0, 60);
      }
      if (bad) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} accepts string | string[] | Array<string | { kind: 'quote'|'note'|'callout'|'h2', text: string }>.` });
        return;
      }
      // (DENSITY_OVERFLOW removed — there's no density slot anymore.
      // The single maxChars ceiling below already accounts for autoFit
      // headroom; anything beyond that needs a layout switch / split.)
      // Visible-line ceiling — catches multi-paragraph or inline-list
      // content that fits the char cap but overflows the box vertically.
      // Layouts opt in by declaring `maxLines`; without it this check is
      // skipped (back-compat with layouts that haven't been calibrated).
      if (schema.maxLines !== undefined && visibleLines > schema.maxLines) {
        out.push({
          ...ctx,
          code: "SLOT_OVERFLOW",
          message: `${slotPath(ctx)} has ${visibleLines} visible lines, exceeds maxLines ${schema.maxLines} for layout "${ctx.layout}". Char count was ${total} (${cjk ? "CJK" : "Latin"}).`,
          hint: `Trim to ≤${schema.maxLines} non-empty lines (collapse inline lists into prose, or split each ·/- bullet into its own paragraph and switch to a layout with a bullets slot — e.g. prose / executive-summary / key-point).`,
        });
        return;
      }
      // Single maxChars ceiling — already includes autoFit headroom.
      // Anything past this WILL clip even after autoFit shrinks fonts,
      // so the only remedies are split-the-slide or pick a layout with
      // more capacity (prose / prose+columns:2).
      const effectiveMax = schema.maxChars !== undefined
        ? Math.min(cjkAdjustedMax(schema.maxChars, cjk, ctx.slot), effectiveBudget(ctx.layout!, cjk, slideSlots))
        : undefined;
      if (effectiveMax !== undefined && total > effectiveMax) {
        out.push({
          ...ctx,
          code: "SLOT_OVERFLOW",
          message: `${slotPath(ctx)} is ${total} chars, exceeds maxChars ${effectiveMax}${cjkNote} (autoFit cannot rescue values past this ceiling without making text unreadable). First 60 chars: ${quote(preview)}`,
          hint: nextLayoutForOverflow(ctx.layout!, total, cjk, effectiveMax),
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
        out.push({
          ...ctx,
          code: "SLOT_OVERFLOW",
          message: `${slotPath(ctx)} has ${value.length} items, exceeds max ${schema.max} for layout "${ctx.layout}".`,
          hint: bulletCountOverflowHint(theme, ctx.layout!, ctx.slot!, value.length, schema.max),
        });
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

    case "visual": {
      // Polymorphic: image | chart | table | svg. Accepts either tagged
      // (`{ kind: ..., ... }`) or legacy un-tagged (image-ref / chart-spec
      // / table) shapes — render/visual.ts coerceVisual mirrors this.
      const VISUAL_KINDS = ["image", "chart", "table", "svg"];
      if (typeof value === "string" && value.length > 0) return; // bare path → image
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        out.push({
          ...ctx,
          code: "SLOT_TYPE_MISMATCH",
          message: `${slotPath(ctx)} expected a visual: { kind: "image" | "chart" | "table" | "svg", ... } or a legacy image-ref / chart-spec / table object.`,
        });
        return;
      }
      const v = value as Record<string, unknown>;
      // Tagged form: validate by kind.
      if (typeof v.kind === "string") {
        if (!VISUAL_KINDS.includes(v.kind)) {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.kind must be one of ${VISUAL_KINDS.map((k) => `"${k}"`).join(", ")}.` });
          return;
        }
        if (v.kind === "image" && typeof v.src !== "string") {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} (kind="image") requires src: string.` });
        }
        if (v.kind === "svg" && typeof v.svg !== "string") {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} (kind="svg") requires svg: string.` });
        }
        if (v.kind === "chart") {
          // Tagged form uses `chartType`; reuse the existing chart-spec
          // validator (which expects `type`) by remapping. This gives us
          // the cross-field labels.length === series.values.length check
          // for free.
          if (typeof v.chartType !== "string") {
            out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} (kind="chart") requires chartType: "bar" | "line" | "pie" | …` });
          } else {
            const legacy = { type: v.chartType, data: v.data, format: v.format, title: v.title, annotations: v.annotations };
            validateChartSpec(legacy as Record<string, unknown>, ctx, out);
          }
        }
        if (v.kind === "table") {
          validateTableSpec(v, ctx, out, { maxRows: 10, maxCols: 8, cellMaxChars: 100 });
        }
        return;
      }
      // Un-tagged: sniff and route to existing validators.
      if (typeof v.src === "string") return; // image-ref shape
      if (typeof v.svg === "string") return; // svg shape
      if (Array.isArray(v.header) && Array.isArray(v.rows)) {
        validateTableSpec(v, ctx, out, { maxRows: 10, maxCols: 8, cellMaxChars: 100 });
        return;
      }
      if (typeof v.type === "string" && v.data && typeof v.data === "object") {
        validateChartSpec(v, ctx, out);
        return;
      }
      out.push({
        ...ctx,
        code: "SLOT_TYPE_MISMATCH",
        message: `${slotPath(ctx)} did not match any visual shape. Use { kind: "image"|"chart"|"table"|"svg", ... } or a legacy image-ref / chart-spec / table object.`,
      });
      return;
    }

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
      validateTableSpec(value as Record<string, unknown>, ctx, out, {
        maxRows: schema.maxRows ?? 12,
        maxCols: schema.maxCols ?? 8,
        cellMaxChars: schema.cellMaxChars ?? 120,
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
      validateRegionValue(v, ctx, out);
      return;
    }

    case "region-list": {
      if (!Array.isArray(value)) {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} expected an array of region objects, got ${typeOf(value)}.` });
        return;
      }
      if (value.length < schema.min) {
        out.push({ ...ctx, code: "SLOT_UNDERFLOW", message: `${slotPath(ctx)} has ${value.length} cells, fewer than min ${schema.min}.` });
      }
      if (value.length > schema.max) {
        out.push({ ...ctx, code: "SLOT_OVERFLOW", message: `${slotPath(ctx)} has ${value.length} cells, exceeds max ${schema.max}.`, hint: `Use ${schema.min}–${schema.max} region cells, or split the dashboard across multiple slides.` });
      }
      value.forEach((item, i) => {
        validateSlotValue(item, { type: "region" }, { ...ctx, slot: `${ctx.slot}[${i}]` }, out, theme, cjk, slideSlots);
      });
      return;
    }
  }
}

const CHART_TYPES = ["bar", "stacked-bar", "line", "area", "pie", "doughnut", "combo", "scatter", "waterfall"] as const;
const Y_FORMATS = ["int", "decimal", "percent", "wanyuan", "yi"] as const;
const TABLE_EMPHASIS = new Set(["ok", "warn", "bad", "highlight", "up", "down", "flat"]);

interface TableCapacity {
  maxRows: number;
  maxCols: number;
  cellMaxChars: number;
}

function validateTableSpec(
  value: Record<string, unknown>,
  ctx: SlidemlValidationError,
  out: SlidemlValidationError[],
  cap: TableCapacity,
): void {
  const header = value.header;
  const rows = value.rows;
  if (!Array.isArray(header) || header.some((h) => typeof h !== "string")) {
    out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.header must be a string array.` });
    return;
  }
  if (header.length > cap.maxCols) {
    out.push({
      ...ctx,
      code: "SLOT_OVERFLOW",
      message: `${slotPath(ctx)}.header has ${header.length} columns, exceeds maxCols ${cap.maxCols}.`,
      hint: `Use at most ${cap.maxCols} columns, or split the table across slides.`,
    });
  }
  header.forEach((h, i) => validateCellTextLength(h, `${slotPath(ctx)}.header[${i}]`, cap.cellMaxChars, ctx, out));

  if (!Array.isArray(rows)) {
    out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.rows must be an array of row arrays.` });
    return;
  }
  if (rows.length > cap.maxRows) {
    out.push({
      ...ctx,
      code: "SLOT_OVERFLOW",
      message: `${slotPath(ctx)}.rows has ${rows.length} rows, exceeds maxRows ${cap.maxRows}.`,
      hint: `Use at most ${cap.maxRows} body rows, summarize, or split the table across slides.`,
    });
  }
  const align = value.align;
  if (align !== undefined) {
    const ALIGNS = new Set(["left", "center", "right"]);
    if (!Array.isArray(align) || align.length > cap.maxCols || align.some((a) => typeof a !== "string" || !ALIGNS.has(a))) {
      out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.align must be Array<"left" | "center" | "right"> with at most ${cap.maxCols} entries.` });
    }
  }
  const colWidths = value.colWidths;
  if (colWidths !== undefined && (!Array.isArray(colWidths) || colWidths.length > cap.maxCols || colWidths.some((n) => typeof n !== "number" || n < 0))) {
    out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.colWidths must be a non-negative number array with at most ${cap.maxCols} entries.` });
  }
  rows.forEach((row, ri) => {
    if (!Array.isArray(row)) {
      out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.rows[${ri}] must be an array of cells.` });
      return;
    }
    if (row.length > cap.maxCols) {
      out.push({ ...ctx, code: "SLOT_OVERFLOW", message: `${slotPath(ctx)}.rows[${ri}] has ${row.length} cells, exceeds maxCols ${cap.maxCols}.` });
    }
    row.forEach((cell, ci) => {
      if (typeof cell === "string" || typeof cell === "number") {
        validateCellTextLength(String(cell), `${slotPath(ctx)}.rows[${ri}][${ci}]`, cap.cellMaxChars, ctx, out);
        return;
      }
      if (cell && typeof cell === "object" && !Array.isArray(cell)) {
        const c = cell as { value?: unknown; emphasis?: unknown };
        if (c.value !== undefined && typeof c.value !== "string" && typeof c.value !== "number") {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.rows[${ri}][${ci}].value must be a string or number.` });
        }
        if (c.value !== undefined) {
          validateCellTextLength(String(c.value), `${slotPath(ctx)}.rows[${ri}][${ci}].value`, cap.cellMaxChars, ctx, out);
        }
        if (c.emphasis !== undefined && (typeof c.emphasis !== "string" || !TABLE_EMPHASIS.has(c.emphasis))) {
          out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)}.rows[${ri}][${ci}].emphasis must be one of ${[...TABLE_EMPHASIS].join(", ")}.` });
        }
      }
    });
  });
}

function validateCellTextLength(
  text: string,
  path: string,
  max: number,
  ctx: SlidemlValidationError,
  out: SlidemlValidationError[],
): void {
  if ([...text].length > max) {
    out.push({
      ...ctx,
      code: "SLOT_OVERFLOW",
      message: `${path} is ${[...text].length} chars, exceeds cellMaxChars ${max}.`,
      hint: `Trim this table cell to at most ${max} characters.`,
    });
  }
}

function validateRegionValue(v: Record<string, unknown>, ctx: SlidemlValidationError, out: SlidemlValidationError[]): void {
  const kind = v.kind;
  if (kind === "chart" && v.chart && typeof v.chart === "object" && !Array.isArray(v.chart)) {
    validateChartSpec(v.chart as Record<string, unknown>, ctx, out);
  }
  if (kind === "table" && v.table && typeof v.table === "object" && !Array.isArray(v.table)) {
    validateTableSpec(v.table as Record<string, unknown>, ctx, out, { maxRows: 6, maxCols: 5, cellMaxChars: 70 });
  }
  if (kind === "text") {
    const body = v.body;
    const total = typeof body === "string"
      ? [...body].length
      : Array.isArray(body) ? body.reduce((n, s) => n + (typeof s === "string" ? [...s].length : 0), 0) : 0;
    if (total > 420) {
      out.push({ ...ctx, code: "SLOT_OVERFLOW", message: `${slotPath(ctx)} (kind="text").body is ${total} chars, exceeds region text capacity 420.`, hint: "Use a shorter region body, switch to prose, or split into multiple cells/slides." });
    }
  }
  if (kind === "bullets" && Array.isArray(v.items)) {
    if (v.items.length > 5) {
      out.push({ ...ctx, code: "SLOT_OVERFLOW", message: `${slotPath(ctx)} (kind="bullets").items has ${v.items.length} items, exceeds region capacity 5.` });
    }
    v.items.forEach((item, i) => {
      if (typeof item !== "string") {
        out.push({ ...ctx, code: "SLOT_TYPE_MISMATCH", message: `${slotPath(ctx)} (kind="bullets").items[${i}] must be a string.` });
      } else if ([...item].length > 90) {
        out.push({ ...ctx, code: "SLOT_OVERFLOW", message: `${slotPath(ctx)} (kind="bullets").items[${i}] is ${[...item].length} chars, exceeds region bullet capacity 90.` });
      }
    });
  }
  if (kind === "code" && typeof v.code === "string") {
    const lines = v.code.split(/\r?\n/);
    if (lines.length > 12 || [...v.code].length > 480) {
      out.push({ ...ctx, code: "SLOT_OVERFLOW", message: `${slotPath(ctx)} (kind="code") exceeds region code capacity (${lines.length} lines, ${[...v.code].length} chars).`, hint: "Keep region code to <=12 short lines / <=480 chars, or use code-block." });
    }
  }
  if (kind === "quote" && typeof v.text === "string" && [...v.text].length > 220) {
    out.push({ ...ctx, code: "SLOT_OVERFLOW", message: `${slotPath(ctx)} (kind="quote").text is ${[...v.text].length} chars, exceeds region quote capacity 220.` });
  }
}

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
