import type { Tool } from "./types";
import { webFetch } from "@/lib/tauri";

export const webFetchSkill: Tool = {
  definition: {
    name: "web_fetch",
    description:
      "Fetch a web page and return its text content. HTML tags are stripped automatically. Use this to read articles, documentation, blog posts, or any web page. Note: may not work well on JavaScript-heavy single-page apps — for those, use browser-use MCP if available.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to fetch",
        },
      },
      required: ["url"],
    },
  },

  async execute(input) {
    const url = input.url as string;
    try {
      const result = await webFetch(url);
      if (result.status !== 200) {
        return `HTTP ${result.status} for ${url}`;
      }
      if (!result.text || result.text.trim().length === 0) {
        return `Page at ${url} returned empty content (may be JavaScript-rendered).`;
      }
      return `Content from ${url}:\n\n${result.text}`;
    } catch (err) {
      return `Failed to fetch ${url}: ${err}`;
    }
  },
};
