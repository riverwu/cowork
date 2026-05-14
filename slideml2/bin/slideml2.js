#!/usr/bin/env node
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { stdin } from "node:process";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import {
  clearRenderDiagnostics,
  createSourceDeck,
  getRenderDiagnostics,
  isBlockingRenderDiagnostic,
  isQualityRenderDiagnostic,
  normalizeSlide,
  renderToAst,
  renderToPptx,
  sliceIconSheet,
  sourceToRenderedDeck,
  validateDeck,
  validateSlide,
} from "../dist/index.js";

const EXIT = {
  ok: 0,
  unexpected: 1,
  usage: 2,
  sourceValidation: 10,
  renderValidation: 20,
  target: 30,
};

const COMMANDS = [
  "init-deck",
  "set-deck",
  "validate-slide",
  "validate-manifest",
  "compose",
  "slice-icons",
  "help",
];

const HELP = {
  main: `SlideML2 CLI

Usage:
  slideml2 <command> [args] [--deck deck-config.json] [--out deck.pptx] [--write-source build/deck.json]

Commands:
  init-deck <args.json>          Create a deck configuration source; fails if it exists.
  set-deck <deck-props.json>     Patch deck theme/config/data without changing slide files.
  validate-slide <slide.json>    Validate one standalone slide file; writes nothing.
  validate-manifest <manifest.json>
                                 Validate manifest order and referenced slide files.
  compose <manifest.json>        Compose ordered slide files into deck source and/or PPTX.
  slice-icons <sheet-image>      Slice an AI-generated PNG/JPEG icon sheet into PNG icons.
  help [command]                 Show command help.

Common flags:
  --deck <path>          Deck config source path. Default: ./deck-config.json.
  --out <path>           PPTX output path for compose.
  --write-source <path>  Composed full deck JSON output path for compose.
  --icons <path>         Icon specs JSON for slice-icons.
  --out-dir <path>       Output directory for slice-icons.
  --dry-run              Run validation but do not write files.
  --strict               Reserved for stricter validation policy.
  --json-output          Accepted for clarity; JSON output is always enabled.

Exit codes:
  0 ok, 2 usage/input JSON, 10 source validation, 20 render validation,
  30 target missing/existing conflict, 1 unexpected error.`,
  "init-deck": `Usage: slideml2 init-deck <args.json> [--deck deck-config.json] [--dry-run]

Create a new SlideML2 deck configuration. Fails with status:"target-exists" if
the target already exists. The result is a valid SlideML2 source with an empty
slides array and should be used as deck context for validate-slide/compose.

args.json fields: title, size, theme, brand, themeOverride, validation, master,
dataSources, references, footnotes.`,
  "set-deck": `Usage: slideml2 set-deck <deck-props.json> [--deck deck-config.json] [--dry-run]

Patch deck-level settings while preserving the manifest/slide-file workflow.
Use this for theme, themeOverride, brand, validation, chrome, master,
dataSources, references, or footnotes changes. themeOverride is deep-merged;
other supplied deck fields are set directly.`,
  "validate-slide": `Usage: slideml2 validate-slide <slide.json> [--deck deck-config.json]

Validate one slide file against deck config/theme/data and run render-layout
diagnostics for that single page. This command never writes deck.json. If it
fails, repair the same slide file and retry validate-slide.`,
  "validate-manifest": `Usage: slideml2 validate-manifest <manifest.json> [--deck deck-config.json]

Validate manifest order, file existence, duplicate ids, id/file consistency,
each referenced slide, and the composed deck source/render layout. Writes no
PPTX and no deck source.`,
  compose: `Usage: slideml2 compose <manifest.json> [--deck deck-config.json] --write-source build/deck.json --out build/deck.pptx

Read deck config plus ordered slide files from manifest.json, validate the
full composed deck, then atomically write the composed deck source and optional
PPTX. Slide order comes only from manifest.json, not command history. At least
one of --write-source or --out is required.`,
  "slice-icons": `Usage: slideml2 slice-icons <sheet-image> --icons icons.json --out-dir assets/icons [--manifest assets/icons/manifest.json] [--grid 3x3] [--output-size 768] [--no-transparent]

Slice an AI-generated PNG or JPEG/JFIF icon sheet into individual square PNG
icons and write a manifest. The input format is detected from bytes, not from
the filename extension, because some image engines save JPEG bytes to a
requested .png path. icons.json is an array of strings or objects:
  [{ "name":"bank", "label":"银行", "description":"bank building line icon" }]

The command uses the explicit grid and robust cell detection. It discards
probable tile frames, black separator lines, stray labels, and near-background
pixels so icons can be referenced as feature-card.iconSrc, timeline iconSrc,
process-flow step iconSrc, or image src.`,
};

