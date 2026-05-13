import * as nodePath from "node:path";
import * as nodeFs from "node:fs";
import { inflateRawSync } from "node:zlib";
import { runAgent, type ActiveSkill, type ContextManifest } from "./agent";
import { DebugLogger } from "./debug-log";
import type { LLMMessage, ToolCall, ToolDefinition } from "./providers/types";
import type { AgentEvent } from "@/types";

export interface PptGenerationFlowScenario {
  id: string;
  userPrompt: string;
  workingDirectory: string;
  sessionId?: string;
  taskId?: string;
  planMode?: boolean;
  taskMode?: ContextManifest["taskMode"];
  memoryPolicy?: ContextManifest["memoryPolicy"];
  activeSkills?: ActiveSkill[];
  desktopDebugLog?: boolean;
  expected?: PptGenerationFlowExpectations;
}

export interface PptGenerationFlowCaseConfig extends Partial<Omit<PptGenerationFlowScenario, "id" | "userPrompt" | "workingDirectory" | "expected">> {
  id?: string;
  promptPath?: string;
  userPrompt?: string;
  workingDirectory?: string;
  inputsDirectory?: string;
  outputsDirectory?: string;
  reportsDirectory?: string;
  expected?: PptGenerationFlowExpectations;
}

export interface PptGenerationFlowCase {
  id: string;
  caseDirectory: string;
  promptPath: string | null;
  inputsDirectory: string;
  outputsDirectory: string;
  reportsDirectory: string;
  scenario: PptGenerationFlowScenario;
}

export interface PptGenerationFlowCaseRun {
  caseDefinition: PptGenerationFlowCase;
  result: PptGenerationFlowResult;
  verification: PptGenerationFlowVerification;
  reportDirectory: string;
  jsonReportPath: string;
  markdownReportPath: string;
  failureAnalysisPath: string;
  improvementCandidatesPath: string;
  improvementAnalysis: PptGenerationFlowImprovementAnalysis;
}

export interface PptGenerationFlowSuiteCaseResult {
  id: string;
  caseDirectory: string;
  ok: boolean;
  durationMs: number;
  reportDirectory?: string;
  jsonReportPath?: string;
  markdownReportPath?: string;
  failureAnalysisPath?: string;
  improvementCandidatesPath?: string;
  debugLogDirectory?: string | null;
  outputPaths: string[];
  failures: string[];
  firstRunIssue?: string;
  improvementCandidateCount?: number;
  recoveredFrictionCount?: number;
  improvementAnalysisSummary?: PptGenerationFlowImprovementAnalysis["summary"];
  improvementCandidates?: PptGenerationFlowImprovementCandidate[];
  error?: string;
}

export interface PptGenerationFlowSuiteResult {
  rootDirectory: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  caseCount: number;
  passCount: number;
  failCount: number;
  cases: PptGenerationFlowSuiteCaseResult[];
}

export interface PptGenerationFlowExpectations {
  requiredTools?: string[];
  forbiddenTools?: string[];
  minReplaceSlideCalls?: number;
  requireProgressDone?: boolean;
  requireFinalValidateRender?: boolean;
  requirePptxOutput?: boolean;
  outputPath?: string;
  maxBlockingDiagnostics?: number;
  requiredDeckJsonSubstrings?: string[];
  requiredPptxXmlSubstrings?: string[];
}

export interface PptGenerationFlowToolRecord {
  step: number;
  name: string;
  toolCallId: string;
  input?: unknown;
  result?: string;
  success?: boolean;
  durationMs?: number;
}

export interface PptGenerationFlowSummary {
  toolNames: string[];
  replaceSlideCount: number;
  outputPaths: string[];
  finalValidateRender?: Record<string, unknown>;
  finalText: string;
  errors: string[];
  progressEvents: Extract<AgentEvent, { type: "long-task-progress" }>[];
}

export interface PptGenerationFlowResult {
  scenario: PptGenerationFlowScenario;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  events: AgentEvent[];
  monitorEvents: PptGenerationMonitorEvent[];
  toolRecords: PptGenerationFlowToolRecord[];
  llmSends: Array<{
    step: number;
    system: string;
    tools: ToolDefinition[];
    messages: LLMMessage[];
    estimatedInputTokens?: number;
    modelId?: string;
  }>;
  llmResponses: Array<{
    step: number;
    text: string;
    toolCalls: ToolCall[];
    stopReason?: string;
    usage?: unknown;
  }>;
  debugLogDirectory: string | null;
  summary: PptGenerationFlowSummary;
}

export interface PptGenerationFlowVerification {
  ok: boolean;
  failures: string[];
  summary: PptGenerationFlowSummary;
}

export interface PptGenerationFlowSignal {
  kind: "blocking-failure" | "recovered-friction" | "final-quality" | "plan-component-degradation";
  step?: number;
  toolName?: string;
  category: string;
  severity: "high" | "medium" | "low";
  message: string;
  evidence: string;
  diagnosticCodes: string[];
  diagnosticSummary?: Record<string, number>;
  schemaErrorCodes: string[];
  schemaErrorPaths: string[];
  slideIds: string[];
  nodeIds: string[];
  componentTypes: string[];
}

export interface PptGenerationFlowImprovementCandidate {
  id: string;
  priority: "P0" | "P1" | "P2";
  category: string;
  title: string;
  affectedTools: string[];
  affectedComponents: string[];
  evidence: string[];
  proposedFix: string;
  tests: string[];
}

export interface PptGenerationFlowImprovementAnalysis {
  caseId: string;
  generatedAt: string;
  passed: boolean;
  summary: {
    failedToolCalls: number;
    recoveredFrictionSignals: number;
    finalQualitySignals: number;
    improvementCandidates: number;
  };
  blockingFailureSignals: PptGenerationFlowSignal[];
  recoveredFrictionSignals: PptGenerationFlowSignal[];
  finalQualitySignals: PptGenerationFlowSignal[];
  candidates: PptGenerationFlowImprovementCandidate[];
}

type PptGenerationMonitorEvent =
  | { event: "init"; payload: { sessionId: string; query: string; planMode: boolean; workingDirectory?: string } }
  | { event: "llm-send"; payload: PptGenerationFlowResult["llmSends"][number] }
  | { event: "llm-response"; payload: PptGenerationFlowResult["llmResponses"][number] }
  | { event: "tool-start"; payload: { step: number; name: string; input: unknown; toolCallId: string } }
  | { event: "tool-done"; payload: { step: number; name: string; toolCallId: string; result: string; success: boolean; durationMs: number } }
  | { event: "error"; payload: { step: number; error: string; phase: string } }
  | { event: "compacted"; payload: { summary: string; preservedUserMessages: number; estimatedTokens: number } }
  | { event: "context-manifest"; payload: unknown }
  | { event: "completed"; payload: { totalSteps: number; hitStepLimit: boolean; finalText: string } };

export async function runPptGenerationFlowScenario(scenario: PptGenerationFlowScenario): Promise<PptGenerationFlowResult> {
  const startedAt = Date.now();
  const sessionId = scenario.sessionId || `ppt-flow-${scenario.id}`;
  const requestId = `ppt-flow-${scenario.id}-${startedAt}`;
  const desktopLogger = scenario.desktopDebugLog ? new DebugLogger(requestId) : undefined;
  const monitor = new PptGenerationFlowMonitor(requestId, desktopLogger);
  await monitor.init({
    sessionId,
    query: scenario.userPrompt,
    planMode: scenario.planMode === true,
    workingDirectory: scenario.workingDirectory,
  });

  const events: AgentEvent[] = [];
  const messages: LLMMessage[] = [{ role: "user", content: scenario.userPrompt }];
  for await (const event of runAgent({
    messages,
    sessionId,
    taskId: scenario.taskId || sessionId,
    taskMode: scenario.taskMode ?? "fresh",
    memoryPolicy: scenario.memoryPolicy ?? "global-preferences-only",
    contextSource: scenario.activeSkills ? { activeSkills: scenario.activeSkills } : undefined,
    planMode: scenario.planMode,
    workingDirectory: scenario.workingDirectory,
    debugLog: monitor,
  })) {
    events.push(event);
  }

  const finishedAt = Date.now();
  return {
    scenario,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    events,
    monitorEvents: monitor.events,
    toolRecords: monitor.toolRecords(),
    llmSends: monitor.llmSends,
    llmResponses: monitor.llmResponses,
    debugLogDirectory: monitor.directory,
    summary: summarizePptGenerationFlow(events, monitor.toolRecords()),
  };
}

