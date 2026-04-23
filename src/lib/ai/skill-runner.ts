/**
 * Skill Runner — converts SkillRecords into agent-callable tools.
 *
 * - type="skill" → registers as a tool the agent can call
 * - type="app" → injects instructions into system prompt when run
 */

import { listSkills } from "@/lib/db";
import type { Skill } from "./skills/types";
import type { SkillRecord } from "@/types";
import { getConfiguredProvider } from "./providers";

/**
 * Load all active skill-type records and convert to agent tools.
 * Each skill becomes a tool that, when called, runs a sub-agent
 * with the skill's instructions.
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
 * This gets appended to the main system prompt when the App is run.
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

/** Convert a skill record into an agent-callable tool. */
function createSkillTool(record: SkillRecord): Skill {
  const paramProps: Record<string, { type: string; description: string }> = {
    task: {
      type: "string",
      description: "What to do with this skill — describe the specific task",
    },
  };

  // Add skill's own parameters
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

      try {
        const provider = await getConfiguredProvider();

        // Build skill-specific prompt
        const instructions = record.definition.instructions?.join("\n- ") || "";
        const systemPrompt = `You are executing the "${record.name}" skill.\n\nPurpose: ${record.definition.purpose}\n\nInstructions:\n- ${instructions}\n\nComplete the following task:\n${task}`;

        // Run a simple completion (no tool calling — the skill itself IS the tool)
        let result = "";
        for await (const event of provider.stream({
          system: systemPrompt,
          messages: [{ role: "user", content: task }],
        })) {
          if (event.type === "text-delta") {
            result += event.text;
          }
        }

        return result || "(no output)";
      } catch (err) {
        return `Skill execution error: ${err}`;
      }
    },
  };
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
