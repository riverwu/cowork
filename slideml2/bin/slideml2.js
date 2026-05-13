#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { stdin } from "node:process";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  clearRenderDiagnostics,
  createSourceDeck,
  getRenderDiagnostics,
  isBlockingRenderDiagnostic,
  isQualityRenderDiagnostic,
  normalizeSlide,
  readDeck,
  renderToAst,
  renderToPptx,
  sourceToRenderedDeck,
  validateDeck,
  validateSlide,
  writeDeck,
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
  "reset-deck",
  "set-deck",
  "list-slides",
  "show-deck",
  "add-slide",
  "insert-slide",
  "set-slide",
  "delete-slide",
  "diagnose-slide",
  "validate",
  "render",
  "help",
];

const HELP = {
  main: `SlideML2 CLI

Usage:
  slideml2 <command> [args] [--deck deck.json] [--out deck.pptx] [--dry-run]

Commands:
  init-deck <args.json>          Create a new deck; fails if the deck already exists.
  reset-deck <args.json>         Reinitialize a deck; overwrites intentionally.
  set-deck <deck-props.json>     Patch deck theme/config without deleting slides.
  list-slides                    Print [{ index, id, title }] for the current deck.
  show-deck [--slide id|index]   Print the full deck or one slide.
  add-slide <slide.json>         Append one slide; validates before writing.
  insert-slide <index|id> <slide.json>
                                 Insert one slide before a target; validates before writing.
  set-slide <id|index> <slide.json>
                                 Replace one existing slide; validates before writing.
  delete-slide <id|index>        Delete one slide; validates before writing.
  diagnose-slide <slide.json>    Validate a candidate slide without writing.
  validate                       Validate source and rendered layout; writes no PPTX.
  render --out deck.pptx         Validate and render a PPTX.
  help [command]                 Show command help.

Common flags:
  --deck <path>       Deck source path. Default: ./deck.json in the current directory.
  --out <path>        PPTX output path for render.
  --slide <id|index>  Slide selector for show-deck or diagnose-slide replacement mode.
  --before <id|index> Insert/diagnose before this slide.
  --after <id|index>  Insert/diagnose after this slide.
  --dry-run           Run validation but do not write deck.json.
  --strict            Reserved for stricter validation policy.
  --json-output       Accepted for clarity; JSON output is always enabled.

Exit codes:
  0 ok, 2 usage/input JSON, 10 source validation, 20 render validation,
  30 target missing/existing conflict, 1 unexpected error.`,
  "init-deck": `Usage: slideml2 init-deck <args.json> [--deck deck.json] [--dry-run]

Create a new SlideML2 deck. Fails with status:"target-exists" if the target
deck already exists. Use reset-deck when overwrite is intentional.

args.json fields: title, size, theme, brand, themeOverride, validation, master,
dataSources, references, footnotes.`,
  "reset-deck": `Usage: slideml2 reset-deck <args.json> [--deck deck.json] [--dry-run]

Reinitialize a SlideML2 deck and overwrite any existing deck at --deck.`,
  "set-deck": `Usage: slideml2 set-deck <deck-props.json> [--deck deck.json] [--dry-run]

Patch deck-level settings while preserving all slides. Use this for theme,
themeOverride, brand, validation, chrome, master, dataSources, references, or
footnotes changes. themeOverride is deep-merged; other supplied deck fields are
set directly. The resulting full deck is validated before writing.`,
  "list-slides": `Usage: slideml2 list-slides [--deck deck.json]

Print only slide index/id/title, so agents can inspect deck structure without
loading the full source.`,
  "show-deck": `Usage: slideml2 show-deck [--deck deck.json] [--slide id|index]

Print the full source deck, or one slide when --slide is supplied.`,
  "add-slide": `Usage: slideml2 add-slide <slide.json> [--deck deck.json] [--dry-run]

Append one slide. The file must contain the slide object directly:
{ "id": "s1", "title": "Slide", "children": [] }`,
  "insert-slide": `Usage:
  slideml2 insert-slide <index|id> <slide.json> [--deck deck.json] [--dry-run]
  slideml2 insert-slide <slide.json> --before <index|id> [--deck deck.json]
  slideml2 insert-slide <slide.json> --after <index|id> [--deck deck.json]

Insert one slide before the target by default. Use --after to insert after an
existing slide. The file must contain the slide object directly.`,
  "set-slide": `Usage: slideml2 set-slide <id|index> <slide.json> [--deck deck.json] [--dry-run]

Replace exactly one existing slide. The file must contain the slide object
directly; the target id/index is a command argument, not a JSON field.`,
  "delete-slide": `Usage: slideml2 delete-slide <id|index> [--deck deck.json] [--dry-run]

Delete exactly one existing slide, then validate the resulting deck before
writing.`,
  "diagnose-slide": `Usage: slideml2 diagnose-slide <slide.json> [--deck deck.json] [--slide id|index]

Validate a candidate slide against the current deck without writing. Without
--slide it diagnoses append mode; with --slide it diagnoses replacement mode;
with --before/--after it diagnoses insertion mode.`,
  validate: `Usage: slideml2 validate [--deck deck.json] [--strict]

Validate the current deck source and rendered layout. Writes no PPTX.`,
  render: `Usage: slideml2 render --out deck.pptx [--deck deck.json]

Validate the current deck, render a PPTX, and write <out>.diagnostics.json.`,
};

