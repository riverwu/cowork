import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  getSettings,
  getKnowledgeStats: async () => ({
    totalSources: 0,
    totalDocuments: 0,
    indexedDocuments: 0,
    pendingDocuments: 0,
    excludedDocuments: 0,
  }),
  listSources: async () => [],
  listSourceCapabilities: async () => [],
  listSourceEntities: async () => [],
  listDocuments: async () => [],
  listSearchableDocuments: async () => [],
  createArtifact: async () => undefined,
  upsertCoreFact: async () => undefined,
  createMemory: async () => undefined,
}));

vi.mock("@/lib/memory", () => ({
  retrieveMemoryContext: async () => ({ coreFacts: [], relevantMemories: [], relevantEpisodes: [] }),
  buildMemoryPrompt: () => "",
  extractMemories: async () => undefined,
}));

vi.mock("@/lib/mcp", () => ({
  mcpManager: {
    waitForReady: async () => undefined,
    getAllTools: () => ({}),
    getServerStatus: () => [],
  },
}));

vi.mock("@/lib/knowledge", () => ({
  retrieveRelevant: async () => [],
  buildKnowledgeContext: () => "",
  generateEmbedding: async () => undefined,
  generateEmbeddings: async () => [],
}));

vi.mock("@/lib/tauri", () => ({
  isTauriRuntime: () => false,
  isElectronRuntime: () => false,
  isDesktopRuntime: () => true,
  invokeDesktop,
  listenDesktop,
  startWindowDrag: async () => undefined,
  openPath: async () => undefined,
  revealInFolder: async () => undefined,
  pickFolder: async () => null,
  pickFiles: async () => null,
  scanDirectory,
  readFileText,
  parseDocument,
  extractDocumentTextToCache,
  startKnowledgeIndex: notAvailable("startKnowledgeIndex"),
  onKnowledgeIndexProgress: async () => () => undefined,
  onKnowledgeIndexFile: async () => () => undefined,
  onKnowledgeIndexFiles: async () => () => undefined,
  onKnowledgeIndexDone: async () => () => undefined,
  deleteFile,
  deleteDirectory,
  writeFile,
  listDirectory,
  grep,
  ripgrepSearch: grep,
  runPythonScript,
  initPythonEnv: async () => "Python environment available.",
  installPythonPackage,
  initNodeEnv: async () => "Node environment available.",
  installNodePackage,
  getNodePath,
  runNodeScript,
  debugLogInit,
  debugLogAppend,
  debugLogCopyArtifact,
  debugLogOpenRoot,
  slideml2DescribeSchema,
  slideml2CreateDeck,
  slideml2ReadDeck,
  slideml2ReplaceSlide,
  slideml2PatchDeck,
  slideml2ValidateRender,
  webFetch,
  webSearch,
  browserAction: notAvailable("browserAction"),
  shellExec,
  shellExecStream,
  ensureUvInstalled: async () => "uv check skipped in Node flow test.",
  getEnv: async (key: string) => process.env[key] || null,
  httpPost,
  httpStreamPost,
  downloadUrl,
  readFileBase64,
}));

import {
  loadPptGenerationFlowScenario,
  runPptGenerationFlowCaseSuite,
  runPptGenerationFlowCaseDirectory,
  runPptGenerationFlowScenario,
  verifyPptGenerationFlow,
  writePptGenerationFlowReport,
  writePptGenerationFlowSuiteReports,
} from "./ppt-generation-flow-runner";

const caseRoot = process.env.COWORK_PPT_FLOW_CASE_ROOT;
const caseDirectory = process.env.COWORK_PPT_FLOW_CASE_DIR;
const scenarioPath = process.env.COWORK_PPT_FLOW_SCENARIO;
const runLive = caseRoot || caseDirectory || scenarioPath ? it : it.skip;

describe("live Cowork PPT generation flow", () => {
  runLive("runs the configured scenario through the real runAgent loop", async () => {
    if (caseRoot) {
      const path = await import("node:path");
      const suite = await runPptGenerationFlowCaseSuite(caseRoot);
      const outputDir = process.env.COWORK_PPT_FLOW_SUITE_REPORT_DIR
        || path.join(caseRoot, "reports", new Date(suite.startedAt).toISOString().replace(/[:.]/g, "-"));
      await writePptGenerationFlowSuiteReports(outputDir, suite);
      expect(suite.failCount, suite.cases.flatMap((item) => item.failures.map((failure) => `${item.id}: ${failure}`)).join("\n")).toBe(0);
      return;
    }

    if (caseDirectory) {
      const run = await runPptGenerationFlowCaseDirectory(caseDirectory);
      const reportPath = process.env.COWORK_PPT_FLOW_REPORT;
      if (reportPath) await writePptGenerationFlowReport(reportPath, run.result, run.verification, run.caseDefinition);
      expect(run.verification.ok, run.verification.failures.join("\n")).toBe(true);
      return;
    }

    const scenario = await loadPptGenerationFlowScenario(scenarioPath!);
    const result = await runPptGenerationFlowScenario(scenario);
    const verification = await verifyPptGenerationFlow(result);
    const reportPath = process.env.COWORK_PPT_FLOW_REPORT;
    if (reportPath) await writePptGenerationFlowReport(reportPath, result, verification);
    expect(verification.ok, verification.failures.join("\n")).toBe(true);
  }, Number(process.env.COWORK_PPT_FLOW_TIMEOUT_MS || 900_000));
});

