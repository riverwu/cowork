import { getConfiguredProvider } from "./providers";
import type { LLMMessage, StreamEvent } from "./providers/types";
import { getSkills } from "./skills/registry";
import { skillRegistry } from "./skill-registry";
import { getSkillsDir } from "./skill-loader";
import { buildSystemPrompt } from "./system-prompt";
import { retrieveRelevant, buildKnowledgeContext } from "@/lib/knowledge";
import { retrieveMemoryContext, buildMemoryPrompt, extractMemories } from "@/lib/memory";
import { mcpManager } from "@/lib/mcp";
import type { AgentEvent } from "@/types";

const MAX_STEPS = 25;

export interface AgentParams {
  messages: LLMMessage[];
  sessionId: string;
  skipKnowledge?: boolean;
  planMode?: boolean;
  /** Working directory — tools use this as default cwd. */
  workingDirectory?: string;
  /** Called when a skill produces streaming output (e.g., shell command output). */
  onProgress?: (skill: string, output: string) => void;
}

/**
 * Core agent loop. Async generator that yields events for the UI to consume.
 *
 * Flow:
 *   1. Retrieve memory context (core facts + semantic memories + episodes)
 *   2. Retrieve relevant knowledge (RAG)
 *   3. Build system prompt with memory + knowledge
 *   4. Loop: call LLM → yield streaming events → execute tool calls → repeat
 *   5. Until LLM stops calling tools (task complete)
 *   6. After completion: extract memories from conversation (async, non-blocking)
 */