function printHelp(command) {
  console.log(HELP[command] || HELP.main);
}

function abs(path) {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function deckPathFrom(flags) {
  return abs(flags.deck || "deck.json");
}

function outputPathFrom(flags, deckPath) {
  return abs(flags.out || deckPath.replace(/\.json$/i, ".pptx"));
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
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
    } else if (arg === "--deck" || arg === "--out" || arg === "--slide" || arg === "--before" || arg === "--after") {
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
  const payload = {
    ok: false,
    command: undefined,
    stage: "input",
    status: "usage-error",
    deckModified: false,
    error: message || "invalid command line",
    commands: COMMANDS,
    nextAction: "Run slideml2 help or slideml2 help <command>, then retry with the documented command shape.",
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(EXIT.usage);
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
    nextAction: "Repair the JSON syntax, then rerun this exact command. Do not recreate deck.json or switch tools.",
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

function deckSummary(deck) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  return {
    slideCount: slides.length,
    slides: slides.map((slide, index) => ({ index, id: slide?.id, title: slide?.title })).filter((item) => item.id || item.title),
  };
}

function parseSlideSelector(value) {
  if (typeof value !== "string") return value;
  return /^\d+$/.test(value) ? Number(value) : value;
}

function findSlideIndex(deck, slideId) {
  if (typeof slideId === "number") return slideId >= 0 && slideId < deck.slides.length ? slideId : -1;
  return deck.slides.findIndex((slide) => slide.id === slideId);
}

function resolveInsertIndex(deck, slideId, placement = "before") {
  if (typeof slideId === "number") {
    if (placement === "before") return slideId >= 0 && slideId <= deck.slides.length ? slideId : -1;
    return slideId >= 0 && slideId < deck.slides.length ? slideId + 1 : -1;
  }
  const existing = findSlideIndex(deck, slideId);
  if (existing < 0) return -1;
  return placement === "after" ? existing + 1 : existing;
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
  return {
    ok: blocking.length === 0,
    diagnostics: {
      count: diagnostics.length,
      summary: diagnosticsSummary(diagnostics),
      blockingCount: blocking.length,
      blocking: blocking.slice(0, 80),
      qualityCount: quality.length,
      quality: quality.slice(0, 30),
    },
  };
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
    deckPath: _deckPath,
    outputPath: _outputPath,
    out: _out,
    render: _render,
    dryRun: _dryRun,
    ...deckOptions
  } = input;
  return deckOptions;
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
    throw new Error("Slide files must contain the slide object directly, not { slide: ... }. Use add-slide slide.json or set-slide <id> slide.json.");
  }
  return input;
}

