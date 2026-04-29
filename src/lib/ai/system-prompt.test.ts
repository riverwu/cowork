import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./system-prompt";

describe("buildSystemPrompt", () => {
  it("includes core sections", () => {
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
    // We document the non-obvious cross-tool patterns; per-tool basics live
    // in each tool's own description (sent via the tools API param).
    expect(prompt).toContain("isolated envs"); // run_python / run_node sandboxes
    expect(prompt).toContain("install_package"); // package install routing
    expect(prompt).toContain("image_gen"); // image vs chart routing
    expect(prompt).toContain("matplotlib");
    expect(prompt).toContain("SlideML"); // deck toolchain
  });

  it("includes autonomy instructions", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Current request has priority");
    // Persistence/autonomy is now folded into Personality as one sentence.
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

  it("does NOT re-list tools (they are sent in the API tools array and covered by TOOL_RULES)", () => {
    const prompt = buildSystemPrompt({
      tools: [
        { name: "shell", description: "Execute shell command", parameters: {} },
        { name: "read_file", description: "Read a file", parameters: {} },
      ],
    });
    // Auto-generated `## Available tools (N)` was ~600 wasted tokens that
    // duplicated the curated TOOL_RULES + the native tools API parameter.
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
    expect(prompt).toContain("ASCII"); // covers emoji + decorative-punct guidance
    expect(prompt).toContain("concise");
  });
});
