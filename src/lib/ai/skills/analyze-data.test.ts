import { describe, it, expect } from "vitest";
import { analyzeData } from "./analyze-data";

describe("analyze_data skill", () => {
  it("has valid tool definition", () => {
    expect(analyzeData.definition.name).toBe("analyze_data");
    expect(analyzeData.definition.parameters).toBeDefined();
  });

  it("analyzes CSV data summary", async () => {
    const csv = "name,value,change\nA,100,10\nB,200,20\nC,300,-5";
    const result = await analyzeData.execute({
      data: csv,
      analysis_type: "summary",
    });
    expect(result).toContain("3 rows");
    expect(result).toContain("3 columns");
    expect(result).toContain("Mean");
  });

  it("analyzes JSON array data", async () => {
    const json = JSON.stringify([
      { product: "A", sales: 100 },
      { product: "B", sales: 200 },
      { product: "C", sales: 50 },
    ]);
    const result = await analyzeData.execute({
      data: json,
      analysis_type: "summary",
    });
    expect(result).toContain("3 rows");
    expect(result).toContain("sales");
  });

  it("detects anomalies", async () => {
    const csv = "item,value\nA,10\nB,12\nC,11\nD,500\nE,9\nF,11\nG,10";
    const result = await analyzeData.execute({
      data: csv,
      analysis_type: "anomaly",
    });
    expect(result).toContain("Anomal");
  });

  it("handles comparison", async () => {
    const csv = "month,revenue\nJan,1000\nFeb,1200\nMar,1500";
    const result = await analyzeData.execute({
      data: csv,
      analysis_type: "compare",
    });
    expect(result).toContain("→");
  });

  it("handles empty data", async () => {
    const result = await analyzeData.execute({
      data: "",
      analysis_type: "summary",
    });
    expect(result).toContain("No data");
  });

  it("focuses on specific column", async () => {
    const csv = "name,sales,cost\nA,100,50\nB,200,80\nC,150,60";
    const result = await analyzeData.execute({
      data: csv,
      analysis_type: "summary",
      focus: "sales",
    });
    expect(result).toContain("sales");
    expect(result).not.toContain("### cost");
  });
});