export async function* runAgent(params: AgentParams): AsyncGenerator<AgentEvent> {
  const provider = await getConfiguredProvider();

  // Wait for MCP servers to finish connecting (with timeout)
  await mcpManager.waitForReady();

  // Merge built-in skills + user skills (from registry) + MCP tools
  const builtinSkills = getSkills();
  const userSkills = skillRegistry.getTools();
  const mcpSkills = mcpManager.getAllSkills();
  const skills = { ...builtinSkills, ...userSkills, ...mcpSkills };
  const toolDefs = Object.values(skills).map((s) => s.definition);

  console.log(`[Agent] Tools: ${toolDefs.length} total (${Object.keys(builtinSkills).length} built-in + ${Object.keys(mcpSkills).length} MCP)`);
  if (Object.keys(mcpSkills).length > 0) {
    console.log(`[Agent] MCP tools:`, Object.keys(mcpSkills));
  }

  const lastUserMsg = [...params.messages].reverse().find((m) => m.role === "user");
  const query = lastUserMsg?.content || "";

  // 1. Retrieve memory context
  let memoryContext = "";
  try {
    const memCtx = await retrieveMemoryContext(query);
    memoryContext = buildMemoryPrompt(memCtx);
  } catch {
    // Memory retrieval failed — continue without
  }

  // 2. Retrieve knowledge context
  let knowledgeContext = "";
  if (!params.skipKnowledge && query) {
    try {
      const results = await retrieveRelevant(query, 5);
      if (results.length > 0) {
        knowledgeContext = buildKnowledgeContext(results);
        yield {
          type: "knowledge-ref",
          refs: results.map((r) => ({
            documentId: r.documentId,
            filename: (r.metadata?.filename as string) || "unknown",
            snippet: r.content.slice(0, 100),
          })),
        };
      }
    } catch {
      // Knowledge retrieval failed — continue without
    }
  }

  // 3. Build system prompt with system paths + MCP status
  let skillsDir = "";
  try { skillsDir = await getSkillsDir(); } catch { /* ignore */ }
  const home = skillsDir.replace(/\/\.cowork\/skills$/, "");

  // Gather MCP server status for system prompt
  const mcpStatuses = mcpManager.getServerStatus();
  const mcpSummary = mcpStatuses
    .filter((s) => s.enabled)
    .map((s) => {
      if (s.status === "available") return `- ✓ ${s.name}: available (${s.toolCount} tools)`;
      if (s.status === "needs_config") return `- ✗ ${s.name}: needs configuration`;
      if (s.status === "error") return `- ✗ ${s.name}: error (${s.error || "unknown"})`;
      return `- ${s.name}: ${s.status}`;
    })
    .join("\n");

  const system = buildSystemPrompt({
    tools: toolDefs,
    memoryContext: memoryContext || undefined,
    knowledgeContext: knowledgeContext || undefined,
    planMode: params.planMode,
    workingDirectory: params.workingDirectory,
    systemPaths: {
      skills: skillsDir,
      mcp: `${home}/.cowork/mcps/`,
      skillsSummary: skillRegistry.getSummary(),
      mcpSummary: mcpSummary || undefined,
    },
  });

  // 4. Agent loop
  const currentMessages: LLMMessage[] = [...params.messages];
  let fullAssistantText = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    let doneEvent: StreamEvent | null = null;

    for await (const event of provider.stream({
      system,
      messages: currentMessages,
      tools: toolDefs,
    })) {
      if (event.type === "text-delta") {
        yield { type: "text-delta", text: event.text };
      } else if (event.type === "tool-call") {
        yield { type: "skill-start", skill: event.name, input: event.input };
      } else if (event.type === "message-done") {
        doneEvent = event;
      }
    }

    if (!doneEvent || doneEvent.type !== "message-done") {
      yield { type: "error", error: "Unexpected end of stream" };
      break;
    }

    fullAssistantText += doneEvent.content;

    if (doneEvent.stopReason !== "tool_use" || doneEvent.toolCalls.length === 0) {
      break;
    }

    currentMessages.push({
      role: "assistant",
      content: doneEvent.content,
      toolCalls: doneEvent.toolCalls,
    });

    for (const toolCall of doneEvent.toolCalls) {
      const skill = skills[toolCall.name];
      if (!skill) {
        const errResult = `Unknown skill: ${toolCall.name}`;
        currentMessages.push({ role: "tool", toolCallId: toolCall.id, content: errResult });
        yield { type: "skill-done", skill: toolCall.name, result: errResult, durationMs: 0 };
        continue;
      }

      const startTime = Date.now();
      try {
        // Progress callback — updates store directly for live output display
        const onProgress = params.onProgress
          ? (output: string) => params.onProgress!(toolCall.name, output)
          : undefined;

        const result = await skill.execute(toolCall.input as Record<string, unknown>, onProgress);
        const durationMs = Date.now() - startTime;

        if (result.startsWith("__ARTIFACT__:")) {
          const artifact = parseArtifactMarker(result);
          if (artifact) {
            yield { type: "artifact", artifact };
          }
        }

        currentMessages.push({ role: "tool", toolCallId: toolCall.id, content: result });
        yield { type: "skill-done", skill: toolCall.name, result: summarizeResult(result), durationMs };
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const errResult = `Skill execution error: ${err}`;
        currentMessages.push({ role: "tool", toolCallId: toolCall.id, content: errResult });
        yield { type: "skill-done", skill: toolCall.name, result: errResult, durationMs };
      }
    }
  }

  yield { type: "done" };

  // 5. Post-completion: extract memories asynchronously
  // Don't block the UI — fire and forget
  if (params.messages.length >= 2) {
    const allMessages: LLMMessage[] = [
      ...params.messages,
      ...(fullAssistantText ? [{ role: "assistant" as const, content: fullAssistantText }] : []),
    ];
    extractMemories(allMessages, params.sessionId).catch((err) => {
      console.error("Memory extraction failed:", err);
    });
  }
}

/** Parse artifact marker from create_artifact skill output.
 *  The skill already saved to DB — we just need the data for the UI event. */
function parseArtifactMarker(result: string) {
  const firstNewline = result.indexOf("\n");
  if (firstNewline < 0) return null;
  const header = result.slice(0, firstNewline);
  const content = result.slice(firstNewline + 1);
  const parts = header.split(":");
  if (parts.length < 3) return null;
  return {
    id: "",  // Already saved in DB by the skill
    sessionId: null,
    appId: null,
    runId: null,
    type: parts[1] as "report" | "table" | "action_list",
    title: parts.slice(2).join(":"),
    content,
    metadata: null,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

function summarizeResult(result: string): unknown {
  if (result.length <= 200) return result;
  return result.slice(0, 200) + `... (${result.length} chars total)`;
}