async function getSettings() {
  const env = settingsFromEnv();
  const stored = await settingsFromDesktopDb();
  return {
    llmProvider: (env.llmProvider || stored.llmProvider || "anthropic") as "anthropic" | "openai",
    anthropicApiKey: env.anthropicApiKey || stored.anthropicApiKey,
    anthropicBaseUrl: env.anthropicBaseUrl || stored.anthropicBaseUrl,
    openaiApiKey: env.openaiApiKey || stored.openaiApiKey,
    openaiBaseUrl: env.openaiBaseUrl || stored.openaiBaseUrl,
    modelId: env.modelId || stored.modelId,
    modelContextTokens: env.modelContextTokens || stored.modelContextTokens,
    modelMaxOutputTokens: env.modelMaxOutputTokens || stored.modelMaxOutputTokens,
    imageProvider: env.imageProvider || stored.imageProvider,
    imageApiKey: env.imageApiKey || stored.imageApiKey,
    imageBaseUrl: env.imageBaseUrl || stored.imageBaseUrl,
    imageModel: env.imageModel || stored.imageModel,
    debugLogEnabled: false,
  };
}

function settingsFromEnv(): Record<string, unknown> {
  return {
    llmProvider: process.env.COWORK_LLM_PROVIDER || process.env.LLM_PROVIDER,
    anthropicApiKey: process.env.COWORK_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
    anthropicBaseUrl: process.env.COWORK_ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL,
    openaiApiKey: process.env.COWORK_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.COWORK_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL,
    modelId: process.env.COWORK_LLM_MODEL || process.env.LLM_MODEL,
    modelContextTokens: optionalNumber(process.env.COWORK_MODEL_CONTEXT_TOKENS),
    modelMaxOutputTokens: optionalNumber(process.env.COWORK_MODEL_MAX_OUTPUT_TOKENS),
    imageProvider: process.env.COWORK_IMAGE_PROVIDER,
    imageApiKey: process.env.COWORK_IMAGE_API_KEY || process.env.ARK_API_KEY,
    imageBaseUrl: process.env.COWORK_IMAGE_BASE_URL || process.env.ARK_API,
    imageModel: process.env.COWORK_IMAGE_MODEL || process.env.ARK_MODEL,
  };
}

function optionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function settingsFromDesktopDb(): Promise<Record<string, unknown>> {
  try {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { spawnSync } = await import("node:child_process");
    const dbPath = process.env.COWORK_DB_PATH || path.join(os.homedir(), "Library", "Application Support", "cowork", "cowork.db");
    if (!fs.existsSync(dbPath)) return {};
    const result = spawnSync("/usr/bin/sqlite3", ["-json", dbPath, "SELECT key,value FROM settings"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    if (result.status !== 0 || !result.stdout.trim()) return {};
    const rows = JSON.parse(result.stdout) as Array<{ key?: string; value?: string }>;
    const map = new Map(rows.map((row) => [row.key || "", row.value || ""]));
    return {
      llmProvider: map.get("llm_provider"),
      anthropicApiKey: map.get("anthropic_api_key"),
      anthropicBaseUrl: map.get("anthropic_base_url"),
      openaiApiKey: map.get("openai_api_key"),
      openaiBaseUrl: map.get("openai_base_url"),
      modelId: map.get("model_id"),
      modelContextTokens: optionalNumber(map.get("model_context_tokens")),
      modelMaxOutputTokens: optionalNumber(map.get("model_max_output_tokens")),
      imageProvider: map.get("image_provider"),
      imageApiKey: map.get("image_api_key"),
      imageBaseUrl: map.get("image_base_url"),
      imageModel: map.get("image_model"),
    };
  } catch {
    return {};
  }
}

type FileInfoLike = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_at: number;
  extension?: string;
};

type ProcessResult = {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out?: boolean;
};

type Slideml2DiagnosticLike = {
  code: string;
  severity?: string;
  message?: string;
  slideId?: string;
  nodeId?: string;
  [key: string]: unknown;
};

type JsonPatchOp = {
  op: "add" | "replace" | "remove" | "move" | "copy" | "test";
  path: string;
  value?: unknown;
  from?: string;
};

function notAvailable(name: string) {
  return async (..._args: unknown[]): Promise<never> => {
    throw new Error(`${name} is not available in the Node PPT flow test adapter.`);
  };
}

async function invokeDesktop<T>(command: string, _args?: Record<string, unknown>): Promise<T> {
  throw new Error(`invokeDesktop(${command}) is not available in the Node PPT flow test adapter.`);
}

async function listenDesktop<T>(
  _channel: string,
  _handler: (event: { payload: T }) => void,
): Promise<() => void> {
  return () => undefined;
}

async function readFileText(filePath: string): Promise<string> {
  const fs = await import("node:fs/promises");
  return fs.readFile(filePath, "utf8");
}

async function parseDocument(filePath: string): Promise<string> {
  return readFileText(filePath);
}

async function readFileBase64(filePath: string): Promise<string> {
  const fs = await import("node:fs/promises");
  const buf = await fs.readFile(filePath);
  return buf.toString("base64");
}

async function writeFile(filePath: string, content: string): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function deleteFile(filePath: string): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.unlink(filePath).catch((err: unknown) => {
    if ((err as { code?: string }).code !== "ENOENT") throw err;
  });
}

