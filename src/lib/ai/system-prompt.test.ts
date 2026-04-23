import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./system-prompt";

describe("buildSystemPrompt", () => {
  it("returns base prompt without knowledge context", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Cowork");
    expect(prompt).toContain("knowledge base");
    expect(prompt).not.toContain("Knowledge context");
  });

  it("returns base prompt for empty string context", () => {
    const prompt = buildSystemPrompt("");
    expect(prompt).not.toContain("Knowledge context");
  });

  it("includes knowledge context when provided", () => {
    const context = "This is relevant info from user docs.";
    const prompt = buildSystemPrompt(context);
    expect(prompt).toContain("Knowledge context");
    expect(prompt).toContain(context);
  });

  it("places knowledge context after base prompt", () => {
    const context = "Some context";
    const prompt = buildSystemPrompt(context);
    const baseEnd = prompt.indexOf("Knowledge context");
    const coworkPos = prompt.indexOf("Cowork");
    expect(coworkPos).toBeLessThan(baseEnd);
  });
});
