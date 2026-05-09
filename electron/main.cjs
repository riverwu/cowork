const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");

let mainWindow = null;
const mcpProcesses = new Map();
const browserState = {
  playwright: null,
  context: null,
  page: null,
  headed: false,
  refs: new Map(),
  snapshotId: 0,
  downloads: [],
  consoleLogs: [],
  networkLogs: [],
};
const BROWSER_READ_ACTIONS = new Set([
  "snapshot",
  "state",
  "extract",
  "inspect",
  "read",
  "grep",
  "wait_for_change",
  "get_url",
  "tabs",
  "screenshot",
  "pdf",
  "downloads",
  "diagnostics",
]);

const skipDirs = new Set(["node_modules", "target", ".git", "__pycache__", "dist", "build", ".next"]);
const contentIndexableExtensions = new Set([
  "txt", "md", "markdown", "csv", "json", "xml", "html", "htm",
  "pdf", "doc", "docx", "xlsx", "xls",
  "py", "js", "ts", "rs", "go", "java", "rb", "sh",
  "yaml", "yml", "toml",
]);
const pythonBaselinePackages = [
  "pandas",
  "numpy",
  "openpyxl",
  "python-docx",
  "matplotlib",
  "seaborn",
  "PyPDF2",
  "Pillow",
  "python-pptx",
];
let pythonEnvInitPromise = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: "#f6f6f4",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.COWORK_ELECTRON_DEV_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    // Open devtools automatically in dev so the renderer's console is
    // visible without a manual ⌥⌘I. Also forward every renderer console
    // message to main-process stdout — invaluable when debugging white
    // screens in tail-the-log workflows.
    mainWindow.webContents.openDevTools({ mode: "detach" });
    mainWindow.webContents.on("console-message", (_e, level, message, line, source) => {
      const tag = ["LOG", "WARN", "ERROR", "INFO"][level] ?? `L${level}`;
      const where = source ? ` (${source}:${line})` : "";
      process.stdout.write(`[renderer ${tag}]${where} ${message}\n`);
    });
    mainWindow.webContents.on("render-process-gone", (_e, details) => {
      process.stderr.write(`[renderer GONE] reason=${details.reason} exitCode=${details.exitCode}\n`);
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (app.isQuitting) return;
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
  for (const [, child] of mcpProcesses) child.kill();
  mcpProcesses.clear();
  if (browserState.context) {
    browserState.context.close().catch(() => {});
    browserState.context = null;
    browserState.page = null;
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

function registerIpc() {
  ipcMain.handle("cowork:invoke", async (event, command, args) => {
    return dispatch(command, args ?? {}, event.sender);
  });
}

async function dispatch(command, args, sender) {
  switch (command) {
    case "db_select": return dbSelect(args.sql, args.params || []);
    case "db_execute": return dbExecute(args.sql, args.params || []);
    case "open_path": return shell.openPath(args.path);
    case "reveal_in_folder": return shell.showItemInFolder(args.path);
    case "dialog_pick_folder": return pickFolder();
    case "dialog_pick_files": return pickFiles(args);
    case "scan_directory": return scanDirectory(args.path);
    case "read_file_text": return fsp.readFile(args.path, "utf8");
    case "parse_document": return parseDocument(args.path);
    case "extract_document_text_to_cache": return extractDocumentTextToCache(args.path, args.cachePath, args.previewChars);
    case "start_knowledge_index": return startKnowledgeIndex(sender, args.sourceId, args.path, args.knownFiles || []);
    case "write_file": return writeFile(args.path, args.content);
    case "delete_file": return deleteFile(args.path);
    case "delete_directory": return deleteDirectory(args.path);
    case "read_file_base64": return readFileBase64(args.path);
    case "download_url": return downloadUrl(args.url, args.path);
    case "list_directory": return listDirectory(args.path);
    case "grep": return grep(args.directory, args.pattern, args.maxResults);
    case "ripgrep_search": return ripgrepSearch(args.directory, args.pattern, args.maxResults);
    case "run_python_script": return runPythonScript(args.script, args.timeoutSecs);
    case "init_python_env": return initPythonEnv();
    case "install_python_package": return installPythonPackage(args.package);
    case "init_node_env": return initNodeEnv();
    case "install_node_package": return installNodePackage(args.package);
    case "get_node_path": return getNodePath();
    case "run_node_script": return runNodeScript(args.script, args.cwd, args.timeoutSecs);
    case "slideml2_describe_schema": return slideml2DescribeSchema(args.components);
    case "slideml2_create_deck": return slideml2CreateDeck(args.deckPath, args.title, args.size, args.theme, args.brand, args.themeOverride, args.validation);
    case "slideml2_read_deck": return slideml2ReadDeck(args.deckPath);
    case "slideml2_replace_slide": return slideml2ReplaceSlide(args.deckPath, args.slideId, args.slide);
    case "slideml2_patch_deck": return slideml2PatchDeck(args.deckPath, args.patch);
    case "slideml2_validate_render": return slideml2ValidateRender(args.deckPath, args.outputPath, args.render);
    case "get_env": return process.env[args.key] || null;
    case "http_post": return httpPost(args.request);
    case "http_stream_post": return httpStreamPost(sender, args.request);
    case "shell_exec": return shellExec(args.params);
    case "shell_exec_stream": return shellExecStream(sender, args.params, args.eventId);
    case "mcp_spawn": return mcpSpawn(sender, args.config);
    case "mcp_send": return mcpSend(args.serverId, args.message);
    case "mcp_stop": return mcpStop(args.serverId);
    case "mcp_list": return Array.from(mcpProcesses.keys());
    case "ensure_uv_installed": return ensureUvInstalled();
    case "web_fetch": return webFetch(args.url);
    case "web_search": return webSearch(args.query, args.maxResults);
    case "browser_action": return browserAction(args);
    case "debug_log_init": return debugLogInit(args.requestId, args.header);
    case "debug_log_append": return debugLogAppend(args.logPath, args.line);
    case "debug_log_copy_artifact": return debugLogCopyArtifact(args.requestDir, args.srcPath, args.label);
    case "debug_log_open_root": return debugLogOpenRoot();
    default: throw new Error(`Unknown Electron command: ${command}`);
  }
}

function emit(sender, channel, payload) {
  if (!sender || sender.isDestroyed()) return;
  try {
    sender.send(`cowork:event:${channel}`, payload);
  } catch {
    // Renderer may already be gone while background child processes are closing.
  }
}

function dbPath() {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "cowork.db");
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function bindSql(sql, params) {
  let bound = sql;
  params.forEach((value, index) => {
    const token = new RegExp(`\\$${index + 1}(?!\\d)`, "g");
    bound = bound.replace(token, sqlLiteral(value));
  });
  return bound;
}

function runSql(sql, params = [], json = false) {
  const finalSql = bindSql(sql, params);
  const args = json ? ["-json", dbPath(), finalSql] : [dbPath(), finalSql];
  const result = spawnSync("/usr/bin/sqlite3", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `sqlite3 exited ${result.status}`);
  }
  return result.stdout || "";
}

async function dbSelect(sql, params) {
  const output = runSql(sql, params, true).trim();
  if (!output) return [];
  return JSON.parse(output);
}

async function dbExecute(sql, params) {
  runSql(sql, params, false);
}

async function pickFolder() {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  return result.canceled ? null : result.filePaths[0] || null;
}

async function pickFiles(args) {
  const filters = args.filters || undefined;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: args.multiple ? ["openFile", "multiSelections"] : ["openFile"],
    filters,
  });
  if (result.canceled) return null;
  return args.multiple ? result.filePaths : result.filePaths[0] || null;
}

async function scanDirectory(root) {
  const files = [];
  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) await walk(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const fullPath = path.join(dir, entry.name);
      const stat = await fsp.stat(fullPath).catch(() => null);
      if (!stat) continue;
      files.push(fileInfo(fullPath, stat));
    }
  }
  await walk(root);
  files.sort((a, b) => b.modified_at - a.modified_at);
  return files;
}

async function listDirectory(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    const stat = await fsp.stat(fullPath).catch(() => null);
    if (!stat) continue;
    files.push(fileInfo(fullPath, stat, entry.isDirectory()));
  }
  files.sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name));
  return files;
}

function fileInfo(fullPath, stat, isDir = false) {
  return {
    name: path.basename(fullPath),
    path: fullPath,
    is_dir: isDir,
    size: stat.size,
    modified_at: Math.floor(stat.mtimeMs / 1000),
    extension: path.extname(fullPath).replace(/^\./, "").toLowerCase(),
  };
}

async function parseDocument(filePath) {
  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
  if (ext === "pdf") return parsePdf(filePath);
  if (ext === "doc" || ext === "docx") return runCommandText("/usr/bin/textutil", ["-convert", "txt", "-stdout", filePath]);
  if (ext === "xlsx" || ext === "xls") return parseWorkbook(filePath);
  if (ext === "pptx" || ext === "ppt") throw new Error("PPTX text extraction is not supported by parse_document. Use the pptx skill.");
  return fsp.readFile(filePath, "utf8");
}

async function parsePdf(filePath) {
  const pdftotext = findExecutable(["/opt/homebrew/bin/pdftotext", "/usr/local/bin/pdftotext", "/usr/bin/pdftotext"]);
  if (!pdftotext) throw new Error("PDF extraction requires pdftotext");
  const text = await runCommandText(pdftotext, [filePath, "-"]);
  if (!text.trim()) throw new Error("PDF appears to contain no extractable text");
  return text;
}

async function parseWorkbook(filePath) {
  const script = [
    "import sys",
    "from openpyxl import load_workbook",
    "wb=load_workbook(sys.argv[1], data_only=True, read_only=True)",
    "for ws in wb.worksheets:",
    " print('## Sheet: '+ws.title)",
    " for row in ws.iter_rows(values_only=True):",
    "  print('\\t'.join('' if c is None else str(c) for c in row))",
  ].join("\n");
  return runCommandText("python3", ["-c", script, filePath]);
}

async function extractDocumentTextToCache(filePath, cachePath, previewChars = 24000) {
  const text = await parseDocument(filePath);
  if (!text.trim()) throw new Error("Document appears to contain no extractable text");
  await fsp.mkdir(path.dirname(cachePath), { recursive: true });
  await fsp.writeFile(cachePath, text, "utf8");
  const preview = Array.from(text).slice(0, Math.max(1000, Math.min(previewChars || 24000, 80000))).join("");
  return { cache_path: cachePath, preview, char_count: Array.from(text).length, byte_count: Buffer.byteLength(text) };
}

