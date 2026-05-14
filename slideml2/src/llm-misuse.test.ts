import { describe, expect, it } from "vitest";
import { validateSlide } from "./validate.js";
import type { SlideV2 } from "./types.js";

/**
 * Misuse fixtures distilled from a real authoring session (see
 * 2026-05-03 wuur34 debug log). For each, validate must return at LEAST one
 * error whose suggestedFix names the precise repair — generic "use a
 * documented type" messages don't count, because they sent the agent into
 * multi-turn guessing.
 */

const baseDeck = { deck: { size: "16x9" as const, theme: "default", brand: { primary: "2563EB" } } };

function findError(report: ReturnType<typeof validateSlide>, codeMatch: RegExp): { message: string; suggestedFix?: string } | undefined {
  return report.errors.find((issue) => codeMatch.test(issue.code));
}

function findIssue(report: ReturnType<typeof validateSlide>, codeMatch: RegExp): { message: string; suggestedFix?: string } | undefined {
  return [...report.errors, ...report.warnings, ...report.info].find((issue) => codeMatch.test(issue.code));
}

describe("validate flags common LLM misuses with actionable fixes", () => {
  it("type:'caption' (a style token) is normalized with the correct rewrite", () => {
    const slide: SlideV2 = {
      id: "misuse-caption",
      title: "标题",
      children: [{ id: "misuse-caption.body", type: "caption" as unknown as SlideV2["children"][number]["type"], text: "图注" }],
    };
    const report = validateSlide(slide, baseDeck);
    const hit = findIssue(report, /TEXT_STYLE_TYPE_ALIAS_NORMALIZED/);
    expect(hit, JSON.stringify([...report.errors, ...report.warnings, ...report.info])).toBeDefined();
    expect(`${hit!.message} ${hit!.suggestedFix || ""}`).toMatch(/type.*text.*style.*caption/i);
  });

  it("section-break.accent set to a token-shaped string flags INVALID_FIELD_USAGE", () => {
    const slide: SlideV2 = {
      id: "misuse-accent",
      children: [{ id: "misuse-accent.title", type: "section-break", title: "目录", accent: "brand.primary" }],
    };
    const report = validateSlide(slide, baseDeck);
    const hit = findError(report, /INVALID_FIELD_USAGE/);
    expect(hit, JSON.stringify(report.errors)).toBeDefined();
    expect(`${hit!.message} ${hit!.suggestedFix || ""}`).toMatch(/accent/i);
  });

  it("text node with raw hex color is allowed with a disambiguating warning", () => {
    const slide: SlideV2 = {
      id: "misuse-hex",
      title: "封面",
      children: [{ id: "misuse-hex.t", type: "text", text: "中华文明", color: "FFFFFF", style: "slide-title" }],
    };
    const report = validateSlide(slide, baseDeck);
    const hit = findIssue(report, /RAW_TEXT_HEX_COLOR/);
    expect(hit, JSON.stringify([...report.errors, ...report.warnings, ...report.info])).toBeDefined();
    expect(report.errors.find((issue) => issue.code === "RAW_TEXT_HEX_COLOR")).toBeUndefined();
    expect(`${hit!.message} ${hit!.suggestedFix || ""}`).toMatch(/theme token|one-off|#RRGGBB|bare RRGGBB/i);
  });

  it("image-card as the slide's only top-level child still validates and renders cleanly", () => {
    const slide: SlideV2 = {
      id: "misuse-image-card-top",
      title: "封面图",
      children: [{
        id: "misuse-image-card-top.cover",
        type: "image-card",
        src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiPjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiIGZpbGw9IiMyNTYzZWIiLz48L3N2Zz4=",
        alt: "封面",
        fit: "cover",
      }],
    };
    const report = validateSlide(slide, baseDeck);
    expect(report.errors, JSON.stringify(report.errors)).toHaveLength(0);
  });
});
