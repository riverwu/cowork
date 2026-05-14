# PPT Flow Improvement Plan

This plan is generated from the current live PPT coverage runs. It is intentionally a plan, not an implementation patch: code changes should start only after the plan is approved.

## Execution Status

Approved on 2026-05-10 and implemented as general system changes:

- P0 reporting now writes per-run `failure-analysis.json` and `improvement-candidates.md`, and suite runs write an aggregated `overall-improvement-plan.md`.
- P0 enum vocabulary now accepts documented semantic aliases such as `success -> positive`, `info -> brand`, and `callout.variant:"panel" -> "card"` while keeping canonical examples in the skill.
- Dense KPI/stat and compact numbered-equation regressions have focused component coverage.
- The installed SlideML2 skill copy has been synchronized with the source skill so the app exposes the updated component contract.

Verification completed with the focused PPT runner/tool tests, full SlideML2 test suite, and TypeScript checks. Live LLM case reruns remain the next comparison step when a fresh end-to-end quality sample is needed.

## 2026-05-10 HR Excel Rerun Follow-Up

The `hr-h1-2025-analysis` rerun generated a final PPTX with zero final blocking render diagnostics, but failed the workflow expectation because the agent only completed four successful `replace_slide` calls and then repaired the deck through lower-level file/script operations. This is a product signal, not a case-specific prompt issue: the standard SlideML2 path was too hard to recover from once a dense chart/KPI/table slide failed.

Implementation status: approved and implemented as general system changes.

- `replace_slide` and `validate_render` now expose compiler-style diagnostics with stable normalized codes, exact slide/node/json locations, expected/actual measurements, and ordered repair suggestions.
- Capacity repair suggestions now preserve the current component and design intent first. Alternative components are marked optional and should be used only when semantically better, not just easier to validate.
- `describe_schema` exposes concise guidance only for high-friction components: `chart-card`, `table-card`, `kpi-grid`, `stat-strip`, `code-block`, `equation`, and `process-flow`.
- `SKILL.md` now contains a compact Targeted Component Capacity Guidance section and has been synchronized to `/Users/river/.cowork/skills/slideml2/SKILL.md`.
- `slideml2/dist` and app `dist` were rebuilt after implementation.

### P0. Add targeted usability guidance for key components

Problem: components are individually valid but can be combined into impossible layouts. In the HR run, a `chart-card` bar chart was placed alongside KPI/stat/table content and was squeezed to about `1.34cm` high, below the useful minimum for a bar chart. The agent then abandoned the intended chart-heavy design.

Plan:

- Add concise, public usability guidance only for high-impact components where repeated live runs show friction. Initial scope:
  - `chart-card`;
  - `table-card`;
  - `kpi-grid` / `stat-strip`;
  - `code-block`;
  - `equation`;
  - `process-flow`.
- Keep `SKILL.md` compact. Put only the most important constraints and repair principles there; keep fuller component profiles in schema/docs or tests when possible.
- For each scoped component, document:
  - minimum useful width/height;
  - recommended content cardinality, such as max bars, rows, KPI cards, bullets, and labels at default density;
  - supported density modes and what each mode sacrifices;
  - preferred companion components and incompatible dense combinations.
- Do not add a separate preflight composition-budget layer now. The final render/validation path already gives the agent a useful feedback loop; the immediate improvement is to make that feedback more precise and actionable.
- When render validation detects capacity failure, attach a `COMPONENT_CAPACITY` diagnostic that identifies the component, allocated size, required useful size, and semantic repair choices.
- Order repair choices to preserve the selected component and design intent first:
  - increase the component area or change the slide layout ratio;
  - make the chart full-width/full-height;
  - reduce rows/items/labels within the same component;
  - split supporting context into another slide;
  - only then suggest an alternative component when it better preserves the content semantics.
- Keep these as authoring affordances, not hard case-level constraints. The agent remains free to choose another valid layout; reports should record degraded or omitted planned components as soft signals.

