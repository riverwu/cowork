# PPT Generation Flow Test

This test path exercises the same Cowork agent path used by the app:

- `runAgent`
- the normal system prompt builder
- the normal tool registry
- the normal SlideML2 skill CLI workflow
- the normal long-task progress events

The runner does not inject a custom system prompt, does not replace the agent loop, and does not call SlideML2 directly. It only supplies a user message, captures the agent events/tool results, and verifies the final artifacts.

The live Vitest entry runs outside the desktop shell, so it installs a Node adapter for low-level desktop IPC (`read_file`, `write_file`, streaming HTTP, debug logs, SlideML2 native calls, shell execution). The agent code above that adapter is still the real Cowork path: provider selection, system prompt assembly, skill listing, built-in tool definitions, tool execution loop, progress events, and final verification all flow through `runAgent`.

## Case Directory Strategy

Prefer adding coverage cases as directories. Each case is self-contained and can be run repeatedly without modifying test code:

```text
docs/ppt-flow-cases/<case-id>/
  case.json          # metadata, expected checks, optional agent/session settings
  prompt.md          # exact user request sent to the real Cowork agent
  inputs/            # markdown, csv, images, papers, source files used by the prompt
  outputs/           # generated deck/source/intermediate artifacts
  reports/           # one timestamped report directory per run
```

`prompt.md` and string fields in `case.json` support these placeholders:

- `{{caseDir}}`
- `{{inputsDir}}`
- `{{outputsDir}}`
- `{{reportsDir}}`
- `{{outputPath}}`
- `{{id}}`

The case runner uses the case directory as the working directory by default. If `expected.outputPath` is relative, it is resolved relative to the case directory. If omitted, it defaults to `outputs/<case-id>.pptx`.

Every run writes:

```text
reports/<timestamp>/
  report.json        # complete machine-readable trace summary
  report.md          # human-readable run report
  failure-analysis.json        # failed/recovered tool calls and final quality signals
  improvement-candidates.md    # generated improvement plan for the case
```

The JSON report includes scenario metadata, tool calls, agent events, LLM send/response summaries, final validate/render payload, captured outputs, and verification failures. The Markdown report summarizes status, outputs, debug log location, blocking diagnostics, tool timeline, final text, and scenario.

The improvement files are generated even when the case passes. They include:

- tool calls that blocked progress, such as `validate-slide`, `validate-manifest`, `compose`, image/code generation, or final validation failures;
- recovered friction from successful calls, such as quality diagnostics, `DROP`/`DEMOTED`, `TRUNCATED`, `SQUASHED`, unused generated assets, or repeated repair loops;
- component usage degradation, where the agent had to simplify, switch components, drop optional content, or accept a lower-density layout to pass validation;
- improvement candidates grouped by component/tool/schema category with proposed general fixes and focused test suggestions.

## Case JSON

Example `case.json`:

```json
{
  "id": "latest-components",
  "desktopDebugLog": true,
  "expected": {
    "requiredTools": ["read_file", "write_file", "shell", "init_deck", "validate_slide", "validate_manifest", "compose"],
    "forbiddenTools": ["create_deck", "replace_slide", "validate_render", "run_node"],
    "minValidateSlideCalls": 4,
    "requireSlideml2SkillRead": true,
    "requireFinalValidateRender": true,
    "requireProgressDone": true,
    "requirePptxOutput": true,
    "outputPath": "outputs/latest-components.pptx",
    "maxBlockingDiagnostics": 0
  }
}
```

Example `prompt.md`:

```md
生成一个 4 页商业/科研混合 PPT，读取 {{inputsDir}}/brief.md。
必须先读取 /Users/river/.cowork/skills/slideml2/SKILL.md，并使用 manifest + CLI 工作流。
必须覆盖 chart-card、table-card、process-flow、timeline、equation、code-block、citation/footnote。
逐页写入 slides/*.json 后立即 validate-slide；不要批量生成或批量 validate。
最终 PPTX 输出到 {{outputPath}}。
```

## Run A Case Directory

