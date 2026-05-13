---
name: slideml2
description: Generate, edit, and validate PowerPoint (.pptx) decks from prompts, notes, markdown, CSV/JSON data, or research/business documents. Use whenever the user asks for a slide deck, presentation, PPT, PPTX, demo slides, 幻灯片, 演示文稿, 投影, 汇报, or any finished deck file as output. The skill drives the SlideML2 CLI toolchain with per-slide validation and emits a real `.pptx` plus a render-tree sidecar — not screenshots or HTML approximations.
version: 1.0.30
license: Proprietary. LICENSE.txt has complete terms
---

# SlideML2 — PPTX Deck Authoring Toolchain

## What This Skill Does

SlideML2 turns a brief, plan, data file, markdown source, or research document
into a complete `.pptx` presentation. The agent calls a CLI
(`create-deck`, `replace-slide`, `validate-render`) that builds the deck
through validated steps, choosing semantic components (KPI, chart, table,
timeline, evidence, code, formula, …) and emitting native OOXML — not a
screenshot or HTML approximation. The final output is a real PowerPoint file
the user can open, edit, present, or distribute.

## When to Use This Skill

Pick SlideML2 when any of the following is true:

- The user explicitly asks for a deck, slides, presentation, PPT, PPTX,
  keynote, 幻灯片, 演示文稿, 投影, 汇报, or "make me a deck".
- The deliverable is a multi-page narrative meant for projection or
  in-meeting reading (business pitch, research talk, internal review,
  course material, executive briefing, product launch, conference talk).
- The content has hierarchy and mixed media — text plus charts, tables,
  images, code, formulas — and would be unreadable as a single long doc.
- The user provides notes, a markdown plan, a CSV/JSON of data, a research
  paper, or a business document and asks to "turn this into slides".

## When NOT to Use This Skill

Pick a different skill when:

- The user wants a single chart image, a one-page summary, a long-form
  document, an email, a memo, or a blog post. Use the appropriate text,
  document, or chart skill.
- The user only wants raw data analysis or a CSV — no presentation layer.
- The user wants to patch an existing `.pptx` at the OOXML level. SlideML2
  authors from a SlideML2 JSON source, not by editing raw PPTX XML. If no
  SlideML2 source exists, ask whether the user wants a fresh rebuild.

## What You Produce

- A validated `.pptx` saved at the user-specified `outputPath`.
- A `.render-tree.json` sidecar with measured layout, data lineage, and
  per-slide diagnostics for debugging.
- Per-slide compiler-style diagnostics during authoring so the agent can
  repair each page before the final render.

## How to Read This File

This file has three sections:

1. **Tool Path** — how to invoke the CLI and the per-slide loop.
2. **Layout Rules** — composition, capacity, theme, escape hatches, data binding.
3. **Component Reference** — every available `type` with its required and
   optional fields.

For business / research decks, also read `business.md` (light-theme defaults,
icon conventions). Planning-archive templates live in `planning-template.md`.
Domain style defaults are not restated here.

---

## 1. Tool Path

### Invocation

The CLI takes exactly **two positional command-line arguments**: a `command`
and the **path to a JSON file**. There are no flags, no stdin, no inline JSON
on the command line.

```bash
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" <command> <path/to/args.json>
```

To run a command, the agent must:

1. Write a JSON file in the deck workspace (e.g. `create-deck.json`).
2. Invoke the CLI with the command name and the path to that file.
3. Read the JSON result that the CLI prints to stdout.

Run every command from the deck workspace. Unless the JSON file sets
`deckPath`, the CLI reads and writes `./deck.json` in the current working
directory.

### Commands

| Command           | Purpose                                                                     |
|-------------------|-----------------------------------------------------------------------------|
| `create-deck`     | Create or intentionally reinitialize the workspace deck.                    |
| `read-deck`       | Inspect the current workspace deck.                                         |
| `replace-slide`   | Append or replace exactly one slide; validates before writing.              |
| `validate-render` | Validate the whole deck and optionally render the final PPTX.               |

`create-deck` on an existing deck warns with `DECK_REINITIALIZED`. For normal
repair use `read-deck` + `replace-slide`.

### Argument File Contents

These JSON shapes are the **contents** of the file you pass to the CLI as the
second positional argument — they are not command-line flags. The agent
writes one such file per CLI call.

```json
// create-deck.json — passed as: node slideml2.js create-deck create-deck.json
{ "title": "Deck title", "size": "16x9", "theme": "default", "themeOverride": {}, "validation": {} }
```
```json
// replace-slide.json — passed as: node slideml2.js replace-slide replace-slide.json
{ "slideId": "append", "slide": { "id": "cover", "title": "Deck title", "transition": { "type": "fade", "durationMs": 350 }, "children": [] } }
```
```json
// read-deck.json — passed as: node slideml2.js read-deck read-deck.json
{}
```
```json
// validate-render.json — passed as: node slideml2.js validate-render validate-render.json
{ "render": true, "outputPath": "deck.pptx" }
```

All four files support an optional `deckPath` key to target a deck other than
`./deck.json`. `validate-render` also accepts `render:false` for a fast
schema-only dry run.

### Canonical Loop

```
plan.md  →  create-deck  →  loop[ replace-slide ]  →  validate-render
```

Concretely, the loop is a series of file-write + CLI-invoke pairs:

```bash
cd "$DECK_WORKDIR"
# 1. Write create-deck.json, then invoke
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" create-deck create-deck.json
# 2. For each slide: write replace-slide-NN.json, then invoke
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" replace-slide replace-slide-01.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" replace-slide replace-slide-02.json
# 3. After all slides commit, write validate-render.json and invoke
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" validate-render validate-render.json
```

A failure on any step must be repaired before moving to the next step on the
same scope. Repair a rejected slide with another `replace-slide` on the same
slide id/index before writing the next slide.

### Tool-Safety Hard Rules

- One CLI command at a time; never batch `replace-slide` calls.
- Pass `slide` as an object literal, never as a stringified JSON blob.
- Never hand-edit `deck.json`. Never write the deck with `python-pptx` or
  similar; always go through the CLI.
- Repair a rejected slide before writing the next slide. Do not delete
  `deck.json` to "start over"; use a deliberate `create-deck` if a real reset
  is needed.
