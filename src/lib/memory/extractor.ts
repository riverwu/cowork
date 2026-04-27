import { getConfiguredProvider } from "@/lib/ai/providers";
import type { LLMMessage } from "@/lib/ai/providers/types";
import { generateEmbedding } from "@/lib/knowledge/embeddings";
import {
  upsertCoreFact,
  createMemory,
  createEpisode,
  getSettings,
} from "@/lib/db";
import { computeBudget, estimateTokens } from "@/lib/ai/context-budget";
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

    // Bound the extractor's own LLM call to the same context budget the
    // agent uses, so a long conversation can't overflow the model. We give
    // the extractor a generous half of the input budget — it receives just
    // one user message (no tool defs, no agent state) and returns small JSON.
    const settings = await getSettings();
    const budget = computeBudget({
      modelId: settings.modelId,
      contextTokensOverride: settings.modelContextTokens,
      maxOutputTokens: settings.modelMaxOutputTokens,
    });
    const systemTokens = estimateTokens(EXTRACTION_PROMPT);
    const wrapperOverheadTokens = 64; // role headers + the "Analyze this…" prefix
    const conversationBudgetTokens = Math.max(
      1_500,
      Math.floor(budget.inputBudget / 2) - systemTokens - wrapperOverheadTokens,
    );
    const conversationBudgetBytes = conversationBudgetTokens * 4; // matches APPROX_BYTES_PER_TOKEN

    // Build conversation transcript from the TAIL of the conversation —
    // the most recent turns are most useful for extracting current
    // preferences and the latest task outcome.
    const conversationText = buildBoundedTranscript(conversationMessages, conversationBudgetBytes);

    const messages: LLMMessage[] = [
      { role: "user", content: `Analyze this conversation and extract memories:\n\n${conversationText}` },
    ];

    // Collect full response (non-streaming)
    let fullText = "";
    for await (const event of provider.stream({
      system: EXTRACTION_PROMPT,
      messages,
      maxOutputTokens: budget.maxOutputTokens,
    })) {
      if (event.type === "text-delta") {
        fullText += event.text;
      }
    }

    // Parse JSON response
    const extracted = parseExtractionResponse(fullText);
    if (!extracted) return;

    // Store core facts — skip ephemeral / per-task data. Paths, file
    // names, slide / page counts, run-workspace ids and similar are
    // garbage in a long-lived "what we know about the user" store: they
    // turn into stale claims the next turn quietly trusts (e.g. saved
    // `output_location: /Users/river/...pptx` made the agent skip
    // verification and assume the file already existed).
    if (extracted.facts) {
      for (const fact of extracted.facts) {
        if (isEphemeralFact(fact.key, fact.value)) continue;
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

/** Reject facts that are about a single task's output rather than enduring
 *  user/work context. Heuristics are deliberately broad: false negatives
 *  here corrupt future turns, false positives just mean the user's next
 *  conversation has slightly less seeded context. */
function isEphemeralFact(key: string, value: string): boolean {
  const k = key.toLowerCase();
  const v = (value || "").trim();
  // Keys that are obviously about a single deliverable's location / shape.
  const ephemeralKeyPatterns = [
    /output_(location|file|dir(ectory)?|path)/,
    /^(file_path|filename|file_name)$/,
    /(ppt|deck|slide|page|image|note)_?(count|filename|file|path)$/,
    /^(run_?id|workspace_?path|workspace_?dir|work_?dir)$/,
    /_path$/,
    /^current_(task|topic|work_project|file)$/,
    /^total_/,
    /^first_ppt|^second_ppt|^magazine_ppt/,
    /^slide_count$/,
    /^content_scope$/,
    /^ppt_(structure|page_count|filename|file)/,
  ];
  if (ephemeralKeyPatterns.some((p) => p.test(k))) return true;
  // Values that look like absolute paths or file names with extensions —
  // those are state, not preferences.
  if (/^\/(Users|home|var|tmp)\//.test(v)) return true;
  if (/\.(pptx|docx|xlsx|pdf|md|json|yaml|png|jpe?g|html|csv|tsv)(\W|$)/i.test(v)) return true;
  return false;
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

/**
 * Walk the conversation tail-first, accumulating role-tagged lines until we
 * approach the byte budget. The tail (most recent turns) is most useful for
 * memory extraction, so we keep newest messages and drop oldest if needed.
 * Per-message content is itself capped so a single huge user dump doesn't
 * burn the entire budget.
 */
function buildBoundedTranscript(messages: LLMMessage[], maxBytes: number): string {
  const PER_MESSAGE_BYTE_CAP = Math.min(8_000, Math.floor(maxBytes / 2));
  const filtered = messages.filter(
    (m) => m.role === "user" || (m.role === "assistant" && m.content),
  );

  const lines: string[] = [];
  let usedBytes = 0;
  let truncatedAtHead = false;

  for (let i = filtered.length - 1; i >= 0; i--) {
    const msg = filtered[i];
    const content = msg.content || "";
    const capped = content.length > PER_MESSAGE_BYTE_CAP
      ? `${content.slice(0, PER_MESSAGE_BYTE_CAP)}…[content truncated]`
      : content;
    const line = `${msg.role}: ${capped}`;
    const lineBytes = new TextEncoder().encode(line).length + 1;
    if (usedBytes + lineBytes > maxBytes) {
      truncatedAtHead = i > 0;
      break;
    }
    lines.push(line);
    usedBytes += lineBytes;
  }

  lines.reverse();
  if (truncatedAtHead) {
    lines.unshift("[older conversation turns omitted to fit memory-extraction budget]");
  }
  return lines.join("\n");
}
