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
        input: { path: "/Users/river/Documents/Workspace/report.md" },
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
        input: { path: "/Users/river/Documents/Workspace/.cowork-runs/run_1/scripts/create_deck.js" },
        result: "File written successfully: /Users/river/Documents/Workspace/.cowork-runs/run_1/scripts/create_deck.js (9000 characters)",
      },
      {
        skill: "write_file",
        status: "done",
        success: true,
        input: { path: "/Users/river/Documents/Workspace/.cowork-runs/run_1/deck_spec.json" },
        result: "File written successfully: /Users/river/Documents/Workspace/.cowork-runs/run_1/deck_spec.json (900 characters)",
      },
    ]);

    expect(outputs).toEqual([]);
  });

  it("uses update_task_progress outputs as the final produced-file source", () => {
    const outputs = outputsFromSteps([
      {
        skill: "update_task_progress",
        status: "done",
        success: true,
        input: {
          phase: "verify",
          status: "done",
          summary: "done",
          outputs: [
            { title: "Final deck", path: "/Users/river/Documents/Workspace/final.pptx", kind: "file" },
            { title: "Internal source", path: "/Users/river/Documents/Workspace/.cowork-runs/run_1/deck.json", kind: "file" },
          ],
        },
        result: "verify: done — done",
      },
    ]);

    expect(outputs).toEqual([
      {
        id: "file:/Users/river/Documents/Workspace/final.pptx",
        title: "Final deck",
        kind: "file",
        path: "/Users/river/Documents/Workspace/final.pptx",
      },
    ]);
  });

  it("does not infer produced files from plain run output text", () => {
    const outputs = outputsFromSteps([
      {
        skill: "run_node",
        status: "done",
        success: true,
        result: "Generated /Users/river/Documents/Workspace/maybe.pptx",
      },
    ]);

    expect(outputs).toEqual([]);
  });

  it("does not expose failed validate_render pptx as a produced output", () => {
    const outputs = outputsFromSteps([
      {
        skill: "validate_render",
        status: "done",
        success: false,
        input: { outputPath: "/Users/river/Documents/Workspace/draft.pptx" },
        result: JSON.stringify({
          ok: false,
          error: "21 blocking render diagnostic(s) remain.",
          outputPath: "/Users/river/Documents/Workspace/draft.pptx",
        }),
      },
    ]);

    expect(outputs).toEqual([]);
  });

  it("exposes successful validate_render pptx as a produced output", () => {
    const outputs = outputsFromSteps([
      {
        skill: "validate_render",
        status: "done",
        success: true,
        input: { outputPath: "/Users/river/Documents/Workspace/final.pptx" },
        result: JSON.stringify({
          ok: true,
          outputPath: "/Users/river/Documents/Workspace/final.pptx",
        }),
      },
    ]);

    expect(outputs).toEqual([
      {
        id: "file:/Users/river/Documents/Workspace/final.pptx",
        title: "final.pptx",
        kind: "file",
        path: "/Users/river/Documents/Workspace/final.pptx",
      },
    ]);
  });

  it("extracts browser screenshot outputs from structured tool results", () => {
    const outputs = outputsFromSteps([
      {
        skill: "browser",
        status: "done",
        success: true,
        input: { actions: [{ action: "screenshot" }] },
        result: JSON.stringify([
          {
            action: "screenshot",
            result: {
              path: "/Users/river/Library/Application Support/Cowork/browser/screenshots/screenshot.png",
              url: "https://example.com",
            },
          },
        ]),
      },
    ]);

    expect(outputs).toEqual([
      {
        id: "file:/Users/river/Library/Application Support/Cowork/browser/screenshots/screenshot.png",
        title: "screenshot.png",
        kind: "file",
        path: "/Users/river/Library/Application Support/Cowork/browser/screenshots/screenshot.png",
      },
    ]);
  });

  it("extracts browser downloads from structured tool results", () => {
    const outputs = outputsFromSteps([
      {
        skill: "browser",
        status: "done",
        success: true,
        input: { actions: [{ action: "downloads" }] },
        result: JSON.stringify([
          {
            action: "downloads",
            result: {
              downloads: [
                {
                  path: "/Users/river/Library/Application Support/Cowork/browser/downloads/report.pdf",
                  suggestedFilename: "report.pdf",
                },
              ],
            },
          },
        ]),
      },
    ]);

    expect(outputs).toEqual([
      {
        id: "file:/Users/river/Library/Application Support/Cowork/browser/downloads/report.pdf",
        title: "report.pdf",
        kind: "file",
        path: "/Users/river/Library/Application Support/Cowork/browser/downloads/report.pdf",
      },
    ]);
  });

  it("extracts browser pdf outputs and ignores non-user-facing cookie JSON exports", () => {
    const outputs = outputsFromSteps([
      {
        skill: "browser",
        status: "done",
        success: true,
        input: { actions: [{ action: "pdf" }, { action: "cookies", operation: "export" }] },
        result: JSON.stringify([
          { action: "pdf", result: { path: "/Users/river/Library/Application Support/Cowork/browser/pdf/page.pdf" } },
          { action: "cookies", result: { path: "/Users/river/Library/Application Support/Cowork/browser/cookies.json" } },
        ]),
      },
    ]);

    expect(outputs).toEqual([
      {
        id: "file:/Users/river/Library/Application Support/Cowork/browser/pdf/page.pdf",
        title: "page.pdf",
        kind: "file",
        path: "/Users/river/Library/Application Support/Cowork/browser/pdf/page.pdf",
      },
    ]);
  });
});
