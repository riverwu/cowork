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

const skipDirs = new Set(["node_modules", "target", ".git", "__pycache__", "dist", "build", ".next"]);
const contentIndexableExtensions = new Set([
  "txt", "md", "markdown", "csv", "json", "xml", "html", "htm",
  "pdf", "doc", "docx", "xlsx", "xls",
  "py", "js", "ts", "rs", "go", "java", "rb", "sh",
  "yaml", "yml", "toml",
]);

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
    case "slideml_compile": return slidemlCompile(args.slideml, args.theme, args.outputPath);
    case "slideml_list_layouts": return slidemlListLayouts(args.theme);
    case "slideml_describe_layout": return slidemlDescribeLayout(args.theme, args.layoutName);
    case "slideml_validate": return slidemlValidate(args.slideml, args.theme);
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
  return runScript("python3", ["-c", script], undefined, timeoutSecs);
}

async function initPythonEnv() {
  const dir = path.join(os.homedir(), ".cowork", "python");
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function installPythonPackage(pkg) {
  const result = await runScript("python3", ["-m", "pip", "install", pkg], undefined, 120);
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

// Path to slideml's compiled CLI (workspace-linked into cowork's node_modules).
function slidemlCliPath() {
  return path.resolve(__dirname, "..", "node_modules", "slideml", "dist", "bin", "slideml.js");
}

// Resolve a theme name to its directory. Built-in themes ship in
// node_modules/slideml/dist/themes/<name>; user-installed themes live in
// ~/.cowork/themes/<name>.
function slidemlThemePath(theme) {
  if (!theme) theme = "technical-blue";
  if (theme.startsWith("/") || theme.startsWith("~")) {
    return theme.replace(/^~/, os.homedir());
  }
  const builtin = path.resolve(__dirname, "..", "node_modules", "slideml", "dist", "themes", theme);
  if (fs.existsSync(builtin)) return builtin;
  const user = path.join(os.homedir(), ".cowork", "themes", theme);
  if (fs.existsSync(user)) return user;
  throw new Error(`Theme "${theme}" not found in built-ins or ~/.cowork/themes/`);
}

async function slidemlCompile(slidemlYaml, theme, outputPath) {
  if (!slidemlYaml) throw new Error("slideml_compile: slideml YAML body is required");
  if (!outputPath) throw new Error("slideml_compile: outputPath is required");

  const cli = slidemlCliPath();
  if (!fs.existsSync(cli)) {
    throw new Error(`slideml CLI not found at ${cli}. Run \`pnpm install\` at the workspace root.`);
  }
  const themeDir = slidemlThemePath(theme);
  const tmpYaml = path.join(os.tmpdir(), `slideml-${crypto.randomUUID()}.yaml`);
  await fsp.writeFile(tmpYaml, slidemlYaml, "utf8");
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  try {
    const result = await runScript(
      "node",
      [cli, "compile", tmpYaml, "--theme", themeDir, "-o", outputPath],
      undefined,
      120,
    );
    if (result.exit_code !== 0) {
      const msg = (result.stderr || result.stdout || "").trim() || `slideml compile exited ${result.exit_code}`;
      throw new Error(msg);
    }
    return { outputPath, stdout: result.stdout.trim() };
  } finally {
    fsp.rm(tmpYaml, { force: true }).catch(() => {});
  }
}

async function slidemlListLayouts(theme) {
  // Returns compact summaries (`slideml layouts` default mode). Use
  // slideml_describe_layout to fetch the full schema for a chosen layout.
  const cli = slidemlCliPath();
  if (!fs.existsSync(cli)) {
    throw new Error(`slideml CLI not found at ${cli}. Run \`pnpm install\` at the workspace root.`);
  }
  const themeDir = slidemlThemePath(theme);
  const result = await runScript("node", [cli, "layouts", "--theme", themeDir, "--json"], undefined, 30);
  if (result.exit_code !== 0) {
    throw new Error((result.stderr || result.stdout || "").trim() || `slideml layouts exited ${result.exit_code}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`slideml_list_layouts: failed to parse JSON output: ${err}`);
  }
}

async function slidemlDescribeLayout(theme, layoutName) {
  if (!layoutName) throw new Error("slideml_describe_layout: layoutName is required");
  const cli = slidemlCliPath();
  if (!fs.existsSync(cli)) {
    throw new Error(`slideml CLI not found at ${cli}. Run \`pnpm install\` at the workspace root.`);
  }
  const themeDir = slidemlThemePath(theme);
  const result = await runScript("node", [cli, "describe", layoutName, "--theme", themeDir, "--json"], undefined, 30);
  if (result.exit_code !== 0) {
    throw new Error((result.stderr || result.stdout || "").trim() || `slideml describe exited ${result.exit_code}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`slideml_describe_layout: failed to parse JSON output: ${err}`);
  }
}

async function slidemlValidate(slidemlYaml, theme) {
  if (!slidemlYaml) throw new Error("slideml_validate: slideml YAML body is required");
  const cli = slidemlCliPath();
  if (!fs.existsSync(cli)) {
    throw new Error(`slideml CLI not found at ${cli}. Run \`pnpm install\` at the workspace root.`);
  }
  const themeDir = slidemlThemePath(theme);
  const tmpYaml = path.join(os.tmpdir(), `slideml-validate-${crypto.randomUUID()}.yaml`);
  await fsp.writeFile(tmpYaml, slidemlYaml, "utf8");
  try {
    const result = await runScript("node", [cli, "validate", tmpYaml, "--theme", themeDir], undefined, 30);
    if (result.exit_code === 0) {
      return { ok: true };
    }
    return { ok: false, errors: (result.stderr || result.stdout || "").trim() };
  } finally {
    fsp.rm(tmpYaml, { force: true }).catch(() => {});
  }
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
  const uvx = findExecutable(["/opt/homebrew/bin/uvx", "/usr/local/bin/uvx", "/usr/bin/uvx"]);
  if (uvx) return uvx;
  const uv = findExecutable(["/opt/homebrew/bin/uv", "/usr/local/bin/uv", "/usr/bin/uv"]);
  if (uv) return uv;
  throw new Error("uv/uvx not found");
}

function expandedPath() {
  return ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH || ""].join(path.delimiter);
}

function findExecutable(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
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
