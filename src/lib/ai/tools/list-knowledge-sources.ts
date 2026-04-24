import type { Tool } from "./types";
import { listSources, listSourceCapabilities } from "@/lib/db";

export const listKnowledgeSources: Tool = {
  definition: {
    name: "list_knowledge_sources",
    description:
      `List the user's configured knowledge sources and their available capabilities.
Use this before searching when you need to understand what work data sources exist, such as local folders, ERP, CRM, Confluence, IM, databases, or MCP-backed systems.`,
    parameters: {
      type: "object",
      properties: {
        include_capabilities: {
          type: "boolean",
          description: "Whether to include capability/tool hints for each source. Default: true.",
        },
      },
      required: ["include_capabilities"],
    },
  },

  async execute(input) {
    const includeCapabilities = input.include_capabilities !== false;
    const sources = await listSources();
    if (sources.length === 0) {
      return "No knowledge sources configured.";
    }

    const blocks: string[] = [];
    for (const source of sources) {
      const lines = [
        `- ${source.name}`,
        `  id: ${source.id}`,
        `  type: ${source.type}`,
        `  status: ${source.status}`,
        `  sync: ${source.syncPolicy || "manual"}`,
      ];
      if (source.path) lines.push(`  path: ${source.path}`);
      if (source.connectorId) lines.push(`  connector: ${source.connectorId}`);
      if (source.externalId) lines.push(`  external id: ${source.externalId}`);
      if (source.lastSyncedAt) lines.push(`  last synced: ${new Date(source.lastSyncedAt * 1000).toISOString()}`);

      if (includeCapabilities) {
        const capabilities = await listSourceCapabilities(source.id);
        if (capabilities.length > 0) {
          lines.push("  capabilities:");
          for (const capability of capabilities) {
            lines.push(`    - ${capability.capabilityType}${capability.toolName ? ` via ${capability.toolName}` : ""}: ${capability.description || ""}`.trimEnd());
          }
        }
      }

      blocks.push(lines.join("\n"));
    }

    return `Knowledge sources:\n${blocks.join("\n\n")}`;
  },
};
