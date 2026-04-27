# SlideML — Implementation Plan

A typed, theme-driven YAML language for slide-deck generation. Compiles to
`.pptx`. Independent of cowork — lives in this repo for development convenience
but ships zero coupling to the parent project.

Six stages. Each stage is a self-contained merge with concrete deliverables and
exit criteria. No stage assumes work from a later stage. Stages 1–4 build the
standalone slideml package; stage 5 integrates with cowork; stage 6 is hardening.

---

## Stage 0 — Decisions to lock before code

**Output:** `slideml/SPEC.md` (~2 pages) committed before any source code.

**Locks:**
- **SlideML core grammar v1**, frozen. Slot vocabulary = the eight types.
  Slide-level keys = the fixed set. Versioned `slideml: 1`.
- **Coordinate model.** Internal: EMU. User-facing in templates: cm. Lengths
  accept `"6cm"`, `"0.4in"`, `"24pt"`, raw numbers (interpreted as EMU).
- **Theme package contract.** Required files (`theme.json`, `theme.md`,
  `layouts/`, `thumbnails/`). Required `theme.md` section structure (the
  five-field layout entries).
- **Errors are structured English-only.** Cowork localizes at the boundary.
  Error shape: `{ code, slideIndex?, layout?, slot?, message, hint? }`.
- **Public API surface.** One file: `slideml/src/index.ts`. Exports: `compile`,
  types, `loadTheme`, `validateDeck`.
- **Boundary lint rule** for the slideml directory: no parent-relative imports,
  no `@/...` aliases, no cowork dependencies.

**Exit criteria:** SPEC.md merged. Any later disagreement re-opens stage 0,
doesn't bleed into other stages.

**Effort:** 0.5 day. **Blocker for:** all later stages.

---

## Stage 1 — Workspace scaffold + foundations

**Goal:** standalone, buildable, testable package with zero rendering capability
yet.

**Deliverables:**
- `slideml/package.json`, `tsconfig.json`, `vitest.config.ts`, `.eslintrc.json`
  enforcing the boundary lint rule.
- pnpm workspace wiring at the cowork repo root so
  `cd slideml && pnpm build && pnpm test` works without touching cowork.
- Root CI step: grep `slideml/src/` for forbidden imports, fail build if any.
- `slideml/src/index.ts` (empty stubs for the public API).
- `slideml/src/units.ts` — `Length` type, parsers for `cm/in/pt/EMU`, EMU
  constants from PptxGenJS.
- `slideml/src/fonts.ts` — built-in font-stack helper:
  `fontStackFor("cjk-zh" | "cjk-ja" | "latin" | "mono") → string[]`. Hardcoded
  chains, no OS detection.
- `slideml/src/theme/types.ts` — TypeScript interfaces for `Theme`,
  `ThemeManifest`, `LayoutEntry`, `ComponentEntry`, `Tokens`.
- `slideml/LICENSE` (MIT) and `slideml/LICENSE-thirdparty` (Apache-2.0
  carve-out for PptxGenJS code lifted in Stage 2+).
- Unit tests for `units.ts` and `fonts.ts`.

**Out of scope for this stage:** any OOXML, any rendering, any parser.

**Exit criteria:** `pnpm test` passes inside slideml; lint check rejects a
deliberately-introduced bad import.

**Effort:** 0.5 day.

---

## Stage 2 — OOXML emitter (vendored from PptxGenJS)

**Goal:** given a typed `ShapeList`, produce a valid `.pptx` file. **No
SlideML, no themes, no layouts yet** — just the lowest layer.

**Deliverables:**
- `slideml/src/emitter/package.ts` — zip assembly, `[Content_Types].xml`,
  `_rels/`, `ppt/_rels/`, `ppt/presentation.xml`, `ppt/presProps.xml`,
  `ppt/slideMasters/slideMaster1.xml`, `ppt/slideLayouts/slideLayout1.xml`,
  `docProps/`.
- `slideml/src/emitter/slide.ts` — `slide{N}.xml` from a `ShapeList`.
- `slideml/src/emitter/text.ts` — `<a:r>` / `<a:rPr>` / `<a:pPr>` / `<a:t>`
  serialization. Handles bold/italic/color/size/font/charSpacing/bullets.
  Smart-quote escaping built in.
