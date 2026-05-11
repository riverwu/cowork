import { describe, expect, it } from "vitest";
import { normalizeToneAlias } from "./component-registry.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { validateDeck } from "./validate.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * qtt7dd log slide 4: agent wrote
 *   { value: "78%", label: "学业压力", tone: "success" }
 *   { value: "65%", label: "说谎行为", tone: "warning" }
 *   { value: "43%", label: "压力-说谎", tone: "danger"  }
 * intending green / orange / red. The 65% and 43% items rendered
 * correctly, but 78% rendered as brand.primary because "success" wasn't
 * in the stat-strip allowed-tone set — only "positive" was. Agents
 * naturally reach for the theme-token names (success/error/caution)
 * since those mirror theme.colors.success etc., so the alias must work.
 */

function deck(slide: SlideV2): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
    slides: [slide],
  };
}

function valueColor(ast: { slides: Array<{ shapes: Array<{ name?: string }> }> }, suffix: string): string | undefined {
  const shape = ast.slides[0].shapes.find((s) => typeof s.name === "string" && s.name.endsWith(suffix)) as
    | { paragraphs?: Array<{ runs: Array<{ color?: string }> }> } | undefined;
  return shape?.paragraphs?.[0]?.runs[0]?.color?.toUpperCase();
}

describe("tone-alias normalization", () => {
  it("normalizeToneAlias maps theme-token names to canonical tones", () => {
    expect(normalizeToneAlias("success")).toBe("positive");
    expect(normalizeToneAlias("error")).toBe("danger");
    expect(normalizeToneAlias("caution")).toBe("warning");
    expect(normalizeToneAlias("info")).toBe("brand");
    expect(normalizeToneAlias("muted")).toBe("neutral");
  });

  it("normalizeToneAlias is case-insensitive and trims whitespace", () => {
    expect(normalizeToneAlias("  Success ")).toBe("positive");
    expect(normalizeToneAlias("DANGER")).toBe("danger");
  });

  it("non-string and unknown tones return as-is or undefined", () => {
    expect(normalizeToneAlias(undefined)).toBeUndefined();
    expect(normalizeToneAlias(null)).toBeUndefined();
    expect(normalizeToneAlias(42)).toBeUndefined();
    // unknown strings pass through (caller filters)
    expect(normalizeToneAlias("rainbow")).toBe("rainbow");
  });
});

describe("stat-strip qtt7dd regression: tone='success'/'warning'/'danger'", () => {
  it("78%/65%/43% values render in success/warning/danger colors as the agent intended", () => {
    const slide: SlideV2 = {
      id: "bg-detail",
      title: "研究背景",
      children: [{
        id: "bg.kpi",
        type: "stat-strip",
        items: [
          { value: "78%", label: "学业压力",   tone: "success" },
          { value: "65%", label: "说谎行为",   tone: "warning" },
          { value: "43%", label: "压力-说谎", tone: "danger"  },
        ],
      } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    // Default theme: success=0E7C3A, warning=B45309, danger=B42318.
    expect(valueColor(ast, "bg.kpi.0.value")).toBe("0E7C3A");
    expect(valueColor(ast, "bg.kpi.1.value")).toBe("B45309");
    expect(valueColor(ast, "bg.kpi.2.value")).toBe("B42318");
  });

  it("'error' is accepted as a synonym for 'danger'", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.k",
        type: "stat-strip",
        items: [{ value: "1", label: "a", tone: "error" }],
      } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    expect(valueColor(ast, "s.k.0.value")).toBe("B42318");
  });

  it("'caution' is accepted as a synonym for 'warning'", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.k",
        type: "stat-strip",
        items: [{ value: "1", label: "a", tone: "caution" }],
      } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    expect(valueColor(ast, "s.k.0.value")).toBe("B45309");
  });
});

describe("takeaway-list also accepts theme-token tone aliases", () => {
  it("tone='success' on a takeaway item produces the success accent bar", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.t",
        type: "takeaway-list",
        items: [{ headline: "A", tone: "success" }],
      } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const bar = ast.slides[0].shapes.find((s) => typeof s.name === "string" && s.name.endsWith("s.t.0.bar")) as
      | { fill?: { color?: string } } | undefined;
    expect(bar?.fill?.color?.toUpperCase()).toBe("0E7C3A");
  });
});

describe("component schema accepts tone aliases agents naturally use", () => {
  it("feature-card tone='success' validates and renders as positive", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.feature",
        type: "feature-card",
        title: "AI 硬件",
        body: "收入恢复增长",
        tone: "success",
      } as never],
    };
    const report = validateDeck(deck(slide));
    expect(report.errors, report.errors.map((e) => e.message).join("\n")).toHaveLength(0);
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    const title = ast.slides[0].shapes.find((s) => s.name === "s.feature.title") as
      | { paragraphs?: Array<{ runs: Array<{ color?: string }> }> } | undefined;
    expect(title?.paragraphs?.[0]?.runs[0]?.color?.toUpperCase()).toBe("0E7C3A");
  });

  it("callout tone='info' and variant='panel' validate and render as a card callout", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.callout",
        type: "callout",
        text: "关键提示",
        tone: "info",
        variant: "panel",
      } as never],
    };
    const report = validateDeck(deck(slide));
    expect(report.errors, report.errors.map((e) => e.message).join("\n")).toHaveLength(0);
    const ast = renderToAst(sourceToRenderedDeck(deck(slide)));
    expect(ast.slides[0].shapes.some((s) => s.name === "s.callout-background")).toBe(true);
  });
});