async function validateCandidateSlide(command, deckPath, deck, slide, targetIndex, mode) {
  const normalizedSlide = normalizeSlide(slide);
  const slideValidation = validateSlide(normalizedSlide, deck);
  if (!slideValidation.ok) {
    return {
      ok: false,
      exitCode: EXIT.sourceValidation,
      payload: commandPayload(command, {
        ok: false,
        stage: "validate",
        status: "schema-error",
        deckModified: false,
        sourceValidation: slideValidation,
        validation: slideValidation,
        nextAction: "Repair this same slide JSON and retry the same command before moving to another slide.",
      }),
    };
  }

  const candidate = JSON.parse(JSON.stringify(deck));
  let insertedAt;
  let replacedAt;
  if (mode === "append") {
    candidate.slides.push(normalizedSlide);
    targetIndex = candidate.slides.length - 1;
    insertedAt = targetIndex;
  } else if (mode === "insert") {
    candidate.slides.splice(targetIndex, 0, normalizedSlide);
    insertedAt = targetIndex;
  } else {
    candidate.slides[targetIndex] = normalizedSlide;
    replacedAt = targetIndex;
  }

  const validation = validateDeck(candidate, { baseDir: dirname(deckPath) });
  if (!validation.ok) {
    return {
      ok: false,
      exitCode: EXIT.sourceValidation,
      payload: commandPayload(command, {
        ok: false,
        stage: "validate",
        status: "schema-error",
        deckModified: false,
        sourceValidation: validation,
        validation,
        nextAction: "Repair this same slide JSON and retry the same command before moving to another slide.",
      }),
    };
  }

  clearRenderDiagnostics();
  renderToAst(sourceToRenderedDeck({ ...candidate, slides: [candidate.slides[targetIndex]] }, { baseDir: dirname(deckPath) }));
  const diagnostics = getRenderDiagnostics();
  const blocking = blockingDiagnostics(diagnostics);
  const quality = qualityDiagnostics(diagnostics);
  clearRenderDiagnostics();
  const renderValidation = renderValidationPayload(diagnostics, blocking, quality);
  if (blocking.length > 0) {
    return {
      ok: false,
      exitCode: EXIT.renderValidation,
      payload: commandPayload(command, {
        ok: false,
        stage: "validate",
        status: "render-error",
        deckModified: false,
        sourceValidation: validation,
        validation,
        renderValidation,
        diagnostics: renderValidation.diagnostics,
        nextAction: "Source schema is valid, but rendered layout would fail. Repair the named diagnostics on this same slide and retry before moving on.",
      }),
    };
  }

  return {
    ok: true,
    exitCode: EXIT.ok,
    candidate,
    insertedAt,
    replacedAt,
    payload: commandPayload(command, {
      ok: true,
      stage: "validate",
      status: "ok",
      deckModified: false,
      insertedAt,
      replacedAt,
      slideCount: candidate.slides.length,
      sourceValidation: validation,
      validation,
      renderValidation,
      diagnostics: renderValidation.diagnostics,
    }),
  };
}