function printHelp(command) {
  const key = HELP[command] ? command : "main";
  printPayload({
    ok: true,
    command: "help",
    stage: "help",
    status: "ok",
    deckModified: false,
    helpCommand: key,
    help: HELP[key],
    commands: COMMANDS,
  });
}

function abs(path) {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function deckPathFrom(flags) {
  return abs(flags.deck || "deck-config.json");
}

function outputPathFrom(flags) {
  return flags.out ? abs(flags.out) : undefined;
}

function writeSourcePathFrom(flags) {
  return flags["write-source"] ? abs(flags["write-source"]) : undefined;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const valueFlags = new Set(["deck", "out", "write-source", "icons", "out-dir", "manifest", "grid", "output-size"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--strict") {
      flags.strict = true;
    } else if (arg === "--json-output") {
      flags.jsonOutput = true;
    } else if (arg === "--transparent") {
      flags.transparent = true;
    } else if (arg === "--no-transparent") {
      flags.transparent = false;
    } else if (arg.startsWith("--") && valueFlags.has(arg.slice(2))) {
      const value = argv[++i];
      if (!value) usage(`Missing value for ${arg}`);
      flags[arg.slice(2)] = value;
    } else if (arg.startsWith("--")) {
      usage(`Unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function usage(message) {
  printPayload({
    ok: false,
    command: undefined,
    stage: "input",
    status: "usage-error",
    deckModified: false,
    error: message || "invalid command line",
    commands: COMMANDS,
    nextAction: "Run slideml2 help or slideml2 help <command>, then retry with the documented command shape.",
  }, EXIT.usage);
}

async function readJson(path, label = "input") {
  const text = path === "-" ? await readStdin() : await readFile(abs(path), "utf8");
  const file = path === "-" ? "stdin" : abs(path);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw jsonParseErrorPayload(file, text, label, error);
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function jsonParseErrorPayload(filePath, text, label, error) {
  const message = error instanceof Error ? error.message : String(error);
  const location = jsonErrorLocation(text, message);
  const diagnostic = {
    code: "INVALID_ARGS_JSON",
    severity: "error",
    file: filePath,
    line: location.line,
    column: location.column,
    message: `Could not parse ${label} JSON from ${filePath}: ${message}`,
    excerpt: jsonExcerpt(text, location.line, location.column),
    suggestion: "Fix this JSON file and retry the same slideml2 command. Keep slide/deck objects as JSON objects, not escaped JSON strings.",
  };
  const payload = {
    ok: false,
    command: undefined,
    stage: "input",
    status: "input-error",
    deckModified: false,
    error: "JSON parse failed",
    diagnostic,
    diagnostics: { count: 1, summary: { INVALID_ARGS_JSON: 1 }, blockingCount: 1, blocking: [diagnostic] },
    nextAction: "Repair the JSON syntax, then rerun this exact command. Do not switch to ad hoc deck.json writes.",
  };
  const out = new Error(diagnostic.message);
  out.slideml2JsonParse = true;
  out.payload = payload;
  return out;
}

function jsonErrorLocation(text, message) {
  const explicit = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (explicit) return { line: Number(explicit[1]), column: Number(explicit[2]) };
  const match = message.match(/position\s+(\d+)/i);
  const position = match ? Number(match[1]) : 0;
  let line = 1;
  let column = 1;
  for (let i = 0; i < Math.min(position, text.length); i += 1) {
    if (text[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function jsonExcerpt(text, line, column) {
  const lines = text.split(/\r?\n/);
  const start = Math.max(1, line - 1);
  const end = Math.min(lines.length, line + 1);
  const width = String(end).length;
  const out = [];
  for (let n = start; n <= end; n += 1) {
    const prefix = n === line ? ">" : " ";
    out.push(`${prefix} ${String(n).padStart(width, " ")} | ${lines[n - 1] || ""}`);
    if (n === line) out.push(`${" ".repeat(width + 4)}| ${" ".repeat(Math.max(0, column - 1))}^`);
  }
  return out.join("\n");
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function commandPayload(command, fields) {
  return { command, ...fields };
}

function printPayload(payload, exitCode = EXIT.ok) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(exitCode);
}

function deckOptionsFrom(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const {
    slideml2: _slideml2,
    deck: nestedDeck,
    slides: _slides,
    deckPath: _deckPath,
    outputPath: _outputPath,
    out: _out,
    render: _render,
    dryRun: _dryRun,
    ...props
  } = input;
  if (nestedDeck && typeof nestedDeck === "object" && !Array.isArray(nestedDeck)) {
    return { ...props, ...nestedDeck };
  }
  return props;
}

function deckPatchFrom(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const {
    slideml2: _slideml2,
    deck: nestedDeck,
    slides: _slides,
    deckPath: _deckPath,
    outputPath: _outputPath,
    out: _out,
    render: _render,
    dryRun: _dryRun,
    ...props
  } = input;
  if (nestedDeck && typeof nestedDeck === "object" && !Array.isArray(nestedDeck)) {
    return { ...props, ...nestedDeck };
  }
  return props;
}

async function readDeckConfig(deckPath) {
  const input = await readJson(deckPath, "deck config");
  if (input && typeof input === "object" && !Array.isArray(input) && input.slideml2 === 2 && input.deck) {
    return {
      ...input,
      slides: [],
    };
  }
  return createSourceDeck(deckOptionsFrom(input));
}

function mergeThemeOverride(prev, next) {
  const base = prev || {};
  const merged = {
    ...base,
    ...next,
    colors: { ...(base.colors || {}), ...(next.colors || {}) },
    text: mergeKeyed(base.text, next.text),
    component: mergeKeyed(base.component, next.component),
    tone: { ...(base.tone || {}), ...(next.tone || {}) },
    layout: { ...(base.layout || {}), ...(next.layout || {}) },
    chrome: { ...(base.chrome || {}), ...(next.chrome || {}) },
    imageGrowWeight: next.imageGrowWeight ?? base.imageGrowWeight,
    sizeScale: { ...(base.sizeScale || {}), ...(next.sizeScale || {}) },
  };
  if (base.fonts || next.fonts) {
    merged.fonts = {
      ...(base.fonts || {}),
      ...(next.fonts || {}),
      latin: next.fonts?.latin ?? base.fonts?.latin,
      cjk: next.fonts?.cjk ?? base.fonts?.cjk,
      mono: next.fonts?.mono ?? base.fonts?.mono,
    };
    for (const key of ["latin", "cjk", "mono"]) if (merged.fonts[key] === undefined) delete merged.fonts[key];
  } else {
    delete merged.fonts;
  }
  if (base.chart || next.chart) {
    merged.chart = {
      ...(base.chart || {}),
      ...(next.chart || {}),
      series: next.chart?.series ?? base.chart?.series,
    };
    if (merged.chart.series === undefined) delete merged.chart.series;
  } else {
    delete merged.chart;
  }
  return merged;
}

function mergeKeyed(prev, next) {
  if (!prev && !next) return undefined;
  const out = { ...(prev || {}) };
  if (next) for (const [key, value] of Object.entries(next)) out[key] = { ...(prev?.[key] || {}), ...value };
  return out;
}

function slideFromInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  if ("slide" in input && !("id" in input)) {
    throw new Error("Slide files must contain the slide object directly, not { slide: ... }. Use validate-slide on that same slide file after rewriting it.");
  }
  return input;
}

function blockingDiagnostics(items) {
  return items.filter((item) => isBlockingRenderDiagnostic(item.code, item.severity));
}

function qualityDiagnostics(items) {
  return items.filter((item) => isQualityRenderDiagnostic(item.code));
}

function diagnosticsSummary(items) {
  return items.reduce((acc, item) => {
    const key = item.code || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function renderValidationPayload(diagnostics, blocking, quality) {
  const sortedBlocking = sortDiagnostics(blocking);
  const sortedQuality = sortDiagnostics(quality);
  return {
    ok: blocking.length === 0,
    diagnostics: {
      count: diagnostics.length,
      summary: diagnosticsSummary(diagnostics),
      blockingCount: blocking.length,
      blocking: sortedBlocking.slice(0, 80),
      qualityCount: quality.length,
      quality: sortedQuality.slice(0, 30),
    },
  };
}

function sortDiagnostics(items) {
  const severityRank = { error: 0, warn: 1, warning: 1, info: 2 };
  return [...items].sort((a, b) => {
    const severity = (severityRank[a.severity] ?? 1) - (severityRank[b.severity] ?? 1);
    if (severity) return severity;
    return String(a.code || "").localeCompare(String(b.code || ""))
      || String(a.slideId || "").localeCompare(String(b.slideId || ""))
      || String(a.nodeId || "").localeCompare(String(b.nodeId || ""))
      || String(a.message || "").localeCompare(String(b.message || ""));
  });
}

function issue(level, code, message, extra = {}) {
  return { level, code, message, ...extra };
}

function report(issues) {
  return {
    ok: !issues.some((item) => item.level === "error"),
    errors: issues.filter((item) => item.level === "error"),
    warnings: issues.filter((item) => item.level === "warning"),
    info: issues.filter((item) => item.level === "info"),
  };
}

function deckSummary(deck) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  return {
    slideCount: slides.length,
    slides: slides.map((slide, index) => ({ index, id: slide?.id, title: slide?.title })).filter((item) => item.id || item.title),
  };
}

async function renderDiagnosticsForDeck(deck, baseDir) {
  clearRenderDiagnostics();
  renderToAst(sourceToRenderedDeck(deck, { baseDir }));
  const diagnostics = getRenderDiagnostics();
  const blocking = blockingDiagnostics(diagnostics);
  const quality = qualityDiagnostics(diagnostics);
  clearRenderDiagnostics();
  return renderValidationPayload(diagnostics, blocking, quality);
}

async function renderDeckToTemp(deck, baseDir, outputPath) {
  const tmpOutputPath = tempSiblingPath(outputPath, ".tmp.pptx");
  await rm(tmpOutputPath, { force: true });
  await rm(`${tmpOutputPath}.render-tree.json`, { force: true });
  clearRenderDiagnostics();
  const result = await renderToPptx(sourceToRenderedDeck(deck, { baseDir }), tmpOutputPath);
  const diagnostics = getRenderDiagnostics();
  const blocking = blockingDiagnostics(diagnostics);
  const quality = qualityDiagnostics(diagnostics);
  clearRenderDiagnostics();
  return {
    result,
    diagnostics,
    renderValidation: renderValidationPayload(diagnostics, blocking, quality),
    tempOutputPath: result.outputPath,
    tempDomPath: result.domPath,
  };
}

function tempSiblingPath(path, suffix) {
  return resolve(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}${suffix}`);
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = tempSiblingPath(path, ".tmp");
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

async function writeTextAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = tempSiblingPath(path, ".tmp");
  await writeFile(tmpPath, value, "utf8");
  await rename(tmpPath, path);
}

async function runInitDeck(command, inputPath, flags) {
  if (!inputPath) usage("init-deck requires <args.json>");
  const deckPath = deckPathFrom(flags);
  if (await pathExists(deckPath)) {
    printPayload(commandPayload(command, {
      ok: false,
      stage: "commit",
      status: "target-exists",
      deckModified: false,
      deckPath,
      nextAction: "Choose a new --deck path or intentionally edit the existing config with set-deck. Do not overwrite a deck in place.",
    }), EXIT.target);
  }
  const input = await readJson(inputPath, "deck args");
  const deck = createSourceDeck(deckOptionsFrom(input));
  deck.slides = [];
  const validation = validateDeck(deck, { baseDir: dirname(deckPath) });
  if (!validation.ok) {
    printPayload(commandPayload(command, {
      ok: false,
      stage: "validate",
      status: "schema-error",
      deckModified: false,
      deckPath,
      sourceValidation: validation,
      validation,
      nextAction: "Repair the deck initialization options and retry init-deck.",
    }), EXIT.sourceValidation);
  }
  if (!flags.dryRun) await writeJsonAtomic(deckPath, deck);
  printPayload(commandPayload(command, {
    ok: true,
    stage: flags.dryRun ? "validate" : "commit",
    status: "ok",
    deckModified: !flags.dryRun,
    dryRun: Boolean(flags.dryRun),
    deckPath,
    slideCount: 0,
    slides: [],
    sourceValidation: validation,
    validation,
  }));
}

async function runSetDeck(command, inputPath, flags) {
  if (!inputPath) usage("set-deck requires <deck-props.json>");
  const deckPath = deckPathFrom(flags);
  const deck = await readDeckConfig(deckPath);
  const input = await readJson(inputPath, "deck props");
  const patch = deckPatchFrom(input);
  const candidate = JSON.parse(JSON.stringify(deck));
  const { themeOverride, ...rest } = patch;
  if (themeOverride && typeof themeOverride === "object" && !Array.isArray(themeOverride)) {
    candidate.deck.themeOverride = mergeThemeOverride(candidate.deck.themeOverride, themeOverride);
  } else if (themeOverride === null) {
    candidate.deck.themeOverride = undefined;
  }
  candidate.deck = { ...candidate.deck, ...rest };
  candidate.slides = [];

  const validation = validateDeck(candidate, { baseDir: dirname(deckPath) });
  if (!validation.ok) {
    printPayload(commandPayload(command, {
      ok: false,
      stage: "validate",
      status: "schema-error",
      deckModified: false,
      deckPath,
      sourceValidation: validation,
      validation,
      nextAction: "Repair the deck-level patch and retry set-deck. Slide order and content remain in manifest/slide files.",
    }), EXIT.sourceValidation);
  }
  if (!flags.dryRun) await writeJsonAtomic(deckPath, candidate);
  printPayload(commandPayload(command, {
    ok: true,
    stage: flags.dryRun ? "validate" : "commit",
    status: "ok",
    deckModified: !flags.dryRun,
    dryRun: Boolean(flags.dryRun),
    deckPath,
    slideCount: 0,
    slides: [],
    sourceValidation: validation,
    validation,
  }));
}

async function validateSingleSlide(command, deckPath, slidePath) {
  const deck = await readDeckConfig(deckPath);
  const slide = normalizeSlide(slideFromInput(await readJson(slidePath, "slide")));
  const sourceValidation = validateSlide(slide, deck);
  if (!sourceValidation.ok) {
    return {
      ok: false,
      exitCode: EXIT.sourceValidation,
      payload: commandPayload(command, {
        ok: false,
        stage: "validate",
        status: "schema-error",
        deckModified: false,
        deckPath,
        slidePath: abs(slidePath),
        slide: { id: slide.id, title: slide.title },
        sourceValidation,
        validation: sourceValidation,
        nextAction: "Repair this same slide file and rerun validate-slide. Do not create another slide copy.",
      }),
    };
  }
  const candidate = JSON.parse(JSON.stringify(deck));
  candidate.slides = [slide];
  const deckValidation = validateDeck(candidate, { baseDir: dirname(deckPath) });
  if (!deckValidation.ok) {
    return {
      ok: false,
      exitCode: EXIT.sourceValidation,
      payload: commandPayload(command, {
        ok: false,
        stage: "validate",
        status: "schema-error",
        deckModified: false,
        deckPath,
        slidePath: abs(slidePath),
        slide: { id: slide.id, title: slide.title },
        sourceValidation: deckValidation,
        validation: deckValidation,
        nextAction: "Repair this same slide file against the deck config and rerun validate-slide.",
      }),
    };
  }
  const renderValidation = await renderDiagnosticsForDeck(candidate, dirname(deckPath));
  if (!renderValidation.ok) {
    return {
      ok: false,
      exitCode: EXIT.renderValidation,
      payload: commandPayload(command, {
        ok: false,
        stage: "validate",
        status: "render-error",
        deckModified: false,
        deckPath,
        slidePath: abs(slidePath),
        slide: { id: slide.id, title: slide.title },
        sourceValidation: deckValidation,
        validation: deckValidation,
        renderValidation,
        diagnostics: renderValidation.diagnostics,
        nextAction: "Source schema is valid, but rendered layout would fail. Repair this same slide file and rerun validate-slide.",
      }),
    };
  }
  return {
    ok: true,
    exitCode: EXIT.ok,
    slide,
    payload: commandPayload(command, {
      ok: true,
      stage: "validate",
      status: "ok",
      deckModified: false,
      deckPath,
      slidePath: abs(slidePath),
      slide: { id: slide.id, title: slide.title },
      sourceValidation: deckValidation,
      validation: deckValidation,
      renderValidation,
      diagnostics: renderValidation.diagnostics,
      nextAction: "Keep this slide file and continue validating the next manifest slide.",
    }),
  };
}

async function runValidateSlide(command, inputPath, flags) {
  if (!inputPath) usage("validate-slide requires <slide.json>");
  const result = await validateSingleSlide(command, deckPathFrom(flags), inputPath);
  printPayload(result.payload, result.exitCode);
}

async function readManifest(manifestPath) {
  const raw = await readJson(manifestPath, "manifest");
  const manifest = Array.isArray(raw) ? { slides: raw } : raw;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { manifest: { slides: [] }, manifestIssues: [issue("error", "INVALID_MANIFEST", "Manifest must be an object with slides[].")] };
  }
  const slides = manifest.slides;
  if (!Array.isArray(slides)) {
    return { manifest, manifestIssues: [issue("error", "MISSING_MANIFEST_SLIDES", "Manifest must include a slides array.")] };
  }
  return { manifest, manifestIssues: [] };
}

async function composeDeckFromManifest(deckPath, manifestPath) {
  const manifestAbs = abs(manifestPath);
  const manifestDir = dirname(manifestAbs);
  const deck = await readDeckConfig(deckPath);
  const { manifest, manifestIssues } = await readManifest(manifestPath);
  const entries = [];
  const slides = [];
  const seen = new Set();
  const issues = [...manifestIssues];

  const manifestSlides = Array.isArray(manifest.slides) ? manifest.slides : [];
  for (let index = 0; index < manifestSlides.length; index += 1) {
    const entry = manifestSlides[index];
    const path = `slides[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push(issue("error", "INVALID_MANIFEST_SLIDE", `${path} must be an object with id and file.`, { path }));
      continue;
    }
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const file = typeof entry.file === "string" ? entry.file.trim() : "";
    if (!id) issues.push(issue("error", "MISSING_MANIFEST_SLIDE_ID", `${path}.id is required.`, { path }));
    if (!file) {
      issues.push(issue("error", "MISSING_MANIFEST_SLIDE_FILE", `${path}.file is required.`, { path, slideId: id || undefined }));
      continue;
    }
    if (id) {
      if (seen.has(id)) {
        issues.push(issue("error", "DUPLICATE_MANIFEST_SLIDE_ID", `Manifest slide id '${id}' is duplicated.`, { path, slideId: id }));
      }
      seen.add(id);
    }
    const filePath = isAbsolute(file) ? file : resolve(manifestDir, file);
    if (!await pathExists(filePath)) {
      issues.push(issue("error", "MANIFEST_SLIDE_FILE_MISSING", `Manifest slide '${id || index}' file does not exist: ${filePath}`, {
        path,
        slideId: id || undefined,
        details: { file: filePath },
        suggestedFix: "Create the referenced slide file or update manifest.json to the correct file path.",
      }));
      continue;
    }
    let slideInput;
    try {
      slideInput = await readJson(filePath, `manifest slide ${id || index}`);
    } catch (error) {
      if (error?.slideml2JsonParse) {
        issues.push(issue("error", "INVALID_MANIFEST_SLIDE_JSON", error.payload?.diagnostic?.message || `Could not parse ${filePath}`, {
          path,
          slideId: id || undefined,
          details: { file: filePath, diagnostic: error.payload?.diagnostic },
          suggestedFix: "Repair this slide JSON file and rerun validate-manifest.",
        }));
        continue;
      }
      throw error;
    }
    let slide;
    try {
      slide = normalizeSlide(slideFromInput(slideInput));
    } catch (error) {
      issues.push(issue("error", "INVALID_MANIFEST_SLIDE", error instanceof Error ? error.message : String(error), {
        path,
        slideId: id || undefined,
        details: { file: filePath },
      }));
      continue;
    }
    if (id && slide.id !== id) {
      issues.push(issue("error", "MANIFEST_SLIDE_ID_MISMATCH", `Manifest id '${id}' does not match slide.id '${slide.id}'.`, {
        path,
        slideId: id,
        details: { file: filePath, actualSlideId: slide.id },
        suggestedFix: "Make manifest.slides[].id and slide.id identical so order and repairs stay deterministic.",
      }));
    }
    const slideValidation = validateSlide(slide, deck);
    if (!slideValidation.ok) {
      issues.push(...slideValidation.errors.map((item) => ({
        ...item,
        path: item.path || path,
        slideId: item.slideId || slide.id,
        details: { ...(item.details || {}), file: filePath },
      })));
    }
    entries.push({ index, id: id || slide.id, file: filePath, title: slide.title });
    slides.push(slide);
  }

  const candidate = JSON.parse(JSON.stringify(deck));
  candidate.slides = slides;
  const manifestValidation = report(issues);
  return { manifest, manifestPath: manifestAbs, manifestValidation, entries, deck: candidate };
}

async function validateComposedDeck(deckPath, composed) {
  if (!composed.manifestValidation.ok) {
    return {
      sourceValidation: composed.manifestValidation,
      renderValidation: undefined,
      exitCode: EXIT.sourceValidation,
      status: "schema-error",
    };
  }
  const sourceValidation = validateDeck(composed.deck, { baseDir: dirname(deckPath) });
  if (!sourceValidation.ok) {
    return { sourceValidation, renderValidation: undefined, exitCode: EXIT.sourceValidation, status: "schema-error" };
  }
  const renderValidation = await renderDiagnosticsForDeck(composed.deck, dirname(deckPath));
  if (!renderValidation.ok) {
    return { sourceValidation, renderValidation, exitCode: EXIT.renderValidation, status: "render-error" };
  }
  return { sourceValidation, renderValidation, exitCode: EXIT.ok, status: "ok" };
}

async function runValidateManifest(command, manifestPath, flags) {
  if (!manifestPath) usage("validate-manifest requires <manifest.json>");
  const deckPath = deckPathFrom(flags);
  const composed = await composeDeckFromManifest(deckPath, manifestPath);
  const validated = await validateComposedDeck(deckPath, composed);
  const ok = validated.exitCode === EXIT.ok;
  printPayload(commandPayload(command, {
    ok,
    stage: "validate",
    status: validated.status,
    deckModified: false,
    deckPath,
    manifestPath: composed.manifestPath,
    slideCount: composed.deck.slides.length,
    slides: deckSummary(composed.deck).slides,
    manifestValidation: composed.manifestValidation,
    sourceValidation: validated.sourceValidation,
    validation: validated.sourceValidation,
    renderValidation: validated.renderValidation,
    diagnostics: validated.renderValidation?.diagnostics,
    nextAction: ok
      ? "Manifest is valid. Run compose with --write-source and/or --out."
      : "Repair the named manifest or slide file diagnostics, then rerun validate-manifest. Do not append another copy of failed slides.",
  }), validated.exitCode);
}

async function runCompose(command, manifestPath, flags) {
  if (!manifestPath) usage("compose requires <manifest.json>");
  const deckPath = deckPathFrom(flags);
  const outputPath = outputPathFrom(flags);
  const sourcePath = writeSourcePathFrom(flags);
  if (!outputPath && !sourcePath) usage("compose requires --write-source and/or --out");

  const composed = await composeDeckFromManifest(deckPath, manifestPath);
  if (!composed.manifestValidation.ok) {
    printPayload(commandPayload(command, {
      ok: false,
      stage: "validate",
      status: "schema-error",
      deckModified: false,
      deckPath,
      manifestPath: composed.manifestPath,
      slideCount: composed.deck.slides.length,
      slides: deckSummary(composed.deck).slides,
      manifestValidation: composed.manifestValidation,
      sourceValidation: composed.manifestValidation,
      validation: composed.manifestValidation,
      nextAction: "Repair the named manifest or slide file diagnostics, then rerun compose. No output files were written.",
    }), EXIT.sourceValidation);
  }

  const sourceValidation = validateDeck(composed.deck, { baseDir: dirname(deckPath) });
  if (!sourceValidation.ok) {
    printPayload(commandPayload(command, {
      ok: false,
      stage: "validate",
      status: "schema-error",
      deckModified: false,
      deckPath,
      manifestPath: composed.manifestPath,
      slideCount: composed.deck.slides.length,
      slides: deckSummary(composed.deck).slides,
      manifestValidation: composed.manifestValidation,
      sourceValidation,
      validation: sourceValidation,
      nextAction: "Repair source diagnostics in the referenced slide files, then rerun compose. No output files were written.",
    }), EXIT.sourceValidation);
  }

  let tempRender;
  let renderValidation;
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    tempRender = await renderDeckToTemp(composed.deck, dirname(deckPath), outputPath);
    renderValidation = tempRender.renderValidation;
  } else {
    renderValidation = await renderDiagnosticsForDeck(composed.deck, dirname(deckPath));
  }
  if (!renderValidation.ok) {
    if (tempRender) {
      await rm(tempRender.tempOutputPath, { force: true });
      await rm(tempRender.tempDomPath, { force: true });
    }
    printPayload(commandPayload(command, {
      ok: false,
      stage: "validate",
      status: "render-error",
      deckModified: false,
      deckPath,
      manifestPath: composed.manifestPath,
      slideCount: composed.deck.slides.length,
      slides: deckSummary(composed.deck).slides,
      manifestValidation: composed.manifestValidation,
      sourceValidation,
      validation: sourceValidation,
      renderValidation,
      diagnostics: renderValidation.diagnostics,
      nextAction: "Rendered layout would fail. Repair the named slide files and rerun compose. No output files were written.",
    }), EXIT.renderValidation);
  }

  let domPath;
  let diagnosticsPath;
  if (!flags.dryRun) {
    if (sourcePath) await writeJsonAtomic(sourcePath, composed.deck);
    if (outputPath && tempRender) {
      await rename(tempRender.tempOutputPath, outputPath);
      domPath = `${outputPath}.render-tree.json`;
      await rename(tempRender.tempDomPath, domPath);
      diagnosticsPath = `${outputPath}.diagnostics.json`;
      await writeTextAtomic(diagnosticsPath, `${JSON.stringify(tempRender.diagnostics, null, 2)}\n`);
    }
  } else if (outputPath) {
    domPath = `${outputPath}.render-tree.json`;
    diagnosticsPath = `${outputPath}.diagnostics.json`;
    if (tempRender) {
      await rm(tempRender.tempOutputPath, { force: true });
      await rm(tempRender.tempDomPath, { force: true });
    }
  }

  printPayload(commandPayload(command, {
    ok: true,
    stage: flags.dryRun ? "validate" : "render",
    status: "ok",
    deckModified: !flags.dryRun,
    dryRun: Boolean(flags.dryRun),
    deckPath,
    manifestPath: composed.manifestPath,
    sourcePath,
    outputPath,
    domPath,
    diagnosticsPath,
    slideCount: composed.deck.slides.length,
    slides: deckSummary(composed.deck).slides,
    manifestValidation: composed.manifestValidation,
    sourceValidation,
    validation: sourceValidation,
    renderValidation,
    diagnostics: renderValidation.diagnostics,
  }));
}

function parseGridFlag(value) {
  if (!value) return undefined;
  const match = /^(\d+)(?:x(\d+))?$/i.exec(String(value).trim());
  if (!match) usage(`--grid must look like 1x1, 2x2, or 3x3. Got: ${value}`);
  return { columns: Number(match[1]), rows: Number(match[2] || match[1]) };
}

function parseOutputSizeFlag(value) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) usage(`--output-size must be a positive number. Got: ${value}`);
  return Math.floor(parsed);
}

async function runSliceIcons(command, sheetPath, flags) {
  if (!sheetPath) usage("slice-icons requires <sheet-image>");
  if (!flags.icons) usage("slice-icons requires --icons icons.json");
  if (!flags["out-dir"]) usage("slice-icons requires --out-dir assets/icons");
  const icons = await readJson(flags.icons, "icon specs");
  const outputDir = abs(flags["out-dir"]);
  const manifestPath = flags.manifest ? abs(flags.manifest) : resolve(outputDir, "manifest.json");
  const manifest = await sliceIconSheet({
    sheetPath: abs(sheetPath),
    icons,
    outputDir,
    manifestPath,
    grid: parseGridFlag(flags.grid),
    outputSize: parseOutputSizeFlag(flags["output-size"]),
    makeTransparent: flags.transparent !== false,
  });
  printPayload(commandPayload(command, {
    ok: true,
    stage: "assets",
    status: "ok",
    deckModified: false,
    sheetPath: manifest.sheetPath,
    manifestPath: manifest.manifestPath,
    outputDir,
    grid: manifest.grid,
    outputSize: manifest.outputSize,
    makeTransparent: manifest.makeTransparent,
    iconCount: manifest.icons.length,
    icons: manifest.icons,
    nextAction: "Use manifest.icons[].path as iconSrc/image src in slide JSON, then rerun validate-slide or validate-manifest.",
  }));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    printPayload({
      ok: false,
      command: "help",
      stage: "input",
      status: "usage-error",
      deckModified: false,
      error: "Missing command.",
      helpCommand: "main",
      help: HELP.main,
      commands: COMMANDS,
      nextAction: "Choose one command from commands and retry with the documented command shape.",
    }, EXIT.usage);
  }
  if (command === "help") {
    printHelp(rest[0] || "main");
    return;
  }
  if (!COMMANDS.includes(command)) usage(`Unknown command: ${command}`);
  const { positional, flags } = parseArgs(rest);
  if (flags.help) {
    printHelp(command);
    return;
  }

  if (command === "init-deck") return runInitDeck(command, positional[0], flags);
  if (command === "set-deck") return runSetDeck(command, positional[0], flags);
  if (command === "validate-slide") return runValidateSlide(command, positional[0], flags);
  if (command === "validate-manifest") return runValidateManifest(command, positional[0], flags);
  if (command === "compose") return runCompose(command, positional[0], flags);
  if (command === "slice-icons") return runSliceIcons(command, positional[0], flags);
  usage(`Unknown command: ${command}`);
}

main().catch((error) => {
  if (error && error.slideml2JsonParse) {
    console.log(JSON.stringify(error.payload, null, 2));
    process.exit(EXIT.usage);
  }
  if (error && error.message && error.message.includes("Slide files must contain")) {
    printPayload(commandPayload(undefined, {
      ok: false,
      stage: "input",
      status: "usage-error",
      deckModified: false,
      error: error.message,
      nextAction: "Write the slide object directly to the slide file, then retry validate-slide. Do not wrap it in { slide: ... }.",
    }), EXIT.usage);
  }
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(EXIT.unexpected);
});
