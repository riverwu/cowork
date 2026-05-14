import { describe, expect, it } from "vitest";
import { isToolResultFailure } from "./tool-result";

describe("isToolResultFailure", () => {
  it("detects run_node package install failures", () => {
    expect(isToolResultFailure("Node execution error: npm install failed: npm error code EINVALIDTAGNAME")).toBe(true);
    expect(isToolResultFailure("Package installation failed for sharp: npm error code 1")).toBe(true);
  });

  it("detects non-zero process exits", () => {
    expect(isToolResultFailure("stderr:\nSyntaxError\n\nProcess exited with code 1")).toBe(true);
    expect(isToolResultFailure("{\"ok\":true}\n\n[Exit code: 20]")).toBe(true);
  });

  it("does not mark normal output as failure", () => {
    expect(isToolResultFailure("File written successfully: /tmp/a.txt (12 characters)")).toBe(false);
    expect(isToolResultFailure("__TASK_PROGRESS__:{\"status\":\"done\"}")).toBe(false);
  });

  it("detects structured ok false tool results", () => {
    expect(isToolResultFailure(JSON.stringify({
      ok: false,
      error: "21 blocking render diagnostic(s) remain.",
      outputPath: "/tmp/deck.pptx",
    }))).toBe(true);
    expect(isToolResultFailure(`${JSON.stringify({
      ok: false,
      status: "schema-error",
      deckPath: "/tmp/deck.json",
    }, null, 2)}\n\n[Exit code: 10]`)).toBe(true);
  });

  it("does not mark instructional SKILL.md prose as failure just because it says failed", () => {
    const skillRead = [
      "File: /Users/river/.cowork/skills/slideml2/SKILL.md",
      "Total characters: 59344",
      "Returned range: 0-59344",
      "",
      "# SlideML2 Deck Authoring Skill",
      "- TINY_RECT means allocated but unusably narrow/short rect. Treat as failed layout: reduce columns.",
      "- Do not ship a deck with non-zero blocking diagnostics.",
    ].join("\n");

    expect(isToolResultFailure(skillRead)).toBe(false);
  });
});