- Do not wrap the CLI in `run_node`, `run_python`, generated scripts, or
  batch loops; those hide the per-slide diagnostics.
- `validate-render` is the final gate, not the per-slide gate.
  `replace-slide` already validates each page.

### Task Modes

- `create` — new deck from a prompt, notes, data, markdown, or research.
- `modify` — edit an existing deck. Start with `read-deck`, then
  `replace-slide`.
- `repair` — fix a failed `replace-slide` or `validate-render`. Read the
  named slide, repair its node, retry the same `replace-slide`.
- `review` — inspect and report without writing.

### Reading Diagnostics

CLI results are compiler-like. `ok:false` plus `phase:"render-validation"`
means the candidate would overflow, overlap, or trigger a blocking visual
diagnostic; `deckModified:false` means the deck source was not changed. The
result carries `slideId`, `nodeId`, `code`, `measured`, `suggestion`,
and (when applicable) `constrainedBy` — read them like
compiler errors and repair the named node.

| Class            | Examples                                                                 | Treatment                                  |
|------------------|--------------------------------------------------------------------------|--------------------------------------------|
| Blocker          | `FALLBACK_FAILED`, `COLLISION`, `STRUCTURAL_OVERLAP`, `OVERLAY_OCCLUDES_FLOW`, `TITLE_OCCLUDED`, `EMPTY_CHART_DATA`, `EMPTY_TABLE_DATA`, `CODE_BLOCK_OVERFLOW`, `TINY_RECT`, `LOW_CONTRAST`, `SHAPE_INVISIBLE`, `UNKNOWN_COLOR`, `UNKNOWN_STYLE`, `OFF_SLIDE`, any `severity:"error"` | Must fix on same slide before next slide.  |
| Quality / hint   | `TRUNCATED`, `OVERFLOW`, `DROP`, `DEMOTED`, `SQUASHED` (warn), `PAGE_OVER_CAPACITY` (warn), `REGION_OVER_CAPACITY` (warn), `PIE_LABELS_HIDDEN`, `DECORATIVE_OVERLAP`, `EDGE_CLIPPED`, `TIGHT_GAP` | Improve when the named target makes the repair obvious; never blocker by itself. |

Repair preference order: area / ratio / density / pagination / rows / labels /
data grouping — before changing component type. Switch components only
when a different component better represents the content.

If diagnostics include `PAGE_OVER_CAPACITY`, or one slide has two or more
large-component blockers among `chart-card`, `table-card`, `equation`,
`code-block`, `timeline`, or `process-flow`, treat the whole page as
overloaded. Do not keep squeezing with more `fixedHeight` or tighter grids.
Keep the primary evidence object on this slide and move secondary table,
formula, citation, or appendix support to a rail or follow-up slide.

If diagnostics include `REGION_OVER_CAPACITY`, the whole page may still have
space, but a split rail, side column, or local stack is overloaded. Do not
repair only the last failing child. Rebalance the split, move secondary
quote/citation/source-note/detail blocks to a follow-up slide, or turn the rail
into its own slide while preserving component semantics.

---

## 2. Layout Rules

### 2.0 Slide Object Fields

A `replace-slide` payload's `slide` object supports:

- `id` required stable slide id.
- `title` optional metadata/default visible title. Omit it for full-canvas
  custom covers or pages that already carry a visible hero title.
- `background` optional token, 6-char hex, gradient/fill object, or image
  `{src}`.
- `transition` optional native PowerPoint slide transition:
  `{type:"none"|"fade"|"push"|"wipe"|"split"|"cover"|"uncover",
  direction?:"left"|"right"|"up"|"down", durationMs?:number}`.
  Use canonical `type` values. `duration` in seconds and `type:"slideIn"`
  aliases are accepted for compatibility, but canonical form is preferred.
- `notes` optional speaker notes.
- `children` required array of layout nodes/components.

### 2.1 Composition

- Content slides ≥ 70% of total. Chrome (cover, TOC, section-break, closing) ≤ 30%.
- One hero per slide. At most one element at deck-title / cover-title /
  hero-stat / metric-value scale.
- Default order is cover → TOC → content. Below ~10 content slides, drop the
  TOC. A TOC must earn its place with per-chapter body, page number, or thesis.
- Section-break thresholds: 4–8 content slides → 0–1 break; 9–14 → 1–2;
  15+ → 2–3. Never use a break around a single content slide.
- No bare "Thank You / End" slide. Replace with 3–5 takeaways, the strongest
  data point, or contact / QR. If the deck truly ends there, drop the slide.
- A `slide.title` and a body `cover-composition` / `slide-title` /
  `deck-title` / `section-break` title together are duplicates. Pick one.
- When repairing density, preserve semantic ordinals: "判断 1/2/3",
  "Step 1/2/3" must stay visible in the title, eyebrow, label, or first card.

### 2.2 Density & Capacity

- Most slides should have either one hero module, one data/evidence module,
  or 2–4 peer modules. Long prose belongs in shorter bullets or another slide.
- Bullets are a `bullets` component, not `"• A\n• B"` inside a `text` node.
  A multi-record `text` cannot be styled, dropped, or repaired per item.
- 5+ warnings, red-lines, or risks → `warning-list`. Stacked callouts beyond
  3 items rarely fit the standard content area.
- Long code → `code-block` with `density:"dense"` or `"tiny"`, `fontSize:6–7`,
  `columns:2`, paginated across slides. `maxLines` is only for intentional
  excerpts.
- Tables: a compact 6–8 row business table usually needs its own region.
  Adjust `colWidths`, density, or paginate before dropping columns.
- Large components compete for a single page budget. `chart-card`,
  `table-card`, `equation`, `code-block`, `timeline`, and rich
  `process-flow` should not all be peers on the same page. If render
  diagnostics report page-level over-capacity, split the page instead of
  adding fixed heights that make siblings unreadable.
- For ranking / variance / YoY / contribution / ROI, the primary evidence
  should be a chart (`chart-card` / `bar-list`); the exact table goes on a
  side rail or follow-up slide, not stacked above the chart.
- Three or more table-only pages in a row is acceptable only for true
  reference or appendix material.

### 2.3 Theme & Units

- `deck.size`: `16x9` (default), `16x10`, `4x3`, or `wide`. Use what the user
  asks for; do not force 16:9.
