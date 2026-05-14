import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { describeComponents, expandComponent } from "./component-registry.js";
import { clearRenderDiagnostics, getRenderDiagnostics, type LayoutDiagnostic } from "./diagnostics.js";
import { renderToAst, renderToPptx } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { buildTheme, textStyle } from "./theme.js";
import { createTextMeasurer } from "./text-measure.js";
import type { DomNode, Slideml2SourceDeck } from "./types.js";
import { validateDeck } from "./validate.js";

const FOUNDATION_NAMES = [
  "org-chart",
  "roadmap-plan",
  "gantt-chart",
  "cycle-diagram",
  "hub-spoke",
  "decision-tree",
  "stakeholder-map",
  "raci-matrix",
  "kanban-board",
  "pyramid",
  "venn-diagram",
  "value-chain",
  "hierarchy-tree",
  "architecture-map",
  "geo-region-map",
  "calendar-plan",
  "sankey",
] as const;

const BLOCKING = new Set<LayoutDiagnostic["code"]>([
  "FALLBACK_FAILED",
  "COLLISION",
  "TITLE_OCCLUDED",
  "TINY_RECT",
  "SQUASHED",
  "LOW_CONTRAST",
  "SHAPE_INVISIBLE",
  "UNKNOWN_COLOR",
  "UNKNOWN_STYLE",
]);

