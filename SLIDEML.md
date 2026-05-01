# SLIDEML — Cowork Deck Authoring Guide

You are designing a presentation through SlideML2 — a semantic Slide DOM that
compiles to PPTX. Your job is to turn the user's request and source material
into a deck that is **clear, semantically rich, and visually disciplined** —
not a copy of the source's structure, and not a generic dashboard template.

This guide is the design taste; the tool descriptions you already see in the
API are the mechanics. Read this once at the start of every deck task.

## Cowork tool surface (workflow order)

Cowork exposes 6 deck tools backed by SlideML2 (`describe_schema`,
`create_deck`, `read_deck`, `replace_slide`, `patch_deck`, `validate_render`).
You will also use `read_file` (for source materials), `image_gen` (for
illustrations / covers), `run_python` + matplotlib (for data charts that need
exact numbers), and `update_task_progress` (to surface progress in the panel).

```
read_file (source) ─► describe_schema ─► style brief
        ─► create_deck (with themeOverride) ─► replace_slide × N (append by passing slideId == slideCount)
        ─► validate_render ─► fix blocking diagnostics with replace_slide / patch_deck
        ─► validate_render again ─► done when blocking == 0
```

The deck JSON file you write to (`<name>.json`) is the **source of truth**.
`validate_render` writes the .pptx and a sibling `<name>.render-tree.json`;
to edit the deck later, read and patch the JSON, never the .pptx.

## Workflow

1. **Read source.** `read_file(path)` for the markdown / document the user
   referenced. If the user pasted text in chat, use that directly.
2. **Discover vocabulary.** Call `describe_schema()` once. The first call
   returns the deck rules, color tokens, palette, component index, text
   kinds, node types, default theme scaffold, and (when you pass
   `components: [...]`) full per-prop schemas for the components you plan
   to use.
3. **Plan.** Decide:
   - **Audience and content maturity.** A board memo, investor update,
     scientific lecture, product launch, classroom explainer, fan recap,
     and party recap are all different decks. Do not laundry-wash a
     playful prompt into a sober deck unless the deadpan contrast is the
     joke.
   - **Slide count from narrative load**, not a fixed target. Substantial
     reports usually want 8–12 slides; punchy product / event decks may
     fit in 5–7. Each slide carries one job.
   - **Component mix.** Use ≥4 distinct semantic component families when
     the source supports it (`kpi-grid`, `timeline`, `axis-ruler`,
     `process-flow`, `feature-card`, `key-takeaway`, `quote`, `callout`,
     `table-card`, `bar-list`, …). `text` / `stack` / `grid` / `panel` /
     `card` are organization primitives, not semantic variety.
   - **Cover archetype.** Type-led poster, color-field title, evidence-
     led opener, or one-number opener. Reject covers that look like a
     normal content slide with a card grid.
   - **Style brief.** Before authoring, write a short brief in your head:
     subject domain, audience posture, emotional register, palette roles
     (background / surface / primary / secondary / data), typography
     direction (sans / serif / mono support), visual signature, layout
     rhythm, things to avoid. Translate that brief into
     `themeOverride` on `create_deck`.
4. **Create the deck file.** `create_deck({ deckPath, title, brand, themeOverride })`.
   `deckPath` should sit in the cwd unless the user specified another
   directory; use a descriptive slug (`china-history.json`, not
   `deck.json`). Set deck-wide visual identity here, not slide-by-slide.
5. **Author slides.** For each slide, build the JSON object
   `{id, title?, children, ...}` and call
   `replace_slide({ deckPath, slideId, slide })` — pass `slideId` equal to
   the current slide count to **append**. For decks > 5 slides, do not try
   to write all slides in one giant tool call; author them one at a time
   so each gets its own validation cycle.
6. **Validate and render.** `validate_render({ deckPath, outputPath })`.
   It validates schema, renders the `.pptx`, writes the
   `.render-tree.json`, and returns a diagnostics summary plus a
   **blocking** list.
7. **Repair.** Blocking diagnostics are hard failures: `FALLBACK_FAILED`,
   `COLLISION`, `TINY_RECT`, `SQUASHED`, `DROP`, `LOW_CONTRAST`,
   `UNKNOWN_COLOR`, `UNKNOWN_STYLE`. Re-author the offending slide
   (`replace_slide`) — for deck-level fixes (theme tokens, palette,
   chrome, brand) use `patch_deck`. Non-blocking `TRUNCATED` / `DEMOTED`
   warnings deserve a look but don't gate delivery.
