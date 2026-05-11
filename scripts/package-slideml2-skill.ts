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
  "runtime/tools/render-source-deck.ts",
  "runtime/tools/md2pptx/tools.ts",
  "runtime/dist/index.js",
  "runtime/dist/render.js",
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
    installCommand: string;
    buildCommand: string;
    renderCommand: string;
    md2pptxCommand: string;
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
    tools/
\`\`\`

For Codex-style local skill installs, place that \`slideml2\` directory under
the agent's skills directory, for example \`$CODEX_HOME/skills/slideml2\`.

## Runtime

The \`runtime/\` directory is a standalone SlideML2 package. It includes all
runtime TypeScript source under \`runtime/src\`, compiled JavaScript under
\`runtime/dist\`, authoring/rendering tools under \`runtime/tools\`, examples,
and validation/render docs.

After unzipping:

\`\`\`bash
cd slideml2/runtime
npm install
npm run build
npm run render -- examples/data-binding-business-analysis.json output/example.pptx
\`\`\`

LLM-backed markdown-to-PPTX generation is also included:

\`\`\`bash
cd slideml2/runtime
LLM_API=... LLM_API_KEY=... LLM_MODEL=... npm run md2pptx -- input.md output.pptx
\`\`\`

For agents that need tool adapters, start from
\`runtime/tools/md2pptx/tools.ts\`. It contains standalone implementations for
\`describe_schema\`, \`create_deck\`, \`read_deck\`, \`replace_slide\`,
\`patch_deck\`, and \`validate_render\` using the included SlideML2 runtime.
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
    "tools",
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
  return copiedRoots.map((name) => `${skillName}/runtime/${name}`);
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
  pkg.scripts = {
    ...(pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts as Record<string, unknown> : {}),
    build: "tsc",
    render: "tsx tools/render-source-deck.ts",
    md2pptx: "tsx tools/md2pptx/index.ts",
    "list-components": "tsx tools/list-components.ts",
  };
  const devDependencies = pkg.devDependencies && typeof pkg.devDependencies === "object"
    ? pkg.devDependencies as Record<string, unknown>
    : {};
  if (!devDependencies.tsx) devDependencies.tsx = "^4.20.0";
  pkg.devDependencies = devDependencies;
  await writeFile(join(runtimeRoot, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
}

async function writeRuntimeReadme(runtimeRoot: string): Promise<void> {
  const readme = `# SlideML2 Runtime

This directory is bundled with the SlideML2 skill so another agent can run the
renderer and authoring loop without the full Cowork repository.

## Install

\`\`\`bash
npm install
npm run build
\`\`\`

## Render A Deck

\`\`\`bash
npm run render -- examples/data-binding-business-analysis.json output/example.pptx
\`\`\`

This writes the PPTX plus validation, diagnostics, inspect-layout, and
render-tree JSON files next to the output path.

## Markdown-To-PPTX Agent Loop

\`\`\`bash
LLM_API=... LLM_API_KEY=... LLM_MODEL=... npm run md2pptx -- input.md output.pptx
\`\`\`

## Tool Adapter Source

\`tools/md2pptx/tools.ts\` contains standalone TypeScript implementations for:

- describe_schema
- create_deck
- read_deck
- replace_slide
- patch_deck
- validate_render

Agents with their own tool/plugin systems can wrap those handlers directly.
`;
  await writeFile(join(runtimeRoot, "RUNTIME.md"), readme);
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
    entry.includes("/node_modules/")
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
          "Run npm install in slideml2/runtime before using runtime CLI commands.",
          "Wrap runtime/tools/md2pptx/tools.ts for agent-native create_deck/replace_slide/validate_render tools.",
          "Generated PPT outputs and dependency caches are intentionally excluded.",
        ],
      },
      runtime: {
        directory: "slideml2/runtime",
        installCommand: "cd slideml2/runtime && npm install",
        buildCommand: "cd slideml2/runtime && npm run build",
        renderCommand: "cd slideml2/runtime && npm run render -- deck.json output.pptx",
        md2pptxCommand: "cd slideml2/runtime && LLM_API=... LLM_API_KEY=... LLM_MODEL=... npm run md2pptx -- input.md output.pptx",
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
