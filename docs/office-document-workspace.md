# Main-Agent PPTX Workflow

This document records the current PPTX direction after retiring the standalone
Office document view, the DLIR/OOXML command editor, and the SlideML experiment.

## Decision

PowerPoint generation and substantial PowerPoint modification should happen in
the main conversation through an Agent + PptxGenJS workflow.

The project is no longer pursuing these authoring paths:

- DLIR as the agent-facing presentation model.
- Command-list editing against DLIR.
- Direct OOXML patching as the normal edit/export path.
- SlideML as a YAML authoring or decompile/compile format.
- HTML/CSS as the primary PPTX authoring format.

## Rationale

PptxGenJS is closer to the target artifact than HTML, SlideML, or raw OOXML.
It lets the agent use normal coding ability while still producing native PPTX
objects such as text boxes, shapes, tables, images, and charts.

The intended abstraction is not raw one-off PptxGenJS code everywhere. The
agent should write compact JavaScript with reusable layout helpers and
data-driven slide definitions. Over time, those helpers can become a small
presentation authoring SDK.

## Current Runtime Contract

The main agent should:

1. Understand the user's request and source material.
2. Plan deck structure, slide count, narrative, visual style, and layout rules.
3. Write a compact PptxGenJS script through file or node tools.
4. Run the script with `run_node`, installing `pptxgenjs` in the isolated node
   environment if needed.
5. Verify that the output file exists and is a valid user-facing artifact.
6. Report the generated `.pptx` path.

There is no separate Office editing view. File outputs shown in the conversation
open through the operating system, and follow-up edits should be requested in
the main conversation.

## Quality Baseline

Generated decks should be checked for:

- Correct slide count and expected key text.
- Readable contrast.
- Text boxes that are likely to fit their bounds.
- Consistent theme: palette, typography, spacing, and repeated components.
- Tables that are not overcrowded.
- Valid output path and file creation evidence.

When validation fails, the agent should edit the script and regenerate the PPTX.

## Future Work

The next implementation layer should be a thin PptxGenJS helper SDK:

- `createDeck` for theme, page size, margins, and metadata.
- Layout helpers such as `twoColumn`, `grid`, `stack`, `cards`, `timeline`,
  `comparisonTable`, and `architectureDiagram`.
- Text measurement helpers for approximate fit checks.
- Export helpers that return file path, slide count, and validation summaries.
- Optional render/preview validation when a renderer is available.

This SDK should stay small and code-native. It should not become another
document language or another OOXML mirror.
