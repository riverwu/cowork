import type { Tool } from "./types";
import { listDocuments, listSourceCapabilities, listSourceEntities, listSources } from "@/lib/db";

export const getSourceCatalog: Tool = {
  definition: {
    name: "get_source_catalog",
    description:
      `Inspect a specific knowledge source catalog: capabilities, indexed documents, and discovered entities such as files, tables, sheets, schemas, or connector entities.
Use this after list_knowledge_sources when deciding whether to search text, read a document, analyze a spreadsheet, or call a connector/MCP tool.`,
    parameters: {
      type: "object",
      properties: {
        source_id: {
          type: "string",
          description: "Knowledge source id from list_knowledge_sources.",
        },
        limit: {
          type: "number",
          description: "Maximum number of catalog entities/documents to return. Default: 50, max: 200.",
        },
      },
      required: ["source_id"],
    },
  },

  async execute(input) {
    const sourceId = input.source_id as string;
    const limit = Math.min((input.limit as number) || 50, 200);
    const source = (await listSources()).find((s) => s.id === sourceId);
    if (!source) return `Knowledge source not found: ${sourceId}`;

    const [capabilities, entities, documents] = await Promise.all([
      listSourceCapabilities(sourceId),
      listSourceEntities(sourceId, limit),
      listDocuments(sourceId),
    ]);

    const lines = [
      `Source: ${source.name}`,
      `- id: ${source.id}`,
      `- type: ${source.type}`,
      `- status: ${source.status}`,
      source.path ? `- path: ${source.path}` : "",
      source.connectorId ? `- connector: ${source.connectorId}` : "",
      `- sync: ${source.syncPolicy || "manual"}`,
    ].filter(Boolean);

    if (capabilities.length > 0) {
      lines.push("\nCapabilities:");
      for (const capability of capabilities) {
        lines.push(`- ${capability.capabilityType}${capability.toolName ? ` via ${capability.toolName}` : ""}: ${capability.description || ""}`.trimEnd());
      }
    }

    if (entities.length > 0) {
      lines.push("\nCatalog entities:");
      for (const entity of entities) {
        lines.push(formatEntity(entity));
      }
    }

    const visibleDocs = documents.filter((doc) => doc.status !== "deleted").slice(0, limit);
    if (visibleDocs.length > 0) {
      lines.push("\nDocuments:");
      for (const doc of visibleDocs) {
        const status = doc.embeddingStatus ? `${doc.status}/${doc.embeddingStatus}` : doc.status;
        lines.push(`- ${doc.filename} (${status})${doc.filePath ? `\n  path: ${doc.filePath}` : ""}`);
      }
    }

    return lines.join("\n");
  },
};

function formatEntity(entity: Awaited<ReturnType<typeof listSourceEntities>>[number]): string {
  const parts = [`- [${entity.entityType}] ${entity.name}`];
  if (entity.summary) parts.push(`  summary: ${entity.summary}`);
  if (entity.schema) {
    const columns = Array.isArray(entity.schema.columns)
      ? entity.schema.columns
          .map((col) => typeof col === "object" && col !== null && "name" in col ? String(col.name) : "")
          .filter(Boolean)
          .slice(0, 20)
      : [];
    if (columns.length > 0) parts.push(`  columns: ${columns.join(", ")}`);
    if (typeof entity.schema.sheetName === "string") parts.push(`  sheet: ${entity.schema.sheetName}`);
    if (typeof entity.schema.format === "string") parts.push(`  format: ${entity.schema.format}`);
  }
  const filePath = entity.metadata && typeof entity.metadata.filePath === "string" ? entity.metadata.filePath : null;
  if (filePath) parts.push(`  path: ${filePath}`);
  return parts.join("\n");
}
