import type { ToolDefinition } from "./providers/types";
import systemMd from "../../../SYSTEM.md?raw";

/**
 * Cowork's system prompt is authored in `cowork/SYSTEM.md` and imported here
 * as a raw string. Dynamic sections (current time, working directory, MCP
 * summary, plan-mode banner, memory context, knowledge context) are appended
 * by `buildSystemPrompt` at session-start time.
 *
 * Editing the prompt: edit SYSTEM.md, not this file.
 */

const STATIC_PROMPT = systemMd;

function buildCurrentTimeSection(): string {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dow = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()];
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const year = now.getFullYear();
  return `## Current time

Today is **${today}** (${dow}), ${tz}. Use this as "now" — compute relative dates ("下周一", "next Monday") yourself; default web searches to **${year}**, not your training cutoff; verify time-sensitive facts before stating them.`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const PLAN_MODE_SECTION = `## MODE: PLANNING

You are in PLANNING mode:
- Analyze the task thoroughly
- Create a clear, numbered step-by-step plan
- You MAY use read_file, grep, list_directory, web_search, shell (read-only) to gather information
- You MUST NOT modify files or execute state-changing commands
- Present your plan and wait for confirmation`;

/** Build the full system prompt with dynamic sections. */
export function buildSystemPrompt(params?: {
  knowledgeContext?: string;
  memoryContext?: string;
  tools?: ToolDefinition[];
  planMode?: boolean;
  workingDirectory?: string;
  availableSkillsPrompt?: string;
  longTaskContext?: string;
  taskIsolationContext?: string;
  systemPaths?: {
    skills: string;
    mcp: string;
    mcpSummary?: string;
  };
}): string {
  const sections: string[] = [STATIC_PROMPT.trimEnd(), buildCurrentTimeSection()];

  if (params?.workingDirectory) {
    sections.push(`## Working directory

Current working directory: \`${params.workingDirectory}\`

- All file operations default to this directory.
- Save output files (reports, documents, code) here unless the user specifies another path. Never ask where to save — just use this directory.
- Use this as default cwd for shell commands.`);
  }

  if (params?.systemPaths) {
    let configSection = `## System configuration
- Skills directory: \`${params.systemPaths.skills}\`
- MCP directory: \`${params.systemPaths.mcp}\``;

    if (params.systemPaths.mcpSummary) {
      configSection += `

**MCP servers**:
${params.systemPaths.mcpSummary}

MCP API keys are managed by the app (stored in database, not in config files). If a server is listed as "available", it is configured and ready — just call its tools directly.`;
    }

    sections.push(configSection);
  }

  if (params?.availableSkillsPrompt) {
    sections.push(params.availableSkillsPrompt);
  }

  if (params?.planMode) {
    sections.push(PLAN_MODE_SECTION);
  }

  if (params?.longTaskContext) {
    sections.push(params.longTaskContext);
  }

  if (params?.taskIsolationContext) {
    sections.push(params.taskIsolationContext);
  }

  if (params?.memoryContext) {
    sections.push(`## Your memory of this user

The following is what you remember from previous conversations. Use as background context, but always let the current message take precedence.

${params.memoryContext}`);
  }

  if (params?.knowledgeContext) {
    sections.push(`## Relevant knowledge

The following excerpts were retrieved from the user's document library. Use as reference material for the current task.

${params.knowledgeContext}`);
  }

  return sections.join("\n\n");
}
