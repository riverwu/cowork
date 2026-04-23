import type { Skill } from "./types";
import { parseDocument } from "@/lib/tauri";

export const readDocument: Skill = {
  definition: {
    name: "read_document",
    description:
      "Read the full contents of a specific document file. Use this when you need the complete text of a file rather than just relevant excerpts from search. Supports PDF, DOCX, XLSX, and text-based files.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "The full path to the file to read",
        },
      },
      required: ["file_path"],
    },
  },

  async execute(input) {
    const filePath = input.file_path as string;
    try {
      const text = await parseDocument(filePath);
      if (!text || text.trim().length === 0) {
        return `The file "${filePath}" appears to be empty or could not be parsed.`;
      }
      // Truncate very long documents to avoid context overflow
      const maxLen = 15000;
      if (text.length > maxLen) {
        return `Document content (truncated to ${maxLen} chars):\n\n${text.slice(0, maxLen)}\n\n[... truncated, ${text.length - maxLen} more characters]`;
      }
      return `Document content:\n\n${text}`;
    } catch (err) {
      return `Failed to read document: ${err}`;
    }
  },
};
