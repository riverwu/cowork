import type { Tool } from "./types";
import { parseDocument, readFileText } from "@/lib/tauri";

export const readFile: Tool = {
  definition: {
    name: "read_file",
    description:
      "Read a bounded preview or segment of a file. For documents (PDF, DOC, DOCX, XLSX), extracts text content. For text files (txt, md, markdown, csv, json, code), returns raw content. Use offset/max_chars to read large files progressively instead of loading everything at once.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the file",
        },
        offset: {
          type: "number",
          description: "Character offset to start reading from. Default: 0.",
        },
        max_chars: {
          type: "number",
          description: "Maximum characters to return. Default: 6000, max: 20000. Use later offsets for more content.",
        },
      },
      required: ["path"],
    },
  },

  async execute(input) {
    const path = input.path as string;
    try {
      const offset = Math.max(0, Math.floor((input.offset as number) || 0));
      const requestedMax = Math.floor((input.max_chars as number) || 6000);
      const maxChars = Math.min(Math.max(requestedMax, 1000), 20000);
      const ext = path.split(".").pop()?.toLowerCase() || "";
      const docExtensions = ["pdf", "doc", "docx", "xlsx", "xls"];

      const text = docExtensions.includes(ext)
        ? await parseDocument(path)
        : await readFileText(path);

      if (!text || text.trim().length === 0) {
        return `File "${path}" is empty or could not be parsed.`;
      }

      const start = Math.min(offset, text.length);
      const end = Math.min(start + maxChars, text.length);
      const segment = text.slice(start, end);
      const header = [
        `File: ${path}`,
        `Total characters: ${text.length}`,
        `Returned range: ${start}-${end}`,
      ];
      const footer = end < text.length
        ? `\n\n[More content available. Continue with read_file offset=${end}, max_chars=${maxChars}.]`
        : "";
      return `${header.join("\n")}\n\n${segment}${footer}`;
    } catch (err) {
      return `Error reading file: ${err}`;
    }
  },
};
