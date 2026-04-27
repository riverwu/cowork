# Forest & Moss

Sustainability / outdoor / wellness theme — cream canvas, deep forest text, moss accents. Restrained editorial style (no accent rules under titles).

## When to use this theme
- Sustainability, outdoor brands, wellness, environmental research.

## When NOT to use
- Tech-heavy or dense data decks (palette feels editorial, not analytical).

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

| Token | Value |
|---|---|
| `bg-canvas` | #F5F5F0 cream |
| `bg-card` | #FFFFFF white |
| `text-strong` | #1E2A1F deep forest |
| `text-muted` | #5A6B5D warm gray-green |
| `brand-primary` | #2C5F2D forest |
| `brand-deep` | #1A3A1B very-deep forest |
| `accent` | #97BC62 moss |