async function deleteDirectory(dirPath: string): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.rm(dirPath, { recursive: true, force: true });
}

async function listDirectory(dirPath: string): Promise<FileInfoLike[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const out: FileInfoLike[] = [];
  for (const entry of entries) {
    const abs = path.join(dirPath, entry.name);
    const stat = await fs.stat(abs);
    out.push({
      name: entry.name,
      path: abs,
      is_dir: entry.isDirectory(),
      size: stat.size,
      modified_at: Math.floor(stat.mtimeMs / 1000),
      extension: entry.isDirectory() ? "" : path.extname(entry.name).replace(/^\./, ""),
    });
  }
  return out.sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name));
}

async function scanDirectory(dirPath: string): Promise<FileInfoLike[]> {
  const results: FileInfoLike[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await listDirectory(current)) {
      results.push(entry);
      if (entry.is_dir) await walk(entry.path);
    }
  }
  await walk(dirPath);
  return results;
}

async function grep(directory: string, pattern: string, maxResults = 50): Promise<Array<{ path: string; line_number: number; line: string }>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const matches: Array<{ path: string; line_number: number; line: string }> = [];
  const skip = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo"]);
  async function walk(dir: string): Promise<void> {
    if (matches.length >= maxResults) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (matches.length >= maxResults) return;
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) await walk(path.join(dir, entry.name));
        continue;
      }
      const abs = path.join(dir, entry.name);
      const text = await fs.readFile(abs, "utf8").catch(() => "");
      if (!text) continue;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
        if (lines[i]!.includes(pattern)) matches.push({ path: abs, line_number: i + 1, line: lines[i]! });
      }
    }
  }
  await walk(directory);
  return matches;
}

async function extractDocumentTextToCache(filePath: string, cachePath: string, previewChars = 24000) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const text = await parseDocument(filePath);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, text, "utf8");
  return {
    cachePath,
    preview: text.slice(0, previewChars),
    charCount: text.length,
    byteCount: Buffer.byteLength(text),
  };
}

async function runPythonScript(script: string, timeoutSecs = 30): Promise<ProcessResult> {
  return runProcess("python3", ["-c", script], { timeoutMs: timeoutSecs * 1000 });
}

async function installPythonPackage(pkg: string): Promise<string> {
  const result = await runProcess("python3", ["-m", "pip", "install", pkg], { timeoutMs: 120_000 });
  return [result.stdout, result.stderr].filter(Boolean).join("\n") || `Installed ${pkg}`;
}

async function runNodeScript(script: string, cwd?: string, timeoutSecs = 60): Promise<ProcessResult> {
  return runProcess("node", ["-e", script], { cwd, timeoutMs: timeoutSecs * 1000 });
}

async function installNodePackage(pkg: string): Promise<string> {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const dir = path.join(os.homedir(), ".cowork", "node");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ private: true, dependencies: {} }, null, 2), { flag: "wx" }).catch(() => undefined);
  const result = await runProcess("npm", ["install", pkg], { cwd: dir, timeoutMs: 120_000 });
  return [result.stdout, result.stderr].filter(Boolean).join("\n") || `Installed ${pkg}`;
}

async function getNodePath(): Promise<string> {
  const os = await import("node:os");
  const path = await import("node:path");
  return path.join(os.homedir(), ".cowork", "node", "node_modules");
}

async function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number; input?: string } = {},
): Promise<ProcessResult> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, options.timeoutMs)
      : null;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr: stderr || err.message, exit_code: -1, timed_out: timedOut });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, exit_code: code ?? -1, timed_out: timedOut });
    });
    if (options.input) child.stdin.write(options.input);
    child.stdin.end();
  });
}

