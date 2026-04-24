import { describe, expect, it } from "vitest";
import { detectLongTask } from "./long-task";
import type { LLMMessage } from "./providers/types";

function user(content: string): LLMMessage[] {
  return [{ role: "user", content }];
}

describe("detectLongTask", () => {
  it("detects a PPT deliverable generated from an attached file", () => {
    const result = detectLongTask(user(`根据这个文件的内容生成一个Apple Design Guidelines, San Francisco typeface, San-serif typography, Product-centric, Photorealistic imagery, Zen minimalist的风格的PPT。

Attached files:
[File: AI_Agent时代可穿戴硬件发展趋势调研报告.md](/Users/river/Documents/Workspace/AI_Agent时代可穿戴硬件发展趋势调研报告.md)`), "/Users/river/Documents/Workspace");

    expect(result).not.toBeNull();
    expect(result?.workspaceDir).toContain("/Users/river/Documents/Workspace/.cowork-runs/");
    expect(result?.reason).toContain("file deliverable");
  });

  it("detects explicit large document batches", () => {
    const result = detectLongTask(user("参考我文档目录下的100个ppt，帮我写一个关于市场分析的ppt，大约30页"), "/tmp");
    expect(result).not.toBeNull();
    expect(result?.reason).toContain("explicit large-scale");
  });

  it("does not detect a simple short answer", () => {
    const result = detectLongTask(user("解释一下什么是RAG"), "/tmp");
    expect(result).toBeNull();
  });
});
