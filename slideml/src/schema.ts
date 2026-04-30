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

import { LAYOUT_REGISTRY, listAgentVisibleLayoutNames, type RegisteredLayout } from "./layouts/_registry.js";
import type { SlotSchema } from "./theme/types.js";

const HEX6_PATTERN = "^[0-9A-Fa-f]{6}$";

/**
 * YAML safety rule appended to every text-bearing slot description.
 *
 * Agents repeatedly trip on the same YAML pitfalls when authoring
 * SlideML inline:
 *   - `{up:+12%}` chips → YAML parses `{...}` as a flow mapping
 *   - ASCII `: ` inside a title  → YAML splits "key: value"
 *   - `#` inside an unquoted string → YAML treats it as a comment
 *   - `[备注]` → YAML parses `[...]` as a flow sequence
 *   - multi-line strings without `|` / `>` → "implicit key may not be multiline"
 *
 * Surface the rule in the prop's own description so it shows up in
 * `describe_content_component` output and the JSON Schema description text.
 */
const YAML_QUOTING_RULE =
  "YAML SAFETY: when the value contains any of `{`, `}`, `[`, `]`, ASCII `:`, `#`, " +
  "or spans multiple lines, wrap it in double quotes — or use `|` / `>` for multi-line. " +
  "Otherwise YAML parses it as a flow mapping/sequence/comment and rendering fails with a PARSE_ERROR. " +
  "If the content itself contains ASCII `\"` (very common in CJK prose: `\"罢黜百家\"`, `\"书同文\"` etc.), " +
  "do NOT wrap the outer in `\"...\"` without escaping — pick one of: " +
  "(a) escape inner — `\\\"书同文\\\"`; (b) outer single quotes — `'...\"书同文\"...'`; " +
  "(c) inner Chinese curly quotes — `\u201C书同文\u201D`; (d) block scalar — `body: |` then content on next line.";

/**
 * Authoring rule appended to text-block slot descriptions.
 *
 * Agents (esp. LLMs trained on prose corpora) instinctively wrap long
 * sentences at ~70-80 characters with a literal `\n`, then continue the
 * SAME sentence on the next line. That `\n` becomes a HARD line break
 * in the rendered slide — wasting vertical space (every wrapped line
 * gets a ragged-short last line) and often blowing past the box.
 *
 * Within a single paragraph, content should be one continuous string
 * (no cosmetic line breaks). Use a blank line `\n\n` between paragraphs
 * only.
 */
const PARAGRAPH_AUTHORING_RULE =
  "AUTHORING: keep each paragraph on a SINGLE LINE — do NOT insert `\\n` mid-sentence " +
  "for cosmetic line wrapping (the renderer will turn each `\\n` into a hard line break, " +
  "wasting vertical space and risking overflow). Use blank lines (`\\n\\n`) ONLY between " +
  "distinct paragraphs.";

interface TableSchemaCapacity {
  maxRows: number;
  maxCols: number;
  cellMaxChars: number;
  description: string;
}

function tableSpecSchema(cap: TableSchemaCapacity): Record<string, unknown> {
  const cell = tableCellSchema(cap.cellMaxChars);
  return {
    type: "object",
    required: ["header", "rows"],
    additionalProperties: false,
    properties: {
      header: {
        type: "array",
        minItems: 1,
        maxItems: cap.maxCols,
        items: { type: "string", maxLength: cap.cellMaxChars },
      },
      rows: {
        type: "array",
        maxItems: cap.maxRows,
        items: {
          type: "array",
          minItems: 1,
          maxItems: cap.maxCols,
          items: cell,
        },
      },
      colWidths: { type: "array", minItems: 1, maxItems: cap.maxCols, items: { type: "number", minimum: 0 } },
      align: {
        type: "array",
        maxItems: cap.maxCols,
        items: { enum: ["left", "center", "right"] },
        description:
          "Per-column horizontal alignment. Index N applies to column N. " +
          "When omitted, numeric-looking strings auto-right-align and everything else left-aligns.",
      },
    },
    description: cap.description,
  };
}