async function startKnowledgeIndex(sender, sourceId, root, knownFiles) {
  const jobId = crypto.randomUUID();
  const knownHashes = new Set(knownFiles.map((file) => file.content_hash || file.contentHash).filter(Boolean));
  setImmediate(async () => {
    try {
      emit(sender, "knowledge-index-progress", { job_id: jobId, source_id: sourceId, phase: "scan", current: 0, total: 0, filename: null, message: "Scanning directory" });
      const files = await scanDirectory(root);
      const total = files.length;
      const batch = [];
      const flush = () => {
        if (batch.length === 0) return;
        emit(sender, "knowledge-index-files", { job_id: jobId, source_id: sourceId, files: batch.splice(0) });
      };
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const current = i + 1;
        if (current === 1 || current === total || current % 25 === 0) {
          emit(sender, "knowledge-index-progress", { job_id: jobId, source_id: sourceId, phase: "extract", current, total, filename: file.name, message: "Extracting text" });
        }
        const indexed = { job_id: jobId, source_id: sourceId, ...file, cache_path: null, preview: null, char_count: null, byte_count: null, error: null, unchanged: knownHashes.has(fileFingerprint(file)) };
        if (!indexed.unchanged && contentIndexableExtensions.has(file.extension)) {
          const cachePath = nativeCachePathForFile(file.path);
          try {
            const result = await extractDocumentTextToCache(file.path, cachePath, 24000);
            indexed.cache_path = result.cache_path;
            indexed.preview = result.preview;
            indexed.char_count = result.char_count;
            indexed.byte_count = result.byte_count;
          } catch (error) {
            indexed.error = `Text extraction failed: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        batch.push(indexed);
        if (batch.length >= 24) flush();
      }
      flush();
      emit(sender, "knowledge-index-done", { job_id: jobId, source_id: sourceId, phase: "done", current: total, total, filename: null, message: "Index extraction complete" });
    } catch (error) {
      emit(sender, "knowledge-index-done", { job_id: jobId, source_id: sourceId, phase: "error", current: 0, total: 0, filename: null, message: error instanceof Error ? error.message : String(error) });
    }
  });
  return jobId;
}

function fileFingerprint(file) {
  return `${file.path}:${file.size}:${file.modified_at}`;
}

function nativeCachePathForFile(filePath) {
  const hash = crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 16);
  return path.join(path.dirname(filePath), ".cowork-text-cache", `${hash}.txt`);
}

async function writeFile(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, "utf8");
}

async function deleteFile(filePath) {
  await fsp.rm(filePath, { force: true });
}

async function deleteDirectory(dirPath) {
  await fsp.rm(dirPath, { recursive: true, force: true });
}

async function readFileBase64(filePath) {
  const buffer = await fsp.readFile(filePath);
  return buffer.toString("base64");
}

async function downloadUrl(url, savePath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fsp.mkdir(path.dirname(savePath), { recursive: true });
  await fsp.writeFile(savePath, buffer);
  return savePath;
}

async function grep(directory, pattern, maxResults = 50) {
  const matches = [];
  const files = await scanDirectory(directory);
  for (const file of files) {
    if (matches.length >= maxResults) break;
    if (file.size > 1_000_000) continue;
    let content;
    try { content = await fsp.readFile(file.path, "utf8"); } catch { continue; }
    content.split(/\r?\n/).some((line, index) => {
      if (line.includes(pattern)) matches.push({ path: file.path, line_number: index + 1, line });
      return matches.length >= maxResults;
    });
  }
  return matches;
}

async function ripgrepSearch(directory, pattern, maxResults = 50) {
  const rg = findExecutable(["/opt/homebrew/bin/rg", "/usr/local/bin/rg", "/usr/bin/rg"]);
  if (!rg) return grep(directory, pattern, maxResults);
  const result = spawnSync(rg, ["--line-number", "--no-heading", "--color", "never", "-m", String(maxResults), pattern, directory], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr || "ripgrep failed");
  return result.stdout.split(/\r?\n/).filter(Boolean).slice(0, maxResults).map((line) => {
    const first = line.indexOf(":");
    const second = line.indexOf(":", first + 1);
    return { path: line.slice(0, first), line_number: Number(line.slice(first + 1, second)), line: line.slice(second + 1) };
  });
}

async function runPythonScript(script, timeoutSecs = 30) {
  await initPythonEnv();
  const { python } = pythonEnvPaths();
  return runScript(python, ["-c", script], undefined, timeoutSecs);
}

async function initPythonEnv() {
  if (!pythonEnvInitPromise) {
    pythonEnvInitPromise = doInitPythonEnv().catch((error) => {
      pythonEnvInitPromise = null;
      throw error;
    });
  }
  return pythonEnvInitPromise;
}

async function doInitPythonEnv() {
  const { dir, venvDir, python, marker } = pythonEnvPaths();
  await fsp.mkdir(dir, { recursive: true });
  const needsVenv = !fs.existsSync(python);
  if (needsVenv) {
    const result = await runScript("python3", ["-m", "venv", venvDir], undefined, 120);
    if (result.exit_code !== 0) throw new Error(result.stderr || result.stdout || "Failed to create Python virtual environment");
  }
  await ensurePythonBaselinePackages(python, marker, needsVenv);
  return dir;
}

function pythonEnvPaths() {
  const dir = path.join(os.homedir(), ".cowork", "python");
  const venvDir = path.join(dir, ".venv");
  const binDir = process.platform === "win32" ? "Scripts" : "bin";
  const python = path.join(venvDir, binDir, process.platform === "win32" ? "python.exe" : "python");
  const marker = path.join(dir, "baseline-packages.v1.json");
  return { dir, venvDir, python, marker };
}

async function ensurePythonBaselinePackages(python, marker, force = false) {
  const markerPayload = JSON.stringify({ version: 1, packages: pythonBaselinePackages }, null, 2);
  if (!force && fs.existsSync(marker)) {
    try {
      if ((await fsp.readFile(marker, "utf8")) === markerPayload) return;
    } catch {
      // Fall through and repair the environment.
    }
  }

  const result = await runScript(
    python,
    ["-m", "pip", "install", "--disable-pip-version-check", ...pythonBaselinePackages],
    undefined,
    600,
  );
  if (result.exit_code !== 0) throw new Error(result.stderr || result.stdout || "Failed to install baseline Python packages");
  await fsp.writeFile(marker, markerPayload, "utf8");
}

async function installPythonPackage(pkg) {
  await initPythonEnv();
  const { python } = pythonEnvPaths();
  const result = await runScript(python, ["-m", "pip", "install", pkg], undefined, 120);
  if (result.exit_code !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

async function initNodeEnv() {
  const dir = path.join(os.homedir(), ".cowork", "node");
  await fsp.mkdir(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, "package.json"))) await runScript("npm", ["init", "-y"], dir, 30);
  return dir;
}

async function installNodePackage(pkg) {
  const dir = await initNodeEnv();
  const result = await runScript("npm", ["install", pkg], dir, 120);
  if (result.exit_code !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

async function getNodePath() {
  return path.join(os.homedir(), ".cowork", "node", "node_modules");
}

async function runNodeScript(script, cwd, timeoutSecs = 30) {
  return runScript("node", ["-e", script], cwd || process.cwd(), timeoutSecs, { NODE_PATH: await getNodePath() });
}

// slideml2 lives in node_modules as an ESM workspace package. Electron main is
// CJS, so we lazy-load via dynamic import and cache the module promise.
let _slideml2Promise = null;
function slideml2() {
  if (!_slideml2Promise) _slideml2Promise = import("slideml2");
  return _slideml2Promise;
}

async function slideml2DescribeSchema(componentNames) {
  const m = await slideml2();
  const components = Array.isArray(componentNames) ? componentNames.map(String) : [];
  return {
    deck: m.describeDeck(),
    components: {
      index: m.listComponents(),
      details: components.length ? m.describeComponents(components) : undefined,
    },
    nodeTypes: m.listNodeTypes().map((node) => ({ type: node.type, use: node.use })),
    textKinds: m.listTextKinds(),
    themes: m.listThemes(),
    palette: m.listPaletteColors(),
    defaultTheme: m.buildTheme(),
  };
}

async function slideml2CreateDeck(deckPath, title, size, theme, brand, themeOverride, validation) {
  if (!deckPath) throw new Error("slideml2_create_deck: deckPath is required");
  const m = await slideml2();
  const result = await m.createDeck(deckPath, {
    title: typeof title === "string" ? title : undefined,
    size: typeof size === "string" ? size : undefined,
    theme: typeof theme === "string" ? theme : "default",
    brand: brand && typeof brand === "object" ? brand : undefined,
    themeOverride: themeOverride && typeof themeOverride === "object" ? themeOverride : undefined,
    validation: validation && typeof validation === "object" ? validation : undefined,
  });
  return { deckPath, ...result };
}

async function slideml2ReadDeck(deckPath) {
  if (!deckPath) throw new Error("slideml2_read_deck: deckPath is required");
  const m = await slideml2();
  return m.readDeck(deckPath);
}

async function slideml2ReplaceSlide(deckPath, slideId, slide) {
  if (!deckPath) throw new Error("slideml2_replace_slide: deckPath is required");
  if (slide == null || typeof slide !== "object") throw new Error("slideml2_replace_slide: slide must be an object");
  const m = await slideml2();
  const deck = await m.readDeck(deckPath);
  const slideValidation = m.validateSlide(slide, deck);
  if (!slideValidation.ok) {
    return { ok: false, error: `Slide validation failed with ${slideValidation.errors.length} error(s).`, validation: slideValidation };
  }
  const id = normalizeSlideId(slideId);
  const candidate = JSON.parse(JSON.stringify(deck));
  let targetIndex = -1;
  let insertedAt;
  let replacedAt;
  if (typeof id === "number") {
    if (id === candidate.slides.length) {
      targetIndex = id;
      insertedAt = id;
      candidate.slides.push(slide);
    } else if (id >= 0 && id < candidate.slides.length) {
      targetIndex = id;
      replacedAt = id;
      candidate.slides[id] = slide;
    }
  } else {
    targetIndex = candidate.slides.findIndex((item) => item.id === id);
    if (targetIndex >= 0) {
      replacedAt = targetIndex;
      candidate.slides[targetIndex] = slide;
    }
  }
  if (targetIndex < 0) {
    return { ok: false, error: `Slide not found: ${slideId}`, slideCount: deck.slides.length };
  }

  const deckValidation = m.validateDeck(candidate);
  if (!deckValidation.ok) {
    return {
      ok: false,
      error: `Candidate deck validation failed with ${deckValidation.errors.length} error(s).`,
      validation: deckValidation,
      slideCount: deck.slides.length,
    };
  }

  const singleSlideDeck = { ...candidate, slides: [candidate.slides[targetIndex]] };
  m.clearRenderDiagnostics();
  try {
    m.renderToAst(m.sourceToRenderedDeck(singleSlideDeck));
  } catch (err) {
    m.clearRenderDiagnostics();
    return {
      ok: false,
      error: `Slide render validation crashed: ${err instanceof Error ? err.message : String(err)}`,
      validation: deckValidation,
      slideCount: deck.slides.length,
    };
  }
  const diagnostics = m.getRenderDiagnostics();
  m.clearRenderDiagnostics();
  const blocking = blockingSlideml2Diagnostics(diagnostics);
  const quality = qualityGateSlideml2Diagnostics(diagnostics);
  const diagnosticsSummary = summarizeSlideml2Diagnostics(diagnostics);
  const renderCheck = {
    count: diagnostics.length,
    summary: diagnosticsSummary,
    blockingCount: blocking.length,
    blocking: blocking.slice(0, 60),
    qualityCount: quality.length,
    quality: quality.slice(0, 60),
  };
  if (blocking.length > 0) {
    return {
      ok: false,
      error: `Slide render validation failed with ${blocking.length} blocking diagnostic(s). Deck file was not modified.`,
      validation: deckValidation,
      diagnostics: renderCheck,
      slideCount: deck.slides.length,
    };
  }

  await m.writeDeck(deckPath, candidate);
  return {
    ok: true,
    insertedAt,
    replacedAt,
    slideCount: candidate.slides.length,
    validation: deckValidation,
    diagnostics: renderCheck,
  };
}

async function slideml2PatchDeck(deckPath, patch) {
  if (!deckPath) throw new Error("slideml2_patch_deck: deckPath is required");
  if (!Array.isArray(patch)) throw new Error("slideml2_patch_deck: patch must be an array");
  const m = await slideml2();
  const original = await m.readDeck(deckPath);
  const deck = JSON.parse(JSON.stringify(original));
  applyJsonPatch(deck, patch);
  const validation = m.validateDeck(deck);
  if (validation.ok) await m.writeDeck(deckPath, deck);
  return {
    ok: validation.ok,
    error: validation.ok ? undefined : `Deck validation failed with ${validation.errors.length} error(s).`,
    summary: { slideCount: deck.slides.length, slides: deck.slides.map((s, i) => ({ index: i, id: s.id, title: s.title })) },
    validation,
  };
}

async function slideml2ValidateRender(deckPath, outputPath, render) {
  if (!deckPath) throw new Error("slideml2_validate_render: deckPath is required");
  const m = await slideml2();
  const shouldRender = render !== false;
  const deck = await m.readDeck(deckPath);
  const validation = m.validateDeck(deck);
  if (!validation.ok || !shouldRender) {
    return {
      ok: validation.ok,
      error: validation.ok ? undefined : `Deck validation failed with ${validation.errors.length} error(s).`,
      validation,
    };
  }
  const out = (typeof outputPath === "string" && outputPath) || `${deckPath.replace(/\.json$/, "")}.pptx`;
  await fsp.mkdir(path.dirname(out), { recursive: true });
  m.clearRenderDiagnostics();
  const result = await m.renderToPptx(m.sourceToRenderedDeck(deck), out);
  const diagnostics = m.getRenderDiagnostics();
  const authoringDiagnostics = await slideml2AuthoringDiagnostics(deckPath, deck);
  const allDiagnostics = diagnostics.concat(authoringDiagnostics);
  const blocking = blockingSlideml2Diagnostics(allDiagnostics);
  const quality = qualityGateSlideml2Diagnostics(allDiagnostics);
  const diagnosticsPath = `${result.outputPath}.diagnostics.json`;
  await fsp.writeFile(diagnosticsPath, JSON.stringify(allDiagnostics, null, 2), "utf8");
  const counts = {};
  for (const d of allDiagnostics) counts[d.code] = (counts[d.code] || 0) + 1;
  return {
    ok: blocking.length === 0,
    error: blocking.length ? `${blocking.length} blocking render diagnostic(s) remain.` : undefined,
    outputPath: result.outputPath,
    domPath: result.domPath,
    diagnosticsPath,
    validation,
    diagnostics: {
      count: allDiagnostics.length,
      summary: counts,
      blockingCount: blocking.length,
      blocking: blocking.slice(0, 60),
      qualityCount: quality.length,
      quality: quality.slice(0, 60),
    },
  };
}

async function slideml2AuthoringDiagnostics(deckPath, deck) {
  const iconDiagnostic = await unusedGeneratedIconDiagnostic(deckPath, deck);
  return [
    ...sourceAuthoringDiagnostics(deck),
    ...(iconDiagnostic ? [iconDiagnostic] : []),
  ];
}

function sourceAuthoringDiagnostics(deck) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  const diagnostics = [];
  slides.forEach((slide, index) => {
    if (!slide || typeof slide !== "object" || index === 0) return;
    const children = Array.isArray(slide.children) ? slide.children : [];
    if (children.length === 1) {
      const only = children[0];
      const type = nodeTypeOf(only);
      const textChars = sourceTextLength(only);
      if (["process-flow", "grid", "timeline", "axis-ruler"].includes(type) && textChars < 260) {
        diagnostics.push({
          code: "SPARSE_CONTENT_SLIDE",
          severity: "warn",
          slideId: slide.id,
          nodeId: only?.id,
          message: `Slide '${slide.id || index + 1}' has a single ${type} component with about ${textChars} text characters; it may render as visually sparse even when schema and layout checks pass.`,
          measured: { available: 260, needed: textChars, childCount: children.length },
          suggestion: "Add a supporting takeaway/evidence/chart/list, use a richer component variant, or split/reframe the page so the visual density matches the slide's promised information load.",
        });
      }
    }
    const plainFeatureGrid = findPlainFeatureCardGrid(children);
    if (plainFeatureGrid) {
      diagnostics.push({
        code: "PLAIN_FEATURE_CARD_GRID",
        severity: "warn",
        slideId: slide.id,
        nodeId: plainFeatureGrid.id,
        message: `Slide '${slide.id || index + 1}' uses a plain feature-card grid without generated iconSrc assets or card surfaces; it can look empty despite containing text.`,
        measured: { childCount: plainFeatureGrid.count },
        suggestion: "Use feature-card variant:'card', place generated icons via iconSrc, add marker/metric/proof fields, or choose a denser semantic component such as comparison-list or explanation-block.",
      });
    }
  });
  return diagnostics;
}

function findPlainFeatureCardGrid(nodes) {
  for (const node of nodes || []) {
    if (!node || typeof node !== "object") continue;
    const type = nodeTypeOf(node);
    const children = Array.isArray(node.children) ? node.children : [];
    if (type === "grid") {
      const featureCards = children.filter((child) => nodeTypeOf(child) === "feature-card");
      if (featureCards.length >= 3) {
        const plain = featureCards.every((card) => {
          const variant = typeof card.variant === "string" ? card.variant : "";
          return variant !== "card" && !card.iconSrc && !card.marker && !card.metric && !card.proof && !card.badge && !card.tags;
        });
        if (plain) return { id: node.id, count: featureCards.length };
      }
    }
    const nested = findPlainFeatureCardGrid(children);
    if (nested) return nested;
  }
  return undefined;
}

function nodeTypeOf(node) {
  if (!node || typeof node !== "object") return "";
  return typeof node.type === "string" ? node.type : typeof node.component === "string" ? node.component : "";
}

function sourceTextLength(value) {
  if (typeof value === "string") return value.trim().length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + sourceTextLength(item), 0);
  if (!value || typeof value !== "object") return 0;
  let total = 0;
  for (const [key, item] of Object.entries(value)) {
    if (key === "id" || key === "type" || key === "component" || key === "notes") continue;
    total += sourceTextLength(item);
  }
  return total;
}

async function unusedGeneratedIconDiagnostic(deckPath, deck) {
  try {
    const manifestPath = path.join(path.dirname(deckPath), "assets", "icons", "manifest.json");
    const manifestRaw = await fsp.readFile(manifestPath, "utf8").catch(() => "");
    if (!manifestRaw) return undefined;
    const manifest = JSON.parse(manifestRaw);
    const icons = Array.isArray(manifest.icons)
      ? manifest.icons
        .map((icon) => ({
          name: typeof icon?.name === "string" ? icon.name : "",
          path: typeof icon?.path === "string" ? icon.path : "",
        }))
        .filter((icon) => icon.path)
      : [];
    const iconPaths = icons.map((icon) => icon.path);
    if (!iconPaths.length) return undefined;
    const iconPathSet = new Set(iconPaths);
    const used = new Set();
    collectStringValues(deck, (value) => {
      if (iconPathSet.has(value)) used.add(value);
    });
    if (used.size >= iconPaths.length) return undefined;
    const unused = icons.filter((icon) => !used.has(icon.path));
    if (used.size > 0) {
      return {
        code: "PARTIAL_UNUSED_GENERATED_ICON_ASSETS",
        severity: "warn",
        message: `Generated icon manifest exists at ${manifestPath}; the deck references ${used.size} of ${iconPaths.length} returned icon path(s).`,
        measured: {
          available: used.size,
          needed: iconPaths.length,
          used: used.size,
          unused: unused.slice(0, 12),
          manifestPath,
        },
        suggestion: "Reference every planned generated icon path in the intended slide/component field, or remove unneeded icon requests from the asset plan.",
      };
    }
    return {
      code: "UNUSED_GENERATED_ICON_ASSETS",
      severity: "warn",
      message: `Generated icon manifest exists at ${manifestPath}, but the deck references none of its ${iconPaths.length} returned icon path(s).`,
      measured: { available: 0, needed: iconPaths.length, used: 0, unused: unused.slice(0, 12), manifestPath },
      suggestion: "Use manifest.icons[].path as feature-card.iconSrc or image/image-card src on slides that requested generated icons, or skip generate_icon_sheet when the final deck will not place the icons.",
    };
  } catch {
    return undefined;
  }
}

function collectStringValues(value, visit) {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStringValues(item, visit);
  }
}

function blockingSlideml2Diagnostics(items) {
  const codes = new Set(["COLLISION", "UNKNOWN_COLOR", "UNKNOWN_STYLE", "TINY_RECT", "SQUASHED", "FALLBACK_FAILED", "LOW_CONTRAST", "SHAPE_INVISIBLE", "TITLE_OCCLUDED"]);
  return items.filter((d) => d.severity === "error" || codes.has(d.code));
}

function qualityGateSlideml2Diagnostics(items) {
  const codes = new Set(["TRUNCATED", "OVERFLOW", "UNUSED_GENERATED_ICON_ASSETS", "PARTIAL_UNUSED_GENERATED_ICON_ASSETS", "SPARSE_CONTENT_SLIDE", "PLAIN_FEATURE_CARD_GRID"]);
  return items.filter((d) => codes.has(d.code));
}

function summarizeSlideml2Diagnostics(items) {
  const counts = {};
  for (const d of items) counts[d.code] = (counts[d.code] || 0) + 1;
  return counts;
}

function normalizeSlideId(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return String(value || "");
}

function applyJsonPatch(document, patch) {
  for (const raw of patch) {
    const op = raw && typeof raw === "object" ? raw : {};
    const kind = String(op.op || "");
    const ptr = String(op.path || "");
    if (!ptr.startsWith("/")) throw new Error(`Invalid JSON Pointer path: ${ptr}`);
    if (kind === "add") jsonPointerSet(document, ptr, op.value, "add");
    else if (kind === "replace") jsonPointerSet(document, ptr, op.value, "replace");
    else if (kind === "remove") jsonPointerRemove(document, ptr);
    else if (kind === "move") {
      const from = String(op.from || "");
      const value = JSON.parse(JSON.stringify(jsonPointerGet(document, from)));
      jsonPointerRemove(document, from);
      jsonPointerSet(document, ptr, value, "add");
    } else if (kind === "copy") {
      const from = String(op.from || "");
      jsonPointerSet(document, ptr, JSON.parse(JSON.stringify(jsonPointerGet(document, from))), "add");
    } else if (kind === "test") {
      const actual = jsonPointerGet(document, ptr);
      if (JSON.stringify(actual) !== JSON.stringify(op.value)) throw new Error(`JSON Patch test failed at ${ptr}`);
    } else {
      throw new Error(`Unsupported JSON Patch op: ${kind}`);
    }
  }
}

function jsonPointerParts(ptr) {
  if (ptr === "") return [];
  return ptr.split("/").slice(1).map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function jsonPointerGet(doc, ptr) {
  let cur = doc;
  for (const p of jsonPointerParts(ptr)) {
    if (Array.isArray(cur)) cur = cur[p === "-" ? cur.length : Number(p)];
    else cur = cur == null ? undefined : cur[p];
  }
  return cur;
}

function jsonPointerSet(doc, ptr, value, mode) {
  const parts = jsonPointerParts(ptr);
  if (parts.length === 0) throw new Error("Replacing the whole document is not supported");
  const key = parts.pop();
  // Auto-create intermediate parents when the agent issues an `add` or
  // `replace` deeper than what currently exists. Strict RFC 6902 fails fast,
  // but agents almost always intend "set this nested key" — creating empty
  // objects along the way is an acceptable convenience that matches set_path
  // semantics in many JSON-patch libraries.
  let parent = parts.length === 0 ? doc : null;
  if (parts.length > 0) {
    let cursor = doc;
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i];
      if (cursor == null || typeof cursor !== "object") throw new Error(`Path parent not found: ${ptr}`);
      let next = Array.isArray(cursor) ? cursor[Number(segment)] : cursor[segment];
      if (next === undefined) {
        // Create an object for the missing intermediate. Skip if cursor is an
        // array (autocreate doesn't make sense for array slots).
        if (!Array.isArray(cursor)) {
          next = {};
          cursor[segment] = next;
        } else {
          throw new Error(`Path parent not found: ${ptr}`);
        }
      }
      cursor = next;
    }
    parent = cursor;
  }
  if (parent == null) throw new Error(`Path parent not found: ${ptr}`);
  if (Array.isArray(parent)) {
    if (key === "-") parent.push(value);
    else {
      const idx = Number(key);
      if (!Number.isInteger(idx)) throw new Error(`Invalid array index in path: ${ptr}`);
      if (mode === "add") parent.splice(idx, 0, value);
      else {
        if (idx < 0 || idx >= parent.length) throw new Error(`Array index out of range: ${ptr}`);
        parent[idx] = value;
      }
    }
  } else {
    // Soft-replace: when `replace` targets a missing key but the parent
    // exists, treat as `add`. Strict RFC 6902 would fail, but agents almost
    // always meant "set this key", and the only failure mode of this
    // looseness is over-creating themeOverride keys — which is harmless.
    parent[key] = value;
  }
}

function jsonPointerRemove(doc, ptr) {
  const parts = jsonPointerParts(ptr);
  if (parts.length === 0) throw new Error("Removing the whole document is not supported");
  const key = parts.pop();
  const parent = jsonPointerGet(doc, parts.length === 0 ? "" : `/${parts.map(jsonPointerEscape).join("/")}`);
  if (Array.isArray(parent)) parent.splice(Number(key), 1);
  else if (parent && typeof parent === "object") delete parent[key];
  else throw new Error(`Path parent not found: ${ptr}`);
}

function jsonPointerEscape(part) {
  return part.replace(/~/g, "~0").replace(/\//g, "~1");
}

// ---- Debug log ----
//
// Layout:
//   ~/.cowork/debug-logs/<requestId>/
//     request-<requestId>.log         JSONL, one event per line
//     <copied artifact files...>
//
// All write paths are derived from requestId on the main side; renderer
// only supplies the id + payloads, never raw filesystem paths. This keeps
// the IPC surface small and prevents writes outside the debug-logs root.

function debugLogRoot() {
  return path.join(os.homedir(), ".cowork", "debug-logs");
}

function debugLogPaths(requestId) {
  const safeId = String(requestId || "").replace(/[^A-Za-z0-9._-]/g, "_");
  if (!safeId) throw new Error("debug_log: requestId required");
  const dir = path.join(debugLogRoot(), safeId);
  const log = path.join(dir, `request-${safeId}.log`);
  return { dir, log };
}

async function debugLogInit(requestId, header) {
  const { dir, log } = debugLogPaths(requestId);
  await fsp.mkdir(dir, { recursive: true });
  // Truncate / create the file with the header line.
  const headerLine = JSON.stringify({ ...(header || {}), event: "init", at: Date.now() }) + "\n";
  await fsp.writeFile(log, headerLine, "utf8");
  return { requestDir: dir, logPath: log };
}

async function debugLogAppend(logPath, line) {
  if (!logPath) throw new Error("debug_log_append: logPath required");
  if (typeof line !== "string") throw new Error("debug_log_append: line must be string");
  // Caller is expected to JSON.stringify; we just guarantee newline termination.
  const payload = line.endsWith("\n") ? line : `${line}\n`;
  await fsp.appendFile(logPath, payload, "utf8");
}

async function debugLogCopyArtifact(requestDir, srcPath, label) {
  if (!requestDir) throw new Error("debug_log_copy_artifact: requestDir required");
  if (!srcPath) throw new Error("debug_log_copy_artifact: srcPath required");
  // Refuse to copy out-of-root or non-existent files; silently skip with null
  // so the agent loop never crashes because a tool result string mentioned a
  // path that's already been cleaned up.
  if (!fs.existsSync(srcPath)) return null;
  const stat = await fsp.stat(srcPath).catch(() => null);
  if (!stat || !stat.isFile()) return null;
  const root = debugLogRoot();
  if (!requestDir.startsWith(root)) throw new Error("debug_log_copy_artifact: requestDir must live under the debug-log root");
  await fsp.mkdir(requestDir, { recursive: true });
  const base = path.basename(srcPath);
  const safeLabel = label ? String(label).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40) : "";
  const filename = await debugLogAllocFilename(requestDir, safeLabel, base);
  const dst = path.join(requestDir, filename);
  await fsp.copyFile(srcPath, dst);
  return { copiedAs: filename, absPath: dst, byteLength: stat.size };
}

async function debugLogAllocFilename(requestDir, label, base) {
  const candidate = label ? `${label}__${base}` : base;
  if (!fs.existsSync(path.join(requestDir, candidate))) return candidate;
  // Collision — suffix with -1, -2, ... until free. Bounded retries.
  const ext = path.extname(candidate);
  const stem = candidate.slice(0, candidate.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const next = `${stem}-${i}${ext}`;
    if (!fs.existsSync(path.join(requestDir, next))) return next;
  }
  return `${stem}-${Date.now()}${ext}`;
}

async function debugLogOpenRoot() {
  const root = debugLogRoot();
  await fsp.mkdir(root, { recursive: true });
  return shell.openPath(root);
}


async function shellExec(params) {
  return runScript(params.command[0], params.command.slice(1), params.cwd, (params.timeout_ms || 30000) / 1000, params.env);
}

async function shellExecStream(sender, params, eventId) {
  return runScript(params.command[0], params.command.slice(1), params.cwd, (params.timeout_ms || 30000) / 1000, params.env, (line) => {
    emit(sender, `shell-output-${eventId}`, line);
  });
}

function runScript(program, args, cwd, timeoutSecs, env = {}, onOutput) {
  return new Promise((resolve) => {
    const child = spawn(program, args, {
      cwd,
      env: { ...process.env, PATH: expandedPath(), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, Math.max(1, timeoutSecs || 30) * 1000);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      onOutput?.(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      onOutput?.(`[stderr] ${text}`);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr || error.message, exit_code: -1, timed_out: timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exit_code: code ?? -1, timed_out: timedOut });
    });
  });
}

async function httpPost(request) {
  const response = await fetch(request.url, { method: "POST", headers: { "Content-Type": "application/json", ...(request.headers || {}) }, body: request.body });
  return { status: response.status, body: await response.text() };
}

async function httpStreamPost(sender, request) {
  const requestId = crypto.randomUUID();
  setImmediate(async () => {
    try {
      const response = await fetch(request.url, { method: "POST", headers: { "Content-Type": "application/json", ...(request.headers || {}) }, body: request.body });
      if (!response.ok) throw new Error(`API error ${response.status}: ${await response.text()}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.startsWith("data: ")) emit(sender, `http-stream-${requestId}`, line.slice(6).trim());
        }
      }
    } catch (error) {
      emit(sender, `http-stream-${requestId}`, `__ERROR__:${error instanceof Error ? error.message : String(error)}`);
    } finally {
      emit(sender, `http-stream-${requestId}`, "__DONE__");
    }
  });
  return requestId;
}