export async function verifyPptGenerationFlow(
  result: PptGenerationFlowResult,
  expectations: PptGenerationFlowExpectations = result.scenario.expected || {},
): Promise<PptGenerationFlowVerification> {
  const failures: string[] = [];
  const summary = result.summary;
  const toolNames = new Set(summary.toolNames);

  for (const name of expectations.requiredTools || []) {
    if (!toolNames.has(name)) failures.push(`Missing required tool call: ${name}`);
  }
  for (const name of expectations.forbiddenTools || []) {
    if (toolNames.has(name)) failures.push(`Forbidden tool was called: ${name}`);
  }
  if (expectations.minReplaceSlideCalls !== undefined && summary.replaceSlideCount < expectations.minReplaceSlideCalls) {
    failures.push(`Expected at least ${expectations.minReplaceSlideCalls} successful slide write command(s), got ${summary.replaceSlideCount}.`);
  }
  if (expectations.requireProgressDone && !summary.progressEvents.some((event) => event.status === "done")) {
    failures.push("No done long-task progress event was emitted.");
  }
  if (expectations.requireFinalValidateRender && !validateRenderOk(summary.finalValidateRender)) {
    failures.push("No successful final validate_render({render:true}) result was captured.");
  }

  const blockingCount = blockingDiagnosticsCount(summary.finalValidateRender);
  if (expectations.maxBlockingDiagnostics !== undefined && blockingCount > expectations.maxBlockingDiagnostics) {
    failures.push(`Expected blocking diagnostics <= ${expectations.maxBlockingDiagnostics}, got ${blockingCount}.`);
  }

  const expectedOutputPath = expectations.outputPath;
  const finalOutputPath = finalValidateOutputPath(summary.finalValidateRender);
  if (expectedOutputPath && finalOutputPath !== expectedOutputPath) {
    failures.push(`Expected outputPath ${expectedOutputPath}, got ${finalOutputPath || "(none)"}.`);
  }
  if (expectations.requirePptxOutput) {
    const outputPath = expectedOutputPath || finalOutputPath || summary.outputPaths.find((path) => /\.pptx$/i.test(path));
    if (!outputPath) {
      failures.push("No PPTX output path was captured.");
    } else if (!await pathExists(outputPath)) {
      failures.push(`PPTX output does not exist: ${outputPath}`);
    }
  }

  if (expectations.requiredDeckJsonSubstrings?.length) {
    const deckPath = finalValidateDeckPath(result.toolRecords);
    if (!deckPath) {
      failures.push("No final render deckPath was captured for deck JSON substring checks.");
    } else {
      try {
        const deckJson = await nodeFs.promises.readFile(deckPath, "utf8");
        for (const needle of expectations.requiredDeckJsonSubstrings) {
          if (!deckJson.includes(needle)) failures.push(`Deck JSON is missing required substring: ${needle}`);
        }
      } catch (err) {
        failures.push(`Could not read deck JSON for substring checks at ${deckPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (expectations.requiredPptxXmlSubstrings?.length) {
    const outputPath = expectedOutputPath || finalOutputPath || summary.outputPaths.find((path) => /\.pptx$/i.test(path));
    if (!outputPath) {
      failures.push("No PPTX output path was captured for PPTX XML substring checks.");
    } else {
      try {
        const xml = await pptxXmlCorpus(outputPath);
        for (const needle of expectations.requiredPptxXmlSubstrings) {
          if (!xml.includes(needle)) failures.push(`PPTX XML is missing required substring: ${needle}`);
        }
      } catch (err) {
        failures.push(`Could not inspect PPTX XML at ${outputPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (summary.errors.length > 0) {
    failures.push(...summary.errors.map((error) => `Agent error event: ${error}`));
  }

  return { ok: failures.length === 0, failures, summary };
}

export async function loadPptGenerationFlowScenario(path: string): Promise<PptGenerationFlowScenario> {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(path, "utf8");
  return JSON.parse(raw) as PptGenerationFlowScenario;
}

export async function loadPptGenerationFlowCaseDirectory(caseDirectory: string): Promise<PptGenerationFlowCase> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const absCaseDir = path.resolve(caseDirectory);
  const metadataPath = await firstExistingPath([
    path.join(absCaseDir, "case.json"),
    path.join(absCaseDir, "scenario.json"),
  ]);
  const rawConfig = metadataPath
    ? JSON.parse(await fs.readFile(metadataPath, "utf8")) as PptGenerationFlowCaseConfig
    : {};
  const id = rawConfig.id || path.basename(absCaseDir);
  const inputsDirectory = resolveCasePath(absCaseDir, rawConfig.inputsDirectory || "inputs");
  const outputsDirectory = resolveCasePath(absCaseDir, rawConfig.outputsDirectory || "outputs");
  const reportsDirectory = resolveCasePath(absCaseDir, rawConfig.reportsDirectory || "reports");
  const defaultOutputPath = path.join(outputsDirectory, `${id}.pptx`);
  const vars = {
    id,
    caseDir: absCaseDir,
    inputsDir: inputsDirectory,
    outputsDir: outputsDirectory,
    reportsDir: reportsDirectory,
    outputPath: defaultOutputPath,
  };
  const config = expandTemplates(rawConfig, vars) as PptGenerationFlowCaseConfig;
  const promptPath = config.promptPath
    ? resolveCasePath(absCaseDir, config.promptPath)
    : path.join(absCaseDir, "prompt.md");
  const promptFileExists = await pathExists(promptPath);
  const rawPrompt = promptFileExists
    ? await fs.readFile(promptPath, "utf8")
    : config.userPrompt;
  if (!rawPrompt) {
    throw new Error(`PPT flow case ${absCaseDir} must contain prompt.md or case.json userPrompt.`);
  }
  const expected = normalizeCaseExpectations(absCaseDir, outputsDirectory, id, config.expected);
  const scenario: PptGenerationFlowScenario = {
    id,
    userPrompt: expandTemplateString(rawPrompt, {
      ...vars,
      outputPath: expected.outputPath || defaultOutputPath,
    }).trim(),
    workingDirectory: resolveCasePath(absCaseDir, config.workingDirectory || "."),
    sessionId: config.sessionId,
    taskId: config.taskId,
    planMode: config.planMode,
    taskMode: config.taskMode,
    memoryPolicy: config.memoryPolicy,
    activeSkills: config.activeSkills,
    desktopDebugLog: config.desktopDebugLog,
    expected,
  };
  return {
    id,
    caseDirectory: absCaseDir,
    promptPath: promptFileExists ? promptPath : null,
    inputsDirectory,
    outputsDirectory,
    reportsDirectory,
    scenario,
  };
}

export async function runPptGenerationFlowCaseDirectory(caseDirectory: string): Promise<PptGenerationFlowCaseRun> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const caseDefinition = await loadPptGenerationFlowCaseDirectory(caseDirectory);
  await fs.mkdir(caseDefinition.inputsDirectory, { recursive: true });
  await cleanCaseOutputs(caseDefinition);
  await fs.mkdir(caseDefinition.reportsDirectory, { recursive: true });

  const result = await runPptGenerationFlowScenario(caseDefinition.scenario);
  const verification = await verifyPptGenerationFlow(result);
  const reportDirectory = path.join(caseDefinition.reportsDirectory, reportRunId(result.startedAt));
  await fs.mkdir(reportDirectory, { recursive: true });
  const jsonReportPath = path.join(reportDirectory, "report.json");
  const markdownReportPath = path.join(reportDirectory, "report.md");
  const failureAnalysisPath = path.join(reportDirectory, "failure-analysis.json");
  const improvementCandidatesPath = path.join(reportDirectory, "improvement-candidates.md");
  const improvementAnalysis = analyzePptGenerationFlowImprovements(result, verification, caseDefinition);
  await writePptGenerationFlowReport(jsonReportPath, result, verification, caseDefinition);
  await writePptGenerationFlowMarkdownReport(markdownReportPath, caseDefinition, result, verification);
  await writePptGenerationFlowImprovementReports(failureAnalysisPath, improvementCandidatesPath, improvementAnalysis);
  return {
    caseDefinition,
    result,
    verification,
    reportDirectory,
    jsonReportPath,
    markdownReportPath,
    failureAnalysisPath,
    improvementCandidatesPath,
    improvementAnalysis,
  };
}

async function cleanCaseOutputs(caseDefinition: PptGenerationFlowCase): Promise<void> {
  const fs = await import("node:fs/promises");
  const relative = nodePath.relative(caseDefinition.caseDirectory, caseDefinition.outputsDirectory);
  const safeOutputDir = Boolean(relative) && !relative.startsWith("..") && !nodePath.isAbsolute(relative);
  if (safeOutputDir) {
    await fs.rm(caseDefinition.outputsDirectory, { recursive: true, force: true });
  }
  await fs.mkdir(caseDefinition.outputsDirectory, { recursive: true });
}

export async function listPptGenerationFlowCaseDirectories(rootDirectory: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const root = nodePath.resolve(rootDirectory);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const dirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = nodePath.join(root, entry.name);
    if (await pathExists(nodePath.join(dir, "case.json")) || await pathExists(nodePath.join(dir, "scenario.json"))) {
      dirs.push(dir);
    }
  }
  return dirs.sort((a, b) => a.localeCompare(b));
}

export async function runPptGenerationFlowCaseSuite(rootDirectory: string): Promise<PptGenerationFlowSuiteResult> {
  const startedAt = Date.now();
  const root = nodePath.resolve(rootDirectory);
  const caseDirectories = await listPptGenerationFlowCaseDirectories(root);
  const cases: PptGenerationFlowSuiteCaseResult[] = [];
  for (const caseDirectory of caseDirectories) {
    const caseStartedAt = Date.now();
    const id = nodePath.basename(caseDirectory);
    try {
      const run = await runPptGenerationFlowCaseDirectory(caseDirectory);
      cases.push({
        id: run.caseDefinition.id,
        caseDirectory,
        ok: run.verification.ok,
        durationMs: run.result.durationMs,
        reportDirectory: run.reportDirectory,
        jsonReportPath: run.jsonReportPath,
        markdownReportPath: run.markdownReportPath,
        failureAnalysisPath: run.failureAnalysisPath,
        improvementCandidatesPath: run.improvementCandidatesPath,
        debugLogDirectory: run.result.debugLogDirectory,
        outputPaths: run.result.summary.outputPaths,
        failures: run.verification.failures,
        firstRunIssue: firstRunIssueSummary(run.improvementAnalysis),
        improvementCandidateCount: run.improvementAnalysis.candidates.length,
        recoveredFrictionCount: run.improvementAnalysis.recoveredFrictionSignals.length,
        improvementAnalysisSummary: run.improvementAnalysis.summary,
        improvementCandidates: run.improvementAnalysis.candidates,
      });
    } catch (err) {
      cases.push({
        id,
        caseDirectory,
        ok: false,
        durationMs: Date.now() - caseStartedAt,
        outputPaths: [],
        failures: [`Exception while running case: ${err instanceof Error ? err.message : String(err)}`],
        firstRunIssue: `Exception while running case: ${err instanceof Error ? err.message : String(err)}`,
        error: err instanceof Error ? err.stack || err.message : String(err),
      });
    }
  }
  const finishedAt = Date.now();
  const passCount = cases.filter((item) => item.ok).length;
  return {
    rootDirectory: root,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    caseCount: cases.length,
    passCount,
    failCount: cases.length - passCount,
    cases,
  };
}

export async function writePptGenerationFlowSuiteReports(
  outputDirectory: string,
  suite: PptGenerationFlowSuiteResult,
): Promise<{ jsonPath: string; markdownPath: string; improvementPlanPath: string }> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(outputDirectory, { recursive: true });
  const jsonPath = nodePath.join(outputDirectory, "summary.json");
  const markdownPath = nodePath.join(outputDirectory, "summary.md");
  const improvementPlanPath = nodePath.join(outputDirectory, "overall-improvement-plan.md");
  await fs.writeFile(jsonPath, JSON.stringify(suite, null, 2), "utf8");
  await fs.writeFile(markdownPath, markdownSuiteReport(suite), "utf8");
  await fs.writeFile(improvementPlanPath, markdownSuiteImprovementPlan(suite), "utf8");
  return { jsonPath, markdownPath, improvementPlanPath };
}

export async function writePptGenerationFlowMarkdownReport(
  path: string,
  caseDefinition: PptGenerationFlowCase | null,
  result: PptGenerationFlowResult,
  verification: PptGenerationFlowVerification,
): Promise<void> {
  const fs = await import("node:fs/promises");
  const nodePath = await import("node:path");
  await fs.mkdir(nodePath.dirname(path), { recursive: true });
  await fs.writeFile(path, markdownFlowReport(caseDefinition, result, verification), "utf8");
}

function markdownSuiteReport(suite: PptGenerationFlowSuiteResult): string {
  const rows = suite.cases.map((item) => [
    "|",
    item.ok ? "PASS" : "FAIL",
    "|",
    item.id,
    "|",
    `${Math.round(item.durationMs / 1000)}s`,
    "|",
    escapeMarkdownTable(caseFirstRunIssue(item)),
    "|",
    item.improvementCandidateCount ?? 0,
    "|",
    item.markdownReportPath || "",
    "|",
  ].join(" ")).join("\n");
  const failures = suite.cases
    .filter((item) => !item.ok)
    .flatMap((item) => item.failures.map((failure) => `- ${item.id}: ${failure}`));
  return [
    `# PPT Flow Case Suite: ${suite.failCount === 0 ? "PASS" : "FAIL"}`,
    "",
    `- Root: ${suite.rootDirectory}`,
    `- Started: ${new Date(suite.startedAt).toISOString()}`,
    `- Duration: ${Math.round(suite.durationMs / 1000)}s`,
    `- Cases: ${suite.caseCount}`,
    `- Passed: ${suite.passCount}`,
    `- Failed: ${suite.failCount}`,
    "",
    "## Cases",
    "",
    "| Status | Case | Duration | First run issue | Improvement candidates | Report |",
    "| --- | --- | ---: | --- | ---: | --- |",
    rows || "| - | - | - | - | - | - |",
    "",
    "## Failures",
    "",
    failures.length ? failures.join("\n") : "- None",
    "",
    "## Outputs",
    "",
    ...suite.cases.flatMap((item) => {
      if (!item.outputPaths.length) return [`- ${item.id}: none captured`];
      return item.outputPaths.map((outputPath) => `- ${item.id}: ${outputPath}`);
    }),
    "",
    "## Improvement Plans",
    "",
    ...suite.cases.map((item) => `- ${item.id}: ${item.improvementCandidatesPath || "not generated"}`),
    "",
  ].join("\n");
}

function markdownSuiteImprovementPlan(suite: PptGenerationFlowSuiteResult): string {
  const rows = suite.cases.map((item) => [
    "|",
    item.ok ? "PASS" : "FAIL",
    "|",
    item.id,
    "|",
    item.improvementCandidateCount ?? 0,
    "|",
    item.recoveredFrictionCount ?? 0,
    "|",
    escapeMarkdownTable(caseFirstRunIssue(item)),
    "|",
    item.improvementCandidatesPath || "",
    "|",
  ].join(" ")).join("\n");
  const failedCases = suite.cases.filter((item) => !item.ok);
  const frictionCases = suite.cases.filter((item) => (item.improvementCandidateCount ?? 0) > 0);
  const candidateGroups = suiteImprovementCandidateGroups(suite);
  return [
    "# PPT Flow Overall Improvement Plan",
    "",
    `- Root: ${suite.rootDirectory}`,
    `- Generated: ${new Date(suite.finishedAt).toISOString()}`,
    `- Cases: ${suite.caseCount}`,
    `- Passed: ${suite.passCount}`,
    `- Failed: ${suite.failCount}`,
    `- Cases with improvement candidates: ${frictionCases.length}`,
    "",
    "This file is generated from the live PPT flow reports. It includes both hard failures and recovered friction from passing runs, because repeated slide write repairs, schema retries, quality warnings, and component degradation are product signals.",
    "",
    "## Case Summary",
    "",
    "| Status | Case | Candidates | Recovered friction signals | First run issue | Case improvement plan |",
    "| --- | --- | ---: | ---: | --- | --- |",
    rows || "| - | - | - | - | - | - |",
    "",
    "## Required Follow-Up",
    "",
    failedCases.length
      ? failedCases.flatMap((item) => item.failures.map((failure) => `- Fix blocking issue in ${item.id}: ${failure}`)).join("\n")
      : "- No case ended with a blocking verification failure.",
    "",
    frictionCases.length
      ? frictionCases.map((item) => `- Review recovered friction in ${item.id}: ${item.improvementCandidatesPath}`).join("\n")
      : "- No recovered friction candidates were detected.",
    "",
    "## Aggregated Improvement Candidates",
    "",
    candidateGroups.length
      ? candidateGroups.map(markdownSuiteCandidateGroup).join("\n")
      : "- None",
    "",
    "## Guardrail",
    "",
    "Do not make case-specific workarounds. Classify each item as implementation, interface/spec, skill contract, runner/reporting, or case semantic before editing.",
    "",
  ].join("\n");
}

function caseFirstRunIssue(item: PptGenerationFlowSuiteCaseResult): string {
  return item.firstRunIssue || item.failures[0] || "None";
}

function firstRunIssueSummary(analysis: PptGenerationFlowImprovementAnalysis): string | undefined {
  const first = [
    ...analysis.blockingFailureSignals,
    ...analysis.recoveredFrictionSignals,
    ...analysis.finalQualitySignals,
  ].sort((a, b) => (a.step ?? Number.POSITIVE_INFINITY) - (b.step ?? Number.POSITIVE_INFINITY))[0];
  if (!first) return undefined;
  const parts = [
    first.step !== undefined ? `step ${first.step}` : first.kind,
    first.toolName || "validate_render",
    first.category,
    first.diagnosticCodes.length ? `codes=${first.diagnosticCodes.join(",")}` : "",
    first.message,
  ].filter(Boolean);
  return excerpt(parts.join(" | "), 220);
}

function suiteImprovementCandidateGroups(suite: PptGenerationFlowSuiteResult): Array<{
  priority: "P0" | "P1" | "P2";
  category: string;
  title: string;
  cases: string[];
  tools: string[];
  components: string[];
  evidence: string[];
  proposedFixes: string[];
  tests: string[];
}> {
  const groups = new Map<string, {
    priority: "P0" | "P1" | "P2";
    category: string;
    title: string;
    cases: Set<string>;
    tools: Set<string>;
    components: Set<string>;
    evidence: string[];
    proposedFixes: Set<string>;
    tests: Set<string>;
  }>();
  for (const item of suite.cases) {
    for (const candidate of item.improvementCandidates || []) {
      const key = `${candidate.category}:${candidate.title}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          priority: candidate.priority,
          category: candidate.category,
          title: candidate.title,
          cases: new Set(),
          tools: new Set(),
          components: new Set(),
          evidence: [],
          proposedFixes: new Set(),
          tests: new Set(),
        };
        groups.set(key, group);
      }
      if (priorityRank(candidate.priority) < priorityRank(group.priority)) group.priority = candidate.priority;
      group.cases.add(item.id);
      for (const tool of candidate.affectedTools) group.tools.add(tool);
      for (const component of candidate.affectedComponents) group.components.add(component);
      for (const line of candidate.evidence.slice(0, 3)) group.evidence.push(`${item.id}: ${line}`);
      group.proposedFixes.add(candidate.proposedFix);
      for (const test of candidate.tests) group.tests.add(test);
    }
  }
  return [...groups.values()].map((group) => ({
    priority: group.priority,
    category: group.category,
    title: group.title,
    cases: [...group.cases].sort(),
    tools: [...group.tools].sort(),
    components: [...group.components].sort(),
    evidence: group.evidence.slice(0, 8),
    proposedFixes: [...group.proposedFixes],
    tests: [...group.tests],
  })).sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
}

function markdownSuiteCandidateGroup(group: ReturnType<typeof suiteImprovementCandidateGroups>[number]): string {
  return [
    `### ${group.priority}. ${group.title}`,
    "",
    `- Category: ${group.category}`,
    `- Cases: ${group.cases.join(", ")}`,
    `- Tools: ${group.tools.length ? group.tools.join(", ") : "n/a"}`,
    `- Components: ${group.components.length ? group.components.join(", ") : "n/a"}`,
    "",
    "Evidence:",
    ...group.evidence.map((line) => `- ${line}`),
    "",
    "Plan:",
    ...group.proposedFixes.map((line) => `- ${line}`),
    "",
    "Tests:",
    ...group.tests.map((line) => `- ${line}`),
    "",
  ].join("\n");
}

function flowReportPayload(
  result: PptGenerationFlowResult,
  verification: PptGenerationFlowVerification,
  caseDefinition?: PptGenerationFlowCase,
): Record<string, unknown> {
  return {
    case: caseDefinition ? {
      id: caseDefinition.id,
      caseDirectory: caseDefinition.caseDirectory,
      promptPath: caseDefinition.promptPath,
      inputsDirectory: caseDefinition.inputsDirectory,
      outputsDirectory: caseDefinition.outputsDirectory,
      reportsDirectory: caseDefinition.reportsDirectory,
    } : undefined,
    scenario: result.scenario,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    debugLogDirectory: result.debugLogDirectory,
    summary: result.summary,
    verification,
    agentEvents: result.events,
    toolRecords: result.toolRecords,
    llmSends: result.llmSends.map((send) => ({
      step: send.step,
      modelId: send.modelId,
      estimatedInputTokens: send.estimatedInputTokens,
      systemChars: send.system.length,
      toolNames: send.tools.map((tool) => tool.name),
      messages: send.messages.map((message) => ({
        role: message.role,
        chars: "content" in message ? message.content.length : 0,
      })),
    })),
    llmResponses: result.llmResponses.map((response) => ({
      step: response.step,
      stopReason: response.stopReason,
      toolCalls: response.toolCalls.map((call) => ({ id: call.id, name: call.name })),
      text: response.text.slice(0, 2000),
    })),
  };
}

export function analyzePptGenerationFlowImprovements(
  result: PptGenerationFlowResult,
  verification: PptGenerationFlowVerification,
  caseDefinition?: PptGenerationFlowCase | null,
): PptGenerationFlowImprovementAnalysis {
  const caseId = caseDefinition?.id || result.scenario.id;
  const blockingFailureSignals = result.toolRecords
    .filter((record) => record.success === false)
    .map((record) => signalFromToolRecord(record, "blocking-failure"))
    .filter((signal): signal is PptGenerationFlowSignal => Boolean(signal));
  const recoveredFrictionSignals = result.toolRecords
    .filter((record) => record.success !== false)
    .map((record) => signalFromToolRecord(record, "recovered-friction"))
    .filter((signal): signal is PptGenerationFlowSignal => Boolean(signal));
  const planComponentSignals = planComponentDegradationSignals(result, caseDefinition);
  const assetSignals = generatedAssetUsageSignals(result, caseDefinition);
  const finalQualitySignals = finalQualitySignalsFromValidate(result.summary.finalValidateRender);
  const candidates = buildImprovementCandidates([
    ...blockingFailureSignals,
    ...recoveredFrictionSignals,
    ...planComponentSignals,
    ...assetSignals,
    ...finalQualitySignals,
  ], verification);
  return {
    caseId,
    generatedAt: new Date().toISOString(),
    passed: verification.ok,
    summary: {
      failedToolCalls: blockingFailureSignals.length,
      recoveredFrictionSignals: recoveredFrictionSignals.length + planComponentSignals.length + assetSignals.length,
      finalQualitySignals: finalQualitySignals.length,
      improvementCandidates: candidates.length,
    },
    blockingFailureSignals,
    recoveredFrictionSignals: [...recoveredFrictionSignals, ...planComponentSignals, ...assetSignals],
    finalQualitySignals,
    candidates,
  };
}

export async function writePptGenerationFlowImprovementReports(
  failureAnalysisPath: string,
  improvementCandidatesPath: string,
  analysis: PptGenerationFlowImprovementAnalysis,
): Promise<void> {
  const fs = await import("node:fs/promises");
  const nodePath = await import("node:path");
  await fs.mkdir(nodePath.dirname(failureAnalysisPath), { recursive: true });
  await fs.writeFile(failureAnalysisPath, JSON.stringify(analysis, null, 2), "utf8");
  await fs.writeFile(improvementCandidatesPath, markdownImprovementCandidates(analysis), "utf8");
}

function signalFromToolRecord(
  record: PptGenerationFlowToolRecord,
  requestedKind: "blocking-failure" | "recovered-friction",
): PptGenerationFlowSignal | null {
  const result = record.result || "";
  if (!result) return null;
  const diagnosticSummary = parseDiagnosticSummary(result);
  const diagnosticCodes = unique([
    ...Object.keys(diagnosticSummary || {}),
    ...regexAll(result, /"code":\s*"([A-Z_]+)"/g),
  ]);
  const schemaErrorCodes = unique(regexAll(result, /"code":\s*"([A-Z_]+)"/g).filter((code) => code === "INVALID_FIELD_USAGE" || code.startsWith("DUPLICATE_")));
  const schemaErrorPaths = unique(regexAll(result, /"path":\s*"([^"]+)"/g));
  const slideIds = unique(regexAll(result, /"slideId":\s*"([^"]+)"/g));
  const nodeIds = unique(regexAll(result, /"nodeId":\s*"([^"]+)"/g));
  const componentTypes = unique([
    ...collectComponentTypes(record.input),
    ...inferComponentTypes(result),
  ]);
  const isFailed = record.success === false;
  if (!isFailed && isPassiveContextTool(record.name)) return null;
  const hasQualitySignal = hasRecoveredFriction(result, diagnosticCodes, diagnosticSummary);
  if (!isFailed && !hasQualitySignal) return null;

  const category = classifySignal({
    toolName: record.name,
    result,
    diagnosticCodes,
    schemaErrorCodes,
    componentTypes,
    nodeIds,
  });
  return {
    kind: isFailed ? "blocking-failure" : requestedKind,
    step: record.step,
    toolName: record.name,
    category,
    severity: isFailed ? "high" : signalSeverity(diagnosticCodes),
    message: summarizeToolSignal(record.name, result, diagnosticCodes),
    evidence: excerpt(result, 1200),
    diagnosticCodes,
    diagnosticSummary,
    schemaErrorCodes,
    schemaErrorPaths,
    slideIds,
    nodeIds,
    componentTypes,
  };
}

function finalQualitySignalsFromValidate(validateResult: Record<string, unknown> | undefined): PptGenerationFlowSignal[] {
  const diagnostics = validateResult?.diagnostics;
  if (!diagnostics || typeof diagnostics !== "object") return [];
  const record = diagnostics as Record<string, unknown>;
  const quality = Array.isArray(record.quality) ? record.quality : [];
  const summary = numericRecord(record.summary);
  const signals: PptGenerationFlowSignal[] = [];
  if (quality.length > 0 || Object.keys(summary).length > 0) {
    const qualityCodes = unique(quality.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const code = (item as Record<string, unknown>).code;
      return typeof code === "string" ? [code] : [];
    }));
    const allCodes = unique([...Object.keys(summary), ...qualityCodes]);
    const message = quality.length
      ? `Final validate_render reported ${quality.length} quality diagnostic(s).`
      : "Final validate_render reported diagnostic summary entries.";
    signals.push({
      kind: "final-quality",
      category: classifySignal({
        toolName: "validate_render",
        result: JSON.stringify(diagnostics),
        diagnosticCodes: allCodes,
        schemaErrorCodes: [],
        componentTypes: [],
        nodeIds: [],
      }),
      severity: signalSeverity(allCodes),
      message,
      evidence: excerpt(JSON.stringify({ summary, quality }, null, 2), 1200),
      diagnosticCodes: allCodes,
      diagnosticSummary: summary,
      schemaErrorCodes: [],
      schemaErrorPaths: [],
      slideIds: unique(quality.flatMap((item) => objectStringValue(item, "slideId"))),
      nodeIds: unique(quality.flatMap((item) => objectStringValue(item, "nodeId"))),
      componentTypes: inferComponentTypes(JSON.stringify(quality)),
    });
  }
  return signals;
}