Tests:

- Add component tests for `chart-card` with pie/bar/negative-bar data in narrow, short, and mixed KPI/table layouts.
- Add focused combination tests for existing components: chart + KPI rail, chart + table, chart + stat-strip, and dense source table.
- Assert that impossible combinations fail with capacity diagnostics that identify the exact component, allocated size, minimum useful size, and suggested repairs.

### Deferred. Do not add new business/data recipe components now

Problem: agents need better authoring guidance, but adding recipe components or many recipe examples would expand the public surface and bloat `SKILL.md`.

Plan:

- Do not add new recipe components for now.
- Do not add a large recipe catalog to `SKILL.md`.
- If examples are needed, keep them as short guidance under the existing key components and prefer component-preserving adjustments over component replacement.
- Revisit only if repeated runs show that diagnostics and targeted component guidance are insufficient.

Tests:

- No new recipe-component tests at this stage.

### P0. Standardize `replace_slide` and deck-generation diagnostics like compiler errors

Problem: current failures often contain useful data, but not in a consistent shape that lets an agent quickly locate and repair the issue. Tool output should behave like compiler diagnostics: exact location, reason, expected constraint, actual value, and repair hint.

Plan:

- Define a stable diagnostic schema for `replace_slide`, `insert_slide`, `create_deck`, and `validate_render`:
  - `severity`: `error | warning | info`;
  - `code`: stable identifier such as `SLIDEML_COMPONENT_CAPACITY`, `SLIDEML_JSON_PARSE`, `SLIDEML_SCHEMA_ENUM`, `SLIDEML_TEXT_OVERFLOW`;
  - `message`: one short human-readable sentence;
  - `location`: slide id/index, node id, component type, JSON path, and data row/column when applicable;
  - `expected`: the required constraint, enum values, minimum size, max rows, or schema shape;
  - `actual`: the invalid value, allocated size, observed rows, measured text height, or parse position;
  - `suggestions`: ordered repair options that preserve the semantic intent;
  - `examplePatch`: optional minimal valid JSON snippet when useful;
  - `related`: sibling components or layout regions that caused the capacity conflict.
- Make the text output concise and deterministic, while also returning the full machine-readable diagnostics in tool JSON and reports.
- For malformed JSON-string arguments, report line/column, JSON path when recoverable, a small excerpt, and one canonical object-shaped call example. Valid JSON-string objects may be parsed only when semantics are unambiguous.
- For component capacity failures, include allocated vs required dimensions, not only generic render codes.
- Avoid biased repair guidance that defaults to easier-to-pass component replacement. Suggestions should first preserve the current component and semantic intent by changing sizing, layout ratio, pagination, density, labels, or data grouping. Alternative components should be suggested only when they are semantically more appropriate, and such suggestions should be clearly marked as optional.
- For final reports, group diagnostics by slide/component/code and preserve the first failing attempt plus the final recovery path.

Tests:

- Add unit tests for JSON parse, schema enum, component capacity, text overflow, and table capacity diagnostics.
- Snapshot the public diagnostic shape so future changes do not regress agent-readable fields.

### Deferred. Do not add extra workflow guidance unless bypassing becomes repeated

Problem: after repeated `replace_slide` failures, the agent recovered by directly manipulating deck files. That can produce a visually valid PPTX while bypassing the intended component/schema workflow.

Plan:

- Do not add extra workflow guidance now if the existing workflow remains effective in normal runs.
- Keep current strict-flow reporting: if a case explicitly requires `replace_slide`, direct deck mutation can still be reported as workflow degradation by the runner.
- Prioritize improving component diagnostics and existing `replace_slide` feedback before adding new agent instructions or workflow rules.

Tests:

- No additional workflow tests unless future runs show repeated bypassing after diagnostics improve.

## Scope

Input reports:

