#!/usr/bin/env npx tsx
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillName = "slideml2";
const sourceDir = resolve(repoRoot, "src/catalog/skills/slideml2");
const runtimeSourceDir = resolve(repoRoot, "slideml2");
const goldenSkillPath = resolve(runtimeSourceDir, "SKILL.md");
const defaultOutDir = resolve(repoRoot, "releases/skills/slideml2");
const requiredFiles = ["SKILL.md", "planning-template.md", "business.md", "LICENSE.txt"] as const;
const requiredRuntimeFiles = [
  "runtime/package.json",
  "runtime/bin/slideml2.js",
  "runtime/dist/index.js",
] as const;

interface SkillPackageManifest {
  name: string;
  version: string;
  description: string;
  packageFile: string;
  sha256: string;
  generatedAt: string;
  sourceCommit: string;
  files: string[];
  install: {
    zipRoot: string;
    targetDirectory: string;
    notes: string[];
  };
  runtime: {
    directory: string;
    cli: string;
    defaultDeckPath: string;
    commands: {
      createDeck: string;
      readDeck: string;
      replaceSlide: string;
      validateRender: string;
    };
    devInstallCommand: string;
    devBuildCommand: string;
  };
}

interface PackageOptions {
  outDir: string;
  version?: string;
}

function parseArgs(argv: string[]): PackageOptions {
  let outDir = defaultOutDir;
  let version: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--out-dir") {
      outDir = resolve(repoRoot, argv[++i] || "");
    } else if (arg === "--version") {
      version = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { outDir, version };
}

function printHelp(): void {
  console.log(`Usage: npx tsx scripts/package-slideml2-skill.ts [--out-dir path] [--version x.y.z]

Creates a zip package for installing the SlideML2 skill in another agent.
The package includes the skill docs plus a runtime/ directory containing only
the executable runtime: one bundled dist file, the CLI entrypoint, and a
minimal ESM package.json. TypeScript source, tests, examples, development
scripts, and node_modules are intentionally excluded.

Output:
  releases/skills/slideml2/slideml2-skill-v<version>.zip
  releases/skills/slideml2/slideml2-skill-v<version>.sha256
  releases/skills/slideml2/slideml2-skill-v<version>.manifest.json`);
}

function parseSkillFrontmatter(text: string): { version: string; description: string } {
  const block = text.match(/^---\n([\s\S]*?)\n---/)?.[1];
  if (!block) throw new Error("SKILL.md is missing YAML frontmatter");
  const version = block.match(/^version:\s*(.+)$/m)?.[1]?.trim();
  const rawDescription = block.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (!version) throw new Error("SKILL.md frontmatter is missing version");
  if (!rawDescription) throw new Error("SKILL.md frontmatter is missing description");
  const description = rawDescription.replace(/^["']|["']$/g, "");
  return { version, description };
}

async function currentCommit(): Promise<string> {
  try {
    return (await run("git", ["rev-parse", "--short=12", "HEAD"], repoRoot)).trim();
  } catch {
    return "unknown";
  }
}

async function run(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`${command} ${args.join(" ")} failed with code ${code}\n${stderr}`));
    });
  });
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex");
}

async function createReadme(version: string, description: string): Promise<string> {
  return `# SlideML2 Skill Package

Version: ${version}

${description}

## Install

Unzip this archive so the target agent has a skill directory like:

\`\`\`
slideml2/
  SKILL.md
  business.md
  LICENSE.txt
  manifest.json
  runtime/
    package.json
    dist/
    RUNTIME.md
    bin/slideml2.js
\`\`\`

For Codex-style local skill installs, place that \`slideml2\` directory under
the agent's skills directory, for example \`$CODEX_HOME/skills/slideml2\`.

## Runtime

The \`runtime/\` directory is a standalone executable SlideML2 package. It
includes bundled compiled JavaScript under \`runtime/dist\` and the CLI
entrypoint below. It intentionally does not include TypeScript source, tests,
examples, development scripts, or node_modules.

After unzipping, normal deck authoring runs directly with Node.js; do not run
\`npm install\` for ordinary use.

\`\`\`bash
export SLIDEML2_SKILL_DIR=/path/to/slideml2
mkdir -p /path/to/deck-workdir
cd /path/to/deck-workdir
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" create-deck create-deck.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" replace-slide replace-slide-01.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" validate-render validate-render.json
\`\`\`

All CLI commands run from the deck workspace. If an argument file omits
\`deckPath\`, the CLI reads and writes \`./deck.json\` in that workspace.

Supported agent-facing commands are:

- \`create-deck\`
- \`read-deck\`
- \`replace-slide\`
- \`validate-render\`

Do not call TypeScript handlers, npm scripts, or tool adapters as the agent
interface. Rebuilds must happen from the upstream SlideML2 repository; this
install package is runtime-only.
`;
}

