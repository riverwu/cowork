import type { Tool } from "./types";
import { createArtifact } from "@/lib/db";

export const createArtifactSkill: Tool = {
  definition: {
    name: "create_artifact",
    description:
      `Create a structured output artifact that will be displayed in a dedicated view panel. Use this for:
- Reports and documents (Markdown format)
- Data tables (CSV or Markdown table format)
- Action lists and summaries

The artifact appears in a floating panel alongside the conversation, where the user can view, pin, expand, or download it. Don't use this for short inline responses — only for substantial, structured content that benefits from its own display area.`,
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title of the artifact",
        },
        content: {
          type: "string",
          description: "Content in Markdown format",
        },
        type: {
          type: "string",
          enum: ["report", "table", "action_list"],
          description: "Type of artifact: report (document), table (data), action_list (todos/checklist)",
        },
      },
      required: ["title", "content", "type"],
    },
  },

  async execute(input) {
    const title = input.title as string;
    const content = input.content as string;
    const type = input.type as "report" | "table" | "action_list";

    try {
      await createArtifact({ title, content, type });
      // Signal the agent loop to yield an artifact event
      return `__ARTIFACT__:${type}:${title}\n${content}`;
    } catch (err) {
      return `Error creating artifact: ${err}`;
    }
  },
};
