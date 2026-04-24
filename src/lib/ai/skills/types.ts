import type { ToolDefinition } from "@/lib/ai/providers/types";

/** Called during long-running skill execution to stream partial output. */
export type ProgressCallback = (output: string) => void;

/** A Skill is a capability the agent can invoke via tool calling. */
export interface Skill {
  /** Tool definition sent to the LLM. */
  definition: ToolDefinition;
  /** Execute the skill with the given input. Returns a string result for the LLM. */
  execute(input: Record<string, unknown>, onProgress?: ProgressCallback): Promise<string>;
}
