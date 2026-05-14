# SlideML2 Chart Capabilities Plan

Last updated: 2026-05-14

## Context

SlideML2 is primarily a tool used by agents to produce PowerPoint decks. The chart roadmap should therefore avoid turning SlideML2 into a hidden "chart planner" that guesses the user's intent. The better direction is to give agents stronger, clearer expression primitives and make the renderer reliable when the agent asks for complex charts, tables, and graphics.

This document records the chart-related planning points for later discussion.

## Product Principle

The agent should own semantic decisions:

- Which chart type to use.
- Which dimensions and measures are encoded.
- Which comparisons are meaningful.
- Which data should be normalized, grouped, filtered, highlighted, or annotated.
- Which visual style best fits the slide narrative.

SlideML2 should own execution quality:

- Render the requested chart faithfully.
- Provide enough schema surface for precise chart expression.
- Keep labels, tables, and graphics readable inside fixed slide regions.
- Provide local layout intelligence where deterministic geometry is required.
- Validate or warn when the requested visual structure is likely to break.

In short: do not make SlideML2 a decision-making analyst; make it a stronger rendering and layout instrument for agents.

## Current State

`chart-card` already supports a useful base set:

- Chart types: `bar`, `stacked-bar`, `line`, `pie`, `doughnut`, `area`, `combo`, `scatter`, `waterfall`.
- Data input: direct `labels + series`, `data.{labels,series}`, and bound data via `bind + encoding`.
- Styling controls: `colors`, per-series `color`, line width, line dash, markers, smoothing, positive/negative colors, `variant`, `surface`, `tone`.
- Chart structure controls: axes, secondary axis, legend, plot area, orientation, number formatting.
- Data labels: category/value/percent/series/legend-key/leader-line options.

Recent v1.0.44 fixes:

- Pie/doughnut labels for tiny slices are suppressed by default below `3%`, configurable via `dataLabels.minPercent`.
- `bar-list` now parses currency/unit strings such as `¥274.7万`.
- `bar-list` fill layout now uses proportional zero-basis sizing, so values remain comparable when rendered.

## Gaps

The current capability is still too coarse for high-end analytical decks:

- The same chart type does not yet have named style presets such as `minimal`, `dense`, `executive`, `editorial`, or `dark-dashboard`.
- Label placement is only partially robust. Pie/doughnut small-slice suppression helps, but broader collision handling is still missing.
- Complex tables are not expressive enough for dashboards where cells contain bars, deltas, sparklines, badges, icons, and grouped headers.
- Automatic layout inside a bounded table or chart region is limited.
- Agent-facing documentation does not yet show enough chart style variants and advanced composition examples.
- Native chart support and custom composed graphics are not clearly separated in the authoring model.
- Chart annotations, callouts, threshold bands, reference lines, and highlight regions need a more explicit grammar.

## Roadmap Direction

### 1. Stronger Chart Expression

Expose more chart properties directly, so agents can specify intent without relying on hidden heuristics:

- `chartStyle`: named presets for common visual treatments.
- `series[].style`: per-series color, opacity, line width, dash, marker, fill, stack group, axis.
- `dataLabels`: richer placement and fallback rules, including min value/share thresholds and outside-label behavior.
- `annotations`: reference lines, threshold bands, callouts, highlighted points, highlighted ranges.
- `scales`: explicit linear/log/percent/indexed behavior and domain control.
- `axis.format`: clearer formatting for currency, percent, compact numbers, Chinese units, and custom OOXML formats.

Design requirement: these controls should be explicit authoring knobs. SlideML2 may provide defaults, but should not silently reinterpret the analysis.

### 2. Reliable Bounded Layout

Improve deterministic layout where the renderer must make geometric decisions:

- Prevent label overlap for pie, doughnut, bar, line, and scatter labels.
- Add label fallback modes: hide, move outside, leader line, abbreviate, shrink, or convert to legend/table.
- Support fixed chart body boxes, fixed legend boxes, and fixed annotation layers.
- Add overflow diagnostics when a chart cannot fit cleanly.
- Keep layout behavior inspectable in the render tree.

This is an appropriate place for SlideML2 automation because it is geometry execution, not analytical decision making.

### 3. Advanced Table And Matrix Rendering

Add a table system that can carry analytical visuals inside cells:

- Multi-level row and column headers.
- Cell-level bars, progress fills, heatmap fills, badges, deltas, sparklines, icons, and mini charts.
- Column sizing modes: fixed, weighted, content-fit, min/max constrained.
- Row sizing modes: fixed, weighted, compact, content-fit.
- Cell text auto-fit and wrapping policies.
- Group separators, subtotal rows, pinned summary rows, and zebra/section styling.
- Region-level layout rules, so a full table can fit a given bounding box reliably.

This is likely one of the highest-value areas because many business charts are really table-chart hybrids.

### 4. Composed Graphics Layer

Support charts that are better expressed as composed graphics instead of native Office charts:

- Funnel, sankey-like flows, quadrant maps, timelines, waterfall variants, contribution bridges.
- Icon arrays and pictograms.
- Small multiples.
- Lollipop, dumbbell, bullet, slope, bump, and dot-plot variants.
- Custom legends and inline explanations.

The agent should choose these compositions explicitly. SlideML2 should provide reliable primitives and layout helpers.

### 5. Style System

Separate data encoding from visual styling:

- Add named chart style presets that map to existing low-level properties.
- Keep all presets overridable.
- Make presets theme-aware.
- Include examples in `SKILL.md` showing the same data rendered with multiple styles.
- Avoid one-off hardcoded style guesses inside chart generation.

Possible initial presets:

- `minimal`: low ink, thin axes, muted gridlines.
- `dashboard`: compact, strong value labels, high scanability.
- `editorial`: larger type, callouts, restrained annotations.
- `comparison`: emphasizes ranked differences and direct labels.
- `dense`: smaller typography, compact legend, optimized for many series.

### 6. Validation And Feedback

Add checks that help agents correct their own SlideML:

- Warn when stacked bars compare non-normalized totals as if they were normalized.
- Warn when percent labels and raw values are mixed ambiguously.
- Warn when chart data has tiny slices that cannot carry internal labels.
- Warn when too many categories or series exceed readable limits.
- Warn when labels, legends, or tables overflow their region.

The warning should explain the rendering risk, not decide the replacement chart.

## Near-Term Work Items

1. Add `chartStyle` presets for existing chart types.
2. Expand `SKILL.md` examples to show the same chart with multiple style choices.
3. Add broader data label collision tests using real generated deck cases.
4. Design a first-class `table-grid` or `analytic-table` component for bounded table layouts.
5. Add cell visual primitives: bar, delta, badge, heat, sparkline, icon.
6. Add chart/table overflow diagnostics to render-tree output.
7. Add annotation grammar for reference lines, threshold bands, and callouts.

## Open Questions

- Should `chartStyle` be a small closed enum first, or allow custom named presets from theme files?
- Should advanced composed charts be separate components, or a generic `composed-chart` with mark primitives?
- How much OOXML native chart support should be prioritized versus custom vector compositions?
- What is the minimum table grammar that unlocks real business dashboard use cases without becoming a spreadsheet engine?
- Should layout warnings fail validation, or remain non-blocking authoring feedback?

## Working Position

The strongest opportunity is not to make SlideML2 smarter at choosing charts. The strongest opportunity is to make it more capable and predictable as an agent-facing visual language:

- More expressive chart schema.
- More reliable bounded layout.
- More powerful analytical tables.
- More reusable style controls.
- Better validation feedback.

That keeps agency with the agent while raising the ceiling of what SlideML2 can render.
