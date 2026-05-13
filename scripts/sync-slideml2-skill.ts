#!/usr/bin/env npx tsx
import { copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const golden = resolve(repoRoot, "slideml2/SKILL.md");
const catalog = resolve(repoRoot, "src/catalog/skills/slideml2/SKILL.md");
const goldenPlanningTemplate = resolve(repoRoot, "slideml2/planning-template.md");
const catalogPlanningTemplate = resolve(repoRoot, "src/catalog/skills/slideml2/planning-template.md");

await copyFile(golden, catalog);
console.log(`Synced ${catalog} from ${golden}`);
await copyFile(goldenPlanningTemplate, catalogPlanningTemplate);
console.log(`Synced ${catalogPlanningTemplate} from ${goldenPlanningTemplate}`);
