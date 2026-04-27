# Technical Blue

A clean engineering / data-presentation theme. Deep navy canvas, cyan
accents, high information density. Designed for technical reports,
post-mortems, market analyses, and quarterly reviews.

## When to use this theme
- Engineering reviews, architecture proposals, post-mortems.
- Quarterly business reviews and market analyses with charts and KPIs.
- Audiences expecting precision over polish.

## When NOT to use
- Sales / marketing decks (warmer palette would land better).
- Investor pitches (less density, more whitespace).
- Print-oriented documents.

## Layout reference

### cover
Title slide. Pick for slide 1 only. Uses chrome `none` automatically.

- `title` — `text`, ≤ 60 chars. Required.
- `subtitle` — `text`, ≤ 80 chars. Optional.
- `eyebrow` — `text`, ≤ 20 chars. Optional. Small label above the title (e.g. "2026 Q1 Review").

![cover](thumbnails/cover.png)

### section-divider
Section break between major parts of the deck.

- `eyebrow` — `text`, ≤ 20 chars. Optional. Small label above the title (e.g. "第二部分").
- `title` — `text`, ≤ 50 chars. Required. The section name.

![section-divider](thumbnails/section-divider.png)

### stat-grid-3
Three KPI tiles in a row. Pick when surfacing 3 headline metrics.

- `title` — `text`, ≤ 40 chars. Required.
- `items` — `bullets`, exactly 3 entries. Each entry is a KPI object:
  `{ value: text(8), label: text(20), delta: text(10), trend: up|down|flat }`.

> **Guidance:** Pick THE three most newsworthy numbers — not whatever you have data for. If only two KPIs are genuinely material, use a different layout. Don't set every `trend` to `up`; that loses signal. `value` is the headline (e.g. "$42.5M"), `label` names the metric, `delta` shows the comparison ("+85% YoY", not "85").

![stat-grid-3](thumbnails/stat-grid-3.png)

### bullet-with-image
Title + 3-6 bullets on the left, image on the right.

- `title` — `text`, ≤ 50 chars. Required.
- `bullets` — `bullets`, 3-6 entries, each ≤ 80 chars. Required.
- `image` — `image-ref`. Optional — when omitted, bullets expand to full width.

> **Guidance:** Bullets are TERSE — typically 5-12 words, never full sentences with em-dashes. Long prose belongs in `notes:`. If you don't have a real image, omit `image` (don't fabricate URLs).

![bullet-with-image](thumbnails/bullet-with-image.png)

### two-col-text-image
Symmetric two-column layout with paragraph text on one side and an image
on the other. Use for "headline + visual" slides.

- `title` — `text`, ≤ 50 chars. Required.
- `text` — `text-block`, ≤ 400 chars. Required.
- `image` — `image-ref`. Required.
- `imageSide` — `text` (`left` or `right`). Optional, default `right`.

![two-col-text-image](thumbnails/two-col-text-image.png)

### quote
Pull-quote slide. Use for testimonials, key insights, or punctuation slides.

- `quote` — `text-block`, ≤ 240 chars. Required.
- `attribution` — `text`, ≤ 60 chars. Optional. Speaker / source.

![quote](thumbnails/quote.png)

### chart-with-takeaway
Title + native data chart + boxed conclusion. Pick when the slide's job is
to show one chart and one takeaway sentence.

- `title` — `text`, ≤ 50 chars. Required.
- `chart` — `chart-spec`. Required. `{ type: bar|stacked-bar|line|area|pie|doughnut, data: { labels, series }, format: { y: int|decimal|percent|wanyuan|yi }, title? }`.
- `takeaway` — `markdown-inline`, ≤ 160 chars. Optional. Rendered in a callout below the chart.

> **Guidance:** The `takeaway` is a CONCLUSION (so-what), not a chart caption. Bad: "Chart shows quarterly revenue". Good: "**Q4 grew 19% QoQ** — second-half acceleration is real, not a base-effect." Pick chart `type` by intent: bar = compare across categories; line = change over time; stacked-bar = composition over time; pie = part-of-whole when ≤4 slices.

![chart-with-takeaway](thumbnails/chart-with-takeaway.png)

### title-only
Single centered title — use as a section transition or chapter break.

- `title` — `text`, ≤ 80 chars. Required.

![title-only](thumbnails/title-only.png)

### agenda
Numbered list of upcoming sections (TOC).

- `title` — `text`, ≤ 30 chars. Optional. Defaults to "目录" / "Agenda".
- `items` — `bullets`, 2–8 entries, each ≤ 60 chars. Required.

![agenda](thumbnails/agenda.png)

### compare-two-columns
Side-by-side option A / option B card layout.

- `title` — `text`, ≤ 50 chars. Optional.
- `leftTitle` — `text`, ≤ 30 chars. Required.
- `leftBody` — `text-block`, ≤ 280 chars. Required.
- `rightTitle` — `text`, ≤ 30 chars. Required.
- `rightBody` — `text-block`, ≤ 280 chars. Required.

