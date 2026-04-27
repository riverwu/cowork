#!/usr/bin/env node
/**
 * Render real thumbnails for every (theme, layout) pair.
 *
 * For each theme listed in the registry, walks the layouts that theme
 * declares and renders a 1-slide deck per layout. Pipes through
 * LibreOffice → PDF → PNG (via macOS sips), resized to 480×270, then
 * writes to slideml/src/themes/<theme>/thumbnails/<layout>.png.
 *
 * Replaces the 1×1 transparent placeholder PNGs that ship by default
 * (loader requires the files to exist; placeholders satisfied that
 * but were obviously useless visually).
 *
 * Requires:
 *   - LibreOffice at /Applications/LibreOffice.app/Contents/MacOS/soffice
 *   - macOS `sips` (built-in)
 *
 * Usage: node scripts/render-thumbnails.mjs [theme...]
 *   With no args, regenerates for ALL themes. With theme names, just those.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CLI = join(ROOT, "dist/bin/slideml.js");
const THEMES_DIR_SRC = join(ROOT, "src/themes");
const THEMES_DIR_DIST = join(ROOT, "dist/themes");
const TMP = "/tmp/slideml-thumbnails";
const SOFFICE = "/Applications/LibreOffice.app/Contents/MacOS/soffice";

mkdirSync(TMP, { recursive: true });

if (!existsSync(SOFFICE)) {
  console.error(`LibreOffice not found at ${SOFFICE}.`);
  process.exit(2);
}
if (!existsSync(CLI)) {
  console.error(`slideml CLI not found at ${CLI}. Run \`pnpm run build\` first.`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Per-layout sample content. Keep terse — thumbnails just need to LOOK like
// the layout. Real content quality doesn't matter at thumbnail size.
// ---------------------------------------------------------------------------
// Single-pixel transparent PNG, base64-encoded — the renderer scales it to
// fill any image rect, so the resulting thumbnail's image area is empty
// but the layout's composition still reads correctly.
function PLACEHOLDER_PNG() {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";
}

const SAMPLES = {
  "cover": {
    chrome: "none",
    slots: { eyebrow: "Q1 2026", title: "Reliability shipped, ARPU up", subtitle: "Engineering · April 2026" },
  },
  "title-only": {
    slots: { title: "Section II — Looking Ahead" },
  },
  "agenda": {
    slots: { title: "Agenda", items: ["Headline metrics", "Growth trajectory", "Segment performance", "What's next"] },
  },
  "section-divider": {
    slots: { title: "Growth Trajectory", eyebrow: "02" },
  },
  "stat-grid-3": {
    slots: {
      title: "Quarter at a glance",
      items: [
        { value: "99.95%", label: "Availability", delta: "+0.04%", trend: "up" },
        { value: "120ms",  label: "P99 latency",  delta: "-32%",   trend: "up" },
        { value: "1.4×",   label: "ARPU",         delta: "+0.2",   trend: "up" },
      ],
    },
  },
  "bullet-with-image": {
    slots: {
      title: "What we shipped",
      bullets: [
        "Connection multiplexing on gateway",
        "Hot-cache warming on rollouts",
        "Adaptive backpressure at tail",
        "Per-tenant rate-limit isolation",
      ],
    },
  },
  "two-col-text-image": {
    slots: {
      title: "How it works",
      text: "The gateway terminates client connections and multiplexes them onto a shared pool. Slow downstream services no longer block fast clients.",
      image: "/tmp/slideml-arch.png",
    },
  },
  "compare-two-columns": {
    slots: {
      title: "Old vs. new",
      leftTitle:  "Before",
      leftBody:   "Per-client TCP. Tail latency from one slow service stalls every other request on the same connection.",
      rightTitle: "After",
      rightBody:  "Shared multiplex pool. Slow services contained; tail latency drops 32%.",
    },
  },
  "process-timeline": {
    slots: {
      title: "Incident response",
      steps: ["Detect — alert", "Triage — severity", "Mitigate — runbook", "Communicate — status page", "Postmortem — write-up"],
    },
  },
  "image-grid-2x2": {
    slots: {
      title: "Reference set",
      images: [
        { caption: "Detect" },
        { caption: "Triage" },
        { caption: "Mitigate" },
        { caption: "Recover" },
      ],
    },
  },
  "hero-image-overlay": {
    slots: {
      title: "Reliability shipped",
      subtitle: "Q1 2026 — engineering review",
      image: "/tmp/slideml-bg.png",
    },
  },
  "data-table": {
    slots: {
      title: "ARR by segment",
      table: {
        header: ["Segment", "ARR", "% Total"],
        rows: [
          ["Enterprise", "$24M", "56%"],
          ["Mid-market", "$13M", "31%"],
          ["SMB",        "$5M",  "13%"],
        ],
        colWidths: [3, 2, 2],
      },
    },
  },
  "code-block": {
    slots: {
      title: "Connection pooling",
      language: "ts",
      code: "function acquireConn(host: string) {\n  const pool = pools.get(host) ?? makePool(host);\n  return pool.acquire();\n}",
    },
  },
  "chart-with-takeaway": {
    slots: {
      title: "Quarterly ARR",
      chart: {
        type: "bar",
        data: {
          labels: ["Q1", "Q2", "Q3", "Q4"],
          series: [{ name: "ARR ($M)", values: [8.2, 9.6, 11.3, 13.4] }],
        },
        format: { y: "decimal" },
      },
      takeaway: "**Compounding growth** — Q4 added 19% over Q3.",
    },
  },
  "dashboard": {
    slots: {
      title: "Q1 dashboard",
      tl: { kind: "kpi",   value: "$15.6M", label: "Q1 ARR", delta: "+16% QoQ", trend: "up" },
      tr: { kind: "chart", title: "Latency", chart: { type: "line", data: { labels: ["W1","W2","W3","W4"], series: [{ name: "P99", values: [180,165,150,142] }] }, format: { y: "int" } } },
      bl: { kind: "table", title: "Segments", table: { header: ["Seg","ARR"], rows: [["Ent","$24M"],["Mid","$13M"],["SMB","$5M"]] } },
      br: { kind: "text",  title: "Highlights", body: ["First $1M+ Enterprise contract", "AI Copilot GA — 41% attach", "EU region GA"] },
    },
  },
  "quote": {
    slots: {
      quote: "We are not building a product, we are building a category.",
      attribution: "Marc, CEO",
    },
  },
  "closing": {
    chrome: "none",
    slots: { title: "Thanks", subtitle: "Questions?" },
  },
  "split-2": {
    slots: {
      title: "Bullets vs. chart",
      left: { kind: "bullets", title: "What we shipped", items: ["Connection multiplexing", "Hot-cache warming", "Adaptive backpressure"] },
      right: {
        kind: "chart",
        title: "P99 latency",
        chart: { type: "line", data: { labels: ["W1","W2","W3","W4"], series: [{ name: "ms", values: [180,165,150,142] }] }, format: { y: "int" } },
      },
    },
  },
  "split-3-horizontal": {
    slots: {
      title: "Three perspectives",
      left:   { kind: "kpi",  value: "99.95%", label: "Availability", delta: "+0.04%", trend: "up" },
      center: { kind: "kpi",  value: "120ms",  label: "P99 latency",  delta: "-32%",   trend: "up" },
      right:  { kind: "text", title: "Why it matters", body: "Tail latency drops translate directly to user-perceived speed and retention." },
    },
  },
  "split-3-vertical": {
    slots: {
      title: "Quarter at a glance",
      top: {
        kind: "chart",
        title: "Quarterly ARR",
        chart: { type: "bar", data: { labels: ["Q1","Q2","Q3","Q4"], series: [{ name: "$M", values: [8.2,9.6,11.3,13.4] }] }, format: { y: "decimal" } },
      },
      bl:  { kind: "kpi",  value: "+85%", label: "YoY growth", delta: "Best ever", trend: "up" },
      br:  { kind: "text", title: "Takeaway", body: "Compounding growth — Q4 added 19% over Q3." },
    },
  },
  "hero-stat": {
    chrome: "none",
    slots: {
      eyebrow: "Q3 headline",
      value: "$1.2M",
      label: "MRR — first time over $1M",
      caption: "Driven by enterprise upsells and net-new logos in vertical SaaS.",
    },
  },
  "matrix-2x2": {
    slots: {
      title: "Bets — priority × effort",
      xLabel: "Effort →",
      yLabel: "Impact →",
      topLeft:  { kind: "bullets", title: "Quick wins", items: ["Pricing experiment", "Onboarding nudge"] },
      topRight: { kind: "bullets", title: "Big bets",   items: ["AI co-pilot", "Multi-region"] },
      botLeft:  { kind: "text",    title: "Fill-ins",   body: "Polish between sprints." },
      botRight: { kind: "text",    title: "Time-sinks", body: "Avoid: bespoke for one customer." },
    },
  },
  "team-grid": {
    slots: {
      title: "Founding team",
      members: [
        { name: "Wei Zhang",  role: "CEO" },
        { name: "Rohan Patel", role: "CTO" },
        { name: "Lina Nguyen", role: "Head of Product" },
        { name: "Marco Silva", role: "Head of GTM" },
      ],
    },
  },
  "image-full-bleed": {
    chrome: "none",
    slots: {
      image: { src: PLACEHOLDER_PNG(), alt: "hero image" },
      caption: "Photo · 2026 — full-bleed editorial",
    },
  },
  "image-with-caption": {
    slots: {
      image: { src: PLACEHOLDER_PNG(), alt: "editorial photo" },
      caption: "A printed page asks for the reader's full attention; a slide rarely does. The discipline is to refuse the easy thing.",
      credit: "PHOTO · ANONYMOUS",
    },
  },
  "image-pair": {
    slots: {
      title: "Before / After",
      leftImage:  { src: PLACEHOLDER_PNG(), alt: "before" },
      rightImage: { src: PLACEHOLDER_PNG(), alt: "after" },
      leftLabel:  "Before",
      rightLabel: "After",
    },
  },
  "image-split-text": {
    slots: {
      title: "Headline goes here",
      text: "An immersive 50/50 split. The image is full-bleed on its half — touching the slide edges, no card backing — while the text fills the other half with generous interior padding.\n\nUse this when two-col-text-image feels too contained.",
      image: { src: PLACEHOLDER_PNG(), alt: "split image" },
      imageSide: "right",
    },
  },
  "pricing-table": {
    slots: {
      title: "Pick a plan",
      tiers: [
        { name: "Starter",  price: "$0",   period: "/mo", features: ["Solo seat", "1GB storage", "Community support"] },
        { name: "Pro",      price: "$29",  period: "/mo", features: ["Up to 10 seats", "100GB storage", "Priority email"], recommended: true, cta: "Most popular" },
        { name: "Business", price: "$99",  period: "/mo", features: ["Unlimited seats", "1TB storage", "SSO + audit log"] },
      ],
    },
  },
  "quote-with-portrait": {
    slots: {
      quote: "Type that *insists* on being read slowly is the typographer's only defence against the scroll.",
      name: "M. Frutiger",
      role: "Type designer (apocryphal)",
      portrait: { src: PLACEHOLDER_PNG(), alt: "portrait" },
    },
  },
  "key-point": {
    slots: {
      headline: "Three reasons this matters",
      points: [
        { icon: "check",   title: "Faster",     description: "Cuts the build by 40%." },
        { icon: "star",    title: "Cheaper",    description: "Same SLAs at half the cost." },
        { icon: "users",   title: "Loved",      description: "NPS up 22 points in pilot." },
      ],
    },
  },
  "freeform": {
    slots: {
      title: "Bespoke composition",
      shapes: [
        { kind: "roundRect", x: 0.1, y: 0.25, w: 0.35, h: 0.5, fill: "brand-primary", cornerRadius: 0.15 },
        { kind: "ellipse",   x: 0.55, y: 0.3, w: 0.3,  h: 0.4, fill: "accent" },
        { kind: "text",      x: 0.1,  y: 0.78, w: 0.8, h: 0.1, text: "Free-form layout — last-resort escape hatch.", size: 14, color: "text-muted", align: "center" },
      ],
    },
  },
  "framed": {
    chrome: "none",
    slots: {
      title: "Q3 review — full context",
      header: { kind: "text", body: "Q3 closed at $1.2M MRR — first time over $1M." },
      footer: { kind: "bullets", items: ["Source: ARR ledger 2026-04", "Updated 2026-04-27"] },
      leftEdge: { kind: "kpi", value: "$1.2M", label: "MRR", delta: "+18% QoQ", trend: "up" },
      rightEdge: { kind: "bullets", title: "Watchlist", items: ["EMEA churn", "Vertical SaaS"] },
      center: {
        kind: "chart",
        title: "Revenue by quarter",
        chart: { type: "bar", data: { labels: ["Q1","Q2","Q3","Q4"], series: [{ name: "Revenue", values: [820,920,1100,1200] }] }, format: { y: "int" } },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Theme discovery
// ---------------------------------------------------------------------------
function listThemes() {
  return ["technical-blue", "editorial-warm", "midnight-executive", "forest-moss", "charcoal-minimal", "editorial-paper"];
}

function readThemeLayouts(themeDir) {
  const manifest = JSON.parse(readFileSync(join(themeDir, "theme.json"), "utf8"));
  return (manifest.layouts ?? []).map((l) => l.name);
}

// ---------------------------------------------------------------------------
// Render one thumbnail
// ---------------------------------------------------------------------------
function buildSlideYaml(themeName, layoutName) {
  const sample = SAMPLES[layoutName];
  if (!sample) throw new Error(`No sample defined for layout "${layoutName}"`);
  const slide = {
    layout: layoutName,
    ...(sample.chrome ? { chrome: sample.chrome } : {}),
    slots: sample.slots,
  };
  // Build YAML manually (avoid yaml dep) — we only use simple scalars/arrays.
  return JSON.stringify({
    slideml: 1,
    deck: { size: "16x9", language: "en-US", theme: themeName },
    slides: [slide],
  });
}

function renderThumbnail(themeName, layoutName, themeDirDist) {
  const yaml = buildSlideYaml(themeName, layoutName);
  const yamlPath = join(TMP, `${themeName}-${layoutName}.yaml`);
  const pptxPath = join(TMP, `${themeName}-${layoutName}.pptx`);
  const pdfPath  = join(TMP, `${themeName}-${layoutName}.pdf`);
  writeFileSync(yamlPath, yaml);

  // 1. Compile YAML → pptx
  const r1 = spawnSync("node", [CLI, "compile", yamlPath, "--theme", themeDirDist, "-o", pptxPath, "--no-sidecar"], { encoding: "utf8" });
  if (r1.status !== 0) {
    console.warn(`  ! ${layoutName} compile failed: ${(r1.stderr || r1.stdout).slice(0, 200)}`);
    return false;
  }

  // 2. PPTX → PDF
  const r2 = spawnSync(SOFFICE, ["--headless", "--norestore", "--nolockcheck", "--convert-to", "pdf", "--outdir", TMP, pptxPath], { encoding: "utf8" });
  if (r2.status !== 0 || !existsSync(pdfPath)) {
    console.warn(`  ! ${layoutName} pdf conversion failed`);
    return false;
  }

  // 3. PDF → PNG (480 wide)
  const pngPath = join(TMP, `${themeName}-${layoutName}.png`);
  const r3 = spawnSync("sips", ["-s", "format", "png", pdfPath, "--out", pngPath], { encoding: "utf8" });
  if (r3.status !== 0 || !existsSync(pngPath)) {
    console.warn(`  ! ${layoutName} sips conversion failed: ${r3.stderr}`);
    return false;
  }
  // Resize to 480 wide
  spawnSync("sips", ["-Z", "480", pngPath], { encoding: "utf8" });
  return pngPath;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const filter = new Set(process.argv.slice(2));
const themes = listThemes().filter((t) => filter.size === 0 || filter.has(t));
let total = 0;
let failed = 0;
for (const theme of themes) {
  const themeDirSrc  = join(THEMES_DIR_SRC,  theme);
  const themeDirDist = join(THEMES_DIR_DIST, theme);
  const layouts = readThemeLayouts(themeDirSrc);
  console.log(`\n[${theme}] ${layouts.length} layouts`);
  for (const layout of layouts) {
    total++;
    process.stdout.write(`  ${layout}…`);
    const png = renderThumbnail(theme, layout, themeDirDist);
    if (png) {
      const dest = join(themeDirSrc, "thumbnails", `${layout}.png`);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(png, dest);
      // Also copy to dist so the live runtime sees it without rebuild.
      const distDest = join(themeDirDist, "thumbnails", `${layout}.png`);
      mkdirSync(dirname(distDest), { recursive: true });
      copyFileSync(png, distDest);
      process.stdout.write(` ✓\n`);
    } else {
      failed++;
      process.stdout.write(` ✗\n`);
    }
  }
}

console.log(`\n${total - failed}/${total} thumbnails generated. (failed: ${failed})`);
// Clean tmp
try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
