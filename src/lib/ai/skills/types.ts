import type { ToolDefinition } from "@/lib/ai/providers/types";

/** A Skill is a capability the agent can invoke via tool calling. */
export interface Skill {
  /** Tool definition sent to the LLM. */
  definition: ToolDefinition;
  /** Execute the skill with the given input. Returns a string result for the LLM. */
  execute(input: Record<string, unknown>): Promise<string>;
}
