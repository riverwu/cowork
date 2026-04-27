# SlideML

A typed, theme-driven YAML language that compiles to `.pptx`.

> **Status:** Stage 1 of 6. Foundations only — `units`, `fonts`, public API
> stubs. No rendering yet. See [PLAN.md](./PLAN.md) for the roadmap and
> [SPEC.md](./SPEC.md) for the frozen language contract.

## Why

Generating slide decks via raw `pptxgenjs` scripts gives an LLM agent too
much room to make positioning mistakes, hardcode colors, and skip CJK font
fallback. Generating via OOXML XML directly is verbose and error-prone.

SlideML is the middle path: a small YAML grammar where the agent picks a
**layout** (positioning is the layout's responsibility) and fills typed
**slots** (content is the agent's responsibility). Themes own all visual
decisions — colors, fonts, spacing, geometry — and ship as self-describing
packages an LLM can read.

```yaml
slideml: 1
deck:
  size: 16x9
  language: zh-CN
  theme: technical-blue
slides:
  - layout: cover
    slots:
      title: 同传市场格局分析
      subtitle: 2026 Q1
  - layout: stat-grid-3
    slots:
      title: 市场规模
      items:
        - { value: "82.3亿", label: 市场规模, delta: "+12% YoY" }
        - { value: "3,400万", label: 月活,    delta: "+8%" }
        - { value: "1.4×",   label: ARPU,    delta: "—" }
```

## Independence

slideml lives in this repo for development convenience but is shipped as a
standalone component. It has zero coupling to the parent project (cowork):
no imports out of its directory, no parent-project dependencies, own
`package.json`. CI enforces the boundary via `scripts/check-boundary.mjs`.

## Layout

```
slideml/
  PLAN.md                      6-stage implementation roadmap
  SPEC.md                      Frozen language + theme-package contract
  package.json                 Own deps; no parent coupling
  src/                         All source
    index.ts                   Public API (the only file callers import)
    units.ts                   Length / EMU conversions
    fonts.ts                   Font fallback chains incl. CJK
    theme/                     Theme package types & loader (Stage 3)
    emitter/                   OOXML serialization (Stage 2+)
    render/                    Layout context, ShapeList builder (Stage 3)
  themes/
    technical-blue/            First built-in theme (Stage 3)
  bin/
    slideml.ts                 CLI (Stage 4)
  fixtures/                    Reference SlideML files (Stage 4)
  scripts/
    check-boundary.mjs         CI: enforce no-cowork-imports
```

## Public API

```ts
import { compile, validateDeck, loadTheme, listLayouts } from "slideml";
```

See [SPEC.md → Public API surface](./SPEC.md#public-api-surface).

## Development

```bash
cd slideml
pnpm install
pnpm test           # vitest
pnpm run lint:boundary
pnpm run check      # boundary + tsc --noEmit + tests
```

## License

MIT (see [LICENSE](./LICENSE)). Vendored portions of PptxGenJS are
re-distributed under Apache-2.0 with attribution; see
[LICENSE-thirdparty](./LICENSE-thirdparty).