- `deck.validation.mode`: `standard`, `strict`, or `experimental`. `strict`
  requires image `alt` and chart/table source metadata.
- Top-level `themeOverride` keys: `colors`, `text`, `component`, `tone`,
  `layout`, `fonts`, `chart`, `chrome`, `imageGrowWeight`, `sizeScale`,
  `guidance`. Flat dot keys (`"brand.primary"`) and nested objects both work.
- `themeOverride.layout`: `pageMarginX`, `titleTop`, `titleHeight`,
  `contentTop`, `contentBottom`, `defaultGap`, `columnGap`, `cardPadding`,
  `areas`, plus `slideWidthCm` / `slideHeightCm`. There is no `pageMarginY`.
- `contentTop` and `contentBottom` are y-coordinates. `contentHeight =
  contentBottom - contentTop`. On 16:9, `contentBottom` is usually 13.0–13.5.
- `themeOverride.layout.areas`: `{ name: {x,y,w,h} | {left,top,right,bottom} }`.
  Do not redefine built-in area names `content` or `full`; use names such as
  `main`, `contentMain`, `rail`, `leftRail`, `figureZone`, or `evidencePanel`.
  Reserved names: `content`, `full`. Reference from a top-level node with
  `area:"name"`.
- Color tokens preferred over raw hex (`text.primary`, `brand.primary`,
  `success`, `warning`, `danger`, `info`, `neutral`, `muted`). Raw `RRGGBB`
  works but warns because it does not follow theme changes.
- Component tones: canonical `brand | positive | warning | danger | neutral`;
  aliases `success/good`, `caution/warn`, `error/negative`, `info/primary`,
  `muted/subtle` are accepted but prefer canonical.
- Typography lives in `themeOverride.text` as base tokens: `slide-title`,
  `section-title`, `card-title`, `paragraph`, `bullet`, `caption`, `label`,
  `table-header`, `table-cell`, `metric-value`, `metric-label`, etc. Derived
  component tokens (`timeline-time`, `timeline-body`) follow from base tokens.
- Fonts: `themeOverride.fonts` has `latin`, `cjk` (each `{display,text}`)
  and `mono`. A font chain may be `"Arial"` or `["Arial","Helvetica"]`;
  arrays are preferred when you have fallbacks. Text styles choose
  `fontFamily:"display"|"text"|"mono"`.
  Font chains are preference order; the first face is what PPTX emits — fonts
  are not embedded.
- Chrome: `brandMark` is a position enum (`none|top-right|bottom-right`), not
  label text. Put textual labels such as "Internal" or "Physics · Mechanics"
  in `footerText` or a `brand-mark` component.
- Units:
  - cm for layout: `at`, `gap`, `padding`, `fixedWidth`, `fixedHeight`,
    `width`, `height`, `length`, named `areas`.
  - pt for type: `fontSize`, `lineWidth`, `borderWidth`, `thickness`.
  - normalized `0..0.5` for `cornerRadius` (it is a roundRect fraction,
    not cm or px).
- Style precedence: theme → derived component tokens → primitive-node
  override (`fontSize`, `fontWeight`, `color`, etc.) → rich-run field. Node
  and run overrides do not change the theme for other components.

### 2.4 Escape Hatches

Components cover ~90% of slides. Use these only for editorial moments:
covers, section openers, hero stats over photography, or annotation overlays.

| Goal                                                                  | Primitive                                  |
|-----------------------------------------------------------------------|--------------------------------------------|
| Reusable side rail, main evidence pane, or fixed repeated region      | `themeOverride.layout.areas` + `area:"x"`  |
| Diagonal headline, hero number on cover, custom poster page           | `at:[x,y,w,h]` / `{x,y,w,h}` + rotation    |
| Image as card background, scrim over content, deco behind text        | `layer:"behind"` or `"above"` on flow child |
| Badge / flag / callout attached to another element                    | `anchorTo:"nodeId"`                         |
| Ordinary content layout                                               | components + flow containers                |

Notes:

- `area:"content"` uses the protected content rect; with `slide.title` it
  stays below the injected default title.
- Do not combine `area` with `at` / `anchor` / `anchorTo` on the same node.
- Do not place separate `at` text boxes on top of an `area:"content"` node;
  either move `contentTop` below it, define named areas for both regions,
  or put them inside one `stack` / `split`.
- If a custom title system uses `at` or named areas, omit `slide.title` to
  avoid duplicate titles.
- `layer:"behind"` does not consume flow space and is exempt from overlay
  occlusion checks. `layer:"above"` participates in occlusion detection.

### 2.5 Data Binding

Use deck-level `dataSources` and `bind` + `encoding` whenever the same data
backs multiple components. Hand-authored `labels` / `series` / `rows` are
fine for one-off data.

```json
{
  "dataSources": {
    "sales": {
      "type": "inline-json",
      "rows": [
        { "quarter": "Q3", "month": "Jul", "region": "NA", "revenue": 920, "cost": 607, "margin": 0.34 },
        { "quarter": "Q3", "month": "Aug", "region": "EU", "revenue": 390, "cost": 296, "margin": 0.24 }
      ]
    },
    "pipeline": { "type": "inline-csv", "csv": "stage,value\nDiscovery,1250\nCommit,410" },
    "actuals": { "type": "file-csv", "path": "data/actuals.csv" },
    "margins": {
      "type": "computed", "source": "sales",
      "computed": {
        "profit":    { "op": "subtract", "left": "revenue", "right": "cost" },
        "marginPct": { "op": "divide",   "left": "profit",  "right": "revenue" }
      }
    }
  }
}
```

Source types: `inline-json` (rows), `inline-csv` (text), `file-csv` (path
relative to deck JSON), `computed` (derived from another source).

`bind`: `{ source, select?, filter?, groupBy?, aggregate?, pivot?, sort?, limit? }`.
Resolution order: filter → groupBy/aggregate → pivot → sort → limit →
component `encoding`. Do not combine `pivot` with `groupBy`/`aggregate` in
the same view.

- `filter`: scalar equality, array inclusion, or operator object
  `{ in, eq, ne, contains, gt, gte, lt, lte }`.
- `aggregate` ops: `sum`, `avg`, `min`, `max`, `count`, `first`, `last`.
- `computed` ops: `field`, `literal`, `add` / `sum`, `subtract`, `multiply`,
  `divide` / `ratio`, `percent-change`, `negate`, `abs`, `round`, `concat`,
  `coalesce`. No JS or formula strings.