8. **Stop only when blocking count is 0.** Hand the user the .pptx path.

## Layout authorship is a hard requirement

A 7-slide deck where every page is a "row of cards" or "column of stuff"
fails. The single most important quality bar:

> **Design each slide's structure from its message; do not route pages
> through one repeated template.**

Use SlideML2 components as semantic vocabulary, then compose them freely
with `stack`, `grid`, `split`, `panel`, `card`, `band`, `frame`, `inset`,
and anchored overlays. Layout diversity should come from your own page
composition decisions: hero metric plus detail rail, evidence image plus
commentary, dense table plus takeaway band, process flow plus risks,
asymmetric split, editorial side rail, full-slide title lockup.

If two slides genuinely need the same structure, keep the shared scaffold
but vary emphasis, density, and visual hierarchy. Fewer well-designed
slides beat more slides that repeat a mechanical template.

## Aesthetic distinctiveness is a hard requirement

Every deck must have a recognizable art direction. A safe off-white +
neutral cards palette is acceptable only for conservative memo work; for
educational, product, cultural, or narrative topics it is a failure of
design.

Name a concrete visual signature in your style brief: `museum field-note`,
`editorial science poster`, `lab notebook`, `precision operating
dashboard`, `launch-stage poster`, `financial command room`. Make that
signature visible on slide 1 and keep it alive across the deck through:

- one strong color field or inverse-type slide,
- one recurring accent rule / rail / ruler treatment,
- one subject-specific data or diagram form,
- one typography hierarchy that is not just default title + body.

Every non-appendix slide needs at least one visible design move:
`side-rail`, `axis-ruler`, `eyebrow`, `accent-rule`, `annotation`, a large
`hero-stat`, an oversized `quote`, a strong `band`, a chart/table as the
visual object, or a meaningful image crop. Do not create visual interest
by adding more cards. Use small components to compose style.

Color-field slides should usually carry only typography, a hero number,
or one very simple mark. Put dense components (`timeline`, `axis-ruler`,
tables, charts, multi-card grids) on light `background` / `surface`
regions so labels stay readable.

Components must be theme-adaptive. Use `tone:"inverse"` on dark fields,
`tone:"brand"` on light fields, `tone:"neutral"` for quiet supporting
surfaces. Avoid raw per-node color hacks unless a diagnostic explicitly
suggests a contrast color.

## Cover and closing design

The cover is **not** a content slide. Pick exactly one cover archetype:

- **Type-led poster:** full-slide background, `title-lockup` at deck-title
  scale, one accent rule, large quiet whitespace.
- **Color-field title:** full-bleed dark color field with inverse
  `title-lockup`; title must dominate the thumbnail.
- **Evidence-led opener:** one large image / chart / number carries the
  page, with a compact `title-lockup` attached.
- **One-number opener:** `hero-stat` or landmark number plus a short
  `title-lockup`; no card grid.

Reject covers with small text in a middle rectangle, equal cards, KPI
strips, or normal slide-title layout. Do not use `tag-list`, `badge` rows,
`feature-card`, `comparison-card`, `metric-card`, or a grid of labels as
cover decoration.

For the cover, leave `slide.title` empty and use `section-break` as the
single content child (or a `band` with `tone:"brand"` holding a deck-title
text + lead subtitle).

The closing slide is also not a normal content slide. Use a large
`key-takeaway`, `title-lockup`, quote, or verdict band. It should feel
like a landing, not another evidence page.

## Theme decisions (encode in `create_deck.themeOverride`)

The default theme is a **neutral scaffold**, not a finished design. Your
first design act on every deck is to install a subject-appropriate
themeOverride. The same `kpi-grid` reads as serious consulting, playful
product, or academic depending on the colors and typography you choose.

