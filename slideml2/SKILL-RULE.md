# SKILL.md Authoring Rules

This file defines what SKILL.md is **for**, what it should contain, and what it
should not. Read this before refactoring SKILL.md or adding new sections. It is
not loaded by the agent; it is a contract for the humans who maintain SKILL.md.

---

## 1. Goals SKILL.md Must Serve

SKILL.md exists to give an LLM agent exactly four things:

0. **A clear skill purpose** — what this skill produces, when to pick it, and
   when to pick a different skill. This is what the agent reads during skill
   selection, before it has loaded the rest of the file.
1. **A clear tool-path** — how to invoke the SlideML2 CLI, the canonical
   per-slide loop, and the minimum safety rules around tool semantics.
2. **Layout rules** — composition, density, capacity, theme, and escape-hatch
   conventions specific to SlideML2 that the agent cannot derive from
   general design knowledge or from the schema alone.
3. **Component reference** — the list of available components, their semantic
   purpose, their required/optional props, and one example per non-trivial
   component.

Everything else is out of scope. If a paragraph does not serve goal 0, 1, 2,
or 3, it must be moved, merged, or deleted.

---

## 2. Skill Discoverability (Goal 0)

The agent picks a skill based on (a) the frontmatter `description` field and
(b) the first ~50 lines of the file. Those two surfaces decide whether the
skill is invoked at all. Treat them as a separate concern from authoring
guidance.

### 2.1 Frontmatter description

The `description` field must, in one paragraph:

- **Name the output artifact**: "PowerPoint (`.pptx`) deck", not "slide
  format" or "deck JSON". The agent matches on the tangible deliverable.
- **List the input surfaces**: prompts, notes, markdown, CSV/JSON,
  research/business documents — whatever the skill accepts. The agent uses
  this to recognize that a CSV-shaped user message can route here.
- **List the trigger keywords in every language the skill should match**.
  At minimum: `slide deck`, `presentation`, `PPT`, `PPTX`, plus CJK
  equivalents (`幻灯片`, `演示文稿`, `投影`, `汇报`). Trigger phrases
  must be literal substrings the agent can keyword-match.
- **State the mechanism in one half-sentence**: "drives the SlideML2 CLI
  with per-slide validation" or equivalent — enough to differentiate from
  a generic PPT-from-template skill.
- **State the deliverable shape**: a real `.pptx` file (plus sidecar), not
  screenshots, not HTML, not raw JSON. Prevents the agent from picking
  this skill for "make me a slide image" requests.

Forbidden in the description:

- Process language ("Use this skill to create, edit, render, review …").
  The agent already knows it might create or edit; what it needs is
  *what gets created*.
- Internal terminology that does not appear in the user's vocabulary
  ("SlideML2 source deck", "component contract"). Save those for the body.

### 2.2 First-50-lines opening

The body of SKILL.md must open with **four short sections, in this order**,
before anything operational:

1. **What This Skill Does** — 2–4 sentences. Concrete: input → output,
   what's inside the deck, what the file is.
2. **When to Use This Skill** — bullet list of trigger conditions. Cover
   explicit keywords, deliverable shape, and content-shape signals
   (multi-page narrative, mixed media, hierarchy).
3. **When NOT to Use This Skill** — bullet list of near-miss cases the
   agent might mis-route here: single chart, one-page summary, document,
   email, raw data analysis, OOXML patching. Each line names the
   alternative ("use a document skill", "use a chart skill").
4. **What You Produce** — the deliverable artifacts (`.pptx`, render-tree
   sidecar, per-slide diagnostics). Reinforces the frontmatter answer for
   an agent that scrolled past the description.

Only after these four sections may operational content (tool path, layout
rules, components) begin. The "How to Read This File" pointer/TOC line
comes at the end of the discoverability block, not before it.

### 2.3 H1 title

The H1 must name what the skill *is*, not what file *this* is. Use a
product-style noun phrase: "SlideML2 — PPTX Deck Authoring Toolchain", not
"SlideML2 Component Reference" or "Operating Contract".

