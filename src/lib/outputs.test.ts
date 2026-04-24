import { describe, expect, it } from "vitest";
import { outputsFromText } from "./outputs";

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
});
