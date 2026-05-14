import { readFile, stat, writeFile } from "node:fs/promises";
import { buildAgentPromptPack, getAgentSystemPrompt } from "../agent-disclosure.js";
import { appendSlide, createDeck, readDeck, replaceSlide, renderDeck, writeDeck } from "../deck-ops.js";
import { validateDeck, validateSlide, type ValidationReport } from "../validate.js";
import type { BrandSpec, SlideV2 } from "../types.js";

export interface BatchAgentConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  maxTokens?: number;
  timeoutMs?: number;
  maxInputBytes?: number;
  maxRepairRounds?: number;
}

export interface BatchAgentResult {
  deckPath: string;
  outputPath: string;
  planPath: string;
  validationPath: string;
  validation: ValidationReport;
  repairCount: number;
  status: "ok" | "validation-failed";
  fallbackUsed: boolean;
  fallbackCount: number;
  fallbackReasons: string[];
  repairAbandoned: boolean;
  renderSkipped: boolean;
}

interface PageOutline {
  id: string;
  title: string;
  intent: string;
  keyFacts: string[];
}

export interface PublicPageOutline extends PageOutline {}

interface SlideGenerationResult {
  slide: SlideV2;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

const DEFAULT_MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REPAIR_ROUNDS = 6;

export async function generateDeckWithBatchAgent(options: {
  markdownPath: string;
  deckPath: string;
  outputPath: string;
  theme?: string;
  brand?: BrandSpec;
  batchSize?: number;
  maxSlides?: number;
  config?: BatchAgentConfig;
}): Promise<BatchAgentResult> {
  const config = options.config || llmConfigFromEnv();
  const markdown = await readMarkdownInput(options.markdownPath, config.maxInputBytes ?? DEFAULT_MAX_MARKDOWN_BYTES);
  await createDeck(options.deckPath, { title: firstHeading(markdown) || "SlideML2 Deck", theme: options.theme || "default", brand: options.brand });
  const plan = (await planOutlines(markdown, config)).slice(0, options.maxSlides || 7);
  const planPath = `${options.outputPath}.batch-plan.json`;
  await writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");

  let repairCount = 0;
  let fallbackCount = 0;
  const fallbackReasons: string[] = [];
  for (const outline of plan) {
    const generated = await generateSlideFromOutlineResult(outline, config);
    if (generated.fallbackUsed) {
      fallbackCount += 1;
      fallbackReasons.push(`${outline.id}: ${generated.fallbackReason || "generation fallback"}`);
    }
    const validation = validateSlide(generated.slide, await readDeck(options.deckPath));
    if (!validation.ok) {
      const repaired = await repairSlideResult(generated.slide, validation, config);
      if (repaired.fallbackUsed) {
        fallbackCount += 1;
        fallbackReasons.push(`${outline.id}: ${repaired.fallbackReason || "repair fallback"}`);
      }
      repairCount++;
      await appendSlide(options.deckPath, repaired.slide);
    } else {
      await appendSlide(options.deckPath, generated.slide);
    }
  }

  let deck = await readDeck(options.deckPath);
  let validation = validateDeck(deck);
  const maxRepairRounds = Math.max(0, Math.floor(config.maxRepairRounds ?? DEFAULT_MAX_REPAIR_ROUNDS));
  let repairAbandoned = false;
  for (let round = 0; !validation.ok && round < maxRepairRounds; round++) {
    const error = validation.errors.find((item) => item.slideId);
    if (!error) break;
    const index = deck.slides.findIndex((slide) => slide.id === error.slideId);
    if (index < 0) continue;
    const repaired = await repairSlideResult(deck.slides[index]!, validation, config);
    if (repaired.fallbackUsed) {
      fallbackCount += 1;
      fallbackReasons.push(`${deck.slides[index]!.id}: ${repaired.fallbackReason || "repair fallback"}`);
    }
    await replaceSlide(options.deckPath, index, repaired.slide);
    repairCount++;
    deck = await readDeck(options.deckPath);
    validation = validateDeck(deck);
  }
  await writeDeck(options.deckPath, deck);
  const validationPath = `${options.outputPath}.validation.json`;
  if (!validation.ok) {
    repairAbandoned = true;
    await writeFile(validationPath, JSON.stringify(validation, null, 2), "utf8");
    return {
      deckPath: options.deckPath,
      outputPath: options.outputPath,
      planPath,
      validationPath,
      validation,
      repairCount,
      status: "validation-failed",
      fallbackUsed: fallbackCount > 0,
      fallbackCount,
      fallbackReasons,
      repairAbandoned,
      renderSkipped: true,
    };
  }
  const rendered = await renderDeck(options.deckPath, options.outputPath);
  validation = rendered.validation;
  await writeFile(validationPath, JSON.stringify(validation, null, 2), "utf8");
  return {
    deckPath: options.deckPath,
    outputPath: options.outputPath,
    planPath,
    validationPath,
    validation,
    repairCount,
    status: validation.ok ? "ok" : "validation-failed",
    fallbackUsed: fallbackCount > 0,
    fallbackCount,
    fallbackReasons,
    repairAbandoned: !validation.ok,
    renderSkipped: false,
  };
}

async function planOutlines(markdown: string, config: BatchAgentConfig): Promise<PageOutline[]> {
  const text = await callLlm(config, batchSystemPrompt(), [
    "根据 markdown 只生成 5-7 个正文 PPT 页面规划。不要生成封面、目录、章节页、结束页。",
    "只返回 JSON 数组，每项 {id,title,intent,keyFacts}。keyFacts 是该页需要使用的 3-6 条事实，后续生成页面时只看这些 facts。",
    markdown,
  ].join("\n\n"), 4200);
  const raw = await parseJsonWithRepair(text, config) as unknown;
  const list = Array.isArray(raw) ? raw : [];
  return list.map((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      id: slug(String(record.id || `slide-${index + 1}`), index),
      title: String(record.title || `页面 ${index + 1}`),
      intent: String(record.intent || ""),
      keyFacts: stringArray(record.keyFacts).slice(0, 6),
    };
  }).slice(0, 7);
}

