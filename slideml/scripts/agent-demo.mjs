#!/usr/bin/env node
/**
 * One-shot real-LLM demo: drives the production-shape agent loop with a
 * single realistic prompt, renders the deck to ~/Desktop, audits it, and
 * opens it so you can see the result. Reuses the same tool surface as
 * agent-e2e-test.mjs.
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SLIDEML_ROOT = resolve(__dirname, "..");
const CLI = join(SLIDEML_ROOT, "dist/bin/slideml.js");
const THEME_DIR = join(SLIDEML_ROOT, "dist/themes/technical-blue");
const TMP = "/tmp/slideml-demo";
mkdirSync(TMP, { recursive: true });

const OUTPUT = join(homedir(), "Desktop", "Acme-Q1-2026-Business-Review.pptx");

// ─── LLM config from cowork's settings DB ───────────────────────────────────
const DB = join(homedir(), "Library/Application Support/cowork/cowork.db");
const dbGet = (k) => spawnSync("sqlite3", [DB, `SELECT value FROM settings WHERE key='${k}'`], { encoding: "utf8" }).stdout.trim() || null;
const apiKey = dbGet("anthropic_api_key");
const baseUrl = (dbGet("anthropic_base_url") || "https://api.anthropic.com").replace(/\/+$/, "");
const model = dbGet("model_id") || "claude-sonnet-4-20250514";
const maxTokens = Number(dbGet("model_max_output_tokens")) || 8192;
if (!apiKey) { console.error("No anthropic_api_key in cowork DB"); process.exit(2); }
console.log(`Model: ${model} @ ${baseUrl}`);
console.log(`Output: ${OUTPUT}\n`);

// ─── Tool surface ───────────────────────────────────────────────────────────
const tools = [
  { name: "list_slide_layouts", description: "Compact list of layouts in the SlideML theme. Call FIRST.", input_schema: { type: "object", properties: { theme: { type: "string" } }, required: [] } },
  { name: "describe_slide_layout", description: "Full slot schema + example payloads for ONE layout. Call after list_slide_layouts for each pick.", input_schema: { type: "object", properties: { name: { type: "string" }, theme: { type: "string" } }, required: ["name"] } },
  { name: "validate_slideml", description: "Dry-run validate a SlideML YAML body — no file written.", input_schema: { type: "object", properties: { slideml: { type: "string" }, theme: { type: "string" } }, required: ["slideml"] } },
  { name: "render_slideml", description: "Compile SlideML YAML to .pptx. Writes both the .pptx and a sibling <output>.slideml source file. NEVER put coordinates / hex colors / font sizes in YAML — owned by theme. Bullets are TERSE (5–12 words). Chart format is { y: int|decimal|percent|wanyuan|yi }.", input_schema: { type: "object", properties: { slideml: { type: "string" }, theme: { type: "string" }, output_path: { type: "string" } }, required: ["slideml", "output_path"] } },
];

const SYSTEM = `You are Cowork, an AI work assistant. For any slide-deck request use the SlideML toolchain.

Workflow: list_slide_layouts → describe_slide_layout for each pick → write YAML → optionally validate_slideml → render_slideml.

Rules:
- NEVER put coordinates, hex colors, or font sizes in YAML — owned by theme.
- Add notes: (1-2 sentences) on every content slide.
- Bullets are TERSE (5-12 words, never full sentences with em-dashes); long prose belongs in notes:.
- Chart format is always { y: "int" | "decimal" | "percent" | "wanyuan" | "yi" } — never a bare string.
- Use the real numbers given in the prompt verbatim.
- For Chinese decks set deck.language: zh-CN.`;

// ─── Realistic prompt — Chinese SaaS Q1 2026 board review ────────────────────
const PROMPT = `请为 Acme SaaS 公司生成一份 2026 Q1 董事会汇报 PPT，10-12 页，中文。

## 真实数据（必须原样使用）

**核心 KPI（季度末）**
- ARR：5,820 万美元（去年同期 3,150，同比 +85%）
- 净收入留存（NRR）：128%
- Logo 留存：96%
- Burn Multiple：1.2
- 现金跑道：22 个月

**季度收入趋势（百万美元）**
- 2025 Q1: 8.2 / Q2: 9.6 / Q3: 11.3 / Q4: 13.4
- 2026 Q1: 15.6（环比 +16%）

**客户分层 ARR（百万美元）**
- Enterprise（>50K ACV）：$32M（55%）
- Mid-market（5K–50K ACV）：$18M（31%）
- SMB（<5K ACV）：$8M（14%）

**Q1 重大里程碑（请用作要点）**
- 签下首个 ARR > $1M 的 Enterprise 合同（Walmart）
- AI Copilot 模块 GA，附加率 41%
- 法兰克福区域 GA，欧洲 ARR +127%
- SOC 2 Type II 认证
- 团队规模：120 → 145 人（其中工程 +18）

**对比表格：Acme vs 主要竞品**
| 维度 | Acme | Competitor A | Competitor B |
| 上市状态 | 私有 | 公开 | 私有 |
| ARR 增速 | 85% | 32% | 51% |
| GM% | 78% | 71% | 75% |
| NRR | 128% | 112% | 120% |

**Q2 计划（用左右对比页）**
- 左：增长侧 — 新增 50 个 Enterprise 客户、3 个新国家、AI Copilot V2
- 右：效率侧 — Burn Multiple 降到 1.0、CAC payback 缩短至 14 个月、提升 GM% 至 80%

## 结构建议
封面 → 议程 → 核心 KPI → 季度收入趋势图 → 客户分层（可用 stat-grid 或图表）→ 章节分隔（"Q1 关键里程碑"）→ 里程碑列表 → 竞品对比表格 → Q2 计划左右对比 → 结尾页

## 输出
请输出到 ${OUTPUT}`;

// ─── Tool dispatch ──────────────────────────────────────────────────────────
function dispatch(name, input) {
  if (name === "list_slide_layouts") {
    const r = spawnSync("node", [CLI, "layouts", "--theme", THEME_DIR, "--json"], { encoding: "utf8" });
    return r.status === 0 ? r.stdout : `ERROR: ${r.stderr || r.stdout}`;
  }
  if (name === "describe_slide_layout") {
    const r = spawnSync("node", [CLI, "describe", String(input.name || ""), "--theme", THEME_DIR, "--json"], { encoding: "utf8" });
    return r.status === 0 ? r.stdout : `ERROR: ${(r.stderr || r.stdout).trim()}`;
  }
  if (name === "validate_slideml") {
    const tmp = join(TMP, `validate-${Date.now()}.yaml`);
    writeFileSync(tmp, String(input.slideml || ""));
    const r = spawnSync("node", [CLI, "validate", tmp, "--theme", THEME_DIR], { encoding: "utf8" });
    return r.status === 0 ? "OK — deck validates against theme." : `Validation failed:\n${(r.stderr || r.stdout).trim()}`;
  }
  if (name === "render_slideml") {
    const tmp = join(TMP, `agent-${Date.now()}.yaml`);
    writeFileSync(tmp, String(input.slideml || ""));
    const r = spawnSync("node", [CLI, "compile", tmp, "--theme", THEME_DIR, "-o", String(input.output_path || "")], { encoding: "utf8" });
    return r.status === 0 ? `Wrote ${input.output_path} (sidecar: ${input.output_path}.slideml)` : `ERROR: ${(r.stderr || r.stdout).trim()}`;
  }
  return `Unknown tool: ${name}`;
}

// ─── Agent loop ─────────────────────────────────────────────────────────────
const messages = [{ role: "user", content: PROMPT }];
let totalIn = 0, totalOut = 0, turns = 0, retries = 0, render = 0;
for (let step = 0; step < 24; step++) {
  turns++;
  const t0 = Date.now();
  process.stdout.write(`step ${step + 1}… `);
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: SYSTEM, messages, tools }),
  });
  if (!res.ok) { console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`); process.exit(1); }
  const data = await res.json();
  totalIn += data.usage?.input_tokens || 0;
  totalOut += data.usage?.output_tokens || 0;
  console.log(`${data.stop_reason} ${Date.now() - t0}ms in=${data.usage?.input_tokens} out=${data.usage?.output_tokens}`);
  messages.push({ role: "assistant", content: data.content });

  const toolUses = (data.content || []).filter((b) => b.type === "tool_use");
  if (toolUses.length === 0) break;
  const toolResults = [];
  for (const tu of toolUses) {
    const result = dispatch(tu.name, tu.input);
    const ok = !result.startsWith("ERROR") && !result.startsWith("Validation failed");
    console.log(`  → ${tu.name}: ${ok ? "ok" : "ERR"} ${result.slice(0, 120).replace(/\n/g, " ")}`);
    if (tu.name === "render_slideml") { render++; if (!ok) retries++; }
    toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
  }
  messages.push({ role: "user", content: toolResults });
}

// ─── Audit ──────────────────────────────────────────────────────────────────
console.log(`\nturns=${turns} render=${render} retries=${retries} tokens=${totalIn}/${totalOut}`);
if (!existsSync(OUTPUT)) {
  console.error(`\n✗ ${OUTPUT} was not written.`);
  process.exit(1);
}
const py = spawnSync("python3", ["-c", `
import sys
from pptx import Presentation
p = Presentation(sys.argv[1])
print(f"slides={len(p.slides)} shapes={sum(len(s.shapes) for s in p.slides)}")
for i, s in enumerate(p.slides):
    title = next((sh.text_frame.text.strip() for sh in s.shapes if sh.has_text_frame and sh.text_frame.text.strip()), "(untitled)")
    print(f"  {i+1}. {title[:60]}")
`, OUTPUT], { encoding: "utf8" });
console.log(`\nAudit:\n${py.stdout}`);
console.log(`Sidecar: ${OUTPUT}.slideml (${readFileSync(`${OUTPUT}.slideml`, "utf8").split("\n").length} lines of YAML)`);

// ─── Open it ────────────────────────────────────────────────────────────────
console.log(`\nOpening in Finder…`);
spawnSync("open", ["-R", OUTPUT]);
spawnSync("open", [OUTPUT]);
console.log(`✓ ${OUTPUT}`);
