/**
 * Skill Runner — loads skills from filesystem and converts to agent tools.
 *
 * Skills live in ~/.cowork/skills/ as directories with SKILL.md.
 * Filesystem is source of truth.
 *
 * - type="skill" → registered as a tool, agent decides when to call
 * - type="app" → instructions injected into system prompt when activated
 *
 * When a skill is called:
 * - Returns instructions + task back to the main agent
 * - Main agent executes using its full toolkit (including skill's scripts)
 * - NOT a sub-agent — instruction injection pattern (Codex style)
 */

import { loadSkillsFromFilesystem, getSkillsDir, type LoadedSkill } from "./skill-loader";
import type { Skill } from "./skills/types";
import type { SkillRecord } from "@/types";

/** Cache of loaded skills (refreshed on demand). */
let cachedSkills: LoadedSkill[] = [];

/** Load all skills from filesystem and convert skill-type to agent tools. */
export async function loadSkillTools(): Promise<Record<string, Skill>> {
  cachedSkills = await loadSkillsFromFilesystem();
  const tools: Record<string, Skill> = {};

  for (const loaded of cachedSkills) {
    if (loaded.record.type !== "skill") continue;
    const toolName = `skill_${sanitizeName(loaded.record.name)}`;
    tools[toolName] = createSkillTool(loaded);
  }

  return tools;
}

/** Get all loaded skills (both apps and skills). */
export function getLoadedSkills(): LoadedSkill[] {
  return cachedSkills;
}

/** Get the skills directory path (for system prompt). */
export { getSkillsDir };

/** Build system prompt addition for an App-type skill. */
export function buildAppPrompt(record: SkillRecord): string {
  const parts = [`## Active App: ${record.name}`];
  parts.push(`Purpose: ${record.definition.purpose}`);

  if (record.definition.instructions?.length) {
    parts.push("Instructions:");
    for (const inst of record.definition.instructions) {
      parts.push(`- ${inst}`);
    }
  }

  if (record.definition.qualityStandards?.length) {
    parts.push("Quality standards:");
    for (const qs of record.definition.qualityStandards) {
      parts.push(`- ${qs}`);
    }
  }

  if (record.definition.outputRequirements) {
    parts.push(`Output: ${record.definition.outputRequirements}`);
  }

  return parts.join("\n");
}

/** Convert a filesystem skill into an agent-callable tool. */
function createSkillTool(loaded: LoadedSkill): Skill {
  const { record, dirPath, hasScripts } = loaded;

  const paramProps: Record<string, unknown> = {
    task: {
      type: "string",
      description: "Describe the specific task to accomplish with this skill",
    },
  };

  if (record.definition.parameters) {
    for (const [key, param] of Object.entries(record.definition.parameters)) {
      paramProps[key] = { type: "string", description: param.description };
    }
  }

  return {
    definition: {
      name: `skill_${sanitizeName(record.name)}`,
      description: record.definition.purpose,
      parameters: {
        type: "object",
        properties: paramProps,
        required: ["task"],
      },
    },

    execute: async (input) => {
      const task = input.task as string;

      const instructionLines = record.definition.instructions || [];
      const instructions = instructionLines.length > 0
        ? `\nInstructions:\n${instructionLines.map(i => `- ${i}`).join("\n")}`
        : "";

      const scriptInfo = hasScripts
        ? `\nThis skill has executable scripts in: ${dirPath}/scripts/\nYou can run them using the shell tool.`
        : "";

      return [
        `[Skill: ${record.name}]`,
        `Purpose: ${record.definition.purpose}`,
        `Skill directory: ${dirPath}`,
        instructions,
        scriptInfo,
        `\nTask: ${task}`,
        `\nExecute this task using your available tools. Follow the instructions above.`,
      ].filter(Boolean).join("\n");
    },
  };
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
