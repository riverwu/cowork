import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./system-prompt";

describe("buildSystemPrompt", () => {
  it("includes core sections from SYSTEM.md", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Cowork");
    expect(prompt).toContain("Personality");
    expect(prompt).toContain("How you work");
    expect(prompt).toContain("Tool usage");
    expect(prompt).toContain("Safety");
    expect(prompt).toContain("Output style");
  });

  it("includes cowork-specific tool routing rules", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("isolated envs"); // run_python / run_node sandboxes
    expect(prompt).toContain("install_package");
    expect(prompt).toContain("image_gen");
    expect(prompt).toContain("matplotlib");
  });

  it("does not include SlideML2 skill details in the base system prompt", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).not.toContain("slideml2");
    expect(prompt).not.toContain("SlideML2");
    expect(prompt).not.toContain("validate_render");
    expect(prompt).not.toContain("create_deck");
  });

  it("can include SlideML2 only through the skills section", () => {
    const prompt = buildSystemPrompt({
      availableSkillsPrompt: "## Skills\n- **slideml2**: Create slide decks — `/Users/river/.cowork/skills/slideml2/SKILL.md`",
    });
    expect(prompt).toContain("slideml2");
    expect(prompt).toContain("/Users/river/.cowork/skills/slideml2/SKILL.md");
  });

  it("includes autonomy instructions", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Current request has priority");
    expect(prompt).toContain("end-to-end");
  });

  it("requires tool evidence before claiming a file exists", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Completion claims");
    expect(prompt).toContain("concrete path");
    expect(prompt).toContain("protocol-level tool blocks");
  });

  it("guides large generated scripts through write_file chunks and run_node", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("For large generation scripts");
    expect(prompt).toContain("write_file");
    expect(prompt).toContain("under 12,000 characters");
    expect(prompt).toContain("mode `append`");
    expect(prompt).toContain("short loader");
    expect(prompt).toContain("Do not use `shell` to run `node script.js`");
  });

  it("guides long coding work through targeted patches", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("For coding tasks with long code");
    expect(prompt).toContain("multiple small `apply_patch` updates");
    expect(prompt).toContain("new large files");
    expect(prompt).toContain("mode `overwrite`");
    expect(prompt).toContain("If a patch fails");
  });

  it("requires paginated reading for truncated text read_file results", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Large text file reads");
    expect(prompt).toContain("truncated: true");
    expect(prompt).toContain("next_offset");
    expect(prompt).toContain("Structured documents need structured parsers");
    expect(prompt).toContain("read_file` on these formats is only a lossy quick text preview");
    expect(prompt).toContain("Do not make whole-file claims from only the first chunk");
  });

  it("can inject task isolation guidance", () => {
    const prompt = buildSystemPrompt({ taskIsolationContext: "## Task Isolation\n\nFresh task." });
    expect(prompt).toContain("## Task Isolation");
    expect(prompt).toContain("Fresh task.");
  });

  it("does NOT re-list tools (they are sent in the API tools array and covered by Tool usage)", () => {
    const prompt = buildSystemPrompt({
      tools: [
        { name: "shell", description: "Execute shell command", parameters: {} },
        { name: "read_file", description: "Read a file", parameters: {} },
      ],
    });
    expect(prompt).not.toContain("Available tools (");
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

  it("orders sections correctly: core → plan → memory → knowledge", () => {
    const prompt = buildSystemPrompt({
      tools: [{ name: "t", description: "d", parameters: {} }],
      memoryContext: "mem",
      knowledgeContext: "know",
      planMode: true,
    });
    const planPos = prompt.indexOf("MODE: PLANNING");
    const memPos = prompt.indexOf("## Your memory");
    const knowPos = prompt.indexOf("## Relevant knowledge");

    expect(planPos).toBeLessThan(memPos);
    expect(memPos).toBeLessThan(knowPos);
  });

  it("includes safety and output style guidelines", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("destructive operations");
    expect(prompt).toContain("ASCII");
    expect(prompt).toContain("concise");
  });

  it("appends current time section with timezone", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("## Current time");
    expect(prompt).toContain("Today is");
  });
});
