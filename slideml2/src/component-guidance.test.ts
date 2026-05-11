import { describe, expect, it } from "vitest";
import { describeComponents } from "./component-registry.js";

describe("targeted component usability guidance", () => {
  it("exposes concise guidance only for high-friction components", () => {
    const result = describeComponents(["chart-card", "table-card", "code-block", "equation", "process-flow", "donut-summary", "evidence-layout", "feature-card"]);

    expect(result.found["chart-card"]?.guidance?.join(" ")).toContain("4.8x3.0cm");
    expect(result.found["chart-card"]?.guidance?.join(" ")).toContain("before changing component");
    expect(result.found["table-card"]?.guidance?.join(" ")).toContain("4.5-6cm");
    expect(result.found["table-card"]?.guidance?.join(" ")).toContain("paginate");
    expect(result.found["code-block"]?.guidance?.join(" ")).toContain("maxLines is only for intentional excerpts");
    expect(result.found["equation"]?.guidance?.join(" ")).toContain("fontSize");
    expect(result.found["process-flow"]?.guidance?.join(" ")).toContain("before changing away from process-flow");
    expect(result.found["donut-summary"]?.guidance?.join(" ")).toContain("5x4cm");
    expect(result.found["evidence-layout"]?.guidance?.join(" ")).toContain("dominant evidence object");
    expect(result.found["feature-card"]?.guidance).toBeUndefined();
  });
});
