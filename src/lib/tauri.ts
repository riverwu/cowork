import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { FileInfo } from "@/types";

/** Open a native folder picker dialog. Returns the selected path or null. */
export async function pickFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return result as string | null;
}

/** Scan a directory recursively for supported document files. */
export async function scanDirectory(path: string): Promise<FileInfo[]> {
  return invoke<FileInfo[]>("scan_directory", { path });
}

/** Read a text file's raw contents. */
export async function readFileText(path: string): Promise<string> {
  return invoke<string>("read_file_text", { path });
}

/** Parse a document (PDF, DOCX, XLSX, or text) and extract text content. */
export async function parseDocument(path: string): Promise<string> {
  return invoke<string>("parse_document", { path });
}

/** Write content to a file. Creates parent dirs if needed. */
export async function writeFile(path: string, content: string): Promise<void> {
  return invoke<void>("write_file", { path, content });
}

/** List directory contents (non-recursive). */
export async function listDirectory(path: string): Promise<FileInfo[]> {
  return invoke<FileInfo[]>("list_directory", { path });
}

/** Search file contents recursively for a pattern. */
export async function grep(directory: string, pattern: string, maxResults?: number): Promise<GrepMatch[]> {
  return invoke<GrepMatch[]>("grep", { directory, pattern, maxResults });
}

export interface GrepMatch {
  path: string;
  line_number: number;
  line: string;
}

export interface PythonResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

/** Execute Python script in the isolated environment. */
export async function runPythonScript(script: string, timeoutSecs?: number): Promise<PythonResult> {
  return invoke<PythonResult>("run_python_script", { script, timeoutSecs });
}

/** Initialize the isolated Python environment. */
export async function initPythonEnv(): Promise<string> {
  return invoke<string>("init_python_env");
}

/** Install a Python package into the isolated environment. */
export async function installPythonPackage(pkg: string): Promise<string> {
  return invoke<string>("install_python_package", { package: pkg });
}

/** Ensure uv/uvx is installed. Auto-installs if missing. */
export async function ensureUvInstalled(): Promise<string> {
  return invoke<string>("ensure_uv_installed");
}

/** Read an environment variable from the system. */
export async function getEnv(key: string): Promise<string | null> {
  return invoke<string | null>("get_env", { key });
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
  return invoke<{ status: number; body: string }>("http_post", {
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
  const requestId = await invoke<string>("http_stream_post", {
    request: { url, headers, body },
  });

  // Create a queue to bridge Tauri events → async generator
  const queue: string[] = [];
  let resolve: (() => void) | null = null;
  let done = false;
  let error: string | null = null;

  const unlisten = await listen<string>(`http-stream-${requestId}`, (event) => {
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