function regionsSchema(componentNames: string[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: { $ref: "#/$defs/RegionContent" },
    properties: {
      main: { $ref: "#/$defs/RegionContent" },
      sidebar: { $ref: "#/$defs/RegionContent" },
      supporting: { $ref: "#/$defs/RegionContent" },
      header: { $ref: "#/$defs/RegionContent" },
      footer: { $ref: "#/$defs/RegionContent" },
      left: { $ref: "#/$defs/RegionContent" },
      right: { $ref: "#/$defs/RegionContent" },
      top: { $ref: "#/$defs/RegionContent" },
      bottom: { $ref: "#/$defs/RegionContent" },
      items: {
        type: "array",
        minItems: 1,
        items: { $ref: "#/$defs/ContentComponent" },
      },
    },
    description: `Named PagePattern regions. ContentComponent names: ${componentNames.join(", ")}.`,
  };
}

function contentComponentSchema(componentNames: string[]): Record<string, unknown> {
  return {
    type: "object",
    required: ["component"],
    additionalProperties: false,
    properties: {
      component: {
        enum: componentNames,
        description: "ContentComponent name. These replace old page layouts as reusable content blocks.",
      },
      props: {
        type: "object",
        additionalProperties: true,
        description: "Component props. Validated against the selected ContentComponent schema at compile time.",
      },
    },
  };
}