The live test is opt-in:

```bash
COWORK_PPT_FLOW_CASE_DIR=/abs/path/to/case-dir \
pnpm exec vitest run src/lib/ai/ppt-generation-flow-live.test.ts
```

Use this form for normal coverage growth. Each new case should add only its own subdirectory and input files.

When running a case root, the suite report directory also includes:

```text
summary.json
summary.md
overall-improvement-plan.md
```

`summary.md` and `overall-improvement-plan.md` show each case's first run issue from the captured failure/friction analysis, not only final verification failures. `overall-improvement-plan.md` links every case-level improvement plan, highlights both hard failures and recovered usability issues, and aggregates candidate details across cases by category/component/tool so repeated component or schema friction becomes one follow-up item.

## Legacy Scenario JSON

Create a scenario file:

```json
{
  "id": "nqueens-mini",
  "userPrompt": "生成一个 4 页 C++ 八皇后教学 PPT。必须使用 SlideML2，输出到 /Users/river/Documents/Workspace/nqueens-mini.pptx。",
  "workingDirectory": "/Users/river/Documents/Workspace",
  "desktopDebugLog": true,
  "expected": {
    "requiredTools": ["read_file", "write_file", "shell", "init_deck", "validate_slide", "validate_manifest", "compose"],
    "forbiddenTools": ["create_deck", "replace_slide", "validate_render", "run_node"],
    "minValidateSlideCalls": 4,
    "requireSlideml2SkillRead": true,
    "requireFinalValidateRender": true,
    "requireProgressDone": true,
    "requirePptxOutput": true,
    "outputPath": "/Users/river/Documents/Workspace/nqueens-mini.pptx",
    "maxBlockingDiagnostics": 0
  }
}
```

Use `userPrompt` as the exact message the real user would send. Put target paths, style requirements, source file references, and quality expectations there rather than in a custom system prompt.

## Run

The old single-file scenario entry is still supported:

```bash
COWORK_PPT_FLOW_SCENARIO=/abs/path/scenario.json \
COWORK_PPT_FLOW_REPORT=/abs/path/flow-report.json \
pnpm exec vitest run src/lib/ai/ppt-generation-flow-live.test.ts
```

Provider settings are loaded in this order:

1. Environment variables such as `COWORK_LLM_PROVIDER`, `COWORK_ANTHROPIC_API_KEY`, `COWORK_OPENAI_API_KEY`, `COWORK_LLM_MODEL`.
2. The Cowork desktop SQLite settings database at `~/Library/Application Support/cowork/cowork.db`.
3. `COWORK_DB_PATH=/abs/path/cowork.db` if the database lives somewhere else.

`desktopDebugLog:true` also enables the normal Cowork debug log under `~/.cowork/debug-logs/`.

`COWORK_PPT_FLOW_REPORT=/abs/path/report.json` can be used with either form to write an extra JSON report. Case-directory runs always write `reports/<timestamp>/report.json` and `report.md`.

## What It Checks

- Required/forbidden tool usage.
- Per-slide `validate-slide` count.
- Final `compose` success.
- Blocking diagnostics count.
- PPTX output path existence.
- Done progress event.
- Per-run failure analysis and improvement candidates for failed and recovered issues.

For unit-level coverage without real LLM calls, run:

```bash
pnpm exec vitest run src/lib/ai/ppt-generation-flow-runner.test.ts
```

## Coverage Case Ideas

Use separate directories for different PPT generation targets:

- Business deck: ask for data-driven KPI pages, references to local CSV/XLSX files, and require `init_deck`, `validate_slide`, `validate_manifest`, `compose`.
- Research deck: include citations/footnotes requirements, formula/code-block requirements, and `maxBlockingDiagnostics:0`.
- Visual stress deck: request dense code, timeline/process-flow pages, generated icons, and set `requiredTools` to include `generate_icon_sheet` when icon usage is part of the target.

Keep the scenario prompt realistic. The point is to test whether the real agent can recover from validation failures and finish the deck, not whether a handcrafted hidden prompt can steer it.
