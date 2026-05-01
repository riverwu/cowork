import { readFile, writeFile } from "node:fs/promises";
import { designComparisonSlide, designDashboardSlide, designTimelineSlide } from "./page-designer.js";
import type { BrandSpec, RenderedDeck, RenderedSlide } from "../types.js";
import { renderToPptx } from "../render.js";

export type PlannedPage =
  | {
      id: string;
      kind: "dashboard";
      title: string;
      summary: string;
      metrics: Array<{ name: string; value: string; label: string }>;
      bullets: string[];
      imageTitle: string;
      structure: string;
    }
  | {
      id: string;
      kind: "timeline";
      title: string;
      intro: string;
      steps: Array<{ title: string; body: string }>;
      structure: string;
    }
  | {
      id: string;
      kind: "comparison";
      title: string;
      thesis: string;
      columns: Array<{ title: string; points: string[] }>;
      structure: string;
    };

export interface MarkdownPlan {
  title: string;
  brand: BrandSpec;
  pages: PlannedPage[];
}

export interface MarkdownPipelineResult {
  plan: MarkdownPlan;
  deck: RenderedDeck;
  outputPath: string;
  planPath: string;
  slideml2Path: string;
  domPath: string;
}

export interface LlmPlannerConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  maxTokens?: number;
}

export async function generateFromMarkdown(markdownPath: string, outputPath: string, logo: string, options: { useLlm?: boolean; llm?: LlmPlannerConfig } = {}): Promise<MarkdownPipelineResult> {
  const markdown = await readFile(markdownPath, "utf8");
  const plan = options.useLlm ? await planPagesFromMarkdownWithLlm(markdown, logo, options.llm) : planPagesFromMarkdown(markdown, logo);
  const deck = deckFromPlan(plan, logo);
  const planPath = `${outputPath}.page-plan.json`;
  const slideml2Path = `${outputPath}.slideml2.json`;
  await writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");
  await writeFile(slideml2Path, JSON.stringify(deck, null, 2), "utf8");
  const rendered = await renderToPptx(deck, outputPath);
  return { plan, deck, outputPath, planPath, slideml2Path, domPath: rendered.domPath };
}

export async function planPagesFromMarkdownWithLlm(markdown: string, logo?: string, config: LlmPlannerConfig = llmConfigFromEnv()): Promise<MarkdownPlan> {
  const fallback = planPagesFromMarkdown(markdown, logo);
  const response = await callPlannerLlm(markdown, fallback, config);
  return normalizePlan(JSON.parse(extractJsonObject(response)), fallback, logo);
}

export function planPagesFromMarkdown(markdown: string, logo?: string): MarkdownPlan {
  const title = firstHeading(markdown) || "SlideML2 Markdown Deck";
  const brandPrimary = extractBrandPrimary(markdown) || "E8382C";
  const sections = splitSections(markdown);
  return {
    title,
    brand: { name: title, primary: brandPrimary, logo },
    pages: sections.map((section, index) => planSection(section, index)).filter((page): page is PlannedPage => Boolean(page)),
  };
}

export function deckFromPlan(plan: MarkdownPlan, logo: string): RenderedDeck {
  const brand = { ...plan.brand, logo };
  const slides: RenderedSlide[] = plan.pages.map((page) => {
    if (page.kind === "dashboard") {
      return designDashboardSlide({
        slideId: page.id,
        title: page.title,
        summary: page.summary,
        metrics: page.metrics,
        bullets: page.bullets,
        imageSrc: logo,
        imageTitle: page.imageTitle,
      });
    }
    if (page.kind === "timeline") {
      return designTimelineSlide({
        slideId: page.id,
        title: page.title,
        intro: page.intro,
        steps: page.steps,
      });
    }
    return designComparisonSlide({
      slideId: page.id,
      title: page.title,
      thesis: page.thesis,
      columns: page.columns,
    });
  });
  return { deck: { size: "16x9", theme: "simple", brand }, slides };
}

interface Section {
  title: string;
  body: string;
}

function planSection(section: Section, index: number): PlannedPage | null {
  if (/指标|关键判断/.test(section.body)) {
    return {
      id: `page-${index + 1}-dashboard`,
      kind: "dashboard",
      title: section.title,
      summary: leadParagraph(section.body),
      metrics: extractMetrics(section.body),
      bullets: extractBulletsUnder(section.body, "关键判断"),
      imageTitle: extractImageTitle(section.body) || "页面配图",
      structure: "标题 + 主结论 + 三指标条 + 左侧关键判断 + 右侧图片与图题",
    };
  }
  if (/阶段/.test(section.body) || /^\d+\./m.test(section.body)) {
    return {
      id: `page-${index + 1}-timeline`,
      kind: "timeline",
      title: section.title,
      intro: leadParagraph(section.body),
      steps: extractSteps(section.body),
      structure: "标题 + 导语 + 横向阶段卡片",
    };
  }
  const columns = extractSubsectionColumns(section.body);
  if (columns.length > 0) {
    return {
      id: `page-${index + 1}-comparison`,
      kind: "comparison",
      title: section.title,
      thesis: leadParagraph(section.body),
      columns,
      structure: "标题 + 主结论 + 并列比较卡片",
    };
  }
  return null;
}