| Subject signal | Theme direction |
|---|---|
| Strategy / consulting / board memo | Conservative palette: navy or charcoal `brand.primary`, off-white `background:F7F9FC`, `surface:FFFFFF`. Larger headlines (`slide-title.fontSize: 32`); whitespace (`pageMarginX: 2.0`, `defaultGap: 0.55`). Restrained accents only on KPIs. |
| Product launch / pitch | Warmer brand color (orange / red / pink / electric blue). Bigger hero numbers (`metric-value.fontSize: 36`, `hero-stat 2xl`). `band` with `tone:'brand'` for thesis. `chrome.brandMark: 'bottom-right'`. |
| Engineering / system design | Cooler palette (teal / blue / slate). Tighter density (`paragraph.fontSize: 10`, `defaultGap: 0.45`). Mono font for code (`fonts.mono: ['JetBrains Mono','Menlo']`). |
| Academic / research | Restrained. Serif latin (`fonts.latin: ['EB Garamond','Charter','Georgia']`), large line-height (`paragraph.lineHeight: 1.5`). `text.primary` near pure black. No tinted surfaces unless meaningful. |
| Investor / financial | Brand navy + green/red trend semantics. Generous metric typography. Footer with page number + brand mark. |
| Educational / classroom | Warm paper background, mineral-accent primary, clay/green secondary. `axis-ruler`, `side-rail`, field-note `annotation`. No SaaS dashboard chrome. |

Example shape for `themeOverride`:

```json
{
  "colors": {
    "brand.primary": "0F4C81",
    "background": "FAFAF7",
    "surface": "FFFFFF",
    "text.primary": "1A1A1A",
    "text.muted": "606060"
  },
  "text": {
    "slide-title": { "fontSize": 32, "weight": "bold", "color": "text.primary", "lineHeight": 1.1 },
    "paragraph": { "fontSize": 11, "color": "text.primary", "lineHeight": 1.45 },
    "metric-value": { "fontSize": 28, "weight": "bold", "color": "brand.primary", "lineHeight": 1.0 }
  },
  "component": {
    "card": { "fill": "surface", "line": "divider", "padding": 0.65, "radius": 0.1 },
    "panel": { "fill": "surface", "line": "divider", "padding": 0.6, "radius": 0.1 }
  },
  "layout": { "pageMarginX": 2.0, "defaultGap": 0.55 },
  "fonts": { "latin": ["Inter", "Aptos", "Helvetica"], "cjk": ["PingFang SC", "Noto Sans CJK"] },
  "chrome": { "brandMark": "bottom-right", "pageNumber": true }
}
```

Per-node overrides (`size`, `weight`, `color`, `italic`, …) still work for
tactical adjustments inside a single slide. You may call `patch_deck`
later to refine theme fields after you've laid out a few slides.

## Component philosophy

Reach for the **most semantic component first**. A `kpi-grid` is better
than a hand-rolled grid of `metric-card`s; `stat-comparison` is better
than two `metric-card`s side-by-side. The point of SlideML2 is to encode
meaning, not to recreate hand-positioned PowerPoint.

Compose multiple components per slide when the message benefits: a lead
sentence above a kpi-grid; a callout next to a checklist; a feature-card
grid plus a source-note; a quote inside a band followed by supporting
bullets.

Component fitness guide:

- KPIs / quantitative outcomes → `kpi-grid` with 3–4 metrics.
- Before/after numeric shift → `stat-comparison`.
- Done / not-done audit → `checklist`. Trade-offs → `pros-cons`.
- Pipeline / multi-stage process (3–5 stages) → `process-flow`.
- Long dated sequence → `timeline`.
- Product / feature highlights → grid of `feature-card`.
- Pricing tiers → grid of `pricing-card`; mark exactly one with `tone:"brand"`.
- Partner / customer logos → `logo-strip`.
- Strategic 2×2 → `swot-matrix`.
- Compare 2–4 things with parallel points → grid of `comparison-card`.
- Define a term → `definition-card`.
- % completion / quota → `progress-bar`.
- Hero insight or thesis sentence → `callout` (or `lead`).
- Pull-quote → `quote`.
- Inline KPI row, no card chrome → `stat-strip` (3–6 items in one row).
- Chart / category color key → `legend`.
- "STATUS" / "NEW" / "BETA" annotation → `badge`.
- Cover / chapter / editorial opening typography → `title-lockup`.
- Editorial kicker above a headline → `eyebrow` (use `rule:true` for a
  visual lockup).
- Deliberate underline / side rule / visual spine → `accent-rule`.
- Small label for a diagram, chart, or hero visual → `annotation`.
- Asymmetric contextual column → `side-rail` inside `split` or `grid`.
- Era scale / maturity scale / ordered conceptual range → `axis-ruler`.
- Connector arrow between two regions → `flow-arrow` with optional label.
- Numbered priorities / framework principles → `numbered-grid`.
- Closing verdict / "so what" panel → `key-takeaway`.

