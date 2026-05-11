# SlideML2

An experimental semantic Slide DOM that compiles to PPTX. Designed for
**LLM agents to generate, edit, and render decks** by speaking the
language of slides (titles, components, layouts) — not OOXML.

## Status

Alpha. The component vocabulary, layout solver, validation gates, and PPTX
emitter are working end-to-end. Full PPT generation now runs through Cowork's
real `runAgent` loop and SlideML2 authoring tools, not a separate markdown
conversion CLI.

## What's in here

```
SPEC.md                   // full source-deck, layout, render, and authoring contract
src/
  components.ts            // composite components (kpi-grid, hero-stat, ...)
  component-registry.ts    // component registration + expansion
  render.ts                // layout solver + PPTX shape emission
  validate.ts              // structural + semantic validation
  diagnostics.ts           // structured render diagnostics + WCAG contrast
  theme.ts                 // minimal theme scaffold (agent-driven)
  agent-disclosure.ts      // progressive prompt-pack builder
  deck-disclosure.ts       // deck-level rules (color/layout/density/...)
  ...
tools/
  render-snapshot.ts       // golden-deck visual regression tool
  render-source-deck.ts    // source deck JSON → PPTX renderer
```

Read [SPEC.md](./SPEC.md) for the authoritative SlideML2 contract. The
runtime agent skill at `src/catalog/skills/slideml2/SKILL.md` is the compact
authoring reference derived from the same rules.

## Quick start

```bash
# Run the deterministic test suite
pnpm install
pnpm test

# Render the golden snapshots (PPTX + PDF + PNG)
pnpm snapshot:png
```

## Architecture highlights

- **Agent-driven theming.** The default theme is a neutral scaffold;
  the agent installs subject-appropriate styling via `set_theme`
  (deep-merged onto the deck's `themeOverride`).
- **Layout patterns catalog.** A library of 13 named slide patterns
  (`hero-and-detail`, `dashboard-2x2-with-hero`, `numbered-principles`,
  …) the agent picks per slide for layout diversity.
- **Structured diagnostics.** Render emits typed warnings (`OVERFLOW`,
  `LOW_CONTRAST`, `FALLBACK_FAILED`, `COLLISION`, …) with `suggestion`
  fields the agent can act on directly.
- **Layout fallback ladder.** When children don't fit: shrink → demote
  density → drop optional → autoFit-shrink → emit FALLBACK_FAILED.
- **Centralized typography tokens.** Deck authors tune a finite
  `themeOverride.text` scale (`caption`, `label`, `card-title`, etc.).
  Component-specific styles such as `timeline-body` are derived in the
  theme layer, so component factories do not carry local font defaults.

## Known caveats

- This package currently lives inside a larger monorepo and depends on
  the sibling `slideml` emitter via a relative path
  (`../../slideml/src/emitter/...`). Standalone use requires either
  vendoring `slideml` source or extracting the emitter as a published
  package.
- This package is the SlideML2 runtime. User-facing PPT generation is exercised
  by the Cowork app's `runAgent` flow and the cases under
  `docs/ppt-flow-cases/`.

## License

MIT.