async function webFetch(url) {
  const response = await fetch(url);
  const text = await response.text();
  return { url, status: response.status, content_type: response.headers.get("content-type") || "", text: stripHtml(text).slice(0, 20000) };
}

async function webSearch(query, maxResults = 5) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await response.text();
  const results = [];
  const regex = /<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[\s\S]*?>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = regex.exec(html)) && results.length < maxResults) {
    results.push({ url: decodeHtml(match[1]), title: stripHtml(match[2]), snippet: stripHtml(match[3]) });
  }
  return results;
}

async function mcpSpawn(sender, config) {
  const child = spawn(config.command, config.args || [], {
    env: { ...process.env, PATH: expandedPath(), ...(config.env || {}) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  mcpProcesses.set(config.id, child);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => chunk.split(/\r?\n/).filter(Boolean).forEach((line) => emit(sender, `mcp-stdout-${config.id}`, line)));
  child.stderr.on("data", (chunk) => chunk.split(/\r?\n/).filter(Boolean).forEach((line) => emit(sender, `mcp-stderr-${config.id}`, line)));
  child.on("close", () => {
    mcpProcesses.delete(config.id);
    emit(sender, `mcp-stdout-${config.id}`, "__MCP_EXIT__");
  });
  child.on("error", (error) => emit(sender, `mcp-stderr-${config.id}`, error.message));
  return { id: config.id, success: true };
}

async function mcpSend(serverId, message) {
  const child = mcpProcesses.get(serverId);
  if (!child) throw new Error(`MCP server not found: ${serverId}`);
  child.stdin.write(`${message}\n`);
}

async function mcpStop(serverId) {
  const child = mcpProcesses.get(serverId);
  if (child) child.kill();
  mcpProcesses.delete(serverId);
}

async function ensureUvInstalled() {
  // Search common install locations. The official `uv` installer
  // (https://astral.sh/uv) puts binaries in ~/.local/bin by default;
  // Homebrew uses /opt/homebrew/bin (Apple Silicon) or /usr/local/bin
  // (Intel). We accept any of them — finding `uvx` first since most
  // call sites prefer the ephemeral runner over `uv` itself.
  const home = os.homedir();
  const uvxCandidates = [
    path.join(home, ".local/bin/uvx"),
    "/opt/homebrew/bin/uvx",
    "/usr/local/bin/uvx",
    "/usr/bin/uvx",
  ];
  const uvCandidates = [
    path.join(home, ".local/bin/uv"),
    "/opt/homebrew/bin/uv",
    "/usr/local/bin/uv",
    "/usr/bin/uv",
  ];
  const uvx = findExecutable(uvxCandidates);
  if (uvx) return uvx;
  const uv = findExecutable(uvCandidates);
  if (uv) return uv;
  throw new Error(
    `uv/uvx not found. Searched: ${[...uvxCandidates, ...uvCandidates].join(", ")}. ` +
      `Install via \`brew install uv\` or \`curl -LsSf https://astral.sh/uv/install.sh | sh\`.`,
  );
}

function expandedPath() {
  // Include the official-installer locations Electron's GUI launch
  // doesn't inherit (~/.local/bin from astral.sh / Cargo, ~/.cargo/bin,
  // Homebrew). PATH from the shell is appended last so user overrides
  // still win.
  const home = os.homedir();
  return [
    path.join(home, ".local/bin"),
    path.join(home, ".cargo/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH || "",
  ].join(path.delimiter);
}

/**
 * Resolve an executable. Tries the explicit candidate paths first
 * (cheap fs.existsSync), then falls back to scanning every directory
 * in `expandedPath()` for the basename of the first candidate. This
 * way `findExecutable(["/opt/homebrew/bin/rg"])` still finds `rg` when
 * the user installed it via cargo into ~/.cargo/bin — Electron-launched
 * processes don't inherit the user's shell PATH.
 */
function findExecutable(candidates) {
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  if (candidates.length === 0) return null;
  const basename = path.basename(candidates[0]);
  for (const dir of expandedPath().split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, basename);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function runCommandText(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { env: { ...process.env, PATH: expandedPath() } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `${program} exited ${code}`)));
  });
}

