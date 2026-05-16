---
name: slideml2
description: Generate, edit, and validate PowerPoint (.pptx) decks from prompts, notes, markdown, CSV/JSON data, or research/business documents. Use whenever the user asks for a slide deck, presentation, PPT, PPTX, demo slides, 幻灯片, 演示文稿, 投影, 汇报, or any finished deck file as output. The skill drives the SlideML2 CLI toolchain with per-slide validation and emits a real `.pptx` plus a render-tree sidecar — not screenshots or HTML approximations.
version: 1.0.52
license: Proprietary. LICENSE.txt has complete terms
---

# SlideML2 — PPTX Deck Authoring Toolchain

## What This Skill Does

SlideML2 turns a brief, plan, data file, markdown source, or research document
into a complete `.pptx` presentation. The agent calls a CLI
(`init-deck`, `set-deck`, `validate-slide`, `validate-manifest`, `compose`)
that treats slides as independent source files and uses `manifest.json` as the
only slide-order authority. `compose` then validates and emits native OOXML —
not a screenshot or HTML approximation. The final output is a real PowerPoint
file the user can open, edit, present, or distribute.

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

- A validated `.pptx` saved at the user-specified `--out` path.
- A `.render-tree.json` sidecar with measured layout, data lineage, and diagnostics.
- Per-slide compiler-style diagnostics during authoring so the agent can
  repair each page before the final render.

## How to Read This File

This file has three sections:

1. **Tool Path** — how to invoke the CLI and the per-slide loop.
2. **Layout Rules** — composition, capacity, theme, escape hatches, data binding.
3. **Component Reference** — public component `type`s exposed by this skill,
   with required and optional fields.

Planning-archive templates live in `planning-template.md`.

---

## 1. Tool Path

### Invocation

Run the CLI from the deck workspace. The default deck config source is
`./deck-config.json`; use `--deck <path>` only when intentionally targeting
another config file.

```bash
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" <command> [args] [--deck deck-config.json]
```

Use `help` whenever uncertain:

```bash
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" help
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" help compose
```

This file is the reference manual. For the latest parameter shape of a specific
command, run `help <command>` before writing its JSON file.

The CLI prints JSON with `ok`, `command`, `stage`, `status`, `deckModified`,
diagnostics, and paths. Common statuses: `ok`, `usage-error`, `input-error`,
`schema-error`, `render-error`, `target-missing`, `target-exists`. Exit codes:
`0` ok, `2` usage/input, `10` source/schema validation, `20` render/layout
validation, `30` target conflict/missing, `1` unexpected runtime error.

### File Roles

| File | Writer | Contents |
|---|---|---|
| `deck-config.json` | agent via `init-deck` / `set-deck` | Deck metadata, theme, data, refs, chrome; no slides. |
| `slides/*.json` | agent by direct file write/edit | One standalone slide object per file. |
| `manifest.json` | agent | Slide order as `slides:[{id,file}]`. |
| `build/deck.json` | CLI via `compose --write-source` | Full composed deck source; do not hand-edit. |
| `build/deck.pptx` | CLI via `compose --out` | Final PowerPoint file. |

Filename prefixes such as `slides/01-cover.json` are an agent convenience only.
The CLI reads only `manifest.slides[].file`; it never infers order from
filenames, file creation time, or command order.

Use normal file reads to inspect JSON files; the CLI has no read-deck command.
Before `set-deck` replaces `references`, `footnotes`, or `dataSources`, read the current value and construct the complete replacement.

### Commands

| Command | Purpose |
|---|---|
| `init-deck <deck-init.json>` | Create a new `deck-config.json`. Fails if the target exists. |
| `set-deck <deck-props.json>` | Patch theme/config/data/references in the deck config. |
| `validate-slide <slide.json>` | Validate one standalone slide file with no side effects. |
| `validate-manifest <manifest.json>` | Validate manifest entries, referenced slides, and full composed layout with no writes. |
| `compose <manifest.json>` | Atomically compose ordered slide files into final deck source and/or PPTX. |
| `slice-icons <sheet-image>` | Slice an AI-generated PNG/JPEG icon sheet into individual PNG icons and `assets/icons/manifest.json`. |
| `help [command]` | Print command-specific help and argument examples. |

Common flags:

- `--deck <path>` targets a config file other than `./deck-config.json`.
- `--out <path>` sets PPTX output for `compose`.
- `--write-source <path>` sets the composed full deck JSON output path.
- `--icons <path>`, `--out-dir <path>`, `--grid 2x2`, and `--output-size 768`
  are for `slice-icons`.
- `--dry-run` validates `init-deck`, `set-deck`, or `compose` without writing; prefer `validate-manifest` over `compose --dry-run` unless CI needs the same line.

### Argument Files

`deck-init.json` contains deck options only:

```json
{ "title": "Deck title", "size": "16x9", "theme": "default", "themeOverride": {}, "validation": {} }
```

`deck-props.json` contains deck-level fields only. `themeOverride` deep-merges.
Other supplied deck fields replace that whole field: `brand`, `validation`,
`chrome`, `master`, `dataSources`, `references`, `footnotes`, `metadata`. To
add a reference, footnote, or data row, provide the complete replacement field.
Slides stay in `slides/*.json`; `set-deck` never changes slide order/content.

```json
{ "themeOverride": { "colors": { "brand.primary": "0F766E" } } }
```

`slides/N.json` contains the slide object directly. Do not wrap it in
`{ "slide": ... }` and do not include command metadata in the JSON file.

```json
{ "id": "cover", "title": "Deck title", "transition": { "type": "fade", "durationMs": 350 }, "children": [] }
```

`manifest.json` contains `slides` and may include human metadata. The CLI uses
only `slides`. Each entry needs unique `id` plus `file` relative to
`manifest.json` unless absolute. Prefer manifest id = slide `id`; positional
aliases like `slide5` are accepted for internal-link workflows. There is no
`enabled:false`; remove an entry to omit a slide.

```json
{
  "slides": [
    { "id": "cover", "file": "slides/01-cover.json" },
    { "id": "market", "file": "slides/02-market.json" }
  ],
  "notes": "human-only metadata is ignored by the CLI"
}
```

### Validation Scope

Deck config is validated by `init-deck` / `set-deck` and re-read by every gate,
so deck-level token, color, or data errors can surface during the next single-slide validation.

- `validate-slide` checks one slide with `deck-config.json` context and per-slide render diagnostics; it does not prove manifest order.
- `validate-manifest` checks manifest shape, file refs, duplicate ids, slide id matches, all referenced slides, and composed layout; it writes nothing.
- `compose` runs the same gates, then writes `build/deck.json` and/or `build/deck.pptx` only after validation succeeds.

`validate-manifest` and `compose` return `manifestValidation`,
`sourceValidation` / `validation`, `renderValidation`, `diagnostics`,
`slideCount`, and `slides`. Error channels:

- `manifestValidation.errors` → manifest/file/id problems.
- `sourceValidation.errors` → slide/component problems with `slideId` / `path`.
- `diagnostics.blocking` → rendered layout blockers.

Issue shapes: `manifestValidation.errors[]:{code,path,message}`;
`sourceValidation.errors[]:{code,slideId,path,message,suggestedFix?}`;
`diagnostics.blocking[]:{code,severity,slideId,nodeId,measured,suggestion,constrainedBy?}`.

### Canonical Loop

`plan.md -> init-deck -> serial slide gate -> validate-manifest -> compose`

```bash
cd "$DECK_WORKDIR"
# first fill plan.md from planning-template.md
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" init-deck deck-init.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" validate-slide slides/01-cover.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" validate-slide slides/02-market.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" validate-manifest manifest.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" compose manifest.json --write-source build/deck.json --out build/deck.pptx
```

### Serial Slide Gate

Hard rule: write one `slides/N.json`, immediately run one visible
`validate-slide slides/N.json`, repair that file until it passes, then move to
the next slide. This keeps every repair loop one slide to one diagnostic set.

Pre-validate self-check before each `validate-slide`:

