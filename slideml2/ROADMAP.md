# SlideML2 Roadmap

Last updated: 2026-05-12

This roadmap tracks the current SlideML2 implementation and the remaining work
needed for reliable commercial, research, and technical presentation delivery.

Priority:

- P0: required for the next reliable production-quality loop.
- P1: high-value expansion after the current validation/toolchain baseline.
- P2: longer-term presentation-system maturity.

---

## Current State

SlideML2 now has a usable agent-facing foundation:

- Source decks use `slideml2:2` JSON and are authored through validation gates,
  not by writing raw PPTX or bypassing the toolchain.
- The Cowork app's real `runAgent` loop is the supported end-to-end generation
  workflow. The old standalone markdown-to-PPTX path has been retired.
- The installable SlideML2 skill package exposes one CLI surface only:
  `create-deck`, `read-deck`, `replace-slide`, and `validate-render`. Commands
  run from the deck workspace and default to `./deck.json`.
- `replace-slide` remains a write gate: it validates the candidate slide and
  refuses to modify the deck when schema/render diagnostics block the page.
- Full-deck `validate-render` produces PPTX plus diagnostics and render-tree
  artifacts.

Implemented capability areas:

- Rich semantic components for business, research, technical, and editorial
  slides, including KPI, chart/table, process, timeline, evidence, formula,
  bibliography, code, and layout components.
- Layout primitives: `stack`, `grid`, `split`, `panel`, `card`, `band`,
  `frame`, `inset`, plus `area`, `at`, `anchor`, `anchorTo`, `layer`, and
  `zIndex` escape hatches.
- Theme override for colors, text styles, component surfaces, layout rhythm,
  fonts, chart defaults, chrome, and prompt-facing guidance.
- Data binding through deck-level data sources, `bind`, `encoding`, filtering,
  aggregation, pivoting, and render-tree data lineage.
- Scientific authoring through rich inline math/citations/footnotes/tokens,
  OMML equation output, bibliography generation, and code-block rendering.
- Validation diagnostics covering schema, data binding, text/table/chart
  capacity, collisions, overlay occlusion, title occlusion, low contrast,
  invisible shapes, code overflow, and empty chart/table data.
- E2E case infrastructure under `docs/ppt-flow-cases/` using the real Cowork
  agent loop, reports, failure analysis, and improvement plans.

Known remaining gaps:

- Artifact-level QA is not automated yet. The system still does not routinely
  render final PPTX to PDF/PNG and inspect pixel/text boxes for overlaps,
  blank charts, or distorted tables.
- Schema/disclosure/docs are improved but not fully generated from a single
  registry; drift can still occur.
- Advanced statistical charts, generalized diagram grammar, brand templates,
  provenance audit, accessibility, and animation are not complete.

---

## Completed Milestones

### M1: Contract Convergence And Layout Freedom

Status: completed as baseline.

Delivered:

- Schema registry baseline for deck size, validation mode, data/source enums,
  theme layout/component/surface fields, and common validation lists.
- Deck sizes `16x9`, `16x10`, `4x3`, and `wide` validate and render.
- `themeOverride.layout.areas` supports named areas using `{x,y,w,h}` or
  `{left,top,right,bottom}`; top-level `area:"name"` can target them.
- Surface override baseline supports fill/line opacity, line width/dash,
  shadow, gradient, and component/primitive surface alignment.
- Validation modes: `standard`, `strict`, and `experimental`.
- Strict mode can require image alt text and chart/table source metadata.
- Experimental mode can downgrade unknown nodes/components to warnings where
  render can fail safely.
- Component/schema/disclosure coverage tests and surface visual smoke tests.

Remaining follow-up:

- Complete generation of disclosure/SPEC/SKILL fragments from schema registry.
- Continue reducing manually maintained allowlists and duplicated docs.

### M2: Data-Driven Business Analysis

Status: completed as baseline.

Delivered:

- `deck.dataSources` supports `inline-json`, `inline-csv`, `file-csv`, and
  controlled `computed` sources.
