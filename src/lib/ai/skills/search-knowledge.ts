import type { Skill } from "./types";
import { retrieveRelevant } from "@/lib/knowledge";
import { getKnowledgeStats } from "@/lib/db";

export const searchKnowledge: Skill = {
  definition: {
    name: "search_knowledge",
    description:
      `Search the user's personal knowledge base — their indexed documents, past reports, and data.
Returns the most relevant text excerpts with source file attribution.
Use this when:
- The user asks about their own documents or past work
- You need context from the user's files before performing a task
- You want to find specific information in the user's knowledge`,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query — describe what information you're looking for",
        },
        top_k: {
          type: "number",
          description: "Number of results to return (default: 5, max: 20)",
        },
        action: {
          type: "string",
          enum: ["search", "stats"],
          description: "Action: 'search' (default) to find content, 'stats' to get knowledge base statistics",
        },
      },
      required: ["query"],
    },
  },

  async execute(input) {
    const action = (input.action as string) || "search";

    if (action === "stats") {
      try {
        const stats = await getKnowledgeStats();
        return [
          "Knowledge Base Statistics:",
          `- Sources: ${stats.totalSources}`,
          `- Documents: ${stats.totalDocuments} total (${stats.indexedDocuments} indexed, ${stats.pendingDocuments} pending, ${stats.excludedDocuments} excluded)`,
          `- Chunks: ${stats.totalChunks} total (${stats.chunksWithEmbeddings} with embeddings)`,
          stats.totalChunks === 0 ? "\nNote: Knowledge base is empty. Add folders via the Knowledge page." : "",
        ].filter(Boolean).join("\n");
      } catch (err) {
        return `Failed to get stats: ${err}`;
      }
    }

    const query = input.query as string;
    const topK = Math.min((input.top_k as number) || 5, 20);

    try {
      const results = await retrieveRelevant(query, topK);

      if (results.length === 0) {
        return `No relevant documents found for "${query}" in the knowledge base.`;
      }

      const formatted = results.map((r, i) => {
        const source = r.metadata?.filename ? `(from ${r.metadata.filename})` : "";
        return `[${i + 1}] ${source} (relevance: ${(r.score * 100).toFixed(0)}%)\n${r.content}`;
      });

      return `Found ${results.length} relevant excerpts:\n\n${formatted.join("\n\n---\n\n")}`;
    } catch (err) {
      return `Knowledge search failed: ${err}`;
    }
  },
};