async function debugLogRoot(): Promise<string> {
  const os = await import("node:os");
  const path = await import("node:path");
  return process.env.COWORK_DEBUG_LOG_ROOT || path.join(os.homedir(), ".cowork", "debug-logs");
}

async function debugLogInit(requestId: string, header: Record<string, unknown>) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const safeId = requestId.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const requestDir = path.join(await debugLogRoot(), safeId);
  const logPath = path.join(requestDir, `request-${safeId}.log`);
  await fs.mkdir(requestDir, { recursive: true });
  await fs.writeFile(logPath, `${JSON.stringify({ seq: 0, at: Date.now(), event: "init", payload: header })}\n`, "utf8");
  return { requestDir, logPath };
}

async function debugLogAppend(logPath: string, line: string): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.appendFile(logPath, `${line}\n`, "utf8");
}

async function debugLogCopyArtifact(requestDir: string, srcPath: string, label = "artifact") {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  try {
    const stat = await fs.stat(srcPath);
    if (!stat.isFile()) return null;
    await fs.mkdir(requestDir, { recursive: true });
    const copiedAs = `${label}-${path.basename(srcPath)}`;
    const absPath = path.join(requestDir, copiedAs);
    await fs.copyFile(srcPath, absPath);
    return { copiedAs, absPath, byteLength: stat.size };
  } catch {
    return null;
  }
}

async function debugLogOpenRoot(): Promise<string> {
  return debugLogRoot();
}

async function slideml2DescribeSchema(components?: string[]) {
  const m = await import("slideml2");
  const requested = Array.isArray(components) ? components.map(String) : [];
  return {
    deck: m.describeDeck(),
    components: {
      index: m.listComponents(),
      details: requested.length ? m.describeComponents(requested) : undefined,
    },
    nodeTypes: m.listNodeTypes().map((node: { type: string; use?: string }) => ({ type: node.type, use: node.use })),
    textKinds: m.listTextKinds(),
    themes: m.listThemes(),
    palette: m.listPaletteColors(),
    defaultTheme: m.buildTheme(),
  };
}

async function slideml2CreateDeck(
  deckPath: string,
  options: Record<string, unknown> = {},
) {
  const m = await import("slideml2");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(path.dirname(deckPath), { recursive: true });
  const result = await m.createDeck(deckPath, {
    title: typeof options.title === "string" ? options.title : undefined,
    size: typeof options.size === "string" ? options.size : undefined,
    theme: typeof options.theme === "string" ? options.theme : "default",
    brand: objectOrUndefined(options.brand),
    themeOverride: objectOrUndefined(options.themeOverride),
    validation: objectOrUndefined(options.validation),
    dataSources: objectOrUndefined(options.dataSources),
    references: Array.isArray(options.references) ? options.references : undefined,
    footnotes: Array.isArray(options.footnotes) ? options.footnotes : undefined,
  } as never);
  return { deckPath, ...result };
}

async function slideml2ReadDeck(deckPath: string): Promise<unknown> {
  const m = await import("slideml2");
  return m.readDeck(deckPath);
}

async function slideml2ReplaceSlide(deckPath: string, slideId: string | number, slide: unknown) {
  const m = await import("slideml2");
  const path = await import("node:path");
  if (slide == null || typeof slide !== "object") throw new Error("slideml2_replace_slide: slide must be an object");
  const deck = await m.readDeck(deckPath) as { slides: unknown[] };
  const normalizedSlide = m.normalizeSlide(slide as never);
  const slideValidation = m.validateSlide(normalizedSlide, deck as never);
  if (!slideValidation.ok) {
    return { ok: false, error: `Slide validation failed with ${slideValidation.errors.length} error(s).`, validation: slideValidation };
  }
  const candidate = JSON.parse(JSON.stringify(deck)) as { slides: unknown[] };
  const id = normalizeSlideId(slideId);
  let targetIndex = -1;
  let insertedAt: number | undefined;
  let replacedAt: number | undefined;
  if (typeof id === "number") {
    if (id === candidate.slides.length) {
      targetIndex = id;
      insertedAt = id;
      candidate.slides.push(normalizedSlide);
    } else if (id >= 0 && id < candidate.slides.length) {
      targetIndex = id;
      replacedAt = id;
      candidate.slides[id] = normalizedSlide;
    }
  } else {
    targetIndex = candidate.slides.findIndex((item) => (item as { id?: string } | undefined)?.id === id);
    if (targetIndex >= 0) {
      replacedAt = targetIndex;
      candidate.slides[targetIndex] = normalizedSlide;
    }
  }
  if (targetIndex < 0) return { ok: false, error: `Slide not found: ${slideId}`, slideCount: deck.slides.length };

  const validation = m.validateDeck(candidate as never, { baseDir: path.dirname(deckPath) });
  if (!validation.ok) {
    return {
      ok: false,
      error: `Candidate deck validation failed with ${validation.errors.length} error(s).`,
      validation,
      slideCount: deck.slides.length,
    };
  }

  const singleSlideDeck = { ...candidate, slides: [candidate.slides[targetIndex]] };
  m.clearRenderDiagnostics();
  try {
    m.renderToAst(m.sourceToRenderedDeck(singleSlideDeck as never, { baseDir: path.dirname(deckPath) }));
  } catch (err) {
    m.clearRenderDiagnostics();
    return {
      ok: false,
      error: `Slide render validation crashed: ${err instanceof Error ? err.message : String(err)}`,
      validation,
      slideCount: deck.slides.length,
    };
  }
  const diagnostics = m.getRenderDiagnostics() as Slideml2DiagnosticLike[];
  m.clearRenderDiagnostics();
  const blocking = blockingSlideml2Diagnostics(diagnostics, m);
  const quality = qualityGateSlideml2Diagnostics(diagnostics, m);
  const renderCheck = {
    count: diagnostics.length,
    summary: summarizeSlideml2Diagnostics(diagnostics),
    blockingCount: blocking.length,
    blocking: blocking.slice(0, 60),
    qualityCount: quality.length,
    quality: quality.slice(0, 60),
  };
  if (blocking.length > 0) {
    return {
      ok: false,
      error: `Slide render validation failed with ${blocking.length} blocking diagnostic(s). Deck file was not modified.`,
      validation,
      diagnostics: renderCheck,
      slideCount: deck.slides.length,
    };
  }

  await m.writeDeck(deckPath, candidate as never);
  return {
    ok: true,
    insertedAt,
    replacedAt,
    slideCount: candidate.slides.length,
    validation,
    diagnostics: renderCheck,
  };
}

