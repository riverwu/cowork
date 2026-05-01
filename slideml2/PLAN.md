# SlideML2 MVP Plan

SlideML2 is an isolated experiment. It must not be added to Cowork prompts,
tool registries, or the existing SlideML compiler until this MVP proves the
core editing model.

## Goal

Validate that an agent can edit a semantic slide DOM without knowing OOXML or
absolute coordinates.

## MVP Scope

- Simple source document: deck metadata, slides, layout names, and props.
- Generated DOM: every node has `id`, `type`, `name`, `props`, and optional
  `children`.
- Layouts: `cover`, `title-and-content`, `image-and-text`.
- Node types: `slide`, `stack`, `grid`, `text`, `bullets`, `image`.
- Edit operations: `setSlideProp`, `setNodeProp`, `insertNode`, `deleteNode`.
- Outputs: a `.pptx` file and a `.render-tree.json` DOM sidecar.

## Test Scenario

The automated agent-loop test starts with a deck that intentionally misses
three requirements:

- Cover background is not the brand primary color.
- Brand logo is not placed at the bottom right.
- The business slide is missing the expected bullet list.

The loop must inspect the DOM, apply semantic edit operations, pass the audit,
and render both output files.

## Exit Criteria

- Type checking passes for the isolated package.
- Unit tests prove layout generation and edit operations.
- Agent-loop integration test proves audit failure, semantic correction, audit
  success, and PPTX/DOM output generation.
- Component-layout test proves an agent can compose a slide-level layout from
  semantic components instead of only modifying an existing layout.
