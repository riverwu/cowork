# Charcoal Minimal

Minimal, print-friendly theme — off-white canvas, near-black text, charcoal accents, single warm pop. No accent rules. Maximum restraint.

## When to use this theme
- Print-friendly hand-outs, minimalist consulting briefs, B&W-safe decks.

## When NOT to use
- Decks where you want a strong brand identity (this is intentionally muted).

## How to pick a layout

A 7-line decision tree. Scan top-to-bottom; first match wins.

1. **Long text (>500 CJK / 800 latin chars)?** → `prose` or `two-column-prose`.
2. **Image is the point?** → `image-with-caption` (editorial) / `image-full-bleed` (cinematic) / `image-pair` (before/after).
3. **Image + supporting text?** → `two-col-text-image` / `image-split-text` (immersive). Pick `density` matching content length.
4. **Data?** → `chart-with-takeaway` (1 chart) / `data-table` (table) / `stat-grid-3` (3 KPIs) / `dashboard` (4 mixed).
5. **3-6 short points?** → `executive-summary` (with descriptions) / `bullet-with-image` / `key-point` (with icons).
6. **Side-by-side comparison?** → `compare-two-columns` / `split-2` (heterogeneous, with `ratio`).
7. **Nothing fits?** → `freeform` (last resort).

When text overflows the layout's density budget, the validator emits `DENSITY_OVERFLOW` with concrete next-step suggestions (try denser preset / switch to prose).

## Layout reference

### cover
Title slide. Pick for slide 1 only. Uses chrome `none` automatically.

- `title` — `text`, ≤ 60 chars. Required.
- `subtitle` — `text`, ≤ 80 chars. Optional.
- `eyebrow` — `text`, ≤ 32 chars. Optional. Small label above the title.

![cover](thumbnails/cover.png)

### agenda
Numbered list of upcoming sections (TOC).

- `title` — `text`, ≤ 30 chars. Optional.
- `items` — `bullets`, 2–8 items, ≤ 60 chars each.

![agenda](thumbnails/agenda.png)

### stat-grid-3
Three KPI tiles in a row. Pick when surfacing 3 headline metrics.

- `title` — `text`, ≤ 40 chars.
- `items` — `bullets`, exactly 3, each `{ value, label, delta?, trend? }`.

> **Guidance:** Pick THE three most newsworthy numbers. Don't set every `trend` to `up`.

![stat-grid-3](thumbnails/stat-grid-3.png)

### image-with-takeaway
Title + STATIC image (rendered chart, diagram, photo) + boxed conclusion. The image-counterpart of `chart-with-takeaway` — use this when your chart is a PNG/JPG, NOT typed chart-spec data.

- `title` — `text`, ≤ 50 chars. Optional.
- `image` — `image-ref`. Required.
- `takeaway` — `markdown-inline`, ≤ 160 chars. Optional. Same callout panel as chart-with-takeaway.

![image-with-takeaway](thumbnails/image-with-takeaway.png)

### chart-with-takeaway
Title + native data chart + boxed conclusion.

- `title` — `text`, ≤ 50 chars.
- `chart` — `chart-spec`.
- `takeaway` — `markdown-inline`, ≤ 160 chars. Optional.

> **Guidance:** The takeaway is a CONCLUSION (so-what), not a chart caption.

![chart-with-takeaway](thumbnails/chart-with-takeaway.png)

### bullet-with-image
Title + 3–6 bullets on the left, image on the right (optional).

- `title` — `text`, ≤ 50 chars.
- `bullets` — `bullets`, 3–6 items, ≤ 80 chars each.
- `image` — `image-ref`. Optional.

> **Guidance:** Bullets are TERSE — typically 5-12 words. Long prose belongs in `notes:`.

![bullet-with-image](thumbnails/bullet-with-image.png)

### closing
Mirror of `cover` — full-bleed deep panel. Use as the final "thank you" slide.

- `title` — `text`, ≤ 60 chars.
- `subtitle` — `text`, ≤ 80 chars. Optional.
- `image` — `image-ref`. Optional full-bleed background image; renders under a 75% brand-deep overlay.

![closing](thumbnails/closing.png)

### split-2
Title (optional) over two side-by-side cells; each cell is a polymorphic `region` (one of 8 kinds: kpi/chart/table/text/bullets/image/code/quote). Use for heterogeneous side-by-side content (bullets vs. chart, image vs. quote, code vs. explanation).

- `title` — `text`, ≤ 50 chars. Optional.
- `left`, `right` — `region` cells (required).

![split-2](thumbnails/split-2.png)

### split-3-horizontal
Title (optional) over three equal-width regions. Use for parallel comparison.

- `title` — `text`, ≤ 50 chars. Optional.
- `left`, `center`, `right` — `region` cells (required).

![split-3-horizontal](thumbnails/split-3-horizontal.png)

### split-3-vertical
Title (optional); full-width top region over a 50/50 bottom row. Use for "headline + supporting evidence".

- `title` — `text`, ≤ 50 chars. Optional.
- `top` — `region` (required, full width).
- `bl`, `br` — `region` cells (optional, bottom 50/50).