- `latest-components/reports/2026-05-10T03-49-53-938Z/report.json`
- `physics-mechanics-lecture/reports/2026-05-10T03-53-09-878Z/report.json`
- `youdao-company-profile/reports/2026-05-10T04-15-06-831Z/report.json`

All three cases eventually passed with zero final blocking diagnostics. The failures below are still product signals because the agent had to repair or simplify slides repeatedly before the final deck became valid.

## Run Findings

| Case | Outcome | Failed tool calls | Main evidence |
| --- | --- | ---: | --- |
| `latest-components` | PASS | 4 `replace_slide` failures | `cover-composition` caption was too tight; KPI/stat-strip layouts produced `SQUASHED` and `TRUNCATED` diagnostics before the agent switched density. |
| `physics-mechanics-lecture` | PASS | 20 failures: 15 `replace_slide`, 4 `run_python`, 1 `create_deck` | `callout.variant:"panel"` and `tone:"info"` were intuitive but invalid; equation number sizing failed; `process-flow`, equations, tables, and takeaway lists repeatedly overfilled. |
| `youdao-company-profile` | PASS | 9 `replace_slide` failures | Duplicate hero title, raw hex color, `feature-card.tone:"success"`, dense feature-card grid, KPI/stat values, malformed JSON-string slide argument, dense SWOT matrix, and one unused generated icon asset warning. |

## Cross-Case Problems

### P0. Add automatic post-run improvement analysis

Problem: current reports prove whether a run passed, but they do not automatically turn intermediate failures into component/tool improvement candidates. This makes repeated `replace_slide` failures easy to miss when the final deck passes.

Plan:

- Extend the PPT flow runner report writer to generate per-run `failure-analysis.json` and `improvement-candidates.md`.
- Group failed tool calls by tool, diagnostic code, slide id, node id, component id, schema error path, and repeated retries.
- Distinguish final blocking failures from recovered friction. A passing run can still produce improvement candidates.
- Add suite-level aggregation such as `overall-improvement-plan.md` that merges candidates across cases.
- Keep this as reporting only. It must not auto-edit code or mutate prompts.

Tests:

- Add unit tests with synthetic failed `replace_slide`, `create_deck`, and tool-argument records.
- Verify grouping, severity assignment, and Markdown output.

### P0. Normalize component enum vocabulary

Problem: agents use semantically natural values that are rejected by schema:

- `callout.variant:"panel"` when the valid values are `plain | card | banner`.
- `callout.tone:"info"` when the valid values are `neutral | brand | positive | warning | danger`.
- `feature-card.tone:"success"` when the valid positive value is `positive`.

Plan:

- Decide whether to support aliases or expand the public enum. Prefer semantic aliases only when they preserve the public contract:
  - `success -> positive`
  - `info -> brand` or a real `info` tone if theme tokens already support it consistently.
  - `panel -> card` only if the rendering semantics are equivalent.
- Apply the same rule in schema, validation diagnostics, component docs, and `SKILL.md`.
- Keep invalid values rejected when there is no clear semantic match.

Tests:

- Schema tests for accepted aliases or expanded enums.
- Component isolation tests proving aliases render identically to canonical values.
- Skill text review to ensure examples use canonical values.

### P0. Improve capacity handling for dense data components

Problem: multiple components are valid by schema but easy to overfill:

- `table-card` row heights failed repeatedly in physics formula/application tables.
- `kpi-grid` and `stat-strip` struggled with Chinese financial values such as `56.3亿`, `8220万`, and percentage strings.
- `feature-card` 4-up rows and dense SWOT matrices generated many `SQUASHED`, `TINY_RECT`, and `FALLBACK_FAILED` diagnostics.

Plan:

- Strengthen per-component capacity estimation before rendering:
  - estimate minimum row heights for table text and fail earlier with exact row/column guidance;
  - add safer default font scaling and minimum value-box heights for KPI/stat components with CJK and mixed unit strings;
  - provide density-aware limits for feature-card grids and SWOT matrices.
