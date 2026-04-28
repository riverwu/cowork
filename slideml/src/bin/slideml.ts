#!/usr/bin/env node
/**
 * slideml CLI.
 *
 *   slideml compile <deck.yaml> --theme <name|path> [-o <out.pptx>]
 *   slideml validate <deck.yaml> --theme <name|path>
 *   slideml layouts --theme <name|path>
 *
 * Theme resolution:
 *   - If `--theme` is a directory path that exists → use it.
 *   - Else if it matches a built-in theme name → use the bundled one.
 *   - Else → error.
 */

import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compile,
  validateDeck,
  loadTheme,
  listLayouts,
  summarizeLayouts,
  describeLayout,
  editDeck,
  auditPptx,
  listInstalledThemes,
  describeInstalledTheme,
  buildSlidemlSchema,
  type EditOp,
  SlidemlAggregateError,
} from "../index.js";
import { writeFile } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HELP = `slideml — compile SlideML decks to .pptx

usage:
  slideml compile  <deck.yaml> --theme <name|path> [-o <out.pptx>] [--no-sidecar]
  slideml validate <deck.yaml> --theme <name|path>
  slideml layouts  --theme <name|path> [--full] [--json]
  slideml describe <layout-name> --theme <name|path> [--json]
  slideml edit     <sidecar.slideml> --ops <ops.json> --theme <name|path> -o <out.pptx>
  slideml audit    <deck.pptx> [--json]
  slideml themes   [--json]
  slideml describe-theme <name> [--json]
  slideml schema   [-o <out.json>]

themes:
  built-in: technical-blue
  or a path to a theme package directory.

notes:
  - \`compile\` writes a sidecar \`<out.pptx>.slideml\` next to the .pptx
    so later edits can mutate the source. Pass --no-sidecar to disable.
  - \`layouts\` returns compact summaries (name + purpose + slot names);
    use --full for the complete schema.
  - \`describe <name>\` returns the full schema with example payloads
    for typed slots (chart-spec/table/image-ref/bullets).
  - \`edit\` applies a JSON ops array to a sidecar and recompiles.
    Ops:
      { "kind": "set", "path": "slides[3].slots.title", "value": "..." }
      { "kind": "delete", "path": "slides[2].notes" }
      { "kind": "insertSlide", "at": 4, "slide": { "layout": "...", "slots": {...} } }
      { "kind": "deleteSlide", "at": 3 }
      { "kind": "moveSlide", "from": 4, "to": 1 }
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "-h" || cmd === "--help") {
    process.stdout.write(HELP);
    return;
  }

  const opts = parseFlags(argv.slice(1));

  if (cmd === "compile") {
    const input = opts.positional[0];
    if (!input) fail("compile: missing input file. Usage: slideml compile <deck.yaml> --theme <name|path> [-o <out.pptx>]");
    const themeDir = resolveTheme(opts.flags["theme"]);
    const yaml = await readFile(resolve(input!), "utf8");
    const out = opts.flags["o"] ?? opts.flags["output"];
    const writeSidecar = opts.flags["no-sidecar"] !== "true";
    try {
      const result = await compile(yaml, {
        themeDir,
        output: out ? resolve(out) : undefined,
        writeSidecar,
      });
      if (result.written) {
        process.stdout.write(`Wrote ${result.buffer.length} bytes to ${result.written}\n`);
        if (result.sidecar) {
          process.stdout.write(`Sidecar: ${result.sidecar}\n`);
        }
      } else {
        // No -o given: write the buffer to stdout.
        process.stdout.write(result.buffer as unknown as Uint8Array);
      }
    } catch (err) {
      if (err instanceof SlidemlAggregateError) {
        process.stderr.write(`Validation failed:\n`);
        for (const e of err.errors) {
          process.stderr.write(`  - [${e.code}] ${e.message}\n`);
          if (e.hint) process.stderr.write(`    hint: ${e.hint}\n`);
        }
        process.exit(2);
      }
      throw err;
    }
    return;
  }

  if (cmd === "validate") {
    const input = opts.positional[0];
    if (!input) fail("validate: missing input file.");
    const themeDir = resolveTheme(opts.flags["theme"]);
    const yaml = await readFile(resolve(input!), "utf8");
    const result = await validateDeck(yaml, { themeDir });
    if (result.ok) {
      process.stdout.write("OK\n");
    } else {
      process.stderr.write(`Validation failed:\n`);
      for (const e of result.errors) {
        process.stderr.write(`  - [${e.code}] ${e.message}\n`);
        if (e.hint) process.stderr.write(`    hint: ${e.hint}\n`);
      }
      process.exit(2);
    }
    return;
  }

  if (cmd === "layouts") {
    const themeDir = resolveTheme(opts.flags["theme"]);
    const theme = await loadTheme(themeDir);
    const full = opts.flags["full"] === "true";
    const json = opts.flags["json"] === "true";
    if (full) {
      const layouts = listLayouts(theme);
      if (json) process.stdout.write(JSON.stringify(layouts, null, 2) + "\n");
      else {
        for (const l of layouts) {
          process.stdout.write(`${l.name.padEnd(28)} ${l.description}\n`);
        }
      }
    } else {
      const summaries = summarizeLayouts(theme);
      if (json) process.stdout.write(JSON.stringify(summaries, null, 2) + "\n");
      else {
        for (const s of summaries) {
          const slots = [...s.requiredSlots, ...s.optionalSlots.map((n) => `${n}?`)].join(", ");
          process.stdout.write(`${s.name.padEnd(28)} ${s.purpose}\n`);
          process.stdout.write(`${" ".repeat(28)} slots: ${slots}\n`);
        }
      }
    }
    return;
  }

  if (cmd === "describe") {
    const layoutName = opts.positional[0];
    if (!layoutName) fail("describe: missing layout name. Usage: slideml describe <layout-name> --theme <name|path>");
    const themeDir = resolveTheme(opts.flags["theme"]);
    const theme = await loadTheme(themeDir);
    const detail = describeLayout(theme, layoutName!);
    if (!detail) {
      const available = [...theme.layouts.keys()].join(", ");
      fail(`Layout "${layoutName}" not found. Available: ${available}`);
    }
    if (opts.flags["json"] === "true") {
      process.stdout.write(JSON.stringify(detail, null, 2) + "\n");
    } else {
      process.stdout.write(`${detail!.name}\n${detail!.description}\n\n`);
      for (const [slotName, schema] of Object.entries(detail!.slotSchema)) {
        process.stdout.write(`  ${slotName}: ${JSON.stringify(schema)}\n`);
      }
    }
    return;
  }

  if (cmd === "edit") {
    const sidecar = opts.positional[0];
    if (!sidecar) fail("edit: missing sidecar file. Usage: slideml edit <sidecar.slideml> --ops <ops.json> --theme <name|path> -o <out.pptx>");
    const opsPath = opts.flags["ops"];
    if (!opsPath) fail("edit: --ops <ops.json> is required.");
    const themeDir = resolveTheme(opts.flags["theme"]);
    const out = opts.flags["o"] ?? opts.flags["output"];
    const opsRaw = await readFile(resolve(opsPath!), "utf8");
    let ops: EditOp[];
    try {
      ops = JSON.parse(opsRaw);
      if (!Array.isArray(ops)) throw new Error("ops file must contain a JSON array");
    } catch (err) {
      fail(`edit: cannot parse ops file: ${err instanceof Error ? err.message : err}`);
    }
    try {
      const result = await editDeck(resolve(sidecar!), ops!, {
        themeDir,
        output: out ? resolve(out) : undefined,
      });
      if (result.written) {
        process.stdout.write(`Applied ${result.applied} op(s); wrote ${result.buffer.length} bytes to ${result.written}\n`);
        if (result.sidecar) process.stdout.write(`Sidecar: ${result.sidecar}\n`);
      } else {
        process.stdout.write(`Applied ${result.applied} op(s).\n`);
        process.stdout.write(result.buffer as unknown as Uint8Array);
      }
    } catch (err) {
      if (err instanceof SlidemlAggregateError) {
        process.stderr.write(`Validation failed after edit:\n`);
        for (const e of err.errors) process.stderr.write(`  - [${e.code}] ${e.message}\n`);
        process.exit(2);
      }
      throw err;
    }
    return;
  }

  if (cmd === "themes") {
    const themes = await listInstalledThemes();
    if (opts.flags["json"] === "true") {
      process.stdout.write(JSON.stringify(themes, null, 2) + "\n");
    } else {
      for (const t of themes) {
        const tag = t.source === "builtin" ? "[builtin]" : "[user]   ";
        process.stdout.write(`${tag} ${t.name.padEnd(22)} ${t.displayName} — ${t.description}\n`);
        if (t.whenToUse) process.stdout.write(`${" ".repeat(34)}use: ${t.whenToUse}\n`);
        if (t.audiences) process.stdout.write(`${" ".repeat(34)}audiences: ${t.audiences.join(", ")}\n`);
        if (t.industries) process.stdout.write(`${" ".repeat(34)}industries: ${t.industries.join(", ")}\n`);
        if (t.moods) process.stdout.write(`${" ".repeat(34)}moods: ${t.moods.join(", ")}\n`);
      }
    }
    return;
  }

  if (cmd === "describe-theme") {
    const themeName = opts.positional[0];
    if (!themeName) fail("describe-theme: missing theme name. Usage: slideml describe-theme <name>");
    const detail = await describeInstalledTheme(themeName!);
    if (!detail) fail(`Theme "${themeName}" not found.`);
    if (opts.flags["json"] === "true") {
      process.stdout.write(JSON.stringify(detail, null, 2) + "\n");
    } else {
      process.stdout.write(`${detail!.displayName} (${detail!.name})\n${detail!.description}\n`);
      if (detail!.imagery?.guidance) {
        process.stdout.write(`\nImagery: ${detail!.imagery.guidance}\n`);
        if (detail!.imagery.palette) process.stdout.write(`  palette: ${detail!.imagery.palette.join(", ")}\n`);
        if (detail!.imagery.preferredStyles) process.stdout.write(`  prefer:  ${detail!.imagery.preferredStyles.join(", ")}\n`);
        if (detail!.imagery.avoid) process.stdout.write(`  avoid:   ${detail!.imagery.avoid.join(", ")}\n`);
      }
      if (detail!.voice?.tone) process.stdout.write(`\nVoice: ${detail!.voice.tone}\n`);
      process.stdout.write(`\nLayouts (${detail!.layouts.length}): ${detail!.layouts.join(", ")}\n`);
    }
    return;
  }

  if (cmd === "schema") {
    const schema = buildSlidemlSchema();
    const json = JSON.stringify(schema, null, 2) + "\n";
    const out = opts.flags["o"] ?? opts.flags["output"];
    if (out) {
      await writeFile(resolve(out), json, "utf8");
      process.stdout.write(`Wrote SlideML JSON Schema to ${resolve(out)}\n`);
    } else {
      process.stdout.write(json);
    }
    return;
  }

  if (cmd === "audit") {
    const target = opts.positional[0];
    if (!target) fail("audit: missing pptx file. Usage: slideml audit <deck.pptx> [--json]");
    const report = await auditPptx(resolve(target!));
    if (opts.flags["json"] === "true") {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      const status = report.ok ? "OK" : "FAIL";
      process.stdout.write(`${status} — ${target} (${report.stats.slides} slides, ${report.stats.parts} parts, ${report.stats.media} media, ${report.stats.charts} charts, ${report.stats.notesSlides} notes)\n`);
      for (const issue of report.issues) {
        const tag = issue.severity === "error" ? "✗" : "!";
        process.stdout.write(`  ${tag} [${issue.code}] ${issue.message}\n`);
      }
    }
    if (!report.ok) process.exit(2);
    return;
  }

  fail(`Unknown command: ${cmd}\n${HELP}`);
}

interface ParsedFlags {
  positional: string[];
  flags: Record<string, string>;
}

function parseFlags(args: string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else if (a.startsWith("-")) {
      const key = a.slice(1);
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

/**
 * Resolve a `--theme` argument to an absolute directory path.
 * Accepts a built-in theme name (looks up `dist/themes/<name>`) or a path.
 */
function resolveTheme(flag: string | undefined): string {
  if (!flag) fail("--theme is required.");
  // Path form (absolute, relative, or starts with `./` / `../`).
  const asPath = isAbsolute(flag!) ? flag! : resolve(process.cwd(), flag!);
  if (existsSync(asPath) && statSync(asPath).isDirectory()) return asPath;

  // Built-in theme name. Located at <slideml-dist>/themes/<name>.
  // __dirname when running from `dist/bin/slideml.js` is `<slideml-dist>/bin`.
  const builtin = resolve(__dirname, "..", "themes", flag!);
  if (existsSync(builtin) && statSync(builtin).isDirectory()) return builtin;

  fail(`Theme "${flag}" not found. Pass a directory path or a built-in name (e.g. "technical-blue").`);
}

function fail(message: string): never {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
