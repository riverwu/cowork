import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./system-prompt";

describe("buildSystemPrompt", () => {
  it("includes core sections", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Cowork");
    expect(prompt).toContain("Personality");
    expect(prompt).toContain("How you work");
    expect(prompt).toContain("Tool usage");
    expect(prompt).toContain("Working with code");
    expect(prompt).toContain("Safety");
    expect(prompt).toContain("Output style");
  });

  it("includes tool guidance", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("read before modifying");
    expect(prompt).toContain("apply_patch");
    expect(prompt).toContain("shell");
    expect(prompt).toContain("web_search");
    expect(prompt).toContain("grep");
  });

  it("includes autonomy instructions", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Autonomy and persistence");
    expect(prompt).toContain("end-to-end");
    expect(prompt).toContain("Understanding user intent");
  });

  it("includes tool list when provided", () => {
    const prompt = buildSystemPrompt({
      tools: [
        { name: "shell", description: "Execute shell command", parameters: {} },
        { name: "read_file", description: "Read a file", parameters: {} },
      ],
    });
    expect(prompt).toContain("Available tools (2)");
    expect(prompt).toContain("`shell`");
    expect(prompt).toContain("`read_file`");
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

  it("includes memory context with precedence note", () => {
    const prompt = buildSystemPrompt({ memoryContext: "User prefers TypeScript" });
    expect(prompt).toContain("Your memory");
    expect(prompt).toContain("current message take precedence");
    expect(prompt).toContain("User prefers TypeScript");
  });

  it("includes knowledge context with reference note", () => {
    const prompt = buildSystemPrompt({ knowledgeContext: "Q1 sales report data" });
    expect(prompt).toContain("Relevant knowledge");
    expect(prompt).toContain("reference material");
    expect(prompt).toContain("Q1 sales report data");
  });

  it("orders sections correctly: core → plan → tools → memory → knowledge", () => {
    const prompt = buildSystemPrompt({
      tools: [{ name: "t", description: "d", parameters: {} }],
      memoryContext: "mem",
      knowledgeContext: "know",
      planMode: true,
    });
    const planPos = prompt.indexOf("MODE: PLANNING");
    const toolsPos = prompt.indexOf("## Available tools (");
    const memPos = prompt.indexOf("## Your memory");
    const knowPos = prompt.indexOf("## Relevant knowledge");

    expect(planPos).toBeLessThan(toolsPos);
    expect(toolsPos).toBeLessThan(memPos);
    expect(memPos).toBeLessThan(knowPos);
  });

  it("includes safety and output style guidelines", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("destructive operations");
    expect(prompt).toContain("No emoji");
    expect(prompt).toContain("concise");
  });
});