- Prefer general auto-layout improvements over case prompt edits.
- When content cannot fit, diagnostics should explicitly suggest splitting into another slide or reducing items, not just increasing height.

Tests:

- Add component tests with Chinese table rows, CJK numeric units, negative percentages, 4-card grids, and 4-quadrant SWOT content.
- Add render validation snapshots confirming no `SQUASHED`, `TINY_RECT`, or table row overflow.

### P1. Make process-flow more robust and self-guiding

Problem: the physics case repeatedly failed when `process-flow` steps contained bullets, equations, and fixed/max heights. The component is useful, but its current affordance invites too much content per step.

Plan:

- Add explicit density modes and documented capacity limits for steps, titles, captions, and bullets.
- Consider a compact educational mode that can render step title + one formula + one short note without manual sizing.
- Improve diagnostics so the agent knows whether to remove bullets, switch orientation, change to table, or split the slide.

Tests:

- Horizontal and vertical process-flow stress cases with arrows, bullets, and formulas.
- Visual regression checks for arrow alignment and step content separation.

### P1. Harden equation layout around labels, numbers, and small containers

Problem: equation internals failed even when the overall math content was short, especially `equation.number` and multiple small formula cards.

Plan:

- Give equation labels/numbers reliable minimum space or allow them to wrap/shrink independently from the main formula.
- Add component-level validation for minimum useful height when equations are placed in grids.
- Keep the formula component valuable for curated equation blocks even though inline LaTeX exists in rich text.

Tests:

- Numbered equation tests in compact containers.
- Formula-grid tests with CJK labels and different theme font sizes.

### P1. Improve cover and title duplication ergonomics

Problem: duplicate title validation is useful, but agents still hit it on cover/hero pages. Cover caption sizing also failed in `cover-composition`.

Plan:

- Keep duplicate hero title validation, but improve examples and error repair text around `slide.title` as metadata vs visible hero text.
- Increase caption layout tolerance or add a caption density option in `cover-composition`.

Tests:

- Cover pages with metadata title only, visible hero title only, and matching metadata/visible title.
- Long caption fitting tests.

### P2. Make tool arguments more forgiving where semantics are unambiguous

Problem: agents sometimes pass object arguments as JSON strings. Current diagnostics are clear, but malformed slide strings caused repeated retries.

Plan:

- For `themeOverride` and `slide`, parse valid JSON strings when the semantics are unambiguous.
- Continue rejecting malformed strings with concise error context and one canonical example.
- Do not allow direct deck JSON writes to bypass validation.

Tests:

- Valid object, valid JSON string, and malformed JSON string inputs for `create_deck` and `replace_slide`.

### P2. Improve asset workflow checks

Problem: physics initially failed Python-generated assets because the output directory/font setup was fragile. Youdao generated one icon that was not used.

Plan:

- Add helper guidance or tool-side checks for output directory creation in generated asset workflows.
- Add CJK font guidance for `run_python` chart/diagram generation.
- Keep unused generated asset warnings visible in final reports and improvement candidates.

Tests:

- Report extraction test for unused generated icon warnings.
- Tool guidance tests or docs review for asset output paths and CJK font handling.

## Proposed Execution Order After Approval

1. Implement P0 reporting: per-run failure analysis and suite-level improvement plan generation.
2. Implement P0 enum normalization and documentation alignment.
3. Implement P0 dense component capacity tests and fixes for table/stat/KPI/feature/SWOT.
4. Implement P1 process-flow and equation layout hardening.
5. Implement P1 title/cover ergonomics.
6. Implement P2 tool-argument and asset-workflow polish.
7. Rerun deterministic coverage, then rerun the three live cases and compare generated improvement candidates.

## Approval Gate

No implementation changes should be made from this plan until approved. Once approved, every fix must follow the case optimization principles in this directory: no case-id checks, no hand-edited generated decks, no prompt-only workaround for an implementation/spec issue, and focused tests for each general fix.