function planComponentDegradationSignals(
  result: PptGenerationFlowResult,
  caseDefinition?: PptGenerationFlowCase | null,
): PptGenerationFlowSignal[] {
  const planText = plannedDeckText(result);
  if (!planText) return [];
  const planned = plannedComponentsBySlide(planText);
  if (planned.size === 0) return [];
  const actual = actualComponentsBySlide(result, caseDefinition);
  if (actual.size === 0) return [];

  const signals: PptGenerationFlowSignal[] = [];
  for (const [slideId, plannedComponents] of planned.entries()) {
    const actualComponents = actual.get(slideId);
    if (!actualComponents) continue;
    const missing = [...plannedComponents].filter((component) =>
      planTrackedComponents.has(component) && !actualComponents.has(component),
    );
    if (missing.length === 0) continue;
    const actualList = [...actualComponents].sort();
    signals.push({
      kind: "plan-component-degradation",
      toolName: "report_analysis",
      category: "component-selection-degradation",
      severity: "medium",
      message: `Planned component(s) ${missing.join(", ")} for slide ${slideId} were not present in the final SlideML2 deck.`,
      evidence: `slide=${slideId}; planned=${[...plannedComponents].sort().join(", ")}; final=${actualList.join(", ") || "none"}`,
      diagnosticCodes: ["PLANNED_COMPONENT_OMITTED"],
      diagnosticSummary: { PLANNED_COMPONENT_OMITTED: missing.length },
      schemaErrorCodes: [],
      schemaErrorPaths: [],
      slideIds: [slideId],
      nodeIds: [],
      componentTypes: missing,
    });
  }
  return signals;
}

