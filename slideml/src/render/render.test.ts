/**
 * Stage 3 end-to-end tests: load `technical-blue`, render decks against
 * each layout, emit a valid PPTX.
 *
 * These tests load the BUILT theme from `dist/themes/technical-blue` —
 * the loader uses dynamic ESM imports against `.js` files. A test pre-step
 * builds the package if dist is stale.
 */

import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTheme } from "../theme/loader.js";
import { renderDeck, type DeckSpec } from "./index.js";
import { emitPackage } from "../emitter/package.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SLIDEML_ROOT = resolve(__dirname, "../..");
const BUILT_THEME = join(SLIDEML_ROOT, "dist/themes/technical-blue");
const SRC_THEME = join(SLIDEML_ROOT, "src/themes/technical-blue");
const ENTERPRISE_THEME = join(SLIDEML_ROOT, "src/themes/enterprise-light");

beforeAll(() => {
  // Ensure dist exists and is at least as fresh as the source theme.
  const sourceMtime = statSync(SRC_THEME).mtimeMs;
  const distExists = existsSync(BUILT_THEME);
  const distFresh = distExists && statSync(BUILT_THEME).mtimeMs >= sourceMtime;
  if (!distExists || !distFresh) {
    execSync("pnpm run build", { cwd: SLIDEML_ROOT, stdio: "inherit" });
  }
}, 60_000);

describe("Stage 3 — theme loader", () => {
  it("loads the technical-blue theme with all layouts/components/chrome", async () => {
    const theme = await loadTheme(BUILT_THEME);
    expect(theme.manifest.name).toBe("technical-blue");
    expect(theme.manifest.slidemlVersion).toBe("1");

    const layoutNames = [...theme.layouts.keys()].sort();
    expect(layoutNames).toEqual([
      "agenda",
      "article-flow",
      "closing",
      "code-block",
      "compare-two-columns",
      "content-grid",
      "cover",
      "dashboard",
      "data-table",
      "definition",
      "executive-summary",
      "framed",
      "freeform",
      "funnel",
      "glossary",
      "hero-image-overlay",
      "hero-stat",
      "image-full-bleed",
      "image-grid",
      "key-point",
      "letter",
      "matrix-2x2",
      "outline",
      "pricing-table",
      "process-flow",
      "question-list",
      "quote",
      "roadmap",
      "section-divider",
      "split",
      "stat-grid-3",
      "swot",
      "team-grid",
      "timeline",
      "title-only",
      "visual-with-caption",
      "visual-with-text",
    ]);

    expect([...theme.components.keys()].sort()).toEqual(["footer", "header", "kpi-tile", "takeaway-callout"]);
    expect([...(theme.chrome ?? new Map()).keys()].sort()).toEqual(["brand-mark", "hairline", "page-footer", "page-header", "page-number"]);
  });

  it("loads the enterprise-light theme with restrained business chrome", async () => {
    const theme = await loadTheme(ENTERPRISE_THEME);
    expect(theme.manifest.name).toBe("enterprise-light");
    expect(theme.manifest.tokens["bg-canvas"]).toBe("F7F8FA");
    expect([...(theme.chrome ?? new Map()).keys()].sort()).toEqual(["brand-mark", "hairline", "page-footer", "page-header", "page-number"]);
  });

  it("attaches each layout's first-paragraph description from theme.md", async () => {
    const theme = await loadTheme(BUILT_THEME);
    const cover = theme.layouts.get("cover");
    expect(cover?.description).toMatch(/Title slide/i);
  });

  it("validates required tokens", async () => {
    const theme = await loadTheme(BUILT_THEME);
    expect(theme.manifest.tokens["bg-canvas"]).toBe("F3F8FC");
    expect(theme.manifest.tokens["brand-primary"]).toBe("006BBA");
    expect(Array.isArray(theme.manifest.tokens["font-cjk"])).toBe(true);
  });
});

