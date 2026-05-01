import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
  inspectLayout,
  readDeck,
  renderToPptx,
  sourceToRenderedDeck,
  validateDeck,
} from "../src/index.js";

async function main() {
  const [deckArg, outputArg] = process.argv.slice(2);
  if (!deckArg || !outputArg) {
    console.error("usage: render-source-deck <deck.json> <output.pptx>");
    process.exit(1);
  }
  const deckPath = isAbsolute(deckArg) ? deckArg : resolve(process.cwd(), deckArg);
  const outputPath = isAbsolute(outputArg) ? outputArg : resolve(process.cwd(), outputArg);
  const deck = await readDeck(deckPath);
  const validation = validateDeck(deck);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(`${outputPath}.validation.json`, JSON.stringify(validation, null, 2), "utf8");
  if (!validation.ok) throw new Error(`Deck validation failed with ${validation.errors.length} error(s)`);

  clearRenderDiagnostics();
  const rendered = sourceToRenderedDeck(deck);
  await writeFile(`${outputPath}.inspect-layout.json`, JSON.stringify(inspectLayout(rendered), null, 2), "utf8");
  clearRenderDiagnostics();
  const result = await renderToPptx(rendered, outputPath);
  const diagnostics = getRenderDiagnostics();
  await writeFile(`${outputPath}.diagnostics.json`, JSON.stringify(diagnostics, null, 2), "utf8");
  console.log(JSON.stringify({
    outputPath: result.outputPath,
    domPath: result.domPath,
    validationErrors: validation.errors.length,
    validationWarnings: validation.warnings.length,
    diagnostics: diagnostics.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