function generatedAssetUsageSignals(
  result: PptGenerationFlowResult,
  caseDefinition?: PptGenerationFlowCase | null,
): PptGenerationFlowSignal[] {
  const generated = generatedAssetPaths(result);
  if (generated.length === 0) return [];
  const used = finalDeckAssetReferences(result, caseDefinition);
  const unused = generated.filter((assetPath) => !used.has(assetPath) && !used.has(nodePath.basename(assetPath)));
  if (unused.length === 0) return [];
  return [{
    kind: "recovered-friction",
    toolName: "report_analysis",
    category: "asset-workflow",
    severity: "medium",
    message: `${unused.length}/${generated.length} generated asset(s) were not referenced by the final SlideML2 deck.`,
    evidence: `unused=${unused.slice(0, 8).join(", ")}${unused.length > 8 ? "..." : ""}`,
    diagnosticCodes: ["UNUSED_GENERATED_ASSET"],
    diagnosticSummary: { UNUSED_GENERATED_ASSET: unused.length },
    schemaErrorCodes: [],
    schemaErrorPaths: [],
    slideIds: [],
    nodeIds: [],
    componentTypes: ["image-card"],
  }];
}

function generatedAssetPaths(result: PptGenerationFlowResult): string[] {
  const candidates: string[] = [];
  for (const record of result.toolRecords) {
    const resultText = record.result || "";
    if (!["image_gen", "run_python", "run_node", "shell", "generate_icon_sheet"].includes(record.name)) continue;
    candidates.push(
      ...regexAll(resultText, /(?:saved to|output(?:Path)?["': ]+|generated(?: and saved)? to)\s*["']?([^"'\n]+?\.(?:png|jpg|jpeg|webp|svg))/gi),
      ...regexAll(resultText, /([/\w .@()_-]+\/assets\/[^"'\n]+?\.(?:png|jpg|jpeg|webp|svg))/gi),
    );
  }
  return unique(candidates.map((value) => nodePath.resolve(value.trim())));
}

function finalDeckAssetReferences(
  result: PptGenerationFlowResult,
  caseDefinition?: PptGenerationFlowCase | null,
): Set<string> {
  const deck = readFinalSourceDeck(result, caseDefinition);
  const out = new Set<string>();
  const add = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    out.add(trimmed);
    out.add(nodePath.basename(trimmed));
    if (nodePath.isAbsolute(trimmed)) out.add(nodePath.resolve(trimmed));
    else out.add(nodePath.resolve(result.scenario.workingDirectory, trimmed));
  };
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const record = node as Record<string, unknown>;
    for (const key of ["src", "path", "image", "url"]) {
      const value = record[key];
      if (typeof value === "string" && /\.(?:png|jpg|jpeg|webp|svg)$/i.test(value)) add(value);
    }
    for (const child of Object.values(record)) walk(child);
  };
  walk(deck);
  return out;
}

function plannedDeckText(result: PptGenerationFlowResult): string {
  const fromTool = result.toolRecords
    .filter((record) => record.name === "write_file")
    .map((record) => record.input)
    .map((input) => input && typeof input === "object" ? input as Record<string, unknown> : undefined)
    .filter((input): input is Record<string, unknown> => Boolean(input))
    .filter((input) => typeof input.path === "string" && /(?:deck_plan|source_notes|plan)\.md$/i.test(input.path))
    .map((input) => typeof input.content === "string" ? input.content : "")
    .filter(Boolean)
    .join("\n\n");
  if (fromTool.trim()) return fromTool;

  const candidatePaths = unique([
    ...result.summary.outputPaths,
    ...(result.toolRecords.flatMap((record) => regexAll(record.result || "", /([/\w .@()-]+(?:deck_plan|source_notes|plan)\.md)/gi))),
  ]);
  for (const path of candidatePaths) {
    if (!/(?:deck_plan|source_notes|plan)\.md$/i.test(path)) continue;
    try {
      if (nodeFs.existsSync(path)) return nodeFs.readFileSync(path, "utf8");
    } catch {
      // Ignore stale paths; absence of a plan should not fail the report.
    }
  }
  return "";
}

function plannedComponentsBySlide(planText: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const line of planText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || /^[-|\s:]+$/.test(trimmed)) continue;
    const cells = trimmed.split("|").map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 3) continue;
    const slideId = cells.find((cell) => /^[a-z][a-z0-9_-]{1,80}$/i.test(stripBackticks(cell)) && !/^id$/i.test(stripBackticks(cell)));
    if (!slideId) continue;
    const components = extractComponentNamesFromText(cells.join(" "));
    if (components.length === 0) continue;
    const normalizedSlideId = stripBackticks(slideId);
    const set = out.get(normalizedSlideId) || new Set<string>();
    for (const component of components) set.add(component);
    out.set(normalizedSlideId, set);
  }
  return out;
}

