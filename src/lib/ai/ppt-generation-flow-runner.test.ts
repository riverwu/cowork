import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { LLMProvider, StreamParams } from "./providers/types";

const mocks = vi.hoisted(() => {
  const streamCalls: StreamParams[] = [];
  const state = {
    deckPath: "/tmp/ppt-flow/deck.json",
    outputPath: "/tmp/ppt-flow/deck.pptx",
    workingDirectory: "/tmp/ppt-flow",
  };
  const tools: Record<string, {
    definition: { name: string; description: string; parameters: Record<string, unknown> };
    execute: (input: Record<string, unknown>) => Promise<string>;
  }> = {};
  const mockProvider: LLMProvider = {
    async *stream(params: StreamParams) {
      streamCalls.push(params);
      const step = streamCalls.length;
      const toolCall = (name: string, input: Record<string, unknown>) => ({
        id: `call-${step}-${name}`,
        name,
        input,
      });
      if (step === 1) {
        yield {
          type: "message-done",
          content: "",
          toolCalls: [toolCall("update_task_progress", {
            phase: "plan",
            status: "running",
            summary: "规划测试 deck",
            steps: [{ title: "规划", status: "running" }, { title: "生成", status: "pending" }],
          })],
          stopReason: "tool_use",
        };
        return;
      }
      if (step === 2) {
        yield {
          type: "message-done",
          content: "",
          toolCalls: [toolCall("read_file", { path: "/Users/river/.cowork/skills/slideml2/SKILL.md" })],
          stopReason: "tool_use",
        };
        return;
      }
      if (step === 3) {
        yield {
          type: "message-done",
          content: "",
          toolCalls: [toolCall("write_file", { path: "/tmp/ppt-flow/deck_plan.md", content: "# plan" })],
          stopReason: "tool_use",
        };
        return;
      }
      if (step === 4) {
        yield {
          type: "message-done",
          content: "",
          toolCalls: [toolCall("write_file", { path: `${state.workingDirectory}/deck-init.json`, content: JSON.stringify({ title: "Flow test", size: "16x9", theme: "default" }) })],
          stopReason: "tool_use",
        };
        return;
      }
      if (step === 5) {
        yield {
          type: "message-done",
          content: "",
          toolCalls: [toolCall("shell", {
            command: ["node", "/Users/river/.cowork/skills/slideml2/runtime/bin/slideml2.js", "init-deck", "deck-init.json"],
            cwd: state.workingDirectory,
          })],
          stopReason: "tool_use",
        };
        return;
      }
      if (step === 6 || step === 8) {
        yield {
          type: "message-done",
          content: "",
          toolCalls: [toolCall("write_file", {
            path: `${state.workingDirectory}/slides/0${step === 6 ? 1 : 2}.json`,
            content: JSON.stringify({ id: `s${step === 6 ? 1 : 2}`, title: `Slide ${step === 6 ? 1 : 2}`, children: [{ id: `s${step === 6 ? 1 : 2}.txt`, type: "text", text: "ok" }] }),
          })],
          stopReason: "tool_use",
        };
        return;
      }
      if (step === 7 || step === 9) {
        yield {
          type: "message-done",
          content: "",
          toolCalls: [toolCall("shell", {
            command: ["node", "/Users/river/.cowork/skills/slideml2/runtime/bin/slideml2.js", "validate-slide", `slides/0${step === 7 ? 1 : 2}.json`],
            cwd: state.workingDirectory,
          })],
          stopReason: "tool_use",
        };
        return;
      }
      if (step === 10) {
        yield {
          type: "message-done",
          content: "",
          toolCalls: [toolCall("write_file", {
            path: `${state.workingDirectory}/manifest.json`,
            content: JSON.stringify({ slides: [{ id: "s1", file: "slides/01.json" }, { id: "s2", file: "slides/02.json" }] }),
          })],
          stopReason: "tool_use",
        };
        return;
      }
      if (step === 11) {
        yield {
          type: "message-done",
          content: "",
          toolCalls: [toolCall("shell", {
            command: ["node", "/Users/river/.cowork/skills/slideml2/runtime/bin/slideml2.js", "validate-manifest", "manifest.json"],
            cwd: state.workingDirectory,
          })],
          stopReason: "tool_use",
        };
        return;
      }
      if (step === 12) {
        yield {
          type: "message-done",
          content: "",
          toolCalls: [toolCall("shell", {
            command: ["node", "/Users/river/.cowork/skills/slideml2/runtime/bin/slideml2.js", "compose", "manifest.json", "--write-source", "build/deck.json", "--out", state.outputPath],
            cwd: state.workingDirectory,
          })],
          stopReason: "tool_use",
        };
        return;
      }
      if (step === 13) {
        yield {
          type: "message-done",
          content: "",
          toolCalls: [toolCall("update_task_progress", {
            phase: "done",
            status: "done",
            summary: "PPT 已生成",
            steps: [{ title: "规划", status: "done" }, { title: "生成", status: "done" }],
            outputs: [{ title: "deck.pptx", path: state.outputPath, kind: "file" }],
          })],
          stopReason: "tool_use",
        };
        return;
      }
      yield {
        type: "message-done",
        content: `PPT 已生成: ${state.outputPath}`,
        toolCalls: [],
        stopReason: "end",
      };
    },
  };

  return { streamCalls, state, tools, mockProvider };
});

vi.mock("./providers", () => ({
  getConfiguredProvider: vi.fn().mockResolvedValue(mocks.mockProvider),
}));

vi.mock("./tools/registry", () => ({
  getTools: vi.fn().mockReturnValue(mocks.tools),
}));

vi.mock("./skill-registry", () => ({
  skillRegistry: {
    isLoaded: vi.fn().mockReturnValue(true),
    initialize: vi.fn(),
    getAvailableSkillsPrompt: vi.fn().mockReturnValue(""),
  },
}));

vi.mock("./skill-loader", () => ({
  getSkillsDir: vi.fn().mockResolvedValue("/Users/river/.cowork/skills"),
}));

