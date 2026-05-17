# SlideML2 Cassowary Layout Plan

## Goal

Move SlideML2 layout from mostly local container sizing to a global constraint
model while preserving the existing semantic component system, measurement
logic, diagnostics, and PPTX emission pipeline.

Cassowary should solve continuous geometry only: `x`, `y`, `w`, and `h`.
Text wrapping, chart/table readability, component density, optional drops, and
orientation/column choices remain outside the solver as measurement,
diagnostic, and candidate-selection concerns.

## Architecture

The target render pipeline is:

```text
source deck
-> component expansion
-> layout IR
-> measure contracts
-> candidate generation
-> Cassowary solve
-> width-dependent remeasure, bounded iterations
-> diagnostics and scoring
-> PPTX emission
```

## Box Contract

Every layout node becomes a box with variables:

```ts
{
  id: string,
  x, y, w, h,
  measure: {
    minW, idealW, maxW,
    minH, idealH, maxH
  },
  priority: {
    compressionW,
    compressionH,
    huggingW,
    huggingH
  }
}
```

The current `intrinsicMainSize`, `intrinsicMinSize`, chart/table fit checks, and
text measurement become the initial implementation of this contract.

## Constraint Layers

Required constraints:

- slide bounds and protected content regions
- non-negative width/height
- explicit absolute placement and fixed sizes
- stack child ordering and grid track containment
- parent/child containment

Strong constraints:

- readable minimum size for semantic components
- chart/table body minimums
- explicit split ratios
- grid spanning-child minimum contributions

Medium constraints:

- ideal sizes
- equal peer-card heights
- preferred grid row/column weights
- content hugging

Weak constraints:

- centering and whitespace balance
- aesthetic equalization

## Candidate Loop

Cassowary is not responsible for discrete choices. The outer loop enumerates
limited candidates:

- split direction: horizontal or vertical
- grid columns and compact variants
- component density: comfortable or compact
- chart legend/label variants
- optional child kept or dropped only when the node explicitly allows auto-drop

Each candidate is solved, remeasured, diagnosed, and scored. The renderer picks
the lowest-score candidate and keeps all diagnostics inspectable in the render
tree.

## Component Sizing

Component sizing follows the mature Flexbox main-axis sizing model, but only up
to the measurement-target stage:

- `basis` is the flex base size, derived from explicit basis/fixed fields or
  intrinsic measurement.
- `min` and `max` are semantic readability bounds, not merely CSS-style numeric
  clamps.
- `layoutWeight` is the grow weight used to absorb positive free space.
- shrink uses semantic compression capacity down to readable minimums; when
  fixed and minimum demands still exceed the region, the resolver reports
  overflow and performs a last-resort proportional fit.
- the output is a per-child main-axis target size. Cassowary still owns final
  `x`, `y`, `w`, and `h` geometry.

Grid sizing follows the same separation of concerns but uses track sizing:
column/row weights and spanning-child minimum pressure are converted into track
targets, then Cassowary solves the final child rectangles.

## Migration Plan

1. Add an isolated Cassowary solver wrapper under `src/layout`.
2. Cover stack, split, and grid-track primitives with unit tests.
3. Add a feature-flagged measurement path for simple stacks/splits.
4. Add grid track variables and spanning-child contribution tests.
5. Feed solver violations into the existing diagnostic vocabulary.
6. Replace local `solveSizes` for selected low-risk containers.
7. Expand to semantic components with explicit measure/fallback contracts.

The first implementation phase should not change existing renderer output by
default.

## Current Checkpoints

- `src/layout/constraint-solver.ts` wraps `@lume/kiwi` with box, stack, split,
  grid-track, size, and containment primitives.
- `src/layout/constraint-layout.ts` adds a small layout IR adapter that solves
  nested stack/split/grid trees and reports minimum/maximum size pressure from
  solved rectangles.
- `src/layout/dom-constraint-layout.ts` converts the existing `DomNode` layout
  subset into the constraint IR, including `split`, `grid` spans, fixed/min/max
  size fields, and `layoutWeight` as a soft stack weight.
- `src/layout/flex-sizing.ts` resolves stack main-axis measurement targets with
  a Flexbox-like grow/shrink/freeze algorithm before Cassowary solves geometry.
- The production renderer now routes stack and grid child layout through the
  Cassowary path by default. The previous local algorithm remains available as
  an explicit migration escape hatch with `layoutEngine:"legacy"` or
  `constraintLayout:false`, and is still used as an internal fallback when a
  constraint solve cannot produce a safe geometry.
- Stack rendering now treats precomputed shrink/grow sizes as Cassowary
  measurement targets, not as final placement. This preserves the renderer's
  semantic compression and content-hugging contract while leaving final
  geometry to the constraint solver.
- The full SlideML2 test suite is green with the default Cassowary render path.