function actualComponentsBySlide(
  result: PptGenerationFlowResult,
  caseDefinition?: PptGenerationFlowCase | null,
): Map<string, Set<string>> {
  const deck = readFinalSourceDeck(result, caseDefinition);
  if (!deck || typeof deck !== "object" || !Array.isArray((deck as { slides?: unknown }).slides)) return new Map();
  const out = new Map<string, Set<string>>();
  for (const slide of (deck as { slides: unknown[] }).slides) {
    if (!slide || typeof slide !== "object") continue;
    const id = (slide as Record<string, unknown>).id;
    if (typeof id !== "string" || !id) continue;
    out.set(id, new Set(collectComponentTypes(slide)));
  }
  return out;
}

function readFinalSourceDeck(result: PptGenerationFlowResult, caseDefinition?: PptGenerationFlowCase | null): unknown {
  const paths = unique([
    ...result.summary.outputPaths,
    caseDefinition ? nodePath.join(caseDefinition.outputsDirectory, `${caseDefinition.id}-deck.json`) : undefined,
    ...result.toolRecords.flatMap((record) => regexAll(record.result || "", /([/\w .@()-]+\.json)/gi)),
  ].filter((path): path is string => typeof path === "string"));
  const candidates = paths.filter((path) =>
    /\.json$/i.test(path)
    && !/render-tree|diagnostics|report|failure-analysis|summary/i.test(path),
  );
  for (const path of candidates) {
    try {
      if (!nodeFs.existsSync(path)) continue;
      const parsed = JSON.parse(nodeFs.readFileSync(path, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { slides?: unknown }).slides)) return parsed;
    } catch {
      // Ignore non-deck JSON files found in tool output excerpts.
    }
  }
  return undefined;
}

function stripBackticks(value: string): string {
  return value.replace(/^`+|`+$/g, "").trim();
}

function extractComponentNamesFromText(value: string): string[] {
  const lower = value.toLowerCase();
  return componentNamesForReports.filter((name) => lower.includes(name) || lower.includes(name.replace(/-/g, ".")));
}

const componentNamesForReports = [
  "cover-composition",
  "process-flow",
  "chart-with-rail",
  "chart-card",
  "table-card",
  "bar-list",
  "kpi-grid",
  "stat-strip",
  "feature-card",
  "swot-matrix",
  "equation",
  "callout",
  "takeaway-list",
  "timeline",
  "code-block",
  "image-card",
  "numbered-grid",
  "source-note",
];

const planTrackedComponents = new Set([
  "chart-card",
  "chart-with-rail",
  "bar-list",
  "stat-strip",
  "kpi-grid",
  "process-flow",
  "timeline",
  "equation",
  "code-block",
  "image-card",
]);

function buildImprovementCandidates(
  signals: PptGenerationFlowSignal[],
  verification: PptGenerationFlowVerification,
): PptGenerationFlowImprovementCandidate[] {
  const groups = new Map<string, PptGenerationFlowSignal[]>();
  for (const signal of signals) {
    const key = `${signal.category}:${primaryComponent(signal)}:${primaryDiagnostic(signal)}`;
    const existing = groups.get(key);
    if (existing) existing.push(signal);
    else groups.set(key, [signal]);
  }

  const candidates: PptGenerationFlowImprovementCandidate[] = [];
  let index = 1;
  for (const [key, group] of groups) {
    const category = group[0]?.category || "runner-reporting";
    const components = unique(group.flatMap((signal) => signal.componentTypes));
    const tools = unique(group.flatMap((signal) => signal.toolName ? [signal.toolName] : []));
    const diagnosticCodes = unique(group.flatMap((signal) => signal.diagnosticCodes));
    const priority = candidatePriority(group, verification);
    candidates.push({
      id: `ppt-flow-${index++}-${slugKey(key)}`,
      priority,
      category,
      title: candidateTitle(category, components, diagnosticCodes),
      affectedTools: tools,
      affectedComponents: components,
      evidence: group.slice(0, 5).map((signal) => [
        signal.step !== undefined ? `step ${signal.step}` : signal.kind,
        signal.toolName || "validate_render",
        signal.message,
        signal.slideIds.length ? `slides=${signal.slideIds.join(",")}` : "",
        signal.nodeIds.length ? `nodes=${signal.nodeIds.slice(0, 4).join(",")}` : "",
      ].filter(Boolean).join(" | ")),
      proposedFix: candidateFix(category, components, diagnosticCodes),
      tests: candidateTests(category, components, diagnosticCodes),
    });
  }
  return candidates.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.category.localeCompare(b.category));
}

function markdownImprovementCandidates(analysis: PptGenerationFlowImprovementAnalysis): string {
  const candidateBlocks = analysis.candidates.map((candidate) => [
    `### ${candidate.priority}. ${candidate.title}`,
    "",
    `- Category: ${candidate.category}`,
    `- Tools: ${candidate.affectedTools.length ? candidate.affectedTools.join(", ") : "n/a"}`,
    `- Components: ${candidate.affectedComponents.length ? candidate.affectedComponents.join(", ") : "n/a"}`,
    "",
    "Evidence:",
    ...candidate.evidence.map((line) => `- ${line}`),
    "",
    "Plan:",
    `- ${candidate.proposedFix}`,
    "",
    "Tests:",
    ...candidate.tests.map((line) => `- ${line}`),
    "",
  ].join("\n"));
  const failureSignals = analysis.blockingFailureSignals.map((signal) => signalSummaryLine(signal));
  const recoveredSignals = analysis.recoveredFrictionSignals.map((signal) => signalSummaryLine(signal));
  const finalSignals = analysis.finalQualitySignals.map((signal) => signalSummaryLine(signal));
  return [
    `# PPT Flow Improvement Candidates: ${analysis.caseId}`,
    "",
    `- Generated: ${analysis.generatedAt}`,
    `- Final status: ${analysis.passed ? "PASS" : "FAIL"}`,
    `- Failed tool calls: ${analysis.summary.failedToolCalls}`,
    `- Recovered friction signals: ${analysis.summary.recoveredFrictionSignals}`,
    `- Final quality signals: ${analysis.summary.finalQualitySignals}`,
    `- Improvement candidates: ${analysis.summary.improvementCandidates}`,
    "",
    "This report includes failures that blocked generation and issues recovered by the agent before the final deck passed. Recovered friction matters because it exposes component usability gaps, schema friction, and component usage degradation.",
    "",
    "## Candidates",
    "",
    candidateBlocks.join("\n") || "- None",
    "",
    "## Blocking Failures",
    "",
    failureSignals.length ? failureSignals.join("\n") : "- None",
    "",
    "## Recovered Friction",
    "",
    recoveredSignals.length ? recoveredSignals.join("\n") : "- None",
    "",
    "## Final Quality Signals",
    "",
    finalSignals.length ? finalSignals.join("\n") : "- None",
    "",
    "## Guardrail",
    "",
    "Any fix should be general: no case-id checks, no hand-edited generated decks, and no prompt-only workaround for an implementation/spec issue.",
    "",
  ].join("\n");
}

function signalSummaryLine(signal: PptGenerationFlowSignal): string {
  return [
    "-",
    signal.step !== undefined ? `step ${signal.step}` : signal.kind,
    signal.toolName ? `tool=${signal.toolName}` : "tool=validate_render",
    `category=${signal.category}`,
    signal.diagnosticCodes.length ? `codes=${signal.diagnosticCodes.join(",")}` : "",
    signal.componentTypes.length ? `components=${signal.componentTypes.join(",")}` : "",
    signal.message,
  ].filter(Boolean).join(" ");
}

