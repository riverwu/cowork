/**
 * MCP Loader — scans ~/.cowork/mcps/ directory and loads MCP.json files.
 *
 * Each MCP server is a directory:
 *   server-name/
 *     MCP.json       ← required config file
 *     README.md      ← optional documentation
 *     scripts/       ← optional setup/install scripts
 *
 * MCP.json format:
 * {
 *   "name": "browser-use",
 *   "version": "1.0.0",
 *   "description": "Web browsing and page automation",
 *   "command": "uvx",
 *   "args": ["--from", "browser-use[cli]", "browser-use", "--mcp"],
 *   "env": {},
 *   "enabled": true
 * }
 */

import { readFileText, listDirectory, writeFile } from "@/lib/tauri";
import { getEnv } from "@/lib/tauri";

export interface McpDefinition {
  name: string;
  version: string;
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  /** Per-server timeout for `tools/call` requests, in milliseconds. When
   *  unset, the transport falls back to its built-in default. Useful for
   *  capping slow servers (e.g., Tavily can otherwise hang on a slow API). */
  callTimeoutMs?: number;
}

export interface LoadedMcp {
  id: string;
  definition: McpDefinition;
  dirPath: string;
  configPath: string;
}

/** MCP directory path. */
export async function getMcpsDir(): Promise<string> {
  const home = await getEnv("HOME") || "/tmp";
  return `${home}/.cowork/mcps`;
}

/** Scan ~/.cowork/mcps/ and load all MCP.json files. */
export async function loadMcpsFromFilesystem(): Promise<LoadedMcp[]> {
  const mcpsDir = await getMcpsDir();
  const loaded: LoadedMcp[] = [];

  let entries;
  try {
    entries = await listDirectory(mcpsDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.is_dir) continue;

    const dirPath = entry.path;
    const configPath = `${dirPath}/MCP.json`;

    try {
      const content = await readFileText(configPath);
      const definition: McpDefinition = JSON.parse(content);

      if (!definition.name) definition.name = entry.name;
      if (!definition.version) definition.version = "0.0.0";
      if (!definition.command) continue; // Invalid — skip

      loaded.push({
        id: entry.name,
        definition,
        dirPath,
        configPath,
      });
    } catch {
      // No MCP.json or invalid — skip
    }
  }

  return loaded;
}

/** Write a new MCP config to the filesystem. */
export async function installMcpToFilesystem(
  id: string,
  definition: McpDefinition,
): Promise<string> {
  const mcpsDir = await getMcpsDir();
  const dirPath = `${mcpsDir}/${id}`;
  const configPath = `${dirPath}/MCP.json`;
  await writeFile(configPath, JSON.stringify(definition, null, 2));
  return dirPath;
}

/** Check if an MCP is installed. */
export async function isMcpInstalled(id: string): Promise<boolean> {
  const mcpsDir = await getMcpsDir();
  try {
    await readFileText(`${mcpsDir}/${id}/MCP.json`);
    return true;
  } catch {
    return false;
  }
}