async function runInitOrReset(command, inputPath, flags, allowOverwrite) {
  if (!inputPath) usage(`${command} requires <args.json>`);
  const deckPath = deckPathFrom(flags);
  const exists = await pathExists(deckPath);
  if (exists && !allowOverwrite) {
    let existingDeck;
    try {
      existingDeck = deckSummary(await readDeck(deckPath));
    } catch {
      existingDeck = { slideCount: undefined, slides: [] };
    }
    printPayload(commandPayload(command, {
      ok: false,
      stage: "commit",
      status: "target-exists",
      deckModified: false,
      deckPath,
      existingDeck,
      nextAction: "Use reset-deck only if overwriting this deck is intentional; otherwise continue with add-slide/set-slide.",
    }), EXIT.target);
  }

  const input = await readJson(inputPath, `${command} args`);
  const deck = createSourceDeck(deckOptionsFrom(input));
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
      nextAction: "Repair the deck initialization options and retry.",
    }), EXIT.sourceValidation);
  }

  if (!flags.dryRun) await writeDeck(deckPath, deck);
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
  const deck = await readDeck(deckPath);
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
      nextAction: "Repair the deck-level patch and retry set-deck. Do not use reset-deck unless deleting all slides is intentional.",
    }), EXIT.sourceValidation);
  }

  clearRenderDiagnostics();
  renderToAst(sourceToRenderedDeck(candidate, { baseDir: dirname(deckPath) }));
  const diagnostics = getRenderDiagnostics();
  const blocking = blockingDiagnostics(diagnostics);
  const quality = qualityDiagnostics(diagnostics);
  clearRenderDiagnostics();
  const renderValidation = renderValidationPayload(diagnostics, blocking, quality);
  if (blocking.length > 0) {
    printPayload(commandPayload(command, {
      ok: false,
      stage: "validate",
      status: "render-error",
      deckModified: false,
      deckPath,
      sourceValidation: validation,
      validation,
      renderValidation,
      diagnostics: renderValidation.diagnostics,
      nextAction: "The deck-level patch would create blocking render diagnostics. Adjust the theme/layout patch or repair the named slides, then retry set-deck.",
    }), EXIT.renderValidation);
  }

  if (!flags.dryRun) await writeDeck(deckPath, candidate);
  printPayload(commandPayload(command, {
    ok: true,
    stage: flags.dryRun ? "validate" : "commit",
    status: "ok",
    deckModified: !flags.dryRun,
    dryRun: Boolean(flags.dryRun),
    deckPath,
    slideCount: candidate.slides.length,
    slides: deckSummary(candidate).slides,
    sourceValidation: validation,
    validation,
    renderValidation,
    diagnostics: renderValidation.diagnostics,
  }));
}

async function runListSlides(command, flags) {
  const deckPath = deckPathFrom(flags);
  const deck = await readDeck(deckPath);
  printPayload(commandPayload(command, {
    ok: true,
    stage: "inspect",
    status: "ok",
    deckModified: false,
    deckPath,
    ...deckSummary(deck),
  }));
}

async function runShowDeck(command, flags) {
  const deckPath = deckPathFrom(flags);
  const deck = await readDeck(deckPath);
  if (flags.slide !== undefined) {
    const slideId = parseSlideSelector(flags.slide);
    const index = findSlideIndex(deck, slideId);
    if (index < 0) {
      printPayload(commandPayload(command, {
        ok: false,
        stage: "inspect",
        status: "target-missing",
        deckModified: false,
        deckPath,
        slideId,
        ...deckSummary(deck),
        nextAction: "Run list-slides to choose an existing slide id/index, then retry show-deck --slide.",
      }), EXIT.target);
    }
    printPayload(commandPayload(command, {
      ok: true,
      stage: "inspect",
      status: "ok",
      deckModified: false,
      deckPath,
      index,
      slide: deck.slides[index],
    }));
  }
  printPayload(commandPayload(command, {
    ok: true,
    stage: "inspect",
    status: "ok",
    deckModified: false,
    deckPath,
    deck,
  }));
}

async function runAddSlide(command, inputPath, flags) {
  if (!inputPath) usage("add-slide requires <slide.json>");
  const deckPath = deckPathFrom(flags);
  const deck = await readDeck(deckPath);
  const slide = slideFromInput(await readJson(inputPath, "slide"));
  const result = await validateCandidateSlide(command, deckPath, deck, slide, -1, "append");
  if (!result.ok) printPayload(result.payload, result.exitCode);
  if (!flags.dryRun) await writeDeck(deckPath, result.candidate);
  printPayload(commandPayload(command, {
    ...result.payload,
    stage: flags.dryRun ? "validate" : "commit",
    deckModified: !flags.dryRun,
    dryRun: Boolean(flags.dryRun),
    deckPath,
  }));
}