![split-3-vertical](thumbnails/split-3-vertical.png)

### hero-stat
One enormous headline number with a tagline. Use when the slide exists to make ONE point land.

- `value` — `text`, ≤ 20 chars. Required.
- `label` — `text`, ≤ 60 chars. Required.
- `caption` — `text-block`, ≤ 240 chars. Optional.
- `eyebrow` — `text`, ≤ 32 chars. Optional. Small uppercase label above the number.

![hero-stat](thumbnails/hero-stat.png)

### matrix-2x2
Quadrant matrix with optional axis labels — each quadrant is a `region` cell.

- `title` — `text`, ≤ 50 chars. Optional.
- `xLabel`, `yLabel` — `text`, ≤ 32 chars. Optional axis labels.
- `topLeft`, `topRight`, `botLeft`, `botRight` — `region` cells (all required).

![matrix-2x2](thumbnails/matrix-2x2.png)

### team-grid
Photo grid of 2–8 team members; circular avatars + name + role + optional bio.

- `title` — `text`, ≤ 50 chars. Optional.
- `members` — `bullets`, 2–8 entries. Each `{ name, role?, image?, bio? }`.

![team-grid](thumbnails/team-grid.png)

### image-full-bleed
Image fills the entire slide; optional `caption` in a thin dark band.

- `image` — `image-ref`. Required.
- `caption` — `text`, ≤ 120 chars. Optional.

![image-full-bleed](thumbnails/image-full-bleed.png)

### image-with-caption
Image with editorial italic caption + optional credit line.

- `image` — `image-ref`. Required.
- `caption` — `text-block`, ≤ 320 chars. Required.
- `credit` — `text`, ≤ 80 chars. Optional.

![image-with-caption](thumbnails/image-with-caption.png)

### image-pair
Two side-by-side images for before/after comparison.

- `title` — `text`, ≤ 50 chars. Optional.
- `leftImage`, `rightImage` — `image-ref`. Required.
- `leftLabel`, `rightLabel` — `text`, ≤ 32 chars. Optional.

![image-pair](thumbnails/image-pair.png)

### image-split-text
Immersive 50/50 — image edge-to-edge on its half, text on the other.

- `title` — `text`, ≤ 60 chars. Required.
- `text` — `text-block`, ≤ 480 chars. Required.
- `image` — `image-ref`. Required.
- `imageSide` — `text` (left|right). Optional.

![image-split-text](thumbnails/image-split-text.png)

### pricing-table
2–4 pricing tier cards. Tiers: `{ name, price, period?, features?, recommended? }`.

- `title` — `text`, ≤ 50 chars. Optional.
- `tiers` — `bullets`, 2–4 entries.

![pricing-table](thumbnails/pricing-table.png)

### quote-with-portrait
Pull-quote with circular portrait + name + role.

- `quote` — `text-block`, ≤ 280 chars. Required.
- `name` — `text`, ≤ 60 chars. Required.
- `role` — `text`, ≤ 80 chars. Optional.
- `portrait` — `image-ref`. Optional.

![quote-with-portrait](thumbnails/quote-with-portrait.png)

### key-point
Headline + 2–4 supporting points (icon + heading + 1-line description).

- `headline` — `text`, ≤ 80 chars. Required.
- `points` — `bullets`, 2–4 entries. Each `{ icon?, title, description? }`.

![key-point](thumbnails/key-point.png)

### freeform
Escape-hatch — pass `shapes: [{ kind, x, y, w, h, ... }]` directly.

- `title` — `text`, ≤ 80 chars. Optional.
- `shapes` — `bullets`, 1–40 entries.

![freeform](thumbnails/freeform.png)

### prose
Single-column long-form text. Title + optional subtitle + body (typed paragraphs supported).

- `title` — `text`, ≤ 80 chars. Optional.
- `subtitle` — `text`, ≤ 120 chars. Optional.
- `body` — `text-block`, ≤ 1600 chars. Required.

![prose](thumbnails/prose.png)

### two-column-prose
Long body flowed across two columns.

- `title` — `text`, ≤ 80 chars. Optional.
- `subtitle` — `text`, ≤ 120 chars. Optional.
- `body` — `text-block`, ≤ 2400 chars. Required.

![two-column-prose](thumbnails/two-column-prose.png)

### executive-summary
TL;DR clipboard. 2–6 numbered `{ heading, line }` entries.

- `title` — `text`, ≤ 60 chars. Optional.
- `items` — `bullets`, 2–6 entries.

![executive-summary](thumbnails/executive-summary.png)

### q-and-a
FAQ list. 1–5 pairs of question + answer.

- `title` — `text`, ≤ 60 chars. Optional.
- `items` — `bullets`, 1–5 entries. Each `{ q, a? }`.

![q-and-a](thumbnails/q-and-a.png)

### definition
Dictionary-style single-term page.

- `term` — `text`, ≤ 40 chars. Required.
- `pronounce` — `text`, ≤ 60 chars. Optional.
- `partOfSpeech` — `text`, ≤ 32 chars. Optional.
- `body` — `text-block`, ≤ 600 chars. Required.
- `example` — `text-block`, ≤ 240 chars. Optional.

