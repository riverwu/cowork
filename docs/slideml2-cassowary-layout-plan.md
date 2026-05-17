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
