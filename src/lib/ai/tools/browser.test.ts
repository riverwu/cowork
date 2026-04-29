import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  browserAction: vi.fn(),
}));

import { browserAction } from "@/lib/tauri";
import { browserTool } from "./browser";

const mockBrowserAction = vi.mocked(browserAction);

function browserActionEnum(): string[] {
  const params = browserTool.definition.parameters as {
    properties: {
      actions: {
        items: {
          properties: {
            action: { enum: string[] };
          };
        };
      };
    };
  };
  return params.properties.actions.items.properties.action.enum;
}

describe("browser tool", () => {
  beforeEach(() => {
    mockBrowserAction.mockReset();
  });

  it("exposes actions for common browser automation scenarios", () => {
    expect(browserActionEnum()).toEqual(expect.arrayContaining([
      "open",
      "snapshot",
      "extract",
      "inspect",
      "read",
      "grep",
      "show",
      "hide",
      "reload",
      "tabs",
      "new_tab",
      "switch_tab",
      "close_tab",
      "click",
      "hover",
      "dblclick",
      "rightclick",
      "type",
      "select",
      "upload",
      "check",
      "uncheck",
      "clear",
      "press",
      "scroll",
      "back",
      "wait_for_change",
      "screenshot",
      "pdf",
      "downloads",
      "cookies",
      "storage",
      "diagnostics",
      "evaluate",
      "close",
    ]));
  });

  it("requires non-empty actions", async () => {
    const result = await browserTool.execute({ actions: [] });

    expect(result).toContain("requires a non-empty actions array");
    expect(mockBrowserAction).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "SPA navigation and focused extraction",
      actions: [
        { action: "open", url: "https://ir.youdao.com", timeout_ms: 30000 },
        { action: "extract", query: "company profile financial", max_items: 12 },
      ],
    },
    {
      name: "large page search and segmented reading",
      actions: [
        { action: "grep", pattern: "Financial", source: "html", max_matches: 10, context_chars: 80 },
        { action: "read", source: "text", offset: 6000, max_chars: 3000 },
        { action: "read", source: "links", max_chars: 5000 },
      ],
    },
    {
      name: "visible login handoff",
      actions: [
        { action: "open", url: "https://example.com/login", headed: true },
        { action: "show" },
        { action: "wait_for_change", timeout_ms: 30000 },
        { action: "hide" },
        { action: "snapshot" },
      ],
    },
    {
      name: "form filling with upload and keyboard submit",
      actions: [
        { action: "type", ref: 3, text: "river@example.com" },
        { action: "select", ref: 4, value: "enterprise" },
        { action: "upload", ref: 5, path: "/Users/river/Documents/Workspace/report.pdf" },
        { action: "check", ref: 6 },
        { action: "press", ref: 7, key: "Enter" },
      ],
    },
    {
      name: "tab management and artifacts",
      actions: [
        { action: "new_tab", url: "https://example.com/report" },
        { action: "tabs" },
        { action: "screenshot", ref: 8, path: "/tmp/card.png" },
        { action: "pdf", path: "/tmp/page.pdf", format: "A4" },
        { action: "downloads" },
      ],
    },
    {
      name: "state debugging",
      actions: [
        { action: "cookies", operation: "get" },
        { action: "storage", operation: "get", area: "local" },
        { action: "diagnostics", limit: 25 },
        { action: "evaluate", code: "return document.title", max_chars: 1000 },
      ],
    },
  ])("forwards $name actions unchanged", async ({ actions }) => {
    mockBrowserAction.mockResolvedValue([{ action: "ok", result: { url: "https://example.com" } }]);

    const result = await browserTool.execute({ actions });

    expect(mockBrowserAction).toHaveBeenCalledWith(actions);
    expect(JSON.parse(result)).toEqual([{ action: "ok", result: { url: "https://example.com" } }]);
  });

  it("returns a readable failure instead of throwing", async () => {
    mockBrowserAction.mockRejectedValue(new Error("STALE_REF: call snapshot again"));

    const result = await browserTool.execute({ actions: [{ action: "click", ref: 9 }] });

    expect(result).toBe("Browser failed: STALE_REF: call snapshot again");
  });

  it("summarizes screenshot and pdf artifacts by path", () => {
    const screenshot = browserTool.historySummarizer?.(
      JSON.stringify([{ action: "screenshot", result: { path: "/tmp/page.png" } }]),
      "ok",
    );
    const pdf = browserTool.historySummarizer?.(
      JSON.stringify([{ action: "pdf", result: { path: "/tmp/page.pdf" } }]),
      "ok",
    );

    expect(screenshot).toBe("browser screenshot: file /tmp/page.png");
    expect(pdf).toBe("browser pdf: file /tmp/page.pdf");
  });

  it("summarizes downloaded files by path", () => {
    const summary = browserTool.historySummarizer?.(
      JSON.stringify([{ action: "downloads", result: { downloads: [{ path: "/tmp/report.pdf" }] } }]),
      "ok",
    );

    expect(summary).toBe("browser downloads: /tmp/report.pdf");
  });

  it("summarizes navigation results by title and URL", () => {
    const summary = browserTool.historySummarizer?.(
      JSON.stringify([{ action: "open", result: { title: "Example", url: "https://example.com" } }]),
      "ok",
    );

    expect(summary).toBe("browser open: Example https://example.com");
  });
});
