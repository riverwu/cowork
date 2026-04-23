/**
 * Skill Runner — converts SkillRecords into agent-usable forms.
 *
 * Follows Codex CLI's pattern:
 * - type="skill": registers as a tool. When called, returns the skill's
 *   instructions to the main agent (NOT a sub-agent). The main agent
 *   then follows these instructions using its full toolkit.
 * - type="app": injects instructions into system prompt when activated.
 *
 * Progressive disclosure (like Codex):
 * - Only name + purpose (description) loaded into tool definitions
 * - Full instructions loaded only when the skill is invoked
 */

import { listSkills } from "@/lib/db";
import type { Skill } from "./skills/types";
import type { SkillRecord } from "@/types";

/**
 * Load all active skill-type records and convert to agent tools.
 *
 * Each skill becomes a tool where:
 * - definition.description = skill's purpose (LLM uses this to decide when to call)
 * - execute() = returns the skill's full instructions + the task
 *
 * The main agent then follows these instructions with its full toolkit.
 * This matches Codex's approach: skills augment the agent, not replace it.
 */
export async function loadSkillTools(): Promise<Record<string, Skill>> {
  const skills = await listSkills("skill");
  const tools: Record<string, Skill> = {};

  for (const record of skills) {
    const toolName = `skill_${sanitizeName(record.name)}`;
    tools[toolName] = createSkillTool(record);
  }

  return tools;
}

/**
 * Build the system prompt addition for an App-type skill.
 */
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

  if (record.definition.dataScope) {
    parts.push(`Data scope: ${record.definition.dataScope}`);
  }

  return parts.join("\n");
}

/**
 * Convert a skill record into an agent tool.
 *
 * Key design (matching Codex):
 * - The tool's description = skill purpose (for LLM to decide when to use)
 * - When called, returns INSTRUCTIONS back to the main agent
 * - The main agent then executes with its full set of tools
 * - This is NOT a sub-agent — it's instruction injection
 */
function createSkillTool(record: SkillRecord): Skill {
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

      // Build the instruction payload — returned to the main agent
      // The main agent will follow these instructions using its full toolkit
      const instructionLines = record.definition.instructions || [];
      const instructions = instructionLines.length > 0
        ? `\nInstructions:\n${instructionLines.map(i => `- ${i}`).join("\n")}`
        : "";

      const qualityLines = record.definition.qualityStandards || [];
      const quality = qualityLines.length > 0
        ? `\nQuality standards:\n${qualityLines.map(q => `- ${q}`).join("\n")}`
        : "";

      const output = record.definition.outputRequirements
        ? `\nOutput format: ${record.definition.outputRequirements}`
        : "";

      return [
        `[Skill: ${record.name}]`,
        `Purpose: ${record.definition.purpose}`,
        instructions,
        quality,
        output,
        `\nTask to complete: ${task}`,
        `\nPlease execute this task now using your available tools. Follow the instructions above.`,
      ].filter(Boolean).join("\n");
    },
  };
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
