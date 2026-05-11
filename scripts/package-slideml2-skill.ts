#!/usr/bin/env npx tsx
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillName = "slideml2";
const sourceDir = resolve(repoRoot, "src/catalog/skills/slideml2");
const runtimeSourceDir = resolve(repoRoot, "slideml2");
const defaultOutDir = resolve(repoRoot, "releases/skills/slideml2");
const requiredFiles = ["SKILL.md", "business.md", "LICENSE.txt"] as const;
const requiredRuntimeFiles = [
  "runtime/package.json",
  "runtime/tsconfig.json",
  "runtime/src/index.ts",
  "runtime/src/render.ts",
  "runtime/bin/slideml2.js",
  "runtime/dist/index.js",
  "runtime/dist/render.js",
  "runtime/node_modules/jszip/package.json",
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
The package includes the skill docs plus a runtime/ directory containing
SlideML2 TypeScript source, compiled dist files, CLI tools, examples, and docs.

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
    src/
    dist/
    node_modules/
    bin/slideml2.js
\`\`\`

For Codex-style local skill installs, place that \`slideml2\` directory under
the agent's skills directory, for example \`$CODEX_HOME/skills/slideml2\`.

## Runtime

The \`runtime/\` directory is a standalone SlideML2 package. It includes all
runtime TypeScript source under \`runtime/src\`, compiled JavaScript under
\`runtime/dist\`, examples, and validation/render docs. The agent-facing
entrypoint remains the CLI below.

After unzipping, production dependencies are already bundled. Normal deck
authoring runs directly with Node.js; do not run \`npm install\` for ordinary
use.

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
interface. Run \`npm install\` only when you need development dependencies for
TypeScript rebuilds:

\`\`\`bash
cd "$SLIDEML2_SKILL_DIR/runtime"
npm install
npm run build
\`\`\`
`;
}

