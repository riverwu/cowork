import type { LLMMessage } from "./providers/types";

export function buildTaskIsolationPrompt(reason?: string): string {
  return `## Task Isolation

This turn starts a fresh task boundary${reason ? ` (${reason})` : ""}.

- Treat earlier conversation turns, prior generated files, prior deck styles, prior research topics, prior images, and prior intermediate specs as out of scope unless the current user message explicitly asks to reuse them.
- Do not copy a previous PPT's visual language, palette, layout rhythm, title style, or illustration strategy by default.
- Only global long-term preferences/stable facts may be present in memory for this isolated run. Do not infer prior task choices from habit, old file paths, old deck names, old generated images, or old tool sequences.
- Active skills start empty for this task. Re-read any needed SKILL.md in the current request before relying on it.
- If the current request is ambiguous, ask one concise clarifying question instead of silently inheriting assumptions from the previous task.`;
}

export function isIsolatedAgentRun(messages: LLMMessage[]): boolean {
  const userMessages = messages.filter((m) => m.role === "user");
  return userMessages.length <= 1;
}