- Is there one primary object owning ~60–70% of the content area?
- Is any support limited to 1–2 light modules (`key-takeaway`, `side-rail`, source)?
- Does `slide.title` duplicate a visible title inside `children`?
- Are bullets authored as `bullets.items`, not raw text containing `•`?
- Are colors theme tokens/tone/surface choices, not scattered raw hex overrides?
- If a component feels cramped, split the page before changing its semantics.

### Never Do This

- Do not batch in create or modify mode. Write/edit one slide file, validate it,
  repair it, then continue.
- Do not generate all new slide files or edit several existing slides before
  validating them one by one.
- Do not batch `validate-slide` with loops, generated scripts, `find`, `xargs`,
  `parallel`, Node, or Python.
- Do not create `slides/03-fixed.json` after a failed slide; repair the same file.
- Do not hand-edit `build/deck.json`. Do not write the deck with `python-pptx` or similar; always go through `compose`.

Forbidden batch example:

```bash
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" validate-slide slides/01.json slides/02.json
node validate-all-slides.js
```

### Task Modes

- `create` — new deck from a prompt, notes, data, markdown, or research. Start
  by writing `plan.md` from `planning-template.md`, then run `init-deck`.
- `modify` — edit the relevant `slides/N.json`, `manifest.json`, or
  `deck-config.json`, then rerun `validate-slide`, `validate-manifest`, and
  `compose`.
- `repair` — fix a failed `validate-slide`, `validate-manifest`, or `compose`.
  Read the named slide/manifest/config file, repair its node, and retry the
  smallest relevant command.
- `review` — inspect and report without writing; prefer `validate-slide` and
  `validate-manifest`.

### Planning Archive

For `create` mode, fill `plan.md` from `planning-template.md` before
`init-deck`. Required sections: Brief; Deck Plan with id/title/job/archetype/
component/layout intent/density risk; Theme Contract; Asset Plan; Coverage
Check. Reference it while writing each `slides/N.json`; update it when a repair
changes a slide's archetype, component, or layout intent.

### Reading Diagnostics

CLI results are compiler-like. `ok:false` with `status:"schema-error"` means the
source JSON or component contract failed. `ok:false` with `status:"render-error"`
means the source is valid but rendered layout would overflow, overlap, clip, or
trigger a blocking visual diagnostic. `deckModified:false` means the deck source
was not changed.

Repair entry point: `manifestValidation.errors` → edit `manifest.json`;
`sourceValidation.errors` → edit `slides/<slideId>.json` at `path`;
`diagnostics.blocking` → edit the node named by `slideId` / `nodeId`.

Repair preference order:

1. Fix the named node or field exactly where diagnostics point.
2. Adjust area, ratio, density, padding, rows/items/labels, or page split.
3. Loosen the constraining parent identified by `constrainedBy`, if present.
4. Change component type only when it better represents the content, not merely
   because another component is easier to pass validation.

`diagnostics.blocking` are the errors to repair before continuing. `quality`
diagnostics can remain only when they do not visibly harm the user request.

## 2. Layout Rules

### 2.0 Slide Object Fields

A slide JSON file used by `validate-slide` and `compose` supports:

- `id` required stable slide id.
- `title` optional default visible title. Set it only when you want the
  renderer's standard title band. Omit it for full-canvas custom covers,
  magazine/poster layouts, or pages that already render their own visible
  title inside `children`.
- `background` optional token, 6-char hex, gradient/fill object, or image
  `{src}`.
- `transition` optional native PowerPoint slide transition:
  `{type:"none"|"fade"|"push"|"wipe"|"split"|"cover"|"uncover",
  direction?:"left"|"right"|"up"|"down", durationMs?:number}`.
  Use canonical `type` values.
- `notes` optional speaker notes.
- `children` required array of layout nodes/components; it may be empty when
  all content is in `background` or a rendered title system.

### 2.1 Slide Family Map

PowerPoint vocabulary bridge: Title Slide ≈ Cover; Section Header ≈ Section
break; Two Content / Comparison ≈ comparison content; Picture with Caption ≈
data+interpretation or walkthrough.

Use family as a planning check, not a closed taxonomy. For short, editorial,
poster, showcase, or highly custom decks, you may jump directly to a recipe or
custom archetype if `plan.md` states the layout intent and pacing reason.

| Family | Use | Typical count in a 12–20 slide analytical deck | SlideML2 entry |
|---|---|---:|---|
| Cover | First slide | 1 | `cover-composition` |
| TOC / Outline | Navigation for 10+ content slides | 0–1 | `outline` |
| Section break | Topic reset | 0–3 | `chapter-divider` |
| Content analytic | Main argument pages | 8–10 | choose archetype in §2.2 |
| Comparison | Options, competitors, trade-offs | 0–2 | `comparison-table`, `pros-cons` |
| Data evidence | One data star | 1–2 | `chart-with-rail`, `evidence-layout` |
| Hero stat | One decisive number | 0–1 | `hero-stat`, `cover-composition` |
| Process / timeline | Flow or time sequence | 0–2 | `process-flow`, `timeline` |
| Walkthrough | Screenshot / image observations | 0–2 | `snapshot-callouts` |
| Executive summary | Integrated answer | 1 | `executive-summary` |
| Reading / long-form | Article-like passage | 0–1 | `article` |
| Closing | Takeaways / action | 1 | `takeaway-list`, `cta` |

For analytical decks, any non-content family >50% or 3+ consecutive
same-archetype content slides is a redesign signal unless `plan.md` explicitly
marks the deck as editorial, lecture/reference, appendix, or showcase material.

### 2.2 Compositional Archetypes

After family, pick or name the page's composition job:

| Archetype | Use when | Typical primary |
|---|---|---|
| Claim + proof | One conclusion plus one proof object | `chart-with-rail`, `evidence-layout` |
| Hero + satellites | One idea leads, 2–4 modules support | `hero-and-support` |
| Data + interpretation | Chart/table dominates with a read rail | `chart-with-rail` |
| Peer comparison | Equal-status options | `comparison-table`, `comparison-card` grid |
| Process / time | Sequence is the meaning | `process-flow`, `timeline` |
| Screenshot walkthrough | Image plus numbered observations | `snapshot-callouts` |
| Executive synthesis | Memo-style answer | `executive-summary` |
| Editorial statement | Quote, manifesto, provocation, or breath page | `title-lockup`, `quote`, `band`, `key-takeaway` |
| Single visual / diagram | One image, artifact, or system diagram carries the page | `image-card`, `freeform-group`, `annotation` |
| Decision matrix | Criteria, weighted options, or two-axis choice | `comparison-table`, `matrix-2x2`, `scorecard` |

Archetypes are starting points. If none fits, use a custom layout intent in
`plan.md`; still declare the reader path, dominant object, and supporting
components before writing JSON.

### 2.3 Composition

- For analytical/report decks, content slides ≥ 70% of total. Chrome (cover,
  TOC, section-break, closing) ≤ 30%.
- A balanced 12–20 slide business/research deck usually has 1 cover, 0–1 TOC,
  1 executive summary, 1–3 section breaks, 1 closing, and 8–14 content slides across at least 3 archetypes.
- One hero per slide. At most one element at deck-title / cover-title /
  hero-stat / metric-value scale.
- Default order is cover → TOC → content. Below ~10 content slides, drop the
  TOC. A TOC must earn its place with per-chapter body, page number, or thesis.
- Section-break thresholds: 4–8 content slides → 0–1 break; 9–14 → 1–2;
  15+ → 2–3. Never use a break around a single content slide.
- No section-break + single content slide + section-break pattern. Merge the
  lone slide into a neighboring section or expand it into a real chapter.
- Pick layout intent before component: claim+proof, hero+satellites,
  data+interpretation, peer comparison, process/time, screenshot, synthesis,
  editorial statement, single visual/diagram, or decision matrix.
- Prefer recipes when they express the page faster than raw component picking:
  memo answer = `executive-summary` + optional `key-takeaway`; data evidence =
  chart/evidence 60–70% + rail/source note; walkthrough = `snapshot-callouts`
  + takeaway; editorial pause = `title-lockup`/`quote`/`band` with ≥40% open
  space; process explainer = `process-flow` + short synthesis.
