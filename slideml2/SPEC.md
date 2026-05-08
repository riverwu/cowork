# SlideML2 Specification

This document is the current technical contract for SlideML2 source decks,
layout, rendering, validation, and agent authoring. The compact agent-facing
reference lives at `src/catalog/skills/slideml2/SKILL.md` from the repository
root; this file is the full engineering spec.

## 1. Scope And Status

SlideML2 is a semantic slide DOM that compiles to PPTX. It is designed for
LLM agents and tools to author decks by describing slide intent, components,
and layout, not by writing OOXML.

Current contract:

- Source deck version: `slideml2: 2`.
- Authoring deck size: `deck.size: "16x9"` only. Lower-level emitter code has
  helpers for `16x10`, `4x3`, and `wide`, but source validation currently
  accepts only `16x9`.
- JSON deck file is the source of truth. PPTX and render-tree outputs are
  generated artifacts.
- Component names are part of the schema. Use the component name directly in
  `type`; do not wrap components as `{type:"component", component:"..."}` in
  authored JSON.

Normative words:

- MUST / MUST NOT: required for valid or safe authoring.
- SHOULD / SHOULD NOT: expected authoring behavior; violations often render but
  produce lower quality or unstable output.
- MAY: supported escape hatch or optional behavior.

## 2. Source Deck Model

Minimal deck:

```json
{
  "slideml2": 2,
  "deck": {
    "size": "16x9",
    "theme": "default",
    "brand": { "name": "Example", "primary": "2563EB" },
    "themeOverride": {}
  },
  "slides": [
    {
      "id": "s1",
      "title": "One Slide Job",
      "children": [
        { "id": "s1.lead", "type": "lead", "text": "One clear message." }
      ]
    }
  ]
}
```

Deck fields:

- `slideml2`: MUST be `2`.
- `deck.size`: MUST be `"16x9"` in current authoring flows.
- `deck.theme`: base scaffold name, normally `"default"`.
- `deck.brand`: `{name?, primary?, logo?}`. `primary` is a 6-char hex without
  `#` and seeds `brand.primary`, `brand.tint`, and `brand.shade`.
- `deck.chrome`: deck-wide footer/brand mark settings. Do not hand-draw page
  numbers or logos per slide.
- `deck.themeOverride`: deep-merged over the base theme. This is where the
  deck's visual identity belongs.
- `deck.metadata`: arbitrary non-rendered metadata.

Slide fields:

- `id`: required stable identifier. Prefer a short semantic id such as
  `cover`, `problem`, `evidence-1`, or `wrap`.
- `title`: optional slide title. When present, the source converter injects a
  `slide-title` node into the title rect with `autoFit:"shrink"`.
- `background`: token, hex, gradient string, `{fill}`, `{type:"solid",color}`,
  or `{src}` / `{image}` for image backgrounds.
- `backgroundImage`: alias for image backgrounds. `{src:"/abs/path.png"}` and
  string paths are accepted.
- `children`: required array of `DomNode`.
- `notes`: optional speaker notes.
- `metadata`: arbitrary non-rendered metadata.

Source normalization:

- If no child declares `area:"content"`, non-overlay children are wrapped in a
  generated vertical stack `${slideId}.content` with `area:"content"`.
- Overlay-style children stay at slide level: `anchor`, `anchorTo`, `at`,
  legacy positioned images, background `decoration-grid`, `decorative-shapes`,
  `watermark`, `corner-mark`, `callout-marker`, `big-page-number`,
  `freeform-group`, `cover-composition`, and `chapter-divider`.
- `height`/`width` on non-media, non-anchored nodes are aliased to
  `fixedHeight`/`fixedWidth` for layout compatibility.
- `article` children paginate into multiple slides before rendering.

## 3. Identity, IDs, And Field Shape

MUST:

- Every authored node must have a stable `id`.
- Node fields are flat. Never put component fields under `props`.
- Component type is direct: `{id:"s1.callout", type:"callout", ...}`.
- IDs should be unique within the deck after component expansion. Components
  that generate repeated children must use index-based ids, not semantic labels
  that can repeat.

MUST NOT:

- Use legacy `name` or `props` on primitive nodes.
- Use duplicate ids.
- Use user-visible text as an id source when it may contain spaces, punctuation,
  localization, or repeated labels.

Recommended id style:

