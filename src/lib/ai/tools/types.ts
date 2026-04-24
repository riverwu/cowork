import type { ToolDefinition } from "@/lib/ai/providers/types";

/** Called during long-running tool execution to stream partial output. */
export type ProgressCallback = (output: string) => void;

/** A Tool is a capability the agent can invoke via function calling. */
export interface Tool {
  /** Tool definition sent to the LLM. */
  definition: ToolDefinition;
  /** Execute the tool with the given input. Returns a string result for the LLM. */
  execute(input: Record<string, unknown>, onProgress?: ProgressCallback): Promise<string>;
}
