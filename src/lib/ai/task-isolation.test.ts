import { describe, expect, it } from "vitest";
import { buildTaskIsolationPrompt, isIsolatedAgentRun } from "./task-isolation";

describe("task isolation", () => {
  it("warns the model not to reuse previous presentation style", () => {
    const prompt = buildTaskIsolationPrompt("test");
    expect(prompt).toContain("prior deck styles");
    expect(prompt).toContain("Do not copy a previous PPT's visual language");
    expect(prompt).toContain("unless the current user message explicitly asks");
  });

  it("treats a fitted context with only one user turn as isolated", () => {
    expect(isIsolatedAgentRun([{ role: "user", content: "start fresh" }])).toBe(true);
    expect(isIsolatedAgentRun([
      { role: "user", content: "old" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "continue" },
    ])).toBe(false);
  });
});
