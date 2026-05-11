import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { FileInfo } from "@/types";

type CoworkElectronBridge = {
  runtime: "electron";
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(channel: string, handler: (payload: T) => void): () => void;
};

function electronBridge(): CoworkElectronBridge | null {
  if (typeof window === "undefined") return null;
  return (window as typeof window & { cowork?: CoworkElectronBridge }).cowork || null;
}

/** True when running inside the Tauri WebView rather than a plain browser tab. */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isElectronRuntime(): boolean {
  return electronBridge()?.runtime === "electron";
}

export function isDesktopRuntime(): boolean {
  return isTauriRuntime() || isElectronRuntime();
}

export async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const electron = electronBridge();
  if (electron) return electron.invoke<T>(command, args);
  return invoke<T>(command, args);
}

export async function listenDesktop<T>(
  channel: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  const electron = electronBridge();
  if (electron) {
    return electron.listen<T>(channel, (payload) => handler({ payload }));
  }
  return listen<T>(channel, handler);
}

/** Start dragging the current native window. */
export async function startWindowDrag(): Promise<void> {
  if (isElectronRuntime()) return;
  if (!isTauriRuntime()) return;
  await getCurrentWindow().startDragging();
}

/** Open a file in system default application. */
export async function openPath(path: string): Promise<void> {
  return invokeDesktop<void>("open_path", { path });
}

/** Reveal a file in Finder/Explorer. */
export async function revealInFolder(path: string): Promise<void> {
  return invokeDesktop<void>("reveal_in_folder", { path });
}

/** Open a native folder picker dialog. Returns the selected path or null. */
export async function pickFolder(): Promise<string | null> {
  const electron = electronBridge();
  if (electron) return electron.invoke<string | null>("dialog_pick_folder");
  const result = await open({ directory: true, multiple: false });
  return result as string | null;
}

