import type { Tool } from "./types";
import { retrieveRelevant, type KnowledgeSearchPlan } from "@/lib/knowledge";
import { getKnowledgeStats, listSources } from "@/lib/db";

export const searchKnowledge: Tool = {
  definition: {
    name: "search_knowledge",
    description:
      `Search or inspect the user's work knowledge base — indexed documents, past reports, connected data sources, and source catalog.
Returns locally matched text excerpts with source file attribution. Search is target-oriented keyword/catalog search and does not require embeddings.
Use this when:
- The user asks about their own documents or past work
- You need context from the user's files before performing a task
- You need to discover which knowledge sources are available before choosing a retrieval or connector tool
- You want to find specific information in the user's knowledge
Prefer passing a structured plan when you can: use should for OR recall, must for required filters, phrases for high-value exact phrases, and not for exclusions. The tool executes the plan with controlled local search and deterministic ranking.`,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language search target or planned keywords. Before searching, remove filler words, normalize dates, and expand synonyms. Examples: '硬件 3月 经营分析 利润 收入', '硬件 3月 经营'. For action 'stats' or 'sources', pass any short placeholder such as '*'.",
        },
        top_k: {
          type: "number",
          description: "Number of results to return (default: 5, max: 20)",
        },
        mode: {
          type: "string",
          enum: ["documents", "snippets"],
          description: "Return mode. Use 'documents' when the user asks to find/list related files. Use 'snippets' when you need brief matched content to answer a question. Default: documents.",
        },
        plan: {
          type: "object",
          description: "Structured search plan. Prefer this over a raw query when searching knowledge. should terms are OR recall terms; must terms are required filters; phrases receive extra ranking weight; not terms exclude matches.",
          properties: {
            must: {
              type: "array",
              items: { type: "string" },
              description: "Terms that must match the same document, such as a product/team/date explicitly required by the user.",
            },
            should: {
              type: "array",
              items: { type: "string" },
              description: "OR terms for broad recall. Use for synonyms and related terms, e.g. 人力资源, HR, 员工, 招聘, 绩效, 薪酬.",
            },
            phrases: {
              type: "array",
              items: { type: "string" },
              description: "Exact/high-value phrases to rank strongly, e.g. 人力资源, 3月经营分析.",
            },
            not: {
              type: "array",
              items: { type: "string" },
              description: "Terms that should exclude a document when matched.",
            },
            fields: {
              type: "array",
              items: { type: "string", enum: ["filename", "metadata", "content_snapshot"] },
              description: "Fields to search. Default searches filename, metadata, and extracted text snapshots.",
            },
            strategy: {
              type: "string",
              enum: ["broad_or_then_rank", "must_and_should", "phrase_first", "metadata_first"],
              description: "Search strategy. Use broad_or_then_rank for discovery; must_and_should when the user names required constraints.",
            },
            fallbacks: {
              type: "array",
              items: { type: "object" },
              description: "Relaxed alternative plans to try if the first plan returns no results.",
            },
          },
        },
        action: {
          type: "string",
          enum: ["search", "stats", "sources"],
          description: "Action: 'search' (default) to find content, 'stats' to get knowledge base statistics, 'sources' to list available knowledge sources",
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
          "- Retrieval: local extracted text cache + catalog metadata keyword search",
          stats.totalDocuments === 0 ? "\nNote: Knowledge base is empty. Add folders via the Knowledge page." : "",
        ].filter(Boolean).join("\n");
      } catch (err) {
        return `Failed to get stats: ${err}`;
      }
    }

    if (action === "sources") {
      try {
        const sources = await listSources();
        if (sources.length === 0) return "No knowledge sources configured.";
        return [
          "Available knowledge sources:",
          ...sources.map((source) => [
            `- ${source.name}`,
            `  id: ${source.id}`,
            `  type: ${source.type}`,
            source.path ? `  path: ${source.path}` : "",
            source.connectorId ? `  connector: ${source.connectorId}` : "",
            `  status: ${source.status}`,
            `  sync: ${source.syncPolicy || "manual"}${source.lastSyncedAt ? `, last synced ${new Date(source.lastSyncedAt * 1000).toISOString()}` : ""}`,
          ].filter(Boolean).join("\n")),
        ].join("\n");
      } catch (err) {
        return `Failed to list sources: ${err}`;
      }
    }

    const query = input.query as string;
    const plan = input.plan as KnowledgeSearchPlan | undefined;
    const searchInput = hasPlanTerms(plan) ? plan : query;
    if (!searchInput || (typeof searchInput === "string" && !searchInput.trim())) {
      return "Knowledge search requires a query or plan.";
    }
    const topK = Math.min((input.top_k as number) || 5, 20);
    const mode = (input.mode as string) === "snippets" ? "snippets" : "documents";

    try {
      const results = await retrieveRelevant(searchInput, topK);

      if (results.length === 0) {
        return `No keyword/catalog matches found for "${query || JSON.stringify(plan)}" in the knowledge base. Try a relaxed plan with one optional must term moved to should, add synonyms/date variants, or inspect source catalogs.`;
      }

      const formatted = results.map((r, i) => {
        const source = r.metadata?.filename ? `(from ${r.metadata.filename})` : "";
        const path = r.metadata?.filePath ? `\npath: ${r.metadata.filePath}` : "";
        const matched = Array.isArray(r.metadata?.matchedTerms) && r.metadata.matchedTerms.length > 0
          ? `\nmatched: ${(r.metadata.matchedTerms as string[]).join(", ")}`
          : "";
        const score = `(target score: ${(r.score * 100).toFixed(0)}%)`;
        if (mode === "documents") {
          const preview = r.content.replace(/\s+/g, " ").trim().slice(0, 220);
          return `[${i + 1}] ${source} ${score}${path}${matched}${preview ? `\npreview: ${preview}` : ""}`;
        }
        return `[${i + 1}] ${source} ${score}${path}${matched}\n${r.content}`;
      });

      const guidance = mode === "documents"
        ? "\n\nReturned document candidates only. Process candidates in rank order. Use read_file with offset/max_chars, or rerun search_knowledge with mode='snippets' for content snippets when needed."
        : "";
      return `Found ${results.length} relevant ${mode === "documents" ? "documents" : "excerpts"}:\n\n${formatted.join("\n\n---\n\n")}${guidance}`;
    } catch (err) {
      return `Knowledge search failed: ${err}`;
    }
  },
};

function hasPlanTerms(plan: KnowledgeSearchPlan | undefined): plan is KnowledgeSearchPlan {
  if (!plan) return false;
  return [plan.must, plan.should, plan.phrases, plan.not].some((terms) => Array.isArray(terms) && terms.length > 0);
}
