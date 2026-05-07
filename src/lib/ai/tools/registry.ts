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
import { browserTool } from "./browser";
import { shellExecSkill } from "./shell-exec";
import { applyPatchSkill } from "./apply-patch";
import { updateTaskProgress } from "./update-task-progress";
import { imageGen } from "./image-gen";
import { generateIconSheet } from "./generate-icon-sheet";
import { describeSchemaTool } from "./describe-schema";
import { createDeckTool } from "./create-deck";
import { readDeckTool } from "./read-deck";
import { replaceSlideTool } from "./replace-slide";
import { insertSlideTool } from "./insert-slide";
import { deleteSlideTool } from "./delete-slide";
import { patchDeckTool } from "./patch-deck";
import { validateRenderTool } from "./validate-render";

/**
 * Built-in tool registry.
 *
 * Core file ops:           read_file, write_file, apply_patch, list_directory, grep
 * Execution:               shell, run_python, run_node
 * Web:                     web_search, web_fetch, browser
 * Knowledge & memory:      list_knowledge_sources, get_source_catalog, search_knowledge, save_memory
 * Output / progress:       create_artifact, update_task_progress
 * Media:                   image_gen, generate_icon_sheet
 * Decks (SlideML2):        describe_schema, create_deck, read_deck, replace_slide, insert_slide, delete_slide, patch_deck, validate_render
 *   Skill:                 read the slideml2 SKILL.md once per deck task; for business/research decks also read sibling business.md completely
 *   Discovery:             describe_schema({ components }) for focused prop schemas
 *   Typical authoring:     create_deck → replace_slide (append by passing slideId == slideCount)
 *   Editing:               replace_slide (slide content) | insert_slide (new at index) | delete_slide (by id/index) | patch_deck (deck-level fields, reorder)
 *   Render & QA:           validate_render (schema + render + diagnostics; use periodically and before final delivery)
 *   Do not bypass:          do not hand-edit SlideML2 deck JSON via write_file/run_node/run_python, and do not fallback to python-pptx after validate_render fails unless the user explicitly asks to abandon SlideML2.
 *
 * The agent must activate the slideml2 skill once at the start of any deck
 * task. Its SKILL.md carries the design taste, component philosophy,
 * component purpose index, composition patterns, and diagnostic playbook
 * that the tool descriptions intentionally do not.
 */
const tools: Record<string, Tool> = {
  read_file: readFile,
  write_file: writeFileSkill,
  apply_patch: applyPatchSkill,
  list_directory: listDirectorySkill,
  grep: grepSkill,
  shell: shellExecSkill,
  run_python: runPython,
  run_node: runNode,
  web_search: webSearchSkill,
  web_fetch: webFetchSkill,
  browser: browserTool,
  list_knowledge_sources: listKnowledgeSources,
  get_source_catalog: getSourceCatalog,
  search_knowledge: searchKnowledge,
  save_memory: saveMemory,
  create_artifact: createArtifactSkill,
  update_task_progress: updateTaskProgress,
  image_gen: imageGen,
  generate_icon_sheet: generateIconSheet,
  describe_schema: describeSchemaTool,
  create_deck: createDeckTool,
  read_deck: readDeckTool,
  replace_slide: replaceSlideTool,
  insert_slide: insertSlideTool,
  delete_slide: deleteSlideTool,
  patch_deck: patchDeckTool,
  validate_render: validateRenderTool,
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
