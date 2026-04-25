import { describe, expect, it } from "vitest";
import { outputsFromSteps, outputsFromText } from "./outputs";

describe("outputsFromText", () => {
  it("extracts final PPTX paths from assistant text", () => {
    const outputs = outputsFromText(`Apple Design风格的PPT已创建完成。

输出文件： /Users/river/Documents/Workspace/AI_Agent时代可穿戴硬件发展趋势调研_Apple_Style.pptx

PPT结构（19页）：`);

    expect(outputs).toEqual([
      {
        id: "file:/Users/river/Documents/Workspace/AI_Agent时代可穿戴硬件发展趋势调研_Apple_Style.pptx",
        title: "AI_Agent时代可穿戴硬件发展趋势调研_Apple_Style.pptx",
        kind: "file",
        path: "/Users/river/Documents/Workspace/AI_Agent时代可穿戴硬件发展趋势调研_Apple_Style.pptx",
      },
    ]);
  });

  it("does not treat listed source document paths as produced outputs", () => {
    const outputs = outputsFromText(`找到 2 个相关文档：

1. 硬件3月经营分析会.pdf
path: /Users/river/Documents/Workspace/test_docs/硬件3月经营分析会.pdf

2. 人力资源分析.xlsx
path: /Users/river/Documents/Workspace/test_docs/人力资源分析.xlsx`);

    expect(outputs).toEqual([]);
  });
});

describe("outputsFromSteps", () => {
  it("ignores search and read tool paths", () => {
    const outputs = outputsFromSteps([
      {
        skill: "search_knowledge",
        status: "done",
        success: true,
        result: "path: /Users/river/Documents/Workspace/test_docs/人力资源分析.xlsx",
      },
      {
        skill: "read_file",
        status: "done",
        success: true,
        result: "File: /Users/river/Documents/Workspace/source.pdf\nTotal characters: 100",
      },
    ]);

    expect(outputs).toEqual([]);
  });

  it("extracts user-facing files from write_file results", () => {
    const outputs = outputsFromSteps([
      {
        skill: "write_file",
        status: "done",
        success: true,
        result: "File written successfully: /Users/river/Documents/Workspace/report.md (1200 characters)",
      },
    ]);

    expect(outputs).toEqual([
      {
        id: "file:/Users/river/Documents/Workspace/report.md",
        title: "report.md",
        kind: "file",
        path: "/Users/river/Documents/Workspace/report.md",
      },
    ]);
  });

  it("excludes internal long-task scripts and specs", () => {
    const outputs = outputsFromSteps([
      {
        skill: "write_file",
        status: "done",
        success: true,
        result: "File written successfully: /Users/river/Documents/Workspace/.cowork-runs/run_1/scripts/create_deck.js (9000 characters)",
      },
      {
        skill: "write_file",
        status: "done",
        success: true,
        result: "File written successfully: /Users/river/Documents/Workspace/.cowork-runs/run_1/deck_spec.json (900 characters)",
      },
    ]);

    expect(outputs).toEqual([]);
  });
});
