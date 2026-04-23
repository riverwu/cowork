/**
 * Catalog — bundled skills and MCPs available for installation.
 *
 * Each item has version management:
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
  /** Full SKILL.md content */
  skillMd: string;
  /** Optional scripts: filename → content */
  scripts?: Record<string, string>;
}

export interface CatalogMcp {
  id: string;
  name: string;
  version: string;
  description: string;
  definition: McpDefinition;
}

// ---- Bundled Skills ----

export const CATALOG_SKILLS: CatalogSkill[] = [
  {
    id: "deep-research",
    name: "Deep Research",
    version: "1.0.0",
    description: "Conduct deep research on a topic using web search and synthesis",
    skillMd: `---
name: deep-research
type: skill
version: 1.0.0
description: Conduct deep research on a topic using web search and synthesis
---
## Instructions
- Break the research question into sub-questions
- Use web_search to find relevant sources for each sub-question
- Use web_fetch to read the most promising results
- Synthesize findings into a comprehensive analysis
- Cite sources with URLs
- Identify conflicting information and note uncertainty
- Present findings in a structured format with sections
`,
  },
  {
    id: "code-review",
    name: "Code Review",
    version: "1.0.0",
    description: "Review code changes for quality, bugs, security, and best practices",
    skillMd: `---
name: code-review
type: skill
version: 1.0.0
description: Review code changes for quality, bugs, security, and best practices
---
## Instructions
- Use shell to run git diff or read changed files
- Check for common bugs: null references, off-by-one, resource leaks
- Check security: injection, XSS, hardcoded secrets, insecure crypto
- Check code quality: naming, complexity, duplication
- Check test coverage: are changes tested?
- Suggest specific improvements with code examples
- Prioritize feedback: critical > important > nice-to-have
`,
  },
  {
    id: "summarizer",
    name: "Document Summarizer",
    version: "1.0.0",
    description: "Summarize documents, articles, or web pages into concise briefs",
    skillMd: `---
name: summarizer
type: skill
version: 1.0.0
description: Summarize documents, articles, or web pages into concise briefs
---
## Instructions
- Read the full document using read_file or web_fetch
- Identify the key points, arguments, and conclusions
- Produce a summary that is 10-20% of the original length
- Preserve the original structure (sections, hierarchy)
- Highlight actionable items or key decisions
- Note any data, statistics, or metrics mentioned
- Use create_artifact for the formatted summary
`,
  },
  {
    id: "translator",
    name: "Translator",
    version: "1.0.0",
    description: "Translate documents between languages while preserving formatting and context",
    skillMd: `---
name: translator
type: skill
version: 1.0.0
description: Translate documents between languages while preserving formatting and context
parameters:
  target_language: Target language for translation
---
## Instructions
- Read the source document
- Translate while preserving the original formatting (headers, lists, tables)
- Maintain technical terms and proper nouns
- Adapt idioms and cultural references appropriately
- Preserve code blocks and URLs without translation
- Write the translated version using write_file or create_artifact
`,
  },
  {
    id: "data-analyzer",
    name: "Data Analyzer",
    version: "1.0.0",
    description: "Analyze data files (CSV, Excel, JSON) with statistical analysis and visualization",
    skillMd: `---
name: data-analyzer
type: skill
version: 1.0.0
description: Analyze data files (CSV, Excel, JSON) with statistical analysis and visualization
---
## Instructions
- Read the data file using read_file or run_python with pandas
- Perform exploratory data analysis: shape, types, missing values, distributions
- Calculate relevant statistics: mean, median, std, correlations
- Identify patterns, trends, and anomalies
- Generate visualizations using matplotlib via run_python
- Save charts to the working directory
- Present findings with create_artifact
`,
    scripts: {
      "analyze.py": `#!/usr/bin/env python3
"""Quick data analysis template."""
import pandas as pd
import sys

if len(sys.argv) < 2:
    print("Usage: analyze.py <file>")
    sys.exit(1)

df = pd.read_csv(sys.argv[1])
print(f"Shape: {df.shape}")
print(f"\\nColumns: {list(df.columns)}")
print(f"\\nTypes:\\n{df.dtypes}")
print(f"\\nSummary:\\n{df.describe()}")
print(f"\\nMissing:\\n{df.isnull().sum()}")
`,
    },
  },
];

// ---- Bundled MCPs ----

export const CATALOG_MCPS: CatalogMcp[] = [
  {
    id: "browser-use",
    name: "Browser Use",
    version: "1.0.0",
    description: "Web browsing and page automation via browser-use",
    definition: {
      name: "Browser Use",
      version: "1.0.0",
      description: "Web browsing and page automation — navigate pages, click, type, extract content",
      command: "uvx",
      args: ["--from", "browser-use[cli]", "browser-use", "--mcp"],
      enabled: true,
    },
  },
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
];
