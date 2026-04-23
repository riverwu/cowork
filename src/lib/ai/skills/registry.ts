import type { Skill } from "./types";
import { searchKnowledge } from "./search-knowledge";
import { readFile } from "./read-document";
import { writeFileSkill } from "./write-file";
import { listDirectorySkill } from "./list-directory";
import { grepSkill } from "./grep";
import { runPython } from "./run-python";
import { saveMemory } from "./save-memory";
import { createArtifactSkill } from "./create-artifact";

/**
 * Built-in tool registry.
 *
 * 8 tools, minimal and stable:
 * - search_knowledge: RAG search across knowledge base
 * - read_file: read file contents (text + documents)
 * - write_file: write/create files
 * - list_directory: explore file system
 * - grep: search file contents
 * - run_python: execute Python in isolated env
 * - save_memory: store to persistent memory
 * - create_artifact: produce structured output
 */
const skills: Record<string, Skill> = {
  search_knowledge: searchKnowledge,
  read_file: readFile,
  write_file: writeFileSkill,
  list_directory: listDirectorySkill,
  grep: grepSkill,
  run_python: runPython,
  save_memory: saveMemory,
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
