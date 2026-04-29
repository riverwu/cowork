import type { Tool } from "./types";
import { webFetch } from "@/lib/tauri";

export const webFetchSkill: Tool = {
  definition: {
    name: "web_fetch",
    description:
      "Fetch a web page and return its text content. HTML tags are stripped automatically. Use this for static articles, documentation, blogs, and simple pages. For JavaScript-rendered pages, authenticated pages, visual checks, or when you need real links/buttons/page structure, use the built-in browser tool instead.",
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
