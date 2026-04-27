#!/usr/bin/env node
/**
 * Copy non-TypeScript theme assets (theme.json, theme.md, thumbnails/*,
 * assets/*) from src/themes/ to dist/themes/ after `tsc` builds the
 * layout/component/chrome modules.
 *
 * `tsc` only emits .js for .ts inputs; static files are our problem.
 */
import { cp, readdir, mkdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src", "themes");
const DST = join(ROOT, "dist", "themes");

const SKIP_EXTENSIONS = new Set([".ts", ".tsx", ".test.ts", ".d.ts.map"]);

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

let copied = 0;
for await (const file of walk(SRC)) {
  // Skip TypeScript source — `tsc` already emitted the .js versions.
  if (file.endsWith(".ts")) continue;
  const rel = relative(SRC, file);
  const target = join(DST, rel);
  await mkdir(dirname(target), { recursive: true });
  await cp(file, target);
  copied++;
}

try {
  await stat(DST);
  console.log(`copied ${copied} theme asset(s) to dist/themes/`);
} catch {
  console.log("no theme assets to copy");
}