function stripHtml(input) {
  return decodeHtml(input.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(input) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ---- Browser Service (Playwright) ----

async function browserAction(args) {
  const actions = Array.isArray(args.actions) ? args.actions : [];
  if (actions.length === 0) {
    throw new Error('browser_action requires non-empty "actions" array');
  }

  const outputs = [];
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i] || {};
    const name = String(action.action || "");
    if (!name) throw new Error(`browser action ${i + 1} missing action`);

    const beforeUrl = browserState.page?.url() || "about:blank";
    const result = await executeBrowserAction(name, action);
    outputs.push({ action: name, result });

    const afterUrl = browserState.page?.url() || "";
    const pageChanged = beforeUrl !== afterUrl && !BROWSER_READ_ACTIONS.has(name);
    const nextActionName = String(actions[i + 1]?.action || "");
    const unsafeAfterChange = !BROWSER_READ_ACTIONS.has(nextActionName);
    const stateChanged = ["open", "navigate", "show", "hide", "reload", "new_tab", "switch_tab", "close_tab", "back", "cookies", "storage", "evaluate"].includes(name);
    if ((pageChanged || stateChanged) && unsafeAfterChange && i < actions.length - 1) {
      outputs.push({
        action: "sequence_stop",
        result: {
          reason: pageChanged ? `page changed to ${afterUrl}` : `${name} changes page state`,
          skipped: actions.length - i - 1,
        },
      });
      break;
    }
  }
  return outputs;
}

