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
          toolCalls: [toolCall("create_deck", { deckPath: state.deckPath, title: "Flow test" })],
          stopReason: "tool_use",
        };
        return;
      }
      if (step === 5 || step === 6) {
        yield {
          type: "message-done",
          content: "",
          toolCalls: [toolCall("replace_slide", {
            deckPath: state.deckPath,
            slideId: step - 5,
            slide: { id: `s${step - 4}`, title: `Slide ${step - 4}`, children: [{ id: `s${step - 4}.txt`, type: "text", text: "ok" }] },
          })],
          stopReason: "tool_use",
        };
        return;
      }
      if (step === 7) {
        yield {
          type: "message-done",
          content: "",
          toolCalls: [toolCall("validate_render", { deckPath: state.deckPath, outputPath: state.outputPath, render: true })],
          stopReason: "tool_use",
        };
        return;
      }
      if (step === 8) {
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
  type PptGenerationFlowResult,
  type PptGenerationFlowSuiteResult,
} from "./ppt-generation-flow-runner";

describe("ppt generation flow runner", () => {
  it("runs through the real runAgent loop and verifies a full deck workflow", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    mocks.state.deckPath = join(dir, "deck.json");
    mocks.state.outputPath = join(dir, "deck.pptx");
    mocks.streamCalls.length = 0;
    installMockTools();

    const result = await runPptGenerationFlowScenario({
      id: "mock-slide-deck",
      userPrompt: `生成一个 2 页测试 PPT，输出到 ${mocks.state.outputPath}`,
      workingDirectory: dir,
      expected: {
        requiredTools: ["read_file", "write_file", "create_deck", "replace_slide", "validate_render"],
        forbiddenTools: ["run_node"],
        minReplaceSlideCalls: 2,
        requireFinalValidateRender: true,
        requireProgressDone: true,
        requirePptxOutput: true,
        outputPath: mocks.state.outputPath,
        maxBlockingDiagnostics: 0,
      },
    });
    const verification = await verifyPptGenerationFlow(result);

    expect(verification.ok, verification.failures.join("\n")).toBe(true);
    expect(result.summary.toolNames).toContain("validate_render");
    expect(result.summary.replaceSlideCount).toBe(2);
    expect(result.summary.finalText).toContain("PPT 已生成");
    expect(result.llmSends[0]?.system).toContain("Current working directory");
    expect(result.llmSends[0]?.tools.map((tool) => tool.name)).toContain("validate_render");
    expect(mocks.streamCalls).toHaveLength(9);
  });

  it("can verify required source JSON and emitted PPTX XML substrings", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-substrings-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const deckPath = join(dir, "deck.json");
    const outputPath = join(dir, "deck.pptx");
    await writeFile(deckPath, JSON.stringify({
      deck: { master: { placeholders: [{ type: "title", x: 1, y: 1, w: 10, h: 1 }] } },
      slides: [{ transition: { type: "fade" }, children: [{ type: "shape", preset: "straightConnector", tailEnd: { type: "triangle" } }] }],
    }));
    await writeFile(outputPath, makeStoredZip({
      "[Content_Types].xml": "<Types/>",
      "ppt/slides/slide1.xml": '<p:sld><p:transition/><a:tailEnd type="triangle"/></p:sld>',
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
        result: JSON.stringify({ ok: true, outputPath, diagnostics: { blockingCount: 0 } }),
      }],
      llmSends: [],
      llmResponses: [],
      debugLogDirectory: null,
      summary: {
        toolNames: ["validate_render"],
        replaceSlideCount: 0,
        outputPaths: [outputPath],
        finalValidateRender: { ok: true, outputPath, diagnostics: { blockingCount: 0 } },
        finalText: "",
        errors: [],
        progressEvents: [],
      },
    };

    const verification = await verifyPptGenerationFlow(result, {
      requireFinalValidateRender: true,
      requiredDeckJsonSubstrings: ["\"master\"", "\"transition\"", "\"straightConnector\""],
      requiredPptxXmlSubstrings: ["p:transition", "tailEnd type=\"triangle\"", "p:ph type=\"title\""],
    });

    expect(verification.ok, verification.failures.join("\n")).toBe(true);
  });

  it("recognizes SlideML2 runtime CLI shell calls as deck authoring tools", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-cli-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const deckPath = join(dir, "deck.json");
    const outputPath = join(dir, "deck.pptx");
    const validateArgsPath = join(dir, "validate-render.json");
    await writeFile(deckPath, JSON.stringify({ deck: {}, slides: [] }));
    await writeFile(outputPath, "fake pptx");
    await writeFile(validateArgsPath, JSON.stringify({ render: true, outputPath }));

    const toolRecords = [
      shellCliRecord(1, "create-deck", join(dir, "create-deck.json"), { ok: true, phase: "committed", deckModified: true }),
      shellCliRecord(2, "replace-slide", join(dir, "slide-01.json"), { ok: true, phase: "committed", deckModified: true, insertedAt: 0 }),
      shellCliRecord(3, "validate-render", validateArgsPath, {
        ok: true,
        phase: "rendered",
        outputPath,
        diagnostics: { blockingCount: 0, summary: {} },
      }),
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

    expect(summary.toolNames).toEqual(expect.arrayContaining(["shell", "create_deck", "replace_slide", "validate_render"]));
    expect(summary.replaceSlideCount).toBe(1);
    expect(summary.finalValidateRender?.outputPath).toBe(outputPath);

    const verification = await verifyPptGenerationFlow(result, {
      requiredTools: ["create_deck", "replace_slide", "validate_render"],
      minReplaceSlideCalls: 1,
      requireFinalValidateRender: true,
      requirePptxOutput: true,
      outputPath,
      maxBlockingDiagnostics: 0,
      requiredDeckJsonSubstrings: ["\"slides\""],
    });

    expect(verification.ok, verification.failures.join("\n")).toBe(true);
  });

  it("recovers final validate-render summary when shell JSON is truncated", async () => {
    const dir = join(tmpdir(), `cowork-ppt-flow-cli-truncated-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const outputPath = join(dir, "deck.pptx");
    const validateArgsPath = join(dir, "validate-render.json");
    await writeFile(outputPath, "fake pptx");
    await writeFile(`${outputPath}.diagnostics.json`, JSON.stringify([
      { severity: "warn", code: "TRUNCATED", slideId: "s1", nodeId: "s1.text" },
    ]));
    await writeFile(validateArgsPath, JSON.stringify({ render: true, outputPath }));

    const toolRecords = [
      shellCliRecord(1, "replace-slide", join(dir, "slide-01.json"), { ok: true, phase: "committed", deckModified: true, insertedAt: 0 }),
      {
        ...shellCliRecord(2, "validate-render", validateArgsPath, { ok: true, phase: "rendered", outputPath, diagnostics: { blockingCount: 0 } }),
        result: `{\n  "ok": true,\n  "phase": "rendered",\n  "outputPath": ${JSON.stringify(outputPath)},\n  "diagnosticsPath": ${JSON.stringify(`${outputPath}.diagnostics.json`)},\n  "diagnostics": {\n    "count": 99,\n    "quality": [`,
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
      requiredTools: ["replace_slide", "validate_render"],
      minReplaceSlideCalls: 1,
      requireFinalValidateRender: true,
      requirePptxOutput: true,
      outputPath,
      maxBlockingDiagnostics: 0,
    });

    expect(verification.ok, verification.failures.join("\n")).toBe(true);
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
        requiredTools: ["read_file", "write_file", "create_deck", "replace_slide", "validate_render"],
        forbiddenTools: ["run_node"],
        minReplaceSlideCalls: 2,
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
  subcommand: "create-deck" | "replace-slide" | "validate-render",
  argsPath: string,
  result: Record<string, unknown>,
) {
  return {
    step,
    name: "shell",
    toolCallId: `call-shell-${step}`,
    input: {
      command: ["node", "/Users/river/.cowork/skills/slideml2/runtime/bin/slideml2.js", subcommand, argsPath],
      cwd: dirname(argsPath),
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
