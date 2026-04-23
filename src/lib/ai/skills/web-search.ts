import type { Skill } from "./types";
import { webSearch } from "@/lib/tauri";

export const webSearchSkill: Skill = {
  definition: {
    name: "web_search",
    description:
      "Search the web for information. Returns titles, URLs, and snippets. Use this when the user needs current information, wants to look something up online, or asks you to research a topic.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (default: 5)",
        },
      },
      required: ["query"],
    },
  },

  async execute(input) {
    const query = input.query as string;
    const maxResults = (input.max_results as number) || 5;
    try {
      const results = await webSearch(query, maxResults);
      if (results.length === 0) {
        return `No results found for "${query}".`;
      }
      return results.map((r, i) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`,
      ).join("\n\n");
    } catch (err) {
      return `Search failed: ${err}`;
    }
  },
};