```json
{
  "id": "evidence.chart",
  "type": "chart-card",
  "title": "Revenue by product",
  "...": "..."
}
```

## 4. Units

SlideML2 uses different units for different domains. Do not normalize all
numbers to one unit.

| Domain | Fields | Unit |
|---|---|---|
| Layout geometry | `at`, `gap`, `padding`, `fixedWidth`, `fixedHeight`, `minHeight`, `width`, `height`, `offsetX`, `offsetY`, `length` | cm |
| Text size | `fontSize` in `themeOverride.text` or node overrides | pt |
| Stroke thickness | `lineWidth`, `borderWidth`, `divider.thickness`, `accent-rule.thickness` | point-like numbers |
| Legacy tiny strokes | stroke values `<= 0.3` | preserved as cm for backward compatibility |
| Corner radius | `cornerRadius` | fraction of shorter side, usually `0..0.5` |
| Rotation | `rotation` | degrees clockwise |
| Opacity | `opacity`, `fillOpacity`, `lineOpacity` | `0..1` |
| Emitter AST | internal shape coordinates | EMU |

Rules:

- `fontSize: 24` means 24pt, not px.
- `fixedHeight: 1` means a 1cm region.
- `thickness: 1` means about a 1pt rule.
- Use semantic text `size` (`xs`..`2xl`) before raw `fontSize` on nodes.
- Use `lineHeight` in theme text styles for paragraph rhythm; use
  paragraph-level `lineSpacing` only for low-level rich paragraphs.

## 5. Theme And Style Override Contract

The default theme is a neutral scaffold, not a finished visual identity. Every
new deck task SHOULD install a subject-specific `themeOverride` in
`create_deck`.

`themeOverride` supports:

- `colors`: flat token map (`"brand.primary": "2563EB"`) or nested map
  (`{brand:{primary:"2563EB"}}`). Nested maps are flattened.
- `text`: style map. Use `fontSize`, `fontWeight`/`weight`, `lineHeight`,
  `color`, `fontFamily`, `letterSpacing`, `uppercase`, `italic`.
- `component`: default component surfaces (`card`, `panel`, etc.).
- `layout`: `pageMarginX`, `titleTop`, `titleHeight`, `contentTop`,
  `contentBottom`, `defaultGap`, `columnGap`, `cardPadding`.
  `contentTop` and `contentBottom` are content-area y-coordinates; content
  height is `contentBottom - contentTop`.
- `fonts`: latin/cjk display and text chains plus `mono`.
- `chart`: chart color cycles.
- `chrome`: brand mark, page number, footer behavior.
- `sizeScale`: semantic text size multipliers.
- `guidance`: non-rendered prompt guidance for the agent.

Style precedence:

1. Base theme.
2. `themeOverride`.
3. Component defaults.
4. Concrete component or node instance fields (`fontSize`, `fontFamily`,
   `fontWeight`, `lineHeight`, `color`, `size`, `tracking`, `surface`, `fill`,
   `line`, `cornerRadius`, etc.).
5. Rich text run overrides for a single run.

Instance overrides are local. They do not mutate the theme for other nodes.

Surface override convention for composite components:

```json
{
  "type": "feature-card",
  "title": "Reliable parser",
  "surface": {
    "fill": "surface",
    "border": { "color": "divider", "width": 1 },
    "cornerRadius": 0.1,
    "padding": 0.55,
    "elevation": "raised"
  }
}
```

Top-level shortcuts are also accepted: `fill`, `border`, `borderColor`,
`borderWidth`, `borderStyle`, `cornerRadius`, `padding`, `elevation`, `accent`,
`accentColor`, `accentWidth`.

## 6. Color Contract

Use theme tokens for authored slide text and component colors.

Core tokens:

- `brand.primary`, `brand.tint`, `brand.shade`, `brand.onPrimary`
- `background`, `surface`, `surface.subtle`, `surface.muted`
- `text.primary`, `text.secondary`, `text.muted`, `text.subtle`,
  `text.inverse`
- `divider`, `border`
- `success`, `success.tint`, `warning`, `warning.tint`, `danger`, `danger.tint`
- palette names such as `red`, `lime`, `blue`, each with `.tint` and `.shade`

Rules:

- Raw hex text color on authored slide nodes is rejected by tool validation.
  Define hex values in `themeOverride.colors`, then use tokens.
- Raw hex is tolerated for shape fills/lines and theme definitions, but tokens
  are preferred.