- Build rhythm deliberately: alternate dense evidence with lighter
  interpretation, use overview → detail → overview, and place a landmark
  `chapter-divider` or `hero-stat` after long sections.
- Make hierarchy visible: the primary object usually owns 60–70% of the
  content area; rails stay ≤35%; sources/captions stay visually secondary;
  emphasize only the 1–2 elements the reader should see first.
- Use asymmetric splits such as `[0.62,0.38]` or `[0.7,0.3]` when evidence and
  interpretation have different weights. Use `[0.5,0.5]` only for true peers.
- Vary primary archetype across the deck. Avoid 3+ consecutive slides with the
  same primary component or layout intent unless the content truly demands it.
- In `plan.md`, count repeated archetypes. ≥3 table-only pages, ≥4 equal-card grids, or 5+ slides without data evidence is a redesign signal.
- No bare "Thank You / End" slide. Replace with 3–5 takeaways, the strongest
  data point, or contact / QR. If the deck truly ends there, drop the slide.
- A `slide.title` plus a visible title in `children` is a duplicate layout.
  Pick one. For custom editorial pages, omit `slide.title` and place the
  title yourself; for standard business pages, use `slide.title` and do not
  add another title text box.
- When repairing density, preserve semantic ordinals: "判断 1/2/3",
  "Step 1/2/3" must stay visible in the title, eyebrow, label, or first card.

### 2.4 Deck-Level Antipatterns

Fix these in `plan.md` before writing slide JSON. Treat them as analytical-deck
smell tests; deliberate editorial/showcase repetition is acceptable when the
layout intent says why.

- Same-archetype run: 3 chart-card pages, 4 feature-card grids, or 3 table-only pages in a row.
- Equal-card monoculture: ≥40% of content slides are card grids.
- Chrome bloat: cover / TOC / section / closing family >30%.
- Single-slide section: section-break + one content slide + section-break.
- No evidence: 5+ consecutive content slides without chart/table/evidence.
- Density flat-line: every content slide is medium-density text with no hero stat, quote, full-bleed image, or minimal page.

### 2.5 Density & Capacity

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
- High-risk fit rules:
  - `chart-card`: do not place a chart in a short rail, banner, or skinny
    strip. Reserve a chart body around 4.8×3.0cm for bar/line/combo and
    5.2×4.4cm for pie/doughnut, before title/caption chrome.
  - `table-card` / `analytic-table`: 5+ rows or 4+ columns should own a
    half/full slide region. Use `density:"compact"`, `encoding.columns.width`,
    or pagination; never drop labels/columns just to pass validation.
  - `process-flow`: horizontal is for 2–3 rich stages. Use vertical or split
    across slides for 4+ stages with body text.
  - `feature-card`: 2–4 peer cards per slide. Long proof/body text belongs in
    `fact-list`, `takeaway-list`, or a follow-up slide.
  - `equation` / `code-block`: give formulas/code a wide block; avoid pairing
    several formulas/code blocks with dense charts or tables on one slide.
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

### 2.6 Theme & Units

- `deck.size`: `16x9` (default), `16x10`, `4x3`, or `wide`. Use what the user
  asks for; do not force 16:9.
- `deck.validation.mode`: `standard`, `strict`, or `experimental`. `strict`
  requires image `alt` and chart/table source metadata.
- Business/research decks default to light analytical themes: white surface, one brand accent, stable success/warning/danger, dark only for cover/section/hero-stat or explicit requests.
- Top-level `themeOverride` keys: `colors`, `text`, `component`, `tone`,
  `layout`, `fonts`, `chart`, `chrome`, `imageGrowWeight`, `sizeScale`,
  `guidance`. Flat dot keys (`"brand.primary"`) and nested objects both work.
- `themeOverride.layout`: `pageMarginX`, `titleTop`, `titleHeight`,
  `contentTop`, `contentBottom`, `defaultGap`, `columnGap`, `cardPadding`,
  `areas`, plus `slideWidthCm` / `slideHeightCm`. There is no `pageMarginY`.
- `contentTop` and `contentBottom` are y-coordinates. `contentHeight =
  contentBottom - contentTop`. On 16:9, `contentBottom` is usually 13.0–13.5.
- `themeOverride.layout.areas`: `{ name: {x,y,w,h} | {left,top,right,bottom} }`.
  Built-in names `content` and `full` may be overridden when the whole deck needs
  a different content/full rectangle. Other names are also valid; pick semantic
  names like `main`, `rail`, or `figureZone` and reference from a top-level node
  with `area:"name"`.
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
  - Common explicit strings are accepted for layout lengths: `"12px"`,
    `"8pt"`, `"0.4cm"`, `"4mm"`, `"0.16in"`. Prefer cm in final JSON.
  - pt for type: `fontSize`, `lineWidth`, `borderWidth`, `thickness`.
  - `lineSpacing` is special: values `<=3` are multipliers (`1.5` = 150%);
    values `>3` are explicit points. Prefer `1.15–1.8` for prose.
  - normalized `0..0.5` for `cornerRadius` (it is a roundRect fraction,
    not cm or px).
- Style precedence: theme → derived component tokens → primitive-node
  override (`fontSize`, `fontWeight`, `color`, etc.) → rich-run field. Node
  and run overrides do not change the theme for other components.
- `optional:true` is an agent edit hint, not silent deletion permission. The
  renderer preserves optional children by default and reports capacity pressure.
  Only use `autoDrop:true`, `dropWhenTight:true`, or `fallback:"drop"` for
  decorative/non-semantic extras you truly allow the renderer to remove.
- Layout spacing: `stack` has a default gap (`theme.layout.defaultGap`, often
  0.5cm; generated content/two-column stacks often use 0.35cm). Set `gap`
  explicitly when spacing matters. A `spacer` between two stack children is an
  explicit gap replacement, not `gap + spacer + gap`; use `gap:0` only when you
  want fully manual spacing.
- Padding is container inset, matching OOXML text-box/body insets: it should
  separate content from a card/callout/quote surface edge, not act as extra
  row spacing between children. Avoid large padding in tight regions; renderer
  may cap content-hug component padding so text remains readable.

### 2.7 Escape Hatches

Components cover ~90% of slides. Use these only for editorial moments:
covers, section openers, hero stats over photography, or annotation overlays.

| Goal                                                                  | Primitive                                  |
|-----------------------------------------------------------------------|--------------------------------------------|
| Reusable side rail, main evidence pane, or fixed repeated region      | `themeOverride.layout.areas` + `area:"x"`  |
| Diagonal headline, hero number on cover, custom poster page           | `at:[x,y,w,h]` / `{x,y,w,h}` + rotation    |
| Image as card background, scrim over content, deco behind text        | `layer:"behind"` or `"above"` on flow child |
| Badge / flag / callout attached to another element                    | `anchorTo:"nodeId"`                         |

Notes:

- `area:"content"` uses the protected content rect; with `slide.title` it
  stays below the injected default title.
- Do not combine `area` with `at` / `anchor` / `anchorTo` on the same node.
- Do not place separate `at` text boxes on top of an `area:"content"` node;
  either move `contentTop` below it, define named areas for both regions,
  or put them inside one `stack` / `split`.
- If a custom title system uses `at` or named areas, omit `slide.title` to
  avoid duplicate titles.
- For edge-to-edge image rails/backgrounds, use the real slide dimensions.
  16:9 is 25.4 × 14.288 cm; `contentBottom`/13.2/13.3 is not full height.
  For a full-slide visual, prefer `slide.background:{src}`. For a left/right
  rail, set `at:[0,0,w,14.288]` (or the current slide height).
- `layer:"behind"` does not consume flow space and is exempt from overlay
  occlusion checks. `layer:"above"` participates in occlusion detection.

### 2.8 Data Binding

Use deck-level `dataSources` and `bind` + `encoding` whenever the same data
backs multiple components. Hand-authored `labels` / `series` / `rows` are
fine for one-off data.

```json
{
  "dataSources": {
    "sales": {
      "type": "inline-json",
      "rows": [
        { "month": "Jul", "region": "NA", "revenue": 920, "margin": 0.34 },
        { "month": "Aug", "region": "EU", "revenue": 390, "margin": 0.24 }
      ]
    }
  }
}
```

