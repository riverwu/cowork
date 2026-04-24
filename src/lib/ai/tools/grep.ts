import type { Tool } from "./types";
import { grep } from "@/lib/tauri";

export const grepSkill: Tool = {
  definition: {
    name: "grep",
    description:
      "Search for a text pattern in file contents across a directory (recursive). Returns matching lines with file paths and line numbers. Skips binary files and common non-content directories (node_modules, .git, etc.).",
    parameters: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Absolute path to the directory to search in",
        },
        pattern: {
          type: "string",
          description: "Text pattern to search for (substring match)",
        },
        max_results: {
          type: "number",
          description: "Maximum number of matches to return (default: 50)",
        },
      },
      required: ["directory", "pattern"],
    },
  },

  async execute(input) {
    const directory = input.directory as string;
    const pattern = input.pattern as string;
    const maxResults = input.max_results as number | undefined;

    try {
      const matches = await grep(directory, pattern, maxResults);
      if (matches.length === 0) {
        return `No matches found for "${pattern}" in ${directory}`;
      }

      const lines = matches.map(
        (m) => `${m.path}:${m.line_number}: ${m.line}`,
      );
      return `Found ${matches.length} matches for "${pattern}":\n\n${lines.join("\n")}`;
    } catch (err) {
      return `Error searching: ${err}`;
    }
  },
};
