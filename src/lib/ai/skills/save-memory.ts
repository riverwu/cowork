import type { Skill } from "./types";
import { upsertCoreFact, createMemory } from "@/lib/db";
import { generateEmbedding } from "@/lib/knowledge/embeddings";
import type { CoreFact, MemoryType } from "@/types";

export const saveMemory: Skill = {
  definition: {
    name: "save_memory",
    description:
      `Save information to persistent memory for future reference. Use this when the user tells you something important about themselves, their preferences, their work, or when you learn something that should be remembered across conversations.

Types of things to save:
- User preferences ("I prefer concise answers", "Always use markdown tables")
- Work context ("Current project is Phoenix", "Sprint ends Friday")
- Important entities ("Key client: ABC Corp", "Manager: Alice")
- Corrections ("Don't use bullet points for summaries")

This memory persists across conversations and app restarts.`,
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "What to remember — a clear, concise statement",
        },
        memory_type: {
          type: "string",
          enum: ["preference", "insight", "pattern", "entity", "correction"],
          description: "Type of memory: preference (user likes/dislikes), insight (observation), pattern (work habit), entity (person/project/tool), correction (user corrected you)",
        },
        key: {
          type: "string",
          description: "Optional: a short key for core facts (e.g., 'preferred_language', 'current_project'). If provided, stores as a core fact that's always loaded.",
        },
      },
      required: ["content", "memory_type"],
    },
  },

  async execute(input) {
    const content = input.content as string;
    const memoryType = input.memory_type as MemoryType;
    const key = input.key as string | undefined;

    try {
      // If a key is provided, save as core fact (always in context)
      if (key) {
        const category = memoryType === "preference" ? "preference"
          : memoryType === "entity" ? "entity"
          : "context";
        await upsertCoreFact(key, content, category as CoreFact["category"], "user");
      }

      // Always save as semantic memory (searchable)
      let embedding: number[] | undefined;
      try {
        embedding = await generateEmbedding(content);
      } catch {
        // Continue without embedding
      }

      const importance = memoryType === "correction" ? 0.9
        : memoryType === "preference" ? 0.8
        : 0.6;

      await createMemory({
        content,
        memoryType,
        embedding,
        importance,
      });

      return `Remembered: "${content}" (type: ${memoryType}${key ? `, key: ${key}` : ""})`;
    } catch (err) {
      return `Error saving memory: ${err}`;
    }
  },
};
