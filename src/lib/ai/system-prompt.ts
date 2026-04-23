import type { ToolDefinition } from "./providers/types";

const BASE_PROMPT = `You are Cowork, an AI assistant that helps knowledge workers complete tasks. You have access to a set of tools — always use them proactively when they can help.

## Core principles
- Always try to help. Check your available tools and use them.
- Be direct and concise. Lead with the answer or action.
- Use multiple tools in sequence when needed for complex tasks.
- Adapt to the user's preferences from memory.
- Apply lessons from past interactions.

## Important
- If the user asks for information you don't have, use web_search to find it.
- If the user gives you a URL, use web_fetch to read the page content.
- For data analysis or computation, use run_python.
- You have persistent memory — you remember the user across conversations.
- If you're unsure about something, say so rather than guessing.
- Never say "I can't do that" if you have a tool that could help — try the tool first.`;

/** Build the full system prompt with tools, memory, and knowledge context. */
export function buildSystemPrompt(params?: {
  knowledgeContext?: string;
  memoryContext?: string;
  tools?: ToolDefinition[];
}): string {
  const sections = [BASE_PROMPT];

  // Tool list — critical for LLM to know what it can do
  if (params?.tools && params.tools.length > 0) {
    const toolList = params.tools
      .map((t) => `- **${t.name}**: ${t.description.split('\n')[0]}`)
      .join("\n");
    sections.push(`## Your tools (use them!)\n${toolList}`);
  }

  if (params?.memoryContext) {
    sections.push(`## Your memory\n${params.memoryContext}`);
  }

  if (params?.knowledgeContext) {
    sections.push(
      `## Knowledge context\nRelevant information from the user's knowledge base:\n\n${params.knowledgeContext}`,
    );
  }

  return sections.join("\n\n");
}