- One emphasis system per slide: choose brand emphasis OR one semantic/palette
  accent. Do not spray many accent colors.
- Use `success`, `warning`, and `danger` only for meaning, not decoration.
- On dark color fields, use `text.inverse` or components that support
  `tone:"inverse"`.
- Renderer performs contrast checks. Unfixed `LOW_CONTRAST` is blocking;
  `LOW_CONTRAST_FIXED` is non-blocking and indicates an auto-rewrite.
- Renderer performs shape visibility checks. Unfixed `SHAPE_INVISIBLE` is
  blocking; `SHAPE_INVISIBLE_FIXED` is non-blocking.

## 7. Typography And Rich Text

Text node fields:

- `text`: single paragraph string.
- `paragraphs`: array of paragraph objects `{text|runs, align?, indentLevel?,
  lineSpacing?, spaceAfter?, bullet?}`.
- `content`: `RichTextRun[]`.
- `style`: theme style token. Most agent-authored nodes should use semantic
  component types (`lead`, `h1`, `label`, etc.) instead of explicit style.
- `size`: semantic size dial `xs|sm|md|lg|xl|2xl`.
- `weight`: `normal|medium|bold` or richer run-level weights.
- `tracking`: `tighter|tight|snug|normal|wide|wider|widest`.
- `autoFit`: `shrink` or `resize`.

Rich text run fields:

- `text`
- `marks`: `bold`, `italic`, `underline`, `code`, `emphasis`,
  `strikethrough`, `superscript`, `subscript`, `highlight`
- `color`, `link`, `breakLine`, `size`, `weight`, `italic`, `underline`,
  `font`, `letterSpacing`, `tracking`, `emphasis`, `highlight`, `baseline`

Text hygiene:

- Slide titles should be concise; long titles auto-shrink but still weaken
  hierarchy.
- Body paragraphs should wrap before shrinking. Use meaningful width and
  `minHeight` so text can wrap.
- Use `optional:true` for captions, source notes, and secondary details.
- Avoid repeated callouts or insight-cards as generic text boxes.

## 8. Layout Model

Coordinate system:

- Origin is top-left.
- Units are cm.
- Standard 16:9 slide is 25.4cm x 14.288cm.
- The theme defines a title rect and a content rect.

Top-level placement:

- `slide.title` creates a `slide-title` in the title rect.
- Main content should normally be one `stack`, `grid`, or `split` in
  `area:"content"`. If omitted, source normalization wraps flow children into
  `${slideId}.content`.
- Slide-level `anchor`, `anchorTo`, and `at` nodes bypass flow and render as
  overlays.
- Top-level children without `area:"content"` or overlay positioning fill the
  full slide; use this intentionally only for color fields, covers, or
  full-slide bands.

Containers:

- `stack`: one-dimensional flow, vertical by default.
- `grid`: peer matrix; supports `columns`, `rows`, `columnWeights`,
  `rowWeights`, child `colSpan` and `rowSpan`.
- `split`: primary/secondary region composition.
- `panel`: visible surface wrapper for related content.
- `card`: contained module surface with optional header/footer/accent.
- `band`: wide emphasis strip.
- `frame`: border-only wrapper.
- `inset`: invisible padding wrapper.

Layering and absolute composition:

- `at:[x,y,w,h]`: slide-relative absolute rect. Use for covers, section
  dividers, hero-number compositions, and deliberate poster layouts. Do not
  use it for ordinary corner labels; use `brand-mark` or `anchor`.
- `anchor`: slide-relative overlay anchored to one of nine anchor points.
- `anchorTo`: slide-level overlay whose reference frame is another node id.
- `layer:"behind"|"above"` inside stack/grid: child fills parent rect and does
  not claim flow space. Use for image backings, scrims, decoration grids, and
  ribbons inside a module.
- `zIndex`: higher renders above; negative renders behind flow content.

Collision rule:

- Flow siblings should not overlap.
- Overlay/layered nodes may overlap intentionally.
- `COLLISION` is blocking when non-overlay rects intersect.

## 9. Images And Backgrounds

Image sources may be absolute paths, URLs, or data URLs.

`image.fit`:

- `cover`: fill the slot and crop overflow. Use for backgrounds and
  photo-led layouts.
- `contain`: show the entire image with letterboxing. Use for diagrams,
  screenshots, charts, and generated illustrations that must not crop.
