import { describe, it, expect } from "vitest";
import { buildMemoryPrompt } from "./manager";

describe("buildMemoryPrompt", () => {
  it("returns empty string when no memory context", () => {
    const result = buildMemoryPrompt({
      coreFacts: "",
      relevantMemories: "",
      relevantEpisodes: "",
    });
    expect(result).toBe("");
  });

  it("includes core facts section", () => {
    const result = buildMemoryPrompt({
      coreFacts: "[preference]\n- style: concise",
      relevantMemories: "",
      relevantEpisodes: "",
    });
    expect(result).toContain("What you know about this user");
    expect(result).toContain("style: concise");
  });

  it("includes relevant memories section", () => {
    const result = buildMemoryPrompt({
      coreFacts: "",
      relevantMemories: "- [insight] User works on sales analysis weekly",
      relevantEpisodes: "",
    });
    expect(result).toContain("Relevant memories");
    expect(result).toContain("sales analysis weekly");
  });

  it("includes episodes section", () => {
    const result = buildMemoryPrompt({
      coreFacts: "",
      relevantMemories: "",
      relevantEpisodes: '- Task: "Generate report" (success)\n  Lesson: Use markdown tables',
    });
    expect(result).toContain("Lessons from past tasks");
    expect(result).toContain("markdown tables");
  });

  it("combines all sections in correct order", () => {
    const result = buildMemoryPrompt({
      coreFacts: "facts here",
      relevantMemories: "memories here",
      relevantEpisodes: "episodes here",
    });
    const factsPos = result.indexOf("What you know");
    const memoriesPos = result.indexOf("Relevant memories");
    const episodesPos = result.indexOf("Lessons from");
    expect(factsPos).toBeLessThan(memoriesPos);
    expect(memoriesPos).toBeLessThan(episodesPos);
  });
});
