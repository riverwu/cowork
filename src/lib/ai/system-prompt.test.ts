import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./system-prompt";

describe("buildSystemPrompt", () => {
  it("returns base prompt without params", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Cowork");
    expect(prompt).toContain("CAN browse the web");
    expect(prompt).toContain("CAN execute Python");
    expect(prompt).not.toContain("Your memory");
    expect(prompt).not.toContain("Knowledge context");
  });

  it("includes tool list when provided", () => {
    const prompt = buildSystemPrompt({
      tools: [
        { name: "search_knowledge", description: "Search the knowledge base", parameters: {} },
        { name: "web_browse", description: "Browse a web page", parameters: {} },
      ],
    });
    expect(prompt).toContain("2 tools available");
    expect(prompt).toContain("**search_knowledge**");
    expect(prompt).toContain("**web_browse**");
  });

  it("includes memory context", () => {
    const prompt = buildSystemPrompt({ memoryContext: "User prefers concise answers" });
    expect(prompt).toContain("Your memory");
    expect(prompt).toContain("concise answers");
  });

  it("includes knowledge context", () => {
    const prompt = buildSystemPrompt({ knowledgeContext: "Relevant doc content" });
    expect(prompt).toContain("Knowledge context");
    expect(prompt).toContain("Relevant doc content");
  });

  it("orders sections: base → tools → memory → knowledge", () => {
    const prompt = buildSystemPrompt({
      tools: [{ name: "test", description: "A test tool", parameters: {} }],
      memoryContext: "memory here",
      knowledgeContext: "knowledge here",
    });
    const toolsPos = prompt.indexOf("available tools");
    const memoryPos = prompt.indexOf("Your memory");
    const knowledgePos = prompt.indexOf("Knowledge context");
    expect(toolsPos).toBeLessThan(memoryPos);
    expect(memoryPos).toBeLessThan(knowledgePos);
  });
});