- `fill`: stretch to slot. Use only when distortion is intentional.

Image controls:

- `clip`: `square`, `rounded`, `circle`
- `crop`: source crop fractions `{left,right,top,bottom}`
- `overlay`: `{color, alpha}`
- `border`: `{color, width?, dash?}`
- `shadow`: `{color, alpha?, blur?, dx?, dy?}`
- `grayscale`, `brightness`, `blur`, `duotone`, `softEdge`

Generated image rule:

- When an image is meant as a page background, author it as slide
  `background` / `backgroundImage` or an `image` layer behind content with
  `fit:"cover"`.
- When an image is an illustration or evidence object, put it in `image-card`
  or an `image` node with `fit:"contain"`.
- Do not use `fit:"fill"` to fix aspect mismatch; it stretches the image.
  Change the slot aspect ratio or regenerate/crop the image.

## 10. Shapes, Decoration, And Item Markers

Primitive `shape` is for purposeful geometry: connectors, masks, icons,
highlights, arrows, visual spines, and diagram marks. It should not be used to
fake cards, bullets, captions, or repeated page modules.

Supported shape presets:

- `rect`, `roundRect`, `ellipse`, `line`
- `triangle`, `rightTriangle`, `pentagon`, `diamond`
- `arrow-right`, `arrow-down`, `callout`, `chevron`, `star-5`,
  `parallelogram`, `cloud`

Shape fields:

- `fill`, `line`, `lineWidth`, `lineDash` / `dash`
- `fillOpacity`, `lineOpacity`, `opacity`
- `cornerRadius`
- `fixedWidth`, `fixedHeight`, `width`, `height`
- `rotation`, `flipH`, `flipV`
- overlay fields: `anchor`, `anchorTo`, `at`, `zIndex`, `fillSlide`, `layer`

Item marker contract:

Use item markers for small decorative marks beside list/card items. This avoids
the common failure where a raw rectangle stretches into a large color block.

`markerSpec`:

```json
{
  "shape": "dot|ring|square|rounded-square|diamond|side-bar|slash|index-chip",
  "variant": "tint|solid|outline|ghost|ring|badge",
  "tone": "brand|positive|warning|danger|neutral|muted",
  "size": "xs|sm|md|lg|xl"
}
```

Preferred usage:

```json
{
  "id": "s.feature",
  "type": "feature-card",
  "title": "Task isolation",
  "marker": { "shape": "rounded-square", "variant": "tint", "tone": "brand", "size": "sm" }
}
```

Primitive escape hatch:

```json
{
  "id": "s.item.marker",
  "type": "shape",
  "role": "item-marker",
  "marker": { "shape": "diamond", "variant": "tint", "tone": "brand", "size": "sm" }
}
```

Components with marker support:

- `feature-card`
- `step-card`
- `numbered-grid`
- `takeaway-list`

Decoration components:

- `decoration-grid`: repeated dots, diagonal lines, grid texture.
- `decorative-shapes`: bubbles, confetti, corner blobs, sparkles, molecule
  motifs.
- `accent-rule`: semantic underline/spine/separator.
- `side-rail`, `axis-ruler`, `annotation`, `pointer-arrow`, `bracket`,
  `arrow-link`, `watermark`, `corner-mark`, `big-page-number`,
  `timeline-axis-bar`, `scale-bar`.

Use these before hand-rolling raw shape clusters.

## 11. Component Authoring Contract

Component selection is semantic first, layout second. A slide should use the
component that matches the job of the content, not the component that looks
most like a box.

Routing rules:

- Answer/synthesis: `executive-summary`, `key-takeaway`, `takeaway-list`.
- How/why/mechanism explanation: `explanation-block`.
- Facts plus sources: `fact-list`.
- Options/tradeoffs: `comparison-list`, `comparison-card`,
  `comparison-table`, `pros-cons`.
- Sequence/causality: `process-flow`, `timeline`, `numbered-grid`,
  `numbered-list`, `step-card`, `flow-arrow`.
- Evidence: `image-card`, `chart-card`, `table-card`, `quote`, `source-note`,
  `evidence-layout`.
- Metrics: `hero-stat`, `kpi-grid`, `metric-card`, `stat-strip`,
  `stat-comparison`, `scorecard`, `bar-list`, `gauge`, `progress-bar`.
