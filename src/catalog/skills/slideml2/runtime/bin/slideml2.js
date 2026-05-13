#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  clearRenderDiagnostics,
  createDeck,
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

function usage() {
  console.error("usage: slideml2 <create-deck|replace-slide|read-deck|validate-render> <args.json>");
  process.exit(2);
}

async function readJson(path) {
  const absolutePath = resolve(process.cwd(), path);
  const text = await readFile(absolutePath, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw jsonParseErrorPayload(absolutePath, text, error);
  }
}

function jsonParseErrorPayload(filePath, text, error) {
  const message = error instanceof Error ? error.message : String(error);
  const location = jsonErrorLocation(text, message);
  const diagnostic = {
    code: "INVALID_ARGS_JSON",
    severity: "error",
    file: filePath,
    line: location.line,
    column: location.column,
    message: `Could not parse ${filePath}: ${message}`,
    excerpt: jsonExcerpt(text, location.line, location.column),
    suggestion: "Fix the args JSON and retry the same command. Escape embedded double quotes inside JSON strings; if generating args from code, write a JS object and serialize it with JSON.stringify instead of hand-writing JSON.",
  };
  const payload = {
    ok: false,
    phase: "input-json-parse",
    error: "args JSON parse failed",
    deckModified: false,
    diagnostic,
    diagnostics: { count: 1, summary: { INVALID_ARGS_JSON: 1 }, blockingCount: 1, blocking: [diagnostic] },
    nextAction: "Repair the args JSON syntax, then rerun this exact slideml2 command. Do not recreate deck.json or switch tools.",
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

function abs(path) {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function deckPathFrom(input) {
  return abs(input.deckPath || "deck.json");
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

function renderValidationPayload(diagnostics, blocking, quality) {
  return {
    ok: blocking.length === 0,
    diagnostics: {
      count: diagnostics.length,
      summary: diagnosticsSummary(diagnostics),
      blockingCount: blocking.length,
      blocking: blocking.slice(0, 60),
      qualityCount: quality.length,
      quality: quality.slice(0, 20),
    },
  };
}

function findSlideIndex(deck, slideId) {
  if (typeof slideId === "number") return slideId >= 0 && slideId < deck.slides.length ? slideId : -1;
  return deck.slides.findIndex((slide) => slide.id === slideId);
}

function isAppendSlideId(slideId) {
  return slideId === "append" || slideId === "$append" || slideId === "next";
}

async function main() {
  const [command, argPath] = process.argv.slice(2);
  if (!command || !argPath) usage();
  const input = await readJson(argPath);

  if (command === "create-deck") {
    const deckPath = deckPathFrom(input);
    let existingDeck;
    if (await pathExists(deckPath)) {
      try {
        existingDeck = deckSummary(await readDeck(deckPath));
      } catch {
        existingDeck = { slideCount: undefined, slides: [] };
      }
    }
    const result = await createDeck(deckPath, input);
    const warnings = [];
    if (result.ok && existingDeck) {
      warnings.push({
        code: "DECK_REINITIALIZED",
        severity: "warning",
        message: "create-deck replaced an existing deck.json in this workspace.",
        previousDeck: existingDeck,
        suggestion: "For normal repairs, prefer read-deck followed by replace-slide so existing slides are preserved.",
      });
    }
    console.log(JSON.stringify({
      ...result,
      phase: result.ok ? "committed" : "source-validation",
      deckPath,
      deckModified: result.ok,
      overwroteExistingDeck: Boolean(result.ok && existingDeck),
      warnings,
      previousDeck: existingDeck,
      nextAction: result.ok && existingDeck
        ? "Continue only if the reset was intentional. Otherwise reconstruct the affected slides through replace-slide from the latest valid source or plan."
        : undefined,
    }, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "read-deck") {
    console.log(JSON.stringify(await readDeck(deckPathFrom(input)), null, 2));
    return;
  }

  if (command === "replace-slide") {
    const deckPath = deckPathFrom(input);
    const deck = await readDeck(deckPath);
    const normalizedSlide = normalizeSlide(input.slide);
    const slideValidation = validateSlide(normalizedSlide, deck);
    if (!slideValidation.ok) {
      console.log(JSON.stringify({
        ok: false,
        phase: "slide-source-validation",
        error: "slide source validation failed",
        deckModified: false,
        sourceValidation: slideValidation,
        validation: slideValidation,
        nextAction: "Repair this same slide and retry replace-slide before adding the next slide.",
      }, null, 2));
      process.exit(1);
    }
    const slideId = typeof input.slideId === "string" && /^\d+$/.test(input.slideId) ? Number(input.slideId) : input.slideId;
    const candidate = JSON.parse(JSON.stringify(deck));
    let targetIndex = -1;
    let insertedAt;
    let replacedAt;
    if (isAppendSlideId(slideId) || (typeof slideId === "number" && slideId === candidate.slides.length)) {
      candidate.slides.push(normalizedSlide);
      targetIndex = candidate.slides.length - 1;
      insertedAt = targetIndex;
    } else {
      targetIndex = findSlideIndex(candidate, slideId);
      if (targetIndex < 0) {
        console.log(JSON.stringify({
          ok: false,
          phase: "target-resolution",
          error: "slide not found",
          deckModified: false,
          slideId,
          slideCount: candidate.slides.length,
          nextAppendIndex: candidate.slides.length,
          slides: deckSummary(candidate).slides,
          nextAction: "If you expected this index to exist, a previous replace-slide failed and left the deck unchanged. Repair that failed slide first, or append with slideId:'append'.",
        }, null, 2));
        process.exit(1);
      }
      candidate.slides[targetIndex] = normalizedSlide;
      replacedAt = targetIndex;
    }
    const validation = validateDeck(candidate, { baseDir: dirname(deckPath) });
    if (!validation.ok) {
      console.log(JSON.stringify({
        ok: false,
        phase: "deck-source-validation",
        error: "deck source validation failed after candidate apply",
        deckModified: false,
        sourceValidation: validation,
        validation,
        nextAction: "Repair this same slide and retry replace-slide before adding the next slide.",
      }, null, 2));
      process.exit(1);
    }
    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck({ ...candidate, slides: [candidate.slides[targetIndex]] }, { baseDir: dirname(deckPath) }));
    const diagnostics = getRenderDiagnostics();
    const blocking = blockingDiagnostics(diagnostics);
    const quality = qualityDiagnostics(diagnostics);
    clearRenderDiagnostics();
    const renderValidation = renderValidationPayload(diagnostics, blocking, quality);
    if (blocking.length > 0) {
      console.log(JSON.stringify({
        ok: false,
        phase: "render-validation",
        error: "render validation failed for candidate slide",
        deckModified: false,
        sourceValidation: validation,
        validation,
        renderValidation,
        diagnostics: renderValidation.diagnostics,
        nextAction: "Source schema is valid, but rendering would fail or degrade. Repair the named render diagnostics on this same slide and retry replace-slide before adding the next slide.",
      }, null, 2));
      process.exit(1);
    }
    await writeDeck(deckPath, candidate);
    console.log(JSON.stringify({
      ok: true,
      phase: "committed",
      deckModified: true,
      insertedAt,
      replacedAt,
      slideCount: candidate.slides.length,
      sourceValidation: validation,
      validation,
      renderValidation,
      diagnostics: renderValidation.diagnostics,
    }, null, 2));
    return;
  }

  if (command === "validate-render") {
    const deckPath = deckPathFrom(input);
    const outputPath = abs(input.outputPath || input.out || deckPath.replace(/\\.json$/, ".pptx"));
    const deck = await readDeck(deckPath);
    const validation = validateDeck(deck, { baseDir: dirname(deckPath) });
    if (!validation.ok) {
      console.log(JSON.stringify({
        ok: false,
        phase: "deck-source-validation",
        error: "deck source validation failed",
        deckModified: false,
        sourceValidation: validation,
        validation,
      }, null, 2));
      process.exit(1);
    }
    if (command === "validate-render" && input.render === false) {
      console.log(JSON.stringify({ ok: true, phase: "source-validation", deckModified: false, sourceValidation: validation, validation }, null, 2));
      return;
    }
    await mkdir(dirname(outputPath), { recursive: true });
    clearRenderDiagnostics();
    const rendered = sourceToRenderedDeck(deck, { baseDir: dirname(deckPath) });
    const result = await renderToPptx(rendered, outputPath);
    const diagnostics = getRenderDiagnostics();
    const blocking = blockingDiagnostics(diagnostics);
    const quality = qualityDiagnostics(diagnostics);
    const renderValidation = renderValidationPayload(diagnostics, blocking, quality);
    await writeFile(`${result.outputPath}.diagnostics.json`, JSON.stringify(diagnostics, null, 2), "utf8");
    console.log(JSON.stringify({
      ok: blocking.length === 0,
      phase: blocking.length === 0 ? "rendered" : "render-validation",
      deckModified: false,
      outputPath: result.outputPath,
      domPath: result.domPath,
      diagnosticsPath: `${result.outputPath}.diagnostics.json`,
      sourceValidation: validation,
      validation,
      renderValidation,
      diagnostics: renderValidation.diagnostics,
    }, null, 2));
    process.exit(blocking.length === 0 ? 0 : 1);
  }

  usage();
}

main().catch((error) => {
  if (error && error.slideml2JsonParse) {
    console.log(JSON.stringify(error.payload, null, 2));
    process.exit(1);
  }
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