async function runInsertSlide(command, positional, flags) {
  let selector;
  let inputPath;
  let placement = "before";
  if (flags.before !== undefined || flags.after !== undefined) {
    if (flags.before !== undefined && flags.after !== undefined) usage("insert-slide accepts only one of --before or --after");
    selector = parseSlideSelector(flags.before ?? flags.after);
    placement = flags.after !== undefined ? "after" : "before";
    inputPath = positional[0];
    if (!inputPath) usage("insert-slide with --before/--after requires <slide.json>");
  } else {
    selector = parseSlideSelector(positional[0]);
    inputPath = positional[1];
    if (selector === undefined || !inputPath) usage("insert-slide requires <index|id> <slide.json>, or <slide.json> --before/--after <index|id>");
  }
  const deckPath = deckPathFrom(flags);
  const deck = await readDeck(deckPath);
  const targetIndex = resolveInsertIndex(deck, selector, placement);
  if (targetIndex < 0) {
    printPayload(commandPayload(command, {
      ok: false,
      stage: "commit",
      status: "target-missing",
      deckModified: false,
      deckPath,
      slideId: selector,
      placement,
      ...deckSummary(deck),
      nextAction: "Run list-slides to choose an existing slide id/index. Use add-slide if the new page belongs at the end.",
    }), EXIT.target);
  }
  const slide = slideFromInput(await readJson(inputPath, "slide"));
  const result = await validateCandidateSlide(command, deckPath, deck, slide, targetIndex, "insert");
  if (!result.ok) printPayload(result.payload, result.exitCode);
  if (!flags.dryRun) await writeDeck(deckPath, result.candidate);
  printPayload(commandPayload(command, {
    ...result.payload,
    stage: flags.dryRun ? "validate" : "commit",
    deckModified: !flags.dryRun,
    dryRun: Boolean(flags.dryRun),
    deckPath,
  }));
}

async function runSetSlide(command, selector, inputPath, flags) {
  if (!selector || !inputPath) usage("set-slide requires <id|index> <slide.json>");
  const deckPath = deckPathFrom(flags);
  const deck = await readDeck(deckPath);
  const slideId = parseSlideSelector(selector);
  const targetIndex = findSlideIndex(deck, slideId);
  if (targetIndex < 0) {
    printPayload(commandPayload(command, {
      ok: false,
      stage: "commit",
      status: "target-missing",
      deckModified: false,
      deckPath,
      slideId,
      ...deckSummary(deck),
      nextAction: "Run list-slides to choose an existing slide id/index, or use add-slide to append a new slide.",
    }), EXIT.target);
  }
  const slide = slideFromInput(await readJson(inputPath, "slide"));
  const result = await validateCandidateSlide(command, deckPath, deck, slide, targetIndex, "replace");
  if (!result.ok) printPayload(result.payload, result.exitCode);
  if (!flags.dryRun) await writeDeck(deckPath, result.candidate);
  printPayload(commandPayload(command, {
    ...result.payload,
    stage: flags.dryRun ? "validate" : "commit",
    deckModified: !flags.dryRun,
    dryRun: Boolean(flags.dryRun),
    deckPath,
  }));
}