async function executeBrowserAction(name, action) {
  switch (name) {
    case "open":
    case "navigate": {
      if (!action.url) throw new Error(`${name} requires url`);
      const page = await ensureBrowser({ headed: typeof action.headed === "boolean" ? !!action.headed : undefined });
      await page.goto(String(action.url), { waitUntil: "domcontentloaded", timeout: Number(action.timeout_ms || 30000) });
      await waitBrieflyForPage(page);
      return await snapshotPage();
    }
    case "snapshot":
      await ensureBrowser({});
      return await snapshotPage();
    case "state":
      await ensureBrowser({});
      return await snapshotPage();
    case "extract": {
      await ensureBrowser({});
      const snapshot = await snapshotPage();
      return extractFromBrowserSnapshot(snapshot, String(action.query || ""), Number(action.max_items || 24));
    }
    case "inspect": {
      const ref = Number(action.ref);
      if (!Number.isFinite(ref)) throw new Error("inspect requires numeric ref from snapshot");
      const page = await ensureBrowser({});
      const meta = getBrowserRef(ref);
      const frame = page.frames()[meta.frameIndex];
      if (!frame) throw new Error(`STALE_REF: frame ${meta.frameIndex} no longer exists; call snapshot again`);
      if (meta.frameUrl && frame.url() !== meta.frameUrl) {
        throw new Error(`STALE_REF: frame URL changed from ${meta.frameUrl} to ${frame.url()}; call snapshot again`);
      }
      return await inspectBrowserRef(frame, ref, Number(action.max_chars || 2000));
    }
    case "read": {
      const page = await ensureBrowser({});
      return await readBrowserContent(page, action);
    }
    case "grep": {
      const page = await ensureBrowser({});
      return await grepBrowserContent(page, action);
    }
    case "show":
      return await setBrowserVisibility(true);
    case "hide":
      return await setBrowserVisibility(false);
    case "reload": {
      const page = await ensureBrowser({});
      await page.reload({ waitUntil: "domcontentloaded", timeout: Number(action.timeout_ms || 30000) }).catch(() => null);
      await waitBrieflyForPage(page);
      return await snapshotPage();
    }
    case "tabs": {
      const page = await ensureBrowser({});
      return await browserTabs(page);
    }
    case "new_tab": {
      await ensureBrowser({});
      const page = await browserState.context.newPage();
      browserState.page = page;
      attachBrowserPage(page);
      if (action.url) {
        await page.goto(String(action.url), { waitUntil: "domcontentloaded", timeout: Number(action.timeout_ms || 30000) });
        await waitBrieflyForPage(page);
      }
      return await snapshotPage();
    }
    case "switch_tab": {
      const page = await switchBrowserTab(Number(action.index));
      return { switched: true, index: browserState.context.pages().indexOf(page), url: page.url(), title: await page.title().catch(() => "") };
    }
    case "close_tab": {
      const page = await ensureBrowser({});
      const pages = browserState.context.pages();
      const index = action.index === undefined ? pages.indexOf(page) : Number(action.index);
      if (!Number.isInteger(index) || index < 0 || index >= pages.length) throw new Error("close_tab requires a valid tab index");
      await pages[index].close().catch(() => {});
      browserState.page = browserState.context.pages()[0] || await browserState.context.newPage();
      attachBrowserPage(browserState.page);
      return await browserTabs(browserState.page);
    }
    case "click": {
      const ref = Number(action.ref);
      if (!Number.isFinite(ref)) throw new Error("click requires numeric ref from snapshot");
      const page = await ensureBrowser({});
      const meta = getBrowserRef(ref);
      const frame = page.frames()[meta.frameIndex];
      if (!frame) throw new Error(`STALE_REF: frame ${meta.frameIndex} no longer exists; call snapshot again`);
      if (meta.frameUrl && frame.url() !== meta.frameUrl) throw new Error(`STALE_REF: frame URL changed from ${meta.frameUrl} to ${frame.url()}; call snapshot again`);
      const selector = `[data-cowork-ref="${ref}"]`;
      const locator = frame.locator(selector).first();
      try {
        await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        await locator.click({ timeout: 10000 });
      } catch {
        await performDeepBrowserAction(frame, ref, "click");
      }
      await waitBrieflyForPage(page);
      return { clicked: ref, url: page.url() };
    }
    case "hover":
    case "dblclick":
    case "rightclick": {
      const ref = Number(action.ref);
      if (!Number.isFinite(ref)) throw new Error(`${name} requires numeric ref from snapshot`);
      const page = await ensureBrowser({});
      const { frame } = getBrowserFrameForRef(page, ref);
      const locator = frame.locator(`[data-cowork-ref="${ref}"]`).first();
      try {
        await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        if (name === "hover") await locator.hover({ timeout: 10000 });
        if (name === "dblclick") await locator.dblclick({ timeout: 10000 });
        if (name === "rightclick") await locator.click({ button: "right", timeout: 10000 });
      } catch {
        await performDeepBrowserAction(frame, ref, name);
      }
      await waitBrieflyForPage(page);
      return { action: name, ref, url: page.url() };
    }
    case "type": {
      const ref = Number(action.ref);
      if (!Number.isFinite(ref)) throw new Error("type requires numeric ref from snapshot");
      const text = String(action.text ?? "");
      const page = await ensureBrowser({});
      const meta = getBrowserRef(ref);
      const frame = page.frames()[meta.frameIndex];
      if (!frame) throw new Error(`STALE_REF: frame ${meta.frameIndex} no longer exists; call snapshot again`);
      if (meta.frameUrl && frame.url() !== meta.frameUrl) throw new Error(`STALE_REF: frame URL changed from ${meta.frameUrl} to ${frame.url()}; call snapshot again`);
      const locator = frame.locator(`[data-cowork-ref="${ref}"]`).first();
      try {
        await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        await locator.fill(text, { timeout: 10000 }).catch(async () => {
          await locator.click({ timeout: 5000 });
          await locator.pressSequentially(text, { timeout: 10000 });
        });
      } catch {
        await performDeepBrowserAction(frame, ref, "type", text);
      }
      await waitBrieflyForPage(page);
      return { typed: ref, chars: text.length, url: page.url() };
    }
    case "select": {
      const ref = Number(action.ref);
      if (!Number.isFinite(ref)) throw new Error("select requires numeric ref from snapshot");
      const value = String(action.value ?? action.text ?? "");
      if (!value) throw new Error("select requires value");
      const page = await ensureBrowser({});
      const { frame } = getBrowserFrameForRef(page, ref);
      const selected = await frame.locator(`[data-cowork-ref="${ref}"]`).first().selectOption(value, { timeout: 10000 });
      await waitBrieflyForPage(page);
      return { selected, ref, url: page.url() };
    }
    case "upload": {
      const ref = Number(action.ref);
      if (!Number.isFinite(ref)) throw new Error("upload requires numeric ref from snapshot");
      const files = Array.isArray(action.paths) ? action.paths.map(String) : action.path ? [String(action.path)] : [];
      if (files.length === 0) throw new Error("upload requires path or paths");
      const page = await ensureBrowser({});
      const { frame } = getBrowserFrameForRef(page, ref);
      await frame.locator(`[data-cowork-ref="${ref}"]`).first().setInputFiles(files, { timeout: 15000 });
      await waitBrieflyForPage(page);
      return { uploaded: files, ref, url: page.url() };
    }
    case "check":
    case "uncheck": {
      const ref = Number(action.ref);
      if (!Number.isFinite(ref)) throw new Error(`${name} requires numeric ref from snapshot`);
      const page = await ensureBrowser({});
      const { frame } = getBrowserFrameForRef(page, ref);
      const locator = frame.locator(`[data-cowork-ref="${ref}"]`).first();
      if (name === "check") await locator.check({ timeout: 10000 });
      else await locator.uncheck({ timeout: 10000 });
      await waitBrieflyForPage(page);
      return { action: name, ref, url: page.url() };
    }
    case "clear": {
      const ref = Number(action.ref);
      if (!Number.isFinite(ref)) throw new Error("clear requires numeric ref from snapshot");
      const page = await ensureBrowser({});
      const { frame } = getBrowserFrameForRef(page, ref);
      await frame.locator(`[data-cowork-ref="${ref}"]`).first().fill("", { timeout: 10000 });
      await waitBrieflyForPage(page);
      return { cleared: ref, url: page.url() };
    }
    case "press": {
      const key = String(action.key || action.keys || "");
      if (!key) throw new Error("press requires key");
      const page = await ensureBrowser({});
      if (action.ref !== undefined) {
        const ref = Number(action.ref);
        const meta = getBrowserRef(ref);
        const frame = page.frames()[meta.frameIndex];
        if (!frame) throw new Error(`STALE_REF: frame ${meta.frameIndex} no longer exists; call snapshot again`);
        if (meta.frameUrl && frame.url() !== meta.frameUrl) throw new Error(`STALE_REF: frame URL changed from ${meta.frameUrl} to ${frame.url()}; call snapshot again`);
        await frame.locator(`[data-cowork-ref="${ref}"]`).first().press(key, { timeout: 10000 });
      } else {
        await page.keyboard.press(key);
      }
      await waitBrieflyForPage(page);
      return { pressed: key, url: page.url() };
    }
    case "scroll": {
      const page = await ensureBrowser({});
      const direction = action.direction === "up" ? -1 : 1;
      const pages = Number(action.pages || 1);
      await page.evaluate(({ direction, pages }) => {
        window.scrollBy(0, direction * Math.round(window.innerHeight * pages));
      }, { direction, pages });
      await waitBrieflyForPage(page);
      return await snapshotPage();
    }
    case "back": {
      const page = await ensureBrowser({});
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
      await waitBrieflyForPage(page);
      return await snapshotPage();
    }
    case "wait_for_change": {
      const page = await ensureBrowser({});
      return await waitForBrowserChange(page, Number(action.timeout_ms || 8000));
    }
    case "get_url": {
      const page = await ensureBrowser({});
      return { url: page.url(), title: await page.title().catch(() => "") };
    }
    case "screenshot": {
      const page = await ensureBrowser({});
      const outPath = action.path ? String(action.path) : defaultBrowserScreenshotPath();
      await fsp.mkdir(path.dirname(outPath), { recursive: true });
      if (action.ref !== undefined) {
        const ref = Number(action.ref);
        const { frame } = getBrowserFrameForRef(page, ref);
        await frame.locator(`[data-cowork-ref="${ref}"]`).first().screenshot({ path: outPath });
      } else {
        await page.screenshot({ path: outPath, fullPage: !!action.full_page });
      }
      return { path: outPath, url: page.url(), title: await page.title().catch(() => "") };
    }
    case "pdf": {
      const page = await ensureBrowser({});
      const outPath = action.path ? String(action.path) : defaultBrowserPdfPath();
      await fsp.mkdir(path.dirname(outPath), { recursive: true });
      await page.pdf({ path: outPath, printBackground: action.print_background !== false, format: String(action.format || "A4") });
      return { path: outPath, url: page.url(), title: await page.title().catch(() => "") };
    }
    case "downloads":
      await ensureBrowser({});
      return { downloads: browserState.downloads.slice(-20) };
    case "cookies":
      return await browserCookies(action);
    case "storage":
      return await browserStorage(action);
    case "diagnostics":
      await ensureBrowser({});
      return {
        console: browserState.consoleLogs.slice(-Number(action.limit || 50)),
        network: browserState.networkLogs.slice(-Number(action.limit || 50)),
      };
    case "evaluate": {
      const page = await ensureBrowser({});
      const code = String(action.code || "");
      if (!code.trim()) throw new Error("evaluate requires code");
      const value = await page.evaluate(async ({ code }) => {
        const fn = new Function(`return (async () => { ${code} })()`);
        return await fn();
      }, { code });
      return {
        url: page.url(),
        value: truncateBrowserValue(value, Number(action.max_chars || 4000)),
      };
    }
    case "close":
      if (browserState.context) await browserState.context.close().catch(() => {});
      browserState.context = null;
      browserState.page = null;
      browserState.refs.clear();
      return { closed: true };
    default:
      throw new Error(`Unknown browser action: ${name}`);
  }
}

