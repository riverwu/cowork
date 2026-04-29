import type { Tool } from "./types";
import { browserAction, type BrowserAction } from "@/lib/tauri";

export const browserTool: Tool = {
  definition: {
    name: "browser",
    description:
      `Control Cowork's built-in Playwright browser. Use this for JavaScript-rendered pages, authenticated pages, visual checks, and page interaction. ` +
      `Pass an actions[] array. Use open/navigate or snapshot to get structured page facts: real links include href, absoluteUrl, pathname, and hash. ` +
      `Use extract to pull focused page facts from the current structured snapshot, inspect to read local structure around one ref, and wait_for_change after actions that trigger async updates. ` +
      `Use show when the user needs to login in a visible controlled browser; use hide to return to background mode. ` +
      `Click/type/select/upload/check/hover only with ref values returned by the latest snapshot. Do not guess selectors, wait text, or synthesize URLs; use snapshot links and refs.`,
    parameters: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          description: "Browser actions to run sequentially. Page-changing actions stop the remaining sequence.",
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: [
                  "open", "navigate", "snapshot", "state", "extract", "inspect",
                  "show", "hide", "reload", "tabs", "new_tab", "switch_tab", "close_tab",
                  "click", "hover", "dblclick", "rightclick", "type", "select", "upload", "check", "uncheck", "clear", "press",
                  "scroll", "back", "wait_for_change", "get_url", "screenshot", "pdf", "downloads", "cookies", "storage", "diagnostics", "evaluate", "close",
                ],
                description: "Action name. open/navigate automatically returns a snapshot.",
              },
              url: {
                type: "string",
                description: "open/navigate: URL to load. Prefer exact absoluteUrl from snapshot links for in-page navigation.",
              },
              headed: {
                type: "boolean",
                description: "open/navigate: set true only when the user needs to see/login/debug in a visible controlled browser.",
              },
              ref: {
                type: "number",
                description: "inspect/click/hover/dblclick/rightclick/type/select/upload/check/uncheck/clear/press/screenshot: element ref from the latest snapshot.",
              },
              text: {
                type: "string",
                description: "type: text to fill into a textbox/input ref.",
              },
              query: {
                type: "string",
                description: "extract: optional keyword query used to rank sections, links, and controls from the current page snapshot.",
              },
              max_items: {
                type: "number",
                description: "extract: maximum sections/links to return, default 24.",
              },
              max_chars: {
                type: "number",
                description: "inspect: maximum outerHTML characters to return for one ref, default 2000.",
              },
              value: {
                type: "string",
                description: "select/cookies set: option value or cookie value.",
              },
              paths: {
                type: "array",
                items: { type: "string" },
                description: "upload: file paths to set on a file input ref.",
              },
              index: {
                type: "number",
                description: "switch_tab/close_tab: zero-based tab index.",
              },
              operation: {
                type: "string",
                enum: ["get", "set", "clear", "export", "import"],
                description: "cookies/storage: operation, default get. storage supports get/set/clear.",
              },
              name: {
                type: "string",
                description: "cookies set: cookie name.",
              },
              domain: {
                type: "string",
                description: "cookies set: optional cookie domain.",
              },
              key: {
                type: "string",
                description: "press: key name such as Enter, Escape, Tab. storage: storage key.",
              },
              keys: {
                type: "string",
                description: "press: alias for key.",
              },
              direction: {
                type: "string",
                enum: ["up", "down"],
                description: "scroll direction, default down.",
              },
              pages: {
                type: "number",
                description: "scroll pages, default 1.",
              },
              path: {
                type: "string",
                description: "screenshot/pdf/cookies export/import/upload: file path.",
              },
              full_page: {
                type: "boolean",
                description: "screenshot: capture full page when true.",
              },
              print_background: {
                type: "boolean",
                description: "pdf: print backgrounds, default true.",
              },
              format: {
                type: "string",
                description: "pdf: page format such as A4 or Letter.",
              },
              limit: {
                type: "number",
                description: "diagnostics: maximum console/network entries to return.",
              },
              area: {
                type: "string",
                enum: ["local", "session"],
                description: "storage: localStorage or sessionStorage, default local.",
              },
              code: {
                type: "string",
                description: "evaluate: advanced page-context JavaScript body. Use only when snapshot/inspect/ref actions cannot express the needed operation.",
              },
              timeout_ms: {
                type: "number",
                description: "open/navigate/wait_for_change: timeout in milliseconds.",
              },
            },
            required: ["action"],
          },
        },
      },
      required: ["actions"],
    },
  },

  async execute(input) {
    const actions = input.actions as BrowserAction[] | undefined;
    if (!Array.isArray(actions) || actions.length === 0) {
      return `Error: browser requires a non-empty actions array. Example: {"actions":[{"action":"open","url":"https://example.com"}]}`;
    }

    try {
      const result = await browserAction(actions);
      return JSON.stringify(result, null, 2);
    } catch (err) {
      return `Browser failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },

  historySummarizer(raw, status) {
    if (status === "fail") return raw;
    try {
      const parsed = JSON.parse(raw) as Array<{ action?: string; result?: unknown }>;
      const last = parsed[parsed.length - 1];
      const result = last?.result as { url?: string; title?: string; stats?: Record<string, unknown>; path?: string; downloads?: Array<{ path?: string }> } | undefined;
      if (result?.path) return `browser ${last?.action || ""}: file ${result.path}`;
      if (Array.isArray(result?.downloads)) {
        const paths = result.downloads.map((download) => download.path).filter(Boolean);
        return paths.length > 0 ? `browser downloads: ${paths.join(", ")}` : "browser downloads: none";
      }
      if (result?.url || result?.title) return `browser ${last?.action || ""}: ${result.title || ""} ${result.url || ""}`.trim();
      return `browser: ${parsed.map((r) => r.action).filter(Boolean).join(" -> ")}`;
    } catch {
      return raw.slice(0, 300);
    }
  },
};