Decorative containers (NOT layout): `panel` (tinted surface), `card`
(panel + header/footer/accent), `band` (full-width strip), `frame`
(border-only), `inset` (padding only). Wrap a stack/grid inside one when
grouping needs visual separation. **Never** set `fill`, `line`, or
`cornerRadius` directly on stack/grid — wrap in `panel`/`card` instead.

## Single-headline rule

Each slide carries exactly ONE hero title. Either set `slide.title` (the
renderer auto-places it in the title rect) OR put a `section-break` /
`deck-title` / `slide-title` styled text in the body — never both.

For ordinary content slides, use `slide.title`. For cover and chapter
pages, leave `slide.title` empty and put a `section-break` (or band with
deck-title text) in the body.

## Content shape rules

- `metric-card.value` must be a **short numeric token** — at most ~6 latin
  chars or 4 CJK chars (`$500亿+`, `30%`, `100M`, `7天`). Never use prose
  like `Meta Ray-Ban` or `年底发布眼镜` as a metric value — that is what
  `feature-card`, `comparison-card`, or a plain `lead` paragraph is for.
- `kpi-grid` columns ≤ 3 unless every value is ≤ 3 latin chars. A
  4-column kpi-grid with `$1200亿+` values will wrap.
- `callout` / `lead` / `quote` are the right tools for short qualitative
  claims. Do not overload `metric-card` with prose.
- `hero-stat` is for the landmark number on a slide — far bigger than
  metric-card. Use it once per slide max, when there is a single number
  that *is* the message. Pair with a `lead` underneath.
- `bar-list` is for ranked / comparative numeric series (5–8 items).
  Prefer it over a chart when each row has a clear label.
- `tag-list` is for short keyword sets (3–10 chips). Don't fake it with a
  horizontal stack of `label` text nodes.

## Three-axis text styling: `size` × `weight` × `tone`

Every text node has three orthogonal levers:

| Axis | Field | Values | Purpose |
|---|---|---|---|
| Scale | `size` | `xs`, `sm`, `md`, `lg`, `xl`, `2xl` | Match font size to box width |
| Weight | `weight` | `normal`, `medium`, `bold` | Emphasis without changing size |
| Tone | `color` | theme token (`brand.primary`, palette name) | Semantic color |

Plus shortcut booleans: `italic`, `underline`, `uppercase`, and
`letterSpacing` (pt × 100; positive opens kerning, negative tightens).

**Rule**: prefer one axis at a time. Bold + brand-color + xl is design
noise; bold + text.primary at md is enough emphasis for a headline.

### Size dial — match font size to box width

| Box width | Body / bullets | Card title | Lead / hero |
|---|---|---|---|
| Full slide ≥ 22 cm | md | md | xl–2xl |
| Half-slide 8–14 cm | md | md | lg |
| Card 5–8 cm | sm | sm | md |
| Card 3–5 cm | xs | sm | md |
| Card < 3 cm | xs | xs | sm |

A slide-title is automatically large; do not set `size` on it. For KPI
grids, the renderer chooses a fitting metric-value size; do not override
unless the cards are unusually narrow.

## Color, line, and shape

- **One emphasis color per slide.** Pick `brand.primary` OR a single
  palette color (red/lime/…). Never mix.
- Tinted backgrounds: `panel.tone:"tinted"` for one accent panel,
  `band.tone:"brand"` for ONE hero strip per deck.
- Categorical color (palette) only when the slide has *categorical
  meaning* — process steps, SWOT quadrants, distinct product lines.
- Per-tag color via `tag-list` items: `[{text:"AI",tone:"brand"}, {text:"Risk",tone:"warning"}]`.
- Trend semantics: `success` / `danger` / `warning` / `muted` apply when
  the value carries that meaning. Don't use them for decoration.
- `divider` — neutral separator between two regions of a stack.
- `frame` — borderless wrapper with a clear outline, good for
  placeholder regions or dashed-border emphasis (`dash:"dash"`).
- Shape primitives are for **icons and arrows only**: `arrow-right`,
  `arrow-down`, `ellipse`, `roundRect`, `star-5`, `chevron`, `pentagon`,
  `triangle`. Allowed: a thin colored rect as an accent underline below a
  section-title. Forbidden: shape as a card background, shape as a
  divider, shape as decorative texture.

