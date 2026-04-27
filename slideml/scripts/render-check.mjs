#!/usr/bin/env node
/**
 * Headless LibreOffice render check.
 *
 * For each .pptx produced by SlideML, this script:
 *   1. Converts the deck to PDF via `soffice --headless`.
 *   2. Splits the PDF into per-slide PNGs via `pdftoppm`.
 *   3. Verifies slide count matches what the source YAML declared.
 *   4. Surfaces any LibreOffice stderr output as a warning.
 *   5. Detects "auto-repair" hints (LibreOffice repairs malformed OOXML
 *      silently most of the time, but emits "Recovery" / "Repair" hints
 *      in some failure modes; we catch what we can).
 *
 * Usage:
 *   node scripts/render-check.mjs                       # all bundled fixtures
 *   node scripts/render-check.mjs path/to/deck.pptx ... # specific files
 *
 * Output goes to /tmp/slideml-render-out/<basename>/page-N.png. Open the
 * directory to visually verify the deck renders as intended.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const SOFFICE_CANDIDATES = [
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/usr/bin/soffice",
  "/usr/local/bin/soffice",
  "/opt/homebrew/bin/soffice",
];
const PDFTOPPM_CANDIDATES = [
  "/opt/homebrew/bin/pdftoppm",
  "/usr/local/bin/pdftoppm",
  "/usr/bin/pdftoppm",
];
const PDFINFO_CANDIDATES = [
  "/opt/homebrew/bin/pdfinfo",
  "/usr/local/bin/pdfinfo",
  "/usr/bin/pdfinfo",
];
const PDFTOTEXT_CANDIDATES = [
  "/opt/homebrew/bin/pdftotext",
  "/usr/local/bin/pdftotext",
  "/usr/bin/pdftotext",
];

/**
 * Per-fixture content assertions. After LibreOffice renders the .pptx to
 * PDF, the PDF text dump must contain ALL of these strings — otherwise a
 * shape silently failed to render even though the page exists. This is the
 * check that catches the "graphicFrame referenced rId1 (layout) instead of
 * rId2 (chart)" class of bug.
 */
const CONTENT_EXPECTATIONS = {
  "quarterly-review": [
    "同传市场格局分析",      // cover title
    "市场规模与增长",        // section divider
    "82.3 亿",             // KPI value (note: pdftotext inserts a space)
    "AI 同传",             // chart category — proves the chart rendered
    "3200",                // chart value
    "万",                  // wanyuan format code on Y-axis
    "头部玩家定位",          // bullet-with-image title
    "字节跳动",             // bullet body
  ],
  "stat-only": [
    "Engineering Review",
    "Reliability KPIs",
    "99.95%",
    "P99 latency",
    "Reliability is shipped, not declared.",
  ],
  "cover-and-quote": [
    "极简两页演示",
    "做对的事，把它做对。",
  ],
  "wave-a-showcase": [
    "SlideML 表现力扩展",   // cover
    "目录",                 // agenda title
    "市场背景",             // agenda item AND title-only section
    "AI 同传市场进入加速期", // hero-image-overlay
    "实施流程",             // process-timeline
    "需求确认",             // process-timeline step title
    "各产品线 Q1 数据",     // data-table title
    "毛利率",               // data-table header cell
    "44%",                 // data-table body cell
    "客户案例",             // image-grid-2x2 title
    "Q&A",                 // closing
  ],
  "wave-b-showcase": [
    "Hyperlinks",            // cover title fragment
    "Stacked revenue",        // stacked-bar slide title
    "Market share",           // doughnut slide title
    "Engagement trend",       // area chart slide title
    "Compile a deck",         // code-block title #1
    "slideml compile",        // code body
    "Programmatic API",       // code-block title #2
    "Thanks",                 // closing
  ],
};

function findExec(candidates, label) {
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`error: ${label} not found. Tried: ${candidates.join(", ")}`);
  process.exit(2);
}

