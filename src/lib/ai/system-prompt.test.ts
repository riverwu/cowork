import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./system-prompt";

describe("buildSystemPrompt", () => {
  it("returns base prompt without params", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Cowork");
    expect(prompt).toContain("web_search");
    expect(prompt).toContain("web_fetch");
    expect(prompt).not.toContain("Your memory");
    expect(prompt).not.toContain("Knowledge context");
  });

  it("includes tool list when provided", () => {
    const prompt = buildSystemPrompt({
      tools: [
        { name: "web_search", description: "Search the web", parameters: {} },
        { name: "web_fetch", description: "Fetch a URL", parameters: {} },
      ],
    });
    expect(prompt).toContain("Your tools");
    expect(prompt).toContain("**web_search**");
    expect(prompt).toContain("**web_fetch**");
  });

  it("includes memory context", () => {
    const prompt = buildSystemPrompt({ memoryContext: "User prefers concise answers" });
    expect(prompt).toContain("Your memory");
    expect(prompt).toContain("concise answers");
  });

  it("includes knowledge context", () => {
    const prompt = buildSystemPrompt({ knowledgeContext: "Relevant doc" });
    expect(prompt).toContain("Knowledge context");
    expect(prompt).toContain("Relevant doc");
  });

  it("orders: base → tools → memory → knowledge", () => {
    const prompt = buildSystemPrompt({
      tools: [{ name: "t", description: "d", parameters: {} }],
      memoryContext: "m",
      knowledgeContext: "k",
    });
    const toolsPos = prompt.indexOf("Your tools");
    const memoryPos = prompt.indexOf("Your memory");
    const knowledgePos = prompt.indexOf("Knowledge context");
    expect(toolsPos).toBeLessThan(memoryPos);
    expect(memoryPos).toBeLessThan(knowledgePos);
  });
});
