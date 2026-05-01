/**
 * Snapshot tool for slideml2 layout regression.
 *
 * What it does:
 *   1. Builds a curated set of "golden decks" that exercise common layout
 *      stress-points: cover, title-and-content, KPI grid, SWOT, timeline,
 *      panels/cards, palette colors, long titles, image+caption, CJK runs.
 *   2. Renders each deck to .pptx + .render-tree.json under
 *      slideml2/snapshots/.
 *   3. Writes diagnostics-per-deck JSON so we can review which decks emit
 *      OVERFLOW/COLLISION/UNKNOWN_COLOR/etc.
 *   4. Optionally converts each .pptx to PNG via LibreOffice headless when
 *      `--png` is passed and `soffice` is on PATH (or at the standard macOS
 *      location). PNG hashing is left for a future iteration; for now visual
 *      review is manual.
 *
 * Usage (from repo root):
 *   pnpm --filter slideml2 snapshot
 *   pnpm --filter slideml2 snapshot:png
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
  inspectLayout,
  renderToPptx,
  type RenderedDeck,
} from "../src/index.js";

const execFileAsync = promisify(execFile);

const OUTPUT_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "snapshots");

interface Snapshot {
  name: string;
  deck: RenderedDeck;
}

function makeDeck(name: string, slides: RenderedDeck["slides"], theme: "default" = "default"): RenderedDeck {
  return {
    deck: { size: "16x9", theme, brand: { primary: "2563EB" } },
    slides,
  };
}

function snapshotDecks(): Snapshot[] {
  return [
    {
      name: "01-cover",
      deck: makeDeck("cover", [{
        id: "cover",
        layout: "cover",
        dom: {
          id: "cover.root",
          type: "slide",
          background: "brand.primary",
          children: [
            { id: "cover.title", type: "text", text: "Annual Strategy Review", style: "deck-title", color: "text.inverse", anchor: "middle-center", offsetX: 0, offsetY: -0.6, width: 18, height: 2.2 },
            { id: "cover.subtitle", type: "text", text: "FY2026 — investments, risks, opportunities", style: "lead", color: "text.inverse", anchor: "middle-center", offsetX: 0, offsetY: 1.6, width: 18, height: 1.2 },
          ],
        },
      }]),
    },
    {
      name: "02-kpi-grid",
      deck: makeDeck("kpi", [{
        id: "kpi",
        layout: "title-and-content",
        dom: {
          id: "kpi.root",
          type: "slide",
          background: "background",
          children: [
            { id: "kpi.title", type: "text", text: "Q2 highlights", style: "slide-title", align: "left" },
            {
              id: "kpi.content",
              type: "kpi-grid",
              area: "content",
              metrics: [
                { value: "$12.4M", label: "ARR", trend: "up" },
                { value: "8.3%", label: "Net retention", trend: "flat" },
                { value: "32", label: "New logos", trend: "up" },
              ],
              columns: 3,
            },
          ],
        },
      }]),
    },
    {
      name: "03-swot",
      deck: makeDeck("swot", [{
        id: "swot",
        layout: "title-and-content",
        dom: {
          id: "swot.root",
          type: "slide",
          background: "background",
          children: [
            { id: "swot.title", type: "text", text: "Competitive position", style: "slide-title", align: "left" },
            {
              id: "swot.matrix",
              type: "swot-matrix",
              area: "content",
              strengths: ["Strong brand recall", "Deep enterprise integrations", "Diverse channel mix"],
              weaknesses: ["Long onboarding", "Legacy data model"],
              opportunities: ["AI-powered automation", "Adjacent verticals", "Partner ecosystem"],
              threats: ["Open-source clones", "Macro uncertainty"],
            },
          ],
        },
      }]),
    },
    {
      name: "04-process-flow",
      deck: makeDeck("flow", [{
        id: "flow",
        layout: "title-and-content",
        dom: {
          id: "flow.root",
          type: "slide",
          background: "background",
          children: [
            { id: "flow.title", type: "text", text: "Customer onboarding", style: "slide-title", align: "left" },
            {
              id: "flow.body",
              type: "process-flow",
              area: "content",
              direction: "horizontal",
              steps: [
                { title: "Discover", body: "Profile use case" },
                { title: "Configure", body: "Map data sources" },
                { title: "Launch", body: "Roll out to users" },
                { title: "Expand", body: "Adopt new modules" },
              ],
            },
          ],
        },
      }]),
    },
    {
      name: "05-palette-categories",
      deck: makeDeck("palette", [{
        id: "palette",
        layout: "title-and-content",
        dom: {
          id: "palette.root",
          type: "slide",
          background: "background",
          children: [
            { id: "palette.title", type: "text", text: "Risk register by category", style: "slide-title", align: "left" },
            {
              id: "palette.content",
              type: "grid",
              area: "content",
              columns: 3,
              gap: 0.5,
              children: [
                { id: "palette.red", type: "panel", fill: "red.tint", line: "red", children: [{ id: "palette.red.h", type: "stack", direction: "vertical", gap: 0.25, children: [{ id: "palette.red.t", type: "text", text: "Critical", style: "card-title", color: "red.shade" }, { id: "palette.red.b", type: "text", text: "Two unresolved sev-1 incidents.", style: "paragraph" }] }] },
                { id: "palette.orange", type: "panel", fill: "orange.tint", line: "orange", children: [{ id: "palette.orange.h", type: "stack", direction: "vertical", gap: 0.25, children: [{ id: "palette.orange.t", type: "text", text: "Watch", style: "card-title", color: "orange.shade" }, { id: "palette.orange.b", type: "text", text: "Slow migration progress.", style: "paragraph" }] }] },
                { id: "palette.green", type: "panel", fill: "green.tint", line: "green", children: [{ id: "palette.green.h", type: "stack", direction: "vertical", gap: 0.25, children: [{ id: "palette.green.t", type: "text", text: "Healthy", style: "card-title", color: "green.shade" }, { id: "palette.green.b", type: "text", text: "Uptime 99.97%.", style: "paragraph" }] }] },
              ],
            },
          ],
        },
      }]),
    },
    {
      name: "06-long-cjk-title",
      deck: makeDeck("cjk", [{
        id: "cjk",
        layout: "title-and-content",
        dom: {
          id: "cjk.root",
          type: "slide",
          background: "background",
          children: [
            { id: "cjk.title", type: "text", text: "公司业务概览：学习服务与智能硬件", style: "slide-title", align: "left" },
            {
              id: "cjk.content",
              type: "stack",
              area: "content",
              direction: "vertical",
              gap: 0.4,
              children: [
                { id: "cjk.lead", type: "text", text: "公司围绕学习场景构建端到端能力，覆盖从内容到硬件到服务的完整链条。", style: "lead" },
                {
                  id: "cjk.bullets",
                  type: "bullets",
                  items: [
                    "学习服务：覆盖 K-12、考研、职业教育全龄段的内容与课程能力",
                    "智能硬件：以词典笔、学习机、家庭学习屏为核心的硬件矩阵",
                    "在线营销：依托大数据与精准投放支撑教培品牌增长",
                  ],
                },
              ],
            },
          ],
        },
      }]),
    },
    {
      name: "07-stat-comparison",
      deck: makeDeck("stat", [{
        id: "stat",
        layout: "title-and-content",
        dom: {
          id: "stat.root",
          type: "slide",
          background: "background",
          children: [
            { id: "stat.title", type: "text", text: "Funnel improvement", style: "slide-title", align: "left" },
            {
              id: "stat.body",
              type: "stat-comparison",
              area: "content",
              beforeLabel: "Q1 conversion",
              beforeValue: "12%",
              afterLabel: "Q2 conversion",
              afterValue: "27%",
              trend: "up",
              deltaLabel: "+15 pp after onboarding redesign",
            },
          ],
        },
      }]),
    },
    {
      name: "09-hero-stat",
      deck: makeDeck("hero", [{
        id: "hero",
        layout: "title-and-content",
        dom: {
          id: "hero.root",
          type: "slide",
          background: "background",
          children: [
            { id: "hero.title", type: "text", text: "Q4 outcome", style: "slide-title", align: "left" },
            {
              id: "hero.content",
              type: "split",
              area: "content",
              direction: "horizontal",
              ratio: [0.55, 0.45],
              gap: 0.8,
              children: [
                { id: "hero.stat", type: "hero-stat", value: "$12.4M", label: "ARR Q4", caption: "+38% YoY", tone: "positive" },
                {
                  id: "hero.notes",
                  type: "stack",
                  direction: "vertical",
                  gap: 0.4,
                  valign: "middle",
                  children: [
                    { id: "hero.notes.lead", type: "text", style: "lead", text: "Enterprise drove the lift." },
                    { id: "hero.notes.bullets", type: "bullets", density: "compact", items: ["6 new logos > $200K", "Net retention 109%", "Top-of-funnel +24%"] },
                  ],
                },
              ],
            },
          ],
        },
      }]),
    },
    {
      name: "10-bar-list-ranking",
      deck: makeDeck("bars", [{
        id: "bars",
        layout: "title-and-content",
        dom: {
          id: "bars.root",
          type: "slide",
          background: "background",
          children: [
            { id: "bars.title", type: "text", text: "Channel mix Q4", style: "slide-title", align: "left" },
            {
              id: "bars.body",
              type: "stack",
              area: "content",
              direction: "vertical",
              gap: 0.5,
              children: [
                { id: "bars.lead", type: "text", style: "lead", text: "Outbound contributes the largest share but events drive highest velocity." },
                {
                  id: "bars.list",
                  type: "bar-list",
                  tone: "brand",
                  sort: "desc",
                  items: [
                    { label: "Outbound", value: 38, valueLabel: "38%" },
                    { label: "Inbound — content", value: 26, valueLabel: "26%" },
                    { label: "Events", value: 18, valueLabel: "18%" },
                    { label: "Partner referral", value: 12, valueLabel: "12%" },
                    { label: "PLG / self-serve", value: 6, valueLabel: "6%" },
                  ],
                },
              ],
            },
          ],
        },
      }]),
    },
    {
      name: "11-tag-list",
      deck: makeDeck("tags", [{
        id: "tags",
        layout: "title-and-content",
        dom: {
          id: "tags.root",
          type: "slide",
          background: "background",
          children: [
            { id: "tags.title", type: "text", text: "Capability matrix", style: "slide-title", align: "left" },
            {
              id: "tags.body",
              type: "stack",
              area: "content",
              direction: "vertical",
              gap: 0.3,
              children: [
                { id: "tags.h1", type: "text", style: "section-title", text: "Strengths", fixedHeight: 0.55 },
                { id: "tags.t1", type: "tag-list", tone: "positive", items: ["Latency", "Reliability", "Privacy", "Audit"], fixedHeight: 1.0 },
                { id: "tags.h2", type: "text", style: "section-title", text: "Risks", fixedHeight: 0.55 },
                { id: "tags.t2", type: "tag-list", tone: "warning", items: ["Onboarding speed", "Pricing transparency"], fixedHeight: 1.0 },
                { id: "tags.h3", type: "text", style: "section-title", text: "Bets", fixedHeight: 0.55 },
                { id: "tags.t3", type: "tag-list", items: [{ text: "AI-first", tone: "brand" }, { text: "Verticalize", tone: "brand" }, "Open source", "Marketplace"], fixedHeight: 1.0 },
              ],
            },
          ],
        },
      }]),
    },
    {
      name: "12-hero-grid-spans",
      deck: makeDeck("dashboard", [{
        id: "dash",
        layout: "title-and-content",
        dom: {
          id: "dash.root",
          type: "slide",
          background: "background",
          children: [
            { id: "dash.title", type: "text", text: "FY ops dashboard", style: "slide-title", align: "left" },
            {
              id: "dash.grid",
              type: "grid",
              area: "content",
              columns: 4,
              rows: 2,
              gap: 0.5,
              children: [
                {
                  id: "dash.hero",
                  type: "panel",
                  tone: "tinted",
                  colSpan: 2,
                  rowSpan: 2,
                  children: [{
                    id: "dash.hero.body",
                    type: "stack",
                    direction: "vertical",
                    gap: 0.4,
                    valign: "middle",
                    children: [
                      { id: "dash.hero.stat", type: "hero-stat", value: "94%", label: "Annual NRR", caption: "Top decile vs SaaS peers" },
                      { id: "dash.hero.tags", type: "tag-list", tone: "brand", items: ["Enterprise", "Mid-market", "Self-serve"] },
                    ],
                  }],
                },
                { id: "dash.k1", type: "metric-card", value: "$12.4M", label: "ARR", trend: "up" },
                { id: "dash.k2", type: "metric-card", value: "32", label: "New logos", trend: "up" },
                { id: "dash.k3", type: "metric-card", value: "14d", label: "Time to value", trend: "down" },
                { id: "dash.k4", type: "metric-card", value: "8.3%", label: "Logo churn", trend: "flat" },
              ],
            },
          ],
        },
      }]),
    },
    {
      name: "13-numbered-principles",
      deck: makeDeck("principles", [{
        id: "principles",
        layout: "title-and-content",
        dom: {
          id: "principles.root",
          type: "slide",
          background: "background",
          children: [
            { id: "principles.title", type: "text", text: "Operating principles", style: "slide-title", align: "left" },
            {
              id: "principles.body",
              type: "stack",
              area: "content",
              direction: "vertical",
              gap: 0.6,
              children: [
                { id: "principles.lead", type: "lead", text: "Four operating principles, in priority order." },
                {
                  id: "principles.grid",
                  type: "numbered-grid",
                  columns: 4,
                  items: [
                    { title: "Customer first", body: "Every release ships with a named customer using it." },
                    { title: "Speed of trust", body: "Default to small autonomous teams." },
                    { title: "Boring infra", body: "Pick the dullest tool that works." },
                    { title: "Document the why", body: "Decisions outlive their authors." },
                  ],
                },
              ],
            },
          ],
        },
      }]),
    },
    {
      name: "14-key-takeaway",
      deck: makeDeck("takeaway", [{
        id: "tk",
        layout: "title-and-content",
        dom: {
          id: "tk.root",
          type: "slide",
          background: "background",
          children: [
            { id: "tk.title", type: "text", text: "Quarterly review — verdict", style: "slide-title", align: "left" },
            {
              id: "tk.body",
              type: "stack",
              area: "content",
              direction: "vertical",
              gap: 0.55,
              children: [
                { id: "tk.lead", type: "lead", text: "Outbound momentum + Net retention recovery puts us back on plan.", fixedHeight: 0.85 },
                { id: "tk.strip", type: "stat-strip", tone: "positive", items: [
                  { value: "+38%", label: "Velocity" },
                  { value: "+12pp", label: "NRR" },
                  { value: "-9d", label: "TTV" },
                ], fixedHeight: 2.0 },
                { id: "tk.takeaway", type: "key-takeaway", tone: "brand",
                  headline: "Stay the course on enterprise expansion.",
                  detail: "Defer self-serve investments until Q3; double down on ops automation.",
                  fixedHeight: 3.1 },
              ],
            },
          ],
        },
      }]),
    },
    {
      name: "15-stat-strip-and-legend",
      deck: makeDeck("strip", [{
        id: "strip",
        layout: "title-and-content",
        dom: {
          id: "strip.root",
          type: "slide",
          background: "background",
          children: [
            { id: "strip.title", type: "text", text: "Q4 funnel snapshot", style: "slide-title", align: "left" },
            {
              id: "strip.body",
              type: "stack",
              area: "content",
              direction: "vertical",
              gap: 0.7,
              children: [
                { id: "strip.lead", type: "lead", text: "Conversion improved at every funnel stage." },
                {
                  id: "strip.kpis",
                  type: "stat-strip",
                  tone: "positive",
                  items: [
                    { value: "5.4M", label: "Visitors" },
                    { value: "12.8%", label: "Signup" },
                    { value: "31%", label: "Activation" },
                    { value: "27%", label: "Conversion" },
                  ],
                },
                { id: "strip.legend", type: "legend", direction: "horizontal", items: [
                  { label: "Inbound", color: "blue" },
                  { label: "Outbound", color: "teal" },
                  { label: "Partner", color: "purple" },
                  { label: "Self-serve", color: "lime" },
                ] },
              ],
            },
          ],
        },
      }]),
    },
    {
      name: "16-badge-and-flow-arrow",
      deck: makeDeck("badge", [{
        id: "badge",
        layout: "title-and-content",
        dom: {
          id: "badge.root",
          type: "slide",
          background: "background",
          children: [
            { id: "badge.title", type: "text", text: "Roadmap status", style: "slide-title", align: "left" },
            {
              id: "badge.body",
              type: "stack",
              area: "content",
              direction: "horizontal",
              gap: 0.6,
              valign: "middle",
              children: [
                {
                  id: "badge.now",
                  type: "card",
                  header: "In flight",
                  layoutWeight: 4,
                  children: [{
                    id: "badge.now.body",
                    type: "stack",
                    direction: "vertical",
                    gap: 0.3,
                    children: [
                      { id: "badge.now.tag", type: "badge", text: "shipped", tone: "positive" },
                      { id: "badge.now.text", type: "text", style: "paragraph", text: "AI suggestions GA. 30% adoption in week 1." },
                    ],
                  }],
                },
                { id: "badge.arrow", type: "flow-arrow", label: "Q1 → Q2", tone: "brand", direction: "right", layoutWeight: 1 },
                {
                  id: "badge.next",
                  type: "card",
                  header: "Next quarter",
                  layoutWeight: 4,
                  children: [{
                    id: "badge.next.body",
                    type: "stack",
                    direction: "vertical",
                    gap: 0.3,
                    children: [
                      { id: "badge.next.tag", type: "badge", text: "beta", tone: "warning" },
                      { id: "badge.next.text", type: "text", style: "paragraph", text: "Custom workflows behind a feature flag." },
                    ],
                  }],
                },
              ],
            },
          ],
        },
      }]),
    },
    {
      name: "17-text-styling-axes",
      deck: makeDeck("style", [{
        id: "style",
        layout: "title-and-content",
        dom: {
          id: "style.root",
          type: "slide",
          background: "background",
          children: [
            { id: "style.title", type: "text", text: "Text styling axes", style: "slide-title", align: "left" },
            {
              id: "style.body",
              type: "grid",
              area: "content",
              columns: 2,
              gap: 0.45,
              children: [
                { id: "style.r1", type: "text", style: "paragraph", text: "size:xs · paragraph baseline", size: "xs" },
                { id: "style.r2", type: "text", style: "paragraph", text: "size:sm · paragraph baseline", size: "sm" },
                { id: "style.r3", type: "text", style: "paragraph", text: "size:md · paragraph baseline", size: "md" },
                { id: "style.r4", type: "text", style: "paragraph", text: "size:lg · paragraph baseline", size: "lg" },
                { id: "style.r5", type: "text", style: "paragraph", text: "weight:medium · medium emphasis", weight: "medium" },
                { id: "style.r6", type: "text", style: "paragraph", text: "weight:bold · bold emphasis", weight: "bold" },
                { id: "style.r7", type: "text", style: "paragraph", text: "italic + underline", italic: true, underline: true },
                { id: "style.r8", type: "text", style: "label", text: "uppercase + letter-spacing", uppercase: true, letterSpacing: 200 },
                { id: "style.r9", type: "text", style: "paragraph", text: "color:teal.shade · semantic palette", color: "teal.shade" },
              ],
            },
          ],
        },
      }]),
    },
    {
      name: "18-composite-cards",
      deck: makeDeck("composite", [{
        id: "composite",
        layout: "title-and-content",
        dom: {
          id: "composite.root",
          type: "slide",
          background: "background",
          children: [
            { id: "composite.title", type: "text", text: "Composite components", style: "slide-title", align: "left" },
            {
              id: "composite.grid",
              type: "grid",
              area: "content",
              columns: 2,
              rows: 2,
              gap: 0.45,
              children: [
                { id: "composite.image", type: "image-card", title: "Evidence", src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPSc0ODAnIGhlaWdodD0nMjcwJz48cmVjdCB3aWR0aD0nNDgwJyBoZWlnaHQ9JzI3MCcgZmlsbD0nIzBGNzY2RScvPjx0ZXh0IHg9JzI0MCcgeT0nMTQwJyB0ZXh0LWFuY2hvcj0nbWlkZGxlJyBmb250LXNpemU9JzM2JyBmb250LWZhbWlseT0nQXJpYWwnIGZpbGw9J3doaXRlJz5JbWFnZSBDYXJkPC90ZXh0Pjwvc3ZnPg==", caption: "Synthetic image asset", fit: "contain", fixedHeight: 4.4 },
                { id: "composite.chart", type: "chart-card", title: "Pipeline", chartType: "bar", labels: ["Q1", "Q2", "Q3"], series: [{ name: "ARR", values: [4, 6, 9] }], showValues: true, caption: "Source: CRM", fixedHeight: 4.4 },
                { id: "composite.table", type: "table-card", title: "Plan vs actual", headers: ["Metric", "Plan", "Actual"], rows: [["ARR", "$8M", "$9M"], ["NRR", "104%", "109%"]], caption: "Finance", fixedHeight: 4.4 },
                { id: "composite.insight", type: "insight-card", badge: "watch", headline: "Expansion is ahead of plan.", detail: "Constraint: deployment capacity.", tone: "brand", fixedHeight: 4.4 },
              ],
            },
          ],
        },
      }]),
    },
    {
      name: "08-pricing-tiers",
      deck: makeDeck("pricing", [{
        id: "pricing",
        layout: "title-and-content",
        dom: {
          id: "pricing.root",
          type: "slide",
          background: "background",
          children: [
            { id: "pricing.title", type: "text", text: "Plans", style: "slide-title", align: "left" },
            {
              id: "pricing.grid",
              type: "grid",
              area: "content",
              columns: 3,
              gap: 0.6,
              children: [
                { id: "pricing.starter", type: "pricing-card", plan: "Starter", price: "$0", period: "/mo", features: ["3 seats", "Community support"] },
                { id: "pricing.team", type: "pricing-card", plan: "Team", price: "$29", period: "/seat/mo", features: ["Unlimited seats", "Priority support", "SSO"], tone: "brand", ctaText: "Get started" },
                { id: "pricing.ent", type: "pricing-card", plan: "Enterprise", price: "Talk", features: ["Custom SLA", "Dedicated CSM", "On-prem deploy"] },
              ],
            },
          ],
        },
      }]),
    },
  ];
}

async function maybeRenderPng(pptxPath: string): Promise<string | null> {
  const candidates = [
    "soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ];
  for (const cand of candidates) {
    try {
      await execFileAsync(cand, [
        "--headless",
        "--convert-to",
        "png",
        "--outdir",
        dirname(pptxPath),
        pptxPath,
      ], { timeout: 60_000 });
      const pngPath = pptxPath.replace(/\.pptx$/, ".png");
      if (existsSync(pngPath)) return pngPath;
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function main(): Promise<void> {
  const wantPng = process.argv.includes("--png");
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const snapshots = snapshotDecks();
  const summary: Array<{ name: string; pptx: string; dom: string; png?: string; diagnostics: number }> = [];
  for (const snap of snapshots) {
    clearRenderDiagnostics();
    const pptxPath = join(OUTPUT_ROOT, `${snap.name}.pptx`);
    const rendered = await renderToPptx(snap.deck, pptxPath);
    const renderDiagnostics = getRenderDiagnostics();
    clearRenderDiagnostics();
    const layoutPath = join(OUTPUT_ROOT, `${snap.name}.inspect-layout.json`);
    await writeFile(layoutPath, JSON.stringify(inspectLayout(snap.deck), null, 2), "utf8");
    const layoutDiagnostics = getRenderDiagnostics();
    const diagPath = join(OUTPUT_ROOT, `${snap.name}.diagnostics.json`);
    const diagnostics = dedupeDiagnostics([...renderDiagnostics, ...layoutDiagnostics]);
    await writeFile(diagPath, JSON.stringify(diagnostics, null, 2), "utf8");
    let pngPath: string | undefined;
    if (wantPng) {
      const png = await maybeRenderPng(pptxPath);
      if (png) pngPath = png;
    }
    summary.push({ name: snap.name, pptx: rendered.outputPath, dom: rendered.domPath, png: pngPath, diagnostics: diagnostics.length });
    console.log(`✓ ${snap.name} (${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"})`);
  }
  await writeFile(join(OUTPUT_ROOT, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(`\nWrote ${summary.length} snapshots to ${OUTPUT_ROOT}`);
}

function dedupeDiagnostics(items: unknown[]): unknown[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
