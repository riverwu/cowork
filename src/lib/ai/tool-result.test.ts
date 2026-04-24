import { describe, expect, it } from "vitest";
import { isToolResultFailure } from "./tool-result";

describe("isToolResultFailure", () => {
  it("detects run_node package install failures", () => {
    expect(isToolResultFailure("Node execution error: npm install failed: npm error code EINVALIDTAGNAME")).toBe(true);
    expect(isToolResultFailure("Package installation failed for sharp: npm error code 1")).toBe(true);
  });

  it("detects non-zero process exits", () => {
    expect(isToolResultFailure("stderr:\nSyntaxError\n\nProcess exited with code 1")).toBe(true);
  });

  it("does not mark normal output as failure", () => {
    expect(isToolResultFailure("File written successfully: /tmp/a.txt (12 characters)")).toBe(false);
    expect(isToolResultFailure("__TASK_PROGRESS__:{\"status\":\"done\"}")).toBe(false);
  });
});