Bound chart:

```json
{
  "type": "chart-card", "chartType": "bar", "title": "Q3 revenue",
  "bind": { "source": "sales", "filter": { "quarter": "Q3" }, "groupBy": "month",
            "aggregate": { "Revenue": { "op": "sum", "field": "revenue" } }, "sort": "month" },
  "encoding": { "x": "month", "y": "Revenue", "seriesName": "Revenue" },
  "caption": "Source: deck.dataSources.sales"
}
```

For combo charts or secondary axes, bind all numeric series explicitly and use
`series` or `encoding.seriesOptions` for styling. Do not set
`secondaryYAxis` with only one bound series.

```json
{
  "type": "chart-card", "chartType": "combo", "title": "Readiness trend",
  "bind": { "source": "q4metrics" },
  "encoding": { "x": "phase", "y": ["clients", "nps"] },
  "series": [
    { "name": "Clients", "type": "bar", "color": "#2563EB" },
    { "name": "NPS", "type": "line", "axis": "secondary",
      "color": "#16A34A", "lineWidth": 2, "lineDash": "solid",
      "marker": { "shape": "circle" } }
  ],
  "secondaryYAxis": { "title": "NPS", "min": 0, "max": 60 },
  "legend": { "show": true, "position": "right" },
  "plotArea": { "x": 0.08, "y": 0.08, "w": 0.72, "h": 0.78 },
  "dataLabels": { "show": true, "showValue": true }
}
```

Bound table:

```json
{
  "type": "table-card",
  "bind": { "source": "sales", "groupBy": "region",
            "aggregate": { "Revenue": { "op": "sum", "field": "revenue" }, "Margin": { "op": "avg", "field": "margin" } },
            "sort": "-Revenue" },
  "encoding": { "columns": [
    { "key": "region",  "label": "Region" },
    { "key": "Revenue", "type": "currency", "format": "int", "align": "right" },
    { "key": "Margin",  "type": "percent",  "align": "right" }
  ] }
}
```

Column `type` should be `text`, `number`, `percent`, `currency`, or `date`.
Common numeric aliases such as `int`, `integer`, `decimal`, `float`, and
`numeric` normalize to `number`; prefer canonical names in authored JSON.

Pivot (long → wide):

```json
{
  "bind": { "source": "sales",
            "pivot": { "index": "region", "columns": "product", "values": "revenue", "aggregate": "sum", "fill": 0 },
            "sort": "region" }
}
```

If a bound chart reports `EMPTY_CHART_DATA`, repair the source / filter /
encoding or split the page. Do not switch to a weaker component to silence
the diagnostic.

For research / commercial provenance: put bibliography in
`deck.references[{id,title?,authors?,year?,venue?,doi?,url?,citation?}]`,
footnotes in `deck.footnotes[{id,text}]`, and reference them with rich
inline runs `{kind:"cite",refId}` and `{kind:"footnoteRef",footnoteId}`.

---

## 3. Component Reference

### 3.0 Shared Types

```
tone        = brand | positive | warning | danger | neutral
surface     = { fill, line, lineWidth, lineDash, cornerRadius, padding, elevation, shadow, gradient, accent, accentColor, accentWidth }
marker      = { shape: dot|ring|square|rounded-square|diamond|side-bar|slash|index-chip,
                variant: tint|solid|outline|ghost|ring|badge, tone, size: xs|sm|md|lg|xl }
image-ref   = absolute path string
color-ref   = theme token (e.g. "brand.primary") | "RRGGBB"
rich-runs   = array of { text, marks?, color?, link? } | { kind: "math"|"cite"|"footnoteRef"|"icon"|"token", ... }
density     = comfortable | compact
variant     = component-specific small enum, typically plain|card|compact|banner
align       = left | center | right
direction   = horizontal | vertical
```

`tone`, `surface`, `marker`, `image-ref`, `color-ref`, `rich-runs`,
`density`, `align`, `direction` are referenced by name below without
re-enumeration.

### 3.1 Layout Containers

Children are required unless noted. Containers may carry `fixedHeight` /
`fixedWidth` as escape hatches; prefer flex sizing.

- `stack` — Flow container reading in sequence. type='stack' required={children} optional={direction, gap, area, justify:start|center|end, align, valign:top|middle|bottom, padding}
- `grid` — Matrix of peer modules. Use colSpan/rowSpan for one semantic hero plus satellites. type='grid' required={children} optional={columns, gap, area, columnWeights, rowWeights, rows, fixedHeight}
- `split` — Primary + support. `ratio` is a target proportion, not a hint. type='split' required={children} optional={direction, ratio, gap, area, padding, align, valign}
- `panel` — Surface wrapper for a related semantic group. type='panel' optional={tone, fill, line, padding, cornerRadius, elevation:flat|raised|outlined, fixedHeight, children}
- `card` — Contained module with optional title/footer/accent. `title` and `header` are the same field; prefer `title`. type='card' optional={title, header (alias), footer, accent:none|left|top, accentColor, tone, fill, line, padding, cornerRadius, elevation, fixedHeight, fixedWidth, children}
- `band` — Wide emphasis band for a section thesis, verdict, or hero quote. type='band' optional={tone, fill, height, fixedHeight, cornerRadius, padding, children}
- `frame` — Border-only wrapper. `lineWidth` is stroke pt, not cm. type='frame' optional={line, lineWidth, dash:solid|dash|dashDot|dot, cornerRadius, padding, fixedHeight, fixedWidth, children}
- `inset` — Invisible padding wrapper for one semantic child. type='inset' optional={padding, fixedHeight, fixedWidth, children}
- `two-column` — Named left+right regions for narrative+visual or before+after. `left` and `right` may be full DomNode objects or shorthand `{children:[...]}` blocks, which normalize to stacks with generated ids. type='two-column' required={left, right} optional={ratio, gap}
- `freeform-group` — Slide-level anchored overlay group. Children use `at:[x,y,w,h]`, `x/y/w/h`, or anchor/offsetX/offsetY/width/height/zIndex. type='freeform-group' required={children} optional={mode:overlay|background}

### 3.2 Page Archetypes

