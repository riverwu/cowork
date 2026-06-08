import { describe, expect, it } from "vitest";
import { clearRenderDiagnostics, getRenderDiagnostics, type LayoutDiagnostic } from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { validateDeck } from "./validate.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

const BLOCKING_CODES: ReadonlySet<LayoutDiagnostic["code"]> = new Set<LayoutDiagnostic["code"]>([
  "FALLBACK_FAILED",
  "COLLISION",
  "TINY_RECT",
  "SQUASHED",
  "UNKNOWN_COLOR",
  "UNKNOWN_STYLE",
]);

function buildDeck(slide: SlideV2): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { name: "Test", primary: "2563EB" } },
    slides: [slide],
  };
}

function findByName(ast: ReturnType<typeof renderToAst>, name: string) {
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) {
      if ((shape as { name?: string }).name === name) return shape;
    }
  }
  return undefined;
}

function allShapeNames(ast: ReturnType<typeof renderToAst>): string[] {
  return ast.slides.flatMap((slide) => slide.shapes.map((shape) => String((shape as { name?: string }).name || "")));
}

function textOf(shape: ReturnType<typeof findByName>): string {
  if (!shape || shape.type !== "text") return "";
  return shape.paragraphs?.flatMap((p) => p.runs.map((r) => r.text)).join("") || "";
}

function renderSlide(slide: SlideV2) {
  clearRenderDiagnostics();
  const rendered = sourceToRenderedDeck(buildDeck(slide));
  const ast = renderToAst(rendered);
  const blocking = getRenderDiagnostics().filter((d) => BLOCKING_CODES.has(d.code));
  return { ast, blocking };
}