async function runDeleteSlide(command, selector, flags) {
  if (!selector) usage("delete-slide requires <id|index>");
  const deckPath = deckPathFrom(flags);
  const deck = await readDeck(deckPath);
  const slideId = parseSlideSelector(selector);
  const targetIndex = findSlideIndex(deck, slideId);
  if (targetIndex < 0) {
    printPayload(commandPayload(command, {
      ok: false,
      stage: "commit",
      status: "target-missing",
      deckModified: false,
      deckPath,
      slideId,
      ...deckSummary(deck),
      nextAction: "Run list-slides to choose an existing slide id/index, then retry delete-slide.",
    }), EXIT.target);
  }
  const candidate = JSON.parse(JSON.stringify(deck));
  const [deletedSlide] = candidate.slides.splice(targetIndex, 1);
  const validation = validateDeck(candidate, { baseDir: dirname(deckPath) });
  if (!validation.ok) {
    printPayload(commandPayload(command, {
      ok: false,
      stage: "validate",
      status: "schema-error",
      deckModified: false,
      deckPath,
      deletedAt: targetIndex,
      deletedSlide: deletedSlide ? { id: deletedSlide.id, title: deletedSlide.title } : undefined,
      sourceValidation: validation,
      validation,
      nextAction: "The deck would be invalid after deletion. Repair the current deck or choose a different slide.",
    }), EXIT.sourceValidation);
  }
  clearRenderDiagnostics();
  renderToAst(sourceToRenderedDeck(candidate, { baseDir: dirname(deckPath) }));
  const diagnostics = getRenderDiagnostics();
  const blocking = blockingDiagnostics(diagnostics);
  const quality = qualityDiagnostics(diagnostics);
  clearRenderDiagnostics();
  const renderValidation = renderValidationPayload(diagnostics, blocking, quality);
  if (blocking.length > 0) {
    printPayload(commandPayload(command, {
      ok: false,
      stage: "validate",
      status: "render-error",
      deckModified: false,
      deckPath,
      deletedAt: targetIndex,
      deletedSlide: deletedSlide ? { id: deletedSlide.id, title: deletedSlide.title } : undefined,
      sourceValidation: validation,
      validation,
      renderValidation,
      diagnostics: renderValidation.diagnostics,
      nextAction: "The deck would have blocking render diagnostics after deletion. Repair the named slides, then retry delete-slide.",
    }), EXIT.renderValidation);
  }
  if (!flags.dryRun) await writeDeck(deckPath, candidate);
  printPayload(commandPayload(command, {
    ok: true,
    stage: flags.dryRun ? "validate" : "commit",
    status: "ok",
    deckModified: !flags.dryRun,
    dryRun: Boolean(flags.dryRun),
    deckPath,
    deletedAt: targetIndex,
    deletedSlide: deletedSlide ? { id: deletedSlide.id, title: deletedSlide.title } : undefined,
    slideCount: candidate.slides.length,
    slides: deckSummary(candidate).slides,
    sourceValidation: validation,
    validation,
    renderValidation,
    diagnostics: renderValidation.diagnostics,
  }));
}

async function runDiagnoseSlide(command, inputPath, flags) {
  if (!inputPath) usage("diagnose-slide requires <slide.json>");
  const deckPath = deckPathFrom(flags);
  const deck = await readDeck(deckPath);
  const slide = slideFromInput(await readJson(inputPath, "slide"));
  let targetIndex = -1;
  let mode = "append";
  if ((flags.before !== undefined || flags.after !== undefined) && flags.slide !== undefined) {
    usage("diagnose-slide accepts --slide for replacement or --before/--after for insertion, not both");
  }
  if (flags.before !== undefined || flags.after !== undefined) {
    if (flags.before !== undefined && flags.after !== undefined) usage("diagnose-slide accepts only one of --before or --after");
    const slideId = parseSlideSelector(flags.before ?? flags.after);
    const placement = flags.after !== undefined ? "after" : "before";
    targetIndex = resolveInsertIndex(deck, slideId, placement);
    mode = "insert";
    if (targetIndex < 0) {
      printPayload(commandPayload(command, {
        ok: false,
        stage: "validate",
        status: "target-missing",
        deckModified: false,
        deckPath,
        slideId,
        placement,
        ...deckSummary(deck),
        nextAction: "Run list-slides to choose an existing slide id/index, use add-slide to append, or retry diagnose-slide with a valid --before/--after target.",
      }), EXIT.target);
    }
  } else if (flags.slide !== undefined) {
    const slideId = parseSlideSelector(flags.slide);
    targetIndex = findSlideIndex(deck, slideId);
    mode = "replace";
    if (targetIndex < 0) {
      printPayload(commandPayload(command, {
        ok: false,
        stage: "validate",
        status: "target-missing",
        deckModified: false,
        deckPath,
        slideId,
        ...deckSummary(deck),
        nextAction: "Run list-slides to choose an existing slide id/index, or omit --slide to diagnose append mode.",
      }), EXIT.target);
    }
  }
  const result = await validateCandidateSlide(command, deckPath, deck, slide, targetIndex, mode);
  printPayload(commandPayload(command, {
    ...result.payload,
    deckPath,
    deckModified: false,
    dryRun: true,
  }), result.exitCode);
}

