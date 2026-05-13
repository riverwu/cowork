import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const goldenSkillPath = resolve(repoRoot, "slideml2/SKILL.md");
const catalogSkillPath = resolve(repoRoot, "src/catalog/skills/slideml2/SKILL.md");
const skillRulePath = resolve(repoRoot, "slideml2/SKILL-RULE.md");
const oldSkillPath = resolve(repoRoot, "slideml2/SKILL-old.md");

function skillText(): string {
  return readFileSync(goldenSkillPath, "utf8");
}

function registryComponentNames(): string[] {
  const source = readFileSync(resolve(repoRoot, "slideml2/src/component-registry.ts"), "utf8");
  const block = source.match(/export type ComponentName =([\s\S]*?);/)?.[1] || "";
  return [...block.matchAll(/\| "([^"]+)"/g)].map((match) => match[1]).sort();
}

function skillDeclaredNames(): string[] {
  return [...skillText().matchAll(/^- `?([a-z0-9-]+)`?\s*(?:—|:)/gm)].map((match) => match[1]).sort();
}

function skillLineFor(componentName: string): string {
  return skillText().split("\n").find((line) => line.startsWith(`- \`${componentName}\``) || line.startsWith(`- ${componentName}:`)) || "";
}

function firstJsonBlock(markdown: string): unknown {
  const raw = markdown.match(/```json\n([\s\S]*?)\n```/)?.[1];
  if (!raw) throw new Error("No JSON block found");
  return JSON.parse(raw);
}

