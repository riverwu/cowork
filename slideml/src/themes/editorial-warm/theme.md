# Editorial Warm

Editorial / consulting theme with a cream canvas, deep warm grays, and
a rust accent. Serif headings, sans body. Print-friendly. Six core
layouts — pair with `technical-blue` when you need code, tables, or
process diagrams.

## When to use this theme
- Investor narratives and consulting briefs (warm, classical).
- Strategy memos that read more like prose than a dashboard.
- Print-oriented hand-outs.

## When NOT to use
- Engineering / data-dense decks (`technical-blue` is denser).
- Code walkthroughs (no `code-block` here).

## Layout reference

### cover
Title slide. Pick for slide 1 only. Uses chrome `none` automatically.

- `title` — `text`, ≤ 60 chars. Required.
- `subtitle` — `text`, ≤ 80 chars. Optional.
- `eyebrow` — `text`, ≤ 32 chars. Optional. Small label above the title.

![cover](thumbnails/cover.png)

### agenda
Numbered list of upcoming sections (TOC).

- `title` — `text`, ≤ 30 chars. Optional (defaults to "Agenda").
- `items` — `bullets`, 2–8 items, ≤ 60 chars each.

![agenda](thumbnails/agenda.png)

### stat-grid-3
Three KPI tiles in a row. Pick when surfacing 3 headline metrics.

- `title` — `text`, ≤ 40 chars.
- `items` — `bullets`, exactly 3, each `{ value, label, delta?, trend? }`.

![stat-grid-3](thumbnails/stat-grid-3.png)

### chart-with-takeaway
Title + native data chart + boxed conclusion.

- `title` — `text`, ≤ 50 chars.
- `chart` — `chart-spec`. See parser docs for shape.
- `takeaway` — `markdown-inline`, ≤ 160 chars. Optional.

![chart-with-takeaway](thumbnails/chart-with-takeaway.png)

### bullet-with-image
Title + 3–6 bullets on the left, image on the right (optional).

- `title` — `text`, ≤ 50 chars.
- `bullets` — `bullets`, 3–6 items, ≤ 80 chars each.
- `image` — `image-ref`. Optional.

![bullet-with-image](thumbnails/bullet-with-image.png)

### closing
Mirror of `cover` — full-bleed deep panel. Use as the final "thank you" slide.

- `title` — `text`, ≤ 60 chars.
- `subtitle` — `text`, ≤ 80 chars. Optional.

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

## Tokens

| Token | Value | Use |
|---|---|---|
| `bg-canvas` | #FBF7F0 | Cream slide background |
| `bg-card` | #FFFFFF | Card backings |
| `brand-primary` | #C0432D | Rust accent — title rules, KPI value |
| `brand-deep` | #8C2E1B | Header bar / closing panel |
| `text-strong` | #2C2620 | Body and titles |
| `text-muted` | #7A6F62 | Captions and subtitles |
| `accent` | #A88859 | Secondary accent (gold) |
| `divider` | #E5DCC9 | Hairlines and card borders |