async function runValidate(command, flags) {
  const deckPath = deckPathFrom(flags);
  const deck = await readDeck(deckPath);
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
      nextAction: "Repair source diagnostics through set-slide/add-slide or reset-deck, then rerun validate.",
    }), EXIT.sourceValidation);
  }
  clearRenderDiagnostics();
  renderToAst(sourceToRenderedDeck(deck, { baseDir: dirname(deckPath) }));
  const diagnostics = getRenderDiagnostics();
  const blocking = blockingDiagnostics(diagnostics);
  const quality = qualityDiagnostics(diagnostics);
  clearRenderDiagnostics();
  const renderValidation = renderValidationPayload(diagnostics, blocking, quality);
  printPayload(commandPayload(command, {
    ok: blocking.length === 0,
    stage: "validate",
    status: blocking.length === 0 ? "ok" : "render-error",
    deckModified: false,
    deckPath,
    sourceValidation: validation,
    validation,
    renderValidation,
    diagnostics: renderValidation.diagnostics,
    nextAction: blocking.length === 0 ? undefined : "Repair the named render diagnostics through set-slide, then rerun validate.",
  }), blocking.length === 0 ? EXIT.ok : EXIT.renderValidation);
}

async function runRender(command, flags) {
  const deckPath = deckPathFrom(flags);
  const outputPath = outputPathFrom(flags, deckPath);
  const deck = await readDeck(deckPath);
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
      nextAction: "Repair source diagnostics through set-slide/add-slide, then rerun render.",
    }), EXIT.sourceValidation);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  clearRenderDiagnostics();
  const rendered = sourceToRenderedDeck(deck, { baseDir: dirname(deckPath) });
  const result = await renderToPptx(rendered, outputPath);
  const diagnostics = getRenderDiagnostics();
  const blocking = blockingDiagnostics(diagnostics);
  const quality = qualityDiagnostics(diagnostics);
  const renderValidation = renderValidationPayload(diagnostics, blocking, quality);
  const diagnosticsPath = `${result.outputPath}.diagnostics.json`;
  await writeFile(diagnosticsPath, JSON.stringify(diagnostics, null, 2), "utf8");
  printPayload(commandPayload(command, {
    ok: blocking.length === 0,
    stage: "render",
    status: blocking.length === 0 ? "ok" : "render-error",
    deckModified: false,
    deckPath,
    outputPath: result.outputPath,
    domPath: result.domPath,
    diagnosticsPath,
    sourceValidation: validation,
    validation,
    renderValidation,
    diagnostics: renderValidation.diagnostics,
    nextAction: blocking.length === 0 ? undefined : "The PPTX was written for inspection, but blocking render diagnostics remain. Repair the named slides and rerun render.",
  }), blocking.length === 0 ? EXIT.ok : EXIT.renderValidation);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    printHelp("main");
    process.exit(EXIT.usage);
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

  if (command === "init-deck") return runInitOrReset(command, positional[0], flags, false);
  if (command === "reset-deck") return runInitOrReset(command, positional[0], flags, true);
  if (command === "set-deck") return runSetDeck(command, positional[0], flags);
  if (command === "list-slides") return runListSlides(command, flags);
  if (command === "show-deck") return runShowDeck(command, flags);
  if (command === "add-slide") return runAddSlide(command, positional[0], flags);
  if (command === "insert-slide") return runInsertSlide(command, positional, flags);
  if (command === "set-slide") return runSetSlide(command, positional[0], positional[1], flags);
  if (command === "delete-slide") return runDeleteSlide(command, positional[0], flags);
  if (command === "diagnose-slide") return runDiagnoseSlide(command, positional[0], flags);
  if (command === "validate") return runValidate(command, flags);
  if (command === "render") return runRender(command, flags);

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
      nextAction: "Write the slide object directly to slide.json, then retry add-slide or set-slide.",
    }), EXIT.usage);
  }
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(EXIT.unexpected);
});