function parseDiagnosticSummary(result: string): Record<string, number> | undefined {
  const match = result.match(/summary=(\{[^\n]+\})/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1]!) as unknown;
    return numericRecord(parsed);
  } catch {
    return undefined;
  }
}

function numericRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "number" && Number.isFinite(child)) out[key] = child;
  }
  return out;
}

function hasRecoveredFriction(result: string, diagnosticCodes: string[], diagnosticSummary: Record<string, number> | undefined): boolean {
  if (/quality=[1-9]/.test(result)) return true;
  if (diagnosticCodes.some((code) => degradationCodes.has(code))) return true;
  if (diagnosticSummary && Object.keys(diagnosticSummary).some((code) => degradationCodes.has(code))) return true;
  return /swapped|fallback|demoted|drop|unused generated icon|改用|降级/i.test(result);
}

const degradationCodes = new Set([
  "TRUNCATED",
  "SQUASHED",
  "TINY_RECT",
  "OVERFLOW",
  "FALLBACK_FAILED",
  "DROP",
  "DEMOTED",
  "LOW_CONTRAST_FIXED",
  "PARTIAL_UNUSED_GENERATED_ICON_ASSETS",
  "UNUSED_GENERATED_ASSET",
]);

function isPassiveContextTool(toolName: string): boolean {
  return toolName === "read_file" || toolName === "grep" || toolName === "list_directory";
}

function classifySignal(input: {
  toolName?: string;
  result: string;
  diagnosticCodes: string[];
  schemaErrorCodes: string[];
  componentTypes: string[];
  nodeIds: string[];
}): string {
  const text = `${input.result}\n${input.componentTypes.join(" ")}\n${input.nodeIds.join(" ")}`.toLowerCase();
  const explicitComponents = new Set(input.componentTypes);
  if (
    input.toolName === "run_python" ||
    input.toolName === "image_gen" ||
    input.toolName === "generate_icon_sheet" ||
    /glyph|font|savefig|generated asset|generated icon|unused generated icon|icon manifest|assets\/(?:icons|img)\//.test(text)
  ) return "asset-workflow";
  if (/json string|themeoverride string|could not read deck|enoent/.test(text)) return "tool-argument-robustness";
  if (input.diagnosticCodes.includes("PLANNED_COMPONENT_OMITTED") || /planned component/.test(text)) return "component-selection-degradation";
  if (input.schemaErrorCodes.length || /invalid_field_usage|raw hex|duplicate_hero_title/.test(text)) return "schema-interface";
  if (explicitComponents.has("process-flow") || /process-flow|(?:^|[.\s])flow(?:[.\s]|$)/.test(text)) return "component-process-flow";
  if (/equation|\.eq|\.math|formula/.test(text)) return "component-equation";
  if (/table-card|table '|\.table/.test(text)) return "component-table";
  if (/kpi-grid|stat-strip|kpi|stats|value-wrap/.test(text)) return "component-kpi-stat";
  if (/feature-card|swot|strengths|weaknesses|opportunities|threats/.test(text)) return "component-card-grid";
  if (/cover-composition|hero|caption|duplicate hero title/.test(text)) return "component-cover-title";
  if (input.diagnosticCodes.some((code) => ["FALLBACK_FAILED", "SQUASHED", "TINY_RECT", "TRUNCATED", "OVERFLOW"].includes(code))) return "component-capacity";
  return "runner-reporting";
}

function candidatePriority(group: PptGenerationFlowSignal[], verification: PptGenerationFlowVerification): "P0" | "P1" | "P2" {
  if (!verification.ok && group.some((signal) => signal.kind === "blocking-failure")) return "P0";
  if (group.some((signal) => signal.kind === "blocking-failure" && ["schema-interface", "component-capacity", "component-table", "component-kpi-stat"].includes(signal.category))) return "P0";
  if (group.some((signal) => signal.severity === "high")) return "P1";
  return "P2";
}

function candidateTitle(category: string, components: string[], diagnosticCodes: string[]): string {
  const componentLabel = components.length ? components.join("/") : category.replace(/^component-/, "");
  if (category === "schema-interface") return "Normalize schema vocabulary and repair guidance";
  if (category === "tool-argument-robustness") return "Make tool argument handling and path errors easier to recover";
  if (category === "asset-workflow") return "Harden generated asset workflow and unused asset reporting";
  if (category === "component-selection-degradation") return "Reduce planned component degradation";
  if (category === "runner-reporting") return "Improve PPT flow reporting for recovered friction";
  if (diagnosticCodes.some((code) => ["DROP", "DEMOTED"].includes(code))) return `Reduce component degradation in ${componentLabel}`;
  return `Improve ${componentLabel} capacity and authoring ergonomics`;
}

function candidateFix(category: string, components: string[], diagnosticCodes: string[]): string {
  if (category === "schema-interface") {
    return "Align schema enums, semantic aliases, validation messages, and SKILL examples so intuitive values either work or fail with a canonical replacement.";
  }
  if (category === "tool-argument-robustness") {
    return "Parse valid JSON-string object arguments where unambiguous, reject malformed strings with a short canonical example, and keep validation as the only deck write path.";
  }
  if (category === "asset-workflow") {
    return "Add tool/report guidance for output directory creation, CJK font-safe generated visuals, and generated assets that are not referenced by the final deck.";
  }
  if (category === "component-selection-degradation") {
    return "Compare deck_plan.md intended components with final SlideML2 source and report omitted semantic evidence components as soft improvement signals, while keeping agent choice unconstrained.";
  }
  if (category === "component-process-flow") {
    return "Add density-aware process-flow sizing and clearer diagnostics for bullets/formulas so the agent can choose orientation, split content, or reduce steps before rendering fails.";
  }
  if (category === "component-equation") {
    return "Reserve reliable space for equation labels/numbers and validate compact formula grids before they can create tiny math or label regions.";
  }
  if (category === "component-table") {
    return "Estimate table row heights from cell text before layout and suggest rowHeights, fewer rows, wider columns, or slide splitting when content cannot fit.";
  }
  if (category === "component-kpi-stat") {
    return "Improve CJK/mixed-unit value measurement, minimum value-box heights, and compact fallbacks for KPI/stat components.";
  }
  if (category === "component-card-grid") {
    return "Add grid density limits and auto-layout guidance for feature-card/SWOT content so long items do not collapse into unusable rows.";
  }
  if (category === "component-cover-title") {
    return "Clarify title metadata vs visible hero title behavior and make cover caption sizing more tolerant without allowing duplicated visible titles.";
  }
  if (diagnosticCodes.some((code) => ["DROP", "DEMOTED"].includes(code))) {
    return "Track degradation as a first-class quality signal and adjust component defaults so important content is not silently demoted or dropped.";
  }
  return `Improve capacity estimation and diagnostics for ${components.join(", ") || "the affected component"} without adding case-specific workarounds.`;
}

function candidateTests(category: string, components: string[], diagnosticCodes: string[]): string[] {
  if (category === "schema-interface") return [
    "Add schema tests for canonical and accepted alias values.",
    "Add SKILL/doc assertions or snapshots showing canonical tone/variant examples.",
  ];
  if (category === "tool-argument-robustness") return [
    "Add tool tests for object arguments, valid JSON-string arguments, malformed strings, and bad deck paths.",
  ];
  if (category === "asset-workflow") return [
    "Add report extraction tests for unused generated assets and asset tool failures.",
    "Add docs/tool guidance coverage for CJK-safe chart/image generation.",
  ];
  if (category === "component-selection-degradation") return [
    "Add runner/report tests where a planned bar-list or chart-card is omitted from the final source deck.",
    "Add component-level chart-card/bar-list layout tests so reporting distinguishes missing usage from broken implementation.",
  ];
  if (category === "component-table") return [
    "Add table-card tests with CJK multi-line cells and constrained split layouts.",
    "Assert validation reports row/column capacity rather than allowing overlap.",
  ];
  if (category === "component-kpi-stat") return [
    "Add KPI/stat tests with Chinese units, negative percentages, and compact widths.",
    "Assert no SQUASHED/TINY_RECT diagnostics in default layouts.",
  ];
  if (category === "component-process-flow") return [
    "Add horizontal and vertical process-flow tests with bullets, formulas, and arrows.",
    "Assert arrow alignment and no bullet overlap under compact density.",
  ];
  if (category === "component-equation") return [
    "Add compact numbered equation and formula-grid tests.",
    "Assert labels/numbers fit independently from math text.",
  ];
  if (category === "component-card-grid") return [
    "Add feature-card and SWOT density tests with long CJK text.",
    "Assert diagnostics recommend splitting rather than accepting compressed cards.",
  ];
  if (category === "component-cover-title") return [
    "Add cover tests for metadata-only title, visible-only title, matching duplicate title, and long captions.",
  ];
  return [
    `Add focused component tests for ${components.join(", ") || "affected nodes"}.`,
    diagnosticCodes.length ? `Assert diagnostics for ${diagnosticCodes.join(", ")} are actionable.` : "Assert report generation captures recovered friction.",
  ];
}

function signalSeverity(codes: string[]): "high" | "medium" | "low" {
  if (codes.some((code) => ["FALLBACK_FAILED", "SQUASHED", "TINY_RECT"].includes(code))) return "high";
  if (codes.some((code) => ["TRUNCATED", "OVERFLOW", "DROP", "DEMOTED"].includes(code))) return "medium";
  return "low";
}

function primaryComponent(signal: PptGenerationFlowSignal): string {
  return signal.componentTypes[0] || inferComponentFromCategory(signal.category);
}

function primaryDiagnostic(signal: PptGenerationFlowSignal): string {
  return signal.diagnosticCodes[0] || signal.schemaErrorCodes[0] || signal.category;
}

function inferComponentFromCategory(category: string): string {
  return category.startsWith("component-") ? category.slice("component-".length) : category;
}

function priorityRank(priority: "P0" | "P1" | "P2"): number {
  if (priority === "P0") return 0;
  if (priority === "P1") return 1;
  return 2;
}

function slugKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "candidate";
}

function regexAll(value: string, regex: RegExp): string[] {
  const out: string[] = [];
  for (const match of value.matchAll(regex)) {
    if (match[1]) out.push(match[1]);
  }
  return out;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter((value) => value !== undefined && value !== null))];
}