- `chart-card`, `table-card`, `metric-card`, `hero-stat`, `stat-strip`, and
  primitive `chart` / `table` can resolve display data through `bind` and
  `encoding`.
- Data views support `select`, `filter`, `sort`, `limit`, `groupBy`,
  `aggregate`, and `pivot`.
- Aggregates include `sum`, `avg`, `min`, `max`, `count`, `first`, and `last`.
- Chart encoding supports `seriesOptions` for secondary axis, trend lines, and
  basic error bars.
- Bound table columns support key/field, label/header, type, format, alignment,
  and width.
- Validator checks source type, binding source, field references, aggregate ops,
  pivot specs, encoding fields, and series options.
- Render-tree includes resolved data and lineage metadata.

Remaining follow-up:

- Expand table semantics beyond first-stage column typing: conditionals,
  summary rows, row groups, sort indicators, embedded bars/sparklines.
- Add more statistical chart types.

### M3: Scientific And Technical Authoring

Status: completed as baseline.

Delivered:

- Rich inline content is backward-compatible with legacy `{text,...}` runs and
  adds `{kind:"math"}`, `{kind:"cite"}`, `{kind:"footnoteRef"}`,
  `{kind:"icon"}`, and `{kind:"token"}`.
- Text, paragraph runs, bullet runs, table cells, callouts, and content fields
  share the same rich inline rendering and measurement path.
- `equation` component and rich inline math render supported LaTeX to native
  Office Math (OMML).
- Unsupported LaTeX commands fail validation/render instead of leaking as plain
  text.
- `deck.references`, `deck.footnotes`, inline citations, table cell
  `footnoteRefs`, and `bibliography` component are linked.
- Citations are numbered by first use; bibliography defaults to cited items.
- `code-block` supports language, title, caption, line numbers,
  `highlightLines`, `maxLines`, and diff-style added/removed rows.
- Scientific regression coverage exists in `m3-scientific-capabilities.test.ts`.

Remaining follow-up:

- Improve OMML coverage for more complex matrices, align environments, chemical
  notation, and edge-case math layout.
- Improve formula/card capacity diagnostics for dense formula grids.

### Validation V1-V3: Geometry And Compiler-Style Diagnostics

Status: completed as baseline; deeper artifact QA remains.

Delivered:

- Shared diagnostic code source in `diagnostic-codes.ts`.
- Shared geometry helpers for overlap metrics and meaningful overlap.
- `MeasuredNode` includes layout `rect`, estimated `inkRect`, `visualRect`,
  `visualRole`, `relation`, `relatedTo`, `parentId`, and alpha metadata.
- Collision and occlusion checks prefer `visualRect || inkRect || rect`.
- Text/bullets estimate real required height and preserve overflow in ink
  rectangles, reducing both false negatives and some false positives.
- Container/card surfaces can participate in structural overlap diagnostics.
- Overlay checks detect flow occlusion while allowing behind/background
  decoration.
- Render-tree contains measured nodes, layout decisions, diagnostics, and
  collision records.
- Compiler-style diagnostics expose location, expected/actual, measured data,
  constraints, related nodes, and repair suggestions.

Still open:

- `EDGE_CLIPPED`, `OFF_SLIDE`, and `TIGHT_GAP` are not split into first-class
  diagnostics yet.
- Final rendered artifact QA is not implemented.

### Skill Packaging And Installation

Status: completed as baseline.

Delivered:

- `scripts/package-slideml2-skill.ts` builds a self-contained skill zip with
  runtime source, compiled dist, CLI, docs, package manifest, and production
  dependencies.
- Package v1.0.24 removed tool-adapter guidance and exposes only the CLI
  workflow.
- The CLI defaults omitted `deckPath` to `./deck.json` in the deck workspace.
- Normal CLI usage does not require `npm install`.
- Current installed local skill under `/Users/river/.cowork/skills/slideml2`
  has the latest SKILL/business docs.

Current cleanup:

- The obsolete standalone markdown conversion path is being removed from the
  runtime.

---