/** Open a native file picker dialog. */
export async function pickFiles(options?: {
  multiple?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string[] | string | null> {
  const electron = electronBridge();
  if (electron) return electron.invoke<string[] | string | null>("dialog_pick_files", options as Record<string, unknown>);
  const result = await open(options);
  return result as string[] | string | null;
}

/** Scan a directory recursively for supported document files. */
export async function scanDirectory(path: string): Promise<FileInfo[]> {
  return invokeDesktop<FileInfo[]>("scan_directory", { path });
}

/** Read a text file's raw contents. */
export async function readFileText(path: string): Promise<string> {
  return invokeDesktop<string>("read_file_text", { path });
}

/** Parse a document (PDF, DOCX, XLSX, or text) and extract text content. */
export async function parseDocument(path: string): Promise<string> {
  return invokeDesktop<string>("parse_document", { path });
}

export interface ExtractedTextCacheResult {
  cachePath: string;
  preview: string;
  charCount: number;
  byteCount: number;
}

/** Parse a document and write full extracted text directly to a cache file. */
export async function extractDocumentTextToCache(
  path: string,
  cachePath: string,
  previewChars = 24000,
): Promise<ExtractedTextCacheResult> {
  const result = await invokeDesktop<{
    cache_path: string;
    preview: string;
    char_count: number;
    byte_count: number;
  }>("extract_document_text_to_cache", { path, cachePath, previewChars });
  return {
    cachePath: result.cache_path,
    preview: result.preview,
    charCount: result.char_count,
    byteCount: result.byte_count,
  };
}

export interface NativeIndexProgress {
  jobId: string;
  sourceId: string;
  phase: "scan" | "extract" | "done" | "error";
  current: number;
  total: number;
  filename?: string | null;
  message: string;
}

export interface NativeIndexedFile extends FileInfo {
  jobId: string;
  sourceId: string;
  cachePath?: string | null;
  preview?: string | null;
  charCount?: number | null;
  byteCount?: number | null;
  error?: string | null;
  unchanged?: boolean;
}

export interface NativeKnownFile {
  path: string;
  contentHash: string;
}

export async function startKnowledgeIndex(
  sourceId: string,
  path: string,
  knownFiles: NativeKnownFile[] = [],
): Promise<string> {
  return invokeDesktop<string>("start_knowledge_index", {
    sourceId,
    path,
    knownFiles: knownFiles.map((file) => ({
      path: file.path,
      content_hash: file.contentHash,
    })),
  });
}

export async function onKnowledgeIndexProgress(
  handler: (progress: NativeIndexProgress) => void,
): Promise<() => void> {
  return listenDesktop<{
    job_id: string;
    source_id: string;
    phase: NativeIndexProgress["phase"];
    current: number;
    total: number;
    filename?: string | null;
    message: string;
  }>("knowledge-index-progress", (event) => {
    handler({
      jobId: event.payload.job_id,
      sourceId: event.payload.source_id,
      phase: event.payload.phase,
      current: event.payload.current,
      total: event.payload.total,
      filename: event.payload.filename,
      message: event.payload.message,
    });
  });
}

export async function onKnowledgeIndexFile(
  handler: (file: NativeIndexedFile) => void,
): Promise<() => void> {
  return listenDesktop<{
    job_id: string;
    source_id: string;
    name: string;
    path: string;
    is_dir: boolean;
    size: number;
    modified_at: number;
    extension: string;
    cache_path?: string | null;
    preview?: string | null;
    char_count?: number | null;
    byte_count?: number | null;
    error?: string | null;
    unchanged?: boolean;
  }>("knowledge-index-file", (event) => {
    handler({
      jobId: event.payload.job_id,
      sourceId: event.payload.source_id,
      name: event.payload.name,
      path: event.payload.path,
      is_dir: event.payload.is_dir,
      size: event.payload.size,
      modified_at: event.payload.modified_at,
      extension: event.payload.extension,
      cachePath: event.payload.cache_path,
      preview: event.payload.preview,
      charCount: event.payload.char_count,
      byteCount: event.payload.byte_count,
      error: event.payload.error,
      unchanged: event.payload.unchanged,
    });
  });
}

export async function onKnowledgeIndexFiles(
  handler: (files: NativeIndexedFile[]) => void,
): Promise<() => void> {
  return listenDesktop<{
    job_id: string;
    source_id: string;
    files: Array<{
      job_id: string;
      source_id: string;
      name: string;
      path: string;
      is_dir: boolean;
      size: number;
      modified_at: number;
      extension: string;
      cache_path?: string | null;
      preview?: string | null;
      char_count?: number | null;
      byte_count?: number | null;
      error?: string | null;
      unchanged?: boolean;
    }>;
  }>("knowledge-index-files", (event) => {
    handler(event.payload.files.map((file) => ({
      jobId: file.job_id,
      sourceId: file.source_id,
      name: file.name,
      path: file.path,
      is_dir: file.is_dir,
      size: file.size,
      modified_at: file.modified_at,
      extension: file.extension,
      cachePath: file.cache_path,
      preview: file.preview,
      charCount: file.char_count,
      byteCount: file.byte_count,
      error: file.error,
      unchanged: file.unchanged,
    })));
  });
}

export async function onKnowledgeIndexDone(
  handler: (progress: NativeIndexProgress) => void,
): Promise<() => void> {
  return listenDesktop<{
    job_id: string;
    source_id: string;
    phase: NativeIndexProgress["phase"];
    current: number;
    total: number;
    filename?: string | null;
    message: string;
  }>("knowledge-index-done", (event) => {
    handler({
      jobId: event.payload.job_id,
      sourceId: event.payload.source_id,
      phase: event.payload.phase,
      current: event.payload.current,
      total: event.payload.total,
      filename: event.payload.filename,
      message: event.payload.message,
    });
  });
}

/** Write content to a file. Creates parent dirs if needed. */
export async function writeFile(path: string, content: string): Promise<void> {
  return invokeDesktop<void>("write_file", { path, content });
}

/** Delete a file if it exists. */
export async function deleteFile(path: string): Promise<void> {
  return invokeDesktop<void>("delete_file", { path });
}

/** Recursively delete a directory if it exists. */
export async function deleteDirectory(path: string): Promise<void> {
  return invokeDesktop<void>("delete_directory", { path });
}

/** Read a local file and return its bytes as a base64 string. */
export async function readFileBase64(path: string): Promise<string> {
  return invokeDesktop<string>("read_file_base64", { path });
}

/** Download a URL and save its body to a local file. Returns the saved path. */
export async function downloadUrl(url: string, path: string): Promise<string> {
  return invokeDesktop<string>("download_url", { url, path });
}

/** List directory contents (non-recursive). */
export async function listDirectory(path: string): Promise<FileInfo[]> {
  return invokeDesktop<FileInfo[]>("list_directory", { path });
}

/** Search file contents recursively for a pattern. */
export async function grep(directory: string, pattern: string, maxResults?: number): Promise<GrepMatch[]> {
  return invokeDesktop<GrepMatch[]>("grep", { directory, pattern, maxResults });
}

export interface GrepMatch {
  path: string;
  line_number: number;
  line: string;
}

/** Search file contents recursively using ripgrep when available. */
export async function ripgrepSearch(directory: string, pattern: string, maxResults?: number): Promise<GrepMatch[]> {
  return invokeDesktop<GrepMatch[]>("ripgrep_search", { directory, pattern, maxResults });
}

export interface PythonResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

/** Execute Python script in the isolated environment. */
export async function runPythonScript(script: string, timeoutSecs?: number): Promise<PythonResult> {
  return invokeDesktop<PythonResult>("run_python_script", { script, timeoutSecs });
}

/** Initialize the isolated Python environment. */
export async function initPythonEnv(): Promise<string> {
  return invokeDesktop<string>("init_python_env");
}

/** Install a Python package into the isolated environment. */
export async function installPythonPackage(pkg: string): Promise<string> {
  return invokeDesktop<string>("install_python_package", { package: pkg });
}

// ---- Node.js isolated environment ----

/** Initialize the isolated Node.js environment (~/.cowork/node/). */
export async function initNodeEnv(): Promise<string> {
  return invokeDesktop<string>("init_node_env");
}

/** Install an npm package into the isolated environment. */
export async function installNodePackage(pkg: string): Promise<string> {
  return invokeDesktop<string>("install_node_package", { package: pkg });
}

/** Get NODE_PATH for the isolated environment. */
export async function getNodePath(): Promise<string> {
  return invokeDesktop<string>("get_node_path");
}

/** Execute a Node.js script in the isolated environment. */
export async function runNodeScript(script: string, cwd?: string, timeoutSecs?: number): Promise<PythonResult> {
  return invokeDesktop<PythonResult>("run_node_script", { script, cwd, timeoutSecs });
}

// ---- Debug log ----

export interface DebugLogInitResult {
  requestDir: string;
  logPath: string;
}

export interface DebugLogCopyResult {
  copiedAs: string;
  absPath: string;
  byteLength: number;
}

export async function debugLogInit(requestId: string, header: Record<string, unknown>): Promise<DebugLogInitResult> {
  return invokeDesktop<DebugLogInitResult>("debug_log_init", { requestId, header });
}

export async function debugLogAppend(logPath: string, line: string): Promise<void> {
  return invokeDesktop<void>("debug_log_append", { logPath, line });
}

export async function debugLogCopyArtifact(
  requestDir: string,
  srcPath: string,
  label?: string,
): Promise<DebugLogCopyResult | null> {
  return invokeDesktop<DebugLogCopyResult | null>("debug_log_copy_artifact", { requestDir, srcPath, label });
}

export async function debugLogOpenRoot(): Promise<string> {
  return invokeDesktop<string>("debug_log_open_root");
}

// ---- SlideML2 ----

export interface Slideml2DescribeSchemaResult {
  deck: unknown;
  components: { index: unknown; details?: unknown };
  nodeTypes: { type: string; use?: string }[];
  textKinds: unknown;
  themes: unknown;
  palette: unknown;
  defaultTheme: unknown;
}

export interface Slideml2BrandSpec {
  name?: string;
  primary?: string;
  logo?: string;
}

export interface Slideml2CreateDeckResult {
  deckPath: string;
  ok?: boolean;
  error?: string;
  validation?: Slideml2ValidationReport;
  [key: string]: unknown;
}

export interface Slideml2ValidationReport {
  ok: boolean;
  errors?: { code?: string; severity?: string; path?: string; message: string; suggestedFix?: string; [key: string]: unknown }[];
}

export interface Slideml2Diagnostic {
  code: string;
  severity: string;
  message?: string;
  suggestion?: string;
  surfaceTrail?: string[];
  aggregated?: {
    count: number;
    affectedNodes: Array<{ nodeId: string; sample?: string }>;
  };
  constrainedBy?: {
    ancestorId: string;
    prop: string;
    value: number;
  };
  [key: string]: unknown;
}

export interface Slideml2ReplaceSlideResult {
  ok: boolean;
  error?: string;
  validation?: Slideml2ValidationReport;
  diagnostics?: {
    count: number;
    summary: Record<string, number>;
    blockingCount: number;
    blocking: Slideml2Diagnostic[];
    qualityCount?: number;
    quality?: Slideml2Diagnostic[];
  };
  insertedAt?: number;
  replacedAt?: number;
  slideCount?: number;
  [key: string]: unknown;
}

export interface Slideml2PatchDeckResult {
  ok: boolean;
  error?: string;
  summary: { slideCount: number; slides: { index: number; id: string; title?: string }[] };
  validation: Slideml2ValidationReport;
}

export interface Slideml2ValidateRenderResult {
  ok: boolean;
  error?: string;
  validation: Slideml2ValidationReport;
  outputPath?: string;
  domPath?: string;
  diagnosticsPath?: string;
  diagnostics?: {
    count: number;
    summary: Record<string, number>;
    blockingCount: number;
    blocking: Slideml2Diagnostic[];
    qualityCount?: number;
    quality?: Slideml2Diagnostic[];
  };
}

export interface Slideml2JsonPatchOp {
  op: "add" | "replace" | "remove" | "move" | "copy" | "test";
  path: string;
  value?: unknown;
  from?: string;
}

/** Return the SlideML2 authoring schema, deck rules, component index, etc. */
export async function slideml2DescribeSchema(components?: string[]): Promise<Slideml2DescribeSchemaResult> {
  return invokeDesktop<Slideml2DescribeSchemaResult>("slideml2_describe_schema", { components });
}

/** Create a fresh SlideML2 source deck JSON file. */
export async function slideml2CreateDeck(
  deckPath: string,
  options: { title?: string; size?: "16x9" | "16x10" | "4x3" | "wide"; theme?: string; brand?: Slideml2BrandSpec; themeOverride?: unknown; validation?: unknown; dataSources?: unknown; references?: unknown; footnotes?: unknown },
): Promise<Slideml2CreateDeckResult> {
  return invokeDesktop<Slideml2CreateDeckResult>("slideml2_create_deck", {
    deckPath,
    title: options.title,
    size: options.size,
    theme: options.theme,
    brand: options.brand,
    themeOverride: options.themeOverride,
    validation: options.validation,
    dataSources: options.dataSources,
    references: options.references,
    footnotes: options.footnotes,
  });
}

/** Read the SlideML2 deck JSON. */
export async function slideml2ReadDeck(deckPath: string): Promise<unknown> {
  return invokeDesktop<unknown>("slideml2_read_deck", { deckPath });
}

/** Replace a slide by id or index; appends if slideId === slideCount. */
export async function slideml2ReplaceSlide(
  deckPath: string,
  slideId: string | number,
  slide: unknown,
): Promise<Slideml2ReplaceSlideResult> {
  return invokeDesktop<Slideml2ReplaceSlideResult>("slideml2_replace_slide", { deckPath, slideId, slide });
}

/** Apply RFC6902-style JSON Patch ops to the deck. */
export async function slideml2PatchDeck(
  deckPath: string,
  patch: Slideml2JsonPatchOp[],
): Promise<Slideml2PatchDeckResult> {
  return invokeDesktop<Slideml2PatchDeckResult>("slideml2_patch_deck", { deckPath, patch });
}

/** Validate the deck and (optionally) render to PPTX. */
export async function slideml2ValidateRender(
  deckPath: string,
  outputPath?: string,
  render: boolean = true,
): Promise<Slideml2ValidateRenderResult> {
  return invokeDesktop<Slideml2ValidateRenderResult>("slideml2_validate_render", { deckPath, outputPath, render });
}

// ---- Web ----

export interface WebFetchResult {
  url: string;
  status: number;
  content_type: string;
  text: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Fetch a URL and return text content (HTML tags stripped). */
export async function webFetch(url: string): Promise<WebFetchResult> {
  return invokeDesktop<WebFetchResult>("web_fetch", { url });
}

/** Search the web using DuckDuckGo. */
export async function webSearch(query: string, maxResults?: number): Promise<WebSearchResult[]> {
  return invokeDesktop<WebSearchResult[]>("web_search", { query, maxResults });
}

// ---- Browser ----

export type BrowserAction =
  | { action: "open" | "navigate"; url: string; headed?: boolean; timeout_ms?: number }
  | { action: "snapshot" | "state" }
  | { action: "extract"; query?: string; max_items?: number }
  | { action: "inspect"; ref: number; max_chars?: number }
  | { action: "read"; source?: "text" | "html" | "links"; offset?: number; max_chars?: number; ref?: number; frame?: number }
  | { action: "grep"; pattern?: string; query?: string; source?: "text" | "html" | "links"; case_sensitive?: boolean; max_matches?: number; max_items?: number; context_chars?: number }
  | { action: "show" | "hide" }
  | { action: "reload"; timeout_ms?: number }
  | { action: "tabs" }
  | { action: "new_tab"; url?: string; timeout_ms?: number }
  | { action: "switch_tab" | "close_tab"; index: number }
  | { action: "click"; ref: number }
  | { action: "hover" | "dblclick" | "rightclick"; ref: number }
  | { action: "type"; ref: number; text: string }
  | { action: "select"; ref: number; value?: string; text?: string }
  | { action: "upload"; ref: number; path?: string; paths?: string[] }
  | { action: "check" | "uncheck" | "clear"; ref: number }
  | { action: "press"; ref?: number; key?: string; keys?: string }
  | { action: "scroll"; direction?: "up" | "down"; pages?: number }
  | { action: "back" }
  | { action: "wait_for_change"; timeout_ms?: number }
  | { action: "get_url" }
  | { action: "screenshot"; path?: string; full_page?: boolean; ref?: number }
  | { action: "pdf"; path?: string; print_background?: boolean; format?: string }
  | { action: "downloads" }
  | { action: "cookies"; operation?: "get" | "set" | "clear" | "export" | "import"; name?: string; value?: string; url?: string; domain?: string; path?: string }
  | { action: "storage"; operation?: "get" | "set" | "clear"; area?: "local" | "session"; key?: string; value?: string }
  | { action: "diagnostics"; limit?: number }
  | { action: "evaluate"; code: string; max_chars?: number }
  | { action: "close" };

export interface BrowserActionResult {
  action: string;
  result: unknown;
}

export async function browserAction(actions: BrowserAction[]): Promise<BrowserActionResult[]> {
  return invokeDesktop<BrowserActionResult[]>("browser_action", { actions });
}

// ---- Shell ----

export interface ShellExecResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
}

/** Execute a shell command with timeout and working directory support. */
export async function shellExec(params: {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout_ms?: number;
}): Promise<ShellExecResult> {
  return invokeDesktop<ShellExecResult>("shell_exec", { params });
}

/** Execute a shell command with streaming output via Tauri events. */
export async function shellExecStream(
  params: { command: string[]; cwd?: string; env?: Record<string, string>; timeout_ms?: number },
  onOutput: (line: string) => void,
): Promise<ShellExecResult> {
  const eventId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const unlisten = await listenDesktop<string>(`shell-output-${eventId}`, (event) => {
    onOutput(event.payload);
  });
  try {
    return await invokeDesktop<ShellExecResult>("shell_exec_stream", { params, eventId });
  } finally {
    unlisten();
  }
}

/** Ensure uv/uvx is installed. Auto-installs if missing. */
export async function ensureUvInstalled(): Promise<string> {
  return invokeDesktop<string>("ensure_uv_installed");
}

/** Read an environment variable from the system. */
export async function getEnv(key: string): Promise<string | null> {
  return invokeDesktop<string | null>("get_env", { key });
}

/**
 * Make a non-streaming POST request via Rust (bypasses browser CORS).
 * Returns { status, body }.
 */
export async function httpPost(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; body: string }> {
  return invokeDesktop<{ status: number; body: string }>("http_post", {
    request: { url, headers, body },
  });
}

/**
 * Make a streaming POST request via Rust (bypasses browser CORS).
 * Returns an async iterable of SSE data strings.
 */
export async function* httpStreamPost(
  url: string,
  headers: Record<string, string>,
  body: string,
): AsyncGenerator<string> {
  const requestId = await invokeDesktop<string>("http_stream_post", {
    request: { url, headers, body },
  });

  // Create a queue to bridge Tauri events → async generator
  const queue: string[] = [];
  let resolve: (() => void) | null = null;
  let done = false;
  let error: string | null = null;

  const unlisten = await listenDesktop<string>(`http-stream-${requestId}`, (event) => {
    const data = event.payload;
    if (data === "__DONE__") {
      done = true;
      resolve?.();
    } else if (data.startsWith("__ERROR__:")) {
      error = data.slice(10);
      done = true;
      resolve?.();
    } else {
      queue.push(data);
      resolve?.();
    }
  });

  try {
    while (true) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (done) break;
      await new Promise<void>((r) => { resolve = r; });
      resolve = null;
    }
    if (error) throw new Error(error);
  } finally {
    unlisten();
  }
}