async function copyPackageFiles(stageRoot: string): Promise<string[]> {
  const packageRoot = join(stageRoot, skillName);
  await mkdir(packageRoot, { recursive: true });
  const files: string[] = [];
  for (const file of requiredFiles) {
    const source = file === "SKILL.md"
      ? goldenSkillPath
      : file === "planning-template.md"
        ? join(runtimeSourceDir, file)
        : join(sourceDir, file);
    if (!existsSync(source)) throw new Error(`Required skill file is missing: ${relative(repoRoot, source)}`);
    await copyFile(source, join(packageRoot, file));
    files.push(`${skillName}/${file}`);
  }
  return files;
}

async function copyRuntimeFiles(stageRoot: string): Promise<string[]> {
  await rm(join(runtimeSourceDir, "dist"), { recursive: true, force: true });
  await run("pnpm", ["--dir", "slideml2", "build"], repoRoot);
  const packageRoot = join(stageRoot, skillName);
  const runtimeRoot = join(packageRoot, "runtime");
  const runtimeDistRoot = join(runtimeRoot, "dist");
  await mkdir(runtimeDistRoot, { recursive: true });
  await run("pnpm", [
    "exec",
    "esbuild",
    join(runtimeSourceDir, "dist/index.js"),
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node20",
    `--outfile=${join(runtimeDistRoot, "index.js")}`,
  ], repoRoot);
  await writeRuntimePackageJson(runtimeRoot);
  await writeRuntimeReadme(runtimeRoot);
  await writeRuntimeCli(runtimeRoot);
  const distFiles = await listFiles(join(runtimeRoot, "dist"), `${skillName}/runtime/dist`);
  return [
    `${skillName}/runtime/package.json`,
    ...distFiles,
    `${skillName}/runtime/RUNTIME.md`,
    `${skillName}/runtime/bin/slideml2.js`,
  ];
}