const SOFFICE = findExec(SOFFICE_CANDIDATES, "LibreOffice (soffice)");
const PDFTOPPM = findExec(PDFTOPPM_CANDIDATES, "pdftoppm");
const PDFINFO = findExec(PDFINFO_CANDIDATES, "pdfinfo");
const PDFTOTEXT = findExec(PDFTOTEXT_CANDIDATES, "pdftotext");

function run(cmd, args, opts = {}) {
  return new Promise((res) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => res({ code, stdout, stderr }));
  });
}

async function convertToPdf(pptx, outdir) {
  return run(SOFFICE, [
    "--headless",
    "--norestore",
    "--nolockcheck",
    "--nodefault",
    "--nologo",
    "--convert-to", "pdf",
    "--outdir", outdir,
    pptx,
  ]);
}

async function pdfPageCount(pdf) {
  const r = await run(PDFINFO, [pdf]);
  const m = /^Pages:\s+(\d+)$/m.exec(r.stdout);
  return m ? Number(m[1]) : 0;
}

async function splitPdf(pdf, outPrefix) {
  // pdftoppm produces <prefix>-1.png, <prefix>-2.png, ...
  return run(PDFTOPPM, ["-png", "-r", "120", pdf, outPrefix]);
}

const FIXTURES_DIR = join(ROOT, "fixtures");
const DEFAULT_FIXTURES = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".slideml.yaml") && !f.startsWith("broken"))
  .map((f) => join(FIXTURES_DIR, f));

const argv = process.argv.slice(2);
const inputs = argv.length > 0 ? argv.map((p) => resolve(p)) : null;

let exitCode = 0;
const summary = [];

const OUT_ROOT = "/tmp/slideml-render-out";
rmSync(OUT_ROOT, { recursive: true, force: true });
mkdirSync(OUT_ROOT, { recursive: true });

if (inputs) {
  for (const file of inputs) {
    if (!existsSync(file)) {
      console.error(`error: file not found: ${file}`);
      exitCode = 2;
      continue;
    }
    if (extname(file).toLowerCase() === ".yaml") {
      const pptx = await compileYamlToTmp(file);
      if (pptx) await checkPptx(pptx, /* expectedSlides */ undefined);
    } else if (extname(file).toLowerCase() === ".pptx") {
      await checkPptx(file, undefined);
    } else {
      console.error(`error: unsupported input extension: ${file}`);
      exitCode = 2;
    }
  }
} else {
  // Compile every bundled fixture, then render-check.
  for (const yaml of DEFAULT_FIXTURES) {
    const expected = countSlidesInYaml(yaml);
    const pptx = await compileYamlToTmp(yaml);
    if (pptx) await checkPptx(pptx, expected);
  }
}

console.log("\n--- summary ---");
for (const s of summary) console.log(s);
console.log(`render artifacts under: ${OUT_ROOT}`);
process.exit(exitCode);

// ----------------------------------------------------------------------

async function compileYamlToTmp(yamlPath) {
  const base = basename(yamlPath, ".slideml.yaml");
  const out = join(OUT_ROOT, `${base}.pptx`);
  mkdirSync(dirname(out), { recursive: true });
  const r = await run("node", ["dist/bin/slideml.js", "compile", yamlPath, "--theme", "technical-blue", "-o", out], { cwd: ROOT });
  if (r.code !== 0) {
    console.error(`compile failed for ${yamlPath}:\n${r.stderr || r.stdout}`);
    exitCode = 2;
    return null;
  }
  return out;
}

