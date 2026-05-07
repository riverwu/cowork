import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function registryComponentNames(): string[] {
  const source = readFileSync(resolve(repoRoot, "slideml2/src/component-registry.ts"), "utf8");
  const block = source.match(/export type ComponentName =([\s\S]*?);/)?.[1] || "";
  return [...block.matchAll(/\| "([^"]+)"/g)].map((match) => match[1]).sort();
}

function skillDeclaredNames(): string[] {
  const skill = readFileSync(resolve(repoRoot, "src/catalog/skills/slideml2/SKILL.md"), "utf8");
  return [...skill.matchAll(/^- ([a-z0-9-]+):/gm)].map((match) => match[1]).sort();
}

function skillLineFor(componentName: string): string {
  const skill = readFileSync(resolve(repoRoot, "src/catalog/skills/slideml2/SKILL.md"), "utf8");
  return skill.split("\n").find((line) => line.startsWith(`- ${componentName}:`)) || "";
}

function firstJsonBlock(markdown: string): unknown {
  const raw = markdown.match(/```json\n([\s\S]*?)\n```/)?.[1];
  if (!raw) throw new Error("No JSON block found");
  return JSON.parse(raw);
}

describe("slideml2 SKILL component reference", () => {
  it("links the business research style reference for business deck tasks", () => {
    const skill = readFileSync(resolve(repoRoot, "src/catalog/skills/slideml2/SKILL.md"), "utf8");
    const businessPath = resolve(repoRoot, "src/catalog/skills/slideml2/business.md");
    const business = readFileSync(businessPath, "utf8");

    expect(existsSync(businessPath)).toBe(true);
    expect(skill).toContain("Business / research report decks");
    expect(skill).toContain("[business.md](business.md)");
    expect(skill).toContain("read [business.md](business.md) before planning");
    expect(business).toContain("executive-summary");
    expect(business).toContain("evidence-layout");
    expect(business).toContain("comparison-table");
    expect(business).toContain("themeOverride");
  });

  it("keeps the business themeOverride example to effective SlideML2 fields", () => {
    const business = readFileSync(resolve(repoRoot, "src/catalog/skills/slideml2/business.md"), "utf8");
    const theme = firstJsonBlock(business) as Record<string, Record<string, unknown>>;
    const allowedLayout = new Set(["slideWidthCm", "slideHeightCm", "pageMarginX", "titleTop", "titleHeight", "contentTop", "contentBottom", "defaultGap", "columnGap", "cardPadding"]);

    expect(theme.colors).toHaveProperty("divider");
    expect(theme.colors).not.toHaveProperty("line");
    expect(theme.layout).not.toHaveProperty("pageMarginY");
    expect(Object.keys(theme.layout || {})).toEqual(expect.arrayContaining(["pageMarginX", "titleTop", "titleHeight", "contentTop", "contentBottom", "defaultGap"]));
    expect(Object.keys(theme.layout || {}).filter((key) => !allowedLayout.has(key))).toEqual([]);
    expect(theme.fonts).toMatchObject({
      latin: { display: expect.any(Array), text: expect.any(Array) },
      cjk: { display: expect.any(Array), text: expect.any(Array) },
      mono: expect.any(Array),
    });
    expect(business).toContain("Font chains are preference order");
    expect(business).toContain("PPTX OOXML emits that first face");
    expect(business).toContain("SlideML2 does not embed fonts");
    expect(business).toContain("Business research decks are light-first");
  });

  it("declares every component exposed by component-registry", () => {
    const declared = new Set(skillDeclaredNames());
    const missing = registryComponentNames().filter((name) => !declared.has(name));

    expect(missing).toEqual([]);
  });

  it("documents the new flexible composition components with actionable fields", () => {
    const expectations: Record<string, string[]> = {
      "freeform-group": ["anchor", "offsetX", "offsetY", "zIndex", "mode:enum[overlay|background]", "children"],
      "cover-composition": ["visual:object", "heroStat:object", "tone:enum[neutral|inverse|brand]", "decor:enum[none|grid|shapes]"],
      "chapter-divider": ["chapter:string", "sections:array", "current:number", "tone:enum[brand|neutral|inverse]"],
      "hero-and-support": ["headline:string", "supports:array", "hero:object", "layout:enum[left|top]"],
      "chart-with-rail": ["evidence:object", "rail:object", "layout:enum[rail-right|rail-left|stacked]"],
      "snapshot-callouts": ["src:image-ref", "callouts:array", "layout:enum[rail-right|rail-left|below]"],
      "evidence-layout": ["evidence:object", "insight:object", "annotations:array", "layout:enum[sidecar|stacked]"],
      "factorial-matrix": ["rows:array", "columns:array", "cells:2D array"],
      "probe-flow": ["steps:array", "items:array alias", "direction:enum[horizontal|vertical]"],
      "failure-taxonomy": ["rate/value", "examples?/bullets?", "columns:number"],
      "main-effect-comparison": ["beforeLabel:string", "afterValue:string", "insight:string", "trend:enum[up|down|flat]"],
    };
    for (const [component, phrases] of Object.entries(expectations)) {
      const line = skillLineFor(component);
      expect(line, `${component} is missing from SKILL.md`).toBeTruthy();
      for (const phrase of phrases) {
        expect(line, `${component} SKILL entry must mention ${phrase}`).toContain(phrase);
      }
      expect(line, `${component} SKILL entry should include an example`).toContain("example=");
    }
  });

  it("documents rich callout instead of the legacy single-line-only shape", () => {
    const line = skillLineFor("callout");
    expect(line).toContain("rich text runs");
    expect(line).toContain("title:string");
    expect(line).toContain("body:string");
    expect(line).toContain("content:richTextRuns");
    expect(line).toContain("variant:enum[plain|card|banner]");
    expect(line).toContain("marks");
    expect(line).toContain("bold");
  });

  it("documents enhanced expressiveness fields on core components", () => {
    const expectations: Record<string, string[]> = {
      "metric-card": ["delta:string", "status:enum[brand|positive|warning|danger|neutral]", "sparkline:array", "variant:enum[plain|card|compact]", "surface:object"],
      "kpi-grid": ["delta/status/comparison/source/sparkline", "variant:enum[plain|card|compact]", "surface:object"],
      "comparison-card": ["content:richTextRuns", "metrics:array", "pros:array", "winner:boolean", "variant:enum[plain|card|compact]", "surface:object"],
      "process-flow": ["status?:enum[brand|positive|warning|danger|neutral]", "owner?:string", "variant:enum[plain|cards]", "surface:object"],
      "feature-card": ["content:richTextRuns", "metric:object", "tags:array", "variant:enum[plain|card|compact]", "surface:object"],
      "image-card": ["insight:string", "annotations:array", "variant:enum[card|frameless|compact]", "surface:object"],
      "chart-card": ["insight:string", "variant:enum[card|frameless|compact]", "surface:object"],
      "table-card": ["insight:string", "variant:enum[card|frameless|compact]", "surface:object"],
      "key-takeaway": ["content:richTextRuns", "bullets:array", "variant:enum[panel|banner|minimal]", "surface:object"],
    };
    for (const [component, phrases] of Object.entries(expectations)) {
      const line = skillLineFor(component);
      expect(line, `${component} is missing from SKILL.md`).toBeTruthy();
      for (const phrase of phrases) {
        expect(line, `${component} SKILL entry must mention ${phrase}`).toContain(phrase);
      }
    }
  });
});