async function slideml2PatchDeck(deckPath: string, patch: JsonPatchOp[]) {
  const m = await import("slideml2");
  const path = await import("node:path");
  if (!Array.isArray(patch)) throw new Error("slideml2_patch_deck: patch must be an array");
  const original = await m.readDeck(deckPath) as { slides: unknown[] };
  const deck = JSON.parse(JSON.stringify(original)) as { slides: unknown[] };
  applyJsonPatch(deck, patch);
  if (Array.isArray(deck.slides)) {
    deck.slides = deck.slides.map((slide) => m.normalizeSlide(slide as never));
  }
  const validation = m.validateDeck(deck as never, { baseDir: path.dirname(deckPath) });
  if (validation.ok) await m.writeDeck(deckPath, deck as never);
  return {
    ok: validation.ok,
    error: validation.ok ? undefined : `Deck validation failed with ${validation.errors.length} error(s).`,
    summary: {
      slideCount: deck.slides.length,
      slides: deck.slides.map((s, i) => ({ index: i, id: (s as { id?: string }).id || "", title: (s as { title?: string }).title })),
    },
    validation,
  };
}

async function slideml2ValidateRender(deckPath: string, outputPath?: string, render = true) {
  const m = await import("slideml2");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const deck = await m.readDeck(deckPath);
  const validation = m.validateDeck(deck as never, { baseDir: path.dirname(deckPath) });
  if (!validation.ok || render === false) {
    return {
      ok: validation.ok,
      error: validation.ok ? undefined : `Deck validation failed with ${validation.errors.length} error(s).`,
      validation,
    };
  }
  const out = (typeof outputPath === "string" && outputPath) || deckPath.replace(/\.json$/i, ".pptx");
  await fs.mkdir(path.dirname(out), { recursive: true });
  m.clearRenderDiagnostics();
  const result = await m.renderToPptx(m.sourceToRenderedDeck(deck as never, { baseDir: path.dirname(deckPath) }), out);
  const diagnostics = m.getRenderDiagnostics() as Slideml2DiagnosticLike[];
  m.clearRenderDiagnostics();
  const authoringDiagnostics = await slideml2AuthoringDiagnostics(deckPath, deck);
  const allDiagnostics = diagnostics.concat(authoringDiagnostics);
  const blocking = blockingSlideml2Diagnostics(allDiagnostics, m);
  const quality = qualityGateSlideml2Diagnostics(allDiagnostics, m);
  const diagnosticsPath = `${result.outputPath}.diagnostics.json`;
  await fs.writeFile(diagnosticsPath, JSON.stringify(allDiagnostics, null, 2), "utf8");
  return {
    ok: blocking.length === 0,
    error: blocking.length ? `${blocking.length} blocking render diagnostic(s) remain.` : undefined,
    outputPath: result.outputPath,
    domPath: result.domPath,
    diagnosticsPath,
    validation,
    diagnostics: {
      count: allDiagnostics.length,
      summary: summarizeSlideml2Diagnostics(allDiagnostics),
      blockingCount: blocking.length,
      blocking: blocking.slice(0, 60),
      qualityCount: quality.length,
      quality: quality.slice(0, 60),
    },
  };
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

async function slideml2AuthoringDiagnostics(deckPath: string, deck: unknown): Promise<Slideml2DiagnosticLike[]> {
  const iconDiagnostic = await unusedGeneratedIconDiagnostic(deckPath, deck);
  return [
    ...sourceAuthoringDiagnostics(deck),
    ...(iconDiagnostic ? [iconDiagnostic] : []),
  ];
}

function sourceAuthoringDiagnostics(deck: unknown): Slideml2DiagnosticLike[] {
  const slides = Array.isArray((deck as { slides?: unknown[] } | undefined)?.slides)
    ? (deck as { slides: unknown[] }).slides
    : [];
  const diagnostics: Slideml2DiagnosticLike[] = [];
  slides.forEach((slide, index) => {
    if (!slide || typeof slide !== "object" || index === 0) return;
    const slideRecord = slide as Record<string, unknown>;
    const children = Array.isArray(slideRecord.children) ? slideRecord.children : [];
    if (children.length === 1) {
      const only = children[0];
      const type = nodeTypeOf(only);
      const textChars = sourceTextLength(only);
      if (["process-flow", "grid", "timeline", "axis-ruler"].includes(type) && textChars < 260) {
        diagnostics.push({
          code: "SPARSE_CONTENT_SLIDE",
          severity: "warn",
          slideId: typeof slideRecord.id === "string" ? slideRecord.id : undefined,
          nodeId: typeof (only as { id?: unknown }).id === "string" ? (only as { id: string }).id : undefined,
          message: `Slide '${String(slideRecord.id || index + 1)}' has a single ${type} component with about ${textChars} text characters; it may render as visually sparse even when schema and layout checks pass.`,
          measured: { available: 260, needed: textChars, childCount: children.length },
          suggestion: "Add supporting evidence, a takeaway, a chart/list, richer component variants, or split/reframe the page so visual density matches the promised information load.",
        });
      }
    }
    const plainFeatureGrid = findPlainFeatureCardGrid(children);
    if (plainFeatureGrid) {
      diagnostics.push({
        code: "PLAIN_FEATURE_CARD_GRID",
        severity: "warn",
        slideId: typeof slideRecord.id === "string" ? slideRecord.id : undefined,
        nodeId: plainFeatureGrid.id,
        message: `Slide '${String(slideRecord.id || index + 1)}' uses a plain feature-card grid without generated iconSrc assets or card surfaces.`,
        measured: { childCount: plainFeatureGrid.count },
        suggestion: "Use feature-card variant:'card', generated iconSrc, marker/metric/proof fields, or a denser semantic component.",
      });
    }
  });
  return diagnostics;
}

async function unusedGeneratedIconDiagnostic(deckPath: string, deck: unknown): Promise<Slideml2DiagnosticLike | undefined> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const manifestPath = path.join(path.dirname(deckPath), "assets", "icons", "manifest.json");
    const manifestRaw = await fs.readFile(manifestPath, "utf8").catch(() => "");
    if (!manifestRaw) return undefined;
    const manifest = JSON.parse(manifestRaw) as { icons?: Array<{ path?: unknown; name?: unknown }> };
    const icons = (manifest.icons || [])
      .map((icon) => ({ name: typeof icon.name === "string" ? icon.name : "", path: typeof icon.path === "string" ? icon.path : "" }))
      .filter((icon) => icon.path);
    const iconPathSet = new Set(icons.map((icon) => icon.path));
    if (iconPathSet.size === 0) return undefined;
    const used = new Set<string>();
    collectStringValues(deck, (value) => {
      if (iconPathSet.has(value)) used.add(value);
    });
    if (used.size >= iconPathSet.size) return undefined;
    const unused = icons.filter((icon) => !used.has(icon.path));
    return {
      code: used.size > 0 ? "PARTIAL_UNUSED_GENERATED_ICON_ASSETS" : "UNUSED_GENERATED_ICON_ASSETS",
      severity: "warn",
      message: used.size > 0
        ? `Generated icon manifest exists at ${manifestPath}; the deck references ${used.size} of ${iconPathSet.size} returned icon path(s).`
        : `Generated icon manifest exists at ${manifestPath}, but the deck references none of its ${iconPathSet.size} returned icon path(s).`,
      measured: { available: used.size, needed: iconPathSet.size, used: used.size, unused: unused.slice(0, 12), manifestPath },
      suggestion: "Reference generated icon paths in the intended slide/component field, or remove unneeded icon requests from the asset plan.",
    };
  } catch {
    return undefined;
  }
}