vi.mock("@/lib/mcp", () => ({
  mcpManager: {
    waitForReady: vi.fn().mockResolvedValue(undefined),
    getAllTools: vi.fn().mockReturnValue({}),
    getServerStatus: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("@/lib/memory", () => ({
  retrieveMemoryContext: vi.fn().mockResolvedValue({ coreFacts: "", relevantMemories: "", relevantEpisodes: "" }),
  buildMemoryPrompt: vi.fn().mockReturnValue(""),
  extractMemories: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db", () => ({
  getSettings: vi.fn().mockResolvedValue({
    llmProvider: "anthropic",
    modelId: "claude-sonnet-4-20250514",
  }),
}));

import {
  analyzePptGenerationFlowImprovements,
  loadPptGenerationFlowCaseDirectory,
  runPptGenerationFlowCaseDirectory,
  runPptGenerationFlowScenario,
  summarizePptGenerationFlow,
  verifyPptGenerationFlow,
  writePptGenerationFlowImprovementReports,
  writePptGenerationFlowSuiteReports,
  writePptGenerationFlowValidationFailureScenes,
  type PptGenerationFlowResult,
  type PptGenerationFlowSuiteResult,
} from "./ppt-generation-flow-runner";

describe("ppt generation flow runner", () => {
  it("runs through the real runAgent loop and verifies a full deck workflow", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    mocks.state.deckPath = join(dir, "deck.json");
    mocks.state.outputPath = join(dir, "deck.pptx");
    mocks.state.workingDirectory = dir;
    mocks.streamCalls.length = 0;
    installMockTools();

    const result = await runPptGenerationFlowScenario({
      id: "mock-slide-deck",
      userPrompt: `生成一个 2 页测试 PPT，输出到 ${mocks.state.outputPath}`,
      workingDirectory: dir,
      expected: {
        requiredTools: ["read_file", "write_file", "shell", "init_deck", "validate_slide", "validate_manifest", "compose"],
        forbiddenTools: ["create_deck", "replace_slide", "validate_render", "run_node"],
        minValidateSlideCalls: 2,
        requireSlideml2SkillRead: true,
        requireFinalValidateRender: true,
        requireProgressDone: true,
        requirePptxOutput: true,
        outputPath: mocks.state.outputPath,
        maxBlockingDiagnostics: 0,
      },
    });
    const verification = await verifyPptGenerationFlow(result);

    expect(verification.ok, verification.failures.join("\n")).toBe(true);
    expect(result.summary.toolNames).toContain("compose");
    expect(result.summary.replaceSlideCount).toBe(2);
    expect(result.summary.finalText).toContain("PPT 已生成");
    expect(result.llmSends[0]?.system).toContain("Current working directory");
    expect(result.llmSends[0]?.tools.map((tool) => tool.name)).toContain("shell");
    expect(mocks.streamCalls).toHaveLength(14);
  });

  it("can verify required source JSON and emitted PPTX XML substrings", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-substrings-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const deckPath = join(dir, "deck.json");
    const outputPath = join(dir, "deck.pptx");
    const renderTreePath = join(dir, "deck.pptx.render-tree.json");
    await writeFile(deckPath, JSON.stringify({
      deck: { master: { placeholders: [{ type: "title", x: 1, y: 1, w: 10, h: 1 }] } },
      slides: [{ transition: { type: "fade" }, children: [{ type: "shape", preset: "straightConnector", tailEnd: { type: "triangle" } }] }],
    }));
    await writeFile(renderTreePath, JSON.stringify({ slides: [{ dom: { children: [{ text: "Quality checkpoint" }] } }] }));
    await writeFile(outputPath, makeStoredZip({
      "[Content_Types].xml": "<Types/>",
      "ppt/slides/slide1.xml": '<p:sld><p:transition/><a:tailEnd type="triangle"/><a:t>Quality checkpoint</a:t></p:sld>',
      "ppt/slideMasters/slideMaster1.xml": '<p:ph type="title"/>',
    }));

    const result: PptGenerationFlowResult = {
      scenario: { id: "substring-case", userPrompt: "Generate.", workingDirectory: dir },
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      events: [],
      monitorEvents: [],
      toolRecords: [{
        step: 1,
        name: "validate_render",
        toolCallId: "call-validate",
        input: { deckPath, outputPath, render: true },
        success: true,
        result: JSON.stringify({ ok: true, outputPath, domPath: renderTreePath, diagnostics: { blockingCount: 0 } }),
      }],
      llmSends: [],
      llmResponses: [],
      debugLogDirectory: null,
      summary: {
        toolNames: ["validate_render"],
        replaceSlideCount: 0,
        outputPaths: [outputPath],
        finalValidateRender: { ok: true, outputPath, domPath: renderTreePath, diagnostics: { blockingCount: 0 } },
        finalText: "",
        errors: [],
        progressEvents: [],
      },
    };

    const verification = await verifyPptGenerationFlow(result, {
      requireFinalValidateRender: true,
      requiredDeckJsonSubstrings: ["\"master\"", "\"transition\"", "\"straightConnector\""],
      requiredPptxXmlSubstrings: ["p:transition", "tailEnd type=\"triangle\"", "p:ph type=\"title\""],
      requiredPptxContentSubstrings: ["Quality checkpoint"],
    });

    expect(verification.ok, verification.failures.join("\n")).toBe(true);
  });

  it("recognizes SlideML2 runtime CLI shell calls as deck authoring tools", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-cli-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const deckPath = join(dir, "build/deck.json");
    const outputPath = join(dir, "deck.pptx");
    await mkdir(join(dir, "build"), { recursive: true });
    await writeFile(deckPath, JSON.stringify({ deck: {}, slides: [] }));
    await writeFile(outputPath, "fake pptx");

    const toolRecords = [
      shellCliRecord(1, "init-deck", join(dir, "deck-init.json"), { ok: true, stage: "commit", status: "ok", deckModified: true }),
      shellCliRecord(2, "validate-slide", join(dir, "slides/01-cover.json"), { ok: true, stage: "validate", status: "ok", deckModified: false }),
      shellCliRecord(3, "validate-manifest", join(dir, "manifest.json"), { ok: true, stage: "validate", status: "ok", deckModified: false }),
      shellCliRecord(4, "compose", join(dir, "manifest.json"), {
        ok: true,
        stage: "render",
        status: "ok",
        sourcePath: deckPath,
        outputPath,
        diagnostics: { blockingCount: 0, summary: {} },
      }, ["--write-source", deckPath, "--out", outputPath], dir),
    ];
    const summary = summarizePptGenerationFlow([], toolRecords);
    const result: PptGenerationFlowResult = {
      scenario: { id: "cli-case", userPrompt: "Generate.", workingDirectory: dir },
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      events: [],
      monitorEvents: [],
      toolRecords,
      llmSends: [],
      llmResponses: [],
      debugLogDirectory: null,
      summary,
    };

    expect(summary.toolNames).toEqual(expect.arrayContaining(["shell", "init_deck", "validate_slide", "validate_manifest", "compose"]));
    expect(summary.replaceSlideCount).toBe(1);
    expect(summary.finalValidateRender?.outputPath).toBe(outputPath);

    const verification = await verifyPptGenerationFlow(result, {
      requiredTools: ["init_deck", "validate_slide", "validate_manifest", "compose"],
      minReplaceSlideCalls: 1,
      requireFinalValidateRender: true,
      requirePptxOutput: true,
      outputPath,
      maxBlockingDiagnostics: 0,
      requiredDeckJsonSubstrings: ["\"slides\""],
    });

    expect(verification.ok, verification.failures.join("\n")).toBe(true);
  });

  it("treats SlideML2 shell ok:false payloads and non-zero exits as failed records", () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-cli-fail-${Date.now()}`);
    const toolRecords = [
      {
        ...shellCliRecord(1, "validate-slide", join(dir, "slides/01-cover.json"), {
          ok: false,
          status: "schema-error",
          error: "Slide validation failed.",
        }, [], dir),
        success: true,
        result: `${JSON.stringify({ ok: false, status: "schema-error", error: "Slide validation failed." }, null, 2)}\n\n[Exit code: 10]`,
      },
      shellCliRecord(2, "validate-slide", join(dir, "slides/02-market.json"), {
        ok: true,
        status: "ok",
      }, [], dir),
    ];

    const summary = summarizePptGenerationFlow([], toolRecords);
    expect(summary.replaceSlideCount).toBe(1);

    const result: PptGenerationFlowResult = {
      scenario: { id: "cli-fail-case", userPrompt: "Generate.", workingDirectory: dir },
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      events: [],
      monitorEvents: [],
      toolRecords,
      llmSends: [],
      llmResponses: [],
      debugLogDirectory: null,
      summary,
    };
    const analysis = analyzePptGenerationFlowImprovements(result, { ok: false, failures: ["failed"], summary });
    expect(analysis.summary.failedToolCalls).toBe(1);
    expect(analysis.blockingFailureSignals[0]?.message).toContain("Slide validation failed");
  });

  it("recovers final render summary when shell JSON is truncated", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-cli-truncated-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const outputPath = join(dir, "deck.pptx");
    const sourcePath = join(dir, "build/deck.json");
    await mkdir(join(dir, "build"), { recursive: true });
    await writeFile(outputPath, "fake pptx");
    await writeFile(sourcePath, JSON.stringify({ deck: {}, slides: [] }));
    await writeFile(`${outputPath}.diagnostics.json`, JSON.stringify([
      { severity: "warn", code: "TRUNCATED", slideId: "s1", nodeId: "s1.text" },
    ]));

    const toolRecords = [
      shellCliRecord(1, "validate-slide", join(dir, "slides/01-cover.json"), { ok: true, stage: "validate", status: "ok", deckModified: false }),
      {
        ...shellCliRecord(2, "compose", join(dir, "manifest.json"), { ok: true, stage: "render", status: "ok", sourcePath, outputPath, diagnostics: { blockingCount: 0 } }, ["--write-source", sourcePath, "--out", outputPath], dir),
        result: `{\n  "ok": true,\n  "stage": "render",\n  "status": "ok",\n  "sourcePath": ${JSON.stringify(sourcePath)},\n  "outputPath": ${JSON.stringify(outputPath)},\n  "diagnosticsPath": ${JSON.stringify(`${outputPath}.diagnostics.json`)},\n  "diagnostics": {\n    "count": 99,\n    "quality": [`,
      },
    ];
    const summary = summarizePptGenerationFlow([], toolRecords);
    const result: PptGenerationFlowResult = {
      scenario: { id: "cli-truncated-case", userPrompt: "Generate.", workingDirectory: dir },
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      events: [],
      monitorEvents: [],
      toolRecords,
      llmSends: [],
      llmResponses: [],
      debugLogDirectory: null,
      summary,
    };

    expect(summary.finalValidateRender?.outputPath).toBe(outputPath);
    expect((summary.finalValidateRender?.diagnostics as Record<string, unknown> | undefined)?.blockingCount).toBe(0);

    const verification = await verifyPptGenerationFlow(result, {
      requiredTools: ["validate_slide", "compose"],
      minReplaceSlideCalls: 1,
      requireFinalValidateRender: true,
      requirePptxOutput: true,
      outputPath,
      maxBlockingDiagnostics: 0,
    });

    expect(verification.ok, verification.failures.join("\n")).toBe(true);
  });

  it("records validate-slide failure scenes and judges capacity diagnostics against emitted PPTX geometry", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-failure-scene-${Date.now()}`);
    const slidesDir = join(dir, "slides");
    await mkdir(slidesDir, { recursive: true });
    const deckPath = join(dir, "deck-config.json");
    const slidePath = join(slidesDir, "01-overflow.json");
    const longText = "This sentence is intentionally long enough to overflow a tiny text box in the rendered slide. ".repeat(8);
    const slide = {
      id: "overflow_scene",
      title: "Overflow Scene",
      children: [{
        id: "overflow_scene.note",
        type: "text",
        text: longText,
        at: [1, 2, 4, 0.35],
        fontSize: 18,
      }],
    };
    await writeFile(deckPath, JSON.stringify({
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [],
    }, null, 2), "utf8");
    await writeFile(slidePath, JSON.stringify(slide, null, 2), "utf8");

    const runtime = await import("slideml2") as unknown as {
      clearRenderDiagnostics: () => void;
      getRenderDiagnostics: () => Array<Record<string, unknown>>;
      renderToAst: (deck: unknown) => unknown;
      sourceToRenderedDeck: (source: unknown, options?: unknown) => unknown;
    };
    runtime.clearRenderDiagnostics();
    runtime.renderToAst(runtime.sourceToRenderedDeck({
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [slide],
    }, { baseDir: dir }));
    const diagnostics = runtime.getRenderDiagnostics();
    runtime.clearRenderDiagnostics();
    const blocking = diagnostics.filter((item) => item.severity === "error");
    const quality = diagnostics.filter((item) => item.severity !== "error");
    const diagnosticSummary = diagnostics.reduce<Record<string, number>>((acc, item) => {
      const code = typeof item.code === "string" ? item.code : "UNKNOWN";
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {});
    expect(diagnosticSummary.FALLBACK_FAILED).toBeGreaterThan(0);

    const validatePayload = {
      ok: false,
      command: "validate-slide",
      stage: "validate",
      status: "render-error",
      deckModified: false,
      deckPath,
      slidePath,
      slide: { id: slide.id, title: slide.title },
      sourceValidation: { ok: true, errors: [], warnings: [], info: [] },
      validation: { ok: true, errors: [], warnings: [], info: [] },
      renderValidation: {
        ok: false,
        diagnostics: {
          count: diagnostics.length,
          summary: diagnosticSummary,
          blockingCount: blocking.length,
          blocking,
          qualityCount: quality.length,
          quality,
        },
      },
      diagnostics: {
        count: diagnostics.length,
        summary: diagnosticSummary,
        blockingCount: blocking.length,
        blocking,
        qualityCount: quality.length,
        quality,
      },
    };
    const toolRecords = [{
      ...shellCliRecord(1, "validate-slide", slidePath, validatePayload, ["--deck", deckPath], dir),
      success: false,
    }];
    const result: PptGenerationFlowResult = {
      scenario: { id: "failure-scene-case", userPrompt: "Generate.", workingDirectory: dir },
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      events: [],
      monitorEvents: [],
      toolRecords,
      llmSends: [],
      llmResponses: [],
      debugLogDirectory: null,
      summary: summarizePptGenerationFlow([], toolRecords),
    };

    const scenes = await writePptGenerationFlowValidationFailureScenes(join(dir, "reports", "validation-failure-scenes"), result);

    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.slideId).toBe("overflow_scene");
    expect(scenes[0]?.renderedPptxPath).toMatch(/rendered-slide\.pptx$/);
    expect(scenes[0]?.judgment.ok).toBe(true);
    expect(scenes[0]?.judgment.diagnosticCodes).toContain("FALLBACK_FAILED");
    expect(scenes[0]?.judgment.evidence.some((item) =>
      item.code === "FALLBACK_FAILED"
      && item.nodeId === "overflow_scene.note"
      && item.pptxShapeFound
      && item.confirmsCapacityFailure,
    )).toBe(true);
    const sceneJson = JSON.parse(await readFile(scenes[0]!.sceneJsonPath, "utf8")) as { judgment?: { ok?: boolean } };
    const capturedSlide = JSON.parse(await readFile(scenes[0]!.slideJsonPath!, "utf8")) as { id?: string };
    expect(sceneJson.judgment?.ok).toBe(true);
    expect(capturedSlide.id).toBe("overflow_scene");
  });

  it("records validate-slide overlap scenes and judges them against emitted PPTX geometry", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-failure-scene-overlap-${Date.now()}`);
    const slidesDir = join(dir, "slides");
    await mkdir(slidesDir, { recursive: true });
    const deckPath = join(dir, "deck-config.json");
    const slidePath = join(slidesDir, "01-overlap.json");
    const deck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default", brand: { primary: "2563EB" } },
      slides: [],
    };
    const slide = {
      id: "overlay_scene",
      layout: "freeform",
      children: [
        {
          id: "overlay_scene.body",
          type: "text",
          area: "content",
          text: "Readable flow text should not be covered by a foreground block.",
          style: "paragraph",
        },
        {
          id: "overlay_scene.blocker",
          type: "shape",
          at: [1.6, 2.4, 8, 1.6],
          fill: "FFFFFF",
          line: { color: "FFFFFF", width: 0 },
        },
      ],
    };
    await writeFile(deckPath, JSON.stringify(deck, null, 2), "utf8");
    await writeFile(slidePath, JSON.stringify(slide, null, 2), "utf8");

    const runtime = await import("slideml2") as unknown as {
      clearRenderDiagnostics: () => void;
      getRenderDiagnostics: () => Array<Record<string, unknown>>;
      renderToAst: (deck: unknown) => unknown;
      sourceToRenderedDeck: (source: unknown, options?: unknown) => unknown;
    };
    runtime.clearRenderDiagnostics();
    runtime.renderToAst(runtime.sourceToRenderedDeck({
      ...deck,
      slides: [slide],
    }, { baseDir: dir }));
    const diagnostics = runtime.getRenderDiagnostics();
    runtime.clearRenderDiagnostics();
    const blocking = diagnostics.filter((item) => item.severity === "error");
    const quality = diagnostics.filter((item) => item.severity !== "error");
    const diagnosticSummary = diagnostics.reduce<Record<string, number>>((acc, item) => {
      const code = typeof item.code === "string" ? item.code : "UNKNOWN";
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {});
    expect(diagnosticSummary.OVERLAY_OCCLUDES_FLOW).toBeGreaterThan(0);

    const validatePayload = {
      ok: false,
      command: "validate-slide",
      stage: "validate",
      status: "render-error",
      deckModified: false,
      deckPath,
      slidePath,
      slide: { id: slide.id },
      diagnostics: {
        count: diagnostics.length,
        summary: diagnosticSummary,
        blockingCount: blocking.length,
        blocking,
        qualityCount: quality.length,
        quality,
      },
    };
    const toolRecords = [{
      ...shellCliRecord(1, "validate-slide", slidePath, validatePayload, ["--deck", deckPath], dir),
      success: false,
    }];
    const result: PptGenerationFlowResult = {
      scenario: { id: "failure-scene-overlap-case", userPrompt: "Generate.", workingDirectory: dir },
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      events: [],
      monitorEvents: [],
      toolRecords,
      llmSends: [],
      llmResponses: [],
      debugLogDirectory: null,
      summary: summarizePptGenerationFlow([], toolRecords),
    };

    const scenes = await writePptGenerationFlowValidationFailureScenes(join(dir, "reports", "validation-failure-scenes"), result);

    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.slideId).toBe("overlay_scene");
    expect(scenes[0]?.judgment.ok).toBe(true);
    expect(scenes[0]?.judgment.diagnosticCodes).toContain("OVERLAY_OCCLUDES_FLOW");
    expect(scenes[0]?.judgment.evidence.some((item) =>
      item.code === "OVERLAY_OCCLUDES_FLOW"
      && item.nodeId === "overlay_scene.blocker"
      && item.pptxShapeFound
      && item.otherPptxShapeFound
      && item.confirmsVisualOverlap,
    )).toBe(true);
  });

  it("confirms TINY_RECT scenes when the failing node was skipped from the PPTX", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-failure-scene-tiny-${Date.now()}`);
    const slidesDir = join(dir, "slides");
    await mkdir(slidesDir, { recursive: true });
    const deckPath = join(dir, "deck-config.json");
    const slidePath = join(slidesDir, "01-tiny.json");
    const deck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        themeOverride: { layout: { titleTop: 0.5, titleHeight: 0, contentTop: 1.0, contentBottom: 13.0 } },
      },
      slides: [],
    };
    const slide = {
      id: "tiny_scene",
      title: "Metadata Title",
      children: [{ type: "text", text: "Rendered body stays visible.", area: "content" }],
    };
    await writeFile(deckPath, JSON.stringify(deck, null, 2), "utf8");
    await writeFile(slidePath, JSON.stringify(slide, null, 2), "utf8");
    const tinyDiagnostic = {
      severity: "error",
      code: "TINY_RECT",
      slideId: "tiny_scene",
      nodeId: "tiny_scene.title",
      message: "Node assigned an unrenderable rect 23.8x0.00cm; rendering skipped.",
      measured: { rect: { x: 1, y: 0.5, w: 23.8, h: 0 } },
    };
    const validatePayload = {
      ok: false,
      command: "validate-slide",
      stage: "validate",
      status: "render-error",
      deckModified: false,
      deckPath,
      slidePath,
      slide: { id: slide.id, title: slide.title },
      diagnostics: {
        count: 1,
        summary: { TINY_RECT: 1 },
        blockingCount: 1,
        blocking: [tinyDiagnostic],
        qualityCount: 0,
        quality: [],
      },
    };
    const toolRecords = [{
      ...shellCliRecord(1, "validate-slide", slidePath, validatePayload, ["--deck", deckPath], dir),
      success: false,
    }];
    const result: PptGenerationFlowResult = {
      scenario: { id: "failure-scene-tiny-case", userPrompt: "Generate.", workingDirectory: dir },
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      events: [],
      monitorEvents: [],
      toolRecords,
      llmSends: [],
      llmResponses: [],
      debugLogDirectory: null,
      summary: summarizePptGenerationFlow([], toolRecords),
    };

    const scenes = await writePptGenerationFlowValidationFailureScenes(join(dir, "reports", "validation-failure-scenes"), result);

    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.judgment.ok).toBe(true);
    expect(scenes[0]?.judgment.evidence.some((item) =>
      item.code === "TINY_RECT"
      && item.nodeId === "tiny_scene.title"
      && !item.pptxShapeFound
      && item.confirmsCapacityFailure,
    )).toBe(true);
  });

  it("matches descendant PPTX shapes for parent container capacity diagnostics", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-failure-scene-descendant-${Date.now()}`);
    const slidesDir = join(dir, "slides");
    await mkdir(slidesDir, { recursive: true });
    const deckPath = join(dir, "deck-config.json");
    const slidePath = join(slidesDir, "01-parent.json");
    const deck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [],
    };
    const slide = {
      id: "parent_scene",
      children: [{
        id: "parent_scene.box",
        type: "stack",
        at: [1, 1, 5, 0.8],
        children: [{ id: "parent_scene.box.child", type: "text", text: "Container child", style: "paragraph" }],
      }],
    };
    await writeFile(deckPath, JSON.stringify(deck, null, 2), "utf8");
    await writeFile(slidePath, JSON.stringify(slide, null, 2), "utf8");
    const diagnostic = {
      severity: "error",
      code: "FALLBACK_FAILED",
      slideId: "parent_scene",
      nodeId: "parent_scene.box",
      message: "Container parent_scene.box cannot fit its children.",
      measured: { available: 0.8, needed: 1.3, deltaCm: 0.5 },
    };
    const validatePayload = {
      ok: false,
      command: "validate-slide",
      stage: "validate",
      status: "render-error",
      deckModified: false,
      deckPath,
      slidePath,
      slide: { id: slide.id },
      diagnostics: {
        count: 1,
        summary: { FALLBACK_FAILED: 1 },
        blockingCount: 1,
        blocking: [diagnostic],
        qualityCount: 0,
        quality: [],
      },
    };
    const toolRecords = [{
      ...shellCliRecord(1, "validate-slide", slidePath, validatePayload, ["--deck", deckPath], dir),
      success: false,
    }];
    const result: PptGenerationFlowResult = {
      scenario: { id: "failure-scene-descendant-case", userPrompt: "Generate.", workingDirectory: dir },
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      events: [],
      monitorEvents: [],
      toolRecords,
      llmSends: [],
      llmResponses: [],
      debugLogDirectory: null,
      summary: summarizePptGenerationFlow([], toolRecords),
    };

    const scenes = await writePptGenerationFlowValidationFailureScenes(join(dir, "reports", "validation-failure-scenes"), result);

    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.judgment.ok).toBe(true);
    expect(scenes[0]?.judgment.evidence.some((item) =>
      item.code === "FALLBACK_FAILED"
      && item.nodeId === "parent_scene.box"
      && item.pptxShapeMatch === "descendant"
      && item.pptxShapeFound
      && item.confirmsCapacityFailure,
    )).toBe(true);
  });

  it("uses captured validate-slide snapshots instead of rereading repaired slide files", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-failure-scene-snapshot-${Date.now()}`);
    const slidesDir = join(dir, "slides");
    await mkdir(slidesDir, { recursive: true });
    const deckPath = join(dir, "deck-config.json");
    const slidePath = join(slidesDir, "01-snapshot.json");
    const deck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [],
    };
    const failingSlide = {
      id: "snapshot_scene",
      title: "Snapshot Scene",
      children: [{
        id: "snapshot_scene.note",
        type: "text",
        text: "This failing version should be captured before the slide file is repaired. ".repeat(8),
        at: [1, 2, 4, 0.35],
        fontSize: 18,
      }],
    };
    const repairedSlide = {
      id: "snapshot_scene",
      title: "Snapshot Scene",
      children: [{
        id: "snapshot_scene.note",
        type: "text",
        text: "Repaired version.",
        at: [1, 2, 4, 1.5],
        fontSize: 18,
      }],
    };
    await writeFile(deckPath, JSON.stringify(deck, null, 2), "utf8");
    await writeFile(slidePath, JSON.stringify(failingSlide, null, 2), "utf8");

    const runtime = await import("slideml2") as unknown as {
      clearRenderDiagnostics: () => void;
      getRenderDiagnostics: () => Array<Record<string, unknown>>;
      renderToAst: (deck: unknown) => unknown;
      sourceToRenderedDeck: (source: unknown, options?: unknown) => unknown;
    };
    runtime.clearRenderDiagnostics();
    runtime.renderToAst(runtime.sourceToRenderedDeck({
      ...deck,
      slides: [failingSlide],
    }, { baseDir: dir }));
    const diagnostics = runtime.getRenderDiagnostics();
    runtime.clearRenderDiagnostics();
    const blocking = diagnostics.filter((item) => item.severity === "error");
    const quality = diagnostics.filter((item) => item.severity !== "error");
    const diagnosticSummary = diagnostics.reduce<Record<string, number>>((acc, item) => {
      const code = typeof item.code === "string" ? item.code : "UNKNOWN";
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {});
    expect(diagnosticSummary.FALLBACK_FAILED).toBeGreaterThan(0);

    const validatePayload = {
      ok: false,
      command: "validate-slide",
      stage: "validate",
      status: "render-error",
      deckModified: false,
      deckPath,
      slidePath,
      slide: { id: failingSlide.id, title: failingSlide.title },
      sourceValidation: { ok: true, errors: [], warnings: [], info: [] },
      validation: { ok: true, errors: [], warnings: [], info: [] },
      renderValidation: {
        ok: false,
        diagnostics: {
          count: diagnostics.length,
          summary: diagnosticSummary,
          blockingCount: blocking.length,
          blocking,
          qualityCount: quality.length,
          quality,
        },
      },
      diagnostics: {
        count: diagnostics.length,
        summary: diagnosticSummary,
        blockingCount: blocking.length,
        blocking,
        qualityCount: quality.length,
        quality,
      },
    };
    await writeFile(slidePath, JSON.stringify(repairedSlide, null, 2), "utf8");
    const toolRecords = [{
      ...shellCliRecord(1, "validate-slide", slidePath, validatePayload, ["--deck", deckPath], dir),
      success: false,
      validationFailureSnapshot: {
        capturedAt: 1,
        slidePath,
        deckPath,
        slide: failingSlide,
        deck,
      },
    }];
    const result: PptGenerationFlowResult = {
      scenario: { id: "failure-scene-snapshot-case", userPrompt: "Generate.", workingDirectory: dir },
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      events: [],
      monitorEvents: [],
      toolRecords,
      llmSends: [],
      llmResponses: [],
      debugLogDirectory: null,
      summary: summarizePptGenerationFlow([], toolRecords),
    };

    const scenes = await writePptGenerationFlowValidationFailureScenes(join(dir, "reports", "validation-failure-scenes"), result);

    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.deckJsonPath).toMatch(/deck\.json$/);
    expect(scenes[0]?.judgment.ok).toBe(true);
    const capturedSlide = JSON.parse(await readFile(scenes[0]!.slideJsonPath!, "utf8")) as typeof failingSlide;
    expect(capturedSlide.children[0]?.text).toBe(failingSlide.children[0]!.text);
    expect(capturedSlide.children[0]?.text).not.toBe(repairedSlide.children[0]!.text);
  });

  it("judges validate-slide capacity diagnostics even when render capture emits unrelated warnings", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-failure-scene-merge-${Date.now()}`);
    const slidesDir = join(dir, "slides");
    await mkdir(slidesDir, { recursive: true });
    const deckPath = join(dir, "deck-config.json");
    const slidePath = join(slidesDir, "01-squashed.json");
    const slide = {
      id: "diag_scene",
      title: "Diag Scene",
      children: [{
        id: "diag_scene.note",
        type: "text",
        text: "low contrast warning text",
        at: [1, 2, 5, 1.5],
        fontSize: 12,
        color: "#F59E0B",
      }],
    };
    await writeFile(deckPath, JSON.stringify({
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [],
    }, null, 2), "utf8");
    await writeFile(slidePath, JSON.stringify(slide, null, 2), "utf8");

    const squashedDiagnostic = {
      severity: "error",
      code: "SQUASHED",
      slideId: "diag_scene",
      nodeId: "diag_scene.note.wrap",
      measured: {
        rect: { x: 1, y: 2, w: 5, h: 1.5 },
        minHeightCm: 1.8,
      },
    };
    const validatePayload = {
      ok: false,
      command: "validate-slide",
      stage: "validate",
      status: "render-error",
      deckModified: false,
      deckPath,
      slidePath,
      slide: { id: slide.id, title: slide.title },
      sourceValidation: { ok: true, errors: [], warnings: [], info: [] },
      validation: { ok: true, errors: [], warnings: [], info: [] },
      renderValidation: {
        ok: false,
        diagnostics: {
          count: 1,
          summary: { SQUASHED: 1 },
          blockingCount: 1,
          blocking: [squashedDiagnostic],
          qualityCount: 1,
          quality: [squashedDiagnostic],
        },
      },
      diagnostics: {
        count: 1,
        summary: { SQUASHED: 1 },
        blockingCount: 1,
        blocking: [squashedDiagnostic],
        qualityCount: 1,
        quality: [squashedDiagnostic],
      },
    };
    const toolRecords = [{
      ...shellCliRecord(1, "validate-slide", slidePath, validatePayload, ["--deck", deckPath], dir),
      success: false,
    }];
    const result: PptGenerationFlowResult = {
      scenario: { id: "failure-scene-merge-case", userPrompt: "Generate.", workingDirectory: dir },
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      events: [],
      monitorEvents: [],
      toolRecords,
      llmSends: [],
      llmResponses: [],
      debugLogDirectory: null,
      summary: summarizePptGenerationFlow([], toolRecords),
    };

    const scenes = await writePptGenerationFlowValidationFailureScenes(join(dir, "reports", "validation-failure-scenes"), result);

    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.judgment.ok).toBe(true);
    expect(scenes[0]?.judgment.diagnosticCodes).toContain("SQUASHED");
    expect(scenes[0]?.judgment.evidence.some((item) =>
      item.code === "SQUASHED"
      && item.nodeId === "diag_scene.note.wrap"
      && item.pptxShapeName === "diag_scene.note"
      && item.pptxShapeMatch === "geometry"
      && item.pptxShapeFound
      && item.confirmsCapacityFailure,
    )).toBe(true);
  });

  it("loads a directory case, runs it, and writes complete reports under reports/", async () => {
    const caseDir = join(tmpdir(), `cowork-ppt-flow-case-${Date.now()}`);
    await mkdir(join(caseDir, "inputs"), { recursive: true });
    await writeFile(join(caseDir, "inputs", "brief.md"), "# Brief\nUse data cards, formulas, and code blocks.");
    await writeFile(join(caseDir, "prompt.md"), [
      "生成一个覆盖最新 SlideML2 component 的测试 PPT。",
      "读取输入文件：{{inputsDir}}/brief.md。",
      "最终 PPTX 必须输出到：{{outputPath}}。",
    ].join("\n"));
    await writeFile(join(caseDir, "case.json"), JSON.stringify({
      id: "directory-component-coverage",
      expected: {
        requiredTools: ["read_file", "write_file", "shell", "init_deck", "validate_slide", "validate_manifest", "compose"],
        forbiddenTools: ["create_deck", "replace_slide", "validate_render", "run_node"],
        minValidateSlideCalls: 2,
        requireSlideml2SkillRead: true,
        requireFinalValidateRender: true,
        requireProgressDone: true,
        requirePptxOutput: true,
        outputPath: "outputs/deck.pptx",
        maxBlockingDiagnostics: 0,
      },
    }, null, 2));

    const loaded = await loadPptGenerationFlowCaseDirectory(caseDir);
    expect(loaded.scenario.workingDirectory).toBe(caseDir);
    expect(loaded.scenario.userPrompt).toContain(join(caseDir, "inputs", "brief.md"));
    expect(loaded.scenario.userPrompt).toContain(join(caseDir, "outputs", "deck.pptx"));

    mocks.state.deckPath = join(caseDir, "outputs", "deck.json");
    mocks.state.outputPath = join(caseDir, "outputs", "deck.pptx");
    mocks.state.workingDirectory = caseDir;
    mocks.streamCalls.length = 0;
    installMockTools();

    const run = await runPptGenerationFlowCaseDirectory(caseDir);
    expect(run.verification.ok, run.verification.failures.join("\n")).toBe(true);
    expect(run.reportDirectory.startsWith(join(caseDir, "reports"))).toBe(true);

    const markdownReport = await readFile(run.markdownReportPath, "utf8");
    const jsonReport = JSON.parse(await readFile(run.jsonReportPath, "utf8")) as { case?: { id?: string } };
    const improvementReport = await readFile(run.improvementCandidatesPath, "utf8");
    const failureAnalysis = JSON.parse(await readFile(run.failureAnalysisPath, "utf8")) as { caseId?: string; summary?: { improvementCandidates?: number } };
    expect(markdownReport).toContain("PPT Generation Flow Report: PASS");
    expect(markdownReport).toContain("## Tool Timeline");
    expect(jsonReport.case?.id).toBe("directory-component-coverage");
    expect(improvementReport).toContain("PPT Flow Improvement Candidates: directory-component-coverage");
    expect(failureAnalysis.caseId).toBe("directory-component-coverage");
    expect(failureAnalysis.summary?.improvementCandidates).toBe(0);
  });

  it("analyzes failed and recovered tool calls into improvement candidates", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-analysis-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const result: PptGenerationFlowResult = {
      scenario: {
        id: "analysis-case",
        userPrompt: "Generate a deck.",
        workingDirectory: dir,
      },
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      events: [],
      monitorEvents: [],
      toolRecords: [
        {
          step: 1,
          name: "replace_slide",
          toolCallId: "call-1",
          input: {
            slide: {
              id: "s1",
              children: [{ id: "s1.callout", type: "callout", variant: "panel", tone: "info" }],
            },
          },
          success: false,
          result: [
            "Slide write rejected; deck file was not modified. Slide validation failed with 2 error(s).",
            "schemaOk=false schemaErrors=2",
            "schemaErrorsDetail=[",
            "  {\"code\":\"INVALID_FIELD_USAGE\",\"path\":\"children[0].variant\",\"message\":\"callout.variant must be one of: plain, card, banner. Got \\\"panel\\\".\"},",
            "  {\"code\":\"INVALID_FIELD_USAGE\",\"path\":\"children[0].tone\",\"message\":\"callout.tone must be one of: neutral, brand, positive, warning, danger. Got \\\"info\\\".\"}",
            "]",
          ].join("\n"),
        },
        {
          step: 2,
          name: "replace_slide",
          toolCallId: "call-2",
          input: {
            slide: {
              id: "s2",
              children: [{ id: "s2.flow", type: "process-flow", steps: [{ title: "A", bullets: ["Long bullet"] }] }],
            },
          },
          success: true,
          result: "Slide inserted. Per-slide validation passed: schemaOk=true schemaErrors=0 renderBlocking=0 quality=2 summary={\"DROP\":1,\"TRUNCATED\":1}",
        },
      ],
      llmSends: [],
      llmResponses: [],
      debugLogDirectory: null,
      summary: {
        toolNames: ["replace_slide", "replace_slide"],
        replaceSlideCount: 1,
        outputPaths: [],
        finalText: "",
        errors: [],
        progressEvents: [],
        finalValidateRender: {
          ok: true,
          diagnostics: {
            blockingCount: 0,
            summary: { PARTIAL_UNUSED_GENERATED_ICON_ASSETS: 1 },
            quality: [{ code: "PARTIAL_UNUSED_GENERATED_ICON_ASSETS", message: "unused generated icon" }],
          },
        },
      },
    };
    const verification = await verifyPptGenerationFlow(result, { requireFinalValidateRender: false });
    const analysis = analyzePptGenerationFlowImprovements(result, verification);
    expect(analysis.summary.failedToolCalls).toBe(1);
    expect(analysis.summary.recoveredFrictionSignals).toBe(1);
    expect(analysis.summary.finalQualitySignals).toBe(1);
    expect(analysis.candidates.map((item) => item.category)).toContain("schema-interface");
    expect(analysis.candidates.map((item) => item.category)).toContain("component-process-flow");
    expect(analysis.candidates.map((item) => item.category)).toContain("asset-workflow");

    const failurePath = join(dir, "failure-analysis.json");
    const improvementPath = join(dir, "improvement-candidates.md");
    await writePptGenerationFlowImprovementReports(failurePath, improvementPath, analysis);
    expect(await readFile(improvementPath, "utf8")).toContain("Recovered friction matters");
  });

  it("ignores passive successful reads and classifies generic bullet overflow as capacity", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-classify-${Date.now()}`);
    const result: PptGenerationFlowResult = {
      scenario: {
        id: "classify-case",
        userPrompt: "Generate a deck.",
        workingDirectory: dir,
      },
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      events: [],
      monitorEvents: [],
      toolRecords: [
        {
          step: 1,
          name: "read_file",
          toolCallId: "call-read",
          success: true,
          result: "READ_FILE_RESULT path: SKILL.md contains fallback, manifest, generated icons, and DROP guidance.",
        },
        {
          step: 2,
          name: "replace_slide",
          toolCallId: "call-bullets",
          input: {
            slide: {
              id: "s1",
              children: [{ id: "s1.list", type: "bullets", items: ["A long point", "Another long point"] }],
            },
          },
          success: false,
          result: [
            "Slide write rejected; deck file was not modified. Slide render validation failed with 1 blocking diagnostic(s).",
            "summary={\"FALLBACK_FAILED\":1,\"OVERFLOW\":1}",
            "Bullets 's1.list' need 3.20cm but were assigned 1.20cm.",
          ].join("\n"),
        },
      ],
      llmSends: [],
      llmResponses: [],
      debugLogDirectory: null,
      summary: {
        toolNames: ["read_file", "replace_slide"],
        replaceSlideCount: 0,
        outputPaths: [],
        finalText: "",
        errors: [],
        progressEvents: [],
      },
    };

    const verification = await verifyPptGenerationFlow(result, { requireFinalValidateRender: false });
    const analysis = analyzePptGenerationFlowImprovements(result, verification);
    const categories = analysis.candidates.map((item) => item.category);

    expect(analysis.summary.recoveredFrictionSignals).toBe(0);
    expect(categories).toContain("component-capacity");
    expect(categories).not.toContain("asset-workflow");
    expect(categories).not.toContain("component-process-flow");
  });

  it("reports planned component omissions as soft degradation signals", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-plan-degrade-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const deckPath = join(dir, "outputs", "deck.json");
    await mkdir(join(dir, "outputs"), { recursive: true });
    await writeFile(deckPath, JSON.stringify({
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "channel_analysis",
        title: "渠道效率分析",
        children: [{ id: "s5.table", type: "table-card", rows: [["渠道", "ROI"]] }],
      }],
    }));
    const result: PptGenerationFlowResult = {
      scenario: {
        id: "plan-degrade-case",
        userPrompt: "Generate a deck.",
        workingDirectory: dir,
      },
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      events: [],
      monitorEvents: [],
      toolRecords: [{
        step: 1,
        name: "write_file",
        toolCallId: "call-plan",
        success: true,
        input: {
          path: join(dir, "deck_plan.md"),
          content: [
            "| # | slide id | job | primary component |",
            "|---|---|---|---|",
            "| 5 | channel_analysis | 渠道效率分析 | table-card + bar-list |",
          ].join("\n"),
        },
        result: "File written successfully",
      }],
      llmSends: [],
      llmResponses: [],
      debugLogDirectory: null,
      summary: {
        toolNames: ["write_file"],
        replaceSlideCount: 0,
        outputPaths: [deckPath],
        finalText: "",
        errors: [],
        progressEvents: [],
      },
    };

    const verification = await verifyPptGenerationFlow(result, { requireFinalValidateRender: false });
    const analysis = analyzePptGenerationFlowImprovements(result, verification);
    const signal = analysis.recoveredFrictionSignals.find((item) => item.category === "component-selection-degradation");

    expect(signal?.diagnosticCodes).toContain("PLANNED_COMPONENT_OMITTED");
    expect(signal?.componentTypes).toContain("bar-list");
    expect(analysis.candidates.map((item) => item.category)).toContain("component-selection-degradation");
  });

  it("reports generated image assets that are not referenced by the final deck", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-unused-asset-${Date.now()}`);
    const runDir = join(dir, ".cowork-runs", "run_1");
    const asset1 = join(runDir, "assets", "imgs", "used.png");
    const asset2 = join(runDir, "assets", "imgs", "unused.png");
    const deckPath = join(runDir, "deck.json");
    await mkdir(join(runDir, "assets", "imgs"), { recursive: true });
    await writeFile(deckPath, JSON.stringify({
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "s1",
        children: [{ id: "s1.img", type: "image-card", src: asset1 }],
      }],
    }));
    const result: PptGenerationFlowResult = {
      scenario: {
        id: "unused-asset-case",
        userPrompt: "Generate a deck.",
        workingDirectory: dir,
      },
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      events: [],
      monitorEvents: [],
      toolRecords: [{
        step: 1,
        name: "image_gen",
        toolCallId: "call-img",
        success: true,
        result: `Image generated and saved to ${asset1}\nImage generated and saved to ${asset2}`,
      }],
      llmSends: [],
      llmResponses: [],
      debugLogDirectory: null,
      summary: {
        toolNames: ["image_gen"],
        replaceSlideCount: 0,
        outputPaths: [deckPath],
        finalText: "",
        errors: [],
        progressEvents: [],
      },
    };

    const verification = await verifyPptGenerationFlow(result, { requireFinalValidateRender: false });
    const analysis = analyzePptGenerationFlowImprovements(result, verification);
    const signal = analysis.recoveredFrictionSignals.find((item) => item.diagnosticCodes.includes("UNUSED_GENERATED_ASSET"));

    expect(signal?.category).toBe("asset-workflow");
    expect(signal?.evidence).toContain("unused.png");
  });

  it("aggregates case improvement candidates into a suite-level improvement plan", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-suite-${Date.now()}`);
    const suite: PptGenerationFlowSuiteResult = {
      rootDirectory: dir,
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      caseCount: 1,
      passCount: 1,
      failCount: 0,
      cases: [{
        id: "youdao-company-profile",
        caseDirectory: join(dir, "youdao-company-profile"),
        ok: true,
        durationMs: 100,
        outputPaths: [join(dir, "deck.pptx")],
        failures: [],
        firstRunIssue: "step 6 | replace_slide | schema-interface | feature-card.tone success was repaired",
        improvementCandidateCount: 1,
        recoveredFrictionCount: 2,
        improvementCandidatesPath: join(dir, "case-plan.md"),
        improvementCandidates: [{
          id: "ppt-flow-1-schema-interface",
          priority: "P0",
          category: "schema-interface",
          title: "Normalize schema vocabulary and repair guidance",
          affectedTools: ["replace_slide"],
          affectedComponents: ["feature-card"],
          evidence: ["step 6 | replace_slide | feature-card.tone success was repaired"],
          proposedFix: "Align schema aliases, validation messages, and SKILL examples.",
          tests: ["Add schema tests for canonical and accepted alias values."],
        }],
      }],
    };

    const out = await writePptGenerationFlowSuiteReports(dir, suite);
    const summaryMarkdown = await readFile(out.markdownPath, "utf8");
    const markdown = await readFile(out.improvementPlanPath, "utf8");
    expect(summaryMarkdown).toContain("First run issue");
    expect(summaryMarkdown).toContain("feature-card.tone success");
    expect(markdown).toContain("Aggregated Improvement Candidates");
    expect(markdown).toContain("First run issue");
    expect(markdown).toContain("Normalize schema vocabulary");
    expect(markdown).toContain("youdao-company-profile");
    expect(markdown).toContain("feature-card.tone success");
  });
});