- `slideml/src/emitter/shapes.ts` — `<p:sp>` + `<a:xfrm>` for the preset
  shapes we need (RECTANGLE, ROUNDED_RECTANGLE, OVAL, LINE).
- `slideml/src/emitter/image.ts` — base64 / file / URL →
  `ppt/media/image{N}.{ext}`, content-type registration, rel binding.
- `slideml/src/emitter/types.ts` — the `ShapeList` IR contract:
  `{ id, type: "text"|"shape"|"image", xfrm: {x,y,cx,cy,rot?}, props: {...} }`.
  EMU only at this layer.
- Snapshot test: hand-built `ShapeList` → `.pptx` → unzip → expected XML files
  match snapshots. PowerPoint/Keynote/LibreOffice round-trip test (open the
  file, no warnings).

**Vendored verbatim with attribution headers:** PptxGenJS's EMU constants,
color/hex validation, text-run XML construction patterns. Not as a runtime dep.

**Out of scope:** chart XML (deferred to Stage 4), animations, transitions,
slide masters beyond the fixed default.

**Exit criteria:** a 30-line test produces a valid `.pptx` containing one
slide with one text box, one rectangle, one PNG. File opens cleanly in macOS
Keynote and PowerPoint.

**Effort:** 2 days. **Risk:** OOXML edge cases. Mitigation: snapshot tests +
manual open in three viewers.

---

## Stage 3 — Theme system + layout/component runtime

**Goal:** load a theme package, validate it, instantiate one layout into a
`ShapeList`. Still no parser, still no public `compile` API.

**Deliverables:**
- `slideml/src/theme/loader.ts` — load a theme directory: parse `theme.json`,
  parse `theme.md` (validate the required section structure), dynamic-import
  layout/component modules.
- `slideml/src/theme/validator.ts` — fails the load if `theme.md` lacks any
  layout's required fields (when-to-pick, slot list, thumbnail), if
  `theme.json` references missing modules, or if `slidemlVersion` mismatches.
- `slideml/src/render/layout-context.ts` — the
  `(slots, theme, deckSize) → ShapeList` contract. Layout/component modules
  are `(ctx) => ShapeList`. Helpers exposed: `cm(n)`, `pt(n)`, `token(name)`,
  `font(name)`, `centerH/V`, `gridCol(n, of)` — composable position helpers,
  no raw EMU in layout code.
- `slideml/src/render/chrome.ts` — apply chrome decorations (page-number,
  brand-bar) to every slide unless `chrome: none`.
- `slideml/src/render/index.ts` — `renderDeck(deckAst, theme) → SlideAst[]`
  returning per-slide `ShapeList`s.
- `slideml/themes/technical-blue/` — the **first** theme as the reference
  implementation:
  - `theme.json` with the 8 tokens + 3 font stacks.
  - `theme.md` with the locked structure.
  - Six layouts: `cover`, `section-divider`, `stat-grid-3`,
    `bullet-with-image`, `two-col-text-image`, `quote`.
  - Three components: `header`, `footer`, `kpi-tile`.
  - Two chrome: `page-number`, `brand-bar`.
  - `thumbnails/` — generated by the test pipeline, not hand-drawn.
- Tests: each layout instantiated with a fixed slot fixture renders to a
  snapshot `ShapeList`.

**Out of scope:** chart layouts (Stage 4), parser/validator from YAML
(Stage 4).

**Exit criteria:** programmatic
`renderDeck({ theme: "technical-blue", slides: [...] }, loadedTheme)` produces
a valid `.pptx` containing all six layouts. Visual review against thumbnails
confirms positioning is right. CJK content renders with PingFang/YaHei fallback
(verify by including 中文 in fixtures).

**Effort:** 3 days. **Risk:** layout coordinate math is finicky.
Mitigation: `gridCol`/`centerH` helpers + snapshot tests.

---

## Stage 4 — Charts + parser + validator + public API

**Goal:** Stage 1–3 plus the actual entry point. After this, slideml is
feature-complete for the seed scope.