async function loadPlaywright() {
  if (browserState.playwright) return browserState.playwright;
  try {
    browserState.playwright = require("playwright");
    return browserState.playwright;
  } catch (err) {
    throw new Error(
      "Playwright is not installed. Run `pnpm install` and `pnpm exec playwright install chromium`, then retry. " +
      `Original error: ${err && err.message ? err.message : String(err)}`,
    );
  }
}

async function ensureBrowser(opts) {
  const headed = typeof opts.headed === "boolean" ? !!opts.headed : browserState.headed;
  if (browserState.context && browserState.page && browserState.headed === headed) return browserState.page;
  if (browserState.context) await browserState.context.close().catch(() => {});
  browserState.refs.clear();

  const { chromium } = await loadPlaywright();
  const profileDir = path.join(app.getPath("userData"), "browser", "profiles", "default");
  await fsp.mkdir(profileDir, { recursive: true });
  browserState.context = await chromium.launchPersistentContext(profileDir, {
    headless: !headed,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
  });
  await browserState.context.addInitScript(() => {
    if (window.__coworkClosedShadowRoots) return;
    const roots = new WeakMap();
    window.__coworkClosedShadowRoots = roots;
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachShadow(init) {
      const root = original.call(this, init);
      if (init && init.mode === "closed") roots.set(this, root);
      return root;
    };
  });
  browserState.headed = headed;
  browserState.page = browserState.context.pages()[0] || await browserState.context.newPage();
  attachBrowserPage(browserState.page);
  browserState.context.on("page", (page) => {
    browserState.page = page;
    attachBrowserPage(page);
  });
  return browserState.page;
}

function attachBrowserPage(page) {
  if (!page || page.__coworkDownloadAttached) return;
  page.__coworkDownloadAttached = true;
  page.on("console", (msg) => {
    browserState.consoleLogs.push({
      type: msg.type(),
      text: msg.text(),
      url: page.url(),
      time: new Date().toISOString(),
    });
    if (browserState.consoleLogs.length > 200) browserState.consoleLogs.splice(0, browserState.consoleLogs.length - 200);
  });
  page.on("pageerror", (err) => {
    browserState.consoleLogs.push({
      type: "pageerror",
      text: err && err.message ? err.message : String(err),
      url: page.url(),
      time: new Date().toISOString(),
    });
    if (browserState.consoleLogs.length > 200) browserState.consoleLogs.splice(0, browserState.consoleLogs.length - 200);
  });
  page.on("requestfailed", (request) => {
    browserState.networkLogs.push({
      type: "requestfailed",
      method: request.method(),
      url: request.url(),
      failure: request.failure()?.errorText || "",
      time: new Date().toISOString(),
    });
    if (browserState.networkLogs.length > 200) browserState.networkLogs.splice(0, browserState.networkLogs.length - 200);
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;
    browserState.networkLogs.push({
      type: "response",
      status,
      url: response.url(),
      time: new Date().toISOString(),
    });
    if (browserState.networkLogs.length > 200) browserState.networkLogs.splice(0, browserState.networkLogs.length - 200);
  });
  page.on("download", async (download) => {
    try {
      const suggested = sanitizeFilename(download.suggestedFilename() || "download");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const outPath = path.join(app.getPath("userData"), "browser", "downloads", `${stamp}_${suggested}`);
      await fsp.mkdir(path.dirname(outPath), { recursive: true });
      await download.saveAs(outPath);
      browserState.downloads.push({
        path: outPath,
        suggestedFilename: suggested,
        url: download.url(),
        savedAt: new Date().toISOString(),
      });
      if (browserState.downloads.length > 100) browserState.downloads.splice(0, browserState.downloads.length - 100);
    } catch (err) {
      browserState.downloads.push({
        error: err && err.message ? err.message : String(err),
        savedAt: new Date().toISOString(),
      });
    }
  });
}

function sanitizeFilename(name) {
  return String(name || "download").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 180) || "download";
}

function getBrowserRef(ref) {
  const meta = browserState.refs.get(String(ref));
  if (!meta) throw new Error(`STALE_REF: ref ${ref} is not in the latest snapshot; call snapshot again`);
  return meta;
}

function getBrowserFrameForRef(page, ref) {
  const meta = getBrowserRef(ref);
  const frame = page.frames()[meta.frameIndex];
  if (!frame) throw new Error(`STALE_REF: frame ${meta.frameIndex} no longer exists; call snapshot again`);
  if (meta.frameUrl && frame.url() !== meta.frameUrl) {
    throw new Error(`STALE_REF: frame URL changed from ${meta.frameUrl} to ${frame.url()}; call snapshot again`);
  }
  return { meta, frame };
}

async function setBrowserVisibility(headed) {
  const currentUrl = browserState.page?.url();
  const page = await ensureBrowser({ headed });
  if (currentUrl && currentUrl !== "about:blank" && page.url() === "about:blank") {
    await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
    await waitBrieflyForPage(page);
  }
  return { headed: browserState.headed, url: page.url(), title: await page.title().catch(() => "") };
}

async function browserTabs(activePage) {
  const pages = browserState.context.pages();
  return {
    activeIndex: pages.indexOf(activePage),
    tabs: await Promise.all(pages.map(async (page, index) => ({
      index,
      active: page === activePage,
      url: page.url(),
      title: await page.title().catch(() => ""),
    }))),
  };
}

async function switchBrowserTab(index) {
  const page = await ensureBrowser({});
  const pages = browserState.context.pages();
  if (!Number.isInteger(index) || index < 0 || index >= pages.length) {
    throw new Error(`switch_tab requires index between 0 and ${Math.max(0, pages.length - 1)}`);
  }
  browserState.page = pages[index];
  await browserState.page.bringToFront().catch(() => {});
  return browserState.page || page;
}