function installMockTools(): void {
  mocks.tools.update_task_progress = {
    definition: { name: "update_task_progress", description: "progress", parameters: { type: "object", properties: {} } },
    execute: vi.fn(async (input) => `__TASK_PROGRESS__:${JSON.stringify({
      runId: "run_test",
      workspaceDir: "/tmp/ppt-flow",
      phase: String(input.phase || "unknown"),
      status: input.status === "done" ? "done" : "running",
      summary: String(input.summary || ""),
      steps: Array.isArray(input.steps) ? input.steps : [],
      outputs: Array.isArray(input.outputs) ? input.outputs : [],
      updatedAt: 1,
    })}`),
  };
  mocks.tools.read_file = {
    definition: { name: "read_file", description: "read", parameters: { type: "object", properties: {} } },
    execute: vi.fn().mockResolvedValue("# SlideML2 Deck Authoring Skill\nUse replace_slide and validate_render."),
  };
  mocks.tools.write_file = {
    definition: { name: "write_file", description: "write", parameters: { type: "object", properties: {} } },
    execute: vi.fn().mockResolvedValue("File written."),
  };
  mocks.tools.shell = {
    definition: { name: "shell", description: "shell", parameters: { type: "object", properties: {} } },
    execute: vi.fn(async (input: Record<string, unknown>) => {
      const command = Array.isArray(input.command) ? input.command.filter((item): item is string => typeof item === "string") : [];
      const cwd = typeof input.cwd === "string" ? input.cwd : mocks.state.workingDirectory;
      const subcommand = command.find((item) => ["init-deck", "validate-slide", "validate-manifest", "compose"].includes(item));
      if (subcommand === "compose") {
        const outIndex = command.indexOf("--out");
        const sourceIndex = command.indexOf("--write-source");
        const outputPath = outIndex >= 0 && command[outIndex + 1] ? command[outIndex + 1]! : mocks.state.outputPath;
        const sourcePath = sourceIndex >= 0 && command[sourceIndex + 1] ? join(cwd, command[sourceIndex + 1]!) : join(cwd, "build/deck.json");
        await mkdir(dirname(sourcePath), { recursive: true });
        await writeFile(sourcePath, JSON.stringify({ deck: {}, slides: [{ id: "s1" }, { id: "s2" }] }));
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, "fake pptx");
        return JSON.stringify({
          ok: true,
          stage: "render",
          status: "ok",
          sourcePath,
          outputPath,
          diagnostics: { count: 0, summary: {}, blockingCount: 0, blocking: [], qualityCount: 0, quality: [] },
        });
      }
      return JSON.stringify({ ok: true, stage: subcommand === "init-deck" ? "commit" : "validate", status: "ok", deckModified: subcommand === "init-deck" });
    }),
  };
  mocks.tools.create_deck = {
    definition: { name: "create_deck", description: "create", parameters: { type: "object", properties: {} } },
    execute: vi.fn().mockResolvedValue(`Deck created at ${mocks.state.deckPath}. Add slides one at a time via replace_slide.`),
  };
  mocks.tools.replace_slide = {
    definition: { name: "replace_slide", description: "replace", parameters: { type: "object", properties: {} } },
    execute: vi.fn().mockResolvedValue("Slide inserted at index 0. slideCount=1.\nPer-slide validation passed: schemaOk=true schemaErrors=0 renderBlocking=0 quality=0"),
  };
  mocks.tools.validate_render = {
    definition: { name: "validate_render", description: "validate", parameters: { type: "object", properties: {} } },
    execute: vi.fn(async () => {
      await writeFile(mocks.state.outputPath, "fake pptx");
      return JSON.stringify({
        ok: true,
        outputPath: mocks.state.outputPath,
        domPath: `${mocks.state.outputPath}.render-tree.json`,
        diagnosticsPath: `${mocks.state.outputPath}.diagnostics.json`,
        validation: { ok: true, errors: [] },
        diagnostics: { count: 0, summary: {}, blockingCount: 0, blocking: [], qualityCount: 0, quality: [] },
      });
    }),
  };
}

function shellCliRecord(
  step: number,
  subcommand: "init-deck" | "set-deck" | "validate-slide" | "validate-manifest" | "compose",
  argsPath: string | undefined,
  result: Record<string, unknown>,
  extraArgs: string[] = [],
  cwdOverride?: string,
) {
  const cwd = cwdOverride || (argsPath ? dirname(argsPath) : tmpdir());
  return {
    step,
    name: "shell",
    toolCallId: `call-shell-${step}`,
    input: {
      command: ["node", "/Users/river/.cowork/skills/slideml2/runtime/bin/slideml2.js", subcommand, ...(argsPath ? [argsPath] : []), ...extraArgs],
      cwd,
    },
    success: true,
    result: JSON.stringify(result),
  };
}

function makeStoredZip(entries: Record<string, string>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(text);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + data.length;
  }
  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...localParts, central, end]);
}
