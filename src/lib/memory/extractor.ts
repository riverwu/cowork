import { getConfiguredProvider } from "@/lib/ai/providers";
import type { LLMMessage } from "@/lib/ai/providers/types";
import { generateEmbedding } from "@/lib/knowledge/embeddings";
import {
  upsertCoreFact,
  createMemory,
  createEpisode,
} from "@/lib/db";
import type { CoreFact, MemoryType, EpisodeOutcome } from "@/types";

const EXTRACTION_PROMPT = `You are a memory extraction system. Analyze the conversation and extract structured information.

Return a JSON object with these fields:
{
  "facts": [
    {"key": "short_key", "value": "fact value", "category": "preference|context|entity|general"}
  ],
  "memories": [
    {"content": "insight or pattern observed", "type": "insight|preference|pattern|entity|correction", "importance": 0.0-1.0}
  ],
  "episode": {
    "task_summary": "one-line summary of what the user wanted",
    "outcome": "success|partial|failure|cancelled",
    "reflection": "what worked well, what could be better, what to remember for next time"
  }
}

Guidelines:
- facts: extract durable user preferences, work context, named entities (people, projects, tools they use)
- memories: extract reusable insights — patterns in how the user works, corrections they made, preferences they showed
- episode: summarize the task and reflect on execution quality
- importance: 0.3 for minor observations, 0.5 for useful patterns, 0.8 for critical corrections/preferences
- Only include facts/memories that are genuinely useful for future interactions
- If the conversation was trivial (greeting, simple question), return minimal or empty arrays
- Return ONLY valid JSON, no markdown fences`;

/**
 * Extract memories from a completed conversation.
 * Called after agent finishes execution.
 */
export async function extractMemories(
  conversationMessages: LLMMessage[],
  sessionId: string,
): Promise<void> {
  // Skip very short conversations
  if (conversationMessages.length < 2) return;

  try {
    const provider = await getConfiguredProvider();

    // Build extraction request
    const conversationText = conversationMessages
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content))
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const messages: LLMMessage[] = [
      { role: "user", content: `Analyze this conversation and extract memories:\n\n${conversationText}` },
    ];

    // Collect full response (non-streaming)
    let fullText = "";
    for await (const event of provider.stream({
      system: EXTRACTION_PROMPT,
      messages,
    })) {
      if (event.type === "text-delta") {
        fullText += event.text;
      }
    }

    // Parse JSON response
    const extracted = parseExtractionResponse(fullText);
    if (!extracted) return;

    // Store core facts
    if (extracted.facts) {
      for (const fact of extracted.facts) {
        await upsertCoreFact(
          fact.key,
          fact.value,
          fact.category as CoreFact["category"],
          "auto",
        );
      }
    }

    // Store semantic memories with embeddings
    if (extracted.memories) {
      for (const mem of extracted.memories) {
        let embedding: number[] | undefined;
        try {
          embedding = await generateEmbedding(mem.content);
        } catch {
          // Continue without embedding
        }

        await createMemory({
          content: mem.content,
          memoryType: mem.type as MemoryType,
          embedding,
          importance: mem.importance || 0.5,
          sessionId,
        });
      }
    }

    // Store episode
    if (extracted.episode) {
      let embedding: number[] | undefined;
      try {
        embedding = await generateEmbedding(extracted.episode.task_summary);
      } catch {
        // Continue without embedding
      }

      await createEpisode({
        sessionId,
        taskSummary: extracted.episode.task_summary,
        outcome: extracted.episode.outcome as EpisodeOutcome,
        reflection: extracted.episode.reflection,
        skillsUsed: extracted.episode.skills_used,
        embedding,
      });
    }
  } catch (err) {
    console.error("Memory extraction failed:", err);
    // Non-critical — don't block the user
  }
}

function parseExtractionResponse(text: string): ExtractionResult | null {
  try {
    // Try to find JSON in the response (may have surrounding text)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

interface ExtractionResult {
  facts?: Array<{ key: string; value: string; category: string }>;
  memories?: Array<{ content: string; type: string; importance: number }>;
  episode?: {
    task_summary: string;
    outcome: string;
    reflection: string;
    skills_used?: string[];
  };
}
