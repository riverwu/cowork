#!/usr/bin/env node
/**
 * Agent end-to-end harness against the user's real LLM.
 *
 * Reads cowork's settings DB to get the configured Anthropic-compatible
 * endpoint, exposes the same SlideML tool surface the production agent
 * sees, and drives a suite of realistic deck-generation scenarios.
 *
 * For each scenario it captures: full step-by-step trace, tool-call
 * counts, retry count, token usage, duration, and a post-render audit
 * (python-pptx round-trip + LibreOffice → PDF). At the end it prints a
 * summary table and writes a JSON report to /tmp/slideml-e2e/report.json.
 *
 * Scenarios run in parallel (concurrency=3) by default. Pass
 * SCENARIOS=name1,name2 to run a subset.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SLIDEML_ROOT = resolve(__dirname, "..");
const CLI = join(SLIDEML_ROOT, "dist/bin/slideml.js");
const THEME_DIR = join(SLIDEML_ROOT, "dist/themes/technical-blue");
const OUT_DIR = "/tmp/slideml-e2e";
const REPORT_PATH = join(OUT_DIR, "report.json");
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 3);
mkdirSync(OUT_DIR, { recursive: true });

// ============================================================================
// 1. Load LLM config from cowork's DB
// ============================================================================
const DB = join(homedir(), "Library/Application Support/cowork/cowork.db");
function dbGet(key) {
  const r = spawnSync("sqlite3", [DB, `SELECT value FROM settings WHERE key='${key}'`], { encoding: "utf8" });
  return r.stdout.trim() || null;
}
const apiKey = dbGet("anthropic_api_key");
const baseUrl = (dbGet("anthropic_base_url") || "https://api.anthropic.com").replace(/\/+$/, "");
const model = dbGet("model_id") || "claude-sonnet-4-20250514";
const maxOutputTokens = Number(dbGet("model_max_output_tokens")) || 8192;
if (!apiKey) {
  console.error("No anthropic_api_key in cowork DB. Configure in Settings first.");
  process.exit(2);
}
console.log(`Using ${model} @ ${baseUrl}`);
console.log(`Max output tokens: ${maxOutputTokens}`);
console.log(`Concurrency: ${CONCURRENCY}\n`);

// ============================================================================
// 2. Tool surface — mirrors the production cowork tools
// ============================================================================
const tools = [
  {
    name: "list_slide_layouts",
    description:
      "List the slide layouts a SlideML theme exposes — name + one-line purpose + slot names only (compact). Call FIRST when planning a deck. After picking 4-6 layouts, call describe_slide_layout for each. Default theme: technical-blue.",
    input_schema: {
      type: "object",
      properties: {
        theme: { type: "string", description: "Theme name. Defaults to 'technical-blue'." },
      },
      required: [],
    },
  },
  {
    name: "describe_slide_layout",
    description:
      "Fetch the full slot schema for ONE layout, with copy-pasteable example payloads attached to typed slots (chart-spec, table, image-ref, bullets). Call AFTER list_slide_layouts for each layout you'll use.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Layout name from list_slide_layouts." },
        theme: { type: "string", description: "Theme name. Defaults to 'technical-blue'." },
      },
      required: ["name"],
    },
  },
  {
    name: "validate_slideml",
    description:
      "Dry-run validate a SlideML YAML body — no file written. Use before render_slideml on long decks to catch errors cheaply. Returns OK or a list of [CODE] messages.",
    input_schema: {
      type: "object",
      properties: {
        slideml: { type: "string", description: "Full SlideML YAML body." },
        theme: { type: "string", description: "Theme name. Defaults to 'technical-blue'." },
      },
      required: ["slideml"],
    },
  },
  {
    name: "render_slideml",
    description:
      `Compile a SlideML YAML deck to a .pptx. PREFERRED over hand-rolled pptxgenjs. Writes both the .pptx AND a sibling <output_path>.slideml source file.

Workflow:
1. list_slide_layouts → pick 4-6 layouts.
2. describe_slide_layout for each pick → study slot schemas + examples.
3. (optional) validate_slideml to dry-run before rendering.
4. render_slideml with absolute output_path.
5. On validation failure, the error names the offending slot — fix and retry.

Top-level grammar:
slideml: 1
deck: { size: 16x9, language: zh-CN | en-US, theme: technical-blue }
slides:
  - layout: <name>
    chrome: default | none
    notes: "..."          # 1-2 sentences of speaker notes — recommended on every content slide
    slots: { ... }

Hard rules:
- NEVER put coordinates, hex colors, or font sizes in YAML — owned by the theme.
- Match each layout's slot schema exactly. Get the precise shape via describe_slide_layout.`,
    input_schema: {
      type: "object",
      properties: {
        slideml: { type: "string", description: "Full SlideML YAML body." },
        theme: { type: "string", description: "Theme name. Defaults to 'technical-blue'." },
        output_path: { type: "string", description: "Absolute path to write the .pptx. Sibling .slideml source written automatically." },
      },
      required: ["slideml", "output_path"],
    },
  },
  {
    name: "read_file",
    description:
      "Read a UTF-8 text file. Use this on a previously rendered deck's sidecar (`<output>.pptx.slideml`) to pick up the source for further edits.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file." },
      },
      required: ["path"],
    },
  },
  {
    name: "update_task_progress",
    description:
      "Update the visible plan/progress panel. Call once with phase='plan' and a multi-line summary; call again with status='done' and outputs[] at the end.",
    input_schema: {
      type: "object",
      properties: {
        phase: { type: "string" },
        status: { type: "string", enum: ["pending", "running", "done", "failed"] },
        summary: { type: "string" },
        outputs: { type: "array", items: { type: "object", properties: { title: { type: "string" }, path: { type: "string" } } } },
      },
      required: ["phase", "status", "summary"],
    },
  },
];

const SYSTEM_PROMPT = `You are Cowork, an AI work assistant.

For ANY slide-deck deliverable, use the SlideML toolchain — it's typed, theme-driven, and produces files that open cleanly in PowerPoint.

Workflow for "make me a deck":
1. update_task_progress with phase=plan and a multi-line plan listing each slide.
2. list_slide_layouts to see compact summaries.
3. describe_slide_layout for each layout you'll use — read the example field for typed slots.
4. Ground the content. If you don't have real numbers / data / images for the slots, ASK the user before fabricating. Never invent KPIs, percentages, or quoted figures. Real numbers given in the prompt should appear verbatim in the deck.
5. Write SlideML YAML. NEVER put coordinates, hex colors, or font sizes — owned by theme. Add notes: on every content slide. Bullets are TERSE (typically 5-12 words; never full sentences with em-dashes); long prose belongs in notes:. Chart format is always an OBJECT { y: "int" | "decimal" | "percent" | "wanyuan" | "yi" } — never a bare string.
6. (Optional) validate_slideml on long decks before paying render cost.
7. render_slideml with absolute output_path.
8. On validation error, the message names the offending slot — fix and retry.
9. update_task_progress with status=done and the produced file in outputs.

Editing an existing deck: read the sidecar at <output_path>.slideml first, mutate the YAML, then call render_slideml again.

Do not use raw pptxgenjs. Keep chat text concise.`;

// ============================================================================
// 3. Tool dispatch
// ============================================================================
function dispatchTool(name, input) {
  if (name === "list_slide_layouts") {
    const r = spawnSync("node", [CLI, "layouts", "--theme", THEME_DIR, "--json"], { encoding: "utf8" });
    if (r.status !== 0) return `ERROR: ${r.stderr || r.stdout}`;
    return r.stdout;
  }
  if (name === "describe_slide_layout") {
    const layoutName = String(input.name || "");
    if (!layoutName) return "ERROR: name is required";
    const r = spawnSync("node", [CLI, "describe", layoutName, "--theme", THEME_DIR, "--json"], { encoding: "utf8" });
    if (r.status !== 0) return `ERROR: ${(r.stderr || r.stdout).trim()}`;
    return r.stdout;
  }
  if (name === "validate_slideml") {
    const slideml = String(input.slideml || "");
    if (!slideml) return "ERROR: slideml is required";
    const tmp = join(OUT_DIR, `validate-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.yaml`);
    writeFileSync(tmp, slideml);
    const r = spawnSync("node", [CLI, "validate", tmp, "--theme", THEME_DIR], { encoding: "utf8" });
    if (r.status === 0) return "OK — deck validates against theme.";
    return `Validation failed:\n${(r.stderr || r.stdout).trim()}`;
  }
  if (name === "render_slideml") {
    const slideml = String(input.slideml || "");
    const outputPath = String(input.output_path || "");
    if (!slideml || !outputPath) return "ERROR: slideml and output_path are required";
    const tmp = join(OUT_DIR, `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.yaml`);
    writeFileSync(tmp, slideml);
    const r = spawnSync("node", [CLI, "compile", tmp, "--theme", THEME_DIR, "-o", outputPath], { encoding: "utf8" });
    if (r.status !== 0) return `ERROR: ${(r.stderr || r.stdout).trim()}`;
    return `Wrote ${outputPath} (sidecar: ${outputPath}.slideml)`;
  }
  if (name === "read_file") {
    const path = String(input.path || "");
    if (!path) return "ERROR: path is required";
    if (!existsSync(path)) return `ERROR: ${path} does not exist`;
    return readFileSync(path, "utf8");
  }
  if (name === "update_task_progress") {
    return `Task progress recorded — phase "${input.phase}", status "${input.status}".`;
  }
  return `Unknown tool: ${name}`;
}

// ============================================================================
// 4. Anthropic-compatible HTTP loop
// ============================================================================
async function runAgent(scenarioName, userPrompt, opts = {}) {
  const log = [];
  const messages = [{ role: "user", content: userPrompt }];
  const counts = { list: 0, describe: 0, validate: 0, render: 0, read: 0, progress: 0, other: 0 };
  const renderResults = [];
  const turnDurations = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let stopReason = "unknown";

  for (let step = 0; step < (opts.maxSteps ?? 24); step++) {
    log.push(`\n=== step ${step + 1} ===`);
    const body = { model, max_tokens: maxOutputTokens, system: SYSTEM_PROMPT, messages, tools };

    const t0 = Date.now();
    let response;
    try {
      response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      log.push(`HTTP ERROR: ${err.message}`);
      stopReason = "http_error";
      break;
    }
    if (!response.ok) {
      const t = await response.text();
      log.push(`HTTP ${response.status}: ${t.slice(0, 600)}`);
      stopReason = `http_${response.status}`;
      break;
    }
    const data = await response.json();
    const dur = Date.now() - t0;
    turnDurations.push(dur);
    log.push(`stop_reason=${data.stop_reason} dur=${dur}ms in=${data.usage?.input_tokens ?? "?"} out=${data.usage?.output_tokens ?? "?"}`);
    totalInputTokens += data.usage?.input_tokens ?? 0;
    totalOutputTokens += data.usage?.output_tokens ?? 0;
    stopReason = data.stop_reason ?? stopReason;

    messages.push({ role: "assistant", content: data.content });

    let textOut = "";
    const toolUses = [];
    for (const block of data.content || []) {
      if (block.type === "text") textOut += block.text;
      else if (block.type === "tool_use") toolUses.push(block);
    }
    if (textOut.trim()) log.push(`text: ${textOut.trim().slice(0, 800)}`);

    if (toolUses.length === 0) {
      log.push("(no tool calls; ending loop)");
      break;
    }

    const toolResults = [];
    for (const tu of toolUses) {
      const inputPreview = JSON.stringify(tu.input).slice(0, 280);
      log.push(`tool: ${tu.name}(${inputPreview}…)`);
      if (tu.name === "list_slide_layouts") counts.list++;
      else if (tu.name === "describe_slide_layout") counts.describe++;
      else if (tu.name === "validate_slideml") counts.validate++;
      else if (tu.name === "render_slideml") counts.render++;
      else if (tu.name === "read_file") counts.read++;
      else if (tu.name === "update_task_progress") counts.progress++;
      else counts.other++;

      const result = dispatchTool(tu.name, tu.input);
      const resultPreview = result.slice(0, 600);
      log.push(`result: ${resultPreview}${result.length > 600 ? "…" : ""}`);
      if (tu.name === "render_slideml") {
        renderResults.push({ input: tu.input, result });
      }
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return {
    scenarioName,
    counts,
    renderResults,
    log,
    turns: turnDurations.length,
    totalInputTokens,
    totalOutputTokens,
    stopReason,
    lastAssistantText: lastAssistantText(messages),
  };
}

function lastAssistantText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assistant") continue;
    const c = messages[i].content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      const t = c.find((b) => b.type === "text");
      if (t) return t.text;
    }
  }
  return "";
}

// ============================================================================
// 5. Audit a produced .pptx
// ============================================================================
function auditPptx(outPath) {
  if (!existsSync(outPath)) return { ok: false, reason: "file does not exist" };
  const py = spawnSync("python3", ["-c", `
import sys
from pptx import Presentation
try:
    p = Presentation(sys.argv[1])
    print(f"OK {len(p.slides)} slides {sum(len(s.shapes) for s in p.slides)} shapes")
except Exception as e:
    print(f"FAIL {type(e).__name__}: {e}")
    sys.exit(1)
`, outPath], { encoding: "utf8" });
  if (py.status !== 0) return { ok: false, reason: py.stdout || py.stderr };
  const m = /OK (\d+) slides (\d+) shapes/.exec(py.stdout);
  const slides = m ? Number(m[1]) : null;
  const shapes = m ? Number(m[2]) : null;

  // Render to PDF as a stronger smoke test if LibreOffice is present.
  const so = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
  let pdfOk = null;
  if (existsSync(so)) {
    const r = spawnSync(so, ["--headless", "--norestore", "--nolockcheck", "--convert-to", "pdf", "--outdir", OUT_DIR, outPath], { encoding: "utf8" });
    pdfOk = r.status === 0 && !r.stderr.trim();
  }
  return { ok: true, slides, shapes, pdfOk };
}

// ============================================================================
// 6. Scenarios — broader coverage of layouts and patterns
// ============================================================================
const ALL_SCENARIOS = [
  {
    name: "zh-quarterly",
    expect: { layouts: ["cover", "stat-grid-3", "chart-with-takeaway", "closing"] },
    prompt: `做一个 2026 Q1 硬件业务经营分析的 PPT，5-7 页，包含：
- 封面
- 核心 KPI（收入、用户、毛利率）
- 各产品线收入对比图
- 季度结论与下季度计划
- 结尾页

我提供的真实数据：
- 总收入 8.23 亿元（+12% YoY）
- 月活用户 3,400 万（+8%）
- 毛利率 39.8%（去年同期 42%）
- 各产品线 Q1 收入：智能音箱 320，可穿戴 240，路由器 180，配件 83（单位：百万元）

输出到 /tmp/slideml-e2e/zh-quarterly.pptx`,
  },
  {
    name: "en-product-update",
    expect: { layouts: ["cover", "stat-grid-3", "chart-with-takeaway", "closing"] },
    prompt: `Generate a 5-slide product update for the engineering team. Cover:
- Title slide
- Three reliability KPIs (availability, P99 latency, SEV-1 outages)
- A line chart of P99 latency over 6 weeks
- A short list of what we shipped this quarter
- A closing thank-you

Real data:
- Availability: 99.97% (+0.04%)
- P99 latency: 142ms (-18%)
- SEV-1 outages this quarter: 1 (down from 3)
- Weekly P99 (ms): wk1=180, wk2=165, wk3=158, wk4=150, wk5=145, wk6=142
- Shipped: connection multiplexing on gateway; hot-cache warming; adaptive backpressure; per-tenant rate-limit isolation

Output to /tmp/slideml-e2e/en-product-update.pptx`,
  },
  {
    name: "zh-with-table",
    expect: { layouts: ["cover", "data-table", "compare-two-columns", "closing"] },
    prompt: `生成一个 4 页的 PPT 对比 AI 同传 vs 人工同传 vs 字幕生成三种服务，包括：
- 封面
- 一张数据表格（头部：维度/AI 同传/人工同传/字幕生成；行：延迟、单价、覆盖语种）
- 一张对比说明（左：AI 优势；右：人工优势）
- 结尾页

真实数据：
- 延迟：AI 同传 ≤2s / 人工同传 0s / 字幕 5-10s
- 单价（每分钟，人民币）：AI 4 元 / 人工 30 元 / 字幕 8 元
- 覆盖语种：AI 70+ / 人工 12 / 字幕 50+

输出到 /tmp/slideml-e2e/zh-with-table.pptx`,
  },
  {
    name: "en-process-timeline",
    expect: { layouts: ["cover", "process-timeline"] },
    prompt: `Make a 3-slide deck explaining our incident response process. Use a process-timeline layout for the steps.

Steps (use these exactly):
1. Detect — alerts fire from Prometheus / SLO burn rate
2. Triage — on-call assesses severity (SEV1/SEV2/SEV3)
3. Mitigate — apply runbook rollback or feature flag kill-switch
4. Communicate — status page + customer comms within 15 min
5. Postmortem — blameless write-up within 5 business days

Output to /tmp/slideml-e2e/en-process-timeline.pptx`,
  },
  {
    name: "en-long-deck",
    expect: { minSlides: 9 },
    prompt: `Generate a comprehensive 10-slide investor update. Use a mix of layouts (cover, agenda, section-divider, stat-grid-3, chart-with-takeaway, data-table, compare-two-columns, closing).

Real numbers (use exactly):
- ARR: $42.5M (+85% YoY)
- Net retention: 128%
- Logo retention: 96%
- Burn multiple: 1.2
- Cash runway: 22 months
- Quarterly revenue ($M): Q1=8.2, Q2=9.6, Q3=11.3, Q4=13.4
- Top 3 segments by ARR: Enterprise $24M, Mid-market $13M, SMB $5.5M

Sections:
1. Headline metrics
2. Growth trajectory
3. Segment performance
4. What's next

Output to /tmp/slideml-e2e/en-long-deck.pptx`,
  },
  {
    name: "en-quote",
    expect: { layouts: ["quote"] },
    prompt: `A 3-slide deck for an internal all-hands. Open with a cover, then a single quote slide (use the quote layout) with this exact quote:

> "We are not building a product, we are building a category."
> — Marc, CEO, 2026 kickoff

Close with a thank-you.

Output to /tmp/slideml-e2e/en-quote.pptx`,
  },
  {
    name: "en-iterate",
    iterate: true,
    prompt: `First, generate this 4-slide deck and write it to /tmp/slideml-e2e/en-iterate.pptx:
- Cover: "Mid-quarter review" / subtitle "April 2026"
- stat-grid-3 with KPIs (use placeholders if unsure): availability 99.95%, latency 150ms, MTTR 12 min
- bullet-with-image showing 3 wins (no image needed)
- closing thank-you

After it succeeds, READ THE SIDECAR FILE at /tmp/slideml-e2e/en-iterate.pptx.slideml, change the cover subtitle to "May 2026 update", and re-render to the same path.

Confirm both renders succeeded.`,
  },
  {
    name: "zh-grounded-refusal",
    expect: { ground: true },
    prompt: `给我做一个 SaaS 业务的季度复盘 PPT，5-6 页，要展示真实的 ARR、流失率、NPS 数字。

(注意：这次我没有提供任何具体数字。)

输出到 /tmp/slideml-e2e/zh-grounded-refusal.pptx`,
  },
];

const filter = (process.env.SCENARIOS || "").split(",").map((s) => s.trim()).filter(Boolean);
const scenarios = filter.length ? ALL_SCENARIOS.filter((s) => filter.includes(s.name)) : ALL_SCENARIOS;
console.log(`Running ${scenarios.length} scenarios (concurrency=${CONCURRENCY})…\n`);

// ============================================================================
// 7. Parallel execution with bounded concurrency
// ============================================================================
async function runScenario(sc) {
  const t0 = Date.now();
  console.log(`▶ start ${sc.name}`);
  const result = await runAgent(sc.name, sc.prompt, { maxSteps: sc.iterate ? 32 : 20 });
  const dur = Date.now() - t0;
  const logPath = join(OUT_DIR, `${sc.name}.log`);
  writeFileSync(logPath, result.log.join("\n"));

  // Audit each render (last one is canonical).
  const audits = [];
  for (let i = 0; i < result.renderResults.length; i++) {
    const r = result.renderResults[i];
    const isError = r.result.startsWith("ERROR");
    if (isError) {
      audits.push({ attempt: i + 1, ok: false, error: r.result.slice(0, 240) });
      continue;
    }
    const out = r.input.output_path;
    audits.push({ attempt: i + 1, path: out, ...auditPptx(out) });
  }

  // A scenario "passes" if either:
  //   (a) it produced at least one valid .pptx, OR
  //   (b) it correctly refused to fabricate (no render + asks user for data).
  const goodRender = audits.find((a) => a.ok);
  // A genuine refusal asks the user for the missing inputs. Match common
  // patterns across English/Chinese without overfitting to one phrasing.
  const refusalText = result.lastAssistantText.match(
    /(请[^。\n]*提供|提供[^。\n]*(数据|数字|信息)|缺少[^。\n]*数据|provide.*data|share.*data|need.*(data|numbers)|don't have|missing.*(data|metrics))/i
  );
  const validRefusal = !goodRender && !!refusalText && result.counts.render === 0;
  const retries = audits.filter((a) => !a.ok).length;
  const pass = !!goodRender || validRefusal;

  // Layout coverage check (when expected).
  let layoutCheck = null;
  if (goodRender && sc.expect?.layouts) {
    const sidecarPath = `${goodRender.path}.slideml`;
    if (existsSync(sidecarPath)) {
      const yaml = readFileSync(sidecarPath, "utf8");
      const usedLayouts = [...yaml.matchAll(/^\s+- layout:\s*(\S+)/gm)].map((m) => m[1]);
      const missing = sc.expect.layouts.filter((l) => !usedLayouts.includes(l));
      layoutCheck = { used: usedLayouts, expected: sc.expect.layouts, missing };
    }
  }

  console.log(`◀ done  ${sc.name} pass=${pass} dur=${(dur / 1000).toFixed(1)}s turns=${result.turns} retries=${retries} render=${result.counts.render} in=${result.totalInputTokens} out=${result.totalOutputTokens}`);

  return {
    scenario: sc.name,
    pass,
    refusal: validRefusal,
    durationMs: dur,
    turns: result.turns,
    retries,
    counts: result.counts,
    tokens: { input: result.totalInputTokens, output: result.totalOutputTokens },
    audits,
    layoutCheck,
    stopReason: result.stopReason,
    logPath,
  };
}

async function runWithConcurrency(items, n) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await runScenario(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
}

const results = await runWithConcurrency(scenarios, CONCURRENCY);

// ============================================================================
// 8. Aggregate report
// ============================================================================
console.log(`\n\n========================== RESULTS ==========================`);
console.log("scenario              | pass | turns | retries | render | tokens-in | tokens-out | dur(s)");
console.log("----------------------|------|-------|---------|--------|-----------|------------|-------");
for (const r of results) {
  const pass = r.pass ? (r.refusal ? "REFUSE" : "✓") : "✗";
  console.log(
    `${r.scenario.padEnd(22)}| ${pass.padEnd(5)}| ${String(r.turns).padEnd(6)}| ${String(r.retries).padEnd(8)}| ${String(r.counts.render).padEnd(7)}| ${String(r.tokens.input).padEnd(10)}| ${String(r.tokens.output).padEnd(11)}| ${(r.durationMs / 1000).toFixed(1)}`
  );
}
const passCount = results.filter((r) => r.pass).length;
const totalIn = results.reduce((s, r) => s + r.tokens.input, 0);
const totalOut = results.reduce((s, r) => s + r.tokens.output, 0);
console.log(`\n${passCount}/${results.length} pass · ${totalIn} input tokens · ${totalOut} output tokens`);

// Per-scenario findings.
const findings = [];
for (const r of results) {
  if (!r.pass) findings.push(`[${r.scenario}] FAIL — stop=${r.stopReason}, last audit error: ${r.audits.find((a) => !a.ok)?.error || "no render attempt"}`);
  if (r.retries > 0) findings.push(`[${r.scenario}] ${r.retries} retry/retries before success`);
  if (r.layoutCheck && r.layoutCheck.missing.length > 0) {
    findings.push(`[${r.scenario}] missing expected layouts: ${r.layoutCheck.missing.join(", ")}`);
  }
}
console.log(`\nFindings (${findings.length}):`);
for (const f of findings) console.log(`  • ${f}`);

writeFileSync(REPORT_PATH, JSON.stringify({
  meta: { model, baseUrl, when: new Date().toISOString(), concurrency: CONCURRENCY },
  results,
  findings,
}, null, 2));
console.log(`\nFull report: ${REPORT_PATH}`);

process.exit(passCount === results.length ? 0 : 1);
