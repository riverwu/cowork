/**
 * Catalog — index of bundled skills and MCPs available for installation.
 *
 * Design:
 * - This file only contains the INDEX: id, name, version, description.
 * - Full skill content (SKILL.md, scripts, etc.) lives in src/catalog/skills/{id}/
 * - Full MCP definitions live here (they're small JSON configs).
 * - On install: skill files are copied from catalog dir to ~/.cowork/skills/{id}/
 * - For detail display: read from the catalog directory at runtime.
 *
 * Version management:
 * - Catalog version (bundled with app)
 * - Installed version (in ~/.cowork/)
 * - If catalog > installed → show update prompt
 */

import type { McpDefinition } from "./mcp/loader";

export interface CatalogSkill {
  id: string;
  name: string;
  version: string;
  description: string;
}

export interface CatalogMcp {
  id: string;
  name: string;
  version: string;
  description: string;
  definition: McpDefinition;
}

// ---- Bundled Skills (index only) ----

export const CATALOG_SKILLS: CatalogSkill[] = [
  {
    id: "deep-research",
    name: "Deep Research",
    version: "1.0.0",
    description: "Conduct deep research on a topic using web search and synthesis",
  },
  {
    id: "code-review",
    name: "Code Review",
    version: "1.0.0",
    description: "Review code changes for quality, bugs, security, and best practices",
  },
  {
    id: "summarizer",
    name: "Document Summarizer",
    version: "1.0.0",
    description: "Summarize documents, articles, or web pages into concise briefs",
  },
  {
    id: "translator",
    name: "Translator",
    version: "1.0.0",
    description: "Translate documents between languages while preserving formatting and context",
  },
  {
    id: "data-analyzer",
    name: "Data Analyzer",
    version: "1.0.0",
    description: "Analyze data files (CSV, Excel, JSON) with statistical analysis and visualization",
  },
  {
    id: "docx",
    name: "Word Document (DOCX)",
    version: "1.0.0",
    description: "Create, read, edit, and manipulate Word documents (.docx files) with professional formatting",
  },
  {
    id: "pdf",
    name: "PDF Processing",
    version: "1.0.0",
    description: "Read, create, merge, split, and manipulate PDF files with Python tools",
  },
  {
    id: "frontend-design",
    name: "Frontend Design",
    version: "1.0.0",
    description: "Create distinctive, production-grade frontend interfaces with high design quality",
  },
  {
    id: "browser-use",
    name: "Browser Use",
    version: "1.0.0",
    description: "Automate browser navigation, interaction, screenshots, and web page extraction through the browser-use CLI",
  },
  {
    id: "slideml2",
    name: "SlideML2 Deck Authoring",
    version: "1.0.30",
    description: "Create, edit, render, and validate presentations with Cowork's SlideML2 deck tools",
  },
  {
    id: "xlsx",
    name: "Excel Spreadsheet (XLSX)",
    version: "1.0.0",
    description: "Create, edit, and analyze Excel spreadsheets with formulas, formatting, and charts",
  },
];

// ---- Bundled MCPs ----

export const CATALOG_MCPS: CatalogMcp[] = [
  {
    id: "brave-search",
    name: "Brave Search",
    version: "1.0.0",
    description: "Web search via Brave Search API",
    definition: {
      name: "Brave Search",
      version: "1.0.0",
      description: "Web search powered by Brave Search API. Requires BRAVE_API_KEY.",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: { BRAVE_API_KEY: "" },
      enabled: true,
    },
  },
  {
    id: "github",
    name: "GitHub",
    version: "1.0.0",
    description: "GitHub repositories, issues, PRs, and actions",
    definition: {
      name: "GitHub",
      version: "1.0.0",
      description: "Interact with GitHub — repositories, issues, pull requests, actions. Requires GITHUB_PERSONAL_ACCESS_TOKEN.",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
      enabled: true,
    },
  },
  {
    id: "tavily",
    name: "Tavily",
    version: "1.0.0",
    description: "Advanced web search using Tavily AI search API",
    definition: {
      name: "Tavily",
      version: "1.0.0",
      description: "MCP server for advanced web search using Tavily. Requires TAVILY_API_KEY.",
      command: "npx",
      args: ["-y", "tavily-mcp"],
      env: { TAVILY_API_KEY: "" },
      enabled: true,
    },
  },
];