function nodeTypeOf(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const record = node as Record<string, unknown>;
  return typeof record.type === "string" ? record.type : typeof record.component === "string" ? record.component : "";
}

function sourceTextLength(value: unknown): number {
  if (typeof value === "string") return value.trim().length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + sourceTextLength(item), 0);
  if (!value || typeof value !== "object") return 0;
  let total = 0;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "id" || key === "type" || key === "component" || key === "notes") continue;
    total += sourceTextLength(item);
  }
  return total;
}

function findPlainFeatureCardGrid(nodes: unknown[]): { id?: string; count: number } | undefined {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const record = node as Record<string, unknown>;
    const children = Array.isArray(record.children) ? record.children : [];
    if (nodeTypeOf(node) === "grid") {
      const featureCards = children.filter((child) => nodeTypeOf(child) === "feature-card");
      if (featureCards.length >= 3) {
        const plain = featureCards.every((card) => {
          const cardRecord = card as Record<string, unknown>;
          return cardRecord.variant !== "card" && !cardRecord.iconSrc && !cardRecord.marker && !cardRecord.metric && !cardRecord.proof && !cardRecord.badge && !cardRecord.tags;
        });
        if (plain) return { id: typeof record.id === "string" ? record.id : undefined, count: featureCards.length };
      }
    }
    const nested = findPlainFeatureCardGrid(children);
    if (nested) return nested;
  }
  return undefined;
}