**Deliverables:**
- `slideml/src/emitter/chart.ts` — `chart{N}.xml` for BAR, LINE, PIE. Lifted
  from PptxGenJS, stripped to what we need. Adds the 万元/亿/% Y-axis
  number-format extension.
- `slideml/themes/technical-blue/layouts/chart-with-takeaway.ts` — uses the
  chart emitter, adds the takeaway-callout component. Seventh layout in the
  seed registry.
- `slideml/src/parser.ts` — `js-yaml` → typed deck AST. Strict mode (no extra
  keys allowed at slide level or document level).
- `slideml/src/validator.ts` — generates JSON Schema from each layout's slot
  definition, validates per-slide. Errors point at
  `slides[3].slots.items[2].value: exceeds maxChars 8`.
- `slideml/src/index.ts` — the **public API**:
  - `compile(slidemlYaml, opts) → Promise<Buffer | { written: string }>`
  - `validateDeck(slidemlYaml, opts) → ValidationResult`
  - `loadTheme(themeDir) → Promise<LoadedTheme>`
  - `listLayouts(loadedTheme) → LayoutInfo[]` (returns name + thumbnail path
    + slot schema, no module exposure)
- `slideml/bin/slideml.ts` — minimal CLI:
  `slideml compile deck.yaml --theme technical-blue -o deck.pptx`.
  Validates the standalone-package claim by being usable without cowork.
- `slideml/fixtures/` — three reference SlideML files: a 5-slide engineering
  review, a 3-slide stat-heavy report, a 2-slide quote-and-cover demo.
- End-to-end snapshot test:
  `compile(fixture, { theme: "technical-blue" })` → byte-comparable `.pptx`.

**Exit criteria:**
- `slideml compile examples/quarterly-review.yaml -o /tmp/out.pptx` works from
  a fresh checkout with only slideml installed.
- Validator produces a clear structured error when `examples/broken.yaml`
  overflows a slot.
- All seven layouts render with Chinese content correctly.

**Effort:** 2.5 days. **Risk:** chart XML is the trickiest piece.
Mitigation: cherry-pick PptxGenJS's chart emitter wholesale, adjust only what's
needed for our slot shape.

---

## Stage 5 — Cowork integration

**Goal:** the agent can produce decks via SlideML. No further changes to the
slideml package.

**Deliverables (all in cowork's tree, none in slideml's):**
- `package.json` workspace dependency on slideml.
- `src/lib/ai/tools/list-slide-layouts.ts` — calls `listLayouts(loadedTheme)`,
  returns name + one-line description + slot JSON Schema + thumbnail path.
  No raw module access.
- `src/lib/ai/tools/render-slideml.ts` — accepts
  `{ slideml, theme?, output_path }`. Loads the named theme from
  `~/.cowork/themes/<name>/`, calls `compile`, writes via cowork's existing
  `writeFile` shim. On validation failure, returns the structured error so
  the agent can self-correct.
- `src/lib/ai/tools/registry.ts` — register both. Tool count goes from 17 → 19.
- `src/catalog/skills/slideml/SKILL.md` — short skill that tells the agent:
  list layouts first; pick a theme; produce SlideML YAML; call
  `render_slideml`; on validation error, fix the slot. Shows two example decks
  (one Chinese, one English). Explicitly says: do **not** put coordinates,
  hex colors, or font sizes in the YAML — those are owned by the theme.