export function buildSlidemlSchema(): Record<string, unknown> {
  const allLayoutNames = listAgentVisibleLayoutNames().sort();

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://slideml.dev/slideml.schema.json",
    title: "SlideML",
    description:
      "SlideML — typed JSON/YAML language that compiles to .pptx. " +
      "A document declares a deck (theme/fonts/chrome) and a list of slides; " +
      "each slide picks a PagePattern and fills named regions with ContentComponents. " +
      "Generated from the live component registry; do not hand-edit.",
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
              "named theme's tokens. Built-in: enterprise-light, technical-blue, editorial-warm, midnight-executive, forest-moss, " +
              "charcoal-minimal, editorial-paper, academic-paper, vibrant-startup. Custom themes can live under ~/.cowork/themes/<name>/.",
            type: "string",
          },
          brand: {
            description:
              "Optional deck-level brand identity used by chrome modules such as brand-mark. " +
              "Use `palette.brand-primary` for the brand color and `brand.logo` for the logo path.",
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              color: { type: "string", description: "Theme token name or 6-char hex. Defaults to text-muted." },
              logo: {
                oneOf: [
                  { type: "string", description: "Logo path / URL / data URL." },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["src"],
                    properties: {
                      src: { type: "string" },
                      alt: { type: "string" },
                    },
                  },
                ],
              },
            },
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
            items: { enum: ["page-header", "page-footer", "page-number", "brand-bar", "brand-mark", "hairline", "progress-bar", "section-marker", "watermark"] },
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
        description: "One composed slide. `pattern` selects the page topology; `regions` carry content components.",
        type: "object",
        required: ["pattern", "regions"],
        additionalProperties: false,
        properties: {
          pattern: {
            description: "PagePattern: high-level region topology, separate from the content component.",
            enum: ["single-focus", "title-content", "main-plus-sidebar", "two-column", "hero-plus-supporting", "top-bottom", "grid", "dashboard", "full-bleed-visual", "section-divider"],
          },
          title: { type: "string", description: "Page-level title. Handling depends on the selected PagePattern titlePolicy: required/optional patterns render it as a separate page title, component patterns pass it to the main component when props.title is omitted, and none patterns reject it." },
          regions: regionsSchema(allLayoutNames),
          policy: {
            type: "object",
            additionalProperties: false,
            properties: {
              emphasis: { enum: ["main", "balanced", "visual", "data", "takeaway"] },
              density: { enum: ["sparse", "medium", "dense"] },
              overflow: { enum: ["shrink", "condense", "split", "fail"] },
            },
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
          header:     { oneOf: [{ $ref: "#/$defs/BandSpec" },       { type: "null" }] },
          footer:     { oneOf: [{ $ref: "#/$defs/BandSpec" },       { type: "null" }] },
          background: { oneOf: [{ $ref: "#/$defs/BackgroundSpec" }, { type: "null" }] },
        },
      },

      ContentComponent: contentComponentSchema(allLayoutNames),

      RegionContent: {
        oneOf: [
          { $ref: "#/$defs/ContentComponent" },
          { type: "array", minItems: 1, items: { $ref: "#/$defs/ContentComponent" } },
        ],
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
          "the object form mixes four mechanisms: legacy boolean flags (header/footer/brandBar/pageNumber), " +
          "`enable: [...]` to add modules the theme didn't pre-declare, `disable: [...]` to suppress modules " +
          "for this slide, and `override: { module: { ... } }` for per-module parameter overrides (e.g. " +
          "`override: { 'page-footer': { left: 'CONFIDENTIAL' }, 'brand-bar': { color: 'accent' } }`).",
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
              enable: {
                type: "array",
                items: { enum: ["page-header", "page-footer", "page-number", "brand-bar", "brand-mark", "hairline", "progress-bar", "section-marker", "watermark"] },
                description: "Chrome modules to ADD on top of the theme's declared list.",
              },
              disable: {
                type: "array",
                items: { type: "string" },
                description: "Chrome modules to suppress for this slide.",
              },
              override: {
                type: "object",
                additionalProperties: { type: "object" },
                description:
                  "Per-module parameter overrides. Keys are chrome module names; values are module-specific. " +
                  "Examples: page-footer: { left, center, right }; brand-bar: { color, height }; " +
                  "brand-mark: { src, name, color, position, showName }; " +
                  "watermark: { text, color, alpha, position }; progress-bar: { color, track, height }; " +
                  "section-marker: { color, prefix }; hairline: { color, position, weight, insetCm }.",
              },
            },
          },
        ],
      },

      ImageRef: {
        description:
          "Image reference. CANONICAL form: `{ src, alt?, aspectRatio?, fit?, shape?, border?, overlay?, cornerRadius? }`. " +
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
              svg: {
                description:
                  "Inline SVG markup (the literal `<svg ...>...</svg>` string). The renderer wraps it as a " +
                  "`data:image/svg+xml` URL automatically. Use this when an agent generates an icon, sparkline, " +
                  "or diagram on the fly without writing it to disk first.",
                type: "string",
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
              shape: {
                enum: ["square", "rounded", "circle"],
                description: "Clip silhouette. Default 'square' (no clipping). 'circle' is great for headshots.",
              },
              cornerRadius: {
                type: "number",
                minimum: 0,
                maximum: 0.5,
                description: "Corner radius for shape='rounded'. Fraction of the shorter side.",
              },
              border: {
                type: "object",
                additionalProperties: false,
                required: ["color"],
                properties: {
                  color: { type: "string", pattern: HEX6_PATTERN },
                  width: { type: "number", minimum: 0, description: "Border width in EMU (use ctx.pt(N) when authoring)." },
                },
                description: "Stroke drawn around the (clipped) image.",
              },
              overlay: {
                type: "object",
                additionalProperties: false,
                required: ["color"],
                properties: {
                  color: { type: "string", pattern: HEX6_PATTERN },
                  alpha: { type: "number", minimum: 0, maximum: 1, description: "0 = invisible, 1 = opaque. ~0.4 makes for a tasteful tint." },
                },
                description: "Translucent colored fill drawn on top — handy for hero images that need text contrast.",
              },
              crop: {
                type: "object",
                additionalProperties: false,
                description: "Inset crop fractions (0..1 per side). 0.1 left = trim left 10%.",
                properties: {
                  left:   { type: "number", minimum: 0, maximum: 1 },
                  right:  { type: "number", minimum: 0, maximum: 1 },
                  top:    { type: "number", minimum: 0, maximum: 1 },
                  bottom: { type: "number", minimum: 0, maximum: 1 },
                },
              },
              softEdge: {
                type: "number", minimum: 0, maximum: 0.5,
                description:
                  "Feathered edge — fade the image into the canvas. 0..0.5 fraction of the shorter side. " +
                  "0.05–0.15 reads as 'editorial soft', 0.3+ becomes a vignette-like fade.",
              },
              shadow: {
                type: "object",
                additionalProperties: false,
                required: ["color"],
                description: "Drop shadow under the image (OOXML outerShdw).",
                properties: {
                  color: { type: "string", pattern: HEX6_PATTERN },
                  alpha: { type: "number", minimum: 0, maximum: 1 },
                  blur:  { type: "number", minimum: 0, description: "Blur radius in EMU. Use ctx.pt(N) when authoring." },
                  dx:    { type: "number", description: "Horizontal offset in EMU." },
                  dy:    { type: "number", description: "Vertical offset in EMU." },
                },
              },
              grayscale: { type: "boolean", description: "Convert image to grayscale." },
              brightness: { type: "number", minimum: -1, maximum: 1, description: "Luminance shift (negative = darken)." },
              blur: { type: "number", minimum: 0, description: "Gaussian blur radius (EMU). Use for hero backgrounds." },
              duotone: {
                type: "object",
                additionalProperties: false,
                required: ["dark", "light"],
                description: "Two-tone recolour. Pair with brand colours for editorial / magazine look.",
                properties: {
                  dark:  { type: "string", pattern: HEX6_PATTERN },
                  light: { type: "string", pattern: HEX6_PATTERN },
                },
              },
            },
            anyOf: [{ required: ["src"] }, { required: ["url"] }, { required: ["svg"] }],
          },
        ],
      },

      ChartSpec: {
        description:
          "Chart specification. CROSS-FIELD CONSTRAINT (enforced by the SlideML compiler, not by JSON Schema): " +
          "every series's `values` array MUST have the same length as `data.labels` (except scatter charts, " +
          "which use `points: [{x,y}]` instead). Pie / doughnut charts use only the first series. " +
          "Combo charts pick a per-series `type: \"bar\" | \"line\"`. Waterfall charts treat any series value " +
          "of `null` (or non-finite) as a 'total' bar — surrounding values are deltas applied to a running total.",
        type: "object",
        required: ["type", "data"],
        additionalProperties: false,
        properties: {
          type: { enum: ["bar", "stacked-bar", "line", "area", "pie", "doughnut", "combo", "scatter", "waterfall"] },
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
                  required: ["name"],
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    values: {
                      type: "array",
                      items: { type: ["number", "null"] },
                      description:
                        "Length MUST equal data.labels.length (compiler-enforced). " +
                        "Required for every chart type except scatter (which uses `points`). " +
                        "Waterfall: a `null` element marks a 'total' bar.",
                    },
                    type: {
                      enum: ["bar", "line"],
                      description: "Per-series chart type — only valid when parent chart `type` is \"combo\".",
                    },
                    points: {
                      description: "Scatter only — list of {x,y} pairs, replaces `values`.",
                      type: "array",
                      items: {
                        type: "object",
                        required: ["x", "y"],
                        additionalProperties: false,
                        properties: { x: { type: "number" }, y: { type: "number" } },
                      },
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
          annotations: {
            description:
              "Inline highlights drawn over the chart by the layout. Each annotation is a callout/marker/band " +
              "anchored at a category index (`at`) or range (`[start, end]`).",
            type: "array",
            items: {
              type: "object",
              required: ["label"],
              additionalProperties: false,
              properties: {
                label: { type: "string", description: "Label text — supports SlideML inline markdown." },
                at:    { type: "integer", minimum: 0, description: "Category index this annotation refers to." },
                range: {
                  type: "array",
                  description: "Inclusive [start, end] category range — used for band-style annotations.",
                  minItems: 2,
                  maxItems: 2,
                  items: { type: "integer", minimum: 0 },
                },
                style: { enum: ["callout", "marker", "band"], description: "Visual style. Default \"callout\"." },
              },
              anyOf: [{ required: ["at"] }, { required: ["range"] }],
            },
          },
        },
      },

      TableCell: {
        description:
          "Table cell — either a bare string/number, or an object with optional emphasis (chip-coloured + bold).",
        oneOf: [
          { type: "string" },
          { type: "number" },
          {
            type: "object",
            required: ["value"],
            additionalProperties: false,
            properties: {
              value: { oneOf: [{ type: "string" }, { type: "number" }] },
              emphasis: {
                enum: ["ok", "warn", "bad", "highlight", "up", "down", "flat"],
                description: "Tints the cell using the same chip colour palette as inline `{...}` chips.",
              },
            },
          },
        ],
      },

      TableSpec: tableSpecSchema({
        maxRows: 10,
        maxCols: 8,
        cellMaxChars: 100,
        description: "Table visual: up to 8 columns, 10 body rows, and about 100 chars per cell.",
      }),

      Visual: {
        description:
          "Polymorphic visual content. Prefer tagged form: { kind: \"image\" | \"chart\" | \"table\" | \"svg\", ... }. " +
          "Legacy un-tagged image-ref, chart-spec, table, and bare image path are also accepted.",
        oneOf: [
          { $ref: "#/$defs/ImageRef" },
          { $ref: "#/$defs/ChartSpec" },
          { $ref: "#/$defs/TableSpec" },
          {
            type: "object",
            required: ["kind", "src"],
            additionalProperties: false,
            properties: {
              kind: { const: "image" },
              src: { type: "string" },
              alt: { type: "string" },
              fit: { enum: ["contain", "cover"] },
              shape: { enum: ["rounded", "circle"] },
              border: {
                type: "object",
                additionalProperties: false,
                required: ["color"],
                properties: { color: { type: "string" }, width: { type: "number" } },
              },
              overlay: {
                type: "object",
                additionalProperties: false,
                required: ["color"],
                properties: { color: { type: "string" }, alpha: { type: "number", minimum: 0, maximum: 1 } },
              },
            },
          },
          {
            type: "object",
            required: ["kind", "chartType", "data"],
            additionalProperties: false,
            properties: {
              kind: { const: "chart" },
              chartType: { enum: ["bar", "stacked-bar", "line", "area", "pie", "doughnut", "combo", "scatter", "waterfall"] },
              data: { $ref: "#/$defs/ChartSpec/properties/data" },
              format: { $ref: "#/$defs/ChartSpec/properties/format" },
              title: { type: "string" },
              annotations: { $ref: "#/$defs/ChartSpec/properties/annotations" },
            },
          },
          {
            type: "object",
            required: ["kind", "header", "rows"],
            additionalProperties: false,
            properties: {
              kind: { const: "table" },
              header: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", maxLength: 100 } },
              rows: { type: "array", maxItems: 10, items: { type: "array", minItems: 1, maxItems: 8, items: tableCellSchema(100) } },
              colWidths: { type: "array", minItems: 1, maxItems: 8, items: { type: "number", minimum: 0 } },
              align: { type: "array", maxItems: 8, items: { enum: ["left", "center", "right"] } },
            },
          },
          {
            type: "object",
            required: ["kind", "svg"],
            additionalProperties: false,
            properties: {
              kind: { const: "svg" },
              svg: { type: "string" },
              alt: { type: "string" },
            },
          },
          { type: "string", minLength: 1 },
        ],
      },

      Region: {
        description:
          "Polymorphic dashboard cell. `kind` picks the shape: kpi | chart | table | text | bullets | image | code | quote | sparkline | progress.",
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
              style: { enum: ["filled", "ghost", "outlined", "elevated", "glass"] },
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
              style: { enum: ["filled", "ghost", "outlined", "elevated", "glass"] },
            },
          },
          {
            type: "object",
            required: ["kind", "table"],
            additionalProperties: false,
            properties: {
              kind:  { const: "table" },
              title: { type: "string" },
              table: tableSpecSchema({
                maxRows: 6,
                maxCols: 5,
                cellMaxChars: 70,
                description: "Compact region table: up to 5 columns, 6 body rows, and about 70 chars per cell.",
              }),
              style: { enum: ["filled", "ghost", "outlined", "elevated", "glass"] },
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
              style: { enum: ["filled", "ghost", "outlined", "elevated", "glass"] },
            },
          },
          {
            type: "object",
            required: ["kind", "items"],
            additionalProperties: false,
            properties: {
              kind:  { const: "bullets" },
              title: { type: "string", maxLength: 42 },
              items: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", maxLength: 90 } },
              style: { enum: ["filled", "ghost", "outlined", "elevated", "glass"] },
            },
          },
          {
            type: "object",
            required: ["kind", "image"],
            additionalProperties: false,
            properties: {
              kind:    { const: "image" },
              image:   { $ref: "#/$defs/ImageRef" },
              caption: { type: "string", maxLength: 96 },
              style:   { enum: ["filled", "ghost", "outlined", "elevated", "glass"] },
            },
          },
          {
            type: "object",
            required: ["kind", "code"],
            additionalProperties: false,
            properties: {
              kind:     { const: "code" },
              title:    { type: "string", maxLength: 42 },
              language: { type: "string", maxLength: 16 },
              code:     { type: "string", maxLength: 480 },
              style:    { enum: ["filled", "ghost", "outlined", "elevated", "glass"] },
            },
          },
          {
            type: "object",
            required: ["kind", "text"],
            additionalProperties: false,
            properties: {
              kind:        { const: "quote" },
              text:        { type: "string", maxLength: 220 },
              attribution: { type: "string", maxLength: 80 },
              style:       { enum: ["filled", "ghost", "outlined", "elevated", "glass"] },
            },
          },
          {
            type: "object",
            required: ["kind", "values"],
            additionalProperties: false,
            properties: {
              kind: { const: "sparkline" },
              values: { type: "array", items: { type: "number" }, minItems: 2 },
              color: { type: "string", description: "Token name or 6-char hex." },
              area:  { type: "boolean", description: "Fill below the line. Default false." },
              baseline: { type: "number" },
              title:    { type: "string" },
              caption:  { type: "string" },
              style: { enum: ["filled", "ghost", "outlined", "elevated", "glass"] },
            },
          },
          {
            type: "object",
            required: ["kind", "value"],
            additionalProperties: false,
            properties: {
              kind:        { const: "progress" },
              value:       { type: "number", minimum: 0, maximum: 1 },
              label:       { type: "string" },
              color:       { type: "string", description: "Token name or 6-char hex." },
              trackColor:  { type: "string" },
              showPercent: { type: "boolean" },
              style:       { enum: ["filled", "ghost", "outlined", "elevated", "glass"] },
            },
          },
        ],
      },

      ArticleBlock: {
        description: "Block model for article-flow. Text blocks can split across rendered pages; images are atomic blocks with optional captions.",
        oneOf: [
          { type: "string" },
          {
            type: "object",
            required: ["text"],
            additionalProperties: false,
            properties: {
              type: { enum: ["paragraph", "heading", "quote", "note", "code", "h2", "callout"] },
              kind: { enum: ["paragraph", "heading", "quote", "note", "code", "h2", "callout"] },
              text: { type: "string" },
              language: { type: "string" },
            },
            anyOf: [{ required: ["type"] }, { required: ["kind"] }],
          },
          {
            type: "object",
            required: ["type", "items"],
            additionalProperties: false,
            properties: {
              type: { const: "list" },
              items: { type: "array", minItems: 1, items: { type: "string" } },
            },
          },
          {
            type: "object",
            required: ["type"],
            additionalProperties: false,
            properties: {
              type: { const: "image" },
              image: { $ref: "#/$defs/ImageRef" },
              src: { type: "string" },
              url: { type: "string" },
              alt: { type: "string" },
              caption: { type: "string" },
              heightCm: { type: "number", minimum: 1, maximum: 10 },
              fit: { enum: ["contain", "cover", "fill"] },
            },
            anyOf: [{ required: ["image"] }, { required: ["src"] }, { required: ["url"] }],
          },
        ],
      },

      InlineMarkdown: {
        description:
          "SlideML inline-markdown vocabulary (used by every text/text-block/markdown-inline slot, every bullet, " +
          "every region title/body, every table cell). Anything outside this vocabulary renders as plain text.\n\n" +
          "  Construct           | Example                  | Renders as\n" +
          "  --------------------|--------------------------|----------------------------------------\n" +
          "  **bold**            | **critical**             | bold run\n" +
          "  *italic*            | *aside*                  | italic run\n" +
          "  `code`              | `compile()`              | mono run\n" +
          "  {up:value}          | {up:+12% YoY}            | ▲ +12% YoY in semantic-up colour\n" +
          "  {down:value}        | {down:-3pp}              | ▼ -3pp in semantic-down colour\n" +
          "  {flat:value}        | {flat:—}                 | → — in muted colour\n" +
          "  {ok:value}          | {ok:done}                | ✓ done\n" +
          "  {warn:value}        | {warn:risk}              | ⚠ risk\n" +
          "  {bad:value}         | {bad:miss}               | ✗ miss\n" +
          "  {highlight:value}   | {highlight:critical}     | ● critical in accent colour\n" +
          "  :icon-name:         | :check: :warning:        | unicode glyph from the 12-icon enum\n\n" +
          "Icon enum: check, x, star, arrow-up, arrow-down, dot, warning, info, clock, users, chart, code.",
        type: "string",
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
    properties[slotName] = slotSchemaFragment(layout.name, slotName, schema);
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
function slotSchemaFragment(layoutName: string, slotName: string, schema: SlotSchema): Record<string, unknown> {
  switch (schema.type) {
    case "text":
      return {
        type: "string",
        maxLength: schema.maxChars,
        description:
          `Single-line text, ≤ ${schema.maxChars} chars. Supports the SlideML inline-markdown vocabulary ` +
          `(see \`InlineMarkdown\` $def): **bold**, *italic*, \`code\`, {up|down|flat|ok|warn|bad|highlight:value} chips, :icon-name:. ` +
          YAML_QUOTING_RULE,
      };
    case "text-block":
      return {
        description:
          `Multi-line text, ≤ ${schema.maxChars} chars. Accepts a string OR an array. Array items are either ` +
          `plain strings (paragraphs) or typed paragraphs ` +
          `\`{ kind: "quote" | "note" | "callout" | "h2", text }\` for distinctive styling. ` +
          `Each paragraph supports SlideML inline markdown (see \`InlineMarkdown\` $def). ` +
          PARAGRAPH_AUTHORING_RULE + " " +
          YAML_QUOTING_RULE,
        oneOf: [
          { type: "string", maxLength: schema.maxChars },
          {
            type: "array",
            items: {
              oneOf: [
                { type: "string" },
                {
                  type: "object",
                  required: ["kind", "text"],
                  additionalProperties: false,
                  properties: {
                    kind: { enum: ["quote", "note", "callout", "h2"] },
                    text: { type: "string" },
                  },
                },
              ],
            },
          },
        ],
      };
    case "article-blocks":
      return {
        description:
          `Article flow body. Accepts a string shorthand or an array of ArticleBlock objects: ` +
          `paragraph, heading, quote, note, code, list, image. The renderer paginates this logical slide ` +
          `into multiple PPTX slides when needed, preserving rich inline markdown in text blocks. ` +
          PARAGRAPH_AUTHORING_RULE + " " + YAML_QUOTING_RULE,
        oneOf: [
          { type: "string", ...(schema.maxChars ? { maxLength: schema.maxChars } : {}) },
          {
            type: "array",
            items: { $ref: "#/$defs/ArticleBlock" },
          },
        ],
      };
    case "markdown-inline":
      return {
        type: "string",
        maxLength: schema.maxChars,
        description:
          `Inline markdown, ≤ ${schema.maxChars} chars. See \`InlineMarkdown\` $def: **bold**, *italic*, \`code\`, ` +
          `{up|down|flat|ok|warn|bad|highlight:value} chips, :icon-name: (12-icon enum). ` +
          YAML_QUOTING_RULE,
      };
    case "bullets": {
      // Item shape varies per layout. Use slot-name heuristics that mirror
      // the runtime examples in src/slot-examples.ts.
      const items = bulletsItemSchema(layoutName, slotName, schema);
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
      return tableSlotSchema(schema);
    case "component-ref":
      return {
        $ref: "#/$defs/ComponentRef",
        ...(schema.allowed ? { /* note: $ref siblings are limited; document via description */ } : {}),
      };
    case "region":
      return { $ref: "#/$defs/Region" };
    case "region-list":
      return {
        type: "array",
        minItems: schema.min,
        maxItems: schema.max,
        items: { $ref: "#/$defs/Region" },
        description: `${schema.min}–${schema.max} polymorphic region cells. Each item is a Region object with kind: kpi | chart | table | text | bullets | image | code | quote | sparkline | progress.`,
      };
    case "visual":
      return {
        $ref: "#/$defs/Visual",
      };
    case "enum":
      return {
        enum: schema.values,
        ...(schema.default ? { default: schema.default } : {}),
        description: `One of: ${schema.values.join(" | ")}.`,
      };
  }
}

/**
 * Pick the right item-shape for a `bullets` slot based on the slot name.
 * Mirrors the runtime examples returned by describeLayout(). Strings are
 * always accepted; some named slots accept richer object shapes too.
 */
function bulletsItemSchema(layoutName: string, slotName: string, schema: { itemMaxChars: number }): Record<string, unknown> {
  const textProp = { type: "string", maxLength: schema.itemMaxChars };
  const optionalTextFields = (fields: readonly string[]) => Object.fromEntries(fields.map((f) => [f, textProp]));

  if (layoutName === "agenda") {
    return {
      oneOf: [
        textProp,
        {
          type: "object",
          additionalProperties: false,
          properties: optionalTextFields(["text", "title", "label", "name", "heading", "num", "detail", "description", "body", "caption", "subtitle"]),
          anyOf: [
            { required: ["text"] }, { required: ["title"] }, { required: ["label"] },
            { required: ["name"] }, { required: ["heading"] },
          ],
        },
      ],
    };
  }

  if (layoutName === "executive-summary") {
    return {
      oneOf: [
        textProp,
        {
          type: "object",
          additionalProperties: false,
          properties: optionalTextFields(["heading", "line", "text"]),
          anyOf: [{ required: ["heading"] }, { required: ["text"] }],
        },
      ],
    };
  }

  if (layoutName === "question-list") {
    return {
      oneOf: [
        textProp,
        {
          type: "object",
          additionalProperties: false,
          properties: optionalTextFields(["q", "question", "prompt", "label", "detail", "a", "answer", "response", "explanation"]),
          anyOf: [
            { required: ["q"] }, { required: ["question"] }, { required: ["prompt"] },
            { required: ["label"] }, { required: ["detail"] },
          ],
        },
      ],
    };
  }

  if (layoutName === "content-grid") {
    return {
      oneOf: [
        textProp,
        {
          type: "object",
          additionalProperties: false,
          properties: {
            ...optionalTextFields(["title", "text", "heading", "label", "name", "body", "description", "detail", "caption"]),
            icon: { type: "string" },
          },
          anyOf: [
            { required: ["title"] }, { required: ["text"] }, { required: ["heading"] },
            { required: ["label"] }, { required: ["name"] },
          ],
        },
      ],
    };
  }

  if (layoutName === "timeline") {
    return {
      oneOf: [
        textProp,
        {
          type: "object",
          additionalProperties: false,
          properties: optionalTextFields(["when", "date", "title", "heading", "label", "text", "description", "body", "detail", "caption"]),
          anyOf: [
            { required: ["title"] }, { required: ["heading"] }, { required: ["label"] },
            { required: ["text"] }, { required: ["description"] },
          ],
        },
      ],
    };
  }

  // KPI tile items (stat-grid-3): { value, label, delta?, trend? }
  if (layoutName === "stat-grid-3") {
    return {
      oneOf: [
        textProp,
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
  // Image grid cells (image-grid): { src OR url, alt?, caption? }
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
        textProp,
        {
          type: "object",
          additionalProperties: false,
          properties: {
            title:       { type: "string" },
            label:       { type: "string" },
            heading:     { type: "string" },
            description: { type: "string" },
            body:        { type: "string" },
            detail:      { type: "string" },
            caption:     { type: "string" },
            text:        { type: "string" },
          },
          anyOf: [{ required: ["title"] }, { required: ["label"] }, { required: ["heading"] }, { required: ["text"] }],
        },
      ],
    };
  }
  // Default: plain string with maxChars OR a 2-level nested object
  // `{ text, sub? }`. Nested form is opt-in — strings are still preferred
  // when the bullet has no sub-points.
  return {
    oneOf: [
      textProp,
      {
        type: "object",
        required: ["text"],
        additionalProperties: false,
        properties: {
          text: { type: "string", maxLength: schema.itemMaxChars },
          sub: {
            type: "array",
            description: "Sub-bullets — one level of nesting only. Each item is a string ≤ itemMaxChars.",
            items: { type: "string", maxLength: schema.itemMaxChars },
          },
        },
      },
    ],
  };
}

function tableSlotSchema(schema: Extract<SlotSchema, { type: "table" }>): Record<string, unknown> {
  const colCount = schema.maxCols ?? 8;
  const rowCount = schema.maxRows ?? 12;
  const cellMaxChars = schema.cellMaxChars ?? 120;
  return tableSpecSchema({
    maxRows: rowCount,
    maxCols: colCount,
    cellMaxChars,
    description: `Table: up to ${colCount} columns, ${rowCount} body rows, and about ${cellMaxChars} chars per cell.`,
  });
}

function tableCellSchema(maxChars: number): Record<string, unknown> {
  return {
    oneOf: [
      { type: "string", maxLength: maxChars },
      { type: "number" },
      {
        type: "object",
        required: ["value"],
        additionalProperties: false,
        properties: {
          value: {
            oneOf: [
              { type: "string", maxLength: maxChars },
              { type: "number" },
            ],
          },
          emphasis: { enum: ["ok", "warn", "bad", "highlight", "up", "down", "flat"] },
        },
      },
    ],
  };
}
