import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToAst, renderToPptx } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DataSourceSpec, DomNode, Slideml2SourceDeck } from "./types.js";
import { validateDeck } from "./validate.js";

function findNode(node: DomNode, id: string): DomNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

describe("M2 data binding", () => {
  it("accepts common bind/encoding aliases and semantic field names", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          sales: {
            type: "inline-json",
            rows: [
              { Month: "Jan", Region: "US", Revenue: 10 },
              { Month: "Feb", Region: "US", Revenue: 14 },
              { Month: "Jan", Region: "EU", Revenue: 7 },
            ],
          },
        },
      },
      slides: [{
        id: "alias-bind",
        children: [{
          id: "alias-bind.chart",
          type: "chart-card",
          chartType: "bar",
          bind: {
            dataset: "sales",
            where: { region: "US" },
            group: "month",
            measures: { amount: { op: "sum", field: "revenue" } },
            orderBy: "month",
            top: 2,
          },
          encoding: { category: "month", measure: "amount", legendLabel: "Revenue" },
        } as unknown as DomNode],
      }],
    };

    const report = validateDeck(deck);
    expect(report.errors).toEqual([]);
    const rendered = sourceToRenderedDeck(deck);
    const chart = findNode(rendered.slides[0]!.dom, "alias-bind.chart")!;
    expect(chart.labels).toEqual(["Jan", "Feb"]);
    expect(chart.series?.[0]?.values).toEqual([10, 14]);
  });

  it("reports malformed inline data sources before they degrade into empty chart data", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          malformedJson: { type: "inline-json", row: [{ label: "A", value: 1 }] } as unknown as DataSourceSpec,
          malformedCsv: { type: "inline-csv", csv: "" },
        },
      },
      slides: [],
    };

    const report = validateDeck(deck);
    const messages = report.errors.map((item) => item.message).join("\n");
    expect(messages).toContain("inline-json data source requires rows");
    expect(messages).toContain("inline-csv data source requires a non-empty csv");
  });

  it("requires object-form aggregates to name their input field", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          sales: { type: "inline-json", rows: [{ month: "Jan", revenue: 10 }] },
        },
      },
      slides: [{
        id: "missing-aggregate-field",
        children: [{
          id: "missing-aggregate-field.chart",
          type: "chart-card",
          chartType: "bar",
          bind: { source: "sales", groupBy: "month", aggregate: { Revenue: { op: "sum" } } },
          encoding: { x: "month", y: "Revenue" },
        } as unknown as DomNode],
      }],
    };

    const report = validateDeck(deck);
    expect(report.errors.map((item) => item.code)).toContain("MISSING_DATA_AGGREGATE_FIELD");
  });

  it("reports non-numeric bound chart measures instead of silently plotting them as zero", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          sales: {
            type: "inline-json",
            rows: [
              { month: "Jan", revenue: 10 },
              { month: "Feb", revenue: "not available" },
            ],
          },
        },
      },
      slides: [{
        id: "bad-measure",
        children: [{
          id: "bad-measure.chart",
          type: "chart-card",
          chartType: "bar",
          bind: { source: "sales" },
          encoding: { x: "month", y: "revenue" },
        } as unknown as DomNode],
      }],
    };

    const report = validateDeck(deck);
    const hit = report.errors.find((item) => item.code === "NON_NUMERIC_DATA_FIELD");
    expect(hit?.message).toContain("revenue");
  });

  it("binds chart-card series from object-form encoding.y and display-keyed seriesOptions", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          releaseMetrics: {
            type: "inline-json",
            rows: [
              { phase: "Alpha", clients: 18, nps: 21, latency: 920 },
              { phase: "Beta", clients: 54, nps: 34, latency: 640 },
              { phase: "RC", clients: 91, nps: 41, latency: 510 },
            ],
          },
        },
      },
      slides: [{
        id: "object-y",
        children: [{
          id: "object-y.chart",
          type: "chart-card",
          chartType: "combo",
          bind: { source: "releaseMetrics", groupBy: "phase" },
          encoding: {
            x: "phase",
            y: {
              clients: { seriesName: "活跃客户数", axis: "primary" },
              nps: { seriesName: "NPS", axis: "secondary" },
              latency: { seriesName: "P95 延迟 ms", axis: "primary" },
            },
            seriesOptions: {
              "活跃客户数": { chartType: "bar", color: "0F766E" },
              "P95 延迟 ms": { chartType: "line", color: "D97706", lineDash: "dash" },
            },
          },
        } as unknown as DomNode],
      }],
    };

    const report = validateDeck(deck);
    expect(report.errors).toEqual([]);
    const rendered = sourceToRenderedDeck(deck);
    const chart = findNode(rendered.slides[0]!.dom, "object-y.chart")!;
    expect(chart.labels).toEqual(["Alpha", "Beta", "RC"]);
    expect(chart.series?.map((series) => series.name)).toEqual(["活跃客户数", "NPS", "P95 延迟 ms"]);
    expect(chart.series?.[0]?.values).toEqual([18, 54, 91]);
    expect(chart.series?.[0]?.type).toBe("bar");
    expect(chart.series?.[2]?.type).toBe("line");
    expect(chart.series?.[2]?.lineDash).toBe("dash");
  });

  it("validates object-form encoding.y and seriesOptions data field refs", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          releaseMetrics: {
            type: "inline-json",
            rows: [
              { phase: "Alpha", clients: 18, nps: 21 },
              { phase: "Beta", clients: 54, nps: 34 },
            ],
          },
        },
      },
      slides: [{
        id: "bad-object-y",
        children: [{
          id: "bad-object-y.chart",
          type: "chart-card",
          chartType: "combo",
          bind: { source: "releaseMetrics" },
          encoding: {
            x: "phase",
            y: {
              missingClients: { seriesName: "Clients" },
              nps: { y: "missingNps", seriesName: "NPS" },
            },
            seriesOptions: {
              Clients: { y: "missingSeriesField", chartType: "line" },
              NPS: "NPS score",
            },
          },
        } as unknown as DomNode],
      }],
    };

    const validation = validateDeck(deck);
    expect(validation.errors.map((item) => item.code)).toEqual(expect.arrayContaining(["UNKNOWN_DATA_FIELD"]));
    expect(validation.errors.map((item) => item.path)).toEqual(expect.arrayContaining([
      "slides[0].children[0].encoding.y.missingClients",
      "slides[0].children[0].encoding.y.nps.y",
      "slides[0].children[0].encoding.seriesOptions.Clients.y",
    ]));
    expect(validation.errors.map((item) => item.path)).not.toContain("slides[0].children[0].encoding.seriesOptions.NPS");
  });

  it("resolves one inline-json source into chart, table, stat strip, and metric components", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          sales: {
            type: "inline-json",
            rows: [
              { month: "Jan", product: "Core", revenue: 10, region: "US" },
              { month: "Feb", product: "Core", revenue: 12, region: "US" },
              { month: "Jan", product: "Plus", revenue: 20, region: "US" },
              { month: "Feb", product: "Core", revenue: 7, region: "EU" },
            ],
          },
        },
      },
      slides: [{
        id: "m2",
        title: "Data-bound proof",
        children: [{
          id: "m2.stack",
          type: "stack",
          children: [
            {
              id: "m2.chart",
              type: "chart-card",
              chartType: "bar",
              title: "US revenue",
              bind: { source: "sales", filter: { region: "US" }, sort: "month" },
              encoding: { x: "month", y: "revenue", series: "product" },
            },
            {
              id: "m2.table",
              type: "table-card",
              title: "Top rows",
              bind: { source: "sales", filter: { region: "US" }, select: { Month: "month", Product: "product", Revenue: "revenue" }, limit: 2 },
            },
            {
              id: "m2.strip",
              type: "stat-strip",
              bind: { source: "sales", filter: { region: "US" }, limit: 2 },
              encoding: { label: "product", value: "revenue" },
            },
            {
              id: "m2.metric",
              type: "metric-card",
              bind: { source: "sales", filter: { region: "US" }, sort: "-revenue", limit: 1 },
              encoding: { label: "product", value: "revenue" },
            },
          ],
        }],
      }],
    };

    const validation = validateDeck(deck);
    expect(validation.errors, validation.errors.map((item) => item.message).join("\n")).toHaveLength(0);

    const rendered = sourceToRenderedDeck(deck);
    const chart = findNode(rendered.slides[0]!.dom, "m2.chart");
    const table = findNode(rendered.slides[0]!.dom, "m2.table");
    const strip = findNode(rendered.slides[0]!.dom, "m2.strip");
    const metric = findNode(rendered.slides[0]!.dom, "m2.metric");

    expect(chart?.data).toMatchObject({
      labels: ["Jan", "Feb"],
      series: [
        { name: "Core", values: [10, 12] },
        { name: "Plus", values: [20, 0] },
      ],
    });
    expect(table?.headers).toEqual(["Month", "Product", "Revenue"]);
    expect(table?.rows).toEqual([[{ text: "Jan", align: "center" }, "Core", { text: "$10", align: "right" }], [{ text: "Feb", align: "center" }, "Core", { text: "$12", align: "right" }]]);
    expect(table?.resolvedData?.schema).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "revenue", type: "currency" }),
    ]));
    expect(strip?.items).toEqual([{ value: "10", label: "Core" }, { value: "12", label: "Core" }]);
    expect(metric).toMatchObject({ value: "20", label: "Plus" });

    expect(() => renderToAst(rendered)).not.toThrow();
  });

  it("binds pie-like charts from label/value encoding aliases", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          platforms: {
            type: "inline-json",
            rows: [
              { platform: "Windows", pct: 78 },
              { platform: "Mac ARM", pct: 12 },
              { platform: "Mobile", pct: 5 },
            ],
          },
        },
      },
      slides: [{
        id: "pie-alias",
        children: [{
          id: "pie-alias.chart",
          type: "chart-card",
          chartType: "doughnut",
          bind: { source: "platforms", sort: "-pct" },
          encoding: { label: "platform", value: "pct", seriesName: "下载占比" },
        }] as unknown as DomNode[],
      }],
    };

    const validation = validateDeck(deck);
    expect(validation.errors, validation.errors.map((item) => item.message).join("\n")).toHaveLength(0);

    const rendered = sourceToRenderedDeck(deck);
    const chart = findNode(rendered.slides[0]!.dom, "pie-alias.chart");
    expect(chart?.labels).toEqual(["Windows", "Mac ARM", "Mobile"]);
    expect(chart?.series).toEqual([{ name: "下载占比", values: [78, 12, 5] }]);
  });

  it("binds stat-strip items from multiple fields on the selected data row", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          segments: {
            type: "inline-json",
            rows: [
              { segment: "Enterprise", arr: 31.2, retention: 0.91, incidents: 3 },
              { segment: "SMB", arr: 12.8, retention: 0.84, incidents: 8 },
            ],
          },
        },
      },
      slides: [{
        id: "stat-items",
        title: "Stat item columns",
        children: [{
          id: "stat-items.strip",
          type: "stat-strip",
          bind: { source: "segments", sort: "-arr", limit: 1 },
          encoding: {
            items: [
              { label: "ARR", value: "arr", type: "currency", format: "decimal", tone: "brand" },
              { label: "Retention", value: "retention", type: "percent", tone: "success" },
              { label: "Incidents", value: "incidents", type: "number", format: "int", tone: "warning" },
            ],
          },
        }],
      }],
    };

    const validation = validateDeck(deck);
    expect(validation.errors, validation.errors.map((item) => item.message).join("\n")).toHaveLength(0);

    const rendered = sourceToRenderedDeck(deck);
    const strip = findNode(rendered.slides[0]!.dom, "stat-items.strip");

    expect(strip?.items).toEqual([
      { value: "$31.2", label: "ARR", tone: "brand" },
      { value: "91%", label: "Retention", tone: "success" },
      { value: "3", label: "Incidents", tone: "warning" },
    ]);
    expect(() => renderToAst(rendered)).not.toThrow();
  });

  it("supports array inclusion filters and infers horizontal bars from x=measure/y=category", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          h1: {
            type: "inline-json",
            rows: [
              { metric: "营收(万元)", h1_2024: 31602, h1_2025: 29214 },
              { metric: "人力成本(万元)", h1_2024: 10103, h1_2025: 7258 },
              { metric: "人力ROI", h1_2024: 3.13, h1_2025: 4.03 },
            ],
          },
          func: {
            type: "inline-json",
            rows: [
              { func: "销售", hc: 150 },
              { func: "研发", hc: 55 },
              { func: "售后", hc: 29 },
            ],
          },
        },
      },
      slides: [{
        id: "filters",
        title: "Filter and orientation",
        children: [{
          id: "filters.stack",
          type: "stack",
          children: [
            {
              id: "filters.compare",
              type: "chart-card",
              chartType: "bar",
              bind: { source: "h1", filter: { metric: ["营收(万元)", "人力成本(万元)"] } },
              encoding: { x: "metric", y: ["h1_2024", "h1_2025"], seriesName: "期间" },
            },
            {
              id: "filters.horizontal",
              type: "chart-card",
              chartType: "bar",
              bind: { source: "func", sort: "-hc" },
              encoding: { x: "hc", y: "func", seriesName: "HC(人)" },
            },
          ],
        }],
      }],
    };

    const validation = validateDeck(deck);
    expect(validation.errors, validation.errors.map((item) => item.message).join("\n")).toHaveLength(0);

    const rendered = sourceToRenderedDeck(deck);
    const compare = findNode(rendered.slides[0]!.dom, "filters.compare");
    const horizontal = findNode(rendered.slides[0]!.dom, "filters.horizontal");

    expect(compare?.data).toMatchObject({
      labels: ["营收(万元)", "人力成本(万元)"],
      series: [
        { name: "h1_2024", values: [31602, 10103] },
        { name: "h1_2025", values: [29214, 7258] },
      ],
    });
    expect(horizontal?.data).toMatchObject({
      labels: ["销售", "研发", "售后"],
      series: [{ name: "HC(人)", values: [150, 55, 29] }],
    });
    expect(horizontal).toMatchObject({
      orientation: "horizontal",
    });
  });

  it("treats authored chart series on bound charts as style overrides, not data replacement", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          cust: {
            type: "inline-json",
            rows: [
              { Phase: "Alpha", v: 42 },
              { Phase: "Beta", v: 68 },
              { Phase: "RC", v: 91 },
            ],
          },
        },
      },
      slides: [{
        id: "multi-chart",
        children: [{
          id: "multi-chart.grid",
          type: "grid",
          columns: 2,
          children: [
            {
              id: "multi-chart.bar",
              type: "chart-card",
              chartType: "bar",
              bind: { source: "cust" },
              encoding: { x: "Phase", y: "v", seriesName: "Customers" },
            },
            {
              id: "multi-chart.line",
              type: "chart-card",
              chartType: "line",
              bind: { source: "cust" },
              encoding: { x: "Phase", y: "v" },
              series: [{ name: "Reliability view", color: "#22C55E", lineWidth: 2, marker: { shape: "square" } }],
            },
          ],
        }],
      }],
    };

    const validation = validateDeck(deck);
    expect(validation.errors, validation.errors.map((item) => item.message).join("\n")).toHaveLength(0);

    const rendered = sourceToRenderedDeck(deck);
    const line = findNode(rendered.slides[0]!.dom, "multi-chart.line");
    expect(line?.data).toMatchObject({
      labels: ["Alpha", "Beta", "RC"],
      series: [{ name: "Reliability view", values: [42, 68, 91], color: "#22C55E", lineWidth: 2 }],
    });
    expect(line?.series).toMatchObject([{ name: "Reliability view", values: [42, 68, 91] }]);
  });

  it("groups and aggregates source rows before chart and table encoding", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          pipeline: {
            type: "inline-json",
            rows: [
              { region: "US", segment: "Enterprise", revenue: 20, deals: 2 },
              { region: "US", segment: "SMB", revenue: 8, deals: 3 },
              { region: "EU", segment: "Enterprise", revenue: 11, deals: 1 },
            ],
          },
        },
      },
      slides: [{
        id: "agg",
        title: "Aggregated data",
        children: [
          {
            id: "agg.chart",
            type: "chart-card",
            chartType: "bar",
            bind: {
              source: "pipeline",
              groupBy: "region",
              aggregate: { revenue: "sum", rowCount: "count" },
              sort: "-revenue",
            },
            encoding: { x: "region", y: ["revenue", "rowCount"] },
          },
          {
            id: "agg.table",
            type: "table-card",
            bind: {
              source: "pipeline",
              groupBy: "region",
              aggregate: {
                Revenue: { op: "sum", field: "revenue" },
                Deals: { op: "sum", field: "deals" },
              },
              sort: "-Revenue",
            },
            encoding: {
              columns: [
                { key: "region", label: "Region", width: 1.2 },
                { key: "Revenue", label: "Revenue", type: "currency", format: "int", align: "right", width: 1.4 },
                { key: "Deals", label: "Deals", type: "number", format: "int", align: "right", width: 1.0 },
              ],
            },
          },
        ] as unknown as DomNode[],
      }],
    };

    const validation = validateDeck(deck);
    expect(validation.errors, validation.errors.map((item) => item.message).join("\n")).toHaveLength(0);

    const rendered = sourceToRenderedDeck(deck);
    const chart = findNode(rendered.slides[0]!.dom, "agg.chart");
    const table = findNode(rendered.slides[0]!.dom, "agg.table");

    expect(chart?.data).toMatchObject({
      labels: ["US", "EU"],
      series: [
        { name: "revenue", values: [28, 11] },
        { name: "rowCount", values: [2, 1] },
      ],
    });
    expect(table?.headers).toEqual(["Region", "Revenue", "Deals"]);
    expect(table?.columns).toEqual([{ header: "Region", width: 1.2 }, { header: "Revenue", width: 1.4 }, { header: "Deals", width: 1 }]);
    expect(table?.rows).toEqual([
      ["US", { text: "$28", align: "right" }, { text: "5", align: "right" }],
      ["EU", { text: "$11", align: "right" }, { text: "1", align: "right" }],
    ]);
  });

  it("keeps avg aggregates numeric when all values are empty", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          survey: {
            type: "inline-json",
            rows: [
              { region: "US", score: "" },
              { region: "US", score: null },
              { region: "EU", score: "n/a" },
            ],
          },
        },
      },
      slides: [{
        id: "avg-empty",
        children: [{
          id: "avg-empty.table",
          type: "table-card",
          bind: {
            source: "survey",
            groupBy: "region",
            aggregate: {
              AvgScore: { op: "avg", field: "score" },
              SumScore: { op: "sum", field: "score" },
            },
            sort: "region",
          },
          encoding: { columns: ["region", "AvgScore", "SumScore"] },
        } as unknown as DomNode],
      }],
    };

    const validation = validateDeck(deck);
    expect(validation.errors, validation.errors.map((item) => item.message).join("\n")).toHaveLength(0);

    const rendered = sourceToRenderedDeck(deck);
    const table = findNode(rendered.slides[0]!.dom, "avg-empty.table");
    expect(table?.resolvedData?.rows).toEqual([
      { region: "EU", AvgScore: 0, SumScore: 0 },
      { region: "US", AvgScore: 0, SumScore: 0 },
    ]);
  });

  it("pivots long-form rows into wide table and chart data", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          sales: {
            type: "inline-json",
            rows: [
              { region: "NA", product: "Core", revenue: 10 },
              { region: "NA", product: "Plus", revenue: 14 },
              { region: "EU", product: "Core", revenue: 7 },
              { region: "EU", product: "Plus", revenue: 9 },
              { region: "EU", product: "Plus", revenue: 3 },
            ],
          },
        },
      },
      slides: [{
        id: "pivot",
        title: "Pivoted data",
        children: [
          {
            id: "pivot.table",
            type: "table-card",
            bind: {
              source: "sales",
              pivot: { index: "region", columns: "product", values: "revenue", aggregate: "sum", fill: 0 },
              sort: "region",
            },
            encoding: {
              columns: [
                { key: "region", label: "Region" },
                { key: "Core", label: "Core", type: "currency", format: "int", align: "right" },
                { key: "Plus", label: "Plus", type: "currency", format: "int", align: "right" },
              ],
            },
          },
          {
            id: "pivot.chart",
            type: "chart-card",
            chartType: "bar",
            bind: {
              source: "sales",
              pivot: { index: "region", columns: "product", values: "revenue", aggregate: "sum" },
              sort: "region",
            },
            encoding: { x: "region", y: ["Core", "Plus"] },
          },
        ] as unknown as DomNode[],
      }],
    };

    const validation = validateDeck(deck);
    expect(validation.errors, validation.errors.map((item) => item.message).join("\n")).toHaveLength(0);

    const rendered = sourceToRenderedDeck(deck);
    const table = findNode(rendered.slides[0]!.dom, "pivot.table");
    const chart = findNode(rendered.slides[0]!.dom, "pivot.chart");

    expect(table?.headers).toEqual(["Region", "Core", "Plus"]);
    expect(table?.rows).toEqual([
      ["EU", { text: "$7", align: "right" }, { text: "$12", align: "right" }],
      ["NA", { text: "$10", align: "right" }, { text: "$14", align: "right" }],
    ]);
    expect(table?.resolvedData?.rows).toEqual([
      { region: "EU", Core: 7, Plus: 12 },
      { region: "NA", Core: 10, Plus: 14 },
    ]);
    expect(chart?.data).toMatchObject({
      labels: ["EU", "NA"],
      series: [
        { name: "Core", values: [7, 10] },
        { name: "Plus", values: [12, 14] },
      ],
    });
  });

  it("parses inline csv and reports invalid bind sources", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        validation: { mode: "strict" },
        dataSources: {
          csv: { type: "inline-csv", csv: "segment,value\nEnterprise,42\nSMB,18" },
        },
      },
      slides: [{
        id: "csv",
        children: [
          { id: "csv.chart", type: "chart", chartType: "bar", bind: { source: "csv" }, encoding: { x: "segment", y: "value" } },
          { id: "csv.bad", type: "table-card", bind: { source: "missing", typo: true }, encoding: { columns: ["segment", "value"] } },
          { id: "csv.field", type: "chart", chartType: "bar", bind: { source: "csv", sort: "missing" }, encoding: { x: "segment", y: "missingValue" } },
        ] as unknown as DomNode[],
      }],
    };

    const rendered = sourceToRenderedDeck(deck);
    const chart = findNode(rendered.slides[0]!.dom, "csv.chart");
    expect(chart?.labels).toEqual(["Enterprise", "SMB"]);
    expect(chart?.series).toEqual([{ name: "value", values: [42, 18] }]);

    const validation = validateDeck(deck);
    expect(validation.errors.map((item) => item.code)).toEqual(expect.arrayContaining(["UNKNOWN_DATA_BIND_SOURCE", "UNKNOWN_DATA_BIND_FIELD", "UNKNOWN_DATA_FIELD"]));
  });

  it("reports an empty bind source once without also reporting it as unknown", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          csv: { type: "inline-csv", csv: "segment,value\nEnterprise,42" },
        },
      },
      slides: [{
        id: "empty-source",
        children: [
          { id: "empty-source.table", type: "table-card", bind: { source: "" }, encoding: { columns: ["segment", "value"] } },
        ] as unknown as DomNode[],
      }],
    };

    const validation = validateDeck(deck);
    const sourceErrors = validation.errors.filter((item) => item.path === "slides[0].children[0].bind.source");
    expect(sourceErrors.map((item) => item.code)).toEqual(["INVALID_DATA_BIND_SOURCE"]);
  });

  it("blocks bound components when their source resolves to zero rows", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          empty: { type: "inline-csv", csv: "segment,value\n" },
        },
      },
      slides: [{
        id: "empty-bind",
        children: [
          { id: "empty-bind.chart", type: "chart", chartType: "bar", bind: { source: "empty" }, encoding: { x: "segment", y: "value" } },
        ] as unknown as DomNode[],
      }],
    };

    const validation = validateDeck(deck);

    expect(validation.errors.map((item) => item.code)).toContain("EMPTY_DATA_BIND_SOURCE");
  });

  it("derives computed data sources and drives dual-axis bound charts", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          actuals: {
            type: "inline-json",
            rows: [
              { quarter: "Q1", revenue: 100, cost: 64 },
              { quarter: "Q2", revenue: 128, cost: 78 },
              { quarter: "Q3", revenue: 144, cost: 82 },
            ],
            sourceLabel: "Finance model v3",
          },
          margins: {
            type: "computed",
            source: "actuals",
            computed: {
              profit: { op: "subtract", left: "revenue", right: "cost" },
              marginPct: { op: "divide", left: "profit", right: "revenue" },
            },
            view: { sort: "quarter" },
          },
        },
      },
      slides: [{
        id: "computed",
        children: [{
          id: "computed.chart",
          type: "chart-card",
          chartType: "combo",
          bind: { source: "margins" },
          encoding: {
            x: "quarter",
            y: ["revenue", "marginPct"],
            seriesOptions: {
              revenue: { name: "Revenue", type: "bar" },
              marginPct: { name: "Margin", type: "line", axis: "secondary", color: "2563EB", lineWidth: 2, lineDash: "dashDot", smooth: true, trendLine: { type: "linear", label: "Margin trend" }, errorBars: { type: "fixed", value: 0.02 } },
            },
          },
        }, {
          id: "computed.table",
          type: "table-card",
          bind: { source: "margins" },
          encoding: { columns: ["quarter", "revenue", "profit", "marginPct"] },
        }] as unknown as DomNode[],
      }],
    };

    const validation = validateDeck(deck);
    expect(validation.errors, validation.errors.map((item) => item.message).join("\n")).toHaveLength(0);

    const rendered = sourceToRenderedDeck(deck);
    const chart = findNode(rendered.slides[0]!.dom, "computed.chart");
    const table = findNode(rendered.slides[0]!.dom, "computed.table");
    expect(chart?.dataLineage).toMatchObject({
      source: "margins",
      sourceType: "computed",
      computedFrom: "actuals",
      sourceLabel: "Finance model v3",
    });
    expect(chart?.data?.series).toEqual([
      { name: "Revenue", values: [100, 128, 144], type: "bar" },
      { name: "Margin", values: [0.36, 0.390625, 0.4305555555555556], type: "line", axis: "secondary", color: "2563EB", lineWidth: 2, lineDash: "dashDot", smooth: true, trendLine: { type: "linear", label: "Margin trend" }, errorBars: { type: "fixed", value: 0.02 } },
    ]);
    expect(table?.rows?.[0]).toEqual(["Q1", { text: "$100", align: "right" }, { text: "$36", align: "right" }, { text: "36%", align: "right" }]);
  });

  it("validates computed expressions against source fields and numeric operands", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          base: { type: "inline-json", rows: [{ region: "NA", revenue: 10 }] },
          bad: {
            type: "computed",
            source: "base",
            computed: {
              badMath: { op: "divide", left: "region", right: "missing" },
              badOp: { op: "eval", value: "revenue" },
            },
          } as unknown as DataSourceSpec,
        },
      },
      slides: [{
        id: "bad-computed",
        children: [{ id: "bad-computed.table", type: "table-card", bind: { source: "bad" }, encoding: { columns: ["badMath"] } }] as unknown as DomNode[],
      }],
    };

    const validation = validateDeck(deck);
    expect(validation.errors.map((item) => item.code)).toEqual(expect.arrayContaining([
      "UNKNOWN_DATA_FIELD",
      "INVALID_DATA_COMPUTED_FIELD_TYPE",
      "INVALID_COMPUTED_EXPRESSION",
    ]));
  });

  it("reports computed data sources whose base source cannot be resolved", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          a: { type: "computed", source: "b", computed: { value: { op: "field", value: "value" } } },
          b: { type: "computed", source: "a", computed: { value: { op: "field", value: "value" } } },
        },
      },
      slides: [{
        id: "cyclic-computed",
        children: [{ id: "cyclic-computed.table", type: "table-card", bind: { source: "a" }, encoding: { columns: ["value"] } }] as unknown as DomNode[],
      }],
    };

    const validation = validateDeck(deck);
    expect(validation.errors.map((item) => item.code)).toEqual(expect.arrayContaining(["DATA_SOURCE_UNRESOLVABLE"]));
    expect(validation.errors.map((item) => item.path)).toEqual(expect.arrayContaining([
      "deck.dataSources.a.source",
      "deck.dataSources.b.source",
    ]));
  });

  it("validates pivot field references and shape", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          sales: {
            type: "inline-json",
            rows: [{ region: "NA", product: "Core", revenue: 10 }],
          },
        },
      },
      slides: [{
        id: "bad-pivot",
        children: [{
          id: "bad-pivot.table",
          type: "table-card",
          bind: {
            source: "sales",
            groupBy: "region",
            pivot: { index: "missingRegion", columns: "missingProduct", values: "missingRevenue", aggregate: "median", extra: true },
          },
          encoding: { columns: ["region", "Core"] },
        } as unknown as DomNode],
      }],
    };

    const validation = validateDeck(deck);
    expect(validation.errors.map((item) => item.code)).toEqual(expect.arrayContaining(["UNKNOWN_DATA_FIELD", "INVALID_DATA_BIND_PIVOT", "UNKNOWN_DATA_BIND_FIELD"]));
    expect(validation.errors.map((item) => item.path)).toEqual(expect.arrayContaining([
      "slides[0].children[0].bind.pivot.index",
      "slides[0].children[0].bind.pivot.columns",
      "slides[0].children[0].bind.pivot.values",
      "slides[0].children[0].bind.pivot.aggregate",
      "slides[0].children[0].bind.pivot.extra",
    ]));
  });

  it("loads file-csv relative to the deck path and preserves resolved lineage in render-tree", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slideml2-file-csv-"));
    writeFileSync(join(dir, "sales.csv"), "month,revenue,region\nJan,10,US\nFeb,12,US\nMar,7,EU\n", "utf8");
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        dataSources: {
          sales: { type: "file-csv", path: "sales.csv" },
        },
      },
      slides: [{
        id: "filecsv",
        children: [{
          id: "filecsv.chart",
          type: "chart",
          chartType: "bar",
          bind: { source: "sales", filter: { region: "US" }, sort: "month" },
          encoding: { x: "month", y: "revenue", seriesName: "Revenue" },
        }] as unknown as DomNode[],
      }],
    };

    const validation = validateDeck(deck, { baseDir: dir });
    expect(validation.errors, validation.errors.map((item) => item.message).join("\n")).toHaveLength(0);

    const rendered = sourceToRenderedDeck(deck, { baseDir: dir });
    const chart = findNode(rendered.slides[0]!.dom, "filecsv.chart");
    expect(chart?.labels).toEqual(["Jan", "Feb"]);
    expect(chart?.series).toEqual([{ name: "Revenue", values: [10, 12] }]);
    expect(chart?.dataLineage).toMatchObject({
      source: "sales",
      sourceType: "file-csv",
      sourcePath: join(dir, "sales.csv"),
      baseRowCount: 3,
      rowCount: 2,
      fields: ["month", "revenue", "region"],
    });
    expect(chart?.resolvedData?.rows).toEqual([
      { month: "Jan", revenue: 10, region: "US" },
      { month: "Feb", revenue: 12, region: "US" },
    ]);

    const out = join(dir, "out.pptx");
    await renderToPptx(rendered, out);
    const tree = JSON.parse(readFileSync(`${out}.render-tree.json`, "utf8")) as { slides: Array<{ dom: DomNode }> };
    const treeChart = findNode(tree.slides[0]!.dom, "filecsv.chart");
    expect(treeChart?.dataLineage?.sourceType).toBe("file-csv");
    expect(treeChart?.resolvedData?.rows).toHaveLength(2);
  });

  it("keeps the complete data binding business example valid and renderable", () => {
    const deck = JSON.parse(readFileSync(new URL("../examples/data-binding-business-analysis.json", import.meta.url), "utf8")) as Slideml2SourceDeck;
    const validation = validateDeck(deck);
    expect(validation.errors, validation.errors.map((item) => item.message).join("\n")).toHaveLength(0);

    const rendered = sourceToRenderedDeck(deck);
    const regionTable = findNode(rendered.slides[2]!.dom, "regional.table");
    const pipelineChart = findNode(rendered.slides[4]!.dom, "pipeline.chart");
    expect(regionTable?.rows?.[0]).toEqual([
      "North America",
      { text: "$2,460", align: "right" },
      { text: "32.3%", align: "right" },
      { text: "78", align: "right" },
      { text: "35.7%", align: "right" },
    ]);
    expect(pipelineChart?.data).toMatchObject({
      labels: ["Discovery", "Evaluation", "Procurement", "Commit"],
      series: [{ name: "Pipeline value", values: [1250, 930, 620, 410] }],
    });
    expect(() => renderToAst(rendered)).not.toThrow();
  });
});