async function waitBrieflyForPage(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(300).catch(() => {});
}

async function waitForBrowserChange(page, timeoutMs) {
  const timeout = Math.max(500, Math.min(Number.isFinite(timeoutMs) ? timeoutMs : 8000, 60000));
  const before = await sampleBrowserPageState(page);
  const deadline = Date.now() + timeout;
  let after = before;
  while (Date.now() < deadline) {
    await page.waitForTimeout(300).catch(() => {});
    after = await sampleBrowserPageState(page);
    if (after.url !== before.url) {
      await waitBrieflyForPage(page);
      return { changed: true, reason: "url", before, after: await sampleBrowserPageState(page) };
    }
    if (Math.abs(after.textLength - before.textLength) >= 80) {
      return { changed: true, reason: "text", before, after };
    }
    if (Math.abs(after.interactiveCount - before.interactiveCount) >= 1) {
      return { changed: true, reason: "interactive", before, after };
    }
    if (after.textHead !== before.textHead && after.textLength > 0) {
      return { changed: true, reason: "text_head", before, after };
    }
  }
  return { changed: false, reason: "timeout", before, after, timeout_ms: timeout };
}

async function sampleBrowserPageState(page) {
  const frames = [];
  for (const frame of page.frames()) {
    try {
      frames.push(await frame.evaluate(() => {
        const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
        const interactiveCount = document.querySelectorAll([
          "a[href]",
          "button",
          "input",
          "textarea",
          "select",
          "[role]",
          "[onclick]",
          "[tabindex]:not([tabindex='-1'])",
        ].join(",")).length;
        return {
          url: location.href,
          title: document.title || "",
          textLength: text.length,
          textHead: text.slice(0, 300),
          interactiveCount,
        };
      }));
    } catch (err) {
      frames.push({ url: frame.url(), error: err && err.message ? err.message : String(err), textLength: 0, textHead: "", interactiveCount: 0 });
    }
  }
  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    frameCount: frames.length,
    textLength: frames.reduce((sum, f) => sum + (f.textLength || 0), 0),
    interactiveCount: frames.reduce((sum, f) => sum + (f.interactiveCount || 0), 0),
    textHead: frames.map((f) => f.textHead || "").filter(Boolean).join("\n").slice(0, 500),
    frames,
  };
}

async function readBrowserContent(page, action) {
  const source = normalizeBrowserContentSource(action.source);
  const offset = Math.max(0, Number(action.offset || 0));
  const maxChars = Math.max(500, Math.min(Number(action.max_chars || 6000), 50000));
  const ref = action.ref === undefined ? null : Number(action.ref);
  const frameIndex = action.frame === undefined ? 0 : Number(action.frame);
  const frame = getBrowserFrame(page, frameIndex);
  let content;
  if (ref !== null) {
    if (!Number.isFinite(ref)) throw new Error("read ref must be numeric");
    const { frame: refFrame } = getBrowserFrameForRef(page, ref);
    content = await getBrowserContent(refFrame, source, ref);
  } else {
    content = await getBrowserContent(frame, source, null);
  }
  const totalChars = content.length;
  const text = content.slice(offset, offset + maxChars);
  return {
    source,
    ref,
    frameIndex: ref !== null ? getBrowserRef(ref).frameIndex : frameIndex,
    url: ref !== null ? getBrowserRef(ref).frameUrl : frame.url(),
    offset,
    maxChars,
    totalChars,
    returnedRange: [offset, offset + text.length],
    hasMore: offset + text.length < totalChars,
    text,
  };
}

async function grepBrowserContent(page, action) {
  const pattern = String(action.pattern || action.query || "");
  if (!pattern) throw new Error("grep requires pattern");
  const source = normalizeBrowserContentSource(action.source);
  const caseSensitive = !!action.case_sensitive;
  const maxMatches = Math.max(1, Math.min(Number(action.max_matches || action.max_items || 30), 200));
  const contextChars = Math.max(0, Math.min(Number(action.context_chars || 120), 1000));
  const flags = caseSensitive ? "g" : "gi";
  let regex;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    regex = new RegExp(escapeRegExp(pattern), flags);
  }

  const matches = [];
  const frames = page.frames();
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    const frame = frames[frameIndex];
    let content = "";
    try {
      content = await getBrowserContent(frame, source, null);
    } catch {
      continue;
    }
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      matches.push({
        frameIndex,
        url: frame.url(),
        index: start,
        match: match[0],
        context: content.slice(Math.max(0, start - contextChars), Math.min(content.length, end + contextChars)).replace(/\s+/g, " ").trim(),
      });
      if (matches.length >= maxMatches) break;
      if (match[0].length === 0) regex.lastIndex += 1;
    }
    if (matches.length >= maxMatches) break;
  }
  return {
    source,
    pattern,
    caseSensitive,
    matchCount: matches.length,
    truncated: matches.length >= maxMatches,
    matches,
  };
}

function getBrowserFrame(page, frameIndex) {
  const index = Number.isFinite(frameIndex) ? frameIndex : 0;
  const frame = page.frames()[index];
  if (!frame) throw new Error(`frame ${index} does not exist`);
  return frame;
}

function normalizeBrowserContentSource(source) {
  const value = String(source || "text");
  if (["text", "html", "links"].includes(value)) return value;
  return "text";
}

async function getBrowserContent(frame, source, ref) {
  return frame.evaluate(({ source, ref }) => {
    function shadowRootOf(el) {
      try {
        return el.shadowRoot || (window.__coworkClosedShadowRoots && window.__coworkClosedShadowRoots.get(el)) || null;
      } catch {
        return null;
      }
    }
    function find(root, depth) {
      if (!root || depth > 10 || !ref) return null;
      let found = null;
      try { found = root.querySelector(`[data-cowork-ref="${ref}"]`); } catch {}
      if (found) return found;
      let all = [];
      try { all = Array.from(root.querySelectorAll("*")); } catch {}
      for (const el of all) {
        const sr = shadowRootOf(el);
        if (sr) {
          const inner = find(sr, depth + 1);
          if (inner) return inner;
        }
      }
      return null;
    }
    const root = ref ? find(document, 0) : document.documentElement;
    if (!root) throw new Error(`STALE_REF: ref ${ref} not found in frame`);
    if (source === "html") return root.outerHTML || "";
    if (source === "links") {
      const scope = root.querySelectorAll ? root : document;
      return Array.from(scope.querySelectorAll("a[href]")).map((a) => {
        let absoluteUrl = "";
        try { absoluteUrl = new URL(a.getAttribute("href") || "", location.href).href; } catch { absoluteUrl = a.getAttribute("href") || ""; }
        return `${(a.innerText || a.textContent || "").replace(/\s+/g, " ").trim()} -> ${absoluteUrl}`;
      }).join("\n");
    }
    return (root.innerText || root.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  }, { source, ref: ref == null ? null : String(ref) });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractFromBrowserSnapshot(snapshot, query, maxItems) {
  const limit = Math.max(1, Math.min(Number.isFinite(maxItems) ? maxItems : 24, 80));
  const terms = query.toLowerCase().split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const scoreText = (value) => {
    const lower = String(value || "").toLowerCase();
    if (!terms.length) return 1;
    return terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
  };
  const scoreItem = (item) => scoreText([item.heading, item.text, item.name, item.href, item.absoluteUrl].filter(Boolean).join(" "));
  const pick = (items) => items
    .map((item) => ({ item, score: scoreItem(item) }))
    .filter((entry) => !terms.length || entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);

  return {
    url: snapshot.url,
    title: snapshot.title,
    query,
    stats: snapshot.stats,
    sections: pick(snapshot.sections || []),
    links: pick(snapshot.links || []),
    controls: pick(snapshot.controls || []).slice(0, Math.min(limit, 20)),
    mainTextPreview: snapshot.mainTextPreview,
  };
}

function defaultBrowserScreenshotPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(app.getPath("userData"), "browser", "screenshots", `screenshot_${stamp}.png`);
}

function defaultBrowserPdfPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(app.getPath("userData"), "browser", "pdf", `page_${stamp}.pdf`);
}

async function browserCookies(action) {
  const page = await ensureBrowser({});
  const operation = String(action.operation || "get");
  if (operation === "get") {
    const url = action.url ? String(action.url) : page.url();
    return { cookies: await browserState.context.cookies(url) };
  }
  if (operation === "set") {
    const name = String(action.name || "");
    const value = String(action.value ?? "");
    if (!name) throw new Error("cookies set requires name");
    const cookie = {
      name,
      value,
      url: action.url ? String(action.url) : page.url(),
    };
    if (action.domain) {
      delete cookie.url;
      cookie.domain = String(action.domain);
      cookie.path = String(action.path || "/");
    }
    await browserState.context.addCookies([cookie]);
    return { set: name };
  }
  if (operation === "clear") {
    await browserState.context.clearCookies();
    return { cleared: true };
  }
  if (operation === "export") {
    const outPath = action.path ? String(action.path) : path.join(app.getPath("userData"), "browser", "cookies.json");
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    const cookies = await browserState.context.cookies();
    await fsp.writeFile(outPath, JSON.stringify(cookies, null, 2), "utf8");
    return { path: outPath, count: cookies.length };
  }
  if (operation === "import") {
    if (!action.path) throw new Error("cookies import requires path");
    const raw = await fsp.readFile(String(action.path), "utf8");
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies)) throw new Error("cookies import file must contain an array");
    await browserState.context.addCookies(cookies);
    return { imported: cookies.length };
  }
  throw new Error(`Unsupported cookies operation: ${operation}`);
}

async function browserStorage(action) {
  const page = await ensureBrowser({});
  const operation = String(action.operation || "get");
  const area = action.area === "session" ? "session" : "local";
  return await page.evaluate(({ operation, area, key, value }) => {
    const storage = area === "session" ? window.sessionStorage : window.localStorage;
    if (operation === "get") {
      if (key) return { area, key, value: storage.getItem(key) };
      const entries = {};
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k) entries[k] = storage.getItem(k);
      }
      return { area, entries };
    }
    if (operation === "set") {
      if (!key) throw new Error("storage set requires key");
      storage.setItem(key, value == null ? "" : String(value));
      return { area, set: key };
    }
    if (operation === "clear") {
      if (key) storage.removeItem(key);
      else storage.clear();
      return { area, cleared: key || true };
    }
    throw new Error(`Unsupported storage operation: ${operation}`);
  }, {
    operation,
    area,
    key: action.key ? String(action.key) : "",
    value: action.value,
  });
}

function truncateBrowserValue(value, maxChars) {
  const limit = Math.max(500, Math.min(Number.isFinite(maxChars) ? maxChars : 4000, 20000));
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return value;
  if (text.length <= limit) return value;
  return `${text.slice(0, limit - 3)}...`;
}