describe("slideml2 SKILL golden copy", () => {
  it("keeps slideml2/SKILL.md as the golden copy for the catalog skill", () => {
    expect(existsSync(goldenSkillPath)).toBe(true);
    expect(existsSync(catalogSkillPath)).toBe(true);
    expect(readFileSync(catalogSkillPath, "utf8")).toBe(readFileSync(goldenSkillPath, "utf8"));
    expect(existsSync(skillRulePath)).toBe(true);
    expect(existsSync(oldSkillPath)).toBe(true);
    expect(existsSync(resolve(repoRoot, "src/catalog/skills/slideml2/SKILL-RULE.md"))).toBe(false);
    expect(existsSync(resolve(repoRoot, "src/catalog/skills/slideml2/SKILL-new.md"))).toBe(false);
  });

  it("keeps discovery and the canonical CLI path visible at the top", () => {
    const skill = skillText();
    const first120 = skill.split("\n").slice(0, 120).join("\n");

    expect(skill).toContain("PowerPoint (.pptx)");
    expect(skill).toContain("presentation");
    expect(skill).toContain("幻灯片");
    expect(skill).toContain("演示文稿");
    expect(first120).toContain("## What This Skill Does");
    expect(first120).toContain("## When to Use This Skill");
    expect(first120).toContain("## When NOT to Use This Skill");
    expect(first120).toContain("## What You Produce");
    expect(first120).toContain('node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" <command> <path/to/args.json>');
    expect(first120).toContain("There are no flags, no stdin, no inline JSON");
  });

  it("documents compiler-style CLI result phases for agent repair", () => {
    const skill = skillText();

    expect(skill).toContain("CLI results are compiler-like");
    expect(skill).toContain("ok:false");
    expect(skill).toContain("phase:\"render-validation\"");
    expect(skill).toContain("deckModified");
    expect(skill).toContain("constrainedBy");
    expect(skill).toContain("Repair preference order");
    expect(skill).toContain("before changing component type");
    expect(skill).toContain("Never hand-edit `deck.json`");
    expect(skill).toContain("Never hand-edit `deck.json`. Never write the deck with `python-pptx`");
  });

  it("keeps the distributable skill package self-contained and sourced from the golden SKILL", () => {
    const packageScript = readFileSync(resolve(repoRoot, "scripts/package-slideml2-skill.ts"), "utf8");
    const syncScript = readFileSync(resolve(repoRoot, "scripts/sync-slideml2-skill.ts"), "utf8");
    const licensePath = resolve(repoRoot, "src/catalog/skills/slideml2/LICENSE.txt");
    const runtimeCliPath = resolve(repoRoot, "src/catalog/skills/slideml2/runtime/bin/slideml2.js");
    const runtimeIndexPath = resolve(repoRoot, "src/catalog/skills/slideml2/runtime/dist/index.js");

    expect(existsSync(licensePath)).toBe(true);
    expect(existsSync(runtimeCliPath)).toBe(true);
    expect(existsSync(runtimeIndexPath)).toBe(true);
    expect(existsSync(resolve(repoRoot, "src/catalog/skills/slideml2/runtime/node_modules"))).toBe(false);
    expect(packageScript).toContain("goldenSkillPath");
    expect(packageScript).toContain('file === "SKILL.md"');
    expect(packageScript).toContain("planning-template.md");
    expect(packageScript).toContain("runtimeSourceDir");
    expect(packageScript).toContain("requiredRuntimeFiles");
    expect(packageScript).toContain("runtime/bin/slideml2.js");
    expect(packageScript).toContain("runtime/dist/index.js");
    expect(packageScript).toContain("runtime-only");
    expect(packageScript).toContain("--bundle");
    expect(packageScript).toContain("entry.includes(\"/runtime/node_modules/\")");
    expect(packageScript).toContain("entry.includes(\"/runtime/src/\")");
    expect(packageScript).not.toContain('"runtime/src/index.ts"');
    expect(packageScript).toContain("create-deck create-deck.json");
    expect(packageScript).not.toContain("md2" + "pptx");
    expect(packageScript).not.toContain("render-source-deck");
    expect(syncScript).toContain("slideml2/SKILL.md");
    expect(syncScript).toContain("src/catalog/skills/slideml2/SKILL.md");
    expect(readFileSync(runtimeCliPath, "utf8")).toContain("create-deck");
    expect(readFileSync(runtimeCliPath, "utf8")).toContain("replace-slide");
    expect(readFileSync(runtimeCliPath, "utf8")).toContain("validate-render");
  });

  it("links and keeps the business research style reference available", () => {
    const skill = skillText();
    const businessPath = resolve(repoRoot, "src/catalog/skills/slideml2/business.md");
    const business = readFileSync(businessPath, "utf8");
    const theme = firstJsonBlock(business) as Record<string, Record<string, unknown>>;

    expect(existsSync(businessPath)).toBe(true);
    expect(skill).toContain("business.md");
    expect(business).toContain("executive-summary");
    expect(business).toContain("evidence-layout");
    expect(business).toContain("comparison-table");
    expect(theme.colors).toHaveProperty("divider");
    expect(theme.layout).not.toHaveProperty("pageMarginY");
    expect(theme.fonts).toMatchObject({
      latin: { display: expect.any(Array), text: expect.any(Array) },
      cjk: { display: expect.any(Array), text: expect.any(Array) },
      mono: expect.any(Array),
    });
  });

  it("declares every component exposed by component-registry", () => {
    const declared = new Set(skillDeclaredNames());
    const missing = registryComponentNames().filter((name) => !declared.has(name));

    expect(missing).toEqual([]);
  });

  it("documents key high-friction component fields and capacity guidance", () => {
    const expectations: Record<string, string[]> = {
      "chart-card": ["chartType:bar|stacked-bar|line|pie|doughnut|area|combo|scatter|waterfall", "bind+encoding", "dataLabels", "capacity="],
      "table-card": ["rows | data.rows | bind+encoding", "encoding.columns", "colWidths", "cellPadding", "capacity="],
      "process-flow": ["direction", "variant:plain|cards", "connector:arrow|chevron|line|none", "capacity="],
      "timeline": ["rich content >5 auto-flips vertical", "direction", "items"],
      "image-card": ["src:image-ref", "fit:cover|contain|fill", "annotations"],
      "equation": ["latex", "renderMode:omml", "capacity="],
      "code-block": ["density:compact|dense|tiny", "columns", "fontSize", "capacity="],
      "feature-card": ["iconSrc:image-ref", "marker", "metric", "surface"],
      "freeform-group": ["anchor/offsetX/offsetY/width/height/zIndex", "mode:overlay|background"],
      "shape": ["headEnd", "tailEnd", "thickness"],
    };
    for (const [component, phrases] of Object.entries(expectations)) {
      const line = skillLineFor(component);
      expect(line, `${component} is missing from SKILL.md`).toBeTruthy();
      for (const phrase of phrases) {
        expect(line, `${component} SKILL entry must mention ${phrase}`).toContain(phrase);
      }
    }
  });

  it("keeps page-job routing in the skill while avoiding raw text as a layout strategy", () => {
    const skill = skillText();

    expect(skill).toContain("## 4. Routing — Page Job → First Component");
    expect(skill).toContain("| Executive answer / final synthesis");
    expect(skill).toContain("`executive-summary`");
    expect(skill).toContain("Raw `text` is residual");
    expect(skill).toContain("look up 2–4 candidate components");
  });
});