async function writeRuntimePackageJson(runtimeRoot: string): Promise<void> {
  const raw = await readFile(join(runtimeSourceDir, "package.json"), "utf8");
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  const runtimePackage = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    private: true,
    type: pkg.type || "module",
    main: pkg.main || "dist/index.js",
    license: pkg.license,
  };
  await writeFile(join(runtimeRoot, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`);
}

async function writeRuntimeReadme(runtimeRoot: string): Promise<void> {
  const readme = `# SlideML2 Runtime

This directory is bundled with the SlideML2 skill so another agent can run the
renderer and authoring loop without the full Cowork repository.

## Install

Runtime dependencies are bundled into \`runtime/dist/index.js\`, so
agent-facing CLI commands can run immediately with Node.js without
\`npm install\`. Run the commands from the deck workspace; omitted \`deckPath\`
defaults to \`./deck.json\`.

\`\`\`bash
node /path/to/slideml2/runtime/bin/slideml2.js create-deck create-deck.json
node /path/to/slideml2/runtime/bin/slideml2.js read-deck read-deck.json
node /path/to/slideml2/runtime/bin/slideml2.js replace-slide replace-slide-01.json
node /path/to/slideml2/runtime/bin/slideml2.js validate-render validate-render.json
\`\`\`

This package is runtime-only: it intentionally omits TypeScript source, tests,
examples, development scripts, and node_modules. Rebuilds must happen from the
upstream SlideML2 repository, then a fresh bundled \`runtime/dist/index.js\` can
be packaged again.

## Agent-Facing CLI

The skill exposes one command interface: \`node bin/slideml2.js <command>
<args.json>\`. Do not expose npm scripts, TypeScript handlers, or tool adapters
as separate agent commands.

Minimal argument files:

\`\`\`json
{ "title": "Deck title", "size": "16x9", "theme": "default" }
\`\`\`

\`\`\`json
{ "slideId": 0, "slide": { "id": "cover", "title": "Deck title", "children": [] } }
\`\`\`

\`\`\`json
{ "render": true, "outputPath": "deck.pptx" }
\`\`\`

Do not write a complete deck JSON and jump straight to final PPTX generation
for normal deck creation. Use \`create-deck\` and per-slide \`replace-slide\` so
validation can reject bad slides before they enter the source deck.
`;
  await writeFile(join(runtimeRoot, "RUNTIME.md"), readme);
}

async function writeRuntimeCli(runtimeRoot: string): Promise<void> {
  const binDir = join(runtimeRoot, "bin");
  await mkdir(binDir, { recursive: true });
  const cli = `#!/usr/bin/env node
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
    message: "Could not parse " + filePath + ": " + message,
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
  const explicit = message.match(/line\\s+(\\d+)\\s+column\\s+(\\d+)/i);
  if (explicit) return { line: Number(explicit[1]), column: Number(explicit[2]) };
  const match = message.match(/position\\s+(\\d+)/i);
  const position = match ? Number(match[1]) : 0;
  let line = 1;
  let column = 1;
  for (let i = 0; i < Math.min(position, text.length); i += 1) {
    if (text[i] === "\\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function jsonExcerpt(text, line, column) {
  const lines = text.split(/\\r?\\n/);
  const start = Math.max(1, line - 1);
  const end = Math.min(lines.length, line + 1);
  const width = String(end).length;
  const out = [];
  for (let n = start; n <= end; n += 1) {
    const prefix = n === line ? ">" : " ";
    out.push(prefix + " " + String(n).padStart(width, " ") + " | " + (lines[n - 1] || ""));
    if (n === line) out.push(" ".repeat(width + 4) + "| " + " ".repeat(Math.max(0, column - 1)) + "^");
  }
  return out.join("\\n");
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
    const slideId = typeof input.slideId === "string" && /^\\d+$/.test(input.slideId) ? Number(input.slideId) : input.slideId;
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
    const outputPath = abs(input.outputPath || input.out || deckPath.replace(/\\\\.json$/, ".pptx"));
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
    await writeFile(\`\${result.outputPath}.diagnostics.json\`, JSON.stringify(diagnostics, null, 2), "utf8");
    console.log(JSON.stringify({
      ok: blocking.length === 0,
      phase: blocking.length === 0 ? "rendered" : "render-validation",
      deckModified: false,
      outputPath: result.outputPath,
      domPath: result.domPath,
      diagnosticsPath: \`\${result.outputPath}.diagnostics.json\`,
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
`;
  await writeFile(join(binDir, "slideml2.js"), cli, { mode: 0o755 });
}

async function verifyZip(zipPath: string): Promise<string[]> {
  const listing = await run("zipinfo", ["-1", zipPath], repoRoot);
  const entries = listing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const file of requiredFiles) {
    const entry = `${skillName}/${file}`;
    if (!entries.includes(entry)) throw new Error(`Zip is missing ${entry}`);
  }
  for (const file of requiredRuntimeFiles) {
    const entry = `${skillName}/${file}`;
    if (!entries.includes(entry)) throw new Error(`Zip is missing ${entry}`);
  }
  if (entries.some((entry) =>
    entry.includes("/node_modules/.cache/")
    || entry.includes("/runtime/node_modules/")
    || entry.includes("/runtime/src/")
    || entry.endsWith(".ts")
    || entry.includes(".test.")
    || entry.includes("/outputs/")
    || entry.includes("/output/")
    || entry.includes("/reports/")
    || entry.endsWith(".render-tree.json")
  )) {
    throw new Error("Zip contains dependency caches or generated output files");
  }
  return entries;
}

