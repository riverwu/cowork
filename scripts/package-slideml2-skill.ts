#!/usr/bin/env npx tsx
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
const runtimeCliSourcePath = resolve(runtimeSourceDir, "bin/slideml2.js");
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
      initDeck: string;
      setDeck: string;
      addSlide: string;
      insertSlide: string;
      setSlide: string;
      deleteSlide: string;
      validate: string;
      render: string;
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
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" init-deck deck-init.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" add-slide slide-01.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" insert-slide 1 slide-insert.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" set-deck deck-theme.json
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" validate
node "$SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js" render --out deck.pptx
\`\`\`

All CLI commands run from the deck workspace. If \`--deck\` is omitted, the CLI
reads and writes \`./deck.json\` in that workspace.

Supported agent-facing commands are:

- \`init-deck\`
- \`reset-deck\`
- \`set-deck\`
- \`list-slides\`
- \`show-deck\`
- \`add-slide\`
- \`insert-slide\`
- \`set-slide\`
- \`delete-slide\`
- \`diagnose-slide\`
- \`validate\`
- \`render\`

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
\`npm install\`. Run the commands from the deck workspace; omitted \`--deck\`
defaults to \`./deck.json\`.

\`\`\`bash
node /path/to/slideml2/runtime/bin/slideml2.js init-deck deck-init.json
node /path/to/slideml2/runtime/bin/slideml2.js add-slide slide-01.json
node /path/to/slideml2/runtime/bin/slideml2.js insert-slide 1 slide-insert.json
node /path/to/slideml2/runtime/bin/slideml2.js set-deck deck-theme.json
node /path/to/slideml2/runtime/bin/slideml2.js validate
node /path/to/slideml2/runtime/bin/slideml2.js render --out deck.pptx
\`\`\`

This package is runtime-only: it intentionally omits TypeScript source, tests,
examples, development scripts, and node_modules. Rebuilds must happen from the
upstream SlideML2 repository, then a fresh bundled \`runtime/dist/index.js\` can
be packaged again.

## Agent-Facing CLI

The skill exposes one command interface: \`node bin/slideml2.js <command>
[args]\`. Do not expose npm scripts, TypeScript handlers, or tool adapters as
separate agent commands.

Minimal argument files:

\`\`\`json
{ "title": "Deck title", "size": "16x9", "theme": "default" }
\`\`\`

\`\`\`json
{ "id": "cover", "title": "Deck title", "children": [] }
\`\`\`

Do not write a complete deck JSON and jump straight to final PPTX generation
for normal deck creation. Use \`init-deck\` and per-slide \`add-slide\` /
\`insert-slide\` / \`set-slide\` so validation can reject bad slides before they
enter the source deck. Use \`set-deck\` for theme/config changes that preserve
slides; \`reset-deck\` intentionally deletes existing slides.
`;
  await writeFile(join(runtimeRoot, "RUNTIME.md"), readme);
}

async function writeRuntimeCli(runtimeRoot: string): Promise<void> {
  const binDir = join(runtimeRoot, "bin");
  await mkdir(binDir, { recursive: true });
  const target = join(binDir, "slideml2.js");
  await copyFile(runtimeCliSourcePath, target);
  await chmod(target, 0o755);
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
          "Run CLI commands from the deck workspace; omitted --deck defaults to ./deck.json.",
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
          initDeck: "cd $DECK_WORKDIR && node $SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js init-deck deck-init.json",
          setDeck: "cd $DECK_WORKDIR && node $SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js set-deck deck-theme.json",
          addSlide: "cd $DECK_WORKDIR && node $SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js add-slide slide-01.json",
          insertSlide: "cd $DECK_WORKDIR && node $SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js insert-slide 1 slide-insert.json",
          setSlide: "cd $DECK_WORKDIR && node $SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js set-slide 0 slide-01.json",
          deleteSlide: "cd $DECK_WORKDIR && node $SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js delete-slide 0",
          validate: "cd $DECK_WORKDIR && node $SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js validate",
          render: "cd $DECK_WORKDIR && node $SLIDEML2_SKILL_DIR/runtime/bin/slideml2.js render --out deck.pptx",
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
