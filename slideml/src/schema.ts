/**
 * Build a JSON Schema (Draft 2020-12) describing the SlideML document
 * grammar. The schema covers:
 *
 *   - Top-level shape (`slideml`, `deck`, `slides`)
 *   - Deck-level fields (size, language, theme, header, footer, background)
 *   - Per-slide fields (layout, chrome, notes, slots, per-slide overrides)
 *   - All 9 slot types with their constraints
 *   - Per-layout slot validation via `if/then/else` keyed on `layout` value
 *
 * The generator walks the live LAYOUT_REGISTRY so the schema can never
 * drift from the code. Run `slideml schema -o slideml.schema.json` to
 * regenerate the on-disk copy after layout changes.
 */

import { LAYOUT_REGISTRY, type RegisteredLayout } from "./layouts/_registry.js";
import type { SlotSchema } from "./theme/types.js";

const HEX6_PATTERN = "^[0-9A-Fa-f]{6}$";

export function buildSlidemlSchema(): Record<string, unknown> {
  const allLayoutNames = [...LAYOUT_REGISTRY.keys()].sort();

  // For each layout, build an `if/then` clause that constrains `slots`
  // when `layout` equals that name.
  const layoutBranches = allLayoutNames.map((name) => {
    const layout = LAYOUT_REGISTRY.get(name)!;
    return {
      if: { properties: { layout: { const: name } } },
      then: {
        properties: {
          slots: slotsObjectSchema(layout),
        },
      },
    };
  });

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://slideml.dev/slideml.schema.json",
    title: "SlideML",
    description:
      "SlideML — typed YAML language that compiles to .pptx. " +
      "A document declares a deck (palette/fonts/chrome) and a list of slides; " +
      "each slide picks a layout from the SlideML core registry and fills its slots. " +
      "Generated from the live layout registry; do not hand-edit.",
    type: "object",
    required: ["slideml", "deck", "slides"],
    additionalProperties: false,
    properties: {
      slideml: {
        description: "Schema version. Accept either the number 1 or the string \"1\".",
        oneOf: [{ const: 1 }, { const: "1" }],
      },
      deck: { $ref: "#/$defs/Deck" },
      slides: {
        type: "array",
        minItems: 1,
        items: { $ref: "#/$defs/Slide" },
      },
    },
    $defs: {
      Deck: {
        type: "object",
        required: ["size", "theme"],
        additionalProperties: false,
        properties: {
          size: {
            description: "Slide size preset.",
            enum: ["16x9", "16x10", "4x3", "wide"],
          },
          language: {
            description: "BCP-47 language tag. CJK locales (zh-*, ja-*, ko-*) trigger the CJK font fallback.",
            type: "string",
          },
          theme: {
            description:
              "Theme name. The agent reads the named theme's advice (palette, imagery, voice) when authoring; " +
              "the renderer reads `palette`/`fonts`/`style` blocks below if present, otherwise falls back to the " +
              "named theme's tokens. Built-in: technical-blue, editorial-warm, midnight-executive, forest-moss, " +
              "charcoal-minimal. Custom themes can live under ~/.cowork/themes/<name>/.",
            type: "string",
          },
          // ── Phase-B fields (deck inlines its own visual identity) ─────
          // These let a deck be self-contained — renderer doesn't need
          // the named theme to be installed if these are present.
          palette: {
            description:
              "Brand palette — token name → 6-char hex (no #). Required tokens: bg-canvas, bg-card, " +
              "brand-primary, brand-deep, text-strong, text-muted, accent, divider. Custom token names " +
              "are allowed but only the standard set is consumed by built-in layouts.",
            type: "object",
            additionalProperties: { type: "string", pattern: HEX6_PATTERN },
            properties: {
              "bg-canvas":     { type: "string", pattern: HEX6_PATTERN },
              "bg-card":       { type: "string", pattern: HEX6_PATTERN },
              "brand-primary": { type: "string", pattern: HEX6_PATTERN },
              "brand-deep":    { type: "string", pattern: HEX6_PATTERN },
              "text-strong":   { type: "string", pattern: HEX6_PATTERN },
              "text-muted":    { type: "string", pattern: HEX6_PATTERN },
              "accent":        { type: "string", pattern: HEX6_PATTERN },
              "divider":       { type: "string", pattern: HEX6_PATTERN },
            },
          },
          fonts: {
            description: "Font family names by role. Each role accepts a single family or an ordered fallback list.",
            type: "object",
            additionalProperties: false,
            properties: {
              latin: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, minItems: 1 }] },
              cjk:   { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, minItems: 1 }] },
              mono:  { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, minItems: 1 }] },
            },
          },
          style: {
            description: "Theme-style flags consumed by primitives.",
            type: "object",
            additionalProperties: false,
            properties: {
              titleAccentRule: {
                description: "Whether slideTitle() draws the brand accent rule under titles. Default true.",
                type: "boolean",
              },
              contrastTarget: {
                description: "WCAG contrast enforcement at theme load.",
                enum: ["warn", "AA", "AAA"],
              },
            },
          },
          oxml: {
            description:
              "OOXML scheme overrides written to theme1.xml (so PowerPoint's color picker reflects the brand). " +
              "Values reference token names from `palette`.",
            type: "object",
            additionalProperties: false,
            properties: {
              clrScheme: {
                type: "object",
                additionalProperties: false,
                required: ["bg1", "tx1", "bg2", "tx2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"],
                properties: {
                  bg1:     { type: "string" }, tx1:     { type: "string" },
                  bg2:     { type: "string" }, tx2:     { type: "string" },
                  accent1: { type: "string" }, accent2: { type: "string" },
                  accent3: { type: "string" }, accent4: { type: "string" },
                  accent5: { type: "string" }, accent6: { type: "string" },
                  hlink:   { type: "string" }, folHlink: { type: "string" },
                },
              },
              fontScheme: {
                type: "object",
                additionalProperties: false,
                properties: {
                  majorLatin: { type: "string" },
                  minorLatin: { type: "string" },
                },
              },
            },
          },
          chrome: {
            description: "Names of chrome modules to enable for every slide unless suppressed by `slide.chrome`.",
            type: "array",
            items: { enum: ["page-header", "page-footer", "page-number", "brand-bar"] },
          },
          // ── End Phase-B fields ────────────────────────────────────────
          defaults: {
            description: "Token-name → token-name remappings (informational; renderer ignores).",
            type: "object",
            additionalProperties: { type: "string" },
          },
          header: { $ref: "#/$defs/BandSpec" },
          footer: { $ref: "#/$defs/BandSpec" },
          background: { $ref: "#/$defs/BackgroundSpec" },
        },
      },

      Slide: {
        description: "One slide. `layout` selects the renderer; `slots` carries content.",
        type: "object",
        required: ["layout", "slots"],
        additionalProperties: false,
        properties: {
          layout: {
            description:
              "Layout name from the SlideML core registry. The enum is closed by design — themes do NOT add layouts. " +
              "Extension contract: if you need a layout that doesn't exist here, do NOT invent a name (the renderer " +
              "will reject unknown layouts). Instead pick the closest existing layout and embed bespoke content via " +
              "a `component-ref` slot. New layouts are added to the SlideML core after community review, then become " +
              "available everywhere.",
            enum: allLayoutNames,
          },
          chrome: { $ref: "#/$defs/ChromeSpec" },
          notes: {
            description: "Speaker notes for this slide (plain text).",
            type: "string",
          },
          transition: {
            description: "Slide transition (currently informational; not emitted to OOXML).",
            enum: ["none", "fade"],
          },
          slots: {
            type: "object",
            description: "Per-layout slot map. Constraints below depend on the chosen `layout`.",
          },
          header:     { oneOf: [{ $ref: "#/$defs/BandSpec" },       { type: "null" }] },
          footer:     { oneOf: [{ $ref: "#/$defs/BandSpec" },       { type: "null" }] },
          background: { oneOf: [{ $ref: "#/$defs/BackgroundSpec" }, { type: "null" }] },
        },
        allOf: layoutBranches,
      },

      BandSpec: {
        description: "Header / footer band content. A bare string is shorthand for `{ left }`.",
        oneOf: [
          { type: "string" },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              left:   { type: "string" },
              center: { type: "string" },
              right:  { type: "string" },
            },
          },
        ],
      },

      BackgroundSpec: {
        description: "Slide background. Either a solid color or an embedded image.",
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["color"],
            properties: { color: { type: "string", pattern: HEX6_PATTERN } },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["image"],
            properties: {
              image: {
                type: "object",
                required: ["src"],
                additionalProperties: false,
                properties: {
                  src:     { type: "string", description: "Path, http(s) URL, or data: URL." },
                  alt:     { type: "string" },
                  opacity: { type: "number", minimum: 0, maximum: 1 },
                },
              },
            },
          },
        ],
      },

      ChromeSpec: {
        description:
          "Chrome control. \"default\" applies all enabled chrome modules; \"none\" suppresses them all; " +
          "the object form lets a slide selectively disable individual modules.",
        oneOf: [
          { const: "default" },
          { const: "none" },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              header:     { type: "boolean" },
              footer:     { type: "boolean" },
              brandBar:   { type: "boolean" },
              pageNumber: { type: "boolean" },
            },
          },
        ],
      },

      ImageRef: {
        description:
          "Image reference. CANONICAL form: `{ src, alt?, aspectRatio?, fit? }`. " +
          "Two alternate forms are accepted for ergonomics: a bare path/URL string (auto-wrapped to `{ src }`), " +
          "and `{ url, ... }` where `url` is a deprecated alias for `src` (kept for compatibility). " +
          "Prefer `src` in new content.",
        oneOf: [
          { type: "string", minLength: 1, description: "Bare path / URL — auto-wrapped to { src }." },
          {
            type: "object",
            properties: {
              src: {
                description: "Canonical. Path, http(s) URL, or data: URL.",
                type: "string",
              },
              url: {
                description: "Deprecated alias for `src`. Prefer `src`.",
                type: "string",
                deprecated: true,
              },
              alt: { type: "string" },
              fit: {
                enum: ["contain", "cover", "crop"],
                description: "How the image fits its bounding box. Default `cover`.",
              },
              aspectRatio: {
                description:
                  "Optional intrinsic aspect ratio (width / height) of the source image. " +
                  "Lets the renderer reserve space accurately and lets image_gen size the output to match. " +
                  "Common values: 1.778 (16:9), 1.0 (square), 0.75 (3:4 portrait).",
                type: "number",
                exclusiveMinimum: 0,
              },
            },
            anyOf: [{ required: ["src"] }, { required: ["url"] }],
          },
        ],
      },

      ChartSpec: {
        description:
          "Chart specification. CROSS-FIELD CONSTRAINT (enforced by the SlideML compiler, not by JSON Schema): " +
          "every series's `values` array MUST have the same length as `data.labels`. JSON Schema cannot express " +
          "this directly — the compiler raises SLOT_TYPE_MISMATCH if labels.length ≠ values.length. " +
          "Pie / doughnut charts use only the first series.",
        type: "object",
        required: ["type", "data"],
        additionalProperties: false,
        properties: {
          type: { enum: ["bar", "stacked-bar", "line", "area", "pie", "doughnut"] },
          data: {
            type: "object",
            required: ["labels", "series"],
            additionalProperties: false,
            properties: {
              labels: { type: "array", items: { type: "string" } },
              series: {
                type: "array",
                minItems: 1,
                items: {
                  type: "object",
                  required: ["name", "values"],
                  additionalProperties: false,
                  properties: {
                    name:   { type: "string" },
                    values: {
                      type: "array",
                      items: { type: "number" },
                      description: "Length MUST equal data.labels.length (compiler-enforced).",
                    },
                  },
                },
              },
            },
          },
          format: {
            description: "Y-axis number format. MUST be an object — bare strings are rejected.",
            type: "object",
            additionalProperties: false,
            properties: {
              y: { enum: ["int", "decimal", "percent", "wanyuan", "yi"] },
            },
          },
          title: { type: "string" },
        },
      },

      TableSpec: {
        type: "object",
        required: ["header", "rows"],
        additionalProperties: false,
        properties: {
          header:    { type: "array", items: { type: "string" } },
          rows:      { type: "array", items: { type: "array", items: { type: "string" } } },
          colWidths: { type: "array", items: { type: "number", minimum: 0 } },
        },
      },

      Region: {
        description:
          "Polymorphic dashboard cell. `kind` picks the shape: kpi | chart | table | text.",
        oneOf: [
          {
            type: "object",
            required: ["kind", "value", "label"],
            additionalProperties: false,
            properties: {
              kind:  { const: "kpi" },
              value: { type: "string" },
              label: { type: "string" },
              delta: { type: "string" },
              trend: { enum: ["up", "down", "flat"] },
            },
          },
          {
            type: "object",
            required: ["kind", "chart"],
            additionalProperties: false,
            properties: {
              kind:  { const: "chart" },
              title: { type: "string" },
              chart: { $ref: "#/$defs/ChartSpec" },
            },
          },
          {
            type: "object",
            required: ["kind", "table"],
            additionalProperties: false,
            properties: {
              kind:  { const: "table" },
              title: { type: "string" },
              table: { $ref: "#/$defs/TableSpec" },
            },
          },
          {
            type: "object",
            required: ["kind", "body"],
            additionalProperties: false,
            properties: {
              kind:  { const: "text" },
              title: { type: "string" },
              body:  {
                description: "Text body. Accepts a string OR a string[] joined with paragraph breaks.",
                oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
              },
            },
          },
        ],
      },

      ComponentRef: {
        type: "object",
        required: ["name"],
        additionalProperties: false,
        properties: {
          name:  { type: "string" },
          slots: { type: "object" },
        },
      },
    },
  };
}

