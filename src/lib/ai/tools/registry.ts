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
import { listSlidePagePatternsTool } from "./list-slide-pagepatterns";
import { describeSlidePagePatternTool } from "./describe-slide-pagepattern";
import { listContentComponentsTool } from "./list-content-components";
import { describeContentComponentTool } from "./describe-content-component";
import { validateSlidemlTool } from "./validate-slideml";
import { renderSlidemlTool } from "./render-slideml";
import { editSlidemlTool } from "./edit-slideml";
import { appendSlidesTool } from "./append-slides";
import { readSlideTool } from "./read-slide";
import { replaceSlideTool } from "./replace-slide";
import { auditPptxTool } from "./audit-pptx";
import { listThemesTool } from "./list-themes";
import { describeThemeTool } from "./describe-theme";

/**
 * Built-in tool registry — 31 tools.
 *
 * These are the agent's built-in capabilities, registered as LLM function-calling tools.
 * They are NOT user-installed skills (SKILL.md) — those are managed by SkillRegistry.
 *
 * Core file operations:
 *   read_file, write_file, apply_patch, list_directory, grep
 * Execution:
 *   shell, run_python, run_node
 * Web:
 *   web_search, web_fetch, browser
 * Knowledge & Memory:
 *   list_knowledge_sources, get_source_catalog, search_knowledge, save_memory
 * Output:
 *   create_artifact, update_task_progress
 * Media:
 *   image_gen
 * Decks (progressive disclosure: list_themes → describe_theme → PagePatterns → ContentComponents → validate → render → edit/audit):
 *   list_themes, describe_theme, list_slide_pagepatterns, describe_slide_pagepattern,
 *   list_content_components, describe_content_component,
 *   validate_slideml, render_slideml, append_slides, read_slide, replace_slide,
 *   edit_slideml, audit_pptx
 *   ↑ Build path:    write_file skeleton → append_slides batches → render_slideml.
 *     Surgical-fix path: validate_slideml fails on slides[N] → read_slide(path,N)
 *                        → replace_slide(path,N,fixed) → re-validate. Avoids
 *                        re-emitting the whole deck for single-slide errors.
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
  browser: browserTool,
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
  list_themes: listThemesTool,
  describe_theme: describeThemeTool,
  list_slide_pagepatterns: listSlidePagePatternsTool,
  describe_slide_pagepattern: describeSlidePagePatternTool,
  list_content_components: listContentComponentsTool,
  describe_content_component: describeContentComponentTool,
  validate_slideml: validateSlidemlTool,
  render_slideml: renderSlidemlTool,
  append_slides: appendSlidesTool,
  read_slide: readSlideTool,
  replace_slide: replaceSlideTool,
  edit_slideml: editSlidemlTool,
  audit_pptx: auditPptxTool,
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
