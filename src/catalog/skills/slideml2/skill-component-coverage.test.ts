import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const goldenSkillPath = resolve(repoRoot, "slideml2/SKILL.md");
const catalogSkillPath = resolve(repoRoot, "src/catalog/skills/slideml2/SKILL.md");
const skillRulePath = resolve(repoRoot, "slideml2/SKILL-RULE.md");
const oldSkillPath = resolve(repoRoot, "slideml2/SKILL-old.md");
const planningTemplatePath = resolve(repoRoot, "slideml2/planning-template.md");

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
    expect(first120).toContain('node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" <command> [args] [--deck deck-config.json]');
    expect(first120).toContain("Use `help` whenever uncertain");
  });

  it("documents compiler-style CLI result phases for agent repair", () => {
    const skill = skillText();

    expect(skill).toContain("CLI results are compiler-like");
    expect(skill).toContain("ok:false");
    expect(skill).toContain('status:"render-error"');
    expect(skill).toContain("deckModified");
    expect(skill).toContain("constrainedBy");
    expect(skill).toContain("Repair preference order");
    expect(skill).toContain("not merely");
    expect(skill).toContain("manifest.json");
    expect(skill).toContain("The CLI reads only `manifest.slides[].file`");
    expect(skill).toContain("### File Roles");
    expect(skill).toContain("`deck-config.json`");
    expect(skill).toContain("`build/deck.json`");
    expect(skill).toContain("### Validation Scope");
    expect(skill).toContain("### Serial Slide Gate");
    expect(skill).toContain("### Never Do This");
    expect(skill).toContain("Do not batch in create or modify mode");
    expect(skill).toContain("Do not generate all new slide files or edit several existing slides");
    expect(skill).toContain("Do not batch `validate-slide`");
    expect(skill).toContain("node validate-all-slides.js");
    expect(skill).toContain("### Planning Archive");
    expect(skill).toContain("fill `plan.md` from `planning-template.md` before");
    expect(skill).toContain("Do not hand-edit `build/deck.json`");
    expect(skill).toContain("Do not write the deck with `python-pptx`");
    const planningTemplate = readFileSync(planningTemplatePath, "utf8");
    expect(planningTemplate).toContain("This file must exist before `init-deck`");
    expect(planningTemplate).toContain("| Slide ID | Family | Title | Narrative job | Archetype | Primary component | Layout intent | Density risk |");
    expect(planningTemplate).toContain("## Coverage Check");
    expect(planningTemplate).toContain("Plan a small icon set early");
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
    expect(packageScript).toContain("init-deck deck-init.json");
    expect(packageScript).not.toContain("md2" + "pptx");
    expect(packageScript).not.toContain("render-source-deck");
    expect(syncScript).toContain("slideml2/SKILL.md");
    expect(syncScript).toContain("src/catalog/skills/slideml2/SKILL.md");
    expect(readFileSync(runtimeCliPath, "utf8")).toContain("init-deck");
    expect(readFileSync(runtimeCliPath, "utf8")).toContain("set-deck");
    expect(readFileSync(runtimeCliPath, "utf8")).toContain("validate-slide");
    expect(readFileSync(runtimeCliPath, "utf8")).toContain("validate-manifest");
    expect(readFileSync(runtimeCliPath, "utf8")).toContain("compose");
    expect(readFileSync(runtimeCliPath, "utf8")).not.toContain("\"add-slide\"");
    expect(readFileSync(runtimeCliPath, "utf8")).not.toContain("\"insert-slide\"");
    expect(readFileSync(runtimeCliPath, "utf8")).not.toContain("\"delete-slide\"");
  });

  it("supports the manifest-compose CLI without stateful slide append commands", () => {
    const runtimeCliPath = resolve(repoRoot, "src/catalog/skills/slideml2/runtime/bin/slideml2.js");
    const dir = resolve(tmpdir(), `slideml2-compose-${Date.now()}`);
    mkdirSync(join(dir, "slides"), { recursive: true });
    mkdirSync(join(dir, "build"), { recursive: true });
    const writeJson = (path: string, value: unknown) => writeFileSync(join(dir, path), JSON.stringify(value, null, 2));
    const run = (args: string[], expectedStatus = 0) => {
      const result = spawnSync(process.execPath, [runtimeCliPath, ...args], { cwd: dir, encoding: "utf8" });
      expect(result.status, `${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(expectedStatus);
      return JSON.parse(result.stdout) as Record<string, unknown>;
    };

    writeJson("deck-init.json", { title: "Compose CLI", size: "wide" });
    run(["init-deck", "deck-init.json"]);
    writeJson("slides/02-body.json", { id: "body", children: [{ id: "body.copy", type: "text", x: 1, y: 1, w: 8, h: 1, text: "Body" }] });
    writeJson("slides/01-cover.json", { id: "cover", children: [{ id: "cover.copy", type: "text", x: 1, y: 1, w: 8, h: 1, text: "Cover" }] });
    writeJson("manifest.json", { slides: [{ id: "cover", file: "slides/01-cover.json" }, { id: "body", file: "slides/02-body.json" }] });

    run(["validate-slide", "slides/01-cover.json"]);
    run(["validate-slide", "slides/02-body.json"]);
    run(["validate-manifest", "manifest.json"]);
    const composed = run(["compose", "manifest.json", "--write-source", "build/deck.json", "--out", "build/deck.pptx"]);
    expect(composed.ok).toBe(true);
    const source = JSON.parse(readFileSync(join(dir, "build/deck.json"), "utf8")) as { slides: Array<{ id: string }> };
    expect(source.slides.map((slide) => slide.id)).toEqual(["cover", "body"]);
    expect(existsSync(join(dir, "build/deck.pptx"))).toBe(true);
  });

  it("keeps deck-level layout guidance in SKILL instead of a side business file", () => {
    const skill = skillText();
    const businessPath = resolve(repoRoot, "src/catalog/skills/slideml2/business.md");

    expect(existsSync(businessPath)).toBe(false);
    expect(skill).not.toContain("also read `business.md`");
    expect(skill).toContain("### 2.1 Slide Family Map");
    expect(skill).toContain("### 2.2 Compositional Archetypes");
    expect(skill).toContain("### 2.4 Deck-Level Antipatterns");
    expect(skill).toContain("Business/research decks default to light analytical themes");
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
      "feature-card": ["decoration", "metric", "surface"],
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

    expect(skill).toContain("### 2.1 Slide Family Map");
    expect(skill).toContain("### 2.2 Compositional Archetypes");
    expect(skill).toContain("Picking an archetype first");
    expect(skill).toContain("## 4. Routing — Page Job → First Component");
    expect(skill).toContain("Use this table only after deciding slide family");
    expect(skill).toContain("| Executive answer / final synthesis");
    expect(skill).toContain("`executive-summary`");
    expect(skill).toContain("Raw `text` is residual");
    expect(skill).toContain("look up 2–4 candidate components");
  });
});
