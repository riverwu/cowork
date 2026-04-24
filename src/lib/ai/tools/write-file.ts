import type { Tool } from "./types";
import { readFileText, writeFile } from "@/lib/tauri";

export const writeFileSkill: Tool = {
  definition: {
    name: "write_file",
    description:
      `Write content to a file. Creates the file if it doesn't exist. Creates parent directories if needed.

Use this to save generated reports, data exports, scripts, or any text content to disk.
For large generated scripts or long documents, write the first chunk with mode "overwrite", then add later chunks with mode "append" so you do not need to produce the whole file in one model response.`,
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
        mode: {
          type: "string",
          enum: ["overwrite", "append"],
          description: "Write mode. Use \"overwrite\" for the first chunk or full rewrite, and \"append\" for later chunks of a large file. Defaults to \"overwrite\".",
        },
      },
      required: ["path", "content"],
    },
  },

  async execute(input) {
    const path = input.path as string;
    const content = input.content as string;
    const mode = input.mode === "append" ? "append" : "overwrite";
    try {
      if (mode === "append") {
        let existing = "";
        try {
          existing = await readFileText(path);
        } catch {
          existing = "";
        }
        await writeFile(path, existing + content);
        return `File appended successfully: ${path} (+${content.length} characters, ${existing.length + content.length} total)`;
      }

      await writeFile(path, content);
      return `File written successfully: ${path} (${content.length} characters)`;
    } catch (err) {
      return `Error writing file: ${err}`;
    }
  },
};
