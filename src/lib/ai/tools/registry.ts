import type { Tool } from "./types";
import { searchKnowledge } from "./search-knowledge";
import { listKnowledgeSources } from "./list-knowledge-sources";
import { getSourceCatalog } from "./get-source-catalog";
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
import { updateTaskProgress } from "./update-task-progress";
import { imageGen } from "./image-gen";
import { listSlideLayoutsTool } from "./list-slide-layouts";
import { describeSlideLayoutTool } from "./describe-slide-layout";
import { validateSlidemlTool } from "./validate-slideml";
import { renderSlidemlTool } from "./render-slideml";

/**
 * Built-in tool registry — 21 tools.
 *
 * These are the agent's built-in capabilities, registered as LLM function-calling tools.
 * They are NOT user-installed skills (SKILL.md) — those are managed by SkillRegistry.
 *
 * Core file operations:
 *   read_file, write_file, apply_patch, list_directory, grep
 * Execution:
 *   shell, run_python, run_node
 * Web:
 *   web_search, web_fetch
 * Knowledge & Memory:
 *   list_knowledge_sources, get_source_catalog, search_knowledge, save_memory
 * Output:
 *   create_artifact, update_task_progress
 * Media:
 *   image_gen
 * Decks (progressive disclosure: list → describe → validate → render):
 *   list_slide_layouts, describe_slide_layout, validate_slideml, render_slideml
 */
const tools: Record<string, Tool> = {
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
  list_knowledge_sources: listKnowledgeSources,
  get_source_catalog: getSourceCatalog,
  search_knowledge: searchKnowledge,
  save_memory: saveMemory,
  // Output
  create_artifact: createArtifactSkill,
  update_task_progress: updateTaskProgress,
  // Media
  image_gen: imageGen,
  // Decks
  list_slide_layouts: listSlideLayoutsTool,
  describe_slide_layout: describeSlideLayoutTool,
  validate_slideml: validateSlidemlTool,
  render_slideml: renderSlidemlTool,
};

export function getTools(): Record<string, Tool> {
  return tools;
}

export function getTool(name: string): Tool | undefined {
  return tools[name];
}

export function getToolDefinitions() {
  return Object.values(tools).map((t) => t.definition);
}
