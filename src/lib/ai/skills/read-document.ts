import type { Skill } from "./types";
import { parseDocument, readFileText } from "@/lib/tauri";

export const readFile: Skill = {
  definition: {
    name: "read_file",
    description:
      "Read the contents of a file. For documents (PDF, DOCX, XLSX), extracts text content. For text files (txt, md, csv, json, code), returns raw content. Use this when you need to see the full content of a specific file.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the file",
        },
      },
      required: ["path"],
    },
  },

  async execute(input) {
    const path = input.path as string;
    try {
      const ext = path.split(".").pop()?.toLowerCase() || "";
      const docExtensions = ["pdf", "docx", "xlsx", "xls"];

      const text = docExtensions.includes(ext)
        ? await parseDocument(path)
        : await readFileText(path);

      if (!text || text.trim().length === 0) {
        return `File "${path}" is empty or could not be parsed.`;
      }

      const maxLen = 20000;
      if (text.length > maxLen) {
        return `${text.slice(0, maxLen)}\n\n[... truncated, ${text.length - maxLen} more characters]`;
      }
      return text;
    } catch (err) {
      return `Error reading file: ${err}`;
    }
  },
};
