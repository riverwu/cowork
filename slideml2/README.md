# SlideML2

An experimental semantic Slide DOM that compiles to PPTX. Designed for
**LLM agents to generate, edit, and render decks** by speaking the
language of slides (titles, components, layouts) — not OOXML.

```
markdown source ─► agent loop ─► slideml2 source-deck ─► PPTX
```

## Status

Alpha. The component vocabulary, layout solver, and md→PPTX agent loop
are working end-to-end. Tested against ~6 source markdowns with
real-LLM generation (Anthropic-compatible API).

## What's in here

```
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
  md2pptx/                 // agent loop CLI: markdown → PPTX
    SLIDEML.md             // agent system prompt
    tools.ts               // tool definitions for the agent
    agent-loop.ts          // Anthropic Messages API tool-use loop
    index.ts               // CLI entry
  render-snapshot.ts       // golden-deck visual regression tool
```

## Quick start

```bash
# Run the deterministic test suite
pnpm install
pnpm test

# Render the golden snapshots (PPTX + PDF + PNG)
pnpm snapshot:png

# Convert a markdown into a deck via the agent loop
LLM_API=https://api.anthropic.com \
LLM_API_KEY=sk-ant-... \
LLM_MODEL=claude-opus-4-7 \
pnpm md2pptx input.md output.pptx
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
- **Three-axis text styling.** `size` (xs..2xl) × `weight` (normal /
  medium / bold) × `color` (theme tokens) — orthogonal, agent-tunable.

## Known caveats

- This package currently lives inside a larger monorepo and depends on
  the sibling `slideml` emitter via a relative path
  (`../../slideml/src/emitter/...`). Standalone use requires either
  vendoring `slideml` source or extracting the emitter as a published
  package.
- The agent loop targets the Anthropic Messages API. Other tool-use
  protocols (OpenAI, Google) are not yet implemented.

## License

MIT.
