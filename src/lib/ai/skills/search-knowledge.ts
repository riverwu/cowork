import type { Skill } from "./types";
import { retrieveRelevant } from "@/lib/knowledge";

export const searchKnowledge: Skill = {
  definition: {
    name: "search_knowledge",
    description:
      "Search the user's knowledge base (their documents, past reports, connected data sources) for information relevant to a query. Returns the most relevant excerpts with source attribution.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query — what information to look for",
        },
        top_k: {
          type: "number",
          description: "Number of results to return (default: 5)",
        },
      },
      required: ["query"],
    },
  },

  async execute(input) {
    const query = input.query as string;
    const topK = (input.top_k as number) || 5;

    const results = await retrieveRelevant(query, topK);

    if (results.length === 0) {
      return "No relevant documents found in the knowledge base for this query.";
    }

    const formatted = results.map((r, i) => {
      const source = r.metadata?.filename ? `(from ${r.metadata.filename})` : "";
      return `[${i + 1}] ${source} (relevance: ${(r.score * 100).toFixed(0)}%)\n${r.content}`;
    });

    return `Found ${results.length} relevant excerpts:\n\n${formatted.join("\n\n---\n\n")}`;
  },
};