describe("office foundation components: P0-P2 plus sankey", () => {
  it("exposes complete schema, examples, and usage guidance", () => {
    const result = describeComponents(FOUNDATION_NAMES);
    expect(result.missing).toEqual([]);
    for (const name of FOUNDATION_NAMES) {
      const desc = result.found[name];
      expect(desc?.children.allowed).toBe(false);
      expect(Object.keys(desc?.fields || {}).length).toBeGreaterThan(2);
      expect(desc?.examples?.[0]).toMatchObject({ type: name });
      expect(desc?.guidance?.join(" ")).toMatch(/short|Keep|Use|Author|Pass|role|period|stage/i);
    }
    expect(result.found["sankey"]?.fields.links.required).toBe(true);
    expect(result.found["org-chart"]?.fields.nodes.description).toContain("reportsTo");
    expect(result.found["raci-matrix"]?.fields.roles.required).toBe(true);
  });

  it("renders a realistic office foundation gallery without blocking diagnostics", async () => {
    const source = buildOfficeFoundationDeck();
    const validation = validateDeck(source);
    expect(validation.errors, validation.errors.map((item) => `${item.code}: ${item.message}`).join("\n")).toHaveLength(0);

    clearRenderDiagnostics();
    const rendered = sourceToRenderedDeck(source);
    const ast = renderToAst(rendered);
    const diagnostics = getRenderDiagnostics();
    expect(blockingDiagnostics(diagnostics), formatDiagnostics(diagnostics)).toHaveLength(0);

    const text = allText(ast).join("\n");
    for (const expected of [
      "Commercial leadership",
      "Q3 launch roadmap",
      "ERP rollout schedule",
      "Quarterly operating loop",
      "AI office platform",
      "Deal qualification",
      "Manage closely",
      "Approve budget",
      "Executive review",
      "North Star",
      "Market pull",
      "Source demand",
      "Capability taxonomy",
      "Experience layer",
      "North region",
      "May launch calendar",
      "Qualified pipeline",
    ]) {
      expect(text).toContain(expected);
    }

    const shapeNames = ast.slides.flatMap((slide) => slide.shapes).map((shape) => shape.name || "");
    expect(shapeNames.some((name) => name.includes("org.diagram.edge") && name.includes(".decor."))).toBe(true);
    expect(shapeNames.some((name) => name.includes("org.diagram.level.0.0.avatar"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("roadmap.diagram.lane.0.period"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("gantt.diagram.task.0.period"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("sankey.diagram.link") && name.includes("band"))).toBe(true);
    expect(ast.slides.flatMap((slide) => slide.shapes).filter((shape) => shape.type === "table").length).toBeGreaterThanOrEqual(1);

    clearRenderDiagnostics();
    const outDir = mkdtempSync(join(tmpdir(), "slideml2-office-foundation-"));
    const outPath = join(outDir, "office-foundation-gallery.pptx");
    const pptx = await renderToPptx(rendered, outPath);
    const exportDiagnostics = getRenderDiagnostics();
    expect(blockingDiagnostics(exportDiagnostics), formatDiagnostics(exportDiagnostics)).toHaveLength(0);
    expect(pptx.outputPath).toBe(outPath);
    expect(existsSync(outPath)).toBe(true);
    expect(statSync(outPath).size).toBeGreaterThan(15_000);
  });

  it("adapts org-chart node size and detail by level, content, and density", () => {
    const source: Slideml2SourceDeck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default", brand: { name: "Org Test", primary: "2563EB" } },
      slides: [
        slide("org-adaptive", "Adaptive org", "org-chart", {
          title: "Adaptive org",
          detail: "auto",
          nodes: [
            { id: "ceo", name: "Chief Revenue Officer", role: "Revenue owner", team: "Executive", level: 0, tone: "brand" },
            { id: "vp", name: "Enterprise Sales", role: "New ARR", team: "Commercial", parent: "ceo", level: 1, tone: "positive" },
            { id: "cs", name: "Customer Success", role: "Retention", team: "Commercial", parent: "ceo", level: 1, tone: "warning" },
            { id: "region", name: "West Region", role: "Regional pipeline", parent: "vp", level: 2, tone: "warning" },
            { id: "team", name: "Strategic Pods", role: "Named accounts", parent: "region", level: 3, tone: "neutral" },
            { id: "rep", name: "AE", role: "Expansion motion and renewal coordination", parent: "team", level: 4, tone: "neutral" },
          ],
        }),
      ],
    };

    clearRenderDiagnostics();
    const rendered = sourceToRenderedDeck(source);
    renderToAst(rendered);
    const diagnostics = getRenderDiagnostics();
    expect(blockingDiagnostics(diagnostics), formatDiagnostics(diagnostics)).toHaveLength(0);

    const expanded = expandComponent("org-adaptive", source.slides[0]!.children![0]! as DomNode);
    const root = requireNode(expanded, "org-adaptive.diagram.level.0.0");
    const manager = requireNode(expanded, "org-adaptive.diagram.level.1.0");
    const leaf = requireNode(expanded, "org-adaptive.diagram.level.4.0");
    expect(root.fixedWidth).toBeGreaterThan(manager.fixedWidth);
    expect(manager.fixedWidth).toBeGreaterThan(leaf.fixedWidth);
    expect(root.fixedHeight).toBeGreaterThan(leaf.fixedHeight);
    expect(findNode(expanded, "org-adaptive.diagram.level.0.0.title")).toBeTruthy();
    expect(findNode(expanded, "org-adaptive.diagram.level.4.0.body")).toBeUndefined();
    expect(findNode(expanded, "org-adaptive.diagram.edge.0.decor.0")).toBeTruthy();
    expect(Array.isArray(root.at)).toBe(true);
    expect(Array.isArray(manager.at)).toBe(true);
    expect(Array.isArray(leaf.at)).toBe(true);
  });

  it("spreads org-chart layout within the authored tree region", () => {
    const nodes = [
      { id: "coo", name: "COO", role: "Operating cadence", level: 0, tone: "brand" },
      { id: "people", name: "People Ops", role: "Hiring and retention", parent: "coo", level: 1, tone: "positive" },
      { id: "finance", name: "Finance", role: "Budget control", parent: "coo", level: 1, tone: "warning" },
      { id: "legal", name: "Legal", role: "Risk review", parent: "coo", level: 1, tone: "neutral" },
      { id: "ta", name: "Talent", role: "Recruiting", parent: "people", level: 2, tone: "positive" },
      { id: "bp", name: "BP Team", role: "Org health", parent: "people", level: 2, tone: "neutral" },
    ];
    const narrow = expandComponent("org-narrow", {
      id: "org-narrow.diagram",
      type: "org-chart",
      variant: "frameless",
      detail: "compact",
      treeMaxWidth: 8,
      treeMaxHeight: 3.2,
      nodes,
    } as DomNode);
    const wide = expandComponent("org-wide", {
      id: "org-wide.diagram",
      type: "org-chart",
      variant: "frameless",
      detail: "compact",
      treeMaxWidth: 16,
      treeMaxHeight: 6,
      nodes,
    } as DomNode);

    const narrowTree = requireNode(narrow, "org-narrow.diagram.tree");
    const wideTree = requireNode(wide, "org-wide.diagram.tree");
    expect(numberNodeProp(wideTree, "contentWidth")).toBeGreaterThan(numberNodeProp(narrowTree, "contentWidth") + 4);
    expect(numberNodeProp(wideTree, "contentWidth")).toBeLessThanOrEqual(16.001);
    expect(numberNodeProp(wideTree, "contentHeight")).toBeGreaterThan(numberNodeProp(narrowTree, "contentHeight") + 1);
    expect(numberNodeProp(wideTree, "contentHeight")).toBeLessThanOrEqual(6.001);

    const narrowGap = nodeCenterX(requireNode(narrow, "org-narrow.diagram.level.1.1"))
      - nodeCenterX(requireNode(narrow, "org-narrow.diagram.level.1.0"));
    const wideGap = nodeCenterX(requireNode(wide, "org-wide.diagram.level.1.1"))
      - nodeCenterX(requireNode(wide, "org-wide.diagram.level.1.0"));
    expect(wideGap).toBeGreaterThan(narrowGap + 2);
  });

  it("uses absolute placement size as the org-chart available region", () => {
    const expanded = expandComponent("org-region", {
      id: "org-region.diagram",
      type: "org-chart",
      variant: "frameless",
      at: [1.2, 1.0, 9.2, 4.1],
      detail: "compact",
      nodes: [
        { id: "lead", name: "Operations Lead", role: "Cadence", level: 0, tone: "brand" },
        { id: "people", name: "People Ops", role: "Hiring", parent: "lead", level: 1, tone: "positive" },
        { id: "finance", name: "Finance", role: "Budget", parent: "lead", level: 1, tone: "warning" },
        { id: "legal", name: "Legal", role: "Risk", parent: "lead", level: 1, tone: "neutral" },
        { id: "talent", name: "Talent", role: "Recruiting", parent: "people", level: 2, tone: "positive" },
      ],
    } as DomNode);

    const tree = requireNode(expanded, "org-region.diagram.tree");
    expect(numberNodeProp(tree, "contentWidth")).toBeGreaterThan(8.8);
    expect(numberNodeProp(tree, "contentWidth")).toBeLessThanOrEqual(9.201);
    expect(numberNodeProp(tree, "contentHeight")).toBeGreaterThan(3.7);
    expect(numberNodeProp(tree, "contentHeight")).toBeLessThanOrEqual(4.101);
  });

  it("fits org-chart titles using theme-aware text measurement", () => {
    const theme = buildTheme({ name: "Org Test", primary: "2563EB" }, "default", {
      text: { label: { fontSize: 10.5, lineHeight: 1.1, weight: 700 } },
    });
    const expanded = expandComponent("org-measured", {
      id: "org-measured.diagram",
      type: "org-chart",
      variant: "frameless",
      detail: "compact",
      treeMaxWidth: 14,
      treeMaxHeight: 4.8,
      nodes: [
        { id: "root", name: "COO Office", role: "Operating cadence", level: 0, tone: "brand" },
        { id: "people", name: "People Operations", role: "HR operations", parent: "root", level: 1, tone: "positive" },
        { id: "finance", name: "Finance", role: "Budget", parent: "root", level: 1, tone: "warning" },
      ],
    } as DomNode, theme);

    const people = requireNode(expanded, "org-measured.diagram.level.1.0");
    const title = requireNode(people, "org-measured.diagram.level.1.0.title");
    const content = requireNode(people, "org-measured.diagram.level.1.0.content");
    const row = requireNode(people, "org-measured.diagram.level.1.0.row");
    const avatar = requireNode(people, "org-measured.diagram.level.1.0.avatar");
    const available = numberNodeProp(people, "fixedWidth")
      - numberNodeProp(content, "padding") * 2
      - numberNodeProp(avatar, "fixedWidth")
      - numberNodeProp(row, "gap")
      - 0.26;
    const style = textStyle(theme, "label", "label");
    const measuredTitle = createTextMeasurer(theme).textWidth(String(title.text || ""), style.fontSize, "semibold");
    expect(String(title.text || "")).toMatch(/^People/);
    expect(measuredTitle).toBeLessThanOrEqual(available * 0.96);
  });

  it("renders content-rich org-chart nodes with personnel lists and varied card sizes", async () => {
    const source: Slideml2SourceDeck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default", brand: { name: "Org Test", primary: "2563EB" } },
      slides: [
        slide("org-people", "People operations org", "org-chart", {
          title: "People operations org",
          detail: "full",
          treeMaxWidth: 17.6,
          nodes: [
            {
              id: "coo",
              name: "COO Office",
              role: "Operating cadence",
              team: "Executive",
              body: "Weekly business rhythm",
              people: ["Song Lan", "Maya Reed", "Luis Gomez"],
              level: 0,
              tone: "brand",
            },
            {
              id: "people",
              name: "People Operations",
              role: "HR operations",
              team: "People",
              description: "Hiring, comp review, employee relations",
              people: [
                { name: "Mei Lin", role: "BP" },
                { name: "Ava Chen", role: "TA" },
                { name: "Noah Patel", role: "Comp" },
                { name: "Zoe Park", role: "Ops" },
                { name: "Omar Ali", role: "Ben" },
              ],
              parent: "coo",
              level: 1,
              tone: "positive",
            },
            { id: "finance", name: "Finance", role: "Budget", people: ["Nina Park"], parent: "coo", level: 1, tone: "warning" },
            { id: "legal", name: "Legal", role: "Risk review", parent: "coo", level: 1, tone: "neutral" },
            {
              id: "talent",
              name: "Talent Acquisition",
              role: "Hiring squad",
              members: ["Rui Wang", "Elena Rossi", "Priya Shah"],
              parent: "people",
              level: 2,
              tone: "positive",
            },
          ],
        }),
      ],
    };

    clearRenderDiagnostics();
    const rendered = sourceToRenderedDeck(source);
    const ast = renderToAst(rendered);
    const diagnostics = getRenderDiagnostics();
    expect(blockingDiagnostics(diagnostics), formatDiagnostics(diagnostics)).toHaveLength(0);

    const text = allText(ast).join("\n");
    expect(text).toContain("HR operations | 5 people");
    expect(text).toContain("Mei Lin, Ava Chen");
    expect(text).toContain("Noah Patel, Zoe Park +1");
    expect(text).toContain("Budget");
    expect(text).toContain("Nina Park");

    const expanded = expandComponent("org-people", source.slides[0]!.children![0]! as DomNode);
    const peopleOps = requireOrgPersonByTitle(expanded, "People Operations");
    const finance = requireOrgPersonByTitle(expanded, "Finance");
    const legal = requireOrgPersonByTitle(expanded, "Legal");
    const peopleBody = requireNode(peopleOps, `${peopleOps.id}.body`);
    const financeBody = requireNode(finance, `${finance.id}.body`);

    expect(peopleOps.fixedHeight).toBeGreaterThan(finance.fixedHeight);
    expect(peopleOps.fixedWidth).toBeGreaterThan(finance.fixedWidth);
    expect(peopleBody.paragraphs).toHaveLength(4);
    expect(financeBody.paragraphs).toHaveLength(2);
    expect(findNode(legal, `${legal.id}.body`)).toBeTruthy();

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-org-people-")), "org-people.pptx");
    await renderToPptx(sourceToRenderedDeck(source), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const peopleBodyXml = shapeXmlByName(slideXml, "org-people.diagram.level.1.0.body");
    expect(peopleBodyXml).not.toContain("normAutofit");
    expect(peopleBodyXml).toContain('sz="820"');
  });
});

function buildOfficeFoundationDeck(): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: "default",
      brand: { name: "Office Foundation", primary: "2563EB" },
      themeOverride: {
        colors: {
          brand: { primary: "2563EB", secondary: "0F766E" },
          background: "F8FAFC",
          surface: "FFFFFF",
          "surface.subtle": "EEF2FF",
          divider: "CBD5E1",
          text: { primary: "111827", secondary: "475569", muted: "64748B", inverse: "FFFFFF" },
          success: "15803D",
          warning: "B45309",
          danger: "B91C1C",
        },
        text: {
          "slide-title": { fontSize: 24, lineHeight: 1.08, weight: 700 },
          "card-title": { fontSize: 13, lineHeight: 1.12, weight: 700 },
          paragraph: { fontSize: 10.2, lineHeight: 1.22 },
          caption: { fontSize: 8.7, lineHeight: 1.16 },
          label: { fontSize: 8.4, lineHeight: 1.10, weight: 700 },
        },
        component: {
          card: { cornerRadius: 0.18, line: "divider", lineOpacity: 0.78 },
        },
      },
    },
    slides: [
      slide("org", "Commercial leadership", "org-chart", {
        title: "Commercial leadership",
        nodes: [
          { id: "cro", name: "CRO", role: "Revenue owner", level: 0, tone: "brand" },
          { id: "sales", name: "Sales", role: "Pipeline", parent: "cro", level: 1, tone: "positive" },
          { id: "cs", name: "Customer Success", role: "Retention", parent: "cro", level: 1, tone: "warning" },
          { id: "revops", name: "RevOps", role: "Process", parent: "cro", level: 1, tone: "neutral" },
        ],
      }),
      slide("roadmap", "Q3 launch roadmap", "roadmap-plan", {
        title: "Q3 launch roadmap",
        periods: ["Q1", "Q2", "Q3", "Q4"],
        lanes: [
          { label: "Product", items: [{ title: "Pilot", start: "Q1", end: "Q2" }, { title: "GA", period: "Q3", tone: "positive" }] },
          { label: "GTM", items: [{ title: "Pricing", period: "Q2" }, { title: "Enablement", start: "Q3", end: "Q4", tone: "warning" }] },
          { label: "Ops", items: [{ title: "Support model", start: "Q2", end: "Q3", tone: "neutral" }] },
        ],
      }),
      slide("gantt", "ERP rollout schedule", "gantt-chart", {
        title: "ERP rollout schedule",
        periods: ["W1", "W2", "W3", "W4", "W5"],
        tasks: [
          { title: "Discovery", start: "W1", end: "W2", owner: "PMO" },
          { title: "Config", start: "W2", end: "W4", owner: "IT", tone: "warning" },
          { title: "UAT", start: "W4", end: "W5", owner: "Finance", tone: "positive" },
        ],
      }),
      slide("cycle", "Quarterly operating loop", "cycle-diagram", {
        title: "Quarterly operating loop",
        center: "Revenue cadence",
        steps: [{ title: "Set targets" }, { title: "Run pipeline" }, { title: "Review variance" }, { title: "Reset actions" }],
      }),
      slide("hub", "AI office platform", "hub-spoke", {
        title: "AI office platform",
        center: "AI office platform",
        items: [{ title: "Docs" }, { title: "Slides" }, { title: "Sheets" }, { title: "Email" }, { title: "CRM" }, { title: "BI" }],
      }),
      slide("decision", "Deal qualification", "decision-tree", {
        title: "Deal qualification",
        nodes: [
          { id: "start", title: "Inbound lead", condition: "Need exists", level: 0 },
          { id: "fit", title: "ICP fit?", condition: "Industry + size", parent: "start", level: 1, tone: "brand" },
          { id: "budget", title: "Budget confirmed", outcome: "Route to AE", parent: "fit", level: 2, tone: "positive" },
          { id: "nurture", title: "Nurture", outcome: "Marketing track", parent: "fit", level: 2, tone: "warning" },
        ],
      }),
      slide("stakeholder", "Stakeholder engagement", "stakeholder-map", {
        title: "Stakeholder engagement",
        quadrantLabels: { tr: "Manage closely", tl: "Keep satisfied", br: "Keep informed", bl: "Monitor" },
        items: [
          { label: "CFO", influence: "high", interest: "high", tone: "brand" },
          { label: "Legal", influence: "high", interest: "low", tone: "warning" },
          { label: "Regional Ops", influence: "low", interest: "high", tone: "positive" },
          { label: "Procurement", influence: "low", interest: "low", tone: "neutral" },
        ],
      }),
      slide("raci", "Decision rights", "raci-matrix", {
        title: "Decision rights",
        roles: ["Exec", "PMO", "Finance", "Legal"],
        tasks: [
          { title: "Approve budget", assignments: ["A", "R", "C", "C"] },
          { title: "Executive review", assignments: ["A", "R", "I", "I"] },
          { title: "Contract update", assignments: ["I", "C", "C", "A"] },
        ],
      }),
      slide("kanban", "Launch work board", "kanban-board", {
        title: "Launch work board",
        columns: [
          { title: "To do", items: [{ title: "Partner FAQ", owner: "GTM" }] },
          { title: "Doing", items: [{ title: "Executive review", owner: "PMO", tone: "warning" }] },
          { title: "Done", items: [{ title: "Pricing memo", owner: "Finance", tone: "positive" }] },
        ],
      }),
      slide("pyramid", "Strategy stack", "pyramid", {
        title: "Strategy stack",
        levels: [{ label: "North Star", body: "Gross retention" }, { label: "Capabilities", body: "Data + workflow" }, { label: "Execution", body: "Enablement + adoption" }],
      }),
      slide("venn", "Priority overlap", "venn-diagram", {
        title: "Priority overlap",
        sets: [{ label: "Market pull" }, { label: "Internal capability" }, { label: "Timing" }],
        intersections: [{ label: "High-confidence bet" }, { label: "Partner motion" }],
      }),
      slide("value", "Commercial value chain", "value-chain", {
        title: "Commercial value chain",
        stages: [{ title: "Source demand" }, { title: "Qualify" }, { title: "Close" }, { title: "Onboard" }, { title: "Expand" }],
      }),
      slide("hierarchy", "Capability taxonomy", "hierarchy-tree", {
        title: "Capability taxonomy",
        nodes: [
          { id: "root", label: "Capability taxonomy", level: 0 },
          { id: "data", label: "Data", parent: "root", level: 1, tone: "brand" },
          { id: "workflow", label: "Workflow", parent: "root", level: 1, tone: "positive" },
          { id: "governance", label: "Governance", parent: "root", level: 1, tone: "warning" },
        ],
      }),
      slide("architecture", "Target architecture", "architecture-map", {
        title: "Target architecture",
        layers: [
          { label: "Experience layer", services: ["Portal", "CRM workspace", "Executive app"] },
          { label: "Service layer", services: ["Workflow API", "Policy service", "Notification"] },
          { label: "Data layer", services: ["Lakehouse", "Customer 360", "Metrics"] },
        ],
      }),
      slide("geo", "Regional performance", "geo-region-map", {
        title: "Regional performance",
        regions: [
          { label: "North region", value: "108%", status: "Above plan", tone: "positive" },
          { label: "South region", value: "96%", status: "Watch", tone: "warning" },
          { label: "West region", value: "82%", status: "Recovery", tone: "danger" },
          { label: "East region", value: "101%", status: "Stable", tone: "brand" },
        ],
        legend: [{ label: "On track", tone: "positive" }, { label: "Watch", tone: "warning" }],
      }),
      slide("calendar", "May launch calendar", "calendar-plan", {
        title: "May launch calendar",
        month: "May launch calendar",
        events: [
          { day: 3, title: "Steerco", tone: "brand" },
          { day: 12, title: "Enablement", tone: "warning" },
          { day: 21, title: "Launch", tone: "positive" },
        ],
      }),
      slide("sankey", "Qualified pipeline", "sankey", {
        title: "Qualified pipeline",
        stages: ["Inbound", "Qualified", "Won"],
        nodes: [
          { id: "web", label: "Web", stage: "Inbound", value: "180" },
          { id: "partner", label: "Partner", stage: "Inbound", value: "90" },
          { id: "qualified", label: "Qualified", stage: "Qualified", value: "150" },
          { id: "won", label: "Won", stage: "Won", value: "72" },
        ],
        links: [
          { source: "web", target: "qualified", value: 105, label: "Web flow" },
          { source: "partner", target: "qualified", value: 45, label: "Partner flow", tone: "positive" },
          { source: "qualified", target: "won", value: 72, label: "Closed won", tone: "brand" },
        ],
      }),
    ],
  };
}

