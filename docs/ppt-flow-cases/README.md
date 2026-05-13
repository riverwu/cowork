# PPT Flow Case Optimization Principles

This directory contains end-to-end PPT generation cases that run through the real Cowork agent loop. Cases are not golden scripts. They are realistic user requests plus input files, used to expose product, tool, schema, prompt, and workflow issues.

## Non-Negotiable Rule

After running a case, do not make a case-specific workaround just to make that case pass. A fix is acceptable only when it improves the general system while preserving the semantic requirement and the public interface contract.

## What A Case May Contain

- User-facing intent: topic, audience, style, required input files, output target, and quality expectations.
- Domain requirements: desired slide count range, content coverage, visual richness, formulas, tables, citations, or diagrams when they are part of the user request.
- Verification expectations: required workflow tools, final PPTX existence, final render validation, and blocking diagnostic thresholds.
- Capability verification: cases may assert required substrings in the source deck JSON or final PPTX XML when the goal is to prove a public SlideML/OOXML capability is actually used and emitted.
- Input assets: markdown, data files, images, PDFs, or other source material that a real user would provide.

## What A Case Must Not Contain

- Component-specific magic numbers inserted only after one failure, such as exact heights, internal layout coordinates, or hidden sizing formulas.
- Instructions that tell the agent to avoid a valid component because the implementation currently fails.
- Prompt text that mirrors a diagnostic error as a workaround instead of improving diagnostics, component behavior, schema, or skill guidance.
- Relaxed expectations that hide a real failure, such as lowering slide count, removing required validation, or allowing blocking diagnostics without a product reason.
- Hard-coded logic in runner, tools, or implementation that detects a case id, filename, topic, or path.

## Fix Classification

When a run fails, classify the failure before editing:

- Implementation bug: component render, validation, export, asset handling, data binding, or text measurement is wrong. Fix the implementation and add focused tests.
- Interface/spec gap: the schema allows invalid or ambiguous usage, or a tool accepts values it cannot execute. Tighten schema, validation, tool descriptions, and tests.
- Skill/prompt contract gap: the agent lacks general authoring guidance. Update `SKILL.md` or tool guidance, not one case prompt.
- Runner/reporting gap: the test cannot explain what happened. Improve report structure, captured artifacts, summaries, or verification logic.
- Case semantic gap: the case request itself is unclear or unrealistic. Clarify only the user-facing requirement, and document why the clarification is semantic rather than a workaround.

## Acceptable Changes

- Add or strengthen component/schema tests that reproduce the failure independently of the case.
- Improve validation messages so the agent gets actionable, general repair guidance.
- Update public schema, component docs, or `SKILL.md` when the intended interface was under-specified.
- Improve tools to reject invalid parameters earlier, choose valid defaults, or report exact constraints.
- Add visual/report artifacts that make failures easier to inspect across cases.

## Unacceptable Changes

- Special-case a deck title, case id, source filename, or prompt phrase.
- Patch generated output files by hand to pass verification.
- Remove generated assets from the plan just because asset placement failed.
- Disable a component in one prompt instead of fixing the component or documenting its real limitations.
- Turn a blocking diagnostic into a warning unless the diagnostic is objectively wrong for all cases.

## Post-Run Checklist

For every live run, including runs that eventually pass:

1. Record the report directory, debug log directory, run workspace, and final failure summary.
2. Read `failure-analysis.json` and `improvement-candidates.md`; passing cases still matter when they contain failed/recovered tool calls, repeated `validate-slide` repairs, quality diagnostics, unused generated assets, or component degradation such as `DROP`/`DEMOTED`.
3. Identify whether each candidate is implementation, interface/spec, skill contract, runner/reporting, or case semantic.
4. Make the smallest general fix in the appropriate layer after the plan is approved.
5. Add or update focused automated coverage outside the live case when the issue is reproducible without an LLM.
6. Rerun the failed case and at least one adjacent case or focused unit test.
7. In the final note, state the failure class, the general fix, and the verification commands.

## Examples

- If `image_gen` rejects a size because the configured model requires a larger minimum canvas, fix the image tool schema/defaults/validation or skill guidance. Do not edit only one physics prompt to name a larger size.
- If `validate-slide` repeatedly fails because a component underestimates text height, fix text measurement or component layout and add component tests. Do not tell one case to use fewer words as the only fix.
- If an agent does not understand how to use a new SlideML2 area/layout feature, update the SlideML2 skill contract and add a capability case. Do not hide the feature from that case.