function objectStringValue(value: unknown, key: string): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const child = (value as Record<string, unknown>)[key];
  return typeof child === "string" ? [child] : [];
}

function collectComponentTypes(value: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.type === "string") out.push(record.type);
    for (const child of Object.values(record)) walk(child);
  };
  walk(value);
  return unique(out);
}

function inferComponentTypes(value: string): string[] {
  const lower = value.toLowerCase();
  return componentNamesForReports.filter((name) => lower.includes(name) || lower.includes(name.replace(/-/g, ".")));
}

function summarizeToolSignal(toolName: string, result: string, diagnosticCodes: string[]): string {
  const firstLine = result.split(/\r?\n/).find((line) => line.trim())?.trim() || `${toolName} produced a recoverable signal.`;
  if (diagnosticCodes.length) return `${firstLine} Codes: ${diagnosticCodes.join(", ")}.`;
  return firstLine;
}

function markdownFlowReport(
  caseDefinition: PptGenerationFlowCase | null,
  result: PptGenerationFlowResult,
  verification: PptGenerationFlowVerification,
): string {
  const status = verification.ok ? "PASS" : "FAIL";
  const blockingCount = blockingDiagnosticsCount(result.summary.finalValidateRender);
  const toolRows = result.toolRecords.map((record) => (
    `| ${record.step} | ${record.name} | ${record.success === false ? "fail" : "ok"} | ${record.durationMs ?? ""} | ${escapeMarkdownTable(excerpt(record.result || "", 140))} |`
  )).join("\n");
  const failures = verification.failures.length
    ? verification.failures.map((failure) => `- ${failure}`).join("\n")
    : "- None";
  const outputs = result.summary.outputPaths.length
    ? result.summary.outputPaths.map((output) => `- ${output}`).join("\n")
    : "- None captured";
  return [
    `# PPT Generation Flow Report: ${status}`,
    "",
    `- Case: ${caseDefinition?.id || result.scenario.id}`,
    `- Started: ${new Date(result.startedAt).toISOString()}`,
    `- Duration: ${Math.round(result.durationMs / 1000)}s`,
    `- Working directory: ${result.scenario.workingDirectory}`,
    `- Debug log: ${result.debugLogDirectory || "not enabled"}`,
    `- Final blocking diagnostics: ${Number.isFinite(blockingCount) ? blockingCount : "unknown"}`,
    "",
    "## Verification",
    "",
    failures,
    "",
    "## Outputs",
    "",
    outputs,
    "",
    "## Final Validate Render",
    "",
    "```json",
    JSON.stringify(result.summary.finalValidateRender || null, null, 2),
    "```",
    "",
    "## Tool Timeline",
    "",
    "| Step | Tool | Status | ms | Result excerpt |",
    "| --- | --- | --- | ---: | --- |",
    toolRows || "| - | - | - | - | - |",
    "",
    "## Final Text",
    "",
    "```text",
    excerpt(result.summary.finalText, 4000),
    "```",
    "",
    "## Scenario",
    "",
    "```json",
    JSON.stringify(result.scenario, null, 2),
    "```",
    "",
  ].join("\n");
}

export async function writePptGenerationFlowReport(path: string, result: PptGenerationFlowResult, verification: PptGenerationFlowVerification, caseDefinition?: PptGenerationFlowCase): Promise<void> {
  const fs = await import("node:fs/promises");
  const nodePath = await import("node:path");
  await fs.mkdir(nodePath.dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify({
    ...flowReportPayload(result, verification, caseDefinition),
  }, null, 2));
}

export function summarizePptGenerationFlow(events: AgentEvent[], toolRecords: PptGenerationFlowToolRecord[]): PptGenerationFlowSummary {
  const finalValidateRender = lastValidateRenderResult(toolRecords);
  const outputPaths = new Set<string>();
  collectValidateOutputPaths(finalValidateRender, outputPaths);
  for (const event of events) {
    if (event.type === "long-task-progress") {
      for (const output of event.outputs) if (output.path) outputPaths.add(output.path);
    }
  }
  const toolNames = new Set<string>();
  for (const record of toolRecords.filter((record) => record.result !== undefined || record.input !== undefined)) {
    toolNames.add(record.name);
    const cliAlias = slideml2CliToolAlias(record);
    if (cliAlias) toolNames.add(cliAlias);
  }
  return {
    toolNames: [...toolNames],
    replaceSlideCount: toolRecords.filter((record) => isSuccessfulReplaceSlideRecord(record)).length,
    outputPaths: [...outputPaths],
    finalValidateRender,
    finalText: events.filter((event): event is Extract<AgentEvent, { type: "text-delta" }> => event.type === "text-delta").map((event) => event.text).join(""),
    errors: events.filter((event): event is Extract<AgentEvent, { type: "error" }> => event.type === "error").map((event) => event.error),
    progressEvents: events.filter((event): event is Extract<AgentEvent, { type: "long-task-progress" }> => event.type === "long-task-progress"),
  };
}

function lastValidateRenderResult(toolRecords: PptGenerationFlowToolRecord[]): Record<string, unknown> | undefined {
  for (let index = toolRecords.length - 1; index >= 0; index--) {
    const record = toolRecords[index]!;
    if (!isValidateRenderRecord(record) || record.success !== true || !record.result) continue;
    const input = validateRenderInput(record);
    if (input.render === false) continue;
    const parsed = parseJsonObject(record.result);
    return parsed || recoverValidateRenderResult(record, input);
  }
  return undefined;
}

