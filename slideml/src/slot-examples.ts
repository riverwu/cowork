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
      // The basic shape — one series, plain bar. The full vocabulary
      // (combo, scatter, waterfall, annotations) is documented in the
      // JSON Schema's ChartSpec definition.
      return {
        type: "bar",
        data: {
          labels: ["Q1", "Q2", "Q3"],
          series: [
            { name: "Revenue", values: [100, 120, 145] },
          ],
        },
        format: { y: "int" },
        // Optional — chart types: bar | stacked-bar | line | area | pie |
        //   doughnut | combo | scatter | waterfall.
        // Combo:    each series picks `type: "bar" | "line"`.
        // Scatter:  each series uses `points: [{x,y}]` instead of values.
        // Waterfall: a value of `null` marks a "total" bar.
        //
        // annotations: highlight specific points / ranges. Rendered as
        // overlay shapes by the layout (callout, marker, or band).
        // annotations: [
        //   { at: 2, label: "first time over $1M MRR", style: "callout" },
        //   { range: [0, 1], label: "guidance window", style: "band" },
        // ]
      };

    case "table":
      // Cells can be plain strings/numbers OR `{ value, emphasis? }`.
      // emphasis ∈ ok | warn | bad | highlight | up | down | flat — picks
      // a chip colour and bolds the cell.
      return {
        header: ["Metric", "Plan", "Actual"],
        rows: [
          ["Revenue", "8000", { value: "8283", emphasis: "ok" }],
          ["GM%",     "42",   { value: "39.8", emphasis: "warn" }],
        ],
        colWidths: [3, 2, 2],
      };

    case "image-ref":
      return {
        // Three accepted forms. Pick whichever matches what you have:
        //   (1) `{ src }` — local path, https URL, or data URL.
        //   (2) `{ svg }` — inline SVG markup (auto-wrapped as a data URL).
        //   (3) bare path string — e.g. `image: "/path/to.png"`.
        // Optional modifiers: { shape, border, overlay, alt, fit, aspectRatio }.
        src: "/absolute/path/or/https/url/to/image.png",
        alt: "short description",
        // shape: "circle"            // also "rounded" | "square" (default)
        // border: { color: "3CC2FF", width: 38100 }
        // overlay: { color: "0B1B2A", alpha: 0.35 }
        //
        // Inline SVG alternative — useful when an agent generates the
        // graphic inline (icons, sparklines, abstract diagrams):
        //   svg: "<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'><circle cx='50' cy='50' r='40' fill='#3CC2FF'/></svg>"
      };

    case "visual":
      return {
        kind: "chart",
        chartType: "bar",
        data: {
          labels: ["Q1", "Q2", "Q3"],
          series: [{ name: "Revenue", values: [100, 120, 145] }],
        },
        format: { y: "int" },
        // Other tagged forms:
        //   { kind: "image", src: "/abs/path.png", alt?, fit?: "cover"|"contain" }
        //   { kind: "table", header: [...], rows: [...] }
        //   { kind: "svg", svg: "<svg ...>...</svg>", alt? }
        // Legacy untagged image-ref / chart-spec / table also work.
      };

    case "article-blocks":
      return [
        { type: "paragraph", text: "第一段正文，支持 **bold**、*italic*、`code` 和 {highlight:重点}。" },
        { type: "quote", text: "文中的关键句可以作为引用块。" },
        { type: "image", src: "/absolute/path/image.png", caption: "可选图注", fit: "contain" },
        { type: "list", items: ["第一点", "第二点"] },
      ];

    case "bullets":
      // Heuristic by slot name:
      //   - "items" with small itemMaxChars → KPI tiles (stat-grid-3)
      //   - "images" → image-grid cells (image-grid)
      //   - "steps" → timeline; accepts plain strings OR
      //     { title, description? }
      //   - everything else → plain strings or { text, sub? } for 2-level nesting
      //
      // Item text supports the inline-markdown vocabulary: **bold**,
      // *italic*, `code`, {up:+12%}/{down:-3%}/{flat:—}/{ok}/{warn}/{bad}/
      // {highlight}, and :icon-name: (12-icon enum).
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
      if (slotName === "items" && schema.max === 5 && schema.itemMaxChars >= 280) {
        return [
          {
            label: "Q1 Vocabulary in Context",
            detail: "The word \"palatable\" is closest in meaning to:\nA) nutritious   B) pleasant to eat   C) easy to grow   D) high in protein",
            response: "Correct answer: B\npalatable = pleasant to eat.",
          },
          { q: "What is the author's main point?", a: "A concise answer or explanation." },
        ];
      }
      return [
        "First item — supports **bold**, *italic*, `code`",
        { text: "Second item with sub-points", sub: ["nested point a", "nested point b"] },
        "Revenue {up:+12% YoY} or risk {warn:vendor lock-in}",
      ];

    case "component-ref":
      return { name: "<component-name>", slots: {} };

    case "region":
      // Region cells are polymorphic — 10 kinds. Example shows the
      // simplest (kpi); the inline comment enumerates the rest so the
      // agent knows the full vocabulary.
      return {
        kind: "kpi",
        value: "$42.5M",
        label: "ARR",
        delta: "+85% YoY",
        trend: "up",
        // 10 kinds total (use whichever fits the cell):
        //   { kind: "kpi",       value, label, delta?, trend? }
        //   { kind: "chart",     chart: { type, data, format? }, title? }
        //   { kind: "table",     table: { header, rows, colWidths?, align? }, title? }
        //   { kind: "text",      body, title? }
        //   { kind: "bullets",   items: ["..."], title? }
        //   { kind: "image",     image: "/abs/path.png" | { src, alt?, ... }, caption? }
        //   { kind: "code",      code: "...", language?, title? }
        //   { kind: "quote",     text: "...", attribution? }
        //   { kind: "sparkline", values: [1,3,2,5,4], color?: "brand-primary", area?: true, title?, caption? }
        //   { kind: "progress",  value: 0.73, label?: "Adoption", color?, trackColor?, showPercent?: true }
      };

    case "region-list":
      return [
        { kind: "kpi", value: "$42.5M", label: "ARR", delta: "+85% YoY", trend: "up" },
        { kind: "progress", value: 0.73, label: "Adoption" },
        { kind: "bullets", title: "Risks", items: ["Vendor dependency", "Long sales cycle"] },
      ];

    case "enum":
      return schema.default ?? schema.values[0];

    case "markdown-inline":
    case "text-block":
    case "text":
      return undefined;
  }
}