![compare-two-columns](thumbnails/compare-two-columns.png)

### process-timeline
3–5 steps along a horizontal rail with cyan dots.

- `title` — `text`, ≤ 50 chars. Required.
- `steps` — `bullets`, 3–5 entries. Each may be a string or an object `{ title, description? }`.

![process-timeline](thumbnails/process-timeline.png)

### image-grid-2x2
Up to 4 images in a 2×2 grid with optional captions.

- `title` — `text`, ≤ 50 chars. Optional.
- `images` — `bullets`, 2–4 entries. Each entry is `{ src, alt?, caption? }`.

![image-grid-2x2](thumbnails/image-grid-2x2.png)

### hero-image-overlay
Full-bleed image with a translucent overlay carrying a title and subtitle.

- `image` — `image-ref`. Required.
- `title` — `text`, ≤ 60 chars. Required.
- `subtitle` — `text`, ≤ 100 chars. Optional.
- `align` — `text` (`bottom-left` | `bottom-right` | `bottom-center` | `top-left` | etc.). Optional, default `bottom-left`.

![hero-image-overlay](thumbnails/hero-image-overlay.png)

### data-table
Native OOXML table with a header row, alternating row fills, and clean borders.

- `title` — `text`, ≤ 50 chars. Optional.
- `table` — `table`. Required: `{ header: string[], rows: string[][], colWidths?: number[] }`. `colWidths` are relative weights (1–N).

![data-table](thumbnails/data-table.png)

### code-block
Code snippet on a dark card with monospace text and an optional language badge.

- `title` — `text`, ≤ 50 chars. Optional.
- `language` — `text`, ≤ 16 chars. Optional. Shown as a small badge top-right of the card (e.g. `typescript`, `python`).
- `code` — `text-block`, ≤ 1600 chars. Required. Newlines preserved as line breaks.
- `caption` — `markdown-inline`, ≤ 160 chars. Optional. Italic line below the card.

![code-block](thumbnails/code-block.png)

### closing
Mirror of `cover` — full-bleed deep-blue panel with a centered title and optional subtitle. Use as the final "thank you" slide.

- `title` — `text`, ≤ 60 chars. Required.
- `subtitle` — `text`, ≤ 80 chars. Optional.

![closing](thumbnails/closing.png)

### dashboard
2×2 grid where each cell hosts a polymorphic region. Use when one slide
must surface multiple kinds of content at once (KPI + chart + table + text).

- `title` — `text`, ≤ 50 chars. Optional.
- `tl` / `tr` / `bl` / `br` — `region` cells. Each cell is one of:
  - `{ kind: "kpi", value, label, delta?, trend? }`
  - `{ kind: "chart", chart: { type, data, format? }, title? }`
  - `{ kind: "table", table: { header, rows, colWidths? }, title? }`
  - `{ kind: "text", body, title? }`
- Only `tl` is required; remaining cells render empty when omitted.

> **Guidance:** Use this ONLY when the slide truly needs heterogeneous content together (executive briefing). For a single chart, single table, or single KPI grid prefer the focused layout (chart-with-takeaway / data-table / stat-grid-3) — they look better. Mix kinds across cells: don't put 4 KPIs here, use stat-grid-3.

![dashboard](thumbnails/dashboard.png)

## Components

### header
Slide-top eyebrow + title block. Used internally by content layouts.

- `eyebrow` — `text`, ≤ 20 chars. Optional.
- `title` — `text`, ≤ 60 chars. Required.

### footer
Slide-bottom byline (date or context). Not used by chrome — see `page-number` for the master page-number stamp.

- `text` — `text`, ≤ 40 chars. Required.

### kpi-tile
A single KPI card. Slots: `value` (text ≤ 8), `label` (text ≤ 20),
`delta` (text ≤ 10, optional), `trend` (text `up`/`down`/`flat`, optional).

### takeaway-callout
Boxed conclusion at the bottom of a content slide.

- `text` — `markdown-inline`, ≤ 160 chars. Required.

## Tokens

This theme exposes these tokens. SlideML can reference them via theme defaults.

- `bg-canvas` — deep navy slide background.
- `bg-card` — slightly lighter card / surface fill.
- `brand-primary` — cyan, primary accents and KPI values.
- `brand-deep` — deeper blue, secondary accents and section dividers.
- `text-strong` — high-contrast body and title text.
- `text-muted` — labels, captions, page numbers.
- `accent` — warm orange, used sparingly for deltas / callouts.
- `divider` — hairline color for separators and outlines.
- `font-latin` — Latin font fallback chain (Inter → Helvetica → Arial).
- `font-cjk` — CJK font fallback chain (PingFang SC → Microsoft YaHei → Source Han / Noto).
- `font-mono` — monospace fallback chain.

## Chrome

Decorations applied to every slide unless the slide opts out with `chrome: none`.

- `page-number` — bottom-right, muted; "n / N" format.
- `brand-bar` — 2pt cyan bar along the bottom edge.

## Examples

See `examples/` for short SlideML decks rendered in this theme.