function recoverValidateRenderResult(record: PptGenerationFlowToolRecord, input: Record<string, unknown>): Record<string, unknown> | undefined {
  const raw = record.result || "";
  const cwd = slideml2CliCwd(record) || ".";
  const outputPath = resolveMaybeRelativePath(
    jsonStringField(raw, "outputPath")
      || (typeof input.outputPath === "string" ? input.outputPath : undefined)
      || (typeof input.out === "string" ? input.out : undefined),
    cwd,
  );
  if (!outputPath) return undefined;
  const diagnosticsPath = resolveMaybeRelativePath(jsonStringField(raw, "diagnosticsPath"), cwd)
    || `${outputPath}.diagnostics.json`;
  const domPath = resolveMaybeRelativePath(jsonStringField(raw, "domPath"), cwd)
    || `${outputPath}.render-tree.json`;
  const diagnostics = readDiagnosticsArray(diagnosticsPath);
  const blocking = diagnostics.filter((item) => item.severity === "error");
  const quality = diagnostics.filter((item) => item.severity !== "error");
  return {
    ok: record.success === true && blocking.length === 0,
    phase: jsonStringField(raw, "phase") || "rendered",
    deckModified: false,
    outputPath,
    domPath,
    diagnosticsPath,
    diagnostics: {
      count: diagnostics.length,
      summary: diagnostics.reduce<Record<string, number>>((acc, item) => {
        const key = typeof item.code === "string" && item.code ? item.code : "UNKNOWN";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      blockingCount: blocking.length,
      blocking: blocking.slice(0, 60),
      qualityCount: quality.length,
      quality: quality.slice(0, 20),
      recoveredFromTruncatedToolResult: true,
    },
  };
}

function jsonStringField(raw: string, key: string): string | undefined {
  const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function resolveMaybeRelativePath(pathValue: string | undefined, cwd: string): string | undefined {
  if (!pathValue) return undefined;
  return nodePath.isAbsolute(pathValue) ? pathValue : nodePath.resolve(cwd, pathValue);
}

function readDiagnosticsArray(pathValue: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(nodeFs.readFileSync(pathValue, "utf8"));
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
      : [];
  } catch {
    return [];
  }
}

function collectValidateOutputPaths(validateResult: Record<string, unknown> | undefined, outputPaths: Set<string>): void {
  if (!validateResult) return;
  for (const key of ["outputPath", "domPath", "diagnosticsPath"]) {
    const value = validateResult[key];
    if (typeof value === "string" && value) outputPaths.add(value);
  }
}

function validateRenderOk(value: Record<string, unknown> | undefined): boolean {
  return value?.ok === true && blockingDiagnosticsCount(value) === 0;
}

function blockingDiagnosticsCount(value: Record<string, unknown> | undefined): number {
  const diagnostics = value?.diagnostics;
  if (!diagnostics || typeof diagnostics !== "object") return Number.POSITIVE_INFINITY;
  const raw = (diagnostics as Record<string, unknown>).blockingCount;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : Number.POSITIVE_INFINITY;
}

function finalValidateOutputPath(value: Record<string, unknown> | undefined): string | undefined {
  return typeof value?.outputPath === "string" ? value.outputPath : undefined;
}

function finalValidateDeckPath(toolRecords: PptGenerationFlowToolRecord[]): string | undefined {
  for (let index = toolRecords.length - 1; index >= 0; index--) {
    const record = toolRecords[index]!;
    if (!isValidateRenderRecord(record) || record.success !== true) continue;
    const input = validateRenderInput(record);
    if (input.render === false) continue;
    if (typeof input.deckPath === "string") return nodePath.isAbsolute(input.deckPath) ? input.deckPath : nodePath.resolve(slideml2CliCwd(record) || ".", input.deckPath);
    const alias = slideml2CliToolAlias(record);
    if (alias === "validate_render" || alias === "render") return nodePath.join(slideml2CliCwd(record) || ".", "deck.json");
    return undefined;
  }
  return undefined;
}

function isSuccessfulReplaceSlideRecord(record: PptGenerationFlowToolRecord): boolean {
  const alias = slideml2CliToolAlias(record);
  return record.success !== false && (record.name === "replace_slide" || alias === "replace_slide" || alias === "add_slide" || alias === "insert_slide" || alias === "set_slide");
}

function isValidateRenderRecord(record: PptGenerationFlowToolRecord): boolean {
  const alias = slideml2CliToolAlias(record);
  return record.name === "validate_render" || alias === "validate_render" || alias === "render";
}

function slideml2CliToolAlias(record: PptGenerationFlowToolRecord): "init_deck" | "reset_deck" | "set_deck" | "add_slide" | "insert_slide" | "set_slide" | "delete_slide" | "diagnose_slide" | "validate" | "render" | "list_slides" | "show_deck" | undefined {
  if (record.name !== "shell") return undefined;
  const input = record.input && typeof record.input === "object" ? record.input as Record<string, unknown> : {};
  const command = Array.isArray(input.command) ? input.command.filter((item): item is string => typeof item === "string") : [];
  if (!command.some((item) => item.includes("slideml2.js") || item.includes("runtime/bin/slideml2"))) return undefined;
  const subcommand = command.find((item) => [
    "init-deck", "reset-deck", "set-deck", "add-slide", "insert-slide", "set-slide", "delete-slide", "diagnose-slide",
    "validate", "render", "list-slides", "show-deck",
  ].includes(item));
  if (subcommand === "init-deck") return "init_deck";
  if (subcommand === "reset-deck") return "reset_deck";
  if (subcommand === "set-deck") return "set_deck";
  if (subcommand === "add-slide") return "add_slide";
  if (subcommand === "insert-slide") return "insert_slide";
  if (subcommand === "set-slide") return "set_slide";
  if (subcommand === "delete-slide") return "delete_slide";
  if (subcommand === "diagnose-slide") return "diagnose_slide";
  if (subcommand === "validate") return "validate";
  if (subcommand === "render") return "render";
  if (subcommand === "list-slides") return "list_slides";
  if (subcommand === "show-deck") return "show_deck";
  return undefined;
}

function validateRenderInput(record: PptGenerationFlowToolRecord): Record<string, unknown> {
  const direct = record.input && typeof record.input === "object" ? record.input as Record<string, unknown> : {};
  if (record.name === "validate_render") return direct;
  const alias = slideml2CliToolAlias(record);
  if (alias === "render") {
    const deckPath = slideml2CliFlagValue(record, "--deck");
    const outputPath = slideml2CliFlagValue(record, "--out");
    return {
      ...direct,
      render: true,
      ...(deckPath ? { deckPath } : {}),
      ...(outputPath ? { outputPath } : {}),
    };
  }
  if (alias === "validate") {
    const deckPath = slideml2CliFlagValue(record, "--deck");
    return { ...direct, render: false, ...(deckPath ? { deckPath } : {}) };
  }
  const argPath = slideml2CliArgsPath(record);
  if (!argPath) return direct;
  try {
    const raw = nodeFs.readFileSync(argPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : direct;
  } catch {
    return direct;
  }
}

function slideml2CliArgsPath(record: PptGenerationFlowToolRecord): string | undefined {
  const input = record.input && typeof record.input === "object" ? record.input as Record<string, unknown> : {};
  const command = Array.isArray(input.command) ? input.command.filter((item): item is string => typeof item === "string") : [];
  const subcommandIndex = command.findIndex((item) => [
    "init-deck", "reset-deck", "set-deck", "add-slide", "insert-slide", "set-slide", "diagnose-slide",
  ].includes(item));
  const subcommand = subcommandIndex >= 0 ? command[subcommandIndex] : undefined;
  let argOffset = subcommand === "set-slide" ? 2 : 1;
  if (subcommand === "insert-slide") {
    const maybeFlagForm = command[subcommandIndex + 2]?.startsWith("--");
    argOffset = maybeFlagForm ? 1 : 2;
  }
  const argPath = subcommandIndex >= 0 ? command[subcommandIndex + argOffset] : undefined;
  if (!argPath) return undefined;
  if (argPath.startsWith("--")) return undefined;
  return nodePath.isAbsolute(argPath) ? argPath : nodePath.resolve(slideml2CliCwd(record) || ".", argPath);
}

function slideml2CliFlagValue(record: PptGenerationFlowToolRecord, flag: string): string | undefined {
  const input = record.input && typeof record.input === "object" ? record.input as Record<string, unknown> : {};
  const command = Array.isArray(input.command) ? input.command.filter((item): item is string => typeof item === "string") : [];
  const index = command.indexOf(flag);
  const raw = index >= 0 ? command[index + 1] : undefined;
  if (!raw || raw.startsWith("--")) return undefined;
  return nodePath.isAbsolute(raw) ? raw : nodePath.resolve(slideml2CliCwd(record) || ".", raw);
}

function slideml2CliCwd(record: PptGenerationFlowToolRecord): string | undefined {
  const input = record.input && typeof record.input === "object" ? record.input as Record<string, unknown> : {};
  return typeof input.cwd === "string" ? input.cwd : undefined;
}

async function pptxXmlCorpus(outputPath: string): Promise<string> {
  const buffer = await nodeFs.promises.readFile(outputPath);
  return zipTextEntries(buffer)
    .filter((entry) => entry.name.endsWith(".xml") || entry.name.endsWith(".rels"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => entry.text)
    .join("\n");
}

function zipTextEntries(buffer: Buffer): Array<{ name: string; text: string }> {
  const eocdOffset = findZipEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error("not a ZIP/PPTX file: end of central directory was not found");
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const out: Array<{ name: string; text: string }> = [];
  for (let index = 0; index < entryCount; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`invalid ZIP central directory at offset ${offset}`);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;
    if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error(`invalid ZIP local header for ${name}`);
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const raw = method === 0
      ? compressed
      : method === 8
        ? inflateRawSync(compressed)
        : undefined;
    if (!raw) throw new Error(`unsupported ZIP compression method ${method} for ${name}`);
    out.push({ name, text: raw.toString("utf8") });
  }
  return out;
}

function findZipEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

async function pathExists(path: string): Promise<boolean> {
  const fs = await import("node:fs/promises");
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function firstExistingPath(paths: string[]): Promise<string | null> {
  for (const candidate of paths) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

function resolveCasePath(caseDirectory: string, value: string): string {
  return nodePath.isAbsolute(value) ? nodePath.normalize(value) : nodePath.resolve(caseDirectory, value);
}

function normalizeCaseExpectations(
  caseDirectory: string,
  outputsDirectory: string,
  id: string,
  expected: PptGenerationFlowExpectations | undefined,
): PptGenerationFlowExpectations {
  const outputPath = expected?.outputPath
    ? resolveCasePath(caseDirectory, expected.outputPath)
    : nodePath.join(outputsDirectory, `${id}.pptx`);
  return {
    requiredTools: ["init_deck", "add_slide", "render"],
    minReplaceSlideCalls: 1,
    requireProgressDone: true,
    requireFinalValidateRender: true,
    requirePptxOutput: true,
    maxBlockingDiagnostics: 0,
    ...expected,
    outputPath,
  };
}

function expandTemplates(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === "string") return expandTemplateString(value, vars);
  if (Array.isArray(value)) return value.map((item) => expandTemplates(item, vars));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) out[key] = expandTemplates(child, vars);
    return out;
  }
  return value;
}

function expandTemplateString(value: string, vars: Record<string, string>): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => vars[key] ?? match);
}

function reportRunId(startedAt: number): string {
  return new Date(startedAt).toISOString().replace(/[:.]/g, "-");
}

function excerpt(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1)}…`;
}

function escapeMarkdownTable(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

class PptGenerationFlowMonitor extends DebugLogger {
  readonly events: PptGenerationMonitorEvent[] = [];
  readonly llmSends: PptGenerationFlowResult["llmSends"] = [];
  readonly llmResponses: PptGenerationFlowResult["llmResponses"] = [];
  private readonly byToolCallId = new Map<string, PptGenerationFlowToolRecord>();
  private readonly forward?: DebugLogger;
  private debugDirectory: string | null = null;

  constructor(requestId: string, forward?: DebugLogger) {
    super(requestId);
    this.forward = forward;
  }

  override get directory(): string | null {
    return this.debugDirectory || this.forward?.directory || null;
  }

  override async init(meta: { sessionId: string; query: string; planMode: boolean; workingDirectory?: string }): Promise<void> {
    this.events.push({ event: "init", payload: meta });
    if (this.forward) {
      await this.forward.init(meta);
      this.debugDirectory = this.forward.directory;
    }
  }

  override async recordSend(payload: PptGenerationFlowResult["llmSends"][number]): Promise<void> {
    this.llmSends.push(payload);
    this.events.push({ event: "llm-send", payload });
    await this.forward?.recordSend(payload);
  }

  override async recordResponse(payload: PptGenerationFlowResult["llmResponses"][number]): Promise<void> {
    this.llmResponses.push(payload);
    this.events.push({ event: "llm-response", payload });
    await this.forward?.recordResponse(payload);
  }

  override async recordToolStart(payload: { step: number; name: string; input: unknown; toolCallId: string }): Promise<void> {
    this.events.push({ event: "tool-start", payload });
    this.byToolCallId.set(payload.toolCallId, {
      step: payload.step,
      name: payload.name,
      toolCallId: payload.toolCallId,
      input: payload.input,
    });
    await this.forward?.recordToolStart(payload);
  }

  override async recordToolDone(payload: { step: number; name: string; toolCallId: string; result: string; success: boolean; durationMs: number }): Promise<void> {
    this.events.push({ event: "tool-done", payload });
    const existing = this.byToolCallId.get(payload.toolCallId);
    this.byToolCallId.set(payload.toolCallId, {
      step: payload.step,
      name: payload.name,
      toolCallId: payload.toolCallId,
      input: existing?.input,
      result: payload.result,
      success: payload.success,
      durationMs: payload.durationMs,
    });
    await this.forward?.recordToolDone(payload);
  }

  override async recordError(payload: { step: number; error: string; phase: string }): Promise<void> {
    this.events.push({ event: "error", payload });
    await this.forward?.recordError(payload);
  }

  override async recordCompacted(payload: { summary: string; preservedUserMessages: number; estimatedTokens: number }): Promise<void> {
    this.events.push({ event: "compacted", payload });
    await this.forward?.recordCompacted(payload);
  }

  override async recordContextManifest(payload: unknown): Promise<void> {
    this.events.push({ event: "context-manifest", payload });
    await this.forward?.recordContextManifest(payload);
  }

  override async recordCompleted(payload: { totalSteps: number; hitStepLimit: boolean; finalText: string }): Promise<void> {
    this.events.push({ event: "completed", payload });
    await this.forward?.recordCompleted(payload);
  }

  toolRecords(): PptGenerationFlowToolRecord[] {
    return [...this.byToolCallId.values()].sort((a, b) => a.step - b.step || a.toolCallId.localeCompare(b.toolCallId));
  }
}
