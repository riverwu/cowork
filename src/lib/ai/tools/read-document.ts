import type { Tool } from "./types";
import { parseDocument, readFileText } from "@/lib/tauri";

export const readFile: Tool = {
  definition: {
    name: "read_file",
    description:
      "Read a bounded preview or segment of a text file. For binary/Office documents (PDF, DOC, DOCX, XLSX, XLS, PPTX), this is only a lossy text preview; use run_python with python-docx/openpyxl/python-pptx/PyPDF2 when exact structure, tables, slide/page layout, metadata, or faithful analysis is needed. The result includes total_chars, returned_range, truncated, and next_offset. If truncated=true for a text file and the task requires full-file understanding, continue reading with offset=next_offset until truncated=false, or use grep/search plus targeted ranges. Skill instruction markdown files such as SKILL.md and sibling style references under an installed/catalog skill directory are returned in full for the current request.",
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
          description: "Maximum characters to return. Default: 6000, max: 20000. Prefer 6000-10000 for large files so each chunk remains intact in context. Use later offsets for more content.",
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
      const ext = path.split(".").pop()?.toLowerCase() || "";
      const docExtensions = ["pdf", "doc", "docx", "xlsx", "xls"];
      const structuredExtensions = ["pdf", "doc", "docx", "xlsx", "xls", "pptx", "ppt"];
      const isStructuredDocument = structuredExtensions.includes(ext);

      const text = docExtensions.includes(ext)
        ? await parseDocument(path)
        : await readFileText(path);

      if (!text || text.length === 0) {
        return [
          "READ_FILE_RESULT",
          `path: ${path}`,
          "total_chars: 0",
          "offset: 0",
          "max_chars: 0",
          "returned_range: 0-0",
          "chars_returned: 0",
          "truncated: false",
          "next_offset: null",
          "---",
          `File "${path}" is empty or could not be parsed.`,
        ].join("\n");
      }

      const isSkillInstructionMd = isSkillInstructionMarkdownPath(path);
      const maxChars = isSkillInstructionMd
        ? text.length
        : Math.min(Math.max(requestedMax, 1000), 20000);
      const start = Math.min(offset, text.length);
      const end = Math.min(start + maxChars, text.length);
      const segment = text.slice(start, end);
      const hasMore = end < text.length;
      const progress = text.length > 0 ? Math.round((end / text.length) * 100) : 100;
      const header = [
        "READ_FILE_RESULT",
        `path: ${path}`,
        `total_chars: ${text.length}`,
        `offset: ${start}`,
        `max_chars: ${maxChars}`,
        `returned_range: ${start}-${end}`,
        `chars_returned: ${segment.length}`,
        `truncated: ${hasMore ? "true" : "false"}`,
        `next_offset: ${hasMore ? end : "null"}`,
        `progress: ${progress}%`,
        `mode: ${isStructuredDocument ? "lossy_text_preview" : "raw_text"}`,
        "---",
      ];
      const structuredNote = isStructuredDocument
        ? `[STRUCTURED_DOCUMENT_PREVIEW: This is extracted text only. For exact ${ext.toUpperCase()} structure, tables, layout, metadata, or visual fidelity, use run_python with the appropriate library instead of continuing with read_file.]\n\n`
        : "";
      const footer = hasMore
        ? `\n\n[READ_FILE_TRUNCATED: true. You have NOT read the full file. Continue with read_file({ "path": "${path}", "offset": ${end}, "max_chars": ${maxChars} }) if the task requires full-file understanding.]`
        : "";
      return `${header.join("\n")}\n\n${structuredNote}${segment}${footer}`;
    } catch (err) {
      return `Error reading file: ${err}`;
    }
  },
};

export function isSkillInstructionMarkdownPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (!/\.md$/i.test(normalized)) return false;
  if (/(^|\/)SKILL\.md$/i.test(normalized)) return true;
  return (
    /(^|\/)(?:\.cowork|\.codex)\/skills\/[^/]+\/[^/]+\.md$/i.test(normalized) ||
    /(^|\/)src\/catalog\/skills\/[^/]+\/[^/]+\.md$/i.test(normalized)
  );
}