The component reference is one section inside the file, not the title of
the file.

### 2.4 Discoverability acceptance check

Before shipping a SKILL.md change, verify:

- The `description` field contains the literal strings `pptx`,
  `presentation`, and at least two CJK trigger words.
- Lines 1–50 of the body contain explicit "When to Use" and "When NOT to
  Use" sections, each with bullet examples.
- The H1 names the product, not the file.

---

## 3. Structural Rules

### 3.1 One canonical section per goal

SKILL.md must have exactly three top-level concept blocks, in this order:

1. **Tool Path** — Goal 1. CLI surface, argument shapes, the canonical loop,
   tool-safety hard rules, task modes, how to read diagnostics.
2. **Layout Rules** — Goal 2. Composition, density/capacity, theme & units,
   escape hatches. May include a small Data Binding subsection.
3. **Component Reference** — Goal 3. Shared types preamble, then components
   grouped by family.

A frontmatter block precedes everything. No content between the frontmatter
and Tool Path.

### 3.2 No parallel workflows

There must be at most **one** authoring workflow definition in the file.
Modify/repair/review reuse the same manifest-compose loop with different files
edited first (`deck-config.json`, `manifest.json`, or `slides/N.json`); they
are not separate workflows. The historical version had four overlapping workflows (Mandatory
Create Workflow, Mandatory Modify Workflow, Authoring Workflow,
Component-First Slide Loop) — that is forbidden.

### 3.3 No content duplication across sections

Any rule, table, or piece of guidance appears in exactly one place. The
historical version had two routing tables (Fast Routing + Page Layout
Archetypes), four lists of blocking diagnostic codes, and three definitions
of `area` semantics. Each information item must have a single home.

### 3.4 Length budget

Target sizes (soft caps; exceed only with reason):

| Section            | Target lines | Hard cap |
|--------------------|-------------:|---------:|
| Tool Path          |       150    |   190    |
| Layout Rules       |       220    |   260    |
| Data Binding       |        60    |    90    |
| Component Reference |      180    |   220    |
| **Total**          |   **~680**   | **~800** |

Whole-file size should stay under ~800 lines while the component reference is
embedded. Exceeding this means the file is back-sliding toward the historical
812-line state or should move detail into generated/reference docs.

---

## 4. What Belongs in SKILL.md

The agent **cannot** derive these from the schema, validator, or general
knowledge, so SKILL.md must carry them:

- The CLI command list, invocation pattern, and argument file shapes.
- The single canonical authoring loop.
- Hard rules about tool semantics (never stringify a slide; never wrap in
  `run_node`; one slide at a time).
- SlideML2-specific composition rules (chrome ≤30%, one hero per slide,
  section-break thresholds).
- SlideML2-specific units (cm vs pt vs normalized 0..0.5; `cornerRadius` is
  fractional; `thickness` is point-like).
- The decision matrix for `area` / `at` / `layer` / `anchorTo`.
- The list of components, their semantic purpose, and field names.
- Component capacity floors (e.g. `chart-card` body ≥ 4.8×3.0 cm) because
  the validator only reports the failure, not the floor.

### 4.1 Required Deck-Level Guidance

Two things must always be present because per-slide validation cannot replace
them:

- Mandatory planning archive for create mode: which file to write, what fields
  it must contain, and how to reference/update it during authoring and repair.
- Layout-variety guidance at composition level: archetype variety, repeated
  archetype thresholds, and the "pick layout shape before component" rule.

A deck can contain 20 valid slides and still be visually monotonous. Removing
or weakening either rule is a regression even if total line count drops.

---

## 5. What Must NOT Be in SKILL.md

The agent **can** derive or learn these from elsewhere; carrying them in
SKILL.md wastes context and rots over time.

### 5.1 Things the LLM already knows

