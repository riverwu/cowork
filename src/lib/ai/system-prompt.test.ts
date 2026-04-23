import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./system-prompt";

describe("buildSystemPrompt", () => {
  it("returns base prompt without context", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Cowork");
    expect(prompt).toContain("persistent memory");
    expect(prompt).not.toContain("Your memory");
    expect(prompt).not.toContain("Knowledge context");
  });

  it("returns base prompt for empty params", () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).not.toContain("Your memory");
    expect(prompt).not.toContain("Knowledge context");
  });

  it("includes memory context when provided", () => {
    const prompt = buildSystemPrompt({ memoryContext: "User prefers concise answers" });
    expect(prompt).toContain("Your memory");
    expect(prompt).toContain("User prefers concise answers");
  });

  it("includes knowledge context when provided", () => {
    const prompt = buildSystemPrompt({ knowledgeContext: "Relevant doc content" });
    expect(prompt).toContain("Knowledge context");
    expect(prompt).toContain("Relevant doc content");
  });

  it("includes both memory and knowledge context", () => {
    const prompt = buildSystemPrompt({
      memoryContext: "User is a PM",
      knowledgeContext: "Q1 report data",
    });
    expect(prompt).toContain("Your memory");
    expect(prompt).toContain("User is a PM");
    expect(prompt).toContain("Knowledge context");
    expect(prompt).toContain("Q1 report data");
    // Memory should come before knowledge
    const memPos = prompt.indexOf("Your memory");
    const knowledgePos = prompt.indexOf("Knowledge context");
    expect(memPos).toBeLessThan(knowledgePos);
  });
});
