import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tauri", () => ({
  readFileText: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { readFileText, writeFile } from "@/lib/tauri";
import { applyPatchSkill } from "./apply-patch";

const mockRead = vi.mocked(readFileText);
const mockWrite = vi.mocked(writeFile);

describe("apply_patch skill", () => {
  beforeEach(() => {
    mockRead.mockReset();
    mockWrite.mockReset();
  });

  it("has valid tool definition", () => {
    expect(applyPatchSkill.definition.name).toBe("apply_patch");
    expect(applyPatchSkill.definition.parameters.required).toContain("patch");
  });

  it("creates a new file", async () => {
    mockWrite.mockResolvedValue();
    const patch = `*** Begin Patch
*** Add File: /tmp/test/hello.txt
+Hello World
+Line 2
*** End Patch`;

    const result = await applyPatchSkill.execute({ patch });
    expect(result).toContain("Created");
    expect(result).toContain("hello.txt");
    expect(mockWrite).toHaveBeenCalledWith("/tmp/test/hello.txt", "Hello World\nLine 2");
  });

  it("updates an existing file with simple replacement", async () => {
    mockRead.mockResolvedValue("line 1\nold line\nline 3\n");
    mockWrite.mockResolvedValue();

    const patch = `*** Begin Patch
*** Update File: /tmp/test.txt
@@ old line
 line 1
-old line
+new line
 line 3
*** End Patch`;

    const result = await applyPatchSkill.execute({ patch });
    expect(result).toContain("Updated");
    expect(mockWrite).toHaveBeenCalled();

    const written = mockWrite.mock.calls[0][1];
    expect(written).toContain("new line");
    expect(written).not.toContain("old line");
    expect(written).toContain("line 1");
    expect(written).toContain("line 3");
  });

  it("adds lines without removing", async () => {
    mockRead.mockResolvedValue("line 1\nline 2\nline 3\n");
    mockWrite.mockResolvedValue();

    const patch = `*** Begin Patch
*** Update File: /tmp/test.txt
@@ line 2
 line 2
+inserted line
 line 3
*** End Patch`;

    const result = await applyPatchSkill.execute({ patch });
    expect(result).toContain("Updated");

    const written = mockWrite.mock.calls[0][1];
    expect(written).toContain("inserted line");
    expect(written).toContain("line 2");
    expect(written).toContain("line 3");
  });

  it("handles multiple file operations in one patch", async () => {
    mockRead.mockResolvedValue("old content\n");
    mockWrite.mockResolvedValue();

    const patch = `*** Begin Patch
*** Add File: /tmp/new.txt
+new file content
*** Update File: /tmp/existing.txt
@@ old content
-old content
+updated content
*** End Patch`;

    const result = await applyPatchSkill.execute({ patch });
    expect(result).toContain("Created");
    expect(result).toContain("Updated");
    expect(mockWrite).toHaveBeenCalledTimes(2);
  });

  it("handles file not found error", async () => {
    mockRead.mockRejectedValue(new Error("File not found"));

    const patch = `*** Begin Patch
*** Update File: /tmp/nonexistent.txt
@@ something
-old
+new
*** End Patch`;

    const result = await applyPatchSkill.execute({ patch });
    expect(result).toContain("Failed");
  });

  it("handles trimmed matching when exact match fails", async () => {
    // File has different indentation than patch
    mockRead.mockResolvedValue("  line 1\n  old line\n  line 3\n");
    mockWrite.mockResolvedValue();

    const patch = `*** Begin Patch
*** Update File: /tmp/test.txt
@@ old line
 line 1
-old line
+new line
 line 3
*** End Patch`;

    const result = await applyPatchSkill.execute({ patch });
    // Should still work via trimmed matching
    expect(result).toContain("Updated");
  });

  it("handles empty patch gracefully", async () => {
    const patch = `*** Begin Patch
*** End Patch`;

    const result = await applyPatchSkill.execute({ patch });
    // No operations, no errors
    expect(result).not.toContain("Failed");
  });

  it("handles multiple hunks in one file", async () => {
    mockRead.mockResolvedValue("aaa\nbbb\nccc\nddd\neee\nfff\n");
    mockWrite.mockResolvedValue();

    const patch = `*** Begin Patch
*** Update File: /tmp/test.txt
@@ bbb
-bbb
+BBB
@@ eee
-eee
+EEE
*** End Patch`;

    const result = await applyPatchSkill.execute({ patch });
    expect(result).toContain("Updated");

    const written = mockWrite.mock.calls[0][1];
    expect(written).toContain("BBB");
    expect(written).toContain("EEE");
    expect(written).not.toContain("\nbbb\n");
    expect(written).not.toContain("\neee\n");
  });
});
