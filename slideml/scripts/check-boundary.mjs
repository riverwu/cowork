#!/usr/bin/env node
/**
 * Enforce slideml's independence boundary.
 *
 * slideml lives in this repo for development convenience but is shipped as
 * an independent component. It MUST NOT import anything from the parent
 * project (cowork). This check is wired into CI.
 *
 * Forbidden:
 *   - `from "@/..."`          — cowork's path alias
 *   - `from "cowork/..."`     — direct package reference
 *   - `from "../..."` resolving to a path OUTSIDE slideml/src/
 *
 * Allowed:
 *   - Any import that resolves within slideml/src/ (including deep `../../..`
 *     for files like `src/themes/<name>/layouts/cover.ts` reaching back to
 *     `src/render/`).
 *
 * Exits non-zero if any violation is found.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SLIDEML_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_ROOT = resolve(SLIDEML_ROOT, "src");

const ALIAS_PATTERNS = [
  { regex: /from\s+["']@\//, label: "cowork path alias `@/...`" },
  { regex: /from\s+["']cowork(\/|["'])/, label: "direct cowork package import" },
  { regex: /require\(\s*["']@\//, label: "CommonJS cowork path alias `@/...`" },
];

const RELATIVE_IMPORT_PATTERN = /from\s+["'](\.\.?\/[^"']+)["']/g;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      yield* walk(full);
    } else if (s.isFile() && /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry)) {
      yield full;
    }
  }
}

let violations = 0;

for (const file of walk(SRC_ROOT)) {
  const content = readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  const fileDir = dirname(file);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    for (const { regex, label } of ALIAS_PATTERNS) {
      if (regex.test(line)) {
        violations++;
        console.error(`${relative(SLIDEML_ROOT, file)}:${i + 1}: forbidden import (${label})`);
        console.error(`  ${line.trim()}`);
      }
    }

    let m;
    RELATIVE_IMPORT_PATTERN.lastIndex = 0;
    while ((m = RELATIVE_IMPORT_PATTERN.exec(line)) !== null) {
      const importPath = m[1];
      const resolved = resolve(fileDir, importPath);
      if (!resolved.startsWith(SRC_ROOT)) {
        violations++;
        console.error(
          `${relative(SLIDEML_ROOT, file)}:${i + 1}: forbidden import (resolves outside slideml/src/)`,
        );
        console.error(`  resolved: ${resolved}`);
        console.error(`  ${line.trim()}`);
      }
    }
  }
}

if (violations > 0) {
  console.error(`\nslideml boundary check failed: ${violations} forbidden import(s) found.`);
  console.error("slideml is an independent component and cannot import from the parent project.");
  process.exit(1);
}

console.log("slideml boundary check passed.");