- `cover-composition` — Editorial cover with optional full-bleed visual, dominant title lockup, hero stat. type='cover-composition' required={title} optional={subtitle, eyebrow, visual:{src,fit,anchor?,width?,height?,opacity?}, heroStat:{value,label,caption}, tone:neutral|inverse|brand, decor:none|grid|shapes, titleSize:deck-title|slide-title|section-title, lockupWidth, lockupHeight}
- `chapter-divider` — High-impact section opener. type='chapter-divider' required={title} optional={subtitle, chapter, eyebrow, sections, current, tone:brand|neutral|inverse}
- `hero-and-support` — One dominant claim plus 2–4 satellites. Use instead of a flat 2×2 grid when one idea leads. type='hero-and-support' required={headline, supports} optional={hero, detail, items (alias), layout:left|top, ratio, gap, tone}
- `chart-with-rail` — Dominant chart/table/evidence plus a narrow rail. type='chart-with-rail' required={evidence} optional={rail, headline, detail, items, layout:rail-right|rail-left|stacked, ratio, gap, tone} capacity="evidence dominant; rail concise"
- `snapshot-callouts` — Screenshot + numbered callouts. Use `freeform-group` only when markers must point at exact coordinates. type='snapshot-callouts' required={src:image-ref, callouts} optional={title, caption, items (alias), fit:cover|contain|fill, layout:rail-right|rail-left|below, ratio, gap, tone}
- `evidence-layout` — Evidence + interpretation page. type='evidence-layout' required={evidence} optional={insight, headline, detail, annotations, layout:sidecar|stacked, ratio}

### 3.3 Quantitative Proof

KPI and chart components accept `bind` + `encoding` for data binding. See §2.5.

- `hero-stat` — Slide-defining number. One per slide. type='hero-stat' required={value+label | bind+encoding:{value,label,delta?}} optional={caption, tone, bind, encoding}
- `kpi-grid` — 2–6 headline metrics. type='kpi-grid' required={metrics:[{value, label|name|title, delta?, status?, sparkline?, ...}]} optional={items (alias), columns, variant:plain|card|compact, density, surface}
- `metric-card` — Single compact KPI. type='metric-card' required={value+label | bind+encoding} optional={unit, trend:up|down|flat, delta, status, comparison, source, sparkline, variant, density, surface, bind, encoding}
- `stat-strip` — Inline row of 3–6 supporting numbers. type='stat-strip' required={items | bind+encoding:{value,label} | bind+encoding:{items:[{label,value,type?,format?,tone?}]}} optional={tone, bind, encoding}
- `stat-comparison` — Before/after with delta. type='stat-comparison' required={beforeLabel, beforeValue, afterLabel, afterValue} optional={trend, deltaLabel}
- `bar-list` — Ranked categorical comparison, 4–8 items. `value` may be a number, percent string, or star rating. type='bar-list' required={items:[{label|name|title, value|score|percent, valueLabel?, tone?}]} optional={tone, sort:desc|asc|none}
- `progress-bar` — Single progress-to-target. type='progress-bar' required={label, value} optional={max, valueLabel, tone}
- `chart-card` — Titled chart with optional insight, caption, dataLabels. Pie/doughnut must show slice labels. type='chart-card' required={chartType:bar|stacked-bar|line|pie|doughnut|area|combo|scatter|waterfall, labels+series | data.{labels,series} | bind+encoding} optional={title, badge, insight, caption, showLegend, showValues, dataLabels:{show,position,bestFit|center|insideEnd|insideBase|outsideEnd,showValue,showCategoryName,showSeriesName,showPercent,showLegendKey,showLeaderLines}, positiveColor, negativeColor, yFormat:int|decimal|percent|wanyuan|yi, tone, variant, surface, bind, encoding, orientation, xAxis, yAxis, secondaryYAxis, legend:{show,position,overlay}, plotArea:{x,y,w,h}} capacity="bar/line/combo body usually >=4.8x3.0cm; low-density 3-category single-series bar charts may warn below this but still need readable aspect ratio; pie/doughnut >=5.2x4.4cm before chrome"

### 3.4 Comparison & Decisions

- `comparison-card` — One peer option with parallel evidence. type='comparison-card' required={title} optional={subtitle, body, content:rich-runs, badge, points, items, metrics, pros, cons, score, winner, footer, variant, density, surface}
- `pros-cons` — Two-sided trade-off, benefits vs drawbacks. Not a generic two-column. type='pros-cons' required={pros, cons} optional={prosTitle, consTitle}
- `swot-matrix` — Strengths / weaknesses / opportunities / threats. Use only for true SWOT. type='swot-matrix' required={strengths, weaknesses, opportunities, threats}
- `pricing-card` — One pricing tier; mark recommended semantically. type='pricing-card' required={plan, price, features} optional={period, tone:neutral|brand, ctaText}
- `table-card` — Structured comparison or lookup table. Hand-authored rows may be arrays, `{cells:[...]}`, or objects; for varied display labels use `encoding.columns:[{key,label}]`. Cells may be plain strings or objects with `{text,value,runs,footnoteRefs,fill,color,tone,bold,align,valign,colspan,rowspan,padding,border,textRotation}`. type='table-card' required={rows | data.rows | bind+encoding:{columns?}} optional={title, badge, insight, headers, columns:[{key|field,header|label,width?}], colWidths, rowHeights, density, cellPadding, borders:{color,width,dash,left?,right?,top?,bottom?}, borderDash, bandRows, bandCols, tableStyleId, caption, tone, variant, surface, bind, encoding} capacity="compact 6-8 row business table ~4.5-6cm body; paginate before dropping rows/columns"
- `comparison-table` — Multi-option matrix; features rows, options columns. type='comparison-table' required={features, options:[{name, values, recommended?}]} optional={title}

### 3.5 Sequence & Causality