async function checkPptx(pptxPath, expectedSlides) {
  const base = basename(pptxPath, ".pptx");
  const outdir = join(OUT_ROOT, base);
  mkdirSync(outdir, { recursive: true });

  console.log(`\n[${base}] converting to PDF via LibreOffice…`);
  const conv = await convertToPdf(pptxPath, outdir);
  if (conv.code !== 0 || conv.stderr.trim() !== "") {
    if (conv.stderr.trim()) console.warn(`  soffice stderr: ${conv.stderr.trim()}`);
  }
  // Surface auto-repair hints if soffice prints them.
  const repairHints = (conv.stdout + conv.stderr).match(/(repair|recover|invalid|bad|corrupt|warn(?:ing)?|broken|cannot)/gi);
  if (repairHints) {
    console.warn(`  ⚠ LibreOffice mentioned: ${[...new Set(repairHints.map((s) => s.toLowerCase()))].join(", ")}`);
    console.warn(`  full stdout: ${conv.stdout.trim()}`);
    console.warn(`  full stderr: ${conv.stderr.trim()}`);
  }

  const pdfPath = join(outdir, `${base}.pdf`);
  if (!existsSync(pdfPath)) {
    console.error(`  ✗ no PDF produced for ${base}`);
    exitCode = 2;
    return;
  }
  const pageCount = await pdfPageCount(pdfPath);
  if (expectedSlides !== undefined && pageCount !== expectedSlides) {
    console.error(`  ✗ page count mismatch: PDF has ${pageCount}, source YAML declared ${expectedSlides}`);
    exitCode = 2;
  } else {
    console.log(`  ✓ PDF: ${pageCount} page(s)${expectedSlides !== undefined ? ` (matches YAML)` : ""}`);
  }

  // Split into per-slide PNGs for visual inspection.
  const split = await splitPdf(pdfPath, join(outdir, "page"));
  if (split.code !== 0) {
    console.error(`  ✗ pdftoppm failed: ${split.stderr.trim()}`);
    exitCode = 2;
    return;
  }
  const pngs = readdirSync(outdir).filter((f) => /^page-\d+\.png$/.test(f)).sort();
  if (pngs.length !== pageCount) {
    console.error(`  ✗ produced ${pngs.length} PNG(s) but PDF had ${pageCount} page(s)`);
    exitCode = 2;
  }

  let totalPng = 0;
  for (const png of pngs) {
    const s = statSync(join(outdir, png));
    totalPng += s.size;
    if (s.size < 1000) {
      console.warn(`  ⚠ ${png} suspiciously small (${s.size} bytes) — likely blank slide`);
    }
  }
  console.log(`  ✓ ${pngs.length} PNG(s), total ${(totalPng / 1024).toFixed(1)} KB → ${outdir}`);

  // Content assertion: extract text from the rendered PDF and check that the
  // expected strings actually appear. This catches the "graphicFrame
  // references the wrong rId" / "shape silently dropped" class of bug that
  // a clean exit code from soffice doesn't.
  const expectations = CONTENT_EXPECTATIONS[base];
  if (expectations) {
    const text = await run(PDFTOTEXT, ["-layout", pdfPath, "-"]);
    if (text.code !== 0) {
      console.error(`  ✗ pdftotext failed: ${text.stderr.trim()}`);
      exitCode = 2;
    } else {
      // Normalize: strip whitespace so spacing differences don't fail us.
      const normalized = text.stdout.replace(/\s+/g, "");
      const missing = [];
      for (const needle of expectations) {
        const needleNorm = needle.replace(/\s+/g, "");
        if (!normalized.includes(needleNorm)) missing.push(needle);
      }
      if (missing.length > 0) {
        console.error(`  ✗ ${missing.length} expected string(s) missing from rendered PDF:`);
        for (const m of missing) console.error(`      "${m}"`);
        exitCode = 2;
      } else {
        console.log(`  ✓ all ${expectations.length} expected text fragment(s) present in rendered PDF`);
      }
    }
  }

  summary.push(`${base}: ${pageCount} page(s), ${pngs.length} PNG(s)`);
}

function countSlidesInYaml(yamlPath) {
  const text = readFileSync(yamlPath, "utf8");
  return (text.match(/^\s*-\s+layout:/gm) || []).length;
}
