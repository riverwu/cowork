/**
 * Real-LLM end-to-end driver. Reads markdown, runs the batch agent (which uses
 * progressive disclosure via buildAgentPromptPack including the new components
 * and prompt rules), validates, renders to PPTX, and prints diagnostics.
 *
 * Usage:
 *   pnpm --filter slideml2 exec tsx tools/run-real-llm.ts <markdownPath> [outputPath]
 *
 * Requires LLM_API, LLM_API_KEY, LLM_MODEL env vars.
 */
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  generateDeckWithBatchAgent,
  clearRenderDiagnostics,
  getRenderDiagnostics,
} from "../src/index.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const markdownPath = args[0];
  if (!markdownPath) {
    console.error("usage: run-real-llm.ts <markdownPath> [outputPath]");
    process.exit(1);
  }
  const outputPath = resolve(args[1] || "snapshots/real-llm-wearables/deck.pptx");
  const deckPath = `${outputPath}.deck.json`;
  await mkdir(dirname(outputPath), { recursive: true });
  clearRenderDiagnostics();
  const start = Date.now();
  const result = await generateDeckWithBatchAgent({
    markdownPath: resolve(markdownPath),
    deckPath,
    outputPath,
    theme: "enterprise-light",
    brand: { name: "Wearables 2026", primary: "2563EB" },
    maxSlides: 6,
  });
  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
  const diagnostics = getRenderDiagnostics();
  console.log(`✓ Deck rendered in ${elapsedSec}s`);
  console.log(`  pptx:        ${result.outputPath}`);
  console.log(`  deck json:   ${result.deckPath}`);
  console.log(`  plan:        ${result.planPath}`);
  console.log(`  validation:  ${result.validationPath}`);
  console.log(`  validation ok: ${result.validation.ok}`);
  console.log(`  validation errors: ${result.validation.errors.length}`);
  console.log(`  validation warnings: ${result.validation.warnings.length}`);
  console.log(`  repairs:     ${result.repairCount}`);
  console.log(`  render diagnostics: ${diagnostics.length}`);
  if (diagnostics.length > 0) {
    const counts = diagnostics.reduce<Record<string, number>>((acc, d) => {
      acc[d.code] = (acc[d.code] || 0) + 1;
      return acc;
    }, {});
    for (const [code, count] of Object.entries(counts)) {
      console.log(`    ${code}: ${count}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