## Layout vocabulary — break out of pure rows and columns

A page is rarely just a single column or row. Use these primitives to
build genuinely composed layouts:

- **`split`** — primary + secondary regions with an explicit ratio
  (default 0.62/0.38, golden ratio). Use whenever one block is the
  *focus* (chart, large quote, hero metric) and the other is supporting.
- **`grid` with `colSpan` / `rowSpan`** — let a hero cell occupy a 2×2
  region while smaller cells flank it. The "1 big + 4 satellites" pattern.
- **Nested containers** — children of a `split`, `grid`, `panel`, or
  `card` can themselves be stacks, grids, or splits. Two levels of
  nesting is normal; three is fine when the message demands it.

## Composition examples (copy when they fit)

### A. Hero chart + sidebar bullets (split)
```json
{ "id": "s1.body", "type": "split", "area": "content",
  "direction": "horizontal", "ratio": [0.62, 0.38], "gap": 0.6,
  "children": [
    { "id": "s1.chart", "type": "chart", "chartType": "line",
      "labels": ["Q1","Q2","Q3","Q4"],
      "series": [{ "name": "ARR", "values": [8.1, 9.7, 11.2, 12.4] }] },
    { "id": "s1.notes", "type": "stack", "direction": "vertical", "gap": 0.4,
      "children": [
        { "id": "s1.lead", "type": "lead", "text": "Enterprise drove the lift." },
        { "id": "s1.bullets", "type": "bullets", "density": "compact",
          "items": ["6 new logos > $200K", "Net retention 109%", "Top-of-funnel +24%"] }
      ] }
  ] }
```

### B. Hero metric + satellite KPIs (grid with colSpan/rowSpan)
```json
{ "id": "s2.dash", "type": "grid", "area": "content",
  "columns": 4, "rows": 2, "gap": 0.5,
  "children": [
    { "id": "s2.hero", "type": "panel", "tone": "tinted",
      "colSpan": 2, "rowSpan": 2,
      "children": [{
        "id": "s2.hero.body", "type": "stack", "direction": "vertical", "gap": 0.3,
        "children": [
          { "id": "s2.hero.value", "type": "metric-card",
            "value": "$12.4M", "label": "ARR Q4", "trend": "up" },
          { "id": "s2.hero.note", "type": "lead",
            "text": "Best quarter on record." }
        ] }] },
    { "id": "s2.k1", "type": "metric-card", "value": "109%", "label": "Net retention", "trend": "up" },
    { "id": "s2.k2", "type": "metric-card", "value": "32",   "label": "New logos",      "trend": "up" },
    { "id": "s2.k3", "type": "metric-card", "value": "14d",  "label": "Time to value",  "trend": "down" },
    { "id": "s2.k4", "type": "metric-card", "value": "8.3%", "label": "Logo churn",     "trend": "flat" }
  ] }
```

### C. Editorial rail + axis-ruler (creative)
```json
{ "id": "s6.body", "type": "split", "area": "content",
  "direction": "horizontal", "ratio": [0.28, 0.72], "gap": 0.6,
  "children": [
    { "id": "s6.rail", "type": "side-rail", "tone": "brand",
      "title": "尺度感", "body": "先建立时间轴，再解释机制。" },
    { "id": "s6.main", "type": "stack", "direction": "vertical",
      "gap": 0.35, "children": [
        { "id": "s6.kicker", "type": "eyebrow", "text": "DEEP TIME", "rule": true },
        { "id": "s6.lead",   "type": "lead",
          "text": "45 亿年的地球史不是背景，而是生命演化的实验场。" },
        { "id": "s6.axis",   "type": "axis-ruler", "items": [
          { "label": "冥古宙", "body": "地壳与海洋" },
          { "label": "太古宙", "body": "微生物代谢" },
          { "label": "显生宙", "body": "动物生态" }
        ] },
        { "id": "s6.note", "type": "annotation",
          "label": "DESIGN", "text": "用尺规而不是卡片表达尺度。" }
      ] }
  ] }
```

When in doubt, *nest two layouts inside one slide* rather than spreading
the same content thinly across two slides. A `split` whose primary side
is itself a `grid` of `feature-card`s reads as one composed thought.

## Hard schema rules

- Output only valid SlideML2 source-deck JSON. Component name goes
  directly in `type`. Fields are flat, never wrapped in `props`.