async function generateSlideFromOutline(outline: PageOutline, config: BatchAgentConfig): Promise<SlideV2> {
  return (await generateSlideFromOutlineResult(outline, config)).slide;
}

async function generateSlideFromOutlineResult(outline: PageOutline, config: BatchAgentConfig): Promise<SlideGenerationResult> {
  const promptPack = buildAgentPromptPack({ intent: [outline.title, outline.intent, ...outline.keyFacts].join(" "), includeExamples: false });
  const text = await callLlm(config, batchSystemPrompt(), [
    "为下面一个页面规划生成单个 SlideML2 slide JSON。只包含 id、title、children。",
    "不要输出数组，不要输出整份 deck，不要输出封面/目录/结束页。",
    promptPack,
    "页面规划:",
    JSON.stringify(outline, null, 2),
  ].join("\n\n"), 2600);
  try {
    const raw = await parseJsonWithRepair(text, config) as unknown;
    const slide = normalizeSlide(raw);
    if (slide) return { slide, fallbackUsed: false };
    return { slide: fallbackSlide(outline), fallbackUsed: true, fallbackReason: "LLM JSON did not normalize to a slide" };
  } catch (error) {
    return { slide: fallbackSlide(outline), fallbackUsed: true, fallbackReason: error instanceof Error ? error.message : String(error) };
  }
}

export async function generateOneSlideWithLlm(outline: PublicPageOutline, config: BatchAgentConfig = llmConfigFromEnv()): Promise<SlideV2> {
  return generateSlideFromOutline(outline, config);
}

async function repairSlide(slide: SlideV2, validation: ValidationReport, config: BatchAgentConfig): Promise<SlideV2> {
  return (await repairSlideResult(slide, validation, config)).slide;
}

