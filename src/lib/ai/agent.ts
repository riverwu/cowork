import { getConfiguredProvider } from "./providers";
import type { LLMMessage, StreamEvent } from "./providers/types";
import { getSkills } from "./skills/registry";
import { buildSystemPrompt } from "./system-prompt";
import { retrieveRelevant, buildKnowledgeContext } from "@/lib/knowledge";
import { retrieveMemoryContext, buildMemoryPrompt, extractMemories } from "@/lib/memory";
import { createArtifact } from "@/lib/db";
import type { AgentEvent } from "@/types";

const MAX_STEPS = 10;

export interface AgentParams {
  messages: LLMMessage[];
  sessionId: string;
  /** Skip knowledge retrieval (e.g., for simple follow-ups). */
  skipKnowledge?: boolean;
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
  const skills = getSkills();
  const toolDefs = Object.values(skills).map((s) => s.definition);

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

  // 3. Build system prompt
  const system = buildSystemPrompt({
    memoryContext: memoryContext || undefined,
    knowledgeContext: knowledgeContext || undefined,
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
        const result = await skill.execute(toolCall.input as Record<string, unknown>);
        const durationMs = Date.now() - startTime;

        if (result.startsWith("__ARTIFACT__:")) {
          const artifact = await handleArtifactResult(result, params.sessionId);
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

async function handleArtifactResult(result: string, sessionId: string) {
  const firstNewline = result.indexOf("\n");
  const header = result.slice(0, firstNewline);
  const content = result.slice(firstNewline + 1);
  const parts = header.split(":");
  if (parts.length < 3) return null;
  const type = parts[1] as "report" | "table";
  const title = parts.slice(2).join(":");
  return createArtifact({ sessionId, type, title, content });
}

function summarizeResult(result: string): unknown {
  if (result.length <= 200) return result;
  return result.slice(0, 200) + `... (${result.length} chars total)`;
}