- JSON syntax hygiene (escape quotes, valid arrays).
- General design opinions ("numbers should dominate labels", "≤4 font sizes
  per slide", "1.3× type-scale ratio"). These are basic typography taste,
  not SlideML2 contract. If a real default exists, encode it in the default
  theme.
- "CJK-heavy decks need +1pt." That is a theme decision; put it in the
  default theme override for CJK projects, not in the contract.

### 5.2 Things the validator already enforces

- "Use `fontWeight`, not `bold`." The validator reports this. Removing it
  from SKILL.md does not increase failure rates; it just shortens the prompt.
- "Don't define `pageMarginY`." The validator rejects unknown fields.
- "Use `cornerRadius`, never `radius`." Same.

A short blanket sentence — "trust validator diagnostics; do not pre-instruct
the agent on every field name the validator already catches" — replaces
30+ such bullets.

### 5.3 Case-specific repair recipes

This is the biggest historical bloat source. Examples that must NOT live in
SKILL.md:

- "5+ warnings/red-lines belong in `warning-list`, not stacked callouts —
  4+ callouts trigger `FALLBACK_FAILED` on 8cm content area."
- "`key-takeaway.detail` is a single sentence, not a list; the renderer
  auto-splits `1. A 2. B` as a graceful repair."
- "`text` containing `• A\n• B` is one text box — use `bullets` instead."

These are scar tissue from individual failures. Each one belongs in **the
render diagnostic's `suggestion` field**, not in pre-instruction. The agent
sees the suggestion only when actually hitting that case, instead of being
pre-loaded with 50 repair recipes for cases that may never occur in this
deck.

Migration rule: if a SKILL.md bullet starts with "do not / instead use",
ask whether it can be moved to a `pushDiagnostic({suggestion: ...})` call
in `render.ts`. If yes, move it.

### 5.4 Domain-specific style defaults

- Large domain-specific storyline catalogs.
- Case-specific business/research repair recipes.
- Per-client brand presets that are not general SlideML2 behavior.

General business/research defaults that affect most decks, such as light-first
analytical themes, belong in SKILL.md because agents do not reliably read
optional side files. Detailed domain playbooks belong in separate skills.

### 5.5 Planning archive details

The full planning table shape is a process artifact; keep it in
`planning-template.md`. SKILL.md must still state that create mode requires
`plan.md`, name the required sections, and require updates when archetype,
component, or layout intent changes.

### 5.6 Duplicate or parallel routing tables

Keep exactly one page-archetype table and one `page-job → first-component`
routing table. They must not duplicate each other: archetypes choose deck/page
shape first, routing chooses the primary component inside that shape.

---

## 6. Component Reference Format Rules

The single-line-per-component format is correct and must be preserved. It is
grep-friendly, deterministic, and small. Rules for the format:

### 6.1 Required line shape

```
- <name>: <one-sentence purpose>. <one-sentence anti-use or differentiator>.
  type='<name>' required={...} optional={...} [capacity="..."] [example={...}]
```

Required parts:

- **`<name>`**: the `type` value the agent writes.
- **Purpose** (one sentence): when to choose this. The agent uses this to
  pick among siblings.
- **Anti-use** (one sentence, optional but recommended for confusable
  components): "different from X" or "use X for ordinary cases". Prevents
  wrong selection.
- **`required={...}`**: list of mandatory fields. Use shared-type names
  (`tone`, `marker`, `image-ref`) instead of re-enumerating.
- **`optional={...}`**: list of optional fields. Same shared-type discipline.

Optional parts:

- **`capacity="..."`**: minimum body size or pagination rule. Required for
  any component that has historically triggered capacity diagnostics.
- **`example={...}`**: include only if the example demonstrates a
  non-trivial composition (chart-card + bind, feature-card with multiple
  fields). **Do not** include trivial examples like `{"type":"badge","text":"text"}`.

### 6.2 Fields that must be dropped

These fields existed in the historical reference and carried no information:

- `kind=container|semantic` — derivable from the section header.
- `parent=any` — true for every semantic component.
- `parent=stack` / `parent=grid` — almost always true; only mention if the
  component is genuinely restricted (e.g. must be a direct slide child).
- `children=none` — implied when `children` is not in the field list.
- `children=required|optional` — keep only on container components where it
  affects the contract.

### 6.3 Shared-type preamble

Section 4 of SKILL.md (Component Reference) opens with a 6–10 line preamble
defining shared types. Components then reference them by name. Example:

```
tone           = brand | positive | warning | danger | neutral
surface        = { fill, line, cornerRadius, padding, elevation, shadow, gradient }
marker         = { shape, variant, tone, size }
image-ref      = absolute path string
color-ref      = theme token | "RRGGBB"
rich-runs      = array of { text, marks?, color?, link? } | { kind, ... }
```

After this preamble, do not re-enumerate `tone:enum[brand|positive|warning|danger|neutral]`
each time. Write `tone` and reference the preamble.

### 6.4 Capacity guidance lives inline

The historical "Targeted Component Capacity Guidance" section was a parallel
list of constraints already named in the component reference. Inline them
into the component's own line via `capacity="..."`. Drop the separate
section.

### 6.5 Family preamble

Each subsection (Quantitative, Comparison, Sequence, Evidence, etc.) may
have a 1–2 line family preamble naming the shared contract for that family
(e.g. "All components in this family accept `bind` + `encoding`"). Avoid
restating the same shared contract per component.

---

## 7. Tool Path Rules

### 7.1 Exactly one CLI invocation pattern

State the canonical invocation once, then never repeat it. The invocation accepts a command plus the command's documented
positional arguments and flags:

```bash
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" <command> [args] [--deck deck-config.json]
```

Only content objects belong in JSON files (`deck-init.json`,
`manifest.json`, `slides/01-cover.json`). Paths belong in flags or command
positions (`--deck`, `--out`, `compose manifest.json`).

### 7.2 Never call the JSON contents "CLI arguments"

JSON files are for structured content, not control fields. Deck initialization
JSON contains `title`, `size`, `themeOverride`, `dataSources`, etc. Deck patch
JSON contains deck-level fields for `set-deck`. Slide JSON contains the slide
object directly. Manifest JSON contains ordered `{id,file}` entries. Do not
document wrapper/control fields such as `slideId`, `render`, `outputPath`, or
`deckPath` inside JSON examples.

Each JSON example must be preceded by a line that shows how it is invoked:

```
// deck-init.json — passed as: node slideml2.js init-deck deck-init.json
```

The path on the right of the command name is the agent's contract with the
shell; the contents of that file are a separate contract with the CLI body.

### 7.3 Show the loop as file-write + CLI-invoke pairs

The canonical loop is not just an arrow diagram. It is a literal sequence
of (1) write structured JSON content in the workspace when needed, (2) call the
CLI with the documented command shape. Show both steps explicitly at least once,
so the agent does not inline JSON or wrap the CLI in `run_node`/`run_python`.

### 7.4 One canonical loop diagram

```
plan.md → init-deck → serial slide gate → validate-manifest → compose
```

Surrounding text states: failure on any step must be repaired before
proceeding to the next step on the same scope. Slide order comes only from
manifest.json, never from command order. The serial slide gate means: write one
slide file, run one visible `validate-slide` command, repair that same file until
it passes, then proceed to the next slide file. That is the whole loop.

### 7.5 One "Never Do This" block

Tool-safety prohibitions should live in one short `Never Do This` block after
the serial slide gate. Keep it to roughly 5 bullets and cover only behavior the
validator cannot enforce:

- Do not generate all slide files before validating them one by one.
- Do not batch `validate-slide` with loops, scripts, `find`, `xargs`,
  `parallel`, Node, or Python.
- Do not create a second "fixed" slide file after failure; repair the same file.
- Do not rely on filename order, creation order, or command order.
- Do not hand-edit `build/deck.pptx.deck.json` or create PPTX through another tool.

Everything else is a layout rule, file-shape rule, or component rule, not a
tool-safety prohibition.

### 7.6 Diagnostic reading

Provide one short table mapping the most common diagnostic codes to
"blocker vs quality" status and the default repair direction. Do not
enumerate every code. The full code list belongs in `diagnostic-codes.ts`,
which the agent can read on demand.

---

## 8. Layout Rules Section Rules

### 8.1 Three subsections

`Layout Rules` must have exactly three subsections, in this order:

1. **Composition** — slide-deck shape: chrome ratio, section breaks, one
   hero, title duplication, ordinal preservation. ≤ 10 rules.
2. **Density & Capacity** — when to paginate, bullets vs text, capacity
   floors that span components (the cross-cutting ones; per-component
   capacity belongs inline in component reference). ≤ 8 rules.
3. **Theme & Units** — `themeOverride` fields, the units system (cm vs pt
   vs fractional), token preference, escape-hatch decision matrix. ≤ 15
   rules.

### 8.2 No rule restates a default-theme value

If `themeOverride.text.paragraph.fontSize` defaults to 12, do not write
"paragraph is 12pt." The agent gets that from the default theme on render.

### 8.3 Escape-hatch decision in one matrix

`area` / `at` / `layer` / `anchorTo` is described with one 4-row matrix:
goal → which primitive. Each primitive then gets ≤ 5 lines of detail and
one example. No long prose sections per primitive.

---

## 9. Migration Procedure

When refactoring SKILL.md, run these passes in order. Each pass should be
its own commit so the diff is reviewable.

1. **Pass 1 — Scar tissue.** Find every "do not / instead use" bullet.
   For each: can it move into a `pushDiagnostic({suggestion: ...})` in
   `render.ts`? If yes, move it. If it must stay, mark it for re-evaluation
   in 3 months.
2. **Pass 2 — Workflow merge.** Collapse all parallel workflows into the
   single Tool Path section.
3. **Pass 3 — Shared types.** Add the preamble at the top of Component
   Reference; remove the 60+ duplicate `tone:enum[...]` enumerations.
4. **Pass 4 — Trivial examples.** Delete the `example={"type":"X","text":"text"}`
   tautologies for `badge`, `text`, `h1`, `h2`, `lead`, `label`,
   `source-note`, `deck-title`, `slide-title`, `flow-arrow`,
   `definition-card`, `quote`, `code`, and similar.
5. **Pass 5 — Capacity inline.** Move every Targeted Capacity bullet into
   the matching component's `capacity="..."` field.
6. **Pass 6 — Domain extraction.** Keep only general deck-level layout/theme
   defaults in SKILL.md; move large domain playbooks to separate skills.
7. **Pass 7 — Routing consolidation.** Keep one page-family/archetype path
   and one component routing table; delete any third overlapping router.

---

## 10. Acceptance Criteria

A refactored SKILL.md passes if:

**Discoverability (goal 0):**

- The frontmatter `description` names the output artifact (`.pptx`), the
  input surfaces, and includes both English (`pptx`, `presentation`) and
  CJK (`幻灯片`, `演示文稿` or equivalent) trigger keywords.
- The H1 names the product, not the file.
- Lines 1–50 of the body contain "What This Skill Does", "When to Use This
  Skill", "When NOT to Use This Skill", and "What You Produce" sections in
  that order, each with concrete bullets.

**Structure (goals 1–3):**

- Total lines ≤ 800 while the full component reference remains embedded.
- Exactly three operational blocks (Tool Path, Layout Rules, Component
  Reference); Data Binding is a subsection of Layout Rules.
- Exactly one authoring workflow definition.
- Exactly one page-archetype table and one component routing table.

**Component reference (goal 3):**

- Uses shared-type names; `tone:enum[...]` does not appear more than 6
  times in the whole file.
- Every component listed has one-sentence purpose, required/optional, and
  — where the component has historical capacity issues — an inline
  `capacity="..."` field.

**Content discipline:**

- No bullet contains a specific repair recipe (those are in `render.ts`
  diagnostic suggestions).
- No bullet repeats a validator-enforced rule (those are in validation
  diagnostic messages).

---

## 11. Living Status of This Rule

This rule supersedes prior `SKILL.md` conventions whenever they conflict.
If a future requirement forces SKILL.md to violate one of these rules,
update this file first and explain why; do not silently grow SKILL.md
back toward its old shape.