- Product/identity: `feature-card`, `logo-strip`, `profile-card`, `tag-list`,
  `badge`, `icon-text`.

Anti-patterns:

- A whole deck of `insight-card` grids.
- Repeated `callout` boxes as paragraph containers.
- Equal card grids when the slide actually needs a chart, table, process,
  comparison, or conclusion.
- Generic `shape` rectangles for item decoration.
- Cover slides that look like normal content slides.

## 12. Component Vocabulary

This table is generated from the current component registry shape and includes
both primitives and semantic components. Detailed field descriptions are in
`src/component-registry.ts` and `src/node-types.ts`.

| Name | Required fields | Common optional fields |
|---|---|---|
| `stack` | - | direction, gap, area, justify, align, valign, padding, fill, line, cornerRadius, layoutWeight, optional |
| `grid` | - | columns, gap, area, columnWeights, rowWeights, rows, fixedHeight, anchor, offsetX, offsetY, width, height |
| `split` | - | direction, ratio, gap, area, padding, align, valign, fixedHeight, fixedWidth, layoutWeight, anchor, offsetX |
| `spacer` | - | fixedWidth, fixedHeight, minWidth, minHeight, layoutWeight |
| `divider` | - | orientation, thickness, line, dash, fixedWidth, fixedHeight |
| `bullets` | items | size, density, numbered, align, title, indentLevel, marker, markerColor, markerSize |
| `image` | src | alt, caption, captionPosition, fit, anchor, width, height, fixedHeight, minHeight, clip, cornerRadius, border |
| `table` | rows | headers, caption, align, firstRowHeader, colWidths, rowHeights, borderColor, borderWidth, fixedHeight |
| `chart` | chartType, labels, series | title, yFormat, axis, legend, caption, showValues, showLegend, colors, annotations, fixedHeight |
| `shape` | - | preset, role, marker, shape, tone, variant, size, fill, line, fillOpacity, lineOpacity, opacity |
| `panel` | - | tone, fill, line, padding, cornerRadius, elevation, fixedHeight, fixedWidth, layoutWeight |
| `card` | - | tone, fill, line, padding, cornerRadius, elevation, fixedHeight, fixedWidth, layoutWeight, header, footer, accent |
| `band` | - | tone, fill, height, fixedHeight, cornerRadius, padding |
| `frame` | - | line, lineWidth, dash, cornerRadius, padding, fixedHeight, fixedWidth |
| `inset` | padding | fixedHeight, fixedWidth |
| `deck-title` | text | align |
| `slide-title` | text | align |
| `h1` | text | align |
| `h2` | text | align |
| `lead` | text | align |
| `text` | text | align |
| `article` | - | title, text, paragraphs, source |
| `source-note` | text | align |
| `label` | text | align, variant, tone |
| `code` | text | align, title, language, caption |
| `metric-card` | value, label | unit, trend, delta, status, comparison, source, sparkline, variant, density, surface |
| `callout` | - | text, title, body, content, bullets, variant, tone |
| `comparison-card` | title | subtitle, body, content, badge, points, items, metrics, pros, cons, score, winner, footer |
| `step-card` | title | step, number, body, description, steps, content, bullets, icon, marker, status, owner, time |
| `definition-card` | term, definition | - |
| `numbered-list` | items (string or `{title/body}` objects) | density |
| `quote` | text | source |
| `icon-text` | icon, text | iconColor, iconBackground, tone |
| `timeline` | items | direction, orientation |
| `profile-card` | image, name | role, bio |
| `kpi-grid` | metrics | items, columns |
| `section-break` | title | subtitle, accent, tone |
| `swot-matrix` | strengths, weaknesses, opportunities, threats | - |
| `cta` | text | tone, link |
| `feature-card` | title | icon, iconSrc, body, content, marker, badge, tags, metric, proof, ctaText, iconColor, iconBackground, tone |
| `checklist` | items | - |
| `progress-bar` | label, value | max, valueLabel, tone |
| `pros-cons` | pros, cons | prosTitle, consTitle |
| `process-flow` | steps | items, direction, variant, density, surface |
| `logo-strip` | logos | items, images, columns, caption |
| `pricing-card` | plan, price, features | period, tone, ctaText |
| `hero-stat` | value, label | caption, tone |
| `bar-list` | items | tone, sort |
| `stat-strip` | items | tone |
| `legend` | items | direction, marker |
| `badge` | text | tone |
| `title-lockup` | title | eyebrow, subtitle, align, tone, rule |
| `eyebrow` | text | tone, rule |
| `accent-rule` | - | direction, tone, length, thickness |
| `annotation` | label | text, tone |
| `side-rail` | - | title, body, tone, accent |
| `axis-ruler` | items | direction, tone |
| `flow-arrow` | - | label, tone, direction |
| `key-takeaway` | headline | title, detail, body, content, bullets, tone, variant, density, surface |
| `numbered-grid` | items | columns, tone, marker, numberStyle |
| `tag-list` | items | tone |
| `stat-comparison` | beforeLabel, beforeValue, afterLabel, afterValue | trend, deltaLabel |
| `image-card` | src | alt, title, badge, insight, annotations, callouts, caption, fit, imageWidth, tone, variant, surface |
| `chart-card` | chartType, labels, series | chart, data, title, badge, insight, caption, showLegend, showValues, yFormat, tone, variant, surface |
| `table-card` | rows | title, headers, columns, data, badge, insight, caption, tone, variant, density, surface |
| `insight-card` | headline | badge, title, detail, body, bullets, items, points, tone, density |
| `explanation-block` | - | title, headline, body, detail, description, content, bullets, items, example, note, variant, tone |
| `comparison-list` | items | title, basis, columns, variant, density |
| `fact-list` | items | title, columns, variant, tone, density |
| `executive-summary` | - | thesis, headline, title, summary, body, findings, items, implication, action, variant, tone |
| `two-column` | left, right | ratio, gap |
| `quiz-card` | question | items, correct, explanation, number, questionType, tone |
| `takeaway-list` | items | tone, marker |
| `outline` | items | showPages, density, tone |
| `glossary` | items | layout |
| `q-and-a` | items | density |
| `comparison-table` | features, options | title |
| `scorecard` | items | columns |
| `funnel` | stages | showDrop |
| `gauge` | value, label | max, unit, thresholds |
| `heatmap` | xLabels, yLabels, values | palette, showValues |
| `matrix-2x2` | xAxis, yAxis, items | quadrantLabels |
| `trend-line` | values | tone, height |
| `stat-flow` | steps | - |
| `donut-summary` | primary | others, unit, tone |
| `range-plot` | items | tone |
| `callout-marker` | text | anchor, tone, width, height |
| `decoration-grid` | - | pattern, density, tone, rows, columns, asBackground |
| `decorative-shapes` | - | motif, anchor, tone, count, width, height, asBackground |
| `corner-mark` | text | corner, tone, style |
| `brand-mark` | text | corner, tone, width, height, offsetX, offsetY |
| `bracket` | - | direction, label, tone |
| `arrow-link` | - | fromLabel, toLabel, label, direction, tone |
| `pointer-arrow` | - | label, direction, anchor, offsetX, offsetY, width, height, tone, style |
| `watermark` | text | rotation, tone |
| `big-page-number` | current | total, corner, tone |
| `timeline-axis-bar` | sections, current | tone |
| `scale-bar` | max | min, unit, ticks, tone |
| `freeform-group` | - | mode |
| `cover-composition` | title | subtitle, eyebrow, visual, heroStat, tone, decor |
| `chapter-divider` | title | subtitle, chapter, eyebrow, sections, current, tone |
| `evidence-layout` | evidence | insight, headline, detail, annotations, layout, ratio |
| `factorial-matrix` | rows, columns, cells | title |
| `probe-flow` | steps | items, direction |
| `failure-taxonomy` | items | columns, tone |
| `main-effect-comparison` | beforeLabel, beforeValue, afterLabel, afterValue | title, insight, trend |