Source types: `inline-json` (rows), `inline-csv` (text), `file-csv` (path
relative to deck JSON), `computed` (derived from another source with
`field`, `literal`, `add/sum`, `subtract`, `multiply`, `divide/ratio`,
`percent-change`, `negate`, `abs`, `round`, `concat`, `coalesce`). No JS or
formula strings.

`bind`: `{ source, select?, filter?, groupBy?, aggregate?, pivot?, sort?, limit? }`.
Resolution order: filter → groupBy/aggregate → pivot → sort → limit →
component `encoding`. Do not combine `pivot` with `groupBy`/`aggregate` in
the same view.

Common bind aliases are accepted but canonical names are preferred:
`dataSource|dataset|from → source`, `fields|columns → select`,
`where → filter`, `group|group_by|by → groupBy`,
`aggregates|measures → aggregate`, `order|orderBy → sort`,
`top|take|maxRows → limit`.

Common encoding aliases are accepted: `category|dimension → x`,
`measure|metric|metrics → y`, `seriesBy|group|colorBy → series`,
`name|categoryLabel → label`, `amount|metricValue → value`,
`fields → columns`, and `seriesConfig → seriesOptions`. Field matching is
case-insensitive and accepts common semantic synonyms such as
label/name/category, value/amount/measure, percent/pct, and headcount/hc.

- `filter`: scalar equality, array inclusion, or operator object
  `{ in, eq, ne, contains, gt, gte, lt, lte }`.
- `aggregate` ops: `sum`, `avg`, `min`, `max`, `count`, `first`, `last`.

Bound chart:

```json
{
  "type": "chart-card", "chartType": "bar", "title": "Q3 revenue",
  "bind": { "source": "sales", "groupBy": "month",
            "aggregate": { "Revenue": { "op": "sum", "field": "revenue" } }, "sort": "month" },
  "encoding": { "x": "month", "y": "Revenue", "seriesName": "Revenue" },
  "caption": "Source: deck.dataSources.sales"
}
```

For combo charts or secondary axes, bind all numeric series explicitly in
`encoding.y`, style them with `series` or `encoding.seriesOptions`, and use
`secondaryYAxis` only when at least one series has `axis:"secondary"`.
Accepted `encoding.y` forms: `"revenue"`, `["revenue","margin"]`, or
`{"revenue":{"seriesName":"Revenue","chartType":"bar","axis":"primary"},
"margin":{"seriesName":"Margin","chartType":"line","axis":"secondary"}}`.
If `seriesOptions` is keyed by display name, it is merged into the matching
`seriesName`; still prefer field keys when possible.

Bound table:

```json
{
  "type": "table-card",
  "bind": { "source": "sales", "groupBy": "region",
            "aggregate": { "Revenue": { "op": "sum", "field": "revenue" },
                           "Margin": { "op": "avg", "field": "margin" } },
            "sort": "-Revenue" },
  "encoding": { "columns": [{ "key": "region", "label": "Region" },
    { "key": "Revenue", "type": "currency", "align": "right" },
    { "key": "Margin", "type": "percent", "align": "right" }] }
}
```

Column `type` should be `text`, `number`, `percent`, `currency`, or `date`.
Common numeric aliases such as `int`, `integer`, `decimal`, `float`, and
`numeric` normalize to `number`; prefer canonical names in authored JSON.

Pivot (long → wide): use
`"pivot":{"index":"region","columns":"product","values":"revenue","aggregate":"sum","fill":0}`.

If a bound chart reports `EMPTY_CHART_DATA`, repair the source / filter /
encoding or split the page. Do not switch to a weaker component to silence
the diagnostic.

For research / commercial provenance: put bibliography in
`deck.references[{id,title?,authors?,year?,venue?,doi?,url?,citation?}]`,
footnotes in `deck.footnotes[{id,text}]`, and reference them with rich
inline runs `{kind:"cite",refId}` and `{kind:"footnoteRef",footnoteId}`.

### 2.9 Generated Icon Assets

When the deck needs reusable icons, plan them before slide JSON. The asset plan
must map each icon name to an actual field such as `feature-card.iconSrc`,
`timeline.items[].iconSrc`, `process-flow.steps[].iconSrc`, or `image.src`.
Skip icon generation when the deck will not reference the returned files.

Use whatever image-generation capability the host agent provides to create one
square icon sheet. Prompt for a strict `1x1`, `2x2`, or `3x3` grid: plain
white/transparent background, no text, no labels, no captions, no app tiles,
one centered standalone icon per cell, consistent stroke/weight, and modest
even padding. Use visual English descriptions; filenames and Chinese labels
belong in `icons.json`, not in the image prompt.

Write `icons.json` beside the sheet:

```json
[
  { "name": "bank", "label": "银行", "description": "front view bank building line icon" },
  { "name": "risk", "label": "风险", "description": "shield with alert symbol line icon" }
]
```

Then slice the sheet with the SlideML2 runtime:

```bash
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" slice-icons assets/icons/icon-sheet.png \
  --icons assets/icons/icons.json \
  --out-dir assets/icons \
  --grid 2x2 \
  --output-size 768
```

`slice-icons` writes `assets/icons/manifest.json` and one PNG per icon name.
It uses the explicit grid and removes likely tile frames, black separator
rules, stray labels, and near-background pixels. It detects PNG vs JPEG/JFIF
from file bytes rather than the extension, so engine outputs saved at a `.png`
path still work when the payload is JPEG. If the sheet has a different layout,
rerun with the correct `--grid`; for non-transparent white-background icons,
add `--no-transparent`.

Manifest shape:

```json
{
  "sheetPath": "/abs/assets/icons/icon-sheet.png",
  "manifestPath": "/abs/assets/icons/manifest.json",
  "grid": { "columns": 2, "rows": 2 },
  "icons": [{ "name": "bank", "path": "/abs/assets/icons/bank.png" }]
}
```

Use `manifest.icons[].path`, not the sheet image, in slide JSON. Examples:
`feature-card.iconSrc:"/abs/assets/icons/bank.png"`,
`process-flow.steps[].iconSrc:"/abs/assets/icons/review.png"`,
`timeline.items[].iconSrc:"/abs/assets/icons/launch.png"`, or
`image.src`/`image-card.src` with `fit:"contain"`.

---

## 3. Component Reference

### 3.0 Shared Types