## Remaining Roadmap

### M4: Artifact QA, Provenance, And Templates

Priority: P0/P1.

Goal: make final delivery failures visible automatically, not only through
source/render estimates.

Scope:

- PPTX package sanity:
  - unzip/JSZip package structure checks;
  - slide rels, media, chart parts, notes, and OMML references;
  - fail on corrupt or missing package parts.
- Optional LibreOffice export gate:
  - headless PPTX -> PDF/PNG smoke;
  - fail when LibreOffice cannot open/render the PPTX.
- PDF text bbox QA:
  - detect substantial text overlaps, title/footer intrusions, and clipped text
    using extracted text boxes where available.
- PNG heuristics:
  - detect blank slides, blank chart/table regions, extremely compressed charts,
    and near-empty content bands.
- Provenance audit:
  - node-level provenance;
  - source lineage checks;
  - stale or missing source warnings;
  - source-note generation from provenance where appropriate.
- Brand template baseline:
  - template object for theme tokens, layout areas, component defaults, chrome,
    and examples/guidance;
  - local template registry;
  - ability to apply a consulting / academic / pitch template without changing
    slide content.

Acceptance:

- `validate-render` can optionally run artifact QA after PPTX creation.
- E2E case reports include artifact QA results and link them to slide/node ids
  where possible.
- Artifact QA remains a final-product check; it must not encourage bypassing
  SlideML2 source validation.

### M5: Diagram Grammar, Accessibility, And Presentation Builds

Priority: P1/P2.

Goal: cover complex organizational, process, and presentation-delivery needs.

Scope:

- General `diagram` component:
  - `flowchart`, `org-chart`, `network`, `sankey`, `tree`, `causal-loop`;
  - shared `nodes` / `edges` grammar;
  - output as editable PowerPoint shapes/text.
- Accessibility:
  - slide `readingOrder`;
  - stricter alt/title/caption coverage;
  - contrast and reading-order audit report.
- Animation/build sequence:
  - node-level appear/fade/fly basics;
  - chart build by series/category;
  - stat/process/timeline click sequence support.

Acceptance:

- Complex diagrams render without image fallback for common cases.
- Strict accessibility report gives measurable coverage.
- Basic click-build sequences open in PowerPoint without repair.

---

## Cross-Cutting Work

### Schema And Docs Single Source

Priority: P1.

- Generate or test disclosure/SPEC/SKILL fragments from schema registry.
- Any validator-accepted public field must be documented or explicitly marked
  internal.
- Any documented field must be accepted by validation or marked planned.

### Component Capacity And Usability

Priority: P0/P1.

- Keep improving `chart-card`, `table-card`, `kpi-grid`, `stat-strip`,
  `process-flow`, `timeline`, `equation`, `code-block`, and evidence layouts.
- Prefer diagnostics and suggestions that preserve semantic component choice:
  adjust area, ratio, density, pagination, labels, legend, columns, rows, or
  data grouping before changing components.
- Replace hard-coded capacity limits with real measurement wherever content,
  style, and area are known. Hard thresholds are acceptable only as non-blocking
  quality guidance for objects that cannot yet be measured accurately.
- Treat false positives as product defects: a diagnostic that interrupts the
  agent must prove the problem with measured rects, needed/available dimensions,
  or final-render evidence.
- Build a single text measurement path shared by measure, auto-fit shrink,
  table cells, code blocks, and text diagnostics. The path should return
  line count, needed width/height, unbreakable width, ink rect, and fitted font
  size so every diagnostic uses the same numbers.
- Implement that path in phases: first extract a `TextMeasurer` interface and
  remove the duplicate auto-fit calibration table without changing behavior;
  then add an OpenType-based measurer PoC; then add real line breaking and
  vertical metrics.
