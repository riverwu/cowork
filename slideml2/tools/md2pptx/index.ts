/**
 * md2pptx — agent loop that turns a markdown document into a SlideML2 deck
 * and renders it to .pptx.
 *
 * Usage:
 *   pnpm --filter slideml2 exec tsx tools/md2pptx <input.md> <output.pptx>
 *
 * Requires LLM_API, LLM_API_KEY, LLM_MODEL env vars.
 */

import { mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentLoop, type AgentEvent } from "./agent-loop.js";
import type { ToolContext } from "./tools.js";
import { clearRenderDiagnostics } from "../../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("usage: md2pptx <input.md> <output.pptx>");
    process.exit(1);
  }
  const inputPath = isAbsolute(args[0]!) ? args[0]! : resolve(process.cwd(), args[0]!);
  const outputPath = isAbsolute(args[1]!) ? args[1]! : resolve(process.cwd(), args[1]!);
  const apiKey = process.env.LLM_API_KEY;
  const baseURL = process.env.LLM_API;
  const model = process.env.LLM_MODEL;
  if (!apiKey || !baseURL || !model) {
    console.error("Missing LLM_API, LLM_API_KEY, or LLM_MODEL");
    process.exit(1);
  }

  const systemPrompt = await readFile(resolve(HERE, "SLIDEML.md"), "utf8");
  const markdownPreview = (await readFile(inputPath, "utf8")).slice(0, 200);
  await mkdir(dirname(outputPath), { recursive: true });
  // Mount a sandbox root the agent can read/write within. We allow both the
  // input markdown's directory and the output target's directory.
  const inputDir = dirname(inputPath);
  const outputDir = dirname(outputPath);
  // Fall back to repo root for SlideML2 internals; use a common ancestor when
  // input and output are in different trees by simply allowing the outer
  // ancestor directory.
  const rootDir = commonAncestor([inputDir, outputDir, REPO_ROOT]);

  const context: ToolContext = { cwd: process.cwd(), rootDir };

  const userPrompt = [
    `Input markdown path: ${inputPath}`,
    `Output PPTX path:    ${outputPath}`,
    `Working deck JSON:   ${outputPath}.deck.json`,
    "",
    "First lines of the markdown for orientation (first 200 chars):",
    "```",
    markdownPreview,
    "```",
    "",
    "Read the full markdown with the read_file tool, design the deck, and render it. Stop when done by calling the `stop` tool.",
  ].join("\n");

  clearRenderDiagnostics();
  const start = Date.now();
  let stepCount = 0;
  const onEvent = (event: AgentEvent) => {
    if (event.kind === "start") {
      stepCount = event.step + 1;
      process.stdout.write(`\n[step ${stepCount}]`);
    } else if (event.kind === "assistant_text") {
      process.stdout.write(`\n  ${event.text.slice(0, 400)}`);
    } else if (event.kind === "tool_call") {
      const inputSummary = JSON.stringify(event.input).slice(0, 140);
      process.stdout.write(`\n  → ${event.name}(${inputSummary})`);
    } else if (event.kind === "tool_result") {
      process.stdout.write(`\n    ← ${event.ok ? "ok" : "ERR"} ${event.sample || ""}`);
    } else if (event.kind === "stop") {
      process.stdout.write(`\n  [stop] ${event.summary}`);
    } else if (event.kind === "done") {
      process.stdout.write(`\n[done] reason=${event.reason} steps=${event.steps}`);
    }
  };

  const result = await runAgentLoop({
    apiKey,
    baseURL,
    model,
    maxTokens: maxTokensFromEnv(),
    maxSteps: 120,
    systemPrompt,
    userPrompt,
    context,
    onEvent,
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log("\n");
  console.log(`finished in ${elapsed}s — steps=${result.steps} stop=${result.stopReason}`);
  console.log(`tokens in=${result.inputTokens} out=${result.outputTokens}`);
  if (result.finalSummary) console.log(`summary: ${result.finalSummary}`);
  console.log(`pptx: ${outputPath}`);
}

function maxTokensFromEnv(): number {
  const raw = process.env.LLM_MAX_TOKENS;
  const parsed = raw ? Number(raw) : 16_000;
  if (!Number.isFinite(parsed) || parsed < 4096) return 16_000;
  return Math.floor(parsed);
}

function commonAncestor(paths: string[]): string {
  if (paths.length === 0) return "/";
  const segments = paths.map((p) => p.split("/").filter(Boolean));
  const common: string[] = [];
  for (let i = 0; i < segments[0]!.length; i++) {
    const segment = segments[0]![i];
    if (segments.every((s) => s[i] === segment)) common.push(segment!);
    else break;
  }
  return "/" + common.join("/");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