```
tone        = brand | positive | warning | danger | neutral
surface     = { fill, fillOpacity, line, lineOpacity, lineWidth, lineDash, borderColor, borderWidth, borderStyle, cornerRadius, padding, elevation, shadow, gradient, accent, accentColor, accentWidth }
              Use `fill:"none"` for transparent surfaces and `line:"none"` for borderless surfaces. `lineDash:"solid"` clears a dashed default.
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

Component selection sequence:

1. Data shape → shortlist candidates from the table below.
2. Page job → choose the primary from §3.14 routing.
3. Same-family ambiguity → use the disambiguators below.
4. Fields → write the canonical fields from the component line.
5. Capacity → keep the semantic component and split/resize before substituting.

Data shape → candidates:

| Data shape | Candidate components | Choose by |
|---|---|---|
| One decisive number | `hero-stat`, `metric-card`, `stat-strip` | slide-defining vs inline/supporting |
| 2–6 KPI records | `kpi-grid`, `scorecard` | metric peers vs health/status semantics |
| Ranked `{label,value}` ≤8 | `bar-list`, `chart-card`, `table-card` | rank story vs trend/exact lookup |
| Dense rows/options | `table-card`, `analytic-table`, `comparison-table` | plain lookup vs visual cells vs options matrix |
| N×M numeric matrix | `heatmap`, `table-card` | pattern recognition vs exact reading |
| Time series values | `chart-card` line/area/combo, `timeline` | numeric trend vs dated milestones |
| Linear steps | `process-flow`, `timeline`, `numbered-list` | dependency vs time vs prose |
| Options/features | `comparison-table`, `comparison-card`, `pros-cons` | many criteria vs peer cards vs two-sided trade-off |
| Image/artifact | `image-card`, `snapshot-callouts`, `evidence-layout` | inspect image vs numbered observations vs interpretation |

KPI family disambiguator:

| Intent | Use | Avoid | Why |
|---|---|---|---|
| One slide-defining number | `hero-stat` | `metric-card` | hero-stat owns attention |
| 2–6 peer metrics | `kpi-grid` | loose `metric-card`s | grid preserves peer alignment |
| One compact embedded number | `metric-card` | `hero-stat` | card-scale module |
| 3–6 inline supporting numbers | `stat-strip` | `kpi-grid` | lighter single row |
| Goal progress | `progress-bar`/`gauge` | `bar-list` | target relation, not ranking |

Comparison/data disambiguator:

| Intent | Use | Avoid | Why |
|---|---|---|---|
| Options × criteria | `comparison-table` | `table-card` | recommendation semantics |
| One option per card | `comparison-card` | `feature-card` | parallel evidence/pros/cons |
| Two-sided trade-off | `pros-cons` | `two-column` | explicit benefit/drawback slots |
| Exact business rows | `table-card` | `bar-list` | lookup precision |
| Rows with bars/badges/deltas | `analytic-table` | `table-card` | cell visuals are semantic |
| Two-axis position | `matrix-2x2` | `scatter chart` mimicry | quadrant meaning matters |

Narrative/list disambiguator:

| Intent | Use | Avoid | Why |
|---|---|---|---|
| Thesis + 2–4 findings | `executive-summary` | insight-card grid | memo-style synthesis |
| One verdict | `key-takeaway` | `callout` | slide-level conclusion |
| 3–5 final conclusions | `takeaway-list` | repeated callouts | parallel close-out |
| Why/how prose | `explanation-block` | raw `text` | structured paragraph block |
| Facts plus interpretation | `fact-list` | `table-card` | each row needs a reading |
| 5–8 risks/warnings | `warning-list` | stacked `callout`s | capacity and tone control |

Sequence/list disambiguator:

| Intent | Use | Avoid | Why |
|---|---|---|---|
| Connected stages | `process-flow` | `numbered-list` | movement/dependency is visual |
| Dated milestones | `timeline` | `process-flow` | time is the axis |
| Conceptual scale | `axis-ruler` | `timeline` | position is not a date |
| Formula/KPI cause chain | `stat-flow` | `process-flow` | numeric transfer is the story |
| Plain ordered prose | `numbered-list` | `process-flow` | no visual dependency |
| Status/action list | `checklist` | `kpi-grid` | completion state is semantic |

Visual emphasis: `tone` is semantic meaning, `variant` is presentation mode, and
`surface` is an explicit visual override. Precedence is `surface > variant >
tone`; do not express the same emphasis through all three at once.

Field aliases: use the canonical array name in the component line. `items` is
valid only when the line explicitly marks `items (alias)` or lists `items`.

When unsure, default to one stable primary plus `key-takeaway` or `source-note`.
Simple combinations beat forced specialty layouts.

### 3.1 Layout Containers

Children are required unless noted. Containers may carry `fixedHeight` /
`fixedWidth` as escape hatches; prefer flex sizing.

- `stack` — Flow container reading in sequence. Default gap comes from theme; set `gap` explicitly for exact rhythm. A `spacer` child replaces adjacent default gap. type='stack' required={children} optional={direction, gap, area, justify:start|center|end, align, valign:top|middle|bottom, padding}
- `grid` — Matrix of peer modules. Use colSpan/rowSpan for one semantic hero plus satellites. type='grid' required={children} optional={columns, gap, area, columnWeights, rowWeights, rows, fixedHeight}
- `split` — Primary + support. `ratio` is a target proportion, not a hint. type='split' required={children} optional={direction, ratio, gap, area, padding, align, valign}
- `panel` — Surface wrapper for a related semantic group. type='panel' optional={tone, fill, line, padding, cornerRadius, elevation:flat|raised|outlined, fixedHeight, children}
- `card` — Contained module with optional title/body/footer/accent. `title` and `header` are the same field; prefer `title`. Use `body` for one short paragraph, or `children` for richer structured content. type='card' optional={title, header (alias), body, content:rich-runs, footer, accent:none|left|top, accentColor, tone, fill, line, padding, cornerRadius, elevation, fixedHeight, fixedWidth, children}
- `band` — Wide emphasis band for a section thesis, verdict, or hero quote. type='band' optional={tone, fill, height, fixedHeight, cornerRadius, padding, children}
- `frame` — Border-only wrapper. `lineWidth` is stroke pt, not cm. type='frame' optional={line, lineWidth, dash:solid|dash|dashDot|dot, cornerRadius, padding, fixedHeight, fixedWidth, children}
- `inset` — Invisible padding wrapper for one semantic child. type='inset' optional={padding, fixedHeight, fixedWidth, children}
- `two-column` — Named left+right regions for narrative+visual or before+after. `left` and `right` may be full DomNode objects or shorthand `{children:[...]}` blocks, which normalize to stacks with generated ids. type='two-column' required={left, right} optional={ratio, gap}
- `freeform-group` — Slide-level anchored overlay group. Children use `at:[x,y,w,h]`, `x/y/w/h`, or anchor/offsetX/offsetY/width/height/zIndex. type='freeform-group' required={children} optional={mode:overlay|background}

### 3.2 Page Archetypes

- `cover-composition` — Editorial cover with optional full-bleed visual, dominant title lockup, hero stat. type='cover-composition' required={title} optional={subtitle, eyebrow, content:[runs]|{runs:[...]}, visual:{src:image-ref|'decorative',fit,anchor?,width?,height?,opacity?}, heroStat:{value,label,caption}, ctaText, ctaLink|link, tone:neutral|inverse|brand, decor:none|grid|shapes, titleSize:deck-title|slide-title|section-title, lockupWidth, lockupHeight}
- `chapter-divider` — High-impact top-level section opener. type='chapter-divider' required={title} optional={subtitle, chapter/number, showNumber=false, eyebrow, sections, current, tone:brand|neutral|inverse}. It renders no top-right number unless `chapter`/`number` is provided or `showNumber:true`; use only as a direct slide child.
- `hero-and-support` — One dominant claim plus 2–4 satellites. Use instead of a flat 2×2 grid when one idea leads. type='hero-and-support' required={headline, supports} optional={hero, detail, items (alias), layout:left|top, ratio, gap, tone}
- `chart-with-rail` — Dominant chart/table/evidence plus a narrow rail. type='chart-with-rail' required={evidence} optional={rail, headline, detail, items, layout:rail-right|rail-left|stacked, ratio default [0.72,0.28] or stacked [0.68,0.32], gap, tone} capacity="chart body >=4.8x3.0cm; rail <=30% width; stack when rail text is long"
- `snapshot-callouts` — Screenshot + numbered callouts. Use `freeform-group` only when markers must point at exact coordinates. type='snapshot-callouts' required={src:image-ref, callouts} optional={title, caption, items (alias), fit:cover|contain|fill, layout:rail-right|rail-left|below, ratio, gap, tone}
- `evidence-layout` — Evidence + interpretation page. type='evidence-layout' required={evidence} optional={insight, headline, detail, annotations, layout:sidecar|stacked, ratio default [0.68,0.32]} example={"type":"evidence-layout","evidence":{"type":"image-card","src":"/abs/screenshot.png"},"headline":"What changed","annotations":[{"type":"annotation","label":"1","text":"New control"}]}

### 3.3 Quantitative Proof

KPI and chart components accept `bind` + `encoding` for data binding. See §2.8.

- `hero-stat` — Slide-defining number. One per slide. type='hero-stat' required={value+label | bind+encoding:{value,label,delta?}} optional={caption, tone, bind, encoding} capacity="one dominant value plus short label/caption; do not pair with another hero-scale element"
- `kpi-grid` — 2–6 headline metrics. type='kpi-grid' required={metrics:[{value, label|name|title, delta?, status?, sparkline?, ...}]} optional={items (alias), columns default min(4, metrics.length), variant:plain|card|compact, density, surface} capacity="2-6 metrics; use columns:2/3 or split before labels shrink"
- `metric-card` — Single compact KPI. type='metric-card' required={value+label | bind+encoding} optional={unit, trend:up|down|flat, delta, status, comparison, source, sparkline, variant, density, surface, bind, encoding}
- `stat-strip` — Inline row of 3–6 supporting numbers. type='stat-strip' required={items | bind+encoding:{value,label} | bind+encoding:{items:[{label,value,type?,format?,tone?}]}} optional={tone, bind, encoding}
- `stat-comparison` — Before/after with delta. type='stat-comparison' required={beforeLabel, beforeValue, afterLabel, afterValue} optional={trend, deltaLabel}
- `bar-list` — Ranked categorical comparison, 4–8 items. `value` may be a number, percent string, currency/unit string such as `¥274.7万`, or star rating. Use `valueLabel` when display text differs from numeric value. type='bar-list' required={items:[{label|name|title, value|score|percent, valueLabel?, tone?}]} optional={tone, sort:desc|asc|none} capacity="4-8 ranked items; use table-card for exact dense lookup"
- `progress-bar` — Single progress-to-target. type='progress-bar' required={label, value} optional={max, valueLabel, tone}
- `chart-card` — Titled chart with optional insight, caption, dataLabels. Pie uses native PowerPoint outside labels with leader lines by default; doughnut uses repair-safe external PPT text labels and leader lines instead of native dLblPos. Both show major category+percent labels and suppress slices below 3% unless `dataLabels.minPercent` is set. type='chart-card' required={chartType:bar|stacked-bar|line|pie|doughnut|area|combo|scatter|waterfall, labels+series | data.{labels,series} | bind+encoding} optional={title, badge, insight, caption, showLegend, showValues, dataLabels:{show,position,bestFit|center|insideEnd|insideBase|outsideEnd,showValue,showCategoryName,showSeriesName,showPercent,showLegendKey,showLeaderLines,minPercent}, positiveColor, negativeColor, yFormat:int|decimal|percent|wanyuan|yi, tone, variant, surface, bind, encoding:{x,y|seriesOptions:{key:{y,seriesName?,chartType?,axis?}}}, orientation, xAxis, yAxis, secondaryYAxis, legend:{show,position,overlay}, plotArea:{x,y,w,h}} capacity="bar/line/combo body >=4.8x3.0cm; pie/doughnut >=5.2x4.4cm before chrome; keep readable aspect ratio" example={"type":"chart-card","chartType":"bar","bind":{"source":"sales","groupBy":"month","aggregate":{"Revenue":{"op":"sum","field":"revenue"}}},"encoding":{"x":"month","y":"Revenue"}}

### 3.4 Comparison & Decisions

- `comparison-card` — One peer option with parallel evidence. type='comparison-card' required={title} optional={subtitle, body, content:rich-runs, badge, points, items, metrics, pros, cons, score, winner, footer, variant, density, surface}
- `pros-cons` — Two-sided trade-off, benefits vs drawbacks. Not a generic two-column. type='pros-cons' required={pros, cons} optional={prosTitle, consTitle}
- `swot-matrix` — Strengths / weaknesses / opportunities / threats. Use only for true SWOT. type='swot-matrix' required={strengths, weaknesses, opportunities, threats}
- `pricing-card` — One pricing tier; mark recommended semantically. type='pricing-card' required={plan, price, features} optional={period, tone:neutral|brand, ctaText}
- `table-card` — Structured comparison or lookup table. Hand-authored rows may be arrays, `{cells:[...]}`, or objects; for varied display labels use `encoding.columns:[{key,label}]`. Cells may be plain strings or objects with `{text,value,runs,footnoteRefs,fill,color,tone,bold,align,valign,colspan,rowspan,padding,border,textRotation}`. Numeric `cellPadding`/cell `padding` values like 6 or 8 are treated as points; decimal values such as 0.18 are cm. type='table-card' required={rows | data.rows | bind+encoding:{columns?}} optional={title, badge, insight, headers, columns:[{key|field,header|label,width?}], colWidths, rowHeights, density, cellPadding, borders:{color,width,dash,left?,right?,top?,bottom?}, borderDash, bandRows, bandCols, tableStyleId, caption, tone, variant, surface, bind, encoding} capacity="compact 6-8 row business table ~4.5-6cm body; paginate before dropping rows/columns"
- `analytic-table` — Business analysis table for KPI, variance, status, ranking, interval, and composition views where exact row values and in-cell visuals must coexist. It displays finalized data; calculate formulas upstream. Use `renderMode:'native'` for one editable PPT table and `renderMode:'composed'` when cell visuals must be real inspectable shapes. Column `visual` supports `bar|progress|delta|badge|heat|sparkline|traffic-light|rank|range|stack`. For interval/range cells, set column `visual:{type:'range',domainMin,domainMax}` and row value `{low,high,value?,target?,display?}`. type='analytic-table' required={columns:[{key|field|id,label|header,width?,format?,align?,visual?}], rows | data.rows | bind+encoding:{columns?}} optional={title, columnGroups, renderMode:native|composed, badge, insight, caption, density, tone, variant, cellPadding, borders, bandRows, tableStyleId, surface} capacity="compact 6-8 row business analysis table ~4.5-6cm body; use composed mode plus visual QA for dense cell visuals" example={"type":"analytic-table","columns":[{"key":"metric","label":"Metric"},{"key":"progress","label":"Progress","visual":"progress"}],"rows":[{"metric":"Launch","progress":0.72}]}
- `comparison-table` — Multi-option matrix; features rows, options columns. type='comparison-table' required={features, options:[{name, values, recommended?}]} optional={title} capacity="3-8 features x 2-4 options; split when cells need sentences"

### 3.5 Sequence & Causality

- `process-flow` — Connected workflow. Horizontal works for 2–3 stages; rich 4+ may auto-wrap. type='process-flow' required={steps:[{title|label, body|description, status?, owner?, time?, icon?, iconSrc?:image-ref, number?, marker?, accentColor?, bullets?}]} optional={items (alias), direction, variant:plain|cards, density, marker, showNumbers, connector:arrow|chevron|line|none, connectorDash, connectorColor, placement:top|center, spread:compact|balanced|fill, stepAccent:top|none, stepSurface, surface} capacity="horizontal: 2-3 stages; 4+ rich → vertical or split" example={"type":"process-flow","steps":[{"title":"Intake","body":"Collect demand"},{"title":"Review","body":"Score fit"},{"title":"Launch","body":"Assign owner"}]}
- `calendar-plan` — Calendar-style campaign/operating plan. type='calendar-plan' required={events:[{day, title|label|name, body?, tone?}]} optional={title, month, weekdays, density, tone, variant, surface}
- `timeline` — Dated milestones; sequence-organized meaning. Items: `{time|date|year, title?, body?, tone?, shape?, icon?, iconSrc?, content?}`. Horizontal rich content >5 auto-flips vertical; horizontal simple >6 wraps to 4-column rows. type='timeline' required={items} optional={direction, orientation (alias), gap} capacity="3-6 milestones per slide; split long bodies or dense dates" example={"type":"timeline","items":[{"date":"Q1","title":"Pilot"},{"date":"Q2","title":"Rollout"}]}
- `outline` — TOC/agenda. Numbers are never auto-generated. type='outline' required={items:[{title, number?, body?, page?, tone?}]} optional={showPages, density:comfortable|compact|auto, tone:brand|neutral}
- `numbered-grid` — Designed ordered priorities/principles, each a peer module. type='numbered-grid' required={items:[{title|label|name, body|description|text, marker?, tone?}]} optional={columns, tone, marker, numberStyle:chip|plain}
- `numbered-list` — Brief ordered prose items. type='numbered-list' required={items: string[] | [{title|headline|label|name|text, body|detail|description?}]} optional={density}
- `step-card` — One discrete step with title + short detail. Prefer `process-flow` for connected pipelines. type='step-card' required={title} optional={step, number, body, description, steps, marker, icon}
- `axis-ruler` — Ordered conceptual scale: eras, maturity, spectrum. Position on the axis is the meaning. type='axis-ruler' required={items:[{label|title|name, body|text|description}]} optional={direction, tone}
- `flow-arrow` — Single directional connector between two modules. Use `process-flow` for multi-step. type='flow-arrow' optional={label, tone, direction:right|down}

### 3.6 Evidence & Media

- `image-card` — Inspectable image with optional annotations/callouts. type='image-card' required={src:image-ref} optional={alt, title, badge, insight, annotations, callouts, caption, fit:cover|contain|fill, imageWidth, tone, variant, surface}
- `quote` — Verbatim or voice-like statement. Natural authoring `{type:"quote", text, source?}` is enough; quote padding auto-tightens in narrow/tight regions. type='quote' required={text} optional={source} capacity="short quote+source fits ~2.0cm high; long editorial quote needs a dominant region or split"
- `source-note` — Quiet provenance / caveat. type='source-note' required={text} optional={align}
- `equation` — Display math via OMML. Supported LaTeX renders natively; unsupported commands fail validation. Split dense derivations across slides or set explicit `fontSize` / `size`; set `color` for intentional contrast overrides. type='equation' required={latex} optional={label, number, align, caption, style, color, size, fontSize, renderMode:omml} capacity="single display formula >=4.0x1.0cm; formula grid cells >=5.0x1.4cm"
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
- `code-block` — First-class code listing with line numbers, syntax color, diff lines, highlight ranges. Use `maxLines` only for intentional excerpts; paginate long listings. type='code-block' required={code} optional={language, title, caption, showLineNumbers, highlightLines:[number | {start,end}], wrap, density:compact|dense|tiny, columns, fontSize, maxLines} capacity="fontSize 7 + density:dense fits ~38-48 short lines/page at full width; use columns for narrow code"

### 3.8 Data Visualization

- `scorecard` — Status-coded health grid. type='scorecard' required={items:[{label, value, status?:good|warning|danger|neutral, delta?, trend?}]} optional={columns} capacity="4-12 compact status cells; use kpi-grid when status is not meaningful"
- `funnel` — Conversion/pipeline narrowing as an editable inverted pyramid made from PowerPoint trapezoid stages. Not a native chart and not a chevron chain. type='funnel' required={stages:[{label|title|name, value, valueLabel?, body?, items?:string[], contents?:[{title|label|name, content|body?, tone?, fill?, line?, surface?}], icon?|iconSrc?, badge?|badges?, tone?, widthRatio?|ratio?, height?|heightWeight?, fill?|line?|surface?}] (max 6)} optional={showDrop=true, titleStyle, bodyStyle, titleAlign:left|center|right, bodyAlign:left|center|right, minWidthRatio, maxWidthRatio, gap, levelSurface, density, tone, variant, surface} capacity="3-5 stages; bottom stages are narrow, so keep final-stage body short or set widthRatio; put multiple content blocks on wide upper/middle stages; valueLabel preserves the visible KPI and showDrop adds drop/gain text"
- `gauge` — Single-value progress dial with threshold bands. Different from `progress-bar` (no zones). type='gauge' required={value, label} optional={max, unit, thresholds:[{upTo, tone:danger|warning|positive|brand, label?}]}
- `heatmap` — N×M colored value matrix, max 12×12. type='heatmap' required={xLabels, yLabels, values:[[number]]} optional={palette:warm|cool|diverging, showValues}
- `matrix-2x2` — 2-axis quadrant matrix. Two authoring modes: `items:[{label,x,y,tone?}]` and/or `quadrantLabels:{tl,tr,bl,br}`; pass at least one. type='matrix-2x2' required={xAxis:{low,high}, yAxis:{low,high}} optional={items, quadrantLabels, quadrantTones}
- `trend-line` — Mini sparkline (decoration next to a metric or heading). type='trend-line' required={values (max 24)} optional={tone, height}
- `stat-flow` — Stat blocks connected by operator text for formulas/KPI cause-effect. type='stat-flow' required={steps:[{value,label,tone?} | {connector: string}] (max 10)}
- `donut-summary` — Primary share + remainder legend. Different from `chart-card` pie. type='donut-summary' required={primary:{label,value}} optional={others, unit, tone}
- `range-plot` — Horizontal min..max range bars (salary bands, CI, ranges). type='range-plot' required={items:[{label,min,max,point?,unit?}]} optional={tone}
- `org-chart` — People/role reporting hierarchy with variable-size tree layout, grouped editable node cards, adaptive card sizes, personnel-list detail, auto-spreading gaps inside the available region, and editable PowerPoint connector lines. type='org-chart' required={nodes:[{id?, name|label|title, role|position?, team?, body|description?, people|members|personnel?:string[], parent|reportsTo?, level?, tone?, size?|width?|height?, icon?|iconSrc?|avatarSrc?, badge?|badges?, fill?|line?|surface?}]} optional={links, title, density, detail:auto|compact|full, treeMaxWidth, treeMaxHeight, spread=true, titleStyle, bodyStyle, nodeSurface, connectorLine, connectorLineWidth, connectorLineDash, connectorLineOpacity, tone, variant, surface} capacity="2-5 readable levels; prefer parent/reportsTo links over level; pass treeMaxWidth/treeMaxHeight or fixedWidth/fixedHeight when placing the tree in a smaller region; pass detail only where useful because dense lower levels become title-only; split by function when ORG_OVERFLOW appears"
- `tree-chart` — Generic non-people tree for categories, capabilities, products, systems, metrics, issues, or taxonomy maps. Uses the same variable-size tree layout as org-chart, grouped editable node cards, adaptive spacing, and editable PowerPoint connector lines. type='tree-chart' required={nodes:[{id?, label|title|name, body|description|value?, parent?, level?, tone?, size?|width?|height?, icon?|iconSrc?, badge?|badges?, fill?|line?|surface?}]} optional={links, title, density, detail:auto|compact|full, treeMaxWidth, treeMaxHeight, spread=true, titleStyle, bodyStyle, nodeSurface, connectorLine, connectorLineWidth, connectorLineDash, connectorLineOpacity, tone, variant, surface} capacity="2-5 readable levels; prefer parent links over level; connector labels can cover light branching notes; pass treeMaxWidth/treeMaxHeight or fixedWidth/fixedHeight when placing the tree in a smaller region; split very wide taxonomies by branch" example={"type":"tree-chart","nodes":[{"id":"root","label":"Platform"},{"label":"Data","parent":"root"}]}
- `pyramid` — Tiered hierarchy, maturity model, strategy stack, priority ladder, or value hierarchy as editable PowerPoint trapezoid/band levels. Each level can hold text plus multiple horizontal content blocks with width estimated from content volume. type='pyramid' required={levels:[{label|title|name, body?, items?:string[], contents?:[{title|label|name, content|body?, tone?, fill?, line?, surface?}], icon?|iconSrc?, badge?|badges?, tone?, widthRatio?|ratio?, height?|heightWeight?, titleAlign?, bodyAlign?, fill?|line?|surface?}]} optional={title, orientation:top-down|bottom-up, shape:trapezoid|stepped|band, gap, titleStyle, bodyStyle, titleAlign:left|center|right, bodyAlign:left|center|right, levelSurface, density, tone, variant, surface} capacity="3-5 levels; use contents for horizontal blocks inside a wide level; lower/wider levels can carry more blocks; avoid separate metric fields because visible KPIs belong in body, items, badges, or content blocks"
- `factorial-matrix` — Labeled 2D matrix; rows + columns both carry meaning. type='factorial-matrix' required={rows, columns, cells:[[string | {text,tone}]]} optional={title}
- `probe-flow` — Experiment/probe walkthrough: input → step(s) → observation. type='probe-flow' required={steps:[{title, body?}]} optional={items (alias), direction}
- `failure-taxonomy` — Failure/risk categories with rate chips and examples. type='failure-taxonomy' required={items:[{title|name, rate|value?, examples?|bullets?, body?}]} optional={columns, tone:brand|warning|danger|neutral}
- `main-effect-comparison` — Main-effect before/after with interpretation. type='main-effect-comparison' required={beforeLabel, beforeValue, afterLabel, afterValue} optional={title, insight, trend, deltaLabel}

Office structure quick patterns:

- Prefer component-level `tone`, `surface`, `nodeSurface`, `levelSurface`, `titleStyle`, and `bodyStyle` over raw shapes. These components inherit deck/theme typography; only override font size, weight, or color when the slide needs explicit emphasis, and do not set a font family unless the user asks.
- Use `surface:{line:"none"}` or per-node/per-level `line:"none"` for borderless cards/levels. Use `fill`, `line`, and `surface` on individual nodes/stages/levels when the business meaning needs local emphasis.
- For `org-chart` and `tree-chart`, use `parent`/`reportsTo` links as the primary hierarchy. `level` is only a fallback when parent links are unavailable.

### 3.9 Identity, Markers, Action

Use unified `decoration:{kind:"image"|"shape"|"marker"|"none", ...}` for card
ornaments; it keeps icon/marker/shape controls consistent across variants.

- `feature-card` — One feature/capability/benefit. Use explicit `layout:"vertical"|"horizontal"` to keep repeated cards consistent; horizontal places decoration left of text and is better for short card height. Compact and custom-surface cards keep internal padding; set `surface:{line:"none"}` for borderless styles. type='feature-card' required={title} optional={layout:vertical|horizontal, decoration, body, content:rich-runs, badge, tags, metric:{value,label,tone?}, proof, ctaText, tone, titleColor:color-ref, variant:plain|card|compact, density, surface} capacity="2-4 peer cards per slide; shorten body/proof before shrinking below readable card height"
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
Exact overlays still participate in visual validation: keep them below,
beside, or clearly separated from content text. If a freeform diagram needs a
caption/explanation, place that text above with enough clearance, or make the
diagram the main content and move prose to a separate callout/slide.

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

- `text` — Plain semantic body copy. type='text' required={text} optional={align}
- `lead` — Lead paragraph or short opening sentence. type='lead' required={text} optional={align}
- `h1` — Primary in-slide section heading. type='h1' required={text} optional={align}
- `h2` — Secondary in-slide heading. type='h2' required={text} optional={align}
- `label` — Small label/chip text. type='label' required={text} optional={align, variant:plain|badge|tag, tone}
- `deck-title` — Dominant cover/section title component. For normal slides, set `slide.title` instead. type='deck-title' required={text} optional={align}
- `slide-title` — Explicit in-content slide title; usually prefer `slide.title` so the renderer places the title in its dedicated rect. type='slide-title' required={text} optional={align}
- `bullets` — Bulleted list. type='bullets' required={items: string[] | [{text|runs:rich-runs}]} optional={title, density, size, marker, numberStyle}
- `shape` — Raw geometry preset. type='shape' optional={preset, text:string|{text,align?,color?,fontSize?,fontWeight?,fontFamily?} OR children:[{type:"text",text}], fill, fillOpacity, line, lineOpacity, lineWidth, lineDash, borderColor, borderWidth, borderStyle, border:{color|line,width?,dash?|style?}, cornerRadius, rotation, headEnd, tailEnd, thickness, ...}
- `image` — Raster image without card chrome. type='image' required={src:image-ref} optional={alt, fit:cover|contain|fill, opacity, width, height, clip, cornerRadius, line, lineWidth, lineDash, borderColor, borderWidth, borderStyle, border:{color|line,width?,dash?|style?}, overlay, shadow}
- `divider` — Horizontal or vertical thin rule. type='divider' optional={direction, thickness, color, length}
- `spacer` — Explicit empty spacing in a stack/grid. In stacks it replaces adjacent default gap, so `fixedHeight:0.3` means about 0.3cm of added space. type='spacer' optional={fixedHeight, fixedWidth, weight}

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

### 3.13 Silent Behaviors Agent Should Know

- Display-tier titles and many components use `autoFit:"shrink"` as a fallback;
  do not use it to hide overfull body copy.
- Near-fit container overflow may be absorbed by autoFit; still split if the
  rendered slide looks crowded.
- Some contrast failures are repaired and reported as `LOW_CONTRAST_FIXED`;
  fix the token/theme if exact brand color matters.
- `chapter-divider.showNumber` defaults false; `showNumber:true` with no
  explicit chapter renders `current + 1`.
- `chart-with-rail` defaults to `[0.72,0.28]`; `evidence-layout` defaults to
  `[0.68,0.32]`.

### 3.14 Page Job → First Component

Use this table after the §3.0 data-shape shortlist. A sparse ranking can be a
`kpi-grid`, a dense ranking is a `bar-list`, and a comparison inside a section
reset is a `chapter-divider`, not a `comparison-table`. Add at most 1–2 support
components.

| Page job | First component | Good support | Avoid |
|---|---|---|---|
| Executive answer / final synthesis | `executive-summary` | `key-takeaway`, `takeaway-list` | insight-card grid |
| One dominant conclusion with proof | `chart-with-rail` | `chart-card`, `table-card`, `bar-list`, `side-rail` | equal chart+table+KPI peers |
| Evidence artifact with interpretation | `evidence-layout` | `fact-list`, `key-takeaway`, `annotation` | raw screenshot with no reading |
| Ranking / market share / distribution | `bar-list` | `donut-summary`, `range-plot`, `heatmap` | `kpi-grid` when order matters |
| KPI / status snapshot | `kpi-grid` | `scorecard`, `stat-strip`, `hero-stat` | `bar-list` when no ranking story |
| Options / competitors / before-after | `comparison-table` | `comparison-list`, `matrix-2x2`, `pros-cons` | generic table for recommendation |
| Process / workflow | `process-flow` | `stat-flow`, `arrow-link`, `side-rail` | `timeline` when causality ≠ time |
| Roadmap / dated milestones | `timeline` | `calendar-plan`, `side-rail` | `process-flow` for pure dates |
| Roadmap / conceptual stages | `axis-ruler` | `process-flow`, `side-rail` | `timeline` without dates |
| Org / reporting hierarchy | `org-chart` | `tree-chart`, `legend` | generic cards |
| Generic hierarchy / capability tree | `tree-chart` | `org-chart`, `pyramid`, `legend` | raw connector drawing |
| Strategy / maturity / tiered hierarchy | `pyramid` | `axis-ruler`, `scorecard`, `tree-chart` | table when hierarchy is visual |
| Influence / priority positioning | `matrix-2x2` | `comparison-list`, `annotation` | table when quadrant meaning matters |
| Responsibility / governance rows | `analytic-table` | `checklist`, `scorecard` | `matrix-2x2` for exact assignments |
| Work status / health | `scorecard` | `checklist`, `analytic-table` | `kpi-grid` when status is primary |
| Layered system / capability map | `tree-chart` | `pyramid`, `legend`, `side-rail` | `freeform-group` for ordinary maps |
| Regional performance | `analytic-table` | `legend`, `scorecard`, `bar-list` | map-like drawing without data asset |
| Conversion funnel / pipeline narrowing | `funnel` | `stat-flow`, `bar-list` | chart-card funnel approximation |
| Linear transfer / KPI chain | `stat-flow` | `funnel`, `bar-list` | process-flow for numeric formulas |
| Risk / issue taxonomy | `failure-taxonomy` | `matrix-2x2`, `scorecard`, `checklist` | warning callout stack |
| Screenshot / visual walkthrough | `snapshot-callouts` | `annotation`, `pointer-arrow`, `callout-marker` | unannotated image dump |
| One idea plus satellites | `hero-and-support` | `feature-card`, `metric-card` | flat 2x2 grid for a led idea |
| Long article / reading passage | `article` | `quote`, `glossary` | many text boxes |
| Formula / derivation | `equation` | inline `{kind:"math"}` runs | screenshot math |
| Code / SQL / reproducible method | `code-block` | `code` for one short command | image of code |
| References / bibliography | `bibliography` + `{kind:"cite"}` runs | `source-note` | manual citation text |
| Chapter reset | `chapter-divider` | `timeline-axis-bar` | full content slide as divider |
| Cover | `cover-composition` | `brand-mark`, `decorative-shapes` | split text/media hero |

Raw `text` is residual: short labels, captions, local notes, or a sentence
inside a designed container. It is not a page-layout strategy.

When the exact fields are unclear, look up 2–4 candidate components in §3
before writing JSON. Schema lookup is cheaper than rebuilding a broken
hand-authored layout.
