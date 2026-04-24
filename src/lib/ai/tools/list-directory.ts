import type { Tool } from "./types";
import { listDirectory } from "@/lib/tauri";

export const listDirectorySkill: Tool = {
  definition: {
    name: "list_directory",
    description:
      "List the contents of a directory (files and subdirectories). Returns names, sizes, and modification times. Does not recurse into subdirectories. Use this to explore file system structure.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the directory",
        },
      },
      required: ["path"],
    },
  },

  async execute(input) {
    const path = input.path as string;
    try {
      const entries = await listDirectory(path);
      if (entries.length === 0) {
        return `Directory "${path}" is empty.`;
      }

      const lines = entries.map((e) => {
        const type = e.is_dir ? "[DIR]" : `${formatSize(e.size)}`;
        const date = new Date(e.modified_at * 1000).toLocaleDateString();
        return `${type.padEnd(10)} ${date}  ${e.name}`;
      });

      return `Contents of ${path} (${entries.length} items):\n\n${lines.join("\n")}`;
    } catch (err) {
      return `Error listing directory: ${err}`;
    }
  },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
