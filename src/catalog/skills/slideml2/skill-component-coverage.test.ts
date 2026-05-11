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
  it("keeps typography token policy aligned with the engineering spec", () => {
    const skill = readFileSync(resolve(repoRoot, "src/catalog/skills/slideml2/SKILL.md"), "utf8");
    const spec = readFileSync(resolve(repoRoot, "slideml2/SPEC.md"), "utf8");
    const guide = readFileSync(resolve(repoRoot, "SLIDEML.md"), "utf8");

    for (const doc of [skill, spec, guide]) {
      const lower = doc.toLowerCase();
      expect(lower).toContain("typography");
      expect(lower).toContain("token");
      expect(doc).toContain("timeline-body");
      expect(doc).toContain("caption");
      expect(doc).toContain("label");
    }
    expect(spec).toContain("COMPONENT_TEXT_STYLE_DERIVATIONS");
    expect(spec).toContain("Component factories MUST NOT set `fontSize`");
    expect(skill).toContain("Component-specific tokens such as `timeline-time`, `timeline-title`, and `timeline-body`");
    expect(skill).toContain("Do not use node-level `fontSize`, `lineHeight`, `fontFamily`, or `size` as routine component styling");
    expect(guide).toContain("Component rule");
  });

  it("links the business research style reference for business deck tasks", () => {
    const skill = readFileSync(resolve(repoRoot, "src/catalog/skills/slideml2/SKILL.md"), "utf8");
    const businessPath = resolve(repoRoot, "src/catalog/skills/slideml2/business.md");
    const business = readFileSync(businessPath, "utf8");

    expect(existsSync(businessPath)).toBe(true);
    expect(skill).toContain("Business / research report decks");
    expect(skill).toContain("[business.md](business.md)");
    expect(skill).toContain("read [business.md](business.md) before planning");
    expect(skill).toContain("business.md` must show `truncated:false");
    expect(business).toContain("executive-summary");
    expect(business).toContain("evidence-layout");
    expect(business).toContain("comparison-table");
    expect(business).toContain("themeOverride");
    expect(business).toContain("First-Read Non-Negotiables");
    expect(business).toContain("truncated:true");
  });

  it("keeps the distributable skill package self-contained", () => {
    const packageScript = readFileSync(resolve(repoRoot, "scripts/package-slideml2-skill.ts"), "utf8");
    const licensePath = resolve(repoRoot, "src/catalog/skills/slideml2/LICENSE.txt");
    const license = readFileSync(licensePath, "utf8");

    expect(existsSync(licensePath)).toBe(true);
    expect(packageScript).toContain('"SKILL.md", "business.md", "LICENSE.txt"');
    expect(packageScript).toContain("requiredRuntimeFiles");
    expect(packageScript).toContain("runtime/src/index.ts");
    expect(packageScript).toContain("runtime/tools/md2pptx/tools.ts");
    expect(packageScript).toContain("runtime/bin/slideml2.js");
    expect(packageScript).toContain("runtime/dist/index.js");
    expect(packageScript).toContain("runtime/node_modules/jszip/package.json");
    expect(packageScript).toContain("node bin/slideml2.js create-deck");
    expect(packageScript).toContain("manifest.json");
    expect(packageScript).toContain("README.md");
    expect(packageScript).toContain("zipinfo");
    expect(license).toContain("agent-native tools");
    expect(license).toContain("runtime source/build artifacts");
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

  it("keeps decision guidance near the top so skill compression does not erase component choice", () => {
    const skill = readFileSync(resolve(repoRoot, "src/catalog/skills/slideml2/SKILL.md"), "utf8");
    const business = readFileSync(resolve(repoRoot, "src/catalog/skills/slideml2/business.md"), "utf8");

    expect(skill.indexOf("## Deck Structure — Earn Every Slide")).toBeGreaterThan(skill.indexOf("## Authoring Workflow"));
    expect(skill.indexOf("## Deck Structure — Earn Every Slide")).toBeLessThan(skill.indexOf("## Theme Contract — Define Before Components"));
    expect(skill.indexOf("## Theme Contract — Define Before Components")).toBeLessThan(skill.indexOf("## Component-First Slide Loop"));
    expect(skill.indexOf("## Deck Planning Archive")).toBeLessThan(skill.indexOf("## Deck Structure — Earn Every Slide"));
    expect(skill).toContain("Save a markdown file next to the future deck");
    expect(skill).toContain("create it with `write_file`");
    expect(skill).toContain("`## Asset Plan`");
    expect(skill).toContain("For generated icons, `Asset Plan` must map icon names to actual component fields");
    expect(skill).toContain("timeline.items[].iconSrc");
    expect(skill).toContain("`contentTop` and `contentBottom` are y-coordinates");
    expect(skill).toContain("Use `cornerRadius`, never `radius`");
    expect(skill).toContain("Do not use `position` as a placement field");
    expect(skill.indexOf("## Component-First Slide Loop")).toBeLessThan(skill.indexOf("## Layout Containers"));
    expect(skill).toContain("Do not start from `text` boxes and coordinates");
    expect(skill).toContain("| Executive answer / final synthesis | `executive-summary`");
    expect(skill).toContain("Raw `text` is a residual primitive");
    expect(skill).toContain("Common anti-pattern");
    expect(skill).toContain("## Layout Escape Hatches — `at`, `layer`, `anchorTo`");
    expect(skill).toContain("escape hatch, not free-fall");
    expect(skillLineFor("grid")).toContain("avoid plain equal cards");
    expect(skillLineFor("chart-with-rail")).toContain("Page archetype");

    expect(business.indexOf("## Business Planning Loop")).toBeLessThan(business.indexOf("## Story Structure"));
    expect(business.indexOf("light-first")).toBeLessThan(1200);
    expect(business.indexOf("Do not make a full business report dark by default")).toBeLessThan(1800);
    expect(business.indexOf("Component route comes before JSON")).toBeLessThan(1800);
    expect(business).toContain("Save a complete `deck_plan.md` before `create_deck`");
    expect(business).toContain("`Asset Route`");
    expect(business).toContain("| Executive answer | `executive-summary`");
    expect(business).toContain("not the default container for business prose");
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
      "process-flow": ["status?:enum[brand|positive|warning|danger|neutral]", "owner?:string", "iconSrc?:image-ref", "marker:enum[auto|number|dot|icon|none]", "connector:enum[arrow|chevron|line|none]", "spread:enum[compact|balanced|fill]", "stepSurface:object", "variant:enum[plain|cards]", "surface:object"],
      "feature-card": ["content:richTextRuns", "metric:object", "tags:array", "variant:enum[plain|card|compact]", "surface:object"],
      "image-card": ["insight:string", "annotations:array", "variant:enum[card|frameless|compact]", "surface:object"],
      "chart-card": ["insight:string", "variant:enum[card|frameless|compact]", "surface:object"],
      "table-card": ["insight:string", "variant:enum[card|frameless|compact]", "surface:object"],
      "key-takeaway": ["content:richTextRuns", "bullets:array", "variant:enum[panel|banner|minimal]", "surface:object"],
      "explanation-block": ["content:richTextRuns", "bullets/items:array", "variant:enum[plain|minimal|rail|panel]", "surface:object"],
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