function collectStringValues(value: unknown, visit: (value: string) => void): void {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectStringValues(item, visit);
  }
}

function blockingSlideml2Diagnostics(items: Slideml2DiagnosticLike[], slideml2Module?: Record<string, unknown>): Slideml2DiagnosticLike[] {
  const codes = slideml2Module?.BLOCKING_RENDER_DIAGNOSTIC_CODES instanceof Set
    ? slideml2Module.BLOCKING_RENDER_DIAGNOSTIC_CODES
    : new Set(["COLLISION", "STRUCTURAL_OVERLAP", "SIBLING_INK_OVERLAP", "OVERLAY_OCCLUDES_FLOW", "UNKNOWN_COLOR", "UNKNOWN_STYLE", "TINY_RECT", "FALLBACK_FAILED", "CODE_BLOCK_OVERFLOW", "LOW_CONTRAST", "SHAPE_INVISIBLE", "TITLE_OCCLUDED", "EMPTY_CHART_DATA", "EMPTY_TABLE_DATA", "OFF_SLIDE"]);
  const checker = typeof slideml2Module?.isBlockingRenderDiagnostic === "function" ? slideml2Module.isBlockingRenderDiagnostic as (code: unknown, severity?: unknown) => boolean : undefined;
  return items.filter((d) => checker ? checker(d.code, d.severity) : d.severity === "error" || codes.has(d.code));
}

function qualityGateSlideml2Diagnostics(items: Slideml2DiagnosticLike[], slideml2Module?: Record<string, unknown>): Slideml2DiagnosticLike[] {
  const localCodes = new Set(["UNUSED_GENERATED_ICON_ASSETS", "PARTIAL_UNUSED_GENERATED_ICON_ASSETS", "SPARSE_CONTENT_SLIDE", "PLAIN_FEATURE_CARD_GRID"]);
  const checker = typeof slideml2Module?.isQualityRenderDiagnostic === "function" ? slideml2Module.isQualityRenderDiagnostic as (code: unknown) => boolean : undefined;
  const fallback = new Set(["TRUNCATED", "OVERFLOW", "DROP", "DEMOTED", "LOW_CONTRAST_FIXED", "SHAPE_INVISIBLE_FIXED", "DECORATIVE_OVERLAP", "EDGE_CLIPPED", "TIGHT_GAP", "SQUASHED", "PIE_LABELS_HIDDEN"]);
  return items.filter((d) => localCodes.has(d.code) || (checker ? checker(d.code) : fallback.has(d.code)));
}

function summarizeSlideml2Diagnostics(items: Slideml2DiagnosticLike[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const d of items) counts[d.code] = (counts[d.code] || 0) + 1;
  return counts;
}

function normalizeSlideId(value: string | number): string | number {
  if (typeof value === "number") return value;
  if (/^\d+$/.test(value.trim())) return Number(value.trim());
  return String(value || "");
}

function applyJsonPatch(document: unknown, patch: JsonPatchOp[]): void {
  for (const op of patch) {
    if (!op.path.startsWith("/")) throw new Error(`Invalid JSON Pointer path: ${op.path}`);
    if (op.op === "add") jsonPointerSet(document, op.path, op.value, "add");
    else if (op.op === "replace") jsonPointerSet(document, op.path, op.value, "replace");
    else if (op.op === "remove") jsonPointerRemove(document, op.path);
    else if (op.op === "move") {
      const from = String(op.from || "");
      const value = JSON.parse(JSON.stringify(jsonPointerGet(document, from)));
      jsonPointerRemove(document, from);
      jsonPointerSet(document, op.path, value, "add");
    } else if (op.op === "copy") {
      const from = String(op.from || "");
      jsonPointerSet(document, op.path, JSON.parse(JSON.stringify(jsonPointerGet(document, from))), "add");
    } else if (op.op === "test") {
      const actual = jsonPointerGet(document, op.path);
      if (JSON.stringify(actual) !== JSON.stringify(op.value)) throw new Error(`JSON Patch test failed at ${op.path}`);
    } else {
      throw new Error(`Unsupported JSON Patch op: ${(op as { op?: string }).op}`);
    }
  }
}