function slide(id: string, title: string, type: string, fields: Record<string, unknown>): Slideml2SourceDeck["slides"][number] {
  return {
    id,
    title,
    children: [{
      id: `${id}.diagram`,
      type,
      variant: "frameless",
      ...fields,
    } as DomNode],
  };
}

function blockingDiagnostics(diags: LayoutDiagnostic[]): LayoutDiagnostic[] {
  return diags.filter((diag) => BLOCKING.has(diag.code) && diag.severity !== "info");
}

function formatDiagnostics(diags: LayoutDiagnostic[]): string {
  return diags.map((diag) => `${diag.severity}:${diag.code}:${diag.nodeId || ""}:${diag.message}`).join("\n");
}

function allText(ast: ReturnType<typeof renderToAst>): string[] {
  const out: string[] = [];
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) {
      if (shape.type === "text") {
        for (const para of shape.paragraphs) for (const run of para.runs) out.push(run.text);
      } else if (shape.type === "table") {
        for (const row of shape.cells) {
          for (const cell of row) {
            for (const run of cell.runs) out.push(run.text);
          }
        }
      }
    }
  }
  return out.filter(Boolean);
}

function findNode(root: DomNode, id: string): DomNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

function requireNode(root: DomNode, id: string): DomNode {
  const found = findNode(root, id);
  if (!found) throw new Error(`Missing node ${id}`);
  return found;
}

