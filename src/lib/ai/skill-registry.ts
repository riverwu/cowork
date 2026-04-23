/**
 * SkillRegistry — in-memory skill management, filesystem-only, no DB.
 *
 * Lifecycle:
 * 1. On startup: scan ~/.cowork/skills/, parse SKILL.md, build registry
 * 2. On file change or /reload-skills: atomic reload (swap entire registry)
 * 3. Agent queries registry for available skills
 *
 * System paths:
 * - Skills: ~/.cowork/skills/
 * - MCP:    ~/.cowork/mcp.json
 */

import { loadSkillsFromFilesystem, type LoadedSkill } from "./skill-loader";
import type { Skill } from "./skills/types";
import type { SkillRecord } from "@/types";

class SkillRegistry {
  /** All loaded skills (both app and skill types). */
  private skills: LoadedSkill[] = [];
  /** Tool-type skills converted to agent tools. */
  private toolCache: Record<string, Skill> = {};
  /** Whether initial load is complete. */
  private loaded = false;
  /** Change callbacks for UI reactivity. */
  private onChangeCallbacks: Array<() => void> = [];

  /** Register a callback for registry changes. */
  onChange(cb: () => void): () => void {
    this.onChangeCallbacks.push(cb);
    return () => { this.onChangeCallbacks = this.onChangeCallbacks.filter((c) => c !== cb); };
  }

  private notifyChange() {
    for (const cb of this.onChangeCallbacks) cb();
  }

  /** Initial load on startup. */
  async initialize(): Promise<void> {
    await this.reload();
    this.loaded = true;
  }

  /**
   * Atomic reload — scan filesystem, build new registry, swap in place.
   * Safe to call while agent is running: existing tool references
   * remain valid until the next agent invocation picks up the new set.
   */
  async reload(): Promise<{ added: string[]; removed: string[]; total: number }> {
    const oldNames = new Set(this.skills.map((s) => s.record.name));

    // Load fresh from filesystem
    const newSkills = await loadSkillsFromFilesystem();

    // Build new tool cache
    const newTools: Record<string, Skill> = {};
    for (const loaded of newSkills) {
      if (loaded.record.type !== "skill") continue;
      const toolName = `skill_${sanitizeName(loaded.record.name)}`;
      newTools[toolName] = createSkillTool(loaded);
    }

    // Atomic swap
    const newNames = new Set(newSkills.map((s) => s.record.name));
    const added = [...newNames].filter((n) => !oldNames.has(n));
    const removed = [...oldNames].filter((n) => !newNames.has(n));

    this.skills = newSkills;
    this.toolCache = newTools;

    this.notifyChange();

    return { added, removed, total: newSkills.length };
  }

  /** Get all loaded skills. */
  getAll(): LoadedSkill[] {
    return this.skills;
  }

  /** Get skills by type. */
  getByType(type: "app" | "skill"): LoadedSkill[] {
    return this.skills.filter((s) => s.record.type === type);
  }

  /** Get all skill-type tools for the agent. */
  getTools(): Record<string, Skill> {
    return this.toolCache;
  }

  /** Get a skill record by name. */
  getByName(name: string): LoadedSkill | undefined {
    return this.skills.find((s) => s.record.name === name);
  }

  /** Get summary for system prompt. */
  getSummary(): string {
    if (this.skills.length === 0) return "No skills installed.";
    return this.skills.map((s) =>
      `- ${s.record.name} (${s.record.type}): ${s.record.definition.purpose}`,
    ).join("\n");
  }

  isLoaded(): boolean {
    return this.loaded;
  }
}

/** Convert a loaded skill into an agent-callable tool. */
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
        ? `\nExecutable scripts available in: ${dirPath}/scripts/`
        : "";

      return [
        `[Skill: ${record.name}]`,
        `Purpose: ${record.definition.purpose}`,
        `Directory: ${dirPath}`,
        instructions,
        scriptInfo,
        `\nTask: ${task}`,
        `\nExecute this task using your available tools.`,
      ].filter(Boolean).join("\n");
    },
  };
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Build system prompt addition for an App-type skill. */
export function buildAppPrompt(record: SkillRecord): string {
  const parts = [`## Active App: ${record.name}`];
  parts.push(`Purpose: ${record.definition.purpose}`);
  if (record.definition.instructions?.length) {
    parts.push("Instructions:");
    for (const inst of record.definition.instructions) parts.push(`- ${inst}`);
  }
  if (record.definition.qualityStandards?.length) {
    parts.push("Quality standards:");
    for (const qs of record.definition.qualityStandards) parts.push(`- ${qs}`);
  }
  if (record.definition.outputRequirements) parts.push(`Output: ${record.definition.outputRequirements}`);
  return parts.join("\n");
}

/** Singleton registry. */
export const skillRegistry = new SkillRegistry();