/**
 * Build the JSON Schema for the `slots` object of a single layout —
 * one property per declared slot, with constraints derived from the
 * SlotSchema variant.
 */
function slotsObjectSchema(layout: RegisteredLayout): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [slotName, schema] of Object.entries(layout.slots)) {
    properties[slotName] = slotSchemaFragment(slotName, schema);
    if (!schema.optional) required.push(slotName);
  }
  return {
    type: "object",
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

/** Convert one SlotSchema variant to a JSON Schema fragment. */
function slotSchemaFragment(slotName: string, schema: SlotSchema): Record<string, unknown> {
  switch (schema.type) {
    case "text":
      return { type: "string", maxLength: schema.maxChars, description: `Single-line text, ≤ ${schema.maxChars} chars.` };
    case "text-block":
      return {
        description: `Multi-line text, ≤ ${schema.maxChars} chars. Accepts a string OR a string[] joined with paragraph breaks.`,
        oneOf: [
          { type: "string", maxLength: schema.maxChars },
          { type: "array", items: { type: "string" } },
        ],
      };
    case "markdown-inline":
      return {
        type: "string",
        maxLength: schema.maxChars,
        description: `Inline markdown, ≤ ${schema.maxChars} chars. Supports **bold**, *italic*, \`code\` only.`,
      };
    case "bullets": {
      // Item shape varies per layout. Use slot-name heuristics that mirror
      // the runtime examples in src/slot-examples.ts.
      const items = bulletsItemSchema(slotName, schema);
      return {
        type: "array",
        minItems: schema.min,
        maxItems: schema.max,
        items,
        description: `${schema.min}–${schema.max} items, each ≤ ${schema.itemMaxChars} chars when string-shaped.`,
      };
    }
    case "image-ref":
      return { $ref: "#/$defs/ImageRef" };
    case "chart-spec":
      return { $ref: "#/$defs/ChartSpec" };
    case "table":
      return { $ref: "#/$defs/TableSpec" };
    case "component-ref":
      return {
        $ref: "#/$defs/ComponentRef",
        ...(schema.allowed ? { /* note: $ref siblings are limited; document via description */ } : {}),
      };
    case "region":
      return { $ref: "#/$defs/Region" };
  }
}

/**
 * Pick the right item-shape for a `bullets` slot based on the slot name.
 * Mirrors the runtime examples returned by describeLayout(). Strings are
 * always accepted; some named slots accept richer object shapes too.
 */
function bulletsItemSchema(slotName: string, schema: { itemMaxChars: number }): Record<string, unknown> {
  // KPI tile items (stat-grid-3): { value, label, delta?, trend? }
  if (slotName === "items" && schema.itemMaxChars <= 64) {
    return {
      oneOf: [
        { type: "string", maxLength: schema.itemMaxChars },
        {
          type: "object",
          required: ["value", "label"],
          additionalProperties: false,
          properties: {
            value: { type: "string" },
            label: { type: "string" },
            delta: { type: "string" },
            trend: { enum: ["up", "down", "flat"] },
          },
        },
      ],
    };
  }
  // Image grid cells (image-grid-2x2): { src OR url, alt?, caption? }
  if (slotName === "images") {
    return {
      oneOf: [
        { type: "string" }, // bare path/URL also accepted
        {
          type: "object",
          properties: {
            src:     { type: "string" },
            url:     { type: "string" },
            alt:     { type: "string" },
            caption: { type: "string" },
            fit:     { enum: ["contain", "cover"] },
          },
          anyOf: [{ required: ["src"] }, { required: ["url"] }],
        },
      ],
    };
  }
  // Process timeline steps: string OR { title, description? }
  if (slotName === "steps") {
    return {
      oneOf: [
        { type: "string", maxLength: schema.itemMaxChars },
        {
          type: "object",
          properties: {
            title:       { type: "string" },
            label:       { type: "string" },
            description: { type: "string" },
            text:        { type: "string" },
          },
        },
      ],
    };
  }
  // Default: plain string with maxChars.
  return { type: "string", maxLength: schema.itemMaxChars };
}
