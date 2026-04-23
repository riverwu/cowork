import type { Skill } from "./types";
import { searchKnowledge } from "./search-knowledge";
import { readDocument } from "./read-document";
import { analyzeData } from "./analyze-data";
import { generateReport } from "./generate-report";

/** All available skills. */
const skills: Record<string, Skill> = {
  search_knowledge: searchKnowledge,
  read_document: readDocument,
  analyze_data: analyzeData,
  generate_report: generateReport,
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
