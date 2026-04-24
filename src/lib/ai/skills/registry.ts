import type { Skill } from "./types";
import { searchKnowledge } from "./search-knowledge";
import { readFile } from "./read-document";
import { writeFileSkill } from "./write-file";
import { listDirectorySkill } from "./list-directory";
import { grepSkill } from "./grep";
import { runPython } from "./run-python";
import { runNode } from "./run-node";
import { saveMemory } from "./save-memory";
import { createArtifactSkill } from "./create-artifact";
import { webSearchSkill } from "./web-search";
import { webFetchSkill } from "./web-fetch";
import { shellExecSkill } from "./shell-exec";
import { applyPatchSkill } from "./apply-patch";

/**
 * Built-in tool registry — 13 tools.
 *
 * Core file operations:
 *   read_file, write_file, apply_patch, list_directory, grep
 * Execution:
 *   shell, run_python, run_node
 * Web:
 *   web_search, web_fetch
 * Knowledge & Memory:
 *   search_knowledge, save_memory
 * Output:
 *   create_artifact
 */
const skills: Record<string, Skill> = {
  // File operations
  read_file: readFile,
  write_file: writeFileSkill,
  apply_patch: applyPatchSkill,
  list_directory: listDirectorySkill,
  grep: grepSkill,
  // Execution
  shell: shellExecSkill,
  run_python: runPython,
  run_node: runNode,
  // Web
  web_search: webSearchSkill,
  web_fetch: webFetchSkill,
  // Knowledge & Memory
  search_knowledge: searchKnowledge,
  save_memory: saveMemory,
  // Output
  create_artifact: createArtifactSkill,
};

export function getSkills(): Record<string, Skill> {
  return skills;
}

export function getSkill(name: string): Skill | undefined {
  return skills[name];
}

export function getToolDefinitions() {
  return Object.values(skills).map((s) => s.definition);
}
