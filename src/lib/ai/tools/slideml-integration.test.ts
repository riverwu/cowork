/**
 * Integration test — every SlideML cowork tool's `execute()` is wired
 * to the right IPC command with the right argument shape.
 *
 * This sits between the per-tool unit tests (which verify input
 * validation) and the real-LLM e2e harness (which exercises the
 * actual agent loop). It catches the kind of drift that would slip
 * past both: e.g. a tool sending `{ slidemlYaml }` when IPC expects
 * `{ slideml }`, or returning the wrong shape so the next tool can't
 * consume it.
 *
 * Strategy: mock `@tauri-apps/api/core`'s `invoke` to capture every
 * call. Run the slideml tool's `execute()` with realistic inputs.
 * Assert the captured IPC call has the contract we expect.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the desktop bridges BEFORE importing the tools (the tools
// transitively import `@/lib/tauri` which captures `invoke` at import
// time via `electronBridge()` / `invoke`). We mock both surfaces.
const ipcCalls: Array<{ command: string; args?: unknown }> = [];
const ipcReturns: Record<string, unknown> = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    ipcCalls.push({ command, args });
    if (command in ipcReturns) return ipcReturns[command];
    throw new Error(`mock invoke: no return value configured for "${command}"`);
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ startDragging: vi.fn() }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

// Force tauri runtime detection so invokeDesktop uses the mocked invoke.
beforeEach(() => {
  ipcCalls.length = 0;
  for (const k of Object.keys(ipcReturns)) delete ipcReturns[k];
  // @ts-expect-error — synthesize the Tauri marker the bridge looks for.
  globalThis.window = { __TAURI_INTERNALS__: {} };
});

import { getTool } from "./registry";

describe("SlideML cowork integration — tool↔IPC contract", () => {
  it("list_themes — invokes slideml_list_themes, returns JSON", async () => {
    ipcReturns["slideml_list_themes"] = [
      { name: "technical-blue", displayName: "Technical Blue", description: "...", source: "builtin", rootDir: "/x" },
    ];
    const tool = getTool("list_themes")!;
    const out = await tool.execute({});
    expect(ipcCalls).toEqual([{ command: "slideml_list_themes", args: undefined }]);
    expect(JSON.parse(out)).toHaveLength(1);
  });

  it("list_slide_pagepatterns — returns built-in pattern catalog without IPC", async () => {
    const tool = getTool("list_slide_pagepatterns")!;
    const out = await tool.execute({});
    expect(ipcCalls).toEqual([]);
    expect(JSON.parse(out).some((p: { name?: string }) => p.name === "main-plus-sidebar")).toBe(true);
  });

  it("describe_slide_pagepattern — returns one pattern detail without IPC", async () => {
    const tool = getTool("describe_slide_pagepattern")!;
    const out = await tool.execute({ name: "two-column" });
    expect(ipcCalls).toEqual([]);
    expect(JSON.parse(out)).toMatchObject({ name: "two-column", regions: ["left", "right"] });
  });

  it("list_content_components — passes theme arg through", async () => {
    ipcReturns["slideml_list_layouts"] = [
      { name: "cover", purpose: "Title slide", requiredSlots: ["title"], optionalSlots: ["subtitle"] },
    ];
    const tool = getTool("list_content_components")!;
    await tool.execute({ theme: "editorial-warm" });
    expect(ipcCalls[0]).toEqual({ command: "slideml_list_layouts", args: { theme: "editorial-warm" } });
  });

  it("describe_content_component — passes name + theme", async () => {
    ipcReturns["slideml_describe_layout"] = { name: "cover", description: "...", slotSchema: {}, thumbnailPath: "/x" };
    const tool = getTool("describe_content_component")!;
    await tool.execute({ name: "cover", theme: "midnight-executive" });
    expect(ipcCalls[0]).toEqual({
      command: "slideml_describe_layout",
      args: { layoutName: "cover", theme: "midnight-executive" },
    });
  });

  it("validate_slideml — passes slideml body (JSON inline)", async () => {
    ipcReturns["slideml_validate"] = { ok: true };
    const tool = getTool("validate_slideml")!;
    const out = await tool.execute({ slideml: JSON.stringify({ slideml: 1, deck: { size: "16x9", theme: "technical-blue" }, slides: [] }) });
    expect(ipcCalls[0]?.command).toBe("slideml_validate");
    expect(out).toMatch(/OK/);
  });

  it("render_slideml — IPC call includes outputPath; result mentions sidecar", async () => {
    ipcReturns["slideml_compile"] = { outputPath: "/tmp/x.pptx", sidecar: "/tmp/x.pptx.slideml" };
    const tool = getTool("render_slideml")!;
    const out = await tool.execute({
      slideml: JSON.stringify({
        slideml: 1,
        deck: { size: "16x9", theme: "technical-blue" },
        slides: [{ pattern: "single-focus", regions: { main: { component: "cover", props: { title: "hi" } } } }],
      }),
      output_path: "/tmp/x.pptx",
    });
    expect(ipcCalls[0]?.command).toBe("slideml_compile");
    expect(ipcCalls[0]?.args).toMatchObject({ outputPath: "/tmp/x.pptx", theme: "technical-blue" });
    expect(out).toContain("/tmp/x.pptx");
    expect(out).toContain(".slideml");      // sidecar path discoverable
    expect(out).toContain("edit_slideml");  // suggests next-step tool
  });

  it("validate_slideml — rejects YAML inline body with clear error", async () => {
    const tool = getTool("validate_slideml")!;
    const out = await tool.execute({ slideml: "slideml: 1\ndeck: { size: 16x9, theme: technical-blue }\nslides: []" });
    expect(out).toMatch(/JSON/);
    expect(out).toMatch(/must start with `\{`/);
  });

  it("render_slideml — rejects YAML inline body with clear error", async () => {
    const tool = getTool("render_slideml")!;
    const out = await tool.execute({
      slideml: "slideml: 1\ndeck: { theme: t }\nslides: []",
      output_path: "/tmp/x.pptx",
    });
    expect(out).toMatch(/JSON/);
    expect(out).toMatch(/must start with `\{`/);
  });

  it("edit_slideml — accepts ops as a JSON-encoded STRING (lenient form)", async () => {
    // Real-LLM regression: large nested ops arrays sometimes arrive as a
    // JSON string instead of an array. Tool auto-parses.
    ipcReturns["read_file_text"] = JSON.stringify({
      slideml: 1,
      deck: { size: "16x9", theme: "technical-blue" },
      slides: [],
    });
    ipcReturns["slideml_edit"] = { outputPath: "/tmp/z.pptx", sidecar: "/tmp/z.pptx.slideml" };
    const tool = getTool("edit_slideml")!;
    const opsStr = JSON.stringify([
      { kind: "set", path: "slides[0].regions.main.props.title", value: "from-string" },
    ]);
    const result = await tool.execute({ sidecar_path: "/tmp/z.pptx.slideml", ops: opsStr, output_path: "/tmp/z.pptx" });
    expect(result).not.toContain("Error");
    expect(ipcCalls[1]?.args).toMatchObject({
      sidecarPath: "/tmp/z.pptx.slideml",
      outputPath: "/tmp/z.pptx",
    });
    // The IPC layer received a real array, not the original string.
    const sentOps = (ipcCalls[1]!.args as { ops?: unknown }).ops;
    expect(Array.isArray(sentOps)).toBe(true);
  });

  it("edit_slideml — passes ops as a JSON array", async () => {
    ipcReturns["read_file_text"] = JSON.stringify({
      slideml: 1,
      deck: { size: "16x9", theme: "editorial-warm" },
      slides: [],
    });
    ipcReturns["slideml_edit"] = { outputPath: "/tmp/y.pptx", sidecar: "/tmp/y.pptx.slideml" };
    const tool = getTool("edit_slideml")!;
    const ops = [{ kind: "set", path: "slides[0].regions.main.props.title", value: "new" }];
    await tool.execute({ sidecar_path: "/tmp/y.pptx.slideml", ops, output_path: "/tmp/y.pptx" });
    expect(ipcCalls[0]).toEqual({
      command: "read_file_text",
      args: { path: "/tmp/y.pptx.slideml" },
    });
    expect(ipcCalls[1]?.command).toBe("slideml_edit");
    expect(ipcCalls[1]?.args).toMatchObject({
      sidecarPath: "/tmp/y.pptx.slideml",
      outputPath: "/tmp/y.pptx",
      theme: "editorial-warm",
      ops,
    });
  });

  it("audit_pptx — text format gives one-liner; json format gives raw report", async () => {
    const report = {
      ok: true,
      path: "/tmp/x.pptx",
      stats: { slides: 5, parts: 30, media: 2, charts: 1, notesSlides: 0 },
      issues: [],
    };
    ipcReturns["slideml_audit"] = report;
    const tool = getTool("audit_pptx")!;
    const text = await tool.execute({ path: "/tmp/x.pptx" });
    expect(text).toContain("✓ OK");
    expect(text).toContain("5 slides");
    ipcCalls.length = 0;
    ipcReturns["slideml_audit"] = report;
    const json = await tool.execute({ path: "/tmp/x.pptx", format: "json" });
    expect(JSON.parse(json)).toMatchObject(report);
  });

  it("audit_pptx — failures render with error markers", async () => {
    ipcReturns["slideml_audit"] = {
      ok: false,
      path: "/tmp/bad.pptx",
      stats: { slides: 1, parts: 10, media: 0, charts: 0, notesSlides: 0 },
      issues: [{ severity: "error", code: "REL_TARGET_MISSING", message: "rId2 missing" }],
    };
    const tool = getTool("audit_pptx")!;
    const out = await tool.execute({ path: "/tmp/bad.pptx" });
    expect(out).toContain("✗ FAIL");
    expect(out).toContain("[REL_TARGET_MISSING]");
  });
});