![definition](thumbnails/definition.png)

### outline
Multi-level table of contents with nested sub-items.

- `title` — `text`, ≤ 60 chars. Optional.
- `items` — `bullets`, 2–8 entries. Each `string` or `{ text, sub: [string] }`.

![outline](thumbnails/outline.png)

### timeline-text
Vertical narrative timeline.

- `title` — `text`, ≤ 60 chars. Optional.
- `events` — `bullets`, 2–6 entries. Each `{ when | date, title, body? }`.

![timeline-text](thumbnails/timeline-text.png)

### letter
Open-letter format with date + recipient + body + signature.

- `date`, `recipient`, `signoff`, `signRole` — `text`. Optional.
- `body` — `text-block`, ≤ 1400 chars. Required.
- `signature` — `text`, ≤ 60 chars. Required.

![letter](thumbnails/letter.png)

### glossary
Two-column term + definition list.

- `title` — `text`, ≤ 60 chars. Optional.
- `terms` — `bullets`, 3–12 entries. Each `{ term, definition }`.

![glossary](thumbnails/glossary.png)

### framed
Optional header/footer/left-edge/right-edge bands plus a required center region.

- `title` — `text`, ≤ 50 chars. Optional.
- `header`, `footer`, `leftEdge`, `rightEdge` — `region`. Optional bands.
- `center` — `region`. Required.

![framed](thumbnails/framed.png)

### title-only
Single centered title.

- `title` — `text`, ≤ 80. Required.

![title-only](thumbnails/title-only.png)

### section-divider
Section break with optional eyebrow.

- `eyebrow` — `text`, ≤ 32. Optional.
- `title` — `text`, ≤ 50. Required.

![section-divider](thumbnails/section-divider.png)

### two-col-text-image
Title + text on one side, image on the other.

- `title` — `text`, ≤ 50. Required.
- `text` — `text-block`, ≤ 400. Required.
- `image` — `image-ref`. Required.
- `imageSide` — `text` (left|right). Optional.

![two-col-text-image](thumbnails/two-col-text-image.png)

### compare-two-columns
Side-by-side option A vs option B.

- `title` — `text`, ≤ 50. Optional.
- `leftTitle`, `leftBody`, `rightTitle`, `rightBody` — required.

![compare-two-columns](thumbnails/compare-two-columns.png)

### process-timeline
3–5 steps along a horizontal rail.

- `title` — `text`, ≤ 50. Required.
- `steps` — `bullets`, 3–5 entries.

![process-timeline](thumbnails/process-timeline.png)

### image-grid-2x2
Up to 4 images in a 2×2 grid.

- `title` — `text`, ≤ 50. Optional.
- `images` — `bullets`, 2–4 entries.

![image-grid-2x2](thumbnails/image-grid-2x2.png)

### hero-image-overlay
Full-bleed image with overlay carrying title + subtitle.

- `image` — `image-ref`. Required.
- `title` — `text`, ≤ 60. Required.
- `subtitle` — `text`, ≤ 100. Optional.
- `align` — `text`. Optional.

![hero-image-overlay](thumbnails/hero-image-overlay.png)

### data-table
Native table with header row + alternating rows.

- `title` — `text`, ≤ 50. Optional.
- `table` — `table`. Required.

![data-table](thumbnails/data-table.png)

### quote
Pull-quote slide. Plays beautifully against the off-white canvas.

- `quote` — `text-block`, ≤ 240. Required.
- `attribution` — `text`, ≤ 60. Optional.

![quote](thumbnails/quote.png)

### code-block
Code snippet on a dark card. Type-driven minimal aesthetic suits code well.

- `title`, `language` — `text`. Optional.
- `code` — `text-block`, ≤ 1600. Required.
- `caption` — `markdown-inline`, ≤ 160. Optional.

![code-block](thumbnails/code-block.png)

### dashboard
2×2 grid of region cells.

- `title` — `text`, ≤ 50. Optional.
- `tl`, `tr`, `bl`, `br` — `region`. Only `tl` required.

> **Guidance:** Anti-pattern for charcoal-minimal — dashboards are dense and clash with restraint.

![dashboard](thumbnails/dashboard.png)

## Tokens

| Token | Value |
|---|---|
| `bg-canvas` | #F2F2F2 off-white |
| `bg-card` | #FFFFFF white |
| `text-strong` | #212121 near-black |
| `text-muted` | #5A6770 cool gray |
| `brand-primary` | #36454F charcoal |
| `brand-deep` | #212121 black |
| `accent` | #D49B5C warm amber pop |
| `font-latin` | Helvetica Neue → Helvetica → Inter → Arial | Swiss design lineage — Helvetica first, Inter as the modern open-source fallback |
| `font-cjk`   | PingFang SC → Source Han Sans CN → MS YaHei → Noto Sans CJK SC | macOS-first CJK; Source Han is the tightest fallback for Linux/Windows when PingFang is missing |
| `font-mono`  | JetBrains Mono → SF Mono → Menlo → Consolas | Used by code-block; JetBrains for ligatures, SF Mono for macOS-native rendering |
