#!/usr/bin/env npx tsx
/**
 * Catalog Entry Generator
 *
 * Generates skill or MCP installation packages from a name + URL.
 * Scrapes the page content and produces a catalog entry.
 *
 * Usage:
 *   npx tsx scripts/gen-catalog-entry.ts skill <name> <url>
 *   npx tsx scripts/gen-catalog-entry.ts mcp <name> <url>
 *
 * Examples:
 *   npx tsx scripts/gen-catalog-entry.ts skill "pdf-extractor" "https://github.com/example/pdf-skill"
 *   npx tsx scripts/gen-catalog-entry.ts mcp "slack" "https://github.com/modelcontextprotocol/servers/tree/main/src/slack"
 *
 * Output:
 *   Prints the catalog entry to stdout (TypeScript code to paste into catalog.ts)
 *   Also writes the raw SKILL.md or MCP.json to scripts/output/
 */

const [, , type, name, url] = process.argv;

if (!type || !name || !url || !["skill", "mcp"].includes(type)) {
  console.error("Usage: npx tsx scripts/gen-catalog-entry.ts <skill|mcp> <name> <url>");
  console.error("  skill: generates a SKILL.md and catalog entry");
  console.error("  mcp:   generates a MCP.json and catalog entry");
  process.exit(1);
}

async function main() {
  console.error(`Fetching ${url}...`);

  // Fetch the page content
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "text/html,application/json,text/plain",
    },
  });

  if (!response.ok) {
    console.error(`Failed to fetch: ${response.status} ${response.statusText}`);
    process.exit(1);
  }

  const contentType = response.headers.get("content-type") || "";
  let content = await response.text();

  // Handle different content types
  let npmData: NpmPackageData | null = null;
  if (contentType.includes("json") || content.startsWith("{")) {
    try {
      const parsed = JSON.parse(content);
      // npm registry format
      if (parsed.name && parsed.versions) {
        npmData = extractNpmData(parsed);
        content = npmData.readme || npmData.description || "";
      } else if (parsed.readme) {
        content = parsed.readme;
      }
    } catch { /* not JSON, continue */ }
  }

  if (contentType.includes("html")) {
    content = htmlToText(content);
  }

  if (content.length > 20000) {
    content = content.slice(0, 20000) + "\n\n[... truncated]";
  }

  console.error(`Fetched ${content.length} chars. Generating ${type} package...`);

  if (type === "skill") {
    await generateSkill(name, url, content);
  } else {
    await generateMcp(name, url, content, npmData);
  }
}

interface NpmPackageData {
  packageName: string;
  description: string;
  readme: string;
  latestVersion: string;
  bin?: Record<string, string>;
  envVars: string[];
}

function extractNpmData(pkg: Record<string, unknown>): NpmPackageData {
  const versions = pkg.versions as Record<string, Record<string, unknown>> || {};
  const distTags = pkg["dist-tags"] as Record<string, string> || {};
  const latest = distTags.latest || Object.keys(versions).pop() || "1.0.0";
  const latestPkg = versions[latest] || {};
  const readme = (pkg.readme || latestPkg.readme || "") as string;
  const description = (pkg.description || latestPkg.description || "") as string;
  const bin = latestPkg.bin as Record<string, string> | undefined;

  // Find env vars mentioned in readme
  const envVars: string[] = [];
  const envMatches = readme.matchAll(/([A-Z][A-Z_]{2,}(?:_KEY|_TOKEN|_SECRET|_API|_URL))/g);
  for (const m of envMatches) {
    if (!envVars.includes(m[1])) envVars.push(m[1]);
  }

  return {
    packageName: pkg.name as string || "",
    description,
    readme,
    latestVersion: latest,
    bin,
    envVars,
  };
}

async function generateSkill(name: string, url: string, content: string) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  // Extract description and instructions from the content
  const { description, instructions } = extractSkillInfo(content, name);

  const skillMd = `---
name: ${id}
type: skill
version: 1.0.0
description: ${description}
---
## Instructions
${instructions.map(i => `- ${i}`).join("\n")}
`;

  // Write raw file
  const fs = await import("fs");
  const outDir = "scripts/output";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/${id}-SKILL.md`, skillMd);
  console.error(`Written to ${outDir}/${id}-SKILL.md`);

  // Print catalog entry
  console.log(`  {
    id: "${id}",
    name: "${escapeStr(name)}",
    version: "1.0.0",
    description: "${escapeStr(description)}",
    skillMd: \`${escapeTemplate(skillMd)}\`,
  },`);
}

