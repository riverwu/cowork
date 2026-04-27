#!/usr/bin/env node
/**
 * Stage 3 exit-criterion smoke test.
 *
 * Loads `technical-blue`, renders a 6-slide Chinese deck that exercises
 * every layout (cover, section-divider, stat-grid-3, bullet-with-image,
 * two-col-text-image, quote), and writes /tmp/slideml-stage3-smoke.pptx.
 *
 *   pnpm build && node scripts/stage3-smoke.mjs
 *   open /tmp/slideml-stage3-smoke.pptx
 */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTheme } from "../dist/theme/loader.js";
import { renderDeck } from "../dist/render/index.js";
import { emitPackage } from "../dist/emitter/package.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const THEME_DIR = resolve(__dirname, "../dist/themes/technical-blue");

// 1x1 transparent PNG.
const transparentPx =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

const spec = {
  slideml: 1,
  deck: { size: "16x9", language: "zh-CN", theme: "technical-blue" },
  slides: [
    { layout: "cover", chrome: "none", slots: {
      eyebrow: "市场报告 · 2026 Q1",
      title: "同传市场格局分析",
      subtitle: "AI 与传统服务的拐点已到",
    } },
    { layout: "section-divider", chrome: "none", slots: {
      eyebrow: "第一部分",
      title: "市场规模与增长",
    } },
    { layout: "stat-grid-3", slots: {
      title: "市场规模",
      items: [
        { value: "82.3亿", label: "市场规模",   delta: "+12% YoY", trend: "up" },
        { value: "3,400万", label: "月活用户",  delta: "+8%",      trend: "up" },
        { value: "1.4×",   label: "ARPU",     delta: "持平",     trend: "flat" },
      ],
    } },
    { layout: "bullet-with-image", slots: {
      title: "头部玩家定位",
      bullets: [
        "三家头部厂商占据 62% 份额",
        "字节跳动以技术领先优势加速渗透",
        "传统会议同传向 AI 辅助稳步过渡",
        "中长尾市场仍存在大量机会",
      ],
      image: { src: transparentPx, alt: "竞争格局图" },
    } },
    { layout: "two-col-text-image", slots: {
      title: "技术演进",
      text: "AI 同传在 2025 年走完了从可用到优秀的关键一年。\n\n端到端模型把延迟从 800ms 降到 120ms，词错率下降 40%，已具备进入企业关键场景的能力。",
      image: { src: transparentPx, alt: "技术时间线" },
      imageSide: "right",
    } },
    { layout: "quote", chrome: "none", slots: {
      quote: "AI 同传不是替代人类——它把同传服务带到此前根本买不起的场景里。",
      attribution: "字节跳动产品负责人",
    } },
  ],
};

const theme = await loadTheme(THEME_DIR);
const deckAst = renderDeck(spec, theme);
const buffer = await emitPackage(deckAst);

const outPath = "/tmp/slideml-stage3-smoke.pptx";
writeFileSync(outPath, buffer);
console.log(`wrote ${buffer.length} bytes to ${outPath}`);
console.log(`open with:  open "${outPath}"`);
