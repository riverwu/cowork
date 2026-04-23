import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./system-prompt";

describe("buildSystemPrompt", () => {
  it("includes core sections", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Cowork");
    expect(prompt).toContain("Problem-Solving Methodology");
    expect(prompt).toContain("Tool Usage Rules");
    expect(prompt).toContain("Working with Code");
    expect(prompt).toContain("Safety & Quality");
    expect(prompt).toContain("Behavior");
  });

  it("includes specific tool guidance", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("ALWAYS read a file before modifying");
    expect(prompt).toContain("apply_patch");
    expect(prompt).toContain("shell");
    expect(prompt).toContain("web_search");
    expect(prompt).toContain("grep");
  });

  it("includes methodology steps", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Gather context");
    expect(prompt).toContain("Plan");
    expect(prompt).toContain("Execute");
    expect(prompt).toContain("Verify");
    expect(prompt).toContain("Iterate");
  });

  it("includes tool list when provided", () => {
    const prompt = buildSystemPrompt({
      tools: [
        { name: "shell", description: "Execute shell command", parameters: {} },
        { name: "read_file", description: "Read a file", parameters: {} },
      ],
    });
    expect(prompt).toContain("Available Tools (2)");
    expect(prompt).toContain("**shell**");
    expect(prompt).toContain("**read_file**");
  });

  it("adds plan mode section when enabled", () => {
    const prompt = buildSystemPrompt({ planMode: true });
    expect(prompt).toContain("PLANNING");
    expect(prompt).toContain("MUST NOT modify files");
  });

  it("does not include plan mode when disabled", () => {
    const prompt = buildSystemPrompt({ planMode: false });
    expect(prompt).not.toContain("PLANNING");
  });

  it("includes memory context", () => {
    const prompt = buildSystemPrompt({ memoryContext: "User prefers TypeScript" });
    expect(prompt).toContain("Your Memory");
    expect(prompt).toContain("User prefers TypeScript");
  });

  it("includes knowledge context", () => {
    const prompt = buildSystemPrompt({ knowledgeContext: "Q1 sales report data" });
    expect(prompt).toContain("Knowledge Context");
    expect(prompt).toContain("Q1 sales report data");
  });

  it("orders sections correctly: core → plan → tools → memory → knowledge", () => {
    const prompt = buildSystemPrompt({
      tools: [{ name: "t", description: "d", parameters: {} }],
      memoryContext: "mem",
      knowledgeContext: "know",
      planMode: true,
    });
    const planPos = prompt.indexOf("PLANNING");
    const toolsPos = prompt.indexOf("Available Tools");
    const memPos = prompt.indexOf("Your Memory");
    const knowPos = prompt.indexOf("Knowledge Context");

    expect(planPos).toBeLessThan(toolsPos);
    expect(toolsPos).toBeLessThan(memPos);
    expect(memPos).toBeLessThan(knowPos);
  });

  it("includes safety guidelines", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("destructive operations");
    expect(prompt).toContain("Never say");
    expect(prompt).toContain("persistent memory");
  });
});