async function repairSlideResult(slide: SlideV2, validation: ValidationReport, config: BatchAgentConfig): Promise<SlideGenerationResult> {
  const text = await callLlm(config, batchSystemPrompt(), [
    "下面这页 SlideML2 slide validate 失败。请整页重写，只返回单个 slide JSON。",
    "必须保持相同 id，可以调整 title 和 children。不要做 node patch。",
    "错误:",
    JSON.stringify(validation.errors, null, 2),
    "警告:",
    JSON.stringify(validation.warnings.slice(0, 5), null, 2),
    "原 slide:",
    JSON.stringify(slide, null, 2),
  ].join("\n\n"), 3200);
  try {
    const parsed = normalizeSlide(JSON.parse(extractJson(text)));
    if (parsed) return { slide: parsed, fallbackUsed: false };
  } catch {
    // Fall through to the repair parser; it can ask the LLM to repair dirty JSON.
  }
  try {
    const parsed = normalizeSlide(await parseJsonWithRepair(text, config));
    if (parsed) return { slide: parsed, fallbackUsed: false };
    return {
      slide: fallbackSlide({ id: slide.id, title: slide.title || slide.id, intent: "repair fallback", keyFacts: [] }),
      fallbackUsed: true,
      fallbackReason: "repair JSON did not normalize to a slide",
    };
  } catch (error) {
    return {
      slide: fallbackSlide({ id: slide.id, title: slide.title || slide.id, intent: "repair fallback", keyFacts: [] }),
      fallbackUsed: true,
      fallbackReason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readMarkdownInput(markdownPath: string, maxBytes: number): Promise<string> {
  const info = await stat(markdownPath);
  if (info.size > maxBytes) {
    throw new Error(`Markdown input is ${info.size} bytes; maxInputBytes is ${maxBytes}. Split or summarize the source before batch generation.`);
  }
  return readFile(markdownPath, "utf8");
}

async function repairJson(broken: string, config: BatchAgentConfig): Promise<string> {
  return callLlm(
    config,
    "你是 JSON 修复器。只输出合法 JSON，不要解释，不要 markdown 代码块。",
    `修复下面的 JSON。保持原意；如果尾部对象不完整，可以删除不完整尾部，但必须输出合法 JSON。\n\n${broken}`,
    6000,
  );
}

async function parseJsonWithRepair(text: string, config: BatchAgentConfig): Promise<unknown> {
  try {
    return JSON.parse(extractJson(text));
  } catch {
    const repairedJson = await repairJson(text, config);
    return JSON.parse(extractJson(repairedJson));
  }
}

function batchSystemPrompt(): string {
  return getAgentSystemPrompt();
}

function normalizeSlide(raw: unknown): SlideV2 | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const children = Array.isArray(record.children) ? record.children : [];
  return {
    id: slug(String(record.id || "slide"), 0),
    title: typeof record.title === "string" ? record.title : undefined,
    background: typeof record.background === "string" ? record.background : undefined,
    children: children.map((node, index) => normalizeNode(node, `node-${index + 1}`)).filter((node): node is SlideV2["children"][number] => Boolean(node)),
  };
}

function fallbackSlide(outline: PageOutline): SlideV2 {
  return {
    id: outline.id,
    title: outline.title,
    children: [{
      id: `${outline.id}.content`,
      type: "stack",
      area: "content",
      direction: "vertical",
      gap: 0.4,
      children: [
        { id: `${outline.id}.callout`, type: "callout", text: outline.intent || outline.title },
        {
          id: `${outline.id}.points`,
          type: "bullets",
          title: "要点",
          items: [
            "LLM 输出无法稳定解析时，使用规划信息生成保底页面。",
            "该页面保持可验证、可渲染，并允许后续整页 replace。",
          ],
          density: "compact",
        },
      ],
    }],
  };
}

function normalizeNode(raw: unknown, fallbackName: string): SlideV2["children"][number] | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if ("name" in record || "props" in record) return null;
  let type = typeof record.type === "string" ? record.type : "";
  const flat = { ...record };
  if (type === "text" && (flat.kind === "bullets" || Array.isArray(flat.items))) type = "bullets";
  const component = typeof flat.component === "string" ? flat.component : undefined;
  const componentName = type === "component" ? component : type;
  const rawChildren = Array.isArray(record.children) ? record.children : undefined;
  const normalizedChildren = rawChildren?.map((child, index) => normalizeNode(child, `${fallbackName}-${index + 1}`)).filter((node): node is SlideV2["children"][number] => Boolean(node));
  const isCompositeContainer = type === "stack" || type === "grid" || (type === "component" && (component === "stack" || component === "grid"));
  const normalizedFields = normalizeFields(type, type === "component" || (componentName && componentName !== "text" && componentName !== "stack" && componentName !== "grid")
    ? normalizeComponentFields(String(componentName || ""), { ...flat, component }, normalizedChildren)
    : flat);
  return {
    ...normalizedFields,
    id: typeof record.id === "string" ? record.id : fallbackName,
    type: type as SlideV2["children"][number]["type"],
    children: isCompositeContainer ? normalizedChildren : undefined,
  };
}

async function callLlm(config: BatchAgentConfig, system: string, user: string, maxTokens: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 90_000);
  let response: Response;
  try {
    response = await fetch(`${normalizeAnthropicBaseURL(config.baseURL)}/v1/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens || maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        stream: false,
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error(`LLM timed out after ${config.timeoutMs || 90_000}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`LLM failed ${response.status}: ${await response.text()}`);
  const json = await response.json() as { content?: Array<{ text?: string }> };
  const text = json.content?.map((part) => part.text || "").join("\n").trim();
  if (!text) throw new Error("LLM returned empty content");
  return text;
}

function normalizeFields(type: string, fields: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...fields };
  delete normalized.children;
  delete normalized.type;
  delete normalized.id;
  delete normalized.kind;
  delete normalized.variant;
  if (normalized.orientation && !normalized.direction) normalized.direction = normalized.orientation;
  if (normalized.spacing && !normalized.gap) normalized.gap = normalized.spacing;
  if (normalized.metricValue && !normalized.value) normalized.value = normalized.metricValue;
  if (normalized.metricLabel && !normalized.label) normalized.label = normalized.metricLabel;
  if (normalized.title && !normalized.term && type === "component" && normalized.component === "definition-card") normalized.term = normalized.title;
  if (typeof normalized.gap === "string") normalized.gap = spacingValue(normalized.gap);
  if (typeof normalized.padding === "string") normalized.padding = spacingValue(normalized.padding);
  if (type === "bullets" && !Array.isArray(normalized.items)) normalized.items = [];
  return normalized;
}

