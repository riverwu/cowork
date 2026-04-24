import type { Tool } from "./types";

export const generateReport: Tool = {
  definition: {
    name: "generate_report",
    description:
      "Generate a structured report in Markdown format. Use this to create formatted output documents like analysis reports, summaries, or briefs. The report will be displayed to the user as a formatted artifact.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Report title",
        },
        content: {
          type: "string",
          description: "The full report content in Markdown format",
        },
        audience: {
          type: "string",
          description: "Who this report is for (e.g., 'management', 'technical team')",
        },
      },
      required: ["title", "content"],
    },
  },

  async execute(input) {
    const title = input.title as string;
    const content = input.content as string;
    const audience = input.audience as string | undefined;

    // The report content is returned to the LLM, and separately
    // the agent loop will create an Artifact for the UI to display.
    // We use a special marker so the agent loop knows to extract it.
    const report = [
      `# ${title}`,
      audience ? `*Prepared for: ${audience}*` : "",
      "",
      content,
    ]
      .filter(Boolean)
      .join("\n");

    return `__ARTIFACT__:report:${title}\n${report}`;
  },
};