async function generateMcp(name: string, url: string, content: string, npmData?: NpmPackageData | null) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  let description: string;
  let command: string;
  let args: string[];
  let envVars: Record<string, string>;

  if (npmData) {
    // Use npm registry data for accurate package info
    description = npmData.description || `${name} MCP server`;
    command = "npx";
    args = ["-y", npmData.packageName];
    envVars = {};
    for (const v of npmData.envVars) envVars[v] = "";
  } else {
    const info = extractMcpInfo(content, name, url);
    description = info.description;
    command = info.command;
    args = info.args;
    envVars = info.envVars;
  }

  const mcpJson = {
    name,
    version: "1.0.0",
    description,
    command,
    args,
    ...(Object.keys(envVars).length > 0 ? { env: envVars } : {}),
    enabled: true,
  };

  // Write raw file
  const fs = await import("fs");
  const outDir = "scripts/output";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/${id}-MCP.json`, JSON.stringify(mcpJson, null, 2));
  console.error(`Written to ${outDir}/${id}-MCP.json`);

  // Print catalog entry
  const envStr = Object.keys(envVars).length > 0
    ? `\n      env: ${JSON.stringify(envVars)},`
    : "";

  console.log(`  {
    id: "${id}",
    name: "${escapeStr(name)}",
    version: "1.0.0",
    description: "${escapeStr(description)}",
    definition: {
      name: "${escapeStr(name)}",
      version: "1.0.0",
      description: "${escapeStr(description)}",
      command: "${escapeStr(command)}",
      args: ${JSON.stringify(args)},${envStr}
      enabled: true,
    },
  },`);
}

/** Extract skill info from page content. */
function extractSkillInfo(content: string, name: string): { description: string; instructions: string[] } {
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);

  // Try to find a description (first paragraph-like text)
  let description = "";
  for (const line of lines.slice(0, 20)) {
    if (line.length > 30 && line.length < 300 && !line.startsWith("#") && !line.startsWith("!")) {
      description = line;
      break;
    }
  }
  if (!description) description = `${name} skill`;

  // Try to extract instructions from bullet points or numbered lists
  const instructions: string[] = [];
  for (const line of lines) {
    if ((line.startsWith("- ") || line.startsWith("* ") || /^\d+\.\s/.test(line)) && line.length > 10 && line.length < 200) {
      const text = line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "");
      if (!text.includes("http") && !text.startsWith("Install") && !text.startsWith("npm")) {
        instructions.push(text);
      }
    }
    if (instructions.length >= 8) break;
  }

  if (instructions.length === 0) {
    instructions.push(`Execute ${name} tasks as described by the user`);
    instructions.push("Follow the user's specific requirements");
    instructions.push("Report results clearly");
  }

  return { description, instructions };
}

/** Extract MCP info from page content. */
function extractMcpInfo(content: string, name: string, url: string): {
  description: string; command: string; args: string[]; envVars: Record<string, string>;
} {
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
  let description = `${name} MCP server`;
  let command = "npx";
  let args = ["-y", `@modelcontextprotocol/server-${name.toLowerCase()}`];
  const envVars: Record<string, string> = {};

  // Try to find description
  for (const line of lines.slice(0, 20)) {
    if (line.length > 30 && line.length < 300 && !line.startsWith("#") && !line.startsWith("!")) {
      description = line;
      break;
    }
  }

  // Try to find npx/uvx command in the content
  for (const line of lines) {
    const npxMatch = line.match(/npx\s+(-y\s+)?(@[\w/-]+[\w-]+)/);
    if (npxMatch) {
      command = "npx";
      args = ["-y", npxMatch[2]];
      break;
    }
    const uvxMatch = line.match(/uvx\s+([\w-]+(?:\[[\w,]+\])?)/);
    if (uvxMatch) {
      command = "uvx";
      args = [uvxMatch[1]];
      break;
    }
  }

  // Try to find environment variables
  for (const line of lines) {
    const envMatch = line.match(/([A-Z][A-Z_]{2,})\s*[=:]/);
    if (envMatch && !["PATH", "HOME", "USER", "NODE", "NPM"].some(p => envMatch[1].startsWith(p))) {
      envVars[envMatch[1]] = "";
    }
  }

  return { description, command, args, envVars };
}

/** Strip HTML tags and extract readable text. */
function htmlToText(html: string): string {
  // Remove script and style
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Block elements → newlines
  text = text.replace(/<\/?(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, "\n");
  // Strip tags
  text = text.replace(/<[^>]+>/g, "");
  // Decode entities
  text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ");
  // Clean whitespace
  return text.split("\n").map(l => l.trim()).filter(Boolean).join("\n");
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function escapeTemplate(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