- `process-flow` — Connected workflow. Horizontal works for 2–3 stages; rich 4+ may auto-wrap. type='process-flow' required={steps:[{title|label, body|description, status?, owner?, time?, icon?, iconSrc?:image-ref, number?, marker?, accentColor?, bullets?}]} optional={items (alias), direction, variant:plain|cards, density, marker, showNumbers, connector:arrow|chevron|line|none, connectorDash, connectorColor, placement:top|center, spread:compact|balanced|fill, stepAccent:top|none, stepSurface, surface} capacity="horizontal: 2-3 stages; 4+ rich → vertical or split"
- `timeline` — Dated milestones; sequence-organized meaning. Items: `{time|date|year, title?, body?, tone?, shape?, icon?, iconSrc?, content?}`. Horizontal rich content >5 auto-flips vertical; horizontal simple >6 wraps to 4-column rows. type='timeline' required={items} optional={direction, orientation (alias), gap}
- `outline` — TOC/agenda. Numbers are never auto-generated. type='outline' required={items:[{title, number?, body?, page?, tone?}]} optional={showPages, density:comfortable|compact|auto, tone:brand|neutral}
- `numbered-grid` — Designed ordered priorities/principles, each a peer module. type='numbered-grid' required={items:[{title|label|name, body|description|text, marker?, tone?}]} optional={columns, tone, marker, numberStyle:chip|plain}
- `numbered-list` — Brief ordered prose items. type='numbered-list' required={items: string[] | [{title|headline|label|name|text, body|detail|description?}]} optional={density}
- `step-card` — One discrete step with title + short detail. Prefer `process-flow` for connected pipelines. type='step-card' required={title} optional={step, number, body, description, steps, marker, icon}
- `axis-ruler` — Ordered conceptual scale: eras, maturity, spectrum. Position on the axis is the meaning. type='axis-ruler' required={items:[{label|title|name, body|text|description}]} optional={direction, tone}
- `flow-arrow` — Single directional connector between two modules. Use `process-flow` for multi-step. type='flow-arrow' optional={label, tone, direction:right|down}

### 3.6 Evidence & Media

- `image-card` — Inspectable image with optional annotations/callouts. type='image-card' required={src:image-ref} optional={alt, title, badge, insight, annotations, callouts, caption, fit:cover|contain|fill, imageWidth, tone, variant, surface}
- `quote` — Verbatim or voice-like statement. type='quote' required={text} optional={source}
- `source-note` — Quiet provenance / caveat. type='source-note' required={text} optional={align}
- `equation` — Display math via OMML. Supported LaTeX renders natively; unsupported commands fail validation. type='equation' required={latex} optional={label, number, align, caption, style, size, fontSize, renderMode:omml} capacity="dense formula grids: explicit fontSize/size and split derivation steps"
- `bibliography` — Auto bibliography from `deck.references`. Use with `{kind:"cite",refId}` runs. type='bibliography' optional={title, style:numeric|author-year|short, includeAll}
- `legend` — Color/category key. type='legend' required={items:[{label, color}]} optional={direction}

### 3.7 Insight & Narrative

- `executive-summary` — First choice for memo-style answers: thesis + 2–4 findings + implication. Do not replace with an insight-card grid. type='executive-summary' optional={thesis|headline|title, summary|body, findings|items:[{headline|title, detail|body, tone}], implication, action, variant:memo|board|compact, tone}
- `key-takeaway` — One slide verdict. One per slide. type='key-takeaway' required={headline | title} optional={detail, body, description, content:rich-runs, bullets, tone, variant:panel|banner|minimal, density, surface}
- `takeaway-list` — 3–5 parallel conclusions for wrap-up. type='takeaway-list' required={items:[{headline, detail, tone, marker?}]} optional={tone, marker}
- `warning-list` — 3–8 warnings, red lines, or anti-patterns. Use this instead of stacking 4+ callouts. type='warning-list' required={items:[{headline, detail, tone, marker?}]} optional={tone, marker}
- `explanation-block` — First choice for why/how/mechanism/concept prose. Replaces paragraph-like insight-card sets. type='explanation-block' optional={title|headline, body|detail|description, content:rich-runs, bullets|items, example, note, variant:plain|minimal|rail|panel, tone, density, surface}
- `comparison-list` — Lightweight before/after/options/trade-offs. Use when a matrix is too heavy. type='comparison-list' required={items:[{title|name|label, body|description, points|items|bullets, badge, tone}]} optional={title, basis, columns, variant:plain|columns|subtle, density}
- `fact-list` — Facts → interpretation rows. Use `insight-card` only after synthesis. 5+ items auto-flow into a compact grid. type='fact-list' required={items:[{label|title|name, value, fact|text|body, interpretation|insight, source, tone}]} optional={title, columns, variant:list|grid|strip, tone, density}
- `insight-card` — One curated finding/risk/opportunity in a peer set. Not the default text container. type='insight-card' required={headline | title} optional={badge, detail, body, description, bullets|items|points, tone}
- `callout` — Highlighted rule/warning/recommendation. type='callout' required={text | title|body|content|bullets} optional={title, body, content:rich-runs, bullets, variant:plain|card|banner, tone}
- `definition-card` — One term + definition. type='definition-card' required={term, definition}
- `glossary` — 6–15 terms uniformly aligned. type='glossary' required={items:[{term, definition}]} optional={layout:list|two-column}
- `q-and-a` — FAQ/interview pairs, max 6. type='q-and-a' required={items:[{q,a}] (max 6)} optional={density}
- `quiz-card` — MCQ/T-F question card. type='quiz-card' required={question} optional={items (max 6), correct:letter|index, explanation, number, questionType, tone:brand|neutral|tinted}
- `article` — Long-form text that auto-paginates across slides. type='article' required={text | paragraphs} optional={title, source}
- `code` — Inline preformatted code excerpt. type='code' required={text} optional={align, title, language}
- `code-block` — First-class code listing with line numbers, syntax color, diff lines, highlight ranges. type='code-block' required={code} optional={language, title, caption, showLineNumbers, highlightLines:[number | {start,end}], wrap, density:compact|dense|tiny, columns, fontSize, maxLines} capacity="paginate long listings; `maxLines` only for excerpts"
- `lead` — Lead paragraph or short opening sentence. type='lead' required={text} optional={align}
- `h1` — Primary in-slide section heading. type='h1' required={text} optional={align}
- `h2` — Secondary in-slide heading. type='h2' required={text} optional={align}
- `text` — Plain semantic body copy. type='text' required={text} optional={align}
- `label` — Small label/chip text. type='label' required={text} optional={align, variant:plain|badge|tag, tone}
- `deck-title` — Dominant cover/section title component. For normal slides, set `slide.title` instead. type='deck-title' required={text} optional={align}
- `slide-title` — Explicit in-content slide title; usually prefer `slide.title` so the renderer places the title in its dedicated rect. type='slide-title' required={text} optional={align}