- P7-A/P7-B/P7-C/P7-D are implemented as the current baseline. `text-measure.ts` owns the
  measurement interface, `render.ts` uses it for text width, wrapping, table
  cell height, bullet height, and auto-fit shrink, and
  `tools/generate-font-metrics-pack.mjs` generates `font-metrics-pack.ts`.
  Runtime measurement reads the generated metrics pack; it does not parse or
  redistribute font files. Wrapping now uses greedy break segments with CJK
  punctuation guards and Latin technical breakpoints instead of raw
  `ceil(totalWidth / width)` estimation. Vertical measurement now uses
  font-derived ascent/descent/leading with a PowerPoint-like line-box cap for
  tall CJK font bboxes, separates text box reserve from `inkRect`, and remeasures
  fallback-applied shrink with the fitted font size.
- Treat LibreOffice PDF bbox as the automated calibration target for now, with
  PowerPoint kept as sampled release validation. Do not block fast
  `replace-slide` on PDF/PNG artifact QA.
- Move component body/detail min-height from hand-written weighted-length
  estimates to declarative constraints plus the shared measurement model.
- Make `TINY_RECT` and `SQUASHED` role-specific: text uses measured text fit,
  chart/table/code use component readable area, marker/rule/decorative nodes do
  not inherit body-text thresholds.
- Add focused tests whenever an E2E case exposes component degradation.

### Component Semantic Contract

Priority: P0.

- Component behavior must match the public registry/SKILL/SPEC contract. If a
  field says it controls semantic tone, layout, density, or data binding, the
  implementation must preserve that meaning.
- Do not change component semantics to pass validation. Fix the measurement,
  token mapping, contrast handling, capacity diagnostic, or layout strategy
  instead.
- Fallback may drop decoration and secondary evidence, but it must not silently
  remove core semantic content. When core content cannot fit, emit a
  component-level capacity diagnostic with a concrete measured deficit.
- Add internal semantic importance metadata for expanded nodes:
  `core`, `supporting`, or `decorative`. Fallback may drop decorative nodes,
  may warn on supporting drops, and must reject with a component-level capacity
  diagnostic when core content cannot fit.
- First coverage target: feature-card, insight-card, numbered-grid,
  explanation-block, timeline, process-flow, and image-card.
- Add contract tests for every semantic correction: one test for the declared
  interface behavior, one test for the validate/render diagnostic behavior, and
  one test that guards against component degradation in a realistic layout.

### Compiler-Style Fix Hints

Priority: P1.

- Keep natural-language suggestions, but add machine-readable `fixHints` to
  diagnostics where the repair is structured:
  `increase-area`, `reduce-columns`, `set-density`, `paginate`,
  `shorten-secondary`, `move-supporting-content`.
- Hints must prefer preserving the current semantic component. They should not
  steer the agent toward easier generic components unless the replacement is
  semantically more accurate.
- Include concrete fields where possible: target node/path, axis, current value,
  minimum delta, candidate values, and whether the hint preserves component
  semantics.

### E2E Case Process

Priority: P0.

- Keep live cases under `docs/ppt-flow-cases/` as realistic requests, not
  golden scripts.
- Every run should produce reports, failure analysis, and improvement plans.
- Fixes must be general: no case-id, filename, topic, or prompt workarounds.
- Passing runs still matter when they contain recovered failures, repeated
  `replace-slide` attempts, quality diagnostics, unused assets, or component
  degradation.

### Toolchain Simplification

Priority: P0.

- Supported deck creation/modification flow is the Cowork agent loop plus
  SlideML2 authoring/render tools.
- The installable skill package exposes only the CLI workflow:
  `create-deck`, `read-deck`, `replace-slide`, `validate-render`.
- Deprecated standalone conversion flows should remain removed.

---

## Engineering Discipline

- Every new public field must update schema, validator, disclosure/SKILL/SPEC,
  and tests.
- New OOXML output paths need package-level tests to avoid PowerPoint repair.
- Data binding, formula, citation, and provenance transformations must leave
  resolved/source information in render-tree or diagnostics.
- Do not downgrade a component just to pass validation when a semantic layout or
  capacity fix is possible.
- Do not hand-patch generated PPTX or generated source decks as a substitute for
  fixing the runtime, schema, component, skill, or test runner.
