import type { Tool } from "./types";
import { writeFile } from "@/lib/tauri";

export const writeFileSkill: Tool = {
  definition: {
    name: "write_file",
    description:
      "Write content to a file. Creates the file if it doesn't exist. Creates parent directories if needed. Use this to save generated reports, data exports, scripts, or any text content to disk.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path where the file should be written",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },

  async execute(input) {
    const path = input.path as string;
    const content = input.content as string;
    try {
      await writeFile(path, content);
      return `File written successfully: ${path} (${content.length} characters)`;
    } catch (err) {
      return `Error writing file: ${err}`;
    }
  },
};