### 3.8 Data Visualization

- `scorecard` — Status-coded health grid. type='scorecard' required={items:[{label, value, status?:good|warning|danger|neutral, delta?, trend?}]} optional={columns}
- `funnel` — Conversion funnel; chevrons sized by value. type='funnel' required={stages:[{label, value, valueLabel?, tone?}] (max 6)} optional={showDrop}
- `gauge` — Single-value progress dial with threshold bands. Different from `progress-bar` (no zones). type='gauge' required={value, label} optional={max, unit, thresholds:[{upTo, tone:danger|warning|positive|brand, label?}]}
- `heatmap` — N×M colored value matrix, max 12×12. type='heatmap' required={xLabels, yLabels, values:[[number]]} optional={palette:warm|cool|diverging, showValues}
- `matrix-2x2` — 2-axis quadrant matrix. Two authoring modes: `items:[{label,x,y,tone?}]` and/or `quadrantLabels:{tl,tr,bl,br}`; pass at least one. type='matrix-2x2' required={xAxis:{low,high}, yAxis:{low,high}} optional={items, quadrantLabels, quadrantTones}
- `trend-line` — Mini sparkline (decoration next to a metric or heading). type='trend-line' required={values (max 24)} optional={tone, height}
- `stat-flow` — Stat blocks connected by operator text for formulas/KPI cause-effect. type='stat-flow' required={steps:[{value,label,tone?} | {connector: string}] (max 10)}
- `donut-summary` — Primary share + remainder legend. Different from `chart-card` pie. type='donut-summary' required={primary:{label,value}} optional={others, unit, tone}
- `range-plot` — Horizontal min..max range bars (salary bands, CI, ranges). type='range-plot' required={items:[{label,min,max,point?,unit?}]} optional={tone}
- `factorial-matrix` — Labeled 2D matrix; rows + columns both carry meaning. type='factorial-matrix' required={rows, columns, cells:[[string | {text,tone}]]} optional={title}
- `probe-flow` — Experiment/probe walkthrough: input → step(s) → observation. type='probe-flow' required={steps:[{title, body?}]} optional={items (alias), direction}
- `failure-taxonomy` — Failure/risk categories with rate chips and examples. type='failure-taxonomy' required={items:[{title|name, rate|value?, examples?|bullets?, body?}]} optional={columns, tone:brand|warning|danger|neutral}
- `main-effect-comparison` — Main-effect before/after with interpretation. type='main-effect-comparison' required={beforeLabel, beforeValue, afterLabel, afterValue} optional={title, insight, trend, deltaLabel}

### 3.9 Identity, Markers, Action

- `feature-card` — One feature/capability/benefit. Supports iconSrc, badge, content runs, tags, metric proof, source line, compact CTA. type='feature-card' required={title} optional={icon:rect|roundRect|ellipse|triangle|rightTriangle|pentagon|diamond, iconSrc:image-ref, marker, body, content:rich-runs, badge, tags, metric:{value,label,tone?}, proof, ctaText, iconColor, iconBackground, tone, titleColor:color-ref, variant:plain|card|compact, density, surface}
- `logo-strip` — Set of customer/partner/integration logos. type='logo-strip' required={logos:[{src,alt}] | items | images} optional={columns, caption}
- `tag-list` — Short keywords / categories / filters. type='tag-list' required={items} optional={tone}
- `badge` — Single short status chip (NEW, RISK, BETA, DRAFT). type='badge' required={text} optional={tone}
- `icon-text` — Icon plus short label. Vary the icon preset by meaning when listing peers. type='icon-text' required={icon:rect|roundRect|ellipse|triangle|rightTriangle|pentagon|diamond|arrow-right|arrow-down|callout|chevron|star-5|parallelogram|cloud, text} optional={iconColor, iconBackground, tone}
- `section-break` — Full-slide chapter reset. type='section-break' required={title} optional={subtitle, accent}
- `checklist` — Status list with checked/unchecked/warning. type='checklist' required={items:[{text, status?:checked|unchecked|warning}]}
- `profile-card` — Person/role profile. type='profile-card' optional={image:image-ref, name, role, bio}
- `cta` — Explicit next action. One per slide. type='cta' optional={text, tone, link}
- `title-lockup` — Eyebrow + title + subtitle + optional accent rule, as one editorial group. type='title-lockup' optional={title, eyebrow, subtitle, align, tone, rule}
- `eyebrow` — Small kicker classifying the next headline. Pairs above h1/section-title. type='eyebrow' optional={text, tone, rule}
- `accent-rule` — Visual spine, underline, or separator that anchors hierarchy. `thickness` is pt; `length` is cm. type='accent-rule' optional={direction, tone, length, thickness}
- `annotation` — Compact label + one-sentence note attached to a visual. Not for body copy. type='annotation' optional={label, text, tone}
- `side-rail` — Narrow contextual rail beside main content for chapter label, lens, constraints, interpretation. type='side-rail' optional={title, body, tone, accent:left|top}

### 3.10 Decoration & Overlays

`markerSpec` is the safe way to add small item decoration (see Shared Types).
Use raw `shape` only for purposeful geometry; common presets include
`straightConnector`, `elbowConnector`, `curvedConnector`, `hexagon`,
`octagon`, `flowChartProcess`, `flowChartDecision`, `cylinder`, and arrow
shapes. Connectors support `headEnd` and `tailEnd` arrowhead objects.
For exact-positioned diagrams, put raw shapes/connectors as direct slide
children or inside `freeform-group`; do not put absolute `at` coordinates
inside `grid`/`stack`. Use `at:[x,y,w,h]`, `at:{x,y,w,h}`, or direct
`x/y/w/h` aliases in these slide-level/freeform contexts. `fill` and `line`
may be strings or objects such as
`line:{color:"2563EB", width:2, dash:"dash"}`.

