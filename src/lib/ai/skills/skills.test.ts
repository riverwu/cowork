import { describe, it, expect, vi } from "vitest";

// Mock Tauri
vi.mock("@/lib/tauri", () => ({
  readFileText: vi.fn(),
  parseDocument: vi.fn(),
  writeFile: vi.fn(),
  listDirectory: vi.fn(),
  grep: vi.fn(),
  runPythonScript: vi.fn(),
  initPythonEnv: vi.fn(),
  installPythonPackage: vi.fn(),
}));

// Mock DB
vi.mock("@/lib/db", () => ({
  createArtifact: vi.fn().mockResolvedValue({ id: "art-1", title: "test", type: "report", content: "c", createdAt: 0, sessionId: null, appId: null, runId: null, metadata: null }),
  upsertCoreFact: vi.fn(),
  createMemory: vi.fn().mockResolvedValue({ id: "mem-1" }),
}));

// Mock knowledge
vi.mock("@/lib/knowledge", () => ({
  retrieveRelevant: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/knowledge/embeddings", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
}));

import { readFileText, parseDocument, writeFile, listDirectory, grep, runPythonScript, initPythonEnv } from "@/lib/tauri";
import { readFile } from "./read-document";
import { writeFileSkill } from "./write-file";
import { listDirectorySkill } from "./list-directory";
import { grepSkill } from "./grep";
import { runPython } from "./run-python";
import { saveMemory } from "./save-memory";
import { createArtifactSkill } from "./create-artifact";

const mockReadFileText = vi.mocked(readFileText);
const mockParseDocument = vi.mocked(parseDocument);
const mockWriteFile = vi.mocked(writeFile);
const mockListDirectory = vi.mocked(listDirectory);
const mockGrep = vi.mocked(grep);
const mockRunPythonScript = vi.mocked(runPythonScript);
const mockInitPythonEnv = vi.mocked(initPythonEnv);

describe("read_file skill", () => {
  it("reads text files via readFileText", async () => {
    mockReadFileText.mockResolvedValue("hello world");
    const result = await readFile.execute({ path: "/test/file.txt" });
    expect(result).toBe("hello world");
    expect(mockReadFileText).toHaveBeenCalledWith("/test/file.txt");
  });

  it("reads documents via parseDocument", async () => {
    mockParseDocument.mockResolvedValue("PDF content here");
    const result = await readFile.execute({ path: "/test/doc.pdf" });
    expect(result).toBe("PDF content here");
    expect(mockParseDocument).toHaveBeenCalledWith("/test/doc.pdf");
  });

  it("truncates very long files", async () => {
    mockReadFileText.mockResolvedValue("x".repeat(25000));
    const result = await readFile.execute({ path: "/test/big.txt" });
    expect(result).toContain("truncated");
    expect(result.length).toBeLessThan(25000);
  });

  it("handles empty files", async () => {
    mockReadFileText.mockResolvedValue("");
    const result = await readFile.execute({ path: "/test/empty.txt" });
    expect(result).toContain("empty");
  });

  it("handles read errors", async () => {
    mockReadFileText.mockRejectedValue(new Error("not found"));
    const result = await readFile.execute({ path: "/bad/path" });
    expect(result).toContain("Error");
  });
});

describe("write_file skill", () => {
  it("writes files successfully", async () => {
    mockWriteFile.mockResolvedValue();
    const result = await writeFileSkill.execute({ path: "/test/out.txt", content: "hello" });
    expect(result).toContain("successfully");
    expect(mockWriteFile).toHaveBeenCalledWith("/test/out.txt", "hello");
  });

  it("handles write errors", async () => {
    mockWriteFile.mockRejectedValue(new Error("permission denied"));
    const result = await writeFileSkill.execute({ path: "/root/bad", content: "x" });
    expect(result).toContain("Error");
  });
});

describe("list_directory skill", () => {
  it("lists directory contents", async () => {
    mockListDirectory.mockResolvedValue([
      { name: "docs", path: "/test/docs", is_dir: true, size: 0, modified_at: 1700000000, extension: "" },
      { name: "file.txt", path: "/test/file.txt", is_dir: false, size: 1024, modified_at: 1700000000, extension: "txt" },
    ]);
    const result = await listDirectorySkill.execute({ path: "/test" });
    expect(result).toContain("2 items");
    expect(result).toContain("docs");
    expect(result).toContain("file.txt");
  });

  it("handles empty directories", async () => {
    mockListDirectory.mockResolvedValue([]);
    const result = await listDirectorySkill.execute({ path: "/empty" });
    expect(result).toContain("empty");
  });
});

describe("grep skill", () => {
  it("finds matches", async () => {
    mockGrep.mockResolvedValue([
      { path: "/test/a.txt", line_number: 5, line: "hello world" },
      { path: "/test/b.txt", line_number: 10, line: "hello there" },
    ]);
    const result = await grepSkill.execute({ directory: "/test", pattern: "hello" });
    expect(result).toContain("2 matches");
    expect(result).toContain("a.txt:5");
    expect(result).toContain("b.txt:10");
  });

  it("reports no matches", async () => {
    mockGrep.mockResolvedValue([]);
    const result = await grepSkill.execute({ directory: "/test", pattern: "xyz" });
    expect(result).toContain("No matches");
  });
});

describe("run_python skill", () => {
  it("runs Python code and returns output", async () => {
    mockInitPythonEnv.mockResolvedValue("ready");
    mockRunPythonScript.mockResolvedValue({ stdout: "42\n", stderr: "", exit_code: 0 });
    const result = await runPython.execute({ code: "print(6*7)" });
    expect(result).toContain("42");
  });

  it("includes stderr in output", async () => {
    mockInitPythonEnv.mockResolvedValue("ready");
    mockRunPythonScript.mockResolvedValue({ stdout: "", stderr: "Warning: deprecated", exit_code: 0 });
    const result = await runPython.execute({ code: "import old" });
    expect(result).toContain("stderr");
    expect(result).toContain("deprecated");
  });

  it("reports non-zero exit codes", async () => {
    mockInitPythonEnv.mockResolvedValue("ready");
    mockRunPythonScript.mockResolvedValue({ stdout: "", stderr: "SyntaxError", exit_code: 1 });
    const result = await runPython.execute({ code: "bad code" });
    expect(result).toContain("exited with code 1");
  });

  it("handles no output", async () => {
    mockInitPythonEnv.mockResolvedValue("ready");
    mockRunPythonScript.mockResolvedValue({ stdout: "", stderr: "", exit_code: 0 });
    const result = await runPython.execute({ code: "x = 1" });
    expect(result).toBe("(no output)");
  });
});

describe("save_memory skill", () => {
  it("saves a preference memory", async () => {
    const result = await saveMemory.execute({
      content: "User prefers markdown tables",
      memory_type: "preference",
    });
    expect(result).toContain("Remembered");
    expect(result).toContain("preference");
  });

  it("saves as core fact when key is provided", async () => {
    const result = await saveMemory.execute({
      content: "English",
      memory_type: "preference",
      key: "preferred_language",
    });
    expect(result).toContain("key: preferred_language");
  });
});

describe("create_artifact skill", () => {
  it("creates an artifact and returns marker", async () => {
    const result = await createArtifactSkill.execute({
      title: "Weekly Report",
      content: "# Report\nContent here",
      type: "report",
    });
    expect(result).toContain("__ARTIFACT__:report:Weekly Report");
    expect(result).toContain("# Report");
  });
});
