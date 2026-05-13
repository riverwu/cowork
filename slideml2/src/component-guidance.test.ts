import { describe, expect, it } from "vitest";
import { describeComponents } from "./component-registry.js";

describe("targeted component usability guidance", () => {
  it("exposes concise guidance only for high-friction components", () => {
    const result = describeComponents(["chart-card", "table-card", "code-block", "equation", "process-flow", "donut-summary", "evidence-layout", "image-card", "feature-card"]);

    expect(result.found["chart-card"]?.guidance?.join(" ")).toContain("4.8x3.0cm");
    expect(result.found["chart-card"]?.guidance?.join(" ")).toContain("before changing component");
    expect(result.found["table-card"]?.guidance?.join(" ")).toContain("4.5-6cm");
    expect(result.found["table-card"]?.guidance?.join(" ")).toContain("paginate");
    expect(result.found["code-block"]?.guidance?.join(" ")).toContain("maxLines is only for intentional excerpts");
    expect(result.found["equation"]?.guidance?.join(" ")).toContain("fontSize");
    expect(result.found["process-flow"]?.guidance?.join(" ")).toContain("before changing away from process-flow");
    expect(result.found["donut-summary"]?.guidance?.join(" ")).toContain("5x4cm");
    expect(result.found["evidence-layout"]?.guidance?.join(" ")).toContain("dominant evidence object");
    expect(result.found["image-card"]?.guidance?.join(" ")).toContain("source aspect ratio");
    expect(result.found["feature-card"]?.guidance).toBeUndefined();
  });

  it("exposes component-local scale only on components that can safely shrink as a unit", () => {
    const result = describeComponents(["process-flow", "timeline", "kpi-grid", "stat-strip", "equation", "code-block", "table-card", "donut-summary", "chart-card", "image-card"]);

    for (const name of ["process-flow", "timeline", "kpi-grid", "stat-strip", "equation", "code-block", "table-card", "donut-summary"]) {
      expect(result.found[name]?.fields.scale?.description, name).toContain("mild capacity pressure");
    }
    expect(result.found["chart-card"]?.fields.scale).toBeUndefined();
    expect(result.found["image-card"]?.fields.scale).toBeUndefined();
  });
});