- `callout-marker` — Anchored bubble pointing at a region. Different from `annotation` (inline, no anchor). type='callout-marker' required={text} optional={anchor:top-left|top-center|top-right|middle-left|middle-center|middle-right|bottom-left|bottom-center|bottom-right, tone, width, height}
- `pointer-arrow` — Anchored overlay arrow pointing at an image/chart/diagram region. Different from `arrow-link` (inline). type='pointer-arrow' optional={label, direction:right|left|down|up, anchor, offsetX, offsetY, width, height, tone, style:solid|dashed}
- `arrow-link` — Single directional inline connector with optional from/to labels. type='arrow-link' optional={fromLabel, toLabel, label, direction:right|down, tone}
- `decoration-grid` — Geometric pattern background (dots, diagonals, grid). type='decoration-grid' optional={pattern:dots|diagonal-lines|grid, density:sparse|normal|dense, tone:muted|brand, rows, columns, asBackground}
- `decorative-shapes` — Anchored decorative motif cluster. type='decorative-shapes' optional={motif:bubbles|confetti|corner-blobs|sparkles|molecule, anchor:top-left|top-right|bottom-left|bottom-right|full, tone:muted|brand|accent|warning, count, width, height, asBackground}
- `corner-mark` — Small ribbon/stamp/tag in a corner. type='corner-mark' required={text} optional={corner:top-left|top-right|bottom-left|bottom-right, tone, style:ribbon|stamp|tag}
- `brand-mark` — Brand/source label anchored to a corner. Prefer this over hand-coded `at` for "bottom-right" placement. type='brand-mark' required={text} optional={corner, tone:muted|neutral|inverse|brand, width, height, offsetX, offsetY}
- `bracket` — Brace/bracket emphasizing a group. type='bracket' optional={direction:left|right|top|bottom, label, tone}
- `watermark` — Large semi-transparent decorative overlay (DRAFT, CONFIDENTIAL). type='watermark' required={text} optional={rotation, tone:muted|danger|warning|brand}
- `big-page-number` — Decorative page number for cover/section. type='big-page-number' required={current} optional={total, corner, tone:brand|muted}
- `timeline-axis-bar` — Section progress bar at top of section breaks. type='timeline-axis-bar' required={sections (max 8), current (0-based)} optional={tone:brand|neutral}
- `scale-bar` — Horizontal numeric scale with ticks. type='scale-bar' required={max} optional={min, unit, ticks, tone:brand|neutral}

### 3.11 Primitives

Building blocks usually placed by components, but available directly when
needed.

- `text` — Plain body copy (see §3.7). For multi-line bullets use `bullets`.
- `bullets` — Bulleted list. type='bullets' required={items: string[] | [{text|runs:rich-runs}]} optional={title, density, size, marker, numberStyle}
- `shape` — Raw geometry preset. type='shape' optional={preset, fill, line, lineWidth, cornerRadius, rotation, headEnd, tailEnd, thickness, ...}
- `image` — Raster image without card chrome. type='image' required={src:image-ref} optional={alt, fit:cover|contain|fill, opacity, width, height}
- `divider` — Horizontal or vertical thin rule. type='divider' optional={direction, thickness, color, length}
- `spacer` — Empty flex spacing in a stack/grid. type='spacer' optional={fixedHeight, fixedWidth, weight}

### 3.12 Rich Inline Runs

Where a field accepts `rich-runs`, mix:

- `{ text, marks?:["bold"|"italic"|"underline"|"strike"|"code"], color?:color-ref, link? }` — plain runs.
- `{ kind: "math", latex }` — inline OMML math.
- `{ kind: "cite", refId, style? }` — reference cite linked to `deck.references`.
- `{ kind: "footnoteRef", footnoteId }` — footnote marker linked to `deck.footnotes`.
- `{ kind: "icon", src? | marker?, alt? }` — inline icon glyph.
- `{ kind: "token", value, tone?, format? }` — semantic token (e.g. a number with format).

Ordinary markdown-enabled strings in `text` / `paragraph` / `bullets` / table
cells also accept `$...$` and `$$...$$` for math; `markdown:false` and
`code` / `code-block` keep content literal. Unsupported LaTeX commands fail
validation rather than being emitted as plain text.

---

## 4. Routing — Page Job → First Component

Use this table to pick the primary component before writing JSON. Add at
most 1–2 support components.

| Page job                                | First component                | Good support                                    |
|-----------------------------------------|--------------------------------|-------------------------------------------------|
| Executive answer / final synthesis      | `executive-summary`            | `key-takeaway`, `takeaway-list`                 |
| One dominant conclusion with proof      | `chart-with-rail`              | `chart-card`, `table-card`, `bar-list`, `side-rail` |
| Evidence artifact with interpretation   | `evidence-layout`              | `fact-list`, `key-takeaway`, `annotation`       |
| Ranking / market share / distribution   | `bar-list`                     | `donut-summary`, `range-plot`, `heatmap`        |
| KPI / status snapshot                   | `kpi-grid`                     | `scorecard`, `stat-strip`, `hero-stat`          |
| Options / competitors / before-after    | `comparison-table`             | `comparison-list`, `matrix-2x2`, `pros-cons`    |
| Process / value chain / workflow        | `process-flow`                 | `stat-flow`, `funnel`, `arrow-link`             |
| Roadmap / chronology                    | `axis-ruler` or `timeline`     | `timeline-axis-bar`, `process-flow`             |
| Risk / issue taxonomy                   | `failure-taxonomy`             | `matrix-2x2`, `scorecard`, `checklist`          |
| Screenshot / visual walkthrough         | `snapshot-callouts`            | `annotation`, `pointer-arrow`, `callout-marker` |
| One idea plus satellites                | `hero-and-support`             | `feature-card`, `metric-card`                   |
| Long article / reading passage          | `article`                      | `quote`, `glossary`                             |
| Formula / derivation                    | `equation`                     | inline `{kind:"math"}` runs                     |
| Code / SQL / reproducible method        | `code-block`                   | `code` for one short command                    |
| References / bibliography               | `bibliography` + `{kind:"cite"}` runs | `source-note` for one-off provenance     |
| Chapter reset                           | `chapter-divider`              | `timeline-axis-bar`                             |
| Cover                                   | `cover-composition`            | `brand-mark`, `decorative-shapes`               |

Raw `text` is residual: short labels, captions, local notes, or a sentence
inside a designed container. It is not a page-layout strategy.

When the exact fields are unclear, look up 2–4 candidate components in §3
before writing JSON. Schema lookup is cheaper than rebuilding a broken
hand-authored layout.
