# System prompt changelog

Why: prompt drift is invisible bug surface. When a guardrail is added to compensate for a broken architecture, removing the underlying bug should also remove the prompt patch — otherwise the next reader treats it as load-bearing forever.

This file records prompt edits whose **why** lives outside the prompt itself.

---

## 2026-04-28 — Removed "Conversation history is UNRELIABLE" block

**Removed from** `src/lib/ai/system-prompt.ts`:

```
### Conversation history is UNRELIABLE

The conversation history you see may contain errors from previous turns…
- Previous assistant messages may contain hallucinations.
- Do NOT copy patterns from conversation history.
- Only tool call results are ground truth.
- Each turn starts fresh.
```

**Why it existed.** Two architectural bugs made past-turn context lie to the model:

1. **Drop-oldest history trimming** (`fitMessagesToBudget`) silently deleted older `tool_use` blocks while the matching `tool_result` survived nearby — so the model would read its own past assistant text claiming "rendered to /tmp/x.pptx" with no corresponding tool result, and re-narrate from the false claim.
2. **One-size-fits-all 300-char truncation** in `appendTrustedToolHistory` chopped tool results mid-sentence, which the model then treated as suspicious / corrupt and hallucinated around.

Both bugs are now gone:

- **Phase 1** (per-tool `historySummarizer`, `src/lib/ai/tools/types.ts`): each tool decides what to keep in history. `image_gen` keeps the path, `validate_slideml` collapses success to "OK" but preserves full validator output on failure, etc. Load-bearing fields survive; noise gets dropped.
- **Phase 2** (LLM-summary compaction, `src/lib/ai/compact.ts`): when projected input exceeds 90% of the model's context window, an inline LLM call produces a handoff summary modeled on Codex CLI's `compact.rs`. The replacement history is `[preserved user messages] + [SUMMARY_PREFIX + summary]` — never a torn `tool_use`/`tool_result` pair.

After both fixes, the prompt warning was a **liability**: it told the model to distrust its own context even when the context is now actually trustworthy, which discourages legitimate use of past-turn information (e.g. recalling a previously-rendered file path).

The still-true parts ("when older assistant text conflicts with tool results, ignore the older text") were already covered by the **Current request has priority** and **Completion evidence protocol** sections.

**What stayed.** Lines 81–82 of system-prompt.ts (the `<<<TURN_TOOL_HISTORY>>>` warnings) remain accurate because we still emit those fenced markers in `appendTrustedToolHistory`. The rule is "don't fabricate the markers" and "don't infer a fresh artifact exists from a record of a past artifact" — both are still load-bearing.

**Reference.** Codex CLI compaction: `tmp/codex/codex-rs/core/src/compact.rs` (`run_inline_auto_compact_task`, `build_compacted_history`).