describe("Stage 3 — renderDeck against technical-blue", () => {
  it("expands article-flow logical slides into multiple physical slides", async () => {
    const theme = await loadTheme(BUILT_THEME);
    const paragraph = "这是一段用于测试自动分页的长篇阅读材料。".repeat(36);
    const spec: DeckSpec = {
      slideml: 1,
      deck: { size: "16x9", language: "zh-CN", theme: "technical-blue" },
      slides: [
        {
          layout: "article-flow",
          slots: {
            title: "示例文章",
            subtitle: "阅读下面材料",
            body: [
              { type: "paragraph", text: paragraph },
              { type: "quote", text: "关键句也要保留样式并参与分页。" },
              { type: "paragraph", text: paragraph },
            ],
          },
        },
      ],
    };
    const ast = renderDeck(spec, theme);
    expect(ast.slides.length).toBeGreaterThan(1);
    expect(ast.slides[0]?.shapes.length).toBeGreaterThan(0);
  });

  it("renders a 6-slide deck that exercises every layout", async () => {
    const theme = await loadTheme(BUILT_THEME);
    const spec: DeckSpec = {
      slideml: 1,
      deck: { size: "16x9", language: "zh-CN", theme: "technical-blue" },
      slides: [
        { layout: "cover", chrome: "none", slots: { title: "同传市场格局分析", subtitle: "2026 Q1", eyebrow: "市场报告" } },
        { layout: "section-divider", chrome: "none", slots: { eyebrow: "第一部分", title: "市场规模与增长" } },
        { layout: "stat-grid-3", slots: {
          title: "市场规模",
          items: [
            { value: "82.3亿", label: "市场规模", delta: "+12% YoY", trend: "up" },
            { value: "3,400万", label: "月活",   delta: "+8%",      trend: "up" },
            { value: "1.4×",   label: "ARPU",  delta: "—",       trend: "flat" },
          ],
        } },
        { layout: "visual-with-text", slots: {
          title: "头部玩家定位",
          textKind: "bullets",
          bullets: [
            "三家头部厂商占据 62% 份额",
            "字节跳动以技术领先优势加速渗透",
            "传统会议同传服务向 AI 辅助过渡",
          ],
          visual: { kind: "image", src: makePngDataUrl(), alt: "competitive map" },
        } },
        { layout: "visual-with-text", slots: {
          title: "技术演进",
          text: "AI 同传在 2025 年走完了从可用到优秀的关键一年。\n\n端到端模型把延迟从 800ms 降到 120ms，词错率下降 40%，已具备进入企业关键场景的能力。",
          visual: { kind: "image", src: makePngDataUrl(), alt: "tech timeline" },
          position: "left",
        } },
        { layout: "quote", chrome: "none", slots: {
          quote: "AI 同传不是替代人类——它把同传服务带到此前根本买不起的场景里。",
          attribution: "某字节跳动产品负责人",
        } },
      ],
    };

    const deckAst = renderDeck(spec, theme);
    expect(deckAst.slides).toHaveLength(6);
    // Every slide should have a background.
    for (const slide of deckAst.slides) {
      expect(slide.background?.type).toBe("solid");
    }

    const buffer = await emitPackage(deckAst);
    expect(buffer.length).toBeGreaterThan(5000);

    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("ppt/slides/slide1.xml")).toBeTruthy();
    expect(zip.file("ppt/slides/slide6.xml")).toBeTruthy();

    // Verify CJK content survived through to slide XML.
    const slide3Xml = await zip.file("ppt/slides/slide3.xml")!.async("string");
    expect(slide3Xml).toContain("市场规模");
    expect(slide3Xml).toContain("82.3亿");

    // Verify theme chrome appeared on a non-cover slide.
    const slide4Xml = await zip.file("ppt/slides/slide4.xml")!.async("string");
    expect(slide4Xml).toContain("C9D8E8"); // hairline divider used by chrome
    expect(slide4Xml).toMatch(/<\/p:sld>$/); // well-closed

    // Cover slide opted out of chrome — should not contain page-number text.
    const slide1Xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide1Xml).not.toMatch(/1 \/ 6/);
  });

  it("renders markdown-like prose in visual-with-text with compact list spacing", async () => {
    const theme = await loadTheme(BUILT_THEME);
    const spec: DeckSpec = {
      slideml: 1,
      deck: { size: "16x9", language: "zh-CN", theme: "technical-blue" },
      slides: [{
        layout: "visual-with-text",
        slots: {
          title: "市场概览",
          visual: { kind: "image", src: makePngDataUrl(), position: "right", imageStyle: "card" },
          textKind: "prose",
          text: "【全球市场规模】\n• 2024年全球AI穿戴设备市场达268.8亿美元\n• 预计2030年突破3593.2亿美元，CAGR=29.8%\n• 端侧AI穿戴设备2024年营收156.6亿美元\n\n【中国市场规模】\n• 2024年中国市场规模达615亿元人民币\n• 2019-2024年复合增长率14.7%\n• 2025年AI硬件（不含手机/汽车）突破万亿",
        },
      }],
    };

    const deckAst = renderDeck(spec, theme);
    const textShape = deckAst.slides[0]!.shapes.find(
      (shape) => shape.type === "text" && shape.paragraphs.some((p) => p.runs.some((r) => r.text.includes("全球市场规模"))),
    );
    expect(textShape?.type).toBe("text");
    if (!textShape || textShape.type !== "text") return;

    const bulletParagraphs = textShape.paragraphs.filter((p) => p.runs[0]?.text.trim() === "›");
    expect(bulletParagraphs.length).toBe(6);
    expect(Math.max(...bulletParagraphs.slice(0, 2).map((p) => p.spaceAfterHalfPt ?? 0))).toBeLessThanOrEqual(4);
    const firstHeading = textShape.paragraphs.find((p) => p.runs.some((r) => r.text.includes("全球市场规模")));
    expect(firstHeading?.spaceAfterHalfPt).toBeLessThanOrEqual(6);
  });

  it("rejects a slide that references an unknown layout", async () => {
    const theme = await loadTheme(BUILT_THEME);
    const bad: DeckSpec = {
      slideml: 1,
      deck: { size: "16x9", theme: "technical-blue" },
      slides: [{ layout: "moonshot-dashboard", slots: { title: "x" } }],
    };
    expect(() => renderDeck(bad, theme)).toThrow(/not found/);
  });
});

function makePngDataUrl(): string {
  // 1x1 transparent PNG.
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";
}
