/**
 * SkillRegistry — in-memory skill management, filesystem-only, no DB.
 *
 * Design (informed by Codex CLI):
 *
 * Skills are NOT callable tools. They are instruction files (SKILL.md) that
 * the LLM reads on-demand using progressive disclosure:
 *
 * 1. System prompt includes a skill LIST: name + short description + file path
 * 2. When a task matches a skill, the LLM uses read_file to open SKILL.md
 * 3. LLM reads only what it needs (references, scripts) as described in SKILL.md
 * 4. LLM executes the task using its existing tools (run_python, run_node, shell, etc.)
 *
 * This avoids bloating the context with full SKILL.md content upfront,
 * and lets the LLM decide what to read based on the specific task.
 *
 * Lifecycle:
 * 1. On startup: scan ~/.cowork/skills/, parse SKILL.md frontmatter, build registry
 * 2. On file change or /reload-skills: atomic reload
 * 3. System prompt includes skill list via getAvailableSkillsPrompt()
 */

import { loadSkillsFromFilesystem, type LoadedSkill } from "./skill-loader";
import type { SkillRecord } from "@/types";

class SkillRegistry {
  private skills: LoadedSkill[] = [];
  private loaded = false;
  private onChangeCallbacks: Array<() => void> = [];

  onChange(cb: () => void): () => void {
    this.onChangeCallbacks.push(cb);
    return () => { this.onChangeCallbacks = this.onChangeCallbacks.filter((c) => c !== cb); };
  }

  private notifyChange() {
    for (const cb of this.onChangeCallbacks) cb();
  }

  async initialize(): Promise<void> {
    await this.reload();
    this.loaded = true;
  }

  async reload(): Promise<{ added: string[]; removed: string[]; total: number }> {
    const oldNames = new Set(this.skills.map((s) => s.record.name));
    const newSkills = await loadSkillsFromFilesystem();
    const newNames = new Set(newSkills.map((s) => s.record.name));
    const added = [...newNames].filter((n) => !oldNames.has(n));
    const removed = [...oldNames].filter((n) => !newNames.has(n));

    this.skills = newSkills;
    this.notifyChange();

    return { added, removed, total: newSkills.length };
  }

  getAll(): LoadedSkill[] {
    return this.skills;
  }

  getByType(type: "app" | "skill"): LoadedSkill[] {
    return this.skills.filter((s) => s.record.type === type);
  }

  getByName(name: string): LoadedSkill | undefined {
    return this.skills.find((s) => s.record.name === name);
  }

  /** Get summary for system prompt (legacy — used in system config section). */
  getSummary(): string {
    if (this.skills.length === 0) return "";
    return this.skills.map((s) =>
      `- ${s.record.name} (${s.record.type}): ${s.record.definition.purpose}`,
    ).join("\n");
  }

  /**
   * Build the "Available Skills" section for the system prompt.
   * Lists each skill with name, description, and SKILL.md path.
   * The LLM uses read_file to open SKILL.md when it needs the skill.
   *
   * This is the Codex CLI "progressive disclosure" pattern:
   * - System prompt: lightweight list (name + description + path)
   * - On use: LLM reads SKILL.md → follows instructions → uses tools
   */
  getAvailableSkillsPrompt(): string | null {
    const skillType = this.skills.filter((s) => s.record.type === "skill");
    if (skillType.length === 0) return null;

    const lines: string[] = [];
    lines.push("## Skills");
    lines.push("Skills are instruction files (SKILL.md) stored on disk. Each provides domain-specific guidance for a type of task.");
    lines.push("");
    lines.push("### Available skills");

    for (const loaded of skillType) {
      const { record, dirPath, hasScripts } = loaded;
      const scriptNote = hasScripts ? " (has scripts/)" : "";
      lines.push(`- **${record.name}**: ${record.definition.purpose} — \`${dirPath}/SKILL.md\`${scriptNote}`);
    }

    lines.push("");
    lines.push("### How to use skills");
    lines.push(`- **The list above is EXHAUSTIVE.** Do NOT speculatively read SKILL.md paths for skills not listed (e.g. don't probe \`~/.cowork/skills/<guess>/SKILL.md\` based on the path convention you see for installed skills). If a domain isn't covered by a listed skill, use built-in tools directly — for .pptx that means \`render_slideml\` etc., not a hypothetical pptx skill.
- **Trigger**: If the user's task clearly matches a listed skill's description, use that skill.
- **Activation requirement**: A skill is not active just because it is listed here. To use a skill, you MUST first read its SKILL.md with \`read_file\` in the current turn.
- **Progressive disclosure**: Do NOT load all skills upfront. When you decide to use a skill:
  1. Use \`read_file\` to open its SKILL.md
  2. Read only enough to follow the workflow for the current task
  3. If SKILL.md references other files (scripts/, references/), load only what you need
  4. If scripts/ exist, prefer running them instead of rewriting large code blocks
- **Execution**: Use your existing tools (run_python, run_node, shell, write_file, etc.) to follow the skill's instructions. Skills do not have their own execute method.
- **Multiple skills**: If multiple skills apply, use the minimal set needed and read each selected SKILL.md before relying on it.
- **Missing skill**: If a skill can't be loaded or doesn't apply, say so briefly and continue with the best approach.`);

    return lines.join("\n");
  }

  isLoaded(): boolean {
    return this.loaded;
  }
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