- `area:"content"` is a placement hint for the standard content rect, not
  a required single root. When multiple components need coordinated
  layout, wrap them in an explicit `stack` / `grid` / `split`.
- All distance fields are in cm (`gap`, `padding`, `fixedHeight`,
  `fixedWidth`).
- Color tokens only. Never set `fontSize`, `fontFace`, or raw hex `color`
  on text nodes. Semantic palette names (`red`, `lime`, `blue`, …) carry
  *categorical* meaning; max ~4 per slide.
- Mark nice-to-have children with `optional: true` so the renderer can
  drop them when space is tight.
- If a slide intrinsically has more content than fits, **split into two
  slides**. Don't fight the layout solver.

## Diagnostic playbook

`validate_render` returns diagnostics with codes. Blocking codes (must
resolve before delivery):

- **`LOW_CONTRAST`** — a text run sits on a too-similar background. The
  diagnostic carries a `suggestion` with a contrasting hex. Apply it via
  per-node `color` or shift the surrounding tone (`tinted`/`inverse`).
- **`COLLISION`** — two non-overlay rects intersect. Restructure with a
  `split` / `grid`, give one element `optional:true`, or split the slide.
- **`FALLBACK_FAILED`** — container truly cannot fit; the solver
  exhausted shrink → demote → drop. Split the slide.
- **`TINY_RECT`** — a node was assigned an unrenderable rect; usually
  means too many siblings competing for space. Reduce columns, switch to
  a denser component (`stat-strip` / `bar-list` / `axis-ruler`), or split.
- **`SQUASHED`** — a meaningful component got a technically renderable
  but unusably narrow/short rect. Treat as failed layout: reduce columns,
  use `split` / `axis-ruler` / `table-card`, or split the slide. Do not
  accept squeezed cards or vertical-looking labels.
- **`DROP`** — an `optional` child was removed because of overflow. If
  the dropped item was actually important, restructure the slide.
- **`UNKNOWN_COLOR`** / **`UNKNOWN_STYLE`** — token not in theme. Use the
  tokens listed in `describe_schema().palette` and `defaultTheme`, or add
  the missing token via `patch_deck` on `themeOverride`.

Non-blocking warnings to review but not gate delivery:

- **`TRUNCATED`** — autofit-shrink applied to make text fit. Consider
  shorter copy.
- **`DEMOTED`** — bullets density auto-demoted; consider re-authoring.
- Minor **`OVERFLOW`** — children exceeded available space; solver
  shrank.

When you see `FALLBACK_FAILED` or `TINY_RECT`, do not tweak cm sizes.
Restructure the slide (split, drop a child, simplify).

## Vertical / horizontal alignment

`justify` controls main-axis alignment when content doesn't fill:

- `justify:"start"` (default) — top (vertical) or left (horizontal)
- `justify:"center"` — center along main axis. Pair with `align:"center"`
  to perfectly center a block.
- `justify:"end"` — bottom or right.

`align` (cross-axis) for `start | center | end`. `valign` is the same as
`align` for horizontal stacks.

## Output contract for cowork

- Save the deck JSON in the working directory unless the user specified
  another path. Use a slug filename (`china-history.json`).
- The .pptx output goes to the same directory by default
  (`<deckPath>.pptx`); pass `outputPath` to `validate_render` only if the
  user asked for a specific location.
- For decks > 5 slides, surface progress through `update_task_progress`
  with a `steps[]` checklist (one step per slide or per phase). Mark the
  step `done` after `validate_render` returns blocking == 0.
- Do not paste slide JSON in chat. Each slide goes through `replace_slide`.
- After delivery, the user can edit the deck again by referencing the
  deck JSON path; you can `read_deck` it and use `replace_slide` /
  `patch_deck` without regenerating from scratch.

## What NOT to do

- Do not roll your own `run_node` + `pptxgenjs` script. It bypasses
  validation and the typed components.
- Do not edit the .pptx binary after a successful render.
- Do not silently truncate content when you see `OVERFLOW` / `TRUNCATED`
  / `SQUASHED`. Split the slide, switch to a denser/larger component, or
  reduce density.
- Do not use raw hex color on text nodes. Use theme tokens.
- Do not put `fill` / `line` / `cornerRadius` on a `stack` or `grid`.
  Wrap in `panel` or `card` instead.
- Do not ship a deck with non-zero blocking diagnostics.