describe("comparison-list variants", () => {
  it("2 items with no tone / no recommended stays plain (backward-safe)", () => {
    const { ast, blocking } = renderSlide({
      id: "cl-plain",
      children: [{
        id: "cl-plain.c",
        type: "comparison-list",
        title: "Option weighing",
        basis: "cost vs flexibility",
        items: [
          { title: "Buy", body: "Higher upfront cost, full control of roadmap." },
          { title: "Lease", body: "Lower upfront, but recurring fees and vendor lock-in." },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(findByName(ast, "cl-plain.c.title")).toBeDefined();
    expect(findByName(ast, "cl-plain.c.basis")).toBeDefined();
    expect(findByName(ast, "cl-plain.c.rule")).toBeDefined();   // accent rule under header
    expect(findByName(ast, "cl-plain.c.1.title")).toBeDefined();
    expect(findByName(ast, "cl-plain.c.2.title")).toBeDefined();
    // Plain mode should NOT produce paired cards / connector / option rails.
    expect(findByName(ast, "cl-plain.c.connector")).toBeUndefined();
    expect(findByName(ast, "cl-plain.c.1.rail")).toBeUndefined();
    expect(findByName(ast, "cl-plain.c.1.bar")).toBeUndefined();
    // Column hairline should appear between cells by default.
    expect(findByName(ast, "cl-plain.c.hairline1")).toBeDefined();
  });

  it("plain renders meta line between title and body when item.meta is set", () => {
    const { ast, blocking } = renderSlide({
      id: "cl-meta",
      children: [{
        id: "cl-meta.c",
        type: "comparison-list",
        items: [
          { title: "Plan A", meta: "$50K · 2 weeks · low risk", body: "Direct migration on existing infra." },
          { title: "Plan B", meta: "$80K · 4 weeks · medium risk", body: "Rebuild with new orchestration layer." },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(textOf(findByName(ast, "cl-meta.c.1.meta"))).toContain("$50K");
    expect(textOf(findByName(ast, "cl-meta.c.2.meta"))).toContain("$80K");
  });

  it("dividers:false suppresses the column hairline in plain", () => {
    const { ast, blocking } = renderSlide({
      id: "cl-nodiv",
      children: [{
        id: "cl-nodiv.c",
        type: "comparison-list",
        dividers: false,
        items: [
          { title: "A", body: "first" },
          { title: "B", body: "second" },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(findByName(ast, "cl-nodiv.c.hairline1")).toBeUndefined();
  });

  it("variant:'subtle' wraps each option in surface.subtle cells and skips hairlines", () => {
    const { ast, blocking } = renderSlide({
      id: "cl-subtle",
      children: [{
        id: "cl-subtle.c",
        type: "comparison-list",
        variant: "subtle",
        items: [
          { title: "A", body: "first" },
          { title: "B", body: "second" },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    // Surface cards exist, but no inter-column hairline.
    expect(findByName(ast, "cl-subtle.c.hairline1")).toBeUndefined();
  });

  it("legacy variant:'columns' maps to plain", () => {
    const { ast, blocking } = renderSlide({
      id: "cl-cols",
      children: [{
        id: "cl-cols.c",
        type: "comparison-list",
        variant: "columns",
        items: [
          { title: "A", body: "first" },
          { title: "B", body: "second" },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    // Plain skeleton: titles exist, no paired bar / no option rail.
    expect(findByName(ast, "cl-cols.c.1.title")).toBeDefined();
    expect(findByName(ast, "cl-cols.c.1.bar")).toBeUndefined();
    expect(findByName(ast, "cl-cols.c.1.rail")).toBeUndefined();
  });

  it("2 items with recommended auto-promotes to paired (cards + connector)", () => {
    const { ast, blocking } = renderSlide({
      id: "cl-paired",
      children: [{
        id: "cl-paired.c",
        type: "comparison-list",
        items: [
          { title: "Keep current", body: "Familiar but accumulating risk.", tone: "warning" },
          { title: "Session reset", body: "Clean per-task state, keep stable knowledge.", recommended: true },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(findByName(ast, "cl-paired.c.1.bar")).toBeDefined();
    expect(findByName(ast, "cl-paired.c.2.bar")).toBeDefined();
    expect(findByName(ast, "cl-paired.c.connector")).toBeDefined();
    expect(textOf(findByName(ast, "cl-paired.c.1.badge"))).toContain("CURRENT");
    expect(textOf(findByName(ast, "cl-paired.c.2.badge"))).toContain("RECOMMENDED");
  });

  it("paired connector:'arrow' switches the middle marker shape", () => {
    const { ast, blocking } = renderSlide({
      id: "cl-paired-arrow",
      children: [{
        id: "cl-paired-arrow.c",
        type: "comparison-list",
        variant: "paired",
        connector: "arrow",
        items: [
          { title: "Old", body: "x", tone: "warning" },
          { title: "New", body: "y", recommended: true },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    const connector = findByName(ast, "cl-paired-arrow.c.connector");
    expect(connector).toBeDefined();
  });

  it("3+ items with recommended auto-promotes to options (row cards + BEST)", () => {
    const { ast, blocking } = renderSlide({
      id: "cl-options",
      children: [{
        id: "cl-options.c",
        type: "comparison-list",
        recommended: 2,
        items: [
          { title: "Option A", body: "Cheap, slow." },
          { title: "Option B", body: "Balanced." },
          { title: "Option C", body: "Expensive, fastest." },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(findByName(ast, "cl-options.c.1.rail")).toBeDefined();
    expect(findByName(ast, "cl-options.c.2.rail")).toBeDefined();
    expect(findByName(ast, "cl-options.c.3.rail")).toBeDefined();
    // Recommended is item 2 (1-based index → array[1]) → "Option B" gets BEST badge.
    expect(textOf(findByName(ast, "cl-options.c.2.badge"))).toContain("RECOMMENDED");
    // Non-recommended rows should not carry the recommended badge.
    expect(findByName(ast, "cl-options.c.1.badge")).toBeUndefined();
    expect(findByName(ast, "cl-options.c.3.badge")).toBeUndefined();
  });

  it("recommended by title string matches the right item", () => {
    const { ast, blocking } = renderSlide({
      id: "cl-rec-title",
      children: [{
        id: "cl-rec-title.c",
        type: "comparison-list",
        recommended: "Session reset",
        items: [
          { title: "Keep current", body: "x" },
          { title: "Session reset", body: "y" },
          { title: "Manual triage", body: "z" },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(textOf(findByName(ast, "cl-rec-title.c.2.badge"))).toContain("RECOMMENDED");
  });

  it("before/after label auto-promotes to before-after variant with locked badges", () => {
    const { ast, blocking } = renderSlide({
      id: "cl-ba",
      children: [{
        id: "cl-ba.c",
        type: "comparison-list",
        items: [
          { title: "42 min", body: "Median triage time pre-tool.", label: "before" },
          { title: "18 min", body: "Median triage time post-tool.", label: "after" },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(textOf(findByName(ast, "cl-ba.c.1.badge"))).toContain("BEFORE");
    expect(textOf(findByName(ast, "cl-ba.c.2.badge"))).toContain("AFTER");
    expect(findByName(ast, "cl-ba.c.connector")).toBeDefined();
  });

  it("before-after reorders items so before comes first regardless of input order", () => {
    const { ast, blocking } = renderSlide({
      id: "cl-ba-reorder",
      children: [{
        id: "cl-ba-reorder.c",
        type: "comparison-list",
        items: [
          { title: "AFTER state", body: "post", label: "after" },
          { title: "BEFORE state", body: "pre", label: "before" },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(textOf(findByName(ast, "cl-ba-reorder.c.1.title"))).toContain("BEFORE state");
    expect(textOf(findByName(ast, "cl-ba-reorder.c.2.title"))).toContain("AFTER state");
  });

  it("verdict line is rendered below the comparison body when set", () => {
    const { ast, blocking } = renderSlide({
      id: "cl-verdict",
      children: [{
        id: "cl-verdict.c",
        type: "comparison-list",
        verdict: "Pick session reset whenever the slide hands off across tasks.",
        items: [
          { title: "Keep", body: "x", tone: "warning" },
          { title: "Reset", body: "y", recommended: true },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(textOf(findByName(ast, "cl-verdict.c.verdict"))).toContain("session reset");
  });

  it("chips on a paired item render as small tags", () => {
    const { ast, blocking } = renderSlide({
      id: "cl-chips",
      children: [{
        id: "cl-chips.c",
        type: "comparison-list",
        items: [
          { title: "Old", body: "x", tone: "warning", chips: ["保留全部上下文", { text: "风格串扰", tone: "danger" }] },
          { title: "New", body: "y", recommended: true, chips: ["保留稳定知识", "清理任务锚点"] },
        ],
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(textOf(findByName(ast, "cl-chips.c.1.chips.1"))).toContain("保留全部上下文");
    expect(textOf(findByName(ast, "cl-chips.c.1.chips.2"))).toContain("风格串扰");
    expect(textOf(findByName(ast, "cl-chips.c.2.chips.1"))).toContain("保留稳定知识");
  });

  it("rejects unknown variant values with INVALID_FIELD_USAGE", () => {
    const deck = buildDeck({
      id: "cl-bad",
      children: [{
        id: "cl-bad.c",
        type: "comparison-list",
        variant: "splash" as unknown as string,
        items: [{ title: "a", body: "x" }],
      } as unknown as DomNode],
    });
    const report = validateDeck(deck);
    expect(report.errors.some((e) => e.code === "INVALID_FIELD_USAGE" && String(e.path || "").endsWith(".variant"))).toBe(true);
  });

  it("accepts numeric or string recommended without INVALID_FIELD_USAGE", () => {
    for (const value of [2, "2", "Option B"] as const) {
      const deck = buildDeck({
        id: `cl-rec-${typeof value}`,
        children: [{
          id: `cl-rec-${typeof value}.c`,
          type: "comparison-list",
          recommended: value,
          items: [
            { title: "Option A", body: "x" },
            { title: "Option B", body: "y" },
            { title: "Option C", body: "z" },
          ],
        } as unknown as DomNode],
      });
      const report = validateDeck(deck);
      expect(report.errors.filter((e) => e.code === "INVALID_FIELD_USAGE")).toEqual([]);
    }
  });

  it("registry expansion smoke: every variant is produced without diagnostics", () => {
    const variants: Array<{ id: string; node: DomNode }> = [
      { id: "v-plain", node: { id: "v-plain.c", type: "comparison-list", items: [{ title: "A", body: "a" }, { title: "B", body: "b" }] } as unknown as DomNode },
      { id: "v-subtle", node: { id: "v-subtle.c", type: "comparison-list", variant: "subtle", items: [{ title: "A", body: "a" }, { title: "B", body: "b" }] } as unknown as DomNode },
      { id: "v-paired", node: { id: "v-paired.c", type: "comparison-list", variant: "paired", items: [{ title: "A", body: "a", tone: "warning" }, { title: "B", body: "b", recommended: true }] } as unknown as DomNode },
      { id: "v-options", node: { id: "v-options.c", type: "comparison-list", variant: "options", recommended: 2, items: [{ title: "A", body: "a" }, { title: "B", body: "b" }, { title: "C", body: "c" }] } as unknown as DomNode },
      { id: "v-ba", node: { id: "v-ba.c", type: "comparison-list", variant: "before-after", items: [{ title: "Old", body: "x", label: "before" }, { title: "New", body: "y", label: "after" }] } as unknown as DomNode },
    ];
    for (const v of variants) {
      const { ast, blocking } = renderSlide({ id: v.id, children: [v.node] });
      expect(blocking, `${v.id}: ${blocking.map((d) => d.message).join("\n")}`).toEqual([]);
      // Every variant should produce at least one named shape.
      expect(allShapeNames(ast).length).toBeGreaterThan(0);
    }
  });
});
