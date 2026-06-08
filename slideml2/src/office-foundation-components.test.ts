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
  "tree-chart",
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
  "SHAPE_INVISIBLE",
  "UNKNOWN_COLOR",
  "UNKNOWN_STYLE",
]);

const TREE_CHART_EXAMPLE_URL = new URL("../examples/tree-chart-operating-model.json", import.meta.url);

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

    const shapeNames = allShapes(ast).map((shape) => shape.name || "");
    expect(shapeNames.some((name) => name.includes("org.diagram.edge."))).toBe(true);
    expect(shapeNames.some((name) => name.includes("org.diagram.level.0.0.avatar"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("roadmap.diagram.lane.0.period"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("gantt.diagram.task.0.period"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("tree.diagram.edge."))).toBe(true);
    expect(shapeNames.some((name) => name.includes("tree.diagram.level.1.0.stripe"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("sankey.diagram.link") && name.includes("band"))).toBe(true);
    expect(allShapes(ast).filter((shape) => shape.type === "table").length).toBeGreaterThanOrEqual(1);

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
    expect(findNode(expanded, "org-adaptive.diagram.edge.0")).toBeTruthy();
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
    expect(numberNodeProp(wideTree, "contentHeight")).toBeGreaterThan(numberNodeProp(narrowTree, "contentHeight") + 0.25);
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
    expect(numberNodeProp(tree, "contentWidth")).toBeGreaterThan(8.2);
    expect(numberNodeProp(tree, "contentWidth")).toBeLessThanOrEqual(9.201);
    expect(numberNodeProp(tree, "contentHeight")).toBeGreaterThan(3.7);
    expect(numberNodeProp(tree, "contentHeight")).toBeLessThanOrEqual(4.12);
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
    if (!Array.isArray(title.at) || title.at.length < 4) throw new Error("Expected positioned org title");
    const available = Number(title.at[2]);
    const style = textStyle(theme, "label", "label");
    const measuredTitle = createTextMeasurer(theme).textWidth(String(title.text || ""), style.fontSize, style.weight ?? style.fontWeight);
    expect(String(title.text || "")).toMatch(/^People/);
    expect(measuredTitle).toBeLessThanOrEqual(available * 0.96);
  });

  it("honors org-chart theme styles, node surfaces, connector styling, and node icons", async () => {
    const source: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        themeOverride: {
          text: {
            "org-node-title": { fontSize: 11, weight: "medium" },
            "org-node-body": { fontSize: 8.4, weight: "regular" },
          },
        },
      },
      slides: [{
        id: "org-style",
        layout: "blank",
        children: [{
          id: "org-style.diagram",
          type: "org-chart",
          variant: "frameless",
          detail: "full",
          titleStyle: "org-node-title",
          bodyStyle: "org-node-body",
          nodeSurface: { fill: "surface.subtle", line: "none" },
          connectorLine: "brand.primary",
          connectorLineWidth: 0.04,
          connectorLineDash: "dash",
          nodes: [
            { id: "coo", name: "COO", role: "Operating model", icon: "diamond", badge: "CORE", tone: "brand" },
            { id: "people", name: "People", role: "Hiring ops", parent: "coo", icon: "ellipse", badges: ["LIVE"], tone: "positive", line: "positive" },
            { id: "finance", name: "Finance", role: "Budget", parent: "coo", icon: "hexagon", badge: "OPS", tone: "warning" },
          ],
        } as DomNode],
      }],
    };

    clearRenderDiagnostics();
    const rendered = sourceToRenderedDeck(source);
    const ast = renderToAst(rendered);
    const diagnostics = getRenderDiagnostics();
    expect(blockingDiagnostics(diagnostics), formatDiagnostics(diagnostics)).toHaveLength(0);

    const shapes = allShapes(ast);
    const shapeNames = shapes.map((shape) => shape.name || "");
    expect(shapeNames).toContain("org-style.diagram.level.0.0");
    expect(shapeNames).toContain("org-style.diagram.level.0.0.avatar");
    expect(shapeNames).toContain("org-style.diagram.level.0.0.badge.0");
    expect(shapeNames).toContain("org-style.diagram.level.1.0.avatar");
    expect(shapeNames).toContain("org-style.diagram.level.1.0.badge.0");

    const rootBg = shapes.find((shape) => shape.name === "org-style.diagram.level.0.0.bg");
    expect(rootBg?.line).toBeUndefined();
    const peopleBg = shapes.find((shape) => shape.name === "org-style.diagram.level.1.0.bg");
    expect(peopleBg?.line).toBeTruthy();

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-org-chart-style-")), "org-chart-style.pptx");
    await renderToPptx(rendered, out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain("<p:grpSp>");
    expect(slideXml).toContain("<p:cxnSp>");
    expect(slideXml).toContain("<a:stCxn");
    expect(slideXml).toContain("<a:endCxn");
    expect(slideXml).toContain('<a:prstDash val="dash"/>');
    expect(slideXml).toContain('name="org-style.diagram.level.0.0"');
    expect(slideXml).toContain('name="org-style.diagram.level.0.0.avatar"');
    expect(slideXml).toContain('name="org-style.diagram.level.0.0.badge.0"');

    const titleXml = shapeXmlByName(slideXml, "org-style.diagram.level.0.0.title");
    expect(titleXml).toContain('sz="1100"');
    const bodyXml = shapeXmlByName(slideXml, "org-style.diagram.level.0.0.body");
    expect(bodyXml).toContain('sz="840"');
    expect(bodyXml).not.toContain("normAutofit");
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

  it("uses tree-layout for generic tree-chart with adaptive node sizes", () => {
    const nodes = [
      { id: "root", label: "Operating capability map", body: "North-star capabilities and dependencies", tone: "brand" },
      { id: "data", label: "Data foundation", body: "Customer 360, quality rules, lineage", parent: "root", tone: "brand" },
      { id: "workflow", label: "Workflow automation", body: "Approvals, escalations, exception handling", parent: "root", tone: "positive" },
      { id: "governance", label: "Governance", body: "Policy controls", parent: "root", tone: "warning" },
      { id: "metrics", label: "Metric registry", value: "Single KPI source", parent: "data", tone: "neutral" },
      { id: "alerts", label: "Exception alerts", value: "SLA breach routing", parent: "workflow", tone: "danger" },
    ];
    const narrow = expandComponent("tree-narrow", {
      id: "tree-narrow.diagram",
      type: "tree-chart",
      variant: "frameless",
      detail: "full",
      treeMaxWidth: 8,
      treeMaxHeight: 3.6,
      nodes,
    } as DomNode);
    const wide = expandComponent("tree-wide", {
      id: "tree-wide.diagram",
      type: "tree-chart",
      variant: "frameless",
      detail: "full",
      treeMaxWidth: 15,
      treeMaxHeight: 5.4,
      nodes,
    } as DomNode);

    const narrowTree = requireNode(narrow, "tree-narrow.diagram.tree");
    const wideTree = requireNode(wide, "tree-wide.diagram.tree");
    expect(numberNodeProp(wideTree, "contentWidth")).toBeGreaterThan(numberNodeProp(narrowTree, "contentWidth") + 3);
    expect(numberNodeProp(wideTree, "contentWidth")).toBeLessThanOrEqual(15.001);
    expect(numberNodeProp(wideTree, "contentHeight")).toBeGreaterThan(numberNodeProp(narrowTree, "contentHeight") + 0.25);
    expect(numberNodeProp(wideTree, "contentHeight")).toBeLessThanOrEqual(5.401);

    const root = requireNode(wide, "tree-wide.diagram.level.0.0");
    const branch = requireNode(wide, "tree-wide.diagram.level.1.0");
    const leaf = requireNode(wide, "tree-wide.diagram.level.2.0");
    expect(root.role).toBe("tree-chart-node");
    expect(numberNodeProp(root, "fixedWidth")).toBeGreaterThan(numberNodeProp(leaf, "fixedWidth"));
    expect(findNode(branch, "tree-wide.diagram.level.1.0.body")).toBeTruthy();
    expect(findNode(leaf, "tree-wide.diagram.level.2.0.stripe")).toBeTruthy();
    expect(findNode(wide, "tree-wide.diagram.edge.0")).toBeTruthy();
    expect(Array.isArray(branch.at)).toBe(true);
    expect(nodeCenterX(branch)).toBeLessThan(nodeCenterX(requireNode(wide, "tree-wide.diagram.level.1.2")));
  });

  it("honors tree-chart theme styles, node surfaces, connector styling, and node icons", async () => {
    const source: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        themeOverride: {
          text: {
            "tree-node-title": { fontSize: 11, weight: "medium" },
            "tree-node-body": { fontSize: 8.4, weight: "regular" },
          },
        },
      },
      slides: [{
        id: "tree-style",
        layout: "blank",
        children: [{
          id: "tree-style.diagram",
          type: "tree-chart",
          variant: "frameless",
          detail: "full",
          titleStyle: "tree-node-title",
          bodyStyle: "tree-node-body",
          nodeSurface: { fill: "surface.subtle", line: "none" },
          connectorLine: "brand.primary",
          connectorLineWidth: 0.04,
          connectorLineDash: "dash",
          nodes: [
            { id: "root", title: "Customer operations platform", body: "Shared operating model", icon: "diamond", badge: "CORE", tone: "brand" },
            { id: "data", title: "Data layer", body: "Signals and policy context", parent: "root", icon: "ellipse", badges: ["LIVE"], tone: "positive", line: "positive" },
            { id: "workflow", title: "Workflow automation", body: "Route work and next action", parent: "root", icon: "hexagon", badge: "OPS", tone: "warning", fill: "surface" },
          ],
        } as DomNode],
      }],
    };

    clearRenderDiagnostics();
    const rendered = sourceToRenderedDeck(source);
    const ast = renderToAst(rendered);
    const diagnostics = getRenderDiagnostics();
    expect(blockingDiagnostics(diagnostics), formatDiagnostics(diagnostics)).toHaveLength(0);

    const shapes = allShapes(ast);
    const shapeNames = shapes.map((shape) => shape.name || "");
    expect(shapeNames).toContain("tree-style.diagram.level.0.0");
    expect(shapeNames).toContain("tree-style.diagram.level.0.0.icon");
    expect(shapeNames).toContain("tree-style.diagram.level.0.0.badge.0");
    expect(shapeNames).toContain("tree-style.diagram.level.1.0.icon");
    expect(shapeNames).toContain("tree-style.diagram.level.1.0.badge.0");

    const rootBg = shapes.find((shape) => shape.name === "tree-style.diagram.level.0.0.bg");
    expect(rootBg?.line).toBeUndefined();
    const dataBg = shapes.find((shape) => shape.name === "tree-style.diagram.level.1.0.bg");
    expect(dataBg?.line).toBeTruthy();

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-tree-chart-style-")), "tree-chart-style.pptx");
    await renderToPptx(rendered, out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain('name="tree-style.diagram.level.0.0"');
    expect(slideXml).toContain('name="tree-style.diagram.level.0.0.icon"');
    expect(slideXml).toContain('name="tree-style.diagram.level.0.0.badge.0"');
    expect(slideXml).toContain('name="tree-style.diagram.edge.0"');
    expect(slideXml).toContain('<a:prstDash val="dash"/>');

    const titleXml = shapeXmlByName(slideXml, "tree-style.diagram.level.0.0.title");
    expect(titleXml).toContain('sz="1100"');
    const bodyXml = shapeXmlByName(slideXml, "tree-style.diagram.level.0.0.body");
    expect(bodyXml).toContain('sz="840"');
    expect(bodyXml).not.toContain("normAutofit");
  });

  it("renders the tree-chart operating model example without visual overflow", async () => {
    const source = JSON.parse(readFileSync(TREE_CHART_EXAMPLE_URL, "utf8")) as Slideml2SourceDeck;
    const validation = validateDeck(source);
    expect(validation.errors, validation.errors.map((item) => `${item.code}: ${item.message}`).join("\n")).toHaveLength(0);

    clearRenderDiagnostics();
    const rendered = sourceToRenderedDeck(source);
    const ast = renderToAst(rendered);
    const diagnostics = getRenderDiagnostics();
    expect(blockingDiagnostics(diagnostics), formatDiagnostics(diagnostics)).toHaveLength(0);

    const text = allText(ast).join("\n");
    for (const expected of [
      "Customer operations capability map",
      "Customer ops platform",
      "Data layer",
      "Workflow automation",
      "Governance",
      "Knowledge graph",
      "Risk audit",
    ]) {
      expect(text).toContain(expected);
    }

    const shapeNames = allShapes(ast).map((shape) => shape.name || "");
    expect(shapeNames.some((name) => name.includes("tree-use-case.diagram.edge."))).toBe(true);
    expect(shapeNames.some((name) => name.includes("tree-use-case.diagram.level.0.0.out-port"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("tree-use-case.diagram.level.1.0.in-port"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("tree-use-case.diagram.level.2.0.stripe"))).toBe(true);
    expect(shapeNames.some((name) => name.includes("tree-use-case.diagram.level.2.5.title"))).toBe(true);

    clearRenderDiagnostics();
    const out = join(mkdtempSync(join(tmpdir(), "slideml2-tree-chart-example-")), "tree-chart-operating-model.pptx");
    await renderToPptx(rendered, out);
    const exportDiagnostics = getRenderDiagnostics();
    expect(blockingDiagnostics(exportDiagnostics), formatDiagnostics(exportDiagnostics)).toHaveLength(0);
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(8_000);

    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain("<p:grpSp>");
    expect(slideXml).toContain("<p:cxnSp>");
    expect(slideXml).toContain("<a:stCxn");
    expect(slideXml).toContain("<a:endCxn");
    expect(slideXml).toContain('prst="bentConnector3"');
    expect(slideXml).toContain('name="tree-use-case.diagram.level.1.0"');
    expect(slideXml).toContain('name="tree-use-case.diagram.level.0.0.out-port"');
    expect(slideXml).toContain('name="tree-use-case.diagram.level.1.0.in-port"');
    const bodyXml = shapeXmlByName(slideXml, "tree-use-case.diagram.level.1.0.body");
    expect(bodyXml).not.toContain("normAutofit");
    expect(bodyXml).toContain('sz="820"');
  });

  it("renders configurable pyramid tiers with variable geometry and multi-element content", async () => {
    const source: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        themeOverride: {
          text: {
            "pyramid-tier-title": { fontSize: 11, weight: "medium" },
            "pyramid-tier-body": { fontSize: 8.4, weight: "regular" },
          },
        },
      },
      slides: [{
        id: "pyramid-style",
        layout: "blank",
        children: [{
          id: "pyramid-style.diagram",
          type: "pyramid",
          variant: "frameless",
          titleStyle: "pyramid-tier-title",
          bodyStyle: "pyramid-tier-body",
          titleAlign: "center",
          bodyAlign: "center",
          levelSurface: { fill: "surface.subtle", line: "none" },
          levels: [
            { label: "North Star", body: "Gross retention 94%", icon: "diamond", badge: "GOAL", tone: "brand", height: 1.12, widthRatio: 0.38 },
            {
              label: "Strategic pillars",
              body: "Three coordinated operating levers",
              contents: [
                { title: "Data fabric", content: "Unified metric layer", tone: "brand" },
                { title: "Workflow automation", content: "Route exceptions", tone: "positive" },
                { title: "Service rhythm", content: "Weekly review", tone: "warning", line: "none" },
              ],
              icon: "hexagon",
              badges: ["PILLARS"],
              tone: "positive",
              heightWeight: 1.35,
            },
            { label: "Execution base", items: ["Enablement", "Adoption", "Quarterly review"], icon: "trapezoid", badge: "OPS", tone: "warning", widthRatio: 0.86, fill: "surface.subtle", bodyAlign: "right" },
          ],
        } as DomNode],
      }],
    };

    clearRenderDiagnostics();
    const rendered = sourceToRenderedDeck(source);
    const ast = renderToAst(rendered);
    const diagnostics = getRenderDiagnostics();
    expect(blockingDiagnostics(diagnostics), formatDiagnostics(diagnostics)).toHaveLength(0);

    const expanded = expandComponent("pyramid-style", source.slides[0]!.children![0]! as DomNode, buildTheme(undefined, "default", source.deck.themeOverride));
    const top = requireNode(expanded, "pyramid-style.diagram.level.0");
    const middle = requireNode(expanded, "pyramid-style.diagram.level.1");
    const bottom = requireNode(expanded, "pyramid-style.diagram.level.2");
    expect(top.role).toBe("pyramid-level");
    expect(numberNodeProp(bottom, "fixedWidth")).toBeGreaterThan(numberNodeProp(top, "fixedWidth"));
    expect(numberNodeProp(top, "fixedHeight")).toBeGreaterThan(1.0);
    expect(numberNodeProp(middle, "fixedHeight")).toBeGreaterThan(0.9);
    expect(findNode(top, "pyramid-style.diagram.level.0.icon")).toBeTruthy();
    expect(findNode(top, "pyramid-style.diagram.level.0.metric")).toBeUndefined();
    expect(findNode(top, "pyramid-style.diagram.level.0.badge.0")).toBeTruthy();
    expect(findNode(middle, "pyramid-style.diagram.level.1.content.0")).toBeTruthy();
    expect(findNode(middle, "pyramid-style.diagram.level.1.content.0.title")).toBeTruthy();
    expect(findNode(middle, "pyramid-style.diagram.level.1.content.0.body")).toBeTruthy();
    expect(findNode(middle, "pyramid-style.diagram.level.1.content.2.bg")).toBeTruthy();
    expect(nodeX(requireNode(middle, "pyramid-style.diagram.level.1.icon")))
      .toBeGreaterThan(nodeX(requireNode(middle, "pyramid-style.diagram.level.1.content.0")));
    expect(nodeX(requireNode(middle, "pyramid-style.diagram.level.1.accent")))
      .toBeGreaterThan(nodeX(requireNode(middle, "pyramid-style.diagram.level.1.content.0")));
    expect(nodeX(requireNode(middle, "pyramid-style.diagram.level.1.icon")))
      .toBeGreaterThan(numberNodeProp(middle, "fixedWidth") * 0.18);
    expect(nodeX(requireNode(middle, "pyramid-style.diagram.level.1.title")))
      .toBeGreaterThan(numberNodeProp(middle, "fixedWidth") * 0.24);
    expect(numberNodeProp(requireNode(middle, "pyramid-style.diagram.level.1.content.1"), "fixedWidth"))
      .toBeGreaterThan(numberNodeProp(requireNode(middle, "pyramid-style.diagram.level.1.content.0"), "fixedWidth"));

    const shapeNames = allShapes(ast).map((shape) => shape.name || "");
    expect(shapeNames).toContain("pyramid-style.diagram.level.0.shape");
    expect(shapeNames).toContain("pyramid-style.diagram.level.0.icon");
    expect(shapeNames).not.toContain("pyramid-style.diagram.level.0.metric");
    expect(shapeNames).toContain("pyramid-style.diagram.level.0.badge.0");

    const out = join(mkdtempSync(join(tmpdir(), "slideml2-pyramid-style-")), "pyramid-style.pptx");
    await renderToPptx(rendered, out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain("<p:grpSp>");
    expect(slideXml).toContain('prst="trapezoid"');
    expect(slideXml).toContain('name="pyramid-style.diagram.level.0"');
    expect(slideXml).toContain('name="pyramid-style.diagram.level.0.badge.0"');
    expect(slideXml).toContain('name="pyramid-style.diagram.level.1.content.0"');
    expect(slideXml).toContain('name="pyramid-style.diagram.level.1.content.0.title"');
    expect(slideXml).toContain('name="pyramid-style.diagram.level.1.content.0.body"');
    expect(slideXml).toContain("Unified");
    expect(slideXml).toContain("metric");
    expect(slideXml).toContain("layer");
    expect(slideXml).toContain("Service");
    expect(slideXml).toContain("rhythm");
    expect(slideXml).toContain("Quarterly review");
    const titleXml = shapeXmlByName(slideXml, "pyramid-style.diagram.level.0.title");
    expect(titleXml).toContain('sz="1100"');
    expect(titleXml).toContain('algn="ctr"');
    const bodyXml = shapeXmlByName(slideXml, "pyramid-style.diagram.level.0.body");
    expect(bodyXml).toContain('sz="840"');
    expect(bodyXml).toContain('algn="ctr"');
    expect(bodyXml).not.toContain("normAutofit");
    const bottomBodyXml = shapeXmlByName(slideXml, "pyramid-style.diagram.level.2.body");
    expect(bottomBodyXml).toContain('algn="r"');
  });

  it("wraps narrow pyramid titles and avoids misleading more labels for one body line", () => {
    const source: Slideml2SourceDeck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "pyramid-narrow-text",
        layout: "blank",
        children: [{
          id: "pyramid-narrow-text.diagram",
          type: "pyramid",
          variant: "frameless",
          // Legacy overall shape fields are ignored so stale decks cannot create unreadably sharp tiers.
          topWidthRatio: 0.10,
          bottomWidthRatio: 1,
          levels: [
            { label: "直接访问 (40%)", body: "日均PV 2K-6K，回访为主", tone: "brand" },
            { label: "dict 词典笔 (30%)", body: "峰值PV近2万，增长杠杆", tone: "positive" },
            { label: "搜索 & 官网 (20%)", body: "baidu + 官网分支 + ynote 导流", tone: "warning" },
            { label: "长尾渠道 (10%)", body: "senchuang1、liantongyun1 等", tone: "neutral" },
          ],
        } as DomNode],
      }],
    };

    const expanded = expandComponent("pyramid-narrow-text", source.slides[0]!.children![0]! as DomNode);
    const topLevel = requireNode(expanded, "pyramid-narrow-text.diagram.level.0");
    const topTitle = requireNode(expanded, "pyramid-narrow-text.diagram.level.0.title");
    const topBody = requireNode(expanded, "pyramid-narrow-text.diagram.level.0.body");
    const titleText = nodeText(topTitle);
    const bodyText = nodeText(topBody);

    expect(titleText).toContain("直接访问");
    expect(titleText).toContain("(40%)");
    expect(titleText).not.toContain("...");
    expect(numberNodeProp(topLevel, "fixedWidth")).toBeGreaterThan(4.0);
    expect(topTitle.align).toBe("center");
    expect(bodyText).toContain("日均PV");
    expect(bodyText).toContain("2K-6K");
    expect(bodyText).toContain("回访为主");
    expect(bodyText).not.toContain("+1 more");
    expect(topBody.align).toBe("center");
    expect(topBody.valign).toBe("middle");
    expect(Number(topBody.at?.[0])).toBeCloseTo(Number(topTitle.at?.[0]), 4);
    expect(Number(topBody.at?.[2])).toBeCloseTo(Number(topTitle.at?.[2]), 4);
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
      slide("tree", "Capability taxonomy", "tree-chart", {
        title: "Capability taxonomy",
        detail: "full",
        nodes: [
          { id: "root", label: "Capability taxonomy", body: "Shared operating model", tone: "brand" },
          { id: "data", label: "Data", body: "Metrics, lineage, quality", parent: "root", tone: "brand" },
          { id: "workflow", label: "Workflow", body: "Approvals and task routing", parent: "root", tone: "positive" },
          { id: "governance", label: "Governance", body: "Policies and controls", parent: "root", tone: "warning" },
          { id: "metrics", label: "Metric registry", value: "Single KPI source", parent: "data", tone: "neutral" },
          { id: "alerts", label: "Exception alerts", value: "SLA breach routing", parent: "workflow", tone: "danger" },
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
  return diags.filter((diag) => diag.severity === "error" || (BLOCKING.has(diag.code) && diag.severity !== "info"));
}

function formatDiagnostics(diags: LayoutDiagnostic[]): string {
  return diags.map((diag) => `${diag.severity}:${diag.code}:${diag.nodeId || ""}:${diag.message}`).join("\n");
}

function allText(ast: ReturnType<typeof renderToAst>): string[] {
  const out: string[] = [];
  for (const slide of ast.slides) {
    for (const shape of allShapes({ ...ast, slides: [slide] })) {
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

function allShapes(ast: ReturnType<typeof renderToAst>): ReturnType<typeof renderToAst>["slides"][number]["shapes"] {
  const out: ReturnType<typeof renderToAst>["slides"][number]["shapes"] = [];
  const visit = (shapes: ReturnType<typeof renderToAst>["slides"][number]["shapes"]) => {
    for (const shape of shapes) {
      out.push(shape);
      if (shape.type === "group") visit(shape.children);
    }
  };
  for (const slide of ast.slides) visit(slide.shapes);
  return out;
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

function nodeX(node: DomNode): number {
  if (!Array.isArray(node.at) || node.at.length < 4) throw new Error(`Expected positioned node ${node.id}`);
  return Number(node.at[0]);
}

function nodeCenterX(node: DomNode): number {
  if (!Array.isArray(node.at) || node.at.length < 4) throw new Error(`Expected positioned node ${node.id}`);
  return Number(node.at[0]) + Number(node.at[2]) / 2;
}

function nodeText(node: DomNode): string {
  const parts: string[] = [];
  if (typeof node.text === "string") parts.push(node.text);
  const paragraphs = Array.isArray(node.paragraphs) ? node.paragraphs : [];
  for (const paragraph of paragraphs) {
    if (!paragraph || typeof paragraph !== "object") continue;
    const runs = Array.isArray((paragraph as { runs?: unknown }).runs) ? (paragraph as { runs: unknown[] }).runs : [];
    for (const run of runs) {
      if (run && typeof run === "object" && typeof (run as { text?: unknown }).text === "string") {
        parts.push((run as { text: string }).text);
      }
    }
  }
  return parts.join("\n");
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