## 13. Validation And Render Diagnostics

Validation happens before render. It checks:

- deck version and size
- node id/type presence
- unknown node and component types
- required component fields
- enum field values
- illegal component children
- raw hex text color misuse
- nested component DomNodes (`two-column.left/right`, `timeline.items[].content`,
  `evidence-layout.evidence/insight/annotations`, etc.)
- layout out-of-bounds after measurement

Render diagnostics include:

- `FALLBACK_FAILED`: fallback ladder exhausted; content cannot fit.
- `COLLISION`: non-overlay rects intersect.
- `TINY_RECT`: assigned rect is too small to render.
- `SQUASHED`: meaningful content is technically renderable but unusably
  compressed.
- `DROP`: optional child dropped by fallback ladder.
- `LOW_CONTRAST`: text contrast remains insufficient.
- `LOW_CONTRAST_FIXED`: contrast auto-repaired; non-blocking.
- `SHAPE_INVISIBLE`: shape remains visually invisible against its surface.
- `SHAPE_INVISIBLE_FIXED`: shape auto-repaired; non-blocking.
- `UNKNOWN_COLOR`: token is not defined.
- `UNKNOWN_STYLE`: text style is not defined.
- `OVERFLOW`, `DEMOTED`, `TRUNCATED`: warning-level layout adaptations.