- `src/catalog/skills/slideml/themes/technical-blue/` — bundled copy of the
  built-in theme (so it's installable via the existing catalog installer).
- `src/lib/catalog-installer.ts` — `installCatalogTheme(id)` mirroring
  `installCatalogSkill`.
- `src/lib/ai/system-prompt.ts` — add SlideML to TOOL_RULES → Output section.
  One paragraph: "For decks, prefer `render_slideml` (typed, predictable) over
  hand-rolled `pptxgenjs` scripts."
- Update `agent-tools.test.ts` and `registry.test.ts` for the new count.

**Out of scope:** editing existing user-supplied PPTX files (separate
workstream — pptx skill XML round-trip).

**Exit criteria:**
- A new chat session: "做一个同传市场分析的PPT" produces a `.pptx` via
  `render_slideml`, not via raw `run_node + pptxgenjs`.
- The agent never directly writes a coordinate or hex color in the SlideML.
- Validation errors round-trip to the agent and it self-corrects within 1–2
  retries.

**Effort:** 1.5 days. **Risk:** agent doesn't pick the new tool over the
existing PptxGenJS path. Mitigation: TOOL_RULES gives `render_slideml` the
deck-routing role; `pptxgenjs` becomes the escape hatch, not the default.

---

## Stage 6 — Hardening

**Goal:** the things that aren't strictly needed for v1 but are needed before
claiming production-ready.

**Deliverables:**
- **Visual regression CI.** Each layout has a checked-in reference PNG
  (rendered via headless LibreOffice). PR diff fails on visual change without
  review.
- **Second built-in theme** (`bright-marketing` or similar) to validate the
  theme-as-package contract. Catches assumptions the first theme silently
  encoded.
- **Theme zip support.** `loadTheme` accepts a `.zip` path and unzips to a
  tmp dir. Enables theme distribution.
- **Theme version negotiation.** Loader rejects themes whose
  `slidemlVersion` major doesn't match core, with a clear migration message.
- **SKILL.md polish.** Real example decks for each common business scenario
  (quarterly review, market analysis, post-mortem).
- **Performance check.** A 30-slide deck should compile in <2 seconds.
  Profile if not.
- **Docs.** `slideml/README.md` for the standalone-package use case;
  `slideml/docs/AUTHORING_THEMES.md` for theme authors.

**Effort:** 2 days, parallelizable.

---

## Critical path total: ~10 working days

| Stage | Days | Cumulative | Gates |
|---|---|---|---|
| 0 | 0.5 | 0.5 | SPEC.md merged |
| 1 | 0.5 | 1.0 | Boundary lint enforced |
| 2 | 2.0 | 3.0 | `.pptx` opens in 3 viewers |
| 3 | 3.0 | 6.0 | Six layouts render correctly |
| 4 | 2.5 | 8.5 | CLI works end-to-end |
| 5 | 1.5 | 10.0 | Agent uses `render_slideml` |
| 6 | 2.0 | 12.0 | Optional polish |

## What's deliberately *not* in this plan

These come later, not in v1, to keep scope honest:

- **PPTX → SlideML reverse-compile** ("import existing deck"). Big separate
  workstream, depends on python-pptx parsing → guessing layout → mapping to
  theme. Maybe Stage 7+.
- **Animations / transitions / build orders.** Slot vocabulary explicitly
  omits them.
- **Theme inheritance / mixins.** Themes are flat self-contained packages
  until we feel actual pain.
- **Per-slide theme override.** All slides in a deck use one theme.
  Multi-theme decks aren't a real need.
- **A SlideML editor / IDE.** YAML in any text editor is the v1 authoring
  experience. The agent is the primary author anyway.

## Risks and where they land

1. **Layout positioning math is brittle.** Highest implementation risk. Lands
   in Stage 3. Mitigation: composable position helpers, snapshot tests, visual
   review per layout before merge.
2. **OOXML edge cases break in obscure viewers.** Lands in Stage 2.
   Mitigation: round-trip in three viewers (Keynote, PowerPoint, LibreOffice)
   before exit.
3. **Agent prefers the existing PptxGenJS path.** Lands in Stage 5.
   Mitigation: TOOL_RULES routing + system-prompt language + skill SKILL.md.
4. **CJK rendering looks wrong despite the font-stack helper.** Lands in
   Stage 3 testing. Mitigation: CJK content in every layout's fixture; visual
   review explicitly checks Chinese glyphs.
5. **Theme-package contract drifts.** Lands across Stages 3 and 6.
   Mitigation: structural validator on `theme.md` (not just `theme.json`);
   second theme in Stage 6 forces the contract to be real.

## Sequencing rule

Don't parallelize stages 1–4. Each builds on the previous and the boundaries
(ShapeList in stage 2, layout context in stage 3, public API in stage 4) are
how the architecture stays clean. Stages 5 and 6 can run partly in parallel —
cowork integration doesn't need stage 6 polish.

If you want to ship a usable v1 fast, the minimum viable cut is **Stages 0–5
(10 days)** with a single theme. Stage 6 can land incrementally afterward.