async function listFiles(root: string, zipPrefix: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const out: string[] = [];
  const walk = async (dir: string, prefix: string) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const nextPrefix = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(full, nextPrefix);
      } else if (entry.isFile()) {
        out.push(nextPrefix);
      }
    }
  };
  await walk(root, zipPrefix);
  return out;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const skillMd = await readFile(goldenSkillPath, "utf8");
  const frontmatter = parseSkillFrontmatter(skillMd);
  const version = options.version || frontmatter.version;
  const packageBase = `${skillName}-skill-v${version}`;
  const outDir = options.outDir;
  const zipPath = join(outDir, `${packageBase}.zip`);
  const shaPath = join(outDir, `${packageBase}.sha256`);
  const manifestPath = join(outDir, `${packageBase}.manifest.json`);
  const stageRoot = await mkdtemp(join(tmpdir(), "slideml2-skill-package-"));

  try {
    await mkdir(outDir, { recursive: true });
    await rm(zipPath, { force: true });
    await rm(shaPath, { force: true });
    await rm(manifestPath, { force: true });

    const packageFiles = await copyPackageFiles(stageRoot);
    const runtimeFiles = await copyRuntimeFiles(stageRoot);
    const packageRoot = join(stageRoot, skillName);
    const sourceCommit = await currentCommit();
    const partialManifest = {
      name: skillName,
      version,
      description: frontmatter.description,
      generatedAt: new Date().toISOString(),
      sourceCommit,
      files: [...packageFiles, ...runtimeFiles, `${skillName}/README.md`, `${skillName}/manifest.json`, `${skillName}/runtime/RUNTIME.md`].sort(),
      install: {
        zipRoot: skillName,
        targetDirectory: "$CODEX_HOME/skills/slideml2",
        notes: [
          "Unzip preserving the slideml2 directory.",
          "Runtime dependencies are bundled into runtime/dist/index.js; basic runtime/bin/slideml2.js commands run with Node.js immediately after unzip.",
          "Run CLI commands from the deck workspace; omitted deckPath defaults to ./deck.json.",
          "The runtime package is executable-only and intentionally omits TypeScript source, tests, examples, development scripts, and node_modules.",
          "The agent-facing interface is the CLI only; do not expose TypeScript handlers or npm scripts as separate command interfaces.",
          "Generated PPT outputs and dependency caches are intentionally excluded.",
        ],
      },
      runtime: {
        directory: "slideml2/runtime",
        cli: "node $SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js",
        defaultDeckPath: "./deck.json",
        commands: {
          createDeck: "cd $DECK_WORKDIR && node $SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js create-deck create-deck.json",
          readDeck: "cd $DECK_WORKDIR && node $SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js read-deck read-deck.json",
          replaceSlide: "cd $DECK_WORKDIR && node $SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js replace-slide replace-slide-01.json",
          validateRender: "cd $DECK_WORKDIR && node $SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js validate-render validate-render.json",
        },
        devInstallCommand: "not supported in the skill package; rebuild from the upstream SlideML2 repository",
        devBuildCommand: "not supported in the skill package; rebuild from the upstream SlideML2 repository",
      },
    };
    await writeFile(join(packageRoot, "README.md"), await createReadme(version, frontmatter.description));
    await writeFile(join(packageRoot, "manifest.json"), `${JSON.stringify(partialManifest, null, 2)}\n`);

    await run("zip", ["-X", "-r", zipPath, skillName], stageRoot);
    const digest = await sha256(zipPath);
    const entries = await verifyZip(zipPath);
    const size = (await stat(zipPath)).size;
    const manifest: SkillPackageManifest = {
      ...partialManifest,
      packageFile: basename(zipPath),
      sha256: digest,
      files: entries,
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(shaPath, `${digest}  ${basename(zipPath)}\n`);

    console.log(`Created ${relative(repoRoot, zipPath)}`);
    console.log(`Size: ${size} bytes`);
    console.log(`SHA-256: ${digest}`);
    console.log(`Manifest: ${relative(repoRoot, manifestPath)}`);
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