async function performDeepBrowserAction(frame, ref, action, text = "") {
  return frame.evaluate(({ ref, action, text }) => {
    function shadowRootOf(el) {
      try {
        return el.shadowRoot || (window.__coworkClosedShadowRoots && window.__coworkClosedShadowRoots.get(el)) || null;
      } catch {
        return null;
      }
    }
    function find(root, depth) {
      if (!root || depth > 10) return null;
      let found = null;
      try { found = root.querySelector(`[data-cowork-ref="${ref}"]`); } catch {}
      if (found) return found;
      let all = [];
      try { all = Array.from(root.querySelectorAll("*")); } catch {}
      for (const el of all) {
        const sr = shadowRootOf(el);
        if (sr) {
          const inner = find(sr, depth + 1);
          if (inner) return inner;
        }
      }
      return null;
    }
    const el = find(document, 0);
    if (!el) throw new Error(`STALE_REF: ref ${ref} not found in frame`);
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch {}
    if (action === "click") {
      for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window }));
      }
      return true;
    }
    if (action === "hover") {
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, composed: true, view: window }));
      el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, composed: true, view: window }));
      return true;
    }
    if (action === "dblclick") {
      for (const type of ["mousedown", "mouseup", "click", "mousedown", "mouseup", "click", "dblclick"]) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window }));
      }
      return true;
    }
    if (action === "rightclick") {
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true, button: 2, view: window }));
      return true;
    }
    if (action === "type") {
      el.focus && el.focus();
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
      el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      return true;
    }
    throw new Error(`Unsupported deep browser action: ${action}`);
  }, { ref: String(ref), action, text });
}

async function inspectBrowserRef(frame, ref, maxChars) {
  const limit = Math.max(200, Math.min(Number.isFinite(maxChars) ? maxChars : 2000, 12000));
  return frame.evaluate(({ ref, limit }) => {
    function trunc(value, max) {
      const s = String(value || "").replace(/\s+/g, " ").trim();
      return s.length > max ? `${s.slice(0, max - 3)}...` : s;
    }
    function shadowRootOf(el) {
      try {
        return el.shadowRoot || (window.__coworkClosedShadowRoots && window.__coworkClosedShadowRoots.get(el)) || null;
      } catch {
        return null;
      }
    }
    function find(root, depth) {
      if (!root || depth > 10) return null;
      let found = null;
      try { found = root.querySelector(`[data-cowork-ref="${ref}"]`); } catch {}
      if (found) return found;
      let all = [];
      try { all = Array.from(root.querySelectorAll("*")); } catch {}
      for (const el of all) {
        const sr = shadowRootOf(el);
        if (sr) {
          const inner = find(sr, depth + 1);
          if (inner) return inner;
        }
      }
      return null;
    }
    function attrsOf(el) {
      const attrs = {};
      for (const attr of Array.from(el.attributes || [])) {
        if (attr.name === "style" || attr.name.startsWith("data-cowork-")) continue;
        attrs[attr.name] = trunc(attr.value, 300);
      }
      return attrs;
    }
    function brief(el) {
      if (!el) return null;
      return {
        tag: el.tagName?.toLowerCase() || "",
        role: el.getAttribute?.("role") || "",
        text: trunc(el.innerText || el.textContent || "", 500),
        attrs: attrsOf(el),
      };
    }

    const el = find(document, 0);
    if (!el) throw new Error(`STALE_REF: ref ${ref} not found in frame`);
    const rect = el.getBoundingClientRect();
    const children = Array.from(el.children || []).slice(0, 20).map(brief);
    const parent = brief(el.parentElement);
    const html = trunc(el.outerHTML || "", limit);
    return {
      ref: Number(ref),
      url: location.href,
      title: document.title || "",
      element: {
        ...brief(el),
        visible: rect.width > 0 && rect.height > 0,
        bbox: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
        html,
      },
      parent,
      children,
    };
  }, { ref: String(ref), limit });
}

async function snapshotPage() {
  const page = await ensureBrowser({});
  browserState.refs.clear();
  browserState.snapshotId += 1;
  let nextRef = 1;
  const frames = [];
  const allLinks = [];
  const allControls = [];
  const allSections = [];

  const pageFrames = page.frames();
  for (let frameIndex = 0; frameIndex < pageFrames.length; frameIndex++) {
    const frame = pageFrames[frameIndex];
    let frameAst;
    try {
      frameAst = await frame.evaluate(browserExtractor, { startRef: nextRef, frameIndex });
    } catch (err) {
      frameAst = {
        frameIndex,
        url: frame.url(),
        error: err && err.message ? err.message : String(err),
        links: [],
        controls: [],
        sections: [],
        mainTextPreview: "",
        nextRef,
      };
    }
    nextRef = frameAst.nextRef || nextRef;
    frames.push({
      frameIndex,
      url: frameAst.url || frame.url(),
      title: frameAst.title || "",
      error: frameAst.error,
      stats: frameAst.stats || {},
    });
    for (const link of frameAst.links || []) {
      const item = { ...link, frameIndex, frameUrl: frameAst.url || frame.url(), snapshotId: browserState.snapshotId };
      allLinks.push(item);
      browserState.refs.set(String(item.ref), item);
    }
    for (const control of frameAst.controls || []) {
      const item = { ...control, frameIndex, frameUrl: frameAst.url || frame.url(), snapshotId: browserState.snapshotId };
      allControls.push(item);
      browserState.refs.set(String(item.ref), item);
    }
    for (const section of frameAst.sections || []) {
      allSections.push({ ...section, frameIndex });
    }
  }

  const mainTextPreview = allSections.map((s) => [s.heading, s.text].filter(Boolean).join("\n")).filter(Boolean).join("\n\n").slice(0, 3000);
  return {
    snapshotId: `s_${browserState.snapshotId}`,
    url: page.url(),
    title: await page.title().catch(() => ""),
    headed: browserState.headed,
    frames,
    stats: {
      links: allLinks.length,
      controls: allControls.length,
      sections: allSections.length,
      refs: browserState.refs.size,
    },
    links: allLinks.slice(0, 120),
    controls: allControls.slice(0, 160),
    sections: allSections.slice(0, 80),
    downloads: browserState.downloads.slice(-10),
    mainTextPreview,
  };
}

function browserExtractor(input) {
  const startRef = input.startRef || 1;
  const frameIndex = input.frameIndex || 0;
  let nextRef = startRef;
  const links = [];
  const controls = [];
  const sections = [];
  const seenText = new Set();

  function trunc(value, max) {
    const s = String(value || "").replace(/\s+/g, " ").trim();
    return s.length > max ? `${s.slice(0, max - 3)}...` : s;
  }
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function bbox(el) {
    const r = el.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  }
  function nameOf(el) {
    const labelledBy = el.getAttribute && el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
      if (text.trim()) return trunc(text, 120);
    }
    const attrs = ["aria-label", "alt", "title", "placeholder", "value"];
    for (const attr of attrs) {
      const v = el.getAttribute && el.getAttribute(attr);
      if (v && String(v).trim()) return trunc(v, 120);
    }
    if (el.labels && el.labels.length) {
      const label = Array.from(el.labels).map((l) => l.innerText).join(" ");
      if (label.trim()) return trunc(label, 120);
    }
    return trunc(el.innerText || el.textContent || "", 120);
  }
  function roleOf(el) {
    const role = el.getAttribute && el.getAttribute("role");
    if (role) return role;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button") return "button";
      if (type === "file") return "file-input";
      return "textbox";
    }
    return tag;
  }
  function absoluteUrl(raw) {
    try { return new URL(raw, location.href).href; } catch { return raw || ""; }
  }
  function addRef(el) {
    const ref = nextRef++;
    try { el.setAttribute("data-cowork-ref", String(ref)); } catch {}
    return ref;
  }
  function addInteractive(el) {
    if (!isVisible(el) && !((el.tagName || "").toLowerCase() === "input" && (el.type || "").toLowerCase() === "file")) return;
    const tag = el.tagName.toLowerCase();
    const role = roleOf(el);
    const ref = addRef(el);
    const item = {
      ref,
      frameIndex,
      role,
      tag,
      name: nameOf(el),
      visible: isVisible(el),
      bbox: bbox(el),
    };
    if (tag === "a" && el.getAttribute("href") !== null) {
      const href = el.getAttribute("href") || "";
      const url = absoluteUrl(href);
      let parsed = null;
      try { parsed = new URL(url); } catch {}
      links.push({
        ...item,
        kind: "link",
        href,
        absoluteUrl: url,
        pathname: parsed?.pathname || "",
        hash: parsed?.hash || "",
      });
    } else {
      controls.push({
        ...item,
        kind: "control",
        type: el.getAttribute("type") || "",
        value: role === "textbox" ? trunc(el.value || "", 80) : undefined,
        placeholder: trunc(el.getAttribute("placeholder") || "", 80),
      });
    }
  }
  function addSection(el) {
    if (!isVisible(el)) return;
    const heading = trunc(el.matches("h1,h2,h3,h4") ? el.innerText : (el.querySelector("h1,h2,h3,h4")?.innerText || ""), 160);
    const text = trunc(el.innerText || "", 700);
    if (!text || seenText.has(text)) return;
    seenText.add(text);
    sections.push({ heading, text });
  }
  function shadowRootOf(el) {
    try {
      return el.shadowRoot || (window.__coworkClosedShadowRoots && window.__coworkClosedShadowRoots.get(el)) || null;
    } catch {
      return null;
    }
  }
  function deepQueryAll(selector) {
    const out = [];
    const seen = new Set();
    function visit(root, depth) {
      if (!root || depth > 10) return;
      let matches = [];
      try { matches = Array.from(root.querySelectorAll(selector)); } catch {}
      for (const el of matches) {
        if (!seen.has(el)) {
          seen.add(el);
          out.push(el);
        }
      }
      let all = [];
      try { all = Array.from(root.querySelectorAll("*")); } catch {}
      for (const el of all) {
        const sr = shadowRootOf(el);
        if (sr) visit(sr, depth + 1);
      }
    }
    visit(document, 0);
    return out;
  }

  const interactiveSelector = [
    "a[href]",
    "button",
    "input",
    "textarea",
    "select",
    "[role]",
    "[onclick]",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  deepQueryAll(interactiveSelector).forEach(addInteractive);
  deepQueryAll("main,article,section,form,dialog,h1,h2,h3,h4,p,li,td,th").forEach((el) => {
    if (sections.length < 120) addSection(el);
  });

  const scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
  const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
  return {
    frameIndex,
    url: location.href,
    title: document.title || "",
    stats: {
      links: links.length,
      controls: controls.length,
      sections: sections.length,
      elements: deepQueryAll("*").length,
      pagesAbove: viewportHeight ? scrollTop / viewportHeight : 0,
      pagesBelow: viewportHeight ? Math.max(0, (scrollHeight - scrollTop - viewportHeight) / viewportHeight) : 0,
    },
    links,
    controls,
    sections,
    mainTextPreview: sections.map((s) => s.text).join("\n").slice(0, 2000),
    nextRef,
  };
}
