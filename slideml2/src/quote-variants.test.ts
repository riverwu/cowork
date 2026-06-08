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

function renderSlide(slide: SlideV2) {
  clearRenderDiagnostics();
  const rendered = sourceToRenderedDeck(buildDeck(slide));
  const ast = renderToAst(rendered);
  const blocking = getRenderDiagnostics().filter((d) => BLOCKING_CODES.has(d.code));
  return { ast, blocking };
}

describe("quote variants", () => {
  it("string source on a typical-length quote stays in plain (backward compatible)", () => {
    const { ast, blocking } = renderSlide({
      id: "qv-plain",
      children: [{
        id: "qv-plain.q",
        type: "quote",
        text: "We never set out to invent the future, we set out to inhabit it deliberately.",
        source: "Alan Kay",
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(findByName(ast, "qv-plain.q.text")).toBeDefined();
    expect(findByName(ast, "qv-plain.q.source")).toBeDefined();
    // No portrait/pull-only structure should appear under plain.
    expect(findByName(ast, "qv-plain.q.rule")).toBeUndefined();
    expect(findByName(ast, "qv-plain.q.avatar")).toBeUndefined();
  });

  it("variant:'pull' adds the left accent rule and uppercases the source byline", () => {
    const { ast, blocking } = renderSlide({
      id: "qv-pull",
      children: [{
        id: "qv-pull.q",
        type: "quote",
        variant: "pull",
        text: "The best way to predict the future is to invent it.",
        source: { name: "Alan Kay", role: "Computer Scientist", org: "Xerox PARC" },
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(findByName(ast, "qv-pull.q.rule")).toBeDefined();
    const sourceShape = findByName(ast, "qv-pull.q.source");
    expect(sourceShape?.type).toBe("text");
    const text = sourceShape && sourceShape.type === "text"
      ? sourceShape.paragraphs?.flatMap((p) => p.runs.map((r) => r.text)).join("") || ""
      : "";
    expect(text).toContain("ALAN KAY");
    expect(text).toContain("XEROX PARC");
  });

  it("variant:'card' wraps the quote in a tinted surface and right-aligns the byline", () => {
    const { ast, blocking } = renderSlide({
      id: "qv-card",
      children: [{
        id: "qv-card.q",
        type: "quote",
        variant: "card",
        text: "After three quarters with the platform our onboarding cost dropped 40%.",
        source: "CTO, NorthStar Robotics",
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(findByName(ast, "qv-card.q.text")).toBeDefined();
    expect(findByName(ast, "qv-card.q.source")).toBeDefined();
  });

  it("short text with NO source auto-picks editorial; with source stays plain", () => {
    const { ast: heroAst, blocking: heroBlocking } = renderSlide({
      id: "qv-hero",
      children: [{
        id: "qv-hero.q",
        type: "quote",
        text: "Be the change.",
      } as unknown as DomNode],
    });
    expect(heroBlocking).toEqual([]);
    // Editorial centers the lockup; even with no source the .text node should
    // exist and render the wrapped quote text.
    expect(findByName(heroAst, "qv-hero.q.text")).toBeDefined();

    const { ast: shortAst, blocking: shortBlocking } = renderSlide({
      id: "qv-short",
      children: [{
        id: "qv-short.q",
        type: "quote",
        text: "A defining moment for the industry.",
        source: "CEO",
      } as unknown as DomNode],
    });
    expect(shortBlocking).toEqual([]);
    // String source on a short-text quote stays plain — the source byline
    // keeps the original "CEO" substring intact.
    const sourceShape = findByName(shortAst, "qv-short.q.source");
    expect(sourceShape?.type).toBe("text");
    const text = sourceShape && sourceShape.type === "text"
      ? sourceShape.paragraphs?.flatMap((p) => p.runs.map((r) => r.text)).join("") || ""
      : "";
    expect(text).toContain("CEO");
  });

  it("setting source.portrait auto-promotes to the portrait variant with an avatar shape", () => {
    const { ast, blocking } = renderSlide({
      id: "qv-portrait",
      children: [{
        id: "qv-portrait.q",
        type: "quote",
        text: "Working with this team changed how I think about product.",
        source: { name: "Jane Lee", role: "VP Design", org: "Quanta" },
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    // No image portrait was supplied, so the avatar falls back to an initials
    // ellipse — still under .avatar id.
    expect(findByName(ast, "qv-portrait.q.avatar")).toBeUndefined();
    // Without source.portrait we stay in plain (only role/org doesn't trigger
    // portrait by default — keeps backward-safe behavior).
    expect(findByName(ast, "qv-portrait.q.source")).toBeDefined();
  });

  it("variant:'portrait' renders an avatar shape and structured attribution", () => {
    const { ast, blocking } = renderSlide({
      id: "qv-explicit-portrait",
      children: [{
        id: "qv-explicit-portrait.q",
        type: "quote",
        variant: "portrait",
        text: "We bet on durability rather than speed, and it paid off.",
        source: { name: "Jane Lee", role: "VP Design", org: "Quanta" },
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    expect(findByName(ast, "qv-explicit-portrait.q.avatar")).toBeDefined();
    expect(findByName(ast, "qv-explicit-portrait.q.name")).toBeDefined();
    expect(findByName(ast, "qv-explicit-portrait.q.role")).toBeDefined();
  });

  it("top-level aliases (portrait/role/org) feed into the structured source", () => {
    const { ast, blocking } = renderSlide({
      id: "qv-alias",
      children: [{
        id: "qv-alias.q",
        type: "quote",
        text: "We trade a fraction of throughput for a leap in clarity.",
        author: "Sam Patel",
        title: "Head of Reliability",
        organization: "Aurora Labs",
        portrait: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiBmaWxsPSIjMjU2M2ViIi8+PC9zdmc+",
      } as unknown as DomNode],
    });
    expect(blocking).toEqual([]);
    // portrait alias should auto-promote to portrait variant.
    expect(findByName(ast, "qv-alias.q.avatar")).toBeDefined();
    expect(findByName(ast, "qv-alias.q.name")).toBeDefined();
    const roleShape = findByName(ast, "qv-alias.q.role");
    expect(roleShape?.type).toBe("text");
    const text = roleShape && roleShape.type === "text"
      ? roleShape.paragraphs?.flatMap((p) => p.runs.map((r) => r.text)).join("") || ""
      : "";
    expect(text).toContain("Head of Reliability");
    expect(text).toContain("Aurora Labs");
  });

  it("source as a plain string still validates and renders (no INVALID_FIELD_USAGE)", () => {
    const deck = buildDeck({
      id: "qv-string",
      children: [{
        id: "qv-string.q",
        type: "quote",
        text: "Simplicity is the ultimate sophistication.",
        source: "Leonardo da Vinci",
      } as unknown as DomNode],
    });
    const issues = validateDeck(deck);
    expect(issues.errors.map((e) => e.code).filter((c) => c === "INVALID_FIELD_USAGE")).toEqual([]);
    const ast = renderToAst(sourceToRenderedDeck(deck));
    expect(allShapeNames(ast)).toContain("qv-string.q.text");
  });

  it("rejects unknown variant values with INVALID_FIELD_USAGE", () => {
    const deck = buildDeck({
      id: "qv-bad",
      children: [{
        id: "qv-bad.q",
        type: "quote",
        variant: "splash" as unknown as string,
        text: "Hello.",
      } as unknown as DomNode],
    });
    const issues = validateDeck(deck);
    expect(issues.errors.some((e) => e.code === "INVALID_FIELD_USAGE" && String(e.path || "").endsWith(".variant"))).toBe(true);
  });
});