Blocking diagnostic codes for delivery:

```text
FALLBACK_FAILED
COLLISION
TINY_RECT
SQUASHED
LOW_CONTRAST
SHAPE_INVISIBLE
UNKNOWN_COLOR
UNKNOWN_STYLE
```

Fallback ladder:

1. Shrink flexible children toward minimums.
2. Demote density (`bullets` comfortable to compact, paragraph to caption).
3. Drop `optional:true` children.
4. Apply `autoFit:"shrink"` to text/bullets.
5. Emit `FALLBACK_FAILED` if still over tolerance.

Repair policy:

- Preserve the slide's semantic intent.
- Prefer restructuring over tiny numeric tweaks.
- Split dense slides.
- Reduce item count or text length.
- Mark non-essential details `optional:true`.
- Use a component better suited to the content shape.

## 14. Agent Tool Workflow

Authoring tools in Cowork enforce this workflow:

1. Create a fresh source deck with `create_deck`.
2. Install subject-specific `themeOverride` at creation time whenever possible.
3. Add or replace slides one at a time with `replace_slide`; pass the slide as
   an object literal, not a stringified JSON blob. The call commits only after
   that candidate slide passes per-slide validation.
4. Use `patch_deck` for theme/chrome/ordering/path edits.
5. Run `validate_render({render:true})` after all slides have passed
   `replace_slide` to render/export the full PPTX and run final deck QA.
6. If `validate_render` returns `ok:false`, call `read_deck` for the affected
   slide before repairing. Repair from current source JSON, not memory.
7. Do not replace the same existing slide twice in one unvalidated edit window.
   If splitting a slide, replace the first and insert the second.
8. Do not declare completion until there are zero blocking diagnostics and PPTX
   output exists.

`patch_deck` operation groups:

- `set`: path -> value map; replace or create fields.
- `unset`: array of paths to remove.
- `insert`: path -> value map; splice into arrays.
- `move`: from-path -> to-path map.
- `copy`: from-path -> to-path map.

Legacy RFC6902 `{op,path,value}` arrays are rejected for agent reliability.

## 15. Session And Style Isolation

Every new deck task should be treated as a new design session:

- Do not inherit palette, typography, visual signature, image treatment, or
  component mix from a previous deck unless the user explicitly asks.
- Re-read the SlideML2 SKILL/spec for the task if the context may be stale.
- Generate a fresh style brief before `create_deck`.
- Put reusable facts into content planning; do not carry over previous slide
  style decisions as hidden constraints.
- The first `create_deck.themeOverride.guidance` should record the current
  deck's scenario, style principles, layout principles, component guidance, and
  avoid list.

## 16. Quality Bar

A finished SlideML2 deck should satisfy:

- Every slide has one clear job.
- The cover and closing slides are not ordinary content-slide layouts.
- The deck uses multiple semantic component families when the source supports
  them.
- Repeated card grids are avoided unless the content is genuinely modular.
- Charts/tables/images are interpreted, not merely placed.
- Text wraps before it shrinks.
- Captions/source notes are optional under tight layout.
- Generated images are not stretched; fit/crop/aspect ratio is intentional.
- Dark and light backgrounds both maintain readable contrast.
- No blocking validation or render diagnostics remain.

## 17. Test And Release Expectations

For implementation changes in `slideml2`:

- Run `pnpm check` from `slideml2`.
- Run targeted tests for touched behavior.
- Run root `pnpm build` if package exports, renderer, or tool descriptions
  changed.
- Run root `pnpm test` when tool behavior or app integration changed.
- Update `src/catalog/skills/slideml2/SKILL.md` when component syntax or agent
  guidance changes.
- Sync the runtime skill to `~/.cowork/skills/slideml2/SKILL.md` when testing
  in Cowork.
