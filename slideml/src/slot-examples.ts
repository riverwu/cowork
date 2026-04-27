/**
 * Per-slot-type example payloads.
 *
 * Surfaced by `describeLayout(theme, name)` so an LLM agent sees the exact
 * shape it must emit for typed slots (chart-spec/table/image-ref/bullets).
 * Real-LLM e2e testing showed agents otherwise burn 1–2 retries per chart
 * or table on slot-shape mistakes (flat `chart: { labels, ... }` instead of
 * nested `chart: { data: { labels, ... } }`, series using `data:` instead
 * of `values:`, etc.). Inline examples eliminate the retry.
 */

import type { SlotSchema } from "./theme/types.js";

export function exampleForSlot(
  slotName: string,
  schema: SlotSchema,
): unknown | undefined {
  switch (schema.type) {
    case "chart-spec":
      return {
        type: "bar",
        data: {
          labels: ["Q1", "Q2", "Q3"],
          series: [
            { name: "Revenue", values: [100, 120, 145] },
          ],
        },
        format: { y: "int" },
      };

    case "table":
      return {
        header: ["Metric", "Plan", "Actual"],
        rows: [
          ["Revenue", "8000", "8283"],
          ["GM%", "42", "39.8"],
        ],
        colWidths: [3, 2, 2],
      };

    case "image-ref":
      return {
        src: "/absolute/path/or/https/url/to/image.png",
        alt: "short description",
      };

    case "bullets":
      // Heuristic by slot name:
      //   - "items" with small itemMaxChars → KPI tiles (stat-grid-3)
      //   - "images" → image-grid cells (image-grid-2x2)
      //   - "steps" → process-timeline; accepts plain strings OR
      //     { title, description? }
      //   - everything else → plain strings
      if (slotName === "items" && schema.itemMaxChars <= 64) {
        return [
          { value: "82.3亿", label: "市场规模", delta: "+12% YoY", trend: "up" },
          { value: "3,400万", label: "月活", delta: "+8%", trend: "up" },
          { value: "1.4×", label: "ARPU", delta: "—", trend: "flat" },
        ];
      }
      if (slotName === "images") {
        return [
          { src: "/absolute/path/or/https/url/image1.png", alt: "First image", caption: "Caption A" },
          { src: "/absolute/path/or/https/url/image2.png", caption: "Caption B" },
          // `url:` is also accepted as an alias for `src:`.
        ];
      }
      if (slotName === "steps") {
        return [
          "Detect — describe the trigger",
          { title: "Triage", description: "1-line elaboration if needed" },
          "Mitigate — short verb phrase",
        ];
      }
      return ["First item", "Second item", "Third item"];

    case "component-ref":
      return { name: "<component-name>", slots: {} };

    case "region":
      return {
        kind: "kpi",
        value: "$42.5M",
        label: "ARR",
        delta: "+85% YoY",
        trend: "up",
        // alternatively: { kind: "chart", chart: { type, data, format? }, title? }
        //                 { kind: "table", table: { header, rows, colWidths? }, title? }
        //                 { kind: "text", body, title? }
      };

    case "markdown-inline":
    case "text-block":
    case "text":
      return undefined;
  }
}
