import { invoke } from "@tauri-apps/api/core";
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