async function copyPackageFiles(stageRoot: string): Promise<string[]> {
  const packageRoot = join(stageRoot, skillName);
  await mkdir(packageRoot, { recursive: true });
  const files: string[] = [];
  for (const file of requiredFiles) {
    const source = join(sourceDir, file);
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
  await mkdir(runtimeRoot, { recursive: true });
  const copiedRoots = [
    "README.md",
    "PLAN.md",
    "ROADMAP.md",
    "SPEC.md",
    "VALIDATE.md",
    "package.json",
    "tsconfig.json",
    "src",
    "dist",
    "examples",
  ];
  for (const name of copiedRoots) {
    const source = join(runtimeSourceDir, name);
    if (!existsSync(source)) continue;
    await cp(source, join(runtimeRoot, name), {
      recursive: true,
      filter: (src) => {
        const rel = relative(runtimeSourceDir, src);
        if (!rel) return true;
        return includeRuntimePath(rel);
      },
    });
  }
  await writeRuntimePackageJson(runtimeRoot);
  await writeRuntimeReadme(runtimeRoot);
  await writeRuntimeCli(runtimeRoot);
  await run("npm", ["install", "--omit=dev", "--ignore-scripts"], runtimeRoot);
  return [
    ...copiedRoots.map((name) => `${skillName}/runtime/${name}`),
    `${skillName}/runtime/bin/slideml2.js`,
    `${skillName}/runtime/node_modules`,
  ];
}

function includeRuntimePath(relPath: string): boolean {
  const normalized = relPath.split("\\").join("/");
  if (normalized === ".DS_Store" || normalized.endsWith("/.DS_Store")) return false;
  if (normalized.includes("/node_modules/")) return false;
  if (normalized === "node_modules" || normalized.startsWith("node_modules/")) return false;
  if (normalized === "output" || normalized.startsWith("output/")) return false;
  if (normalized === "outputs" || normalized.startsWith("outputs/")) return false;
  if (normalized === "snapshots" || normalized.startsWith("snapshots/")) return false;
  if (normalized === "slideml2" || normalized.startsWith("slideml2/")) return false;
  if (normalized.endsWith(".test.ts") || normalized.endsWith(".test.js")) return false;
  if (normalized.endsWith(".render-tree.json")) return false;
  if (normalized.split("/").some((part) => /\s+\d+$/.test(part))) return false;
  if (/\s+\d+\.(?:js|ts)$/.test(normalized)) return false;
  if (/\.d\s+\d+\.ts$/.test(normalized)) return false;
  return true;
}

async function writeRuntimePackageJson(runtimeRoot: string): Promise<void> {
  const raw = await readFile(join(runtimeRoot, "package.json"), "utf8");
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  pkg.private = true;
  pkg.scripts = { build: "tsc" };
  const devDependencies = pkg.devDependencies && typeof pkg.devDependencies === "object"
    ? pkg.devDependencies as Record<string, unknown>
    : {};
  pkg.devDependencies = Object.fromEntries(
    Object.entries(devDependencies).filter(([name]) => name === "typescript" || name === "@types/node"),
  );
  await writeFile(join(runtimeRoot, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
}

async function writeRuntimeReadme(runtimeRoot: string): Promise<void> {
  const readme = `# SlideML2 Runtime

This directory is bundled with the SlideML2 skill so another agent can run the
renderer and authoring loop without the full Cowork repository.

## Install

Production dependencies are bundled in the package, so agent-facing CLI
commands can run immediately with Node.js. Run the commands from the deck
workspace; omitted \`deckPath\` defaults to \`./deck.json\`.

\`\`\`bash
node /path/to/slideml2/runtime/bin/slideml2.js create-deck create-deck.json
node /path/to/slideml2/runtime/bin/slideml2.js read-deck read-deck.json
node /path/to/slideml2/runtime/bin/slideml2.js replace-slide replace-slide-01.json
node /path/to/slideml2/runtime/bin/slideml2.js validate-render validate-render.json
\`\`\`

Run \`npm install\` only when you need development dependencies for TypeScript
rebuilds:

\`\`\`bash
npm install
npm run build
\`\`\`

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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  clearRenderDiagnostics,
  createDeck,
  getRenderDiagnostics,
  isBlockingRenderDiagnostic,
  readDeck,
  renderToPptx,
  replaceSlide,
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
  return JSON.parse(await readFile(resolve(process.cwd(), path), "utf8"));
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

async function main() {
  const [command, argPath] = process.argv.slice(2);
  if (!command || !argPath) usage();
  const input = await readJson(argPath);

  if (command === "create-deck") {
    const deckPath = deckPathFrom(input);
    const result = await createDeck(deckPath, input);
    console.log(JSON.stringify({ ...result, deckPath }, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "read-deck") {
    console.log(JSON.stringify(await readDeck(deckPathFrom(input)), null, 2));
    return;
  }

  if (command === "replace-slide") {
    const deckPath = deckPathFrom(input);
    const deck = await readDeck(deckPath);
    const slideValidation = validateSlide(input.slide, deck);
    if (!slideValidation.ok) {
      console.log(JSON.stringify({ ok: false, error: "slide validation failed", validation: slideValidation }, null, 2));
      process.exit(1);
    }
    const slideId = typeof input.slideId === "string" && /^\\\\d+$/.test(input.slideId) ? Number(input.slideId) : input.slideId;
    if (typeof slideId === "number" && slideId === deck.slides.length) {
      deck.slides.push(input.slide);
      const validation = validateDeck(deck, { baseDir: dirname(deckPath) });
      if (!validation.ok) {
        console.log(JSON.stringify({ ok: false, error: "deck validation failed after append", validation }, null, 2));
        process.exit(1);
      }
      await writeDeck(deckPath, deck);
      console.log(JSON.stringify({ ok: true, insertedAt: deck.slides.length - 1, slideCount: deck.slides.length }, null, 2));
      return;
    }
    const result = await replaceSlide(deckPath, slideId, input.slide);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "validate-render") {
    const deckPath = deckPathFrom(input);
    const outputPath = abs(input.outputPath || input.out || deckPath.replace(/\\\\.json$/, ".pptx"));
    const deck = await readDeck(deckPath);
    const validation = validateDeck(deck, { baseDir: dirname(deckPath) });
    if (!validation.ok) {
      console.log(JSON.stringify({ ok: false, error: "deck validation failed", validation }, null, 2));
      process.exit(1);
    }
    if (command === "validate-render" && input.render === false) {
      console.log(JSON.stringify({ ok: true, validation }, null, 2));
      return;
    }
    await mkdir(dirname(outputPath), { recursive: true });
    clearRenderDiagnostics();
    const rendered = sourceToRenderedDeck(deck, { baseDir: dirname(deckPath) });
    const result = await renderToPptx(rendered, outputPath);
    const diagnostics = getRenderDiagnostics();
    const blocking = blockingDiagnostics(diagnostics);
    await writeFile(\`\${result.outputPath}.diagnostics.json\`, JSON.stringify(diagnostics, null, 2), "utf8");
    console.log(JSON.stringify({
      ok: blocking.length === 0,
      outputPath: result.outputPath,
      domPath: result.domPath,
      diagnosticsPath: \`\${result.outputPath}.diagnostics.json\`,
      validation,
      diagnostics: {
        count: diagnostics.length,
        blockingCount: blocking.length,
        blocking: blocking.slice(0, 60),
      },
    }, null, 2));
    process.exit(blocking.length === 0 ? 0 : 1);
  }

  usage();
}

main().catch((error) => {
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
    || entry.includes("/outputs/")
    || entry.includes("/output/")
    || entry.includes("/reports/")
    || entry.endsWith(".render-tree.json")
  )) {
    throw new Error("Zip contains dependency caches or generated output files");
  }
  return entries;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const skillMd = await readFile(join(sourceDir, "SKILL.md"), "utf8");
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
          "Production dependencies are bundled; basic runtime/bin/slideml2.js commands run with Node.js immediately after unzip.",
          "Run CLI commands from the deck workspace; omitted deckPath defaults to ./deck.json.",
          "Run npm install in slideml2/runtime only when rebuilding TypeScript.",
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
        devInstallCommand: "cd slideml2/runtime && npm install",
        devBuildCommand: "cd slideml2/runtime && npm run build",
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