async function callPlannerLlm(markdown: string, fallback: MarkdownPlan, config: LlmPlannerConfig): Promise<string> {
  const baseURL = normalizeAnthropicBaseURL(config.baseURL);
  const response = await fetch(`${baseURL}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens ?? 4096,
      system: plannerSystemPrompt(),
      messages: [{
        role: "user",
        content: [
          "请根据下面 markdown 规划 PPT 页面，并只返回 JSON。",
          "",
          "可用页面类型：dashboard、timeline、comparison。",
          "JSON 必须匹配这个结构：",
          JSON.stringify({
            title: fallback.title,
            brand: { name: fallback.brand.name, primary: fallback.brand.primary },
            pages: fallback.pages,
          }, null, 2),
          "",
          "Markdown:",
          markdown,
        ].join("\n"),
      }],
      stream: false,
    }),
  });
  if (!response.ok) throw new Error(`LLM planner failed ${response.status}: ${await response.text()}`);
  const json = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  const text = json.content?.map((part) => part.text || "").join("\n").trim();
  if (!text) throw new Error("LLM planner returned empty content");
  return text;
}

function plannerSystemPrompt(): string {
  return [
    "你是 SlideML2 页面规划 agent。你的任务是把 markdown 内容规划成少量 PPT 页面。",
    "你只输出 JSON，不要输出 markdown 代码块，不要解释。",
    "页面类型只有三种：",
    "- dashboard：适合概览、指标、关键判断、图片说明。",
    "- timeline：适合阶段、步骤、演进过程。",
    "- comparison：适合并列比较、分类角色、优缺点。",
    "每页都要给出 structure，说明大致页面结构。",
    "不要臆造事实；只能重组 markdown 中的信息。",
    "尽量让每页一个主题、一个主结构，避免把所有内容塞进同一页。",
  ].join("\n");
}

function normalizePlan(raw: unknown, fallback: MarkdownPlan, logo?: string): MarkdownPlan {
  const value = isRecord(raw) ? raw : {};
  const brandRaw = isRecord(value.brand) ? value.brand : {};
  const pagesRaw = Array.isArray(value.pages) ? value.pages : [];
  const pages = pagesRaw.map((page, index) => normalizePage(page, index)).filter((page): page is PlannedPage => Boolean(page));
  return {
    title: stringValue(value.title, fallback.title),
    brand: {
      name: stringValue(brandRaw.name, fallback.brand.name || fallback.title),
      primary: normalizeHex(stringValue(brandRaw.primary, fallback.brand.primary || "E8382C")),
      logo,
    },
    pages: pages.length > 0 ? pages : fallback.pages,
  };
}

function normalizePage(raw: unknown, index: number): PlannedPage | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;
  const id = slugId(stringValue(raw.id, `page-${index + 1}-${String(kind || "slide")}`), index, kind);
  if (kind === "dashboard") {
    return {
      id,
      kind,
      title: stringValue(raw.title, "概览"),
      summary: stringValue(raw.summary, ""),
      metrics: normalizeMetrics(raw.metrics),
      bullets: stringArray(raw.bullets).slice(0, 5),
      imageTitle: stringValue(raw.imageTitle, "页面配图"),
      structure: stringValue(raw.structure, "标题 + 主结论 + 指标 + 判断 + 图片"),
    };
  }
  if (kind === "timeline") {
    return {
      id,
      kind,
      title: stringValue(raw.title, "阶段"),
      intro: stringValue(raw.intro, ""),
      steps: normalizeSteps(raw.steps),
      structure: stringValue(raw.structure, "标题 + 导语 + 阶段卡片"),
    };
  }
  if (kind === "comparison") {
    return {
      id,
      kind,
      title: stringValue(raw.title, "比较"),
      thesis: stringValue(raw.thesis, ""),
      columns: normalizeColumns(raw.columns),
      structure: stringValue(raw.structure, "标题 + 主结论 + 并列比较卡片"),
    };
  }
  return null;
}

function normalizeMetrics(raw: unknown): Array<{ name: string; value: string; label: string }> {
  return (Array.isArray(raw) ? raw : []).slice(0, 3).map((item, index) => {
    const record = isRecord(item) ? item : {};
    return {
      name: stringValue(record.name, `metric-${index + 1}`),
      value: stringValue(record.value, ""),
      label: stringValue(record.label, `指标 ${index + 1}`),
    };
  }).filter((item) => item.value || item.label);
}

function normalizeSteps(raw: unknown): Array<{ title: string; body: string }> {
  return (Array.isArray(raw) ? raw : []).slice(0, 5).map((item) => {
    const record = isRecord(item) ? item : {};
    return { title: stringValue(record.title, ""), body: stringValue(record.body, "") };
  }).filter((item) => item.title || item.body);
}

function normalizeColumns(raw: unknown): Array<{ title: string; points: string[] }> {
  return (Array.isArray(raw) ? raw : []).slice(0, 4).map((item) => {
    const record = isRecord(item) ? item : {};
    return { title: stringValue(record.title, ""), points: stringArray(record.points).slice(0, 5) };
  }).filter((item) => item.title && item.points.length > 0);
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const source = fenced?.[1] || text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`LLM planner did not return a JSON object: ${text.slice(0, 200)}`);
  return source.slice(start, end + 1);
}

function llmConfigFromEnv(): LlmPlannerConfig {
  const apiKey = process.env.LLM_API_KEY || process.env.MINIMAX_API_KEY || "";
  const baseURL = process.env.LLM_API || process.env.MINIMAX_API || "";
  const model = process.env.LLM_MODEL || "MiniMax-M2.7-highspeed";
  if (!apiKey || !baseURL) throw new Error("LLM planner requires LLM_API and LLM_API_KEY");
  return { apiKey, baseURL, model };
}

function normalizeAnthropicBaseURL(raw: string): string {
  return raw.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function slugId(value: string, index: number, kind: unknown): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || `page-${index + 1}-${String(kind || "slide")}`;
}

function normalizeHex(value: string): string {
  const cleaned = value.replace(/^#/, "");
  return /^[0-9A-Fa-f]{6}$/.test(cleaned) ? cleaned.toUpperCase() : "E8382C";
}

function firstHeading(markdown: string): string | null {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || null;
}

function extractBrandPrimary(markdown: string): string | null {
  const raw = markdown.match(/品牌色[:：]\s*#?([0-9a-fA-F]{6})/)?.[1];
  return raw ? raw.toUpperCase() : null;
}

function splitSections(markdown: string): Section[] {
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  return matches.map((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1]!.index || markdown.length : markdown.length;
    return { title: match[1]!.trim(), body: markdown.slice(start, end).trim() };
  });
}

function leadParagraph(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("###") && !item.startsWith("- ") && !/^\d+\./.test(item)) || "";
}

function extractMetrics(body: string): Array<{ name: string; value: string; label: string }> {
  return extractBulletsUnder(body, "指标").slice(0, 3).map((item, index) => {
    const [label, value] = item.split(/[：:]/).map((part) => part.trim());
    return { name: `metric-${index + 1}`, value: value || item, label: label || `指标 ${index + 1}` };
  });
}

function extractBulletsUnder(body: string, heading: string): string[] {
  const block = subsectionBody(body, heading);
  return block.split("\n").map((line) => line.match(/^-\s+(.+)$/)?.[1]?.trim()).filter((item): item is string => Boolean(item));
}

function extractSteps(body: string): Array<{ title: string; body: string }> {
  const block = subsectionBody(body, "阶段") || body;
  return block.split("\n").map((line) => {
    const match = line.match(/^\d+\.\s*([^：:]+)[：:]\s*(.+)$/);
    return match ? { title: match[1]!.trim(), body: match[2]!.trim() } : null;
  }).filter((item): item is { title: string; body: string } => Boolean(item));
}

function extractImageTitle(body: string): string | null {
  return body.match(/图题[:：]\s*(.+)/)?.[1]?.trim() || null;
}

function extractSubsectionColumns(body: string): Array<{ title: string; points: string[] }> {
  const matches = [...body.matchAll(/^###\s+(.+)$/gm)];
  return matches.map((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1]!.index || body.length : body.length;
    const points = body.slice(start, end).split("\n").map((line) => line.match(/^-\s+(.+)$/)?.[1]?.trim()).filter((item): item is string => Boolean(item));
    return { title: match[1]!.trim(), points };
  }).filter((column) => column.points.length > 0);
}

function subsectionBody(body: string, heading: string): string {
  const pattern = new RegExp(`^###\\s+${escapeRegExp(heading)}\\s*$`, "m");
  const match = body.match(pattern);
  if (!match || match.index === undefined) return "";
  const start = match.index + match[0].length;
  const rest = body.slice(start);
  const next = rest.search(/^###\s+/m);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