function numberNodeProp(node: DomNode, key: string): number {
  const value = node[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Expected numeric ${key} on ${node.id}`);
  return value;
}

function nodeCenterX(node: DomNode): number {
  if (!Array.isArray(node.at) || node.at.length < 4) throw new Error(`Expected positioned node ${node.id}`);
  return Number(node.at[0]) + Number(node.at[2]) / 2;
}

function shapeXmlByName(slideXml: string, name: string): string {
  const index = slideXml.indexOf(`name="${name}"`);
  if (index < 0) throw new Error(`Missing shape XML for ${name}`);
  const start = slideXml.lastIndexOf("<p:sp", index);
  const end = slideXml.indexOf("</p:sp>", index);
  if (start < 0 || end < 0) throw new Error(`Malformed shape XML for ${name}`);
  return slideXml.slice(start, end + "</p:sp>".length);
}

function requireOrgPersonByTitle(root: DomNode, title: string): DomNode {
  const found = findNodeWhere(root, (node) => {
    if (node.role !== "org-chart-person") return false;
    return findNode(node, `${node.id}.title`)?.text === title;
  });
  if (!found) throw new Error(`Missing org-chart person titled ${title}`);
  return found;
}

function findNodeWhere(root: DomNode, predicate: (node: DomNode) => boolean): DomNode | undefined {
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const found = findNodeWhere(child, predicate);
    if (found) return found;
  }
  return undefined;
}