function jsonPointerParts(ptr: string): string[] {
  if (ptr === "") return [];
  return ptr.split("/").slice(1).map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function jsonPointerGet(doc: unknown, ptr: string): unknown {
  let cur = doc;
  for (const p of jsonPointerParts(ptr)) {
    if (Array.isArray(cur)) cur = cur[p === "-" ? cur.length : Number(p)];
    else cur = cur == null ? undefined : (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function jsonPointerSet(doc: unknown, ptr: string, value: unknown, mode: "add" | "replace"): void {
  const parts = jsonPointerParts(ptr);
  if (parts.length === 0) throw new Error("Replacing the whole document is not supported");
  const key = parts.pop()!;
  let parent = parts.length === 0 ? doc : null;
  if (parts.length > 0) {
    let cursor = doc as Record<string, unknown> | unknown[];
    for (const segment of parts) {
      if (cursor == null || typeof cursor !== "object") throw new Error(`Path parent not found: ${ptr}`);
      let next = Array.isArray(cursor) ? cursor[Number(segment)] : (cursor as Record<string, unknown>)[segment];
      if (next === undefined) {
        if (Array.isArray(cursor)) throw new Error(`Path parent not found: ${ptr}`);
        next = {};
        (cursor as Record<string, unknown>)[segment] = next;
      }
      cursor = next as Record<string, unknown> | unknown[];
    }
    parent = cursor;
  }
  if (parent == null || typeof parent !== "object") throw new Error(`Path parent not found: ${ptr}`);
  if (Array.isArray(parent)) {
    if (key === "-") parent.push(value);
    else {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index > parent.length) throw new Error(`Invalid array index in path: ${ptr}`);
      if (mode === "add") parent.splice(index, 0, value);
      else parent[index] = value;
    }
  } else {
    (parent as Record<string, unknown>)[key] = value;
  }
}

function jsonPointerRemove(doc: unknown, ptr: string): void {
  const parts = jsonPointerParts(ptr);
  const key = parts.pop();
  const parent = parts.length === 0 ? doc : jsonPointerGet(doc, `/${parts.map((p) => p.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`);
  if (parent == null || key == null) throw new Error(`Path not found: ${ptr}`);
  if (Array.isArray(parent)) parent.splice(Number(key), 1);
  else delete (parent as Record<string, unknown>)[key];
}

async function webFetch(url: string) {
  const response = await fetch(url);
  const text = await response.text();
  return {
    url,
    status: response.status,
    content_type: response.headers.get("content-type") || "",
    text: stripHtml(text).slice(0, 20000),
  };
}

async function webSearch(query: string, maxResults = 5) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await response.text();
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const regex = /<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[\s\S]*?>([\s\S]*?)<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) && results.length < maxResults) {
    results.push({ url: decodeHtml(match[1]!), title: stripHtml(match[2]!), snippet: stripHtml(match[3]!) });
  }
  return results;
}

async function shellExec(params: { command: string[]; cwd?: string; env?: Record<string, string>; timeout_ms?: number }) {
  const [command, ...args] = params.command;
  if (!command) return { stdout: "", stderr: "empty command", exit_code: -1, timed_out: false };
  const result = await runProcess(command, args, { cwd: params.cwd, env: params.env, timeoutMs: params.timeout_ms || 30_000 });
  return { stdout: result.stdout, stderr: result.stderr, exit_code: result.exit_code, timed_out: result.timed_out === true };
}

async function shellExecStream(
  params: { command: string[]; cwd?: string; env?: Record<string, string>; timeout_ms?: number },
  onOutput: (line: string) => void,
) {
  const result = await shellExec(params);
  for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) onOutput(line);
  for (const line of result.stderr.split(/\r?\n/).filter(Boolean)) onOutput(`stderr: ${line}`);
  return result;
}

async function httpPost(url: string, headers: Record<string, string>, body: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  return { status: response.status, body: await response.text() };
}

async function* httpStreamPost(url: string, headers: Record<string, string>, body: string): AsyncGenerator<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  if (!response.ok) throw new Error(`API error ${response.status}: ${await response.text()}`);
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n");
    while (idx >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data) yield data;
      }
      idx = buffer.indexOf("\n");
    }
  }
  if (buffer.startsWith("data: ")) {
    const data = buffer.slice(6).trim();
    if (data) yield data;
  }
}

async function downloadUrl(url: string, outputPath: string): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);
  const buf = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buf);
  return outputPath;
}

function stripHtml(html: string): string {
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}