function spacingValue(value: unknown): number {
  if (value === "small") return 0.2;
  if (value === "medium") return 0.4;
  if (value === "large") return 0.6;
  return 0.4;
}

function normalizeComponentFields(component: string, fields: Record<string, unknown>, children?: SlideV2["children"]): Record<string, unknown> {
  if (component === "callout" && (typeof fields.text !== "string" || !fields.text.trim())) {
    const text = firstTextFrom(children);
    const bulletsText = Array.isArray(fields.bullets) ? fields.bullets.map(String).filter(Boolean).join(" ") : "";
    return { ...fields, text: text || String(fields.content || fields.intent || fields.title || bulletsText || "") };
  }
  return fields;
}

function firstTextFrom(nodes: SlideV2["children"] | undefined): string {
  for (const node of nodes || []) {
    if (node.type === "text" && typeof node.content === "string") return node.content;
    if (node.type === "text" && typeof node.text === "string") return node.text;
    const nested = firstTextFrom(node.children);
    if (nested) return nested;
  }
  return "";
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const source = fenced?.[1] || text;
  const arrayStart = source.indexOf("[");
  const objectStart = source.indexOf("{");
  const start = arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart) ? arrayStart : objectStart;
  const end = source.lastIndexOf(start === arrayStart ? "]" : "}");
  if (start < 0 || end < start) throw new Error(`LLM did not return JSON: ${text.slice(0, 200)}`);
  return source.slice(start, end + 1);
}

function llmConfigFromEnv(): BatchAgentConfig {
  const apiKey = process.env.LLM_API_KEY || process.env.MINIMAX_API_KEY || "";
  const baseURL = process.env.LLM_API || process.env.MINIMAX_API || "";
  const model = process.env.LLM_MODEL || "MiniMax-M2.7-highspeed";
  if (!apiKey || !baseURL) throw new Error("Batch agent requires LLM_API and LLM_API_KEY");
  return { apiKey, baseURL, model };
}

function normalizeAnthropicBaseURL(raw: string): string {
  return raw.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function firstHeading(markdown: string): string | null {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || null;
}

function slug(value: string, index: number): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || `slide-${index + 1}`;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}
