import { readFile, writeFile } from "node:fs/promises";
import { bulletList, comparisonCard, insightCallout, metricCard, stepCard } from "../components.js";
import { describeDeck } from "../deck-disclosure.js";
import { renderToPptx } from "../render.js";
import type { BrandSpec, DomNode, RenderedDeck, RenderedSlide } from "../types.js";

export type AgentPrimitiveNode =
  | ({ type: "stack" | "grid"; id: string; children?: AgentNode[] } & Record<string, unknown>)
  | ({ type: "text"; id: string; text: string; style?: string } & Record<string, unknown>)
  | ({ type: "bullets"; id: string; items: string[]; density?: "comfortable" | "compact" } & Record<string, unknown>)
  | ({ type: "image"; id: string; src?: string; alt?: string; fit?: "cover" | "contain" | "fill" } & Record<string, unknown>);

export type AgentComponentNode = {
  type: "metric-card" | "step-card" | "comparison-card" | "callout" | "component";
  component?: "metric-card" | "step-card" | "comparison-card" | "callout";
  id: string;
} & Record<string, unknown>;

export type AgentNode = AgentPrimitiveNode | AgentComponentNode;

export interface ComponentAgentSlidePlan {
  id: string;
  title: string;
  structure: string;
  children: AgentNode[];
}

export interface ComponentAgentPlan {
  title: string;
  brand: BrandSpec;
  slides: ComponentAgentSlidePlan[];
}

export interface ComponentAgentResult {
  plan: ComponentAgentPlan;
  deck: RenderedDeck;
  outputPath: string;
  planPath: string;
  slideml2Path: string;
  domPath: string;
}

export interface ComponentAgentConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  maxTokens?: number;
}

export async function generateWithComponentAgent(markdownPath: string, outputPath: string, logo: string, config: ComponentAgentConfig = llmConfigFromEnv()): Promise<ComponentAgentResult> {
  const markdown = await readFile(markdownPath, "utf8");
  const plan = await planWithComponentAgent(markdown, logo, config);
  const deck = deckFromComponentPlan(plan, logo);
  const planPath = `${outputPath}.component-plan.json`;
  const slideml2Path = `${outputPath}.slideml2.json`;
  await writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");
  await writeFile(slideml2Path, JSON.stringify(deck, null, 2), "utf8");
  const rendered = await renderToPptx(deck, outputPath);
  return { plan, deck, outputPath, planPath, slideml2Path, domPath: rendered.domPath };
}

export async function planWithComponentAgent(markdown: string, logo?: string, config: ComponentAgentConfig = llmConfigFromEnv()): Promise<ComponentAgentPlan> {
  const response = await callComponentAgent(markdown, config);
  try {
    return normalizeComponentPlan(JSON.parse(extractJsonObject(response)), markdown, logo);
  } catch (error) {
    const repaired = await repairJson(response, config);
    return normalizeComponentPlan(JSON.parse(extractJsonObject(repaired)), markdown, logo);
  }
}

export function deckFromComponentPlan(plan: ComponentAgentPlan, logo: string): RenderedDeck {
  return {
    deck: { size: "16x9", theme: "simple", brand: { ...plan.brand, logo } },
    slides: plan.slides.map((slide) => slideFromComponentPlan(slide, logo)),
  };
}

function slideFromComponentPlan(plan: ComponentAgentSlidePlan, logo: string): RenderedSlide {
  const contentChildren = plan.children.map((child, index) => expandAgentNode(plan.id, child, `${plan.id}.content.${index + 1}`, logo));
  const hasContentArea = contentChildren.some((child) => child.area === "content");
  return {
    id: plan.id,
    layout: "title-and-content",
    dom: {
      id: `${plan.id}.root`,
      type: "slide",
      background: "background",
      children: [
        {
          id: `${plan.id}.title`,
          type: "text",
          text: plan.title,
          style: "slide-title",
          align: "left",
        },
        ...(hasContentArea
          ? contentChildren
          : [{
              id: `${plan.id}.content`,
              type: "stack" as const,
              area: "content",
              direction: "vertical",
              gap: 0.35,
              children: contentChildren,
            }]),
      ],
    },
  };
}

function agentNodeComponentName(node: AgentNode): string {
  if (node.type === "component") return String((node as AgentComponentNode).component || "");
  if (node.type === "metric-card" || node.type === "step-card" || node.type === "comparison-card" || node.type === "callout") return node.type;
  return "";
}

function expandAgentNode(slideId: string, node: AgentNode, fallbackId: string, logo: string): DomNode {
  const componentName = agentNodeComponentName(node);
  if (componentName) return expandComponentNode(slideId, node as AgentComponentNode, componentName, fallbackId, logo);
  const children = "children" in node && Array.isArray(node.children)
    ? node.children.map((child, index) => expandAgentNode(slideId, child, `${fallbackId}.${index + 1}`, logo))
    : undefined;
  const { children: _children, ...fields } = node;
  return {
    ...sanitizeFields(fields),
    id: scopedId(slideId, node.id || fallbackId),
    type: node.type,
    children,
  };
}

function expandComponentNode(slideId: string, node: AgentComponentNode, componentName: string, fallbackId: string, _logo: string): DomNode {
  const id = scopedId(slideId, node.id || fallbackId);
  const localId = id.startsWith(`${slideId}.`) ? id.slice(slideId.length + 1) : id;
  if (componentName === "metric-card") {
    const unit = stringValue(node.unit, "");
    return mergeRootFields(node, { ...metricCard(slideId, localId, `${stringValue(node.value, "")}${unit}`, stringValue(node.label, "")), id });
  }
  if (componentName === "step-card") {
    return mergeRootFields(node, { ...stepCard(
      slideId,
      localId,
      stringValue(node.step, stringValue(node.number, "")),
      stringValue(node.title, stringValue(node.label, "")),
      stringValue(node.body, stringValue(node.description, stringValue(node.status, stringValue(node.subtitle, stringArray(node.steps).join("\n"))))),
    ), id });
  }
  if (componentName === "comparison-card") {
    return mergeRootFields(node, { ...comparisonCard(slideId, localId, stringValue(node.title, ""), comparisonPoints(node).slice(0, 5)), id });
  }
  return mergeRootFields(node, { ...insightCallout(slideId, localId, stringValue(node.text, "")), id });
}

async function callComponentAgent(markdown: string, config: ComponentAgentConfig): Promise<string> {
  const response = await fetch(`${normalizeAnthropicBaseURL(config.baseURL)}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens ?? 12000,
      system: componentAgentPrompt(),
      messages: [{ role: "user", content: `请根据下面 markdown 生成 SlideML2 component deck JSON。\n\n${markdown}` }],
      stream: false,
    }),
  });
  if (!response.ok) throw new Error(`Component agent failed ${response.status}: ${await response.text()}`);
  const json = await response.json() as { content?: Array<{ text?: string }> };
  const text = json.content?.map((part) => part.text || "").join("\n").trim();
  if (!text) throw new Error("Component agent returned empty content");
  return text;
}

async function repairJson(broken: string, config: ComponentAgentConfig): Promise<string> {
  const response = await fetch(`${normalizeAnthropicBaseURL(config.baseURL)}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: Math.min(config.maxTokens ?? 6000, 6000),
      system: "你是 JSON 修复器。只输出修复后的 JSON，不要解释，不要 markdown 代码块。",
      messages: [{ role: "user", content: `修复下面的 SlideML2 JSON。保持原有内容，删除无法修复的尾部不完整对象也可以，但必须输出合法 JSON。\n\n${broken}` }],
      stream: false,
    }),
  });
  if (!response.ok) throw new Error(`Component JSON repair failed ${response.status}: ${await response.text()}`);
  const json = await response.json() as { content?: Array<{ text?: string }> };
  const text = json.content?.map((part) => part.text || "").join("\n").trim();
  if (!text) throw new Error("Component JSON repair returned empty content");
  return text;
}

function componentAgentPrompt(): string {
  const deck = describeDeck();
  const principles = [
    ...deck.layoutPrinciples,
    ...deck.consistencyPrinciples,
  ].map((line) => `- ${line}`).join("\n");
  const hygiene = deck.textHygiene.map((line) => `- ${line}`).join("\n");
  const choice = deck.componentChoiceGuidelines.map((line) => `- ${line}`).join("\n");
  const doNot = deck.doNot.map((line) => `- ${line}`).join("\n");
  return [
    "你是 SlideML2 component agent。你的任务是从 markdown 生成 PPT 的语义 component tree。",
    "只输出 JSON，不要输出 markdown 代码块，不要解释。",
    "只生成正文内容页，不要生成封面页、目录页、章节页、结束页、谢谢页、数据来源页。",
    "总页数控制在 5-7 页；每页最多 3 个直接子节点；每个 grid 最多 4 列。",
    "不要使用页面级 layout 名称；不要输出 cover、section、dashboard、product-matrix、risk-list、recommendation-list 这类页面级组件。",
    "节点 type 字段直接写组件名（如 type:'callout'、type:'metric-card'、type:'slide-title'、type:'h1'），不需要 type:'component' + component:'X' 的两层写法，也不需要 type:'text' + style:'slide-title'。",
    "可用 primitive：stack、grid、text、bullets、image、table、chart、shape、spacer、divider。",
    "可用语义组件：metric-card、kpi-grid、step-card、comparison-card、callout、quote、numbered-list、icon-text、timeline、profile-card、definition-card、swot-matrix、cta、section-break、slide-title、h1、h2、lead、source-note、label、code。",
    "字段命名规则（务必严格执行）：",
    "- bullets 节点的字段名是 items，不是 bullets：{type:'bullets', items:['...']}。",
    "- comparison-card 的列表字段是 points 或 items。",
    "- metric-card 必须有 value 与 label，可选 unit/trend。",
    "- 不要输出空的 children:[] 或 items:[]；如果某区段没内容就直接省略整个节点。",
    "如果需要表格信息，改写为少量 comparison-card、metric-card 或 bullets，不要输出完整表格网格。",
    "不要使用 emoji，避免影响字体和版面。",
    "每页 children 可以直接放语义组件、stack、grid、split 或 anchored overlay；area:'content' 表示占用标准正文区域，不是必须的单一根节点。",
    "用 stack/grid/split 自己组织页面：direction、columns、columnWeights、rowWeights、gap、fixedHeight、layoutWeight、padding、fill、line 都可以设置。",
    "所有距离单位是 cm（gap、padding、fixedHeight 等都是 cm 数）。",
    "所有节点字段都是扁平字段；不要输出 name 或 props。",
    "每页信息要克制，内容太多时拆成多页。每页需要 title、structure、children。",
    "不要臆造事实，只能压缩、重组 markdown 中的信息。",
    "",
    "排版与一致性原则：",
    principles,
    "",
    "文本长度规范（避免超长被压缩）：",
    hygiene,
    "",
    "组件选择指引：",
    choice,
    "",
    "禁止：",
    doNot,
    "JSON 结构：",
    JSON.stringify({
      title: "deck title",
      brand: { name: "brand or topic", primary: "2563EB" },
      slides: [{
        id: "slide-1",
        title: "页面标题",
        structure: "说明 agent 使用 stack/grid/组件 形成的结构",
        children: [{
          type: "stack",
          id: "main-content",
          area: "content",
          direction: "vertical",
          gap: 0.35,
          children: [
            { type: "callout", id: "key-message", text: "一句主结论" },
            { type: "grid", id: "metric-row", columns: 3, gap: 0.3, fixedHeight: 1.85, children: [
              { type: "metric-card", id: "metric-1", value: "30%+", label: "智能眼镜 CAGR" },
            ] },
          ],
        }],
      }],
    }, null, 2),
  ].join("\n");
}

function normalizeComponentPlan(raw: unknown, markdown: string, logo?: string): ComponentAgentPlan {
  const record = isRecord(raw) ? raw : {};
  const brand = isRecord(record.brand) ? record.brand : {};
  const slides = Array.isArray(record.slides) ? record.slides : [];
  const normalizedSlides = slides.map((slide, index) => normalizeSlide(slide, index)).filter((slide): slide is ComponentAgentSlidePlan => Boolean(slide));
  if (normalizedSlides.length === 0) throw new Error("Component agent did not return valid slides");
  return {
    title: stringValue(record.title, firstHeading(markdown) || "SlideML2 Component Deck"),
    brand: {
      name: stringValue(brand.name, firstHeading(markdown) || "SlideML2"),
      primary: normalizeHex(stringValue(brand.primary, "2563EB")),
      logo,
    },
    slides: normalizedSlides.slice(0, 12),
  };
}

function normalizeSlide(raw: unknown, index: number): ComponentAgentSlidePlan | null {
  if (!isRecord(raw)) return null;
  const children = Array.isArray(raw.children) ? raw.children.map(normalizeAgentNode).filter((node): node is AgentNode => Boolean(node)) : [];
  if (children.length === 0) return null;
  return {
    id: slugId(stringValue(raw.id, `slide-${index + 1}`), index),
    title: stringValue(raw.title, `页面 ${index + 1}`),
    structure: stringValue(raw.structure, "agent-composed component tree"),
    children,
  };
}

function normalizeAgentNode(raw: unknown): AgentNode | null {
  if (!isRecord(raw)) return null;
  if ("name" in raw || "props" in raw) return null;
  const type = raw.type;
  const id = safeName(stringValue(raw.id, String(type || "node")), "node");
  const fields = sanitizeFields(raw);
  if (type === "metric-card" || type === "step-card" || type === "comparison-card" || type === "callout") {
    return { ...fields, type, id } as AgentNode;
  }
  if (type === "component") {
    const component = raw.component;
    if (component !== "metric-card" && component !== "step-card" && component !== "comparison-card" && component !== "callout") return null;
    return { ...fields, type, component, id };
  }
  if (type === "stack" || type === "grid") {
    const children = Array.isArray(raw.children) ? raw.children.map(normalizeAgentNode).filter((node): node is AgentNode => Boolean(node)) : [];
    return { ...fields, type, id, children };
  }
  if (type === "text") return { ...fields, type, id, text: stringValue(fields.text, stringValue(fields.content, "")), style: stringValue(fields.style, stringValue(fields.kind, "paragraph")) };
  if (type === "bullets") {
    let items = stringArray(fields.items);
    if (items.length === 0) {
      for (const alias of ["bullets", "points", "list", "lines"]) {
        const candidate = stringArray(fields[alias]);
        if (candidate.length > 0) { items = candidate; break; }
      }
    }
    return { ...fields, type, id, items: items.slice(0, 8) };
  }
  if (type === "image") return { ...fields, type, id };
  return null;
}

function sanitizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([key, value]) => (
    key !== "children" &&
    key !== "props" &&
    key !== "name" &&
    (typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      Array.isArray(value))
  )));
}

function scopedId(slideId: string, id: string): string {
  return id.startsWith(`${slideId}.`) ? id : `${slideId}.${safeName(id, "node")}`;
}

function mergeRootFields(source: AgentComponentNode, expanded: DomNode): DomNode {
  const rootFields = sanitizeFields(source);
  delete rootFields.type;
  delete rootFields.component;
  delete rootFields.id;
  return { ...expanded, ...rootFields };
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const source = fenced?.[1] || text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`Component agent did not return JSON: ${text.slice(0, 200)}`);
  return source.slice(start, end + 1);
}

function llmConfigFromEnv(): ComponentAgentConfig {
  const apiKey = process.env.LLM_API_KEY || process.env.MINIMAX_API_KEY || "";
  const baseURL = process.env.LLM_API || process.env.MINIMAX_API || "";
  const model = process.env.LLM_MODEL || "MiniMax-M2.7-highspeed";
  if (!apiKey || !baseURL) throw new Error("Component agent requires LLM_API and LLM_API_KEY");
  return { apiKey, baseURL, model };
}

function normalizeAnthropicBaseURL(raw: string): string {
  return raw.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function firstHeading(markdown: string): string | null {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function comparisonPoints(fields: Record<string, unknown>): string[] {
  const points = stringArray(fields.points);
  if (points.length > 0) return points;
  const items = stringArray(fields.items);
  if (items.length > 0) return items;
  const derived = [
    stringValue(fields.subtitle, ""),
    stringValue(fields.body, ""),
    stringValue(fields.leftLabel, "") && stringValue(fields.leftValue, "") ? `${stringValue(fields.leftLabel, "")}: ${stringValue(fields.leftValue, "")}` : "",
    stringValue(fields.rightLabel, "") && stringValue(fields.rightValue, "") ? `${stringValue(fields.rightLabel, "")}: ${stringValue(fields.rightValue, "")}` : "",
  ].filter(Boolean);
  return derived.length > 0 ? derived : [stringValue(fields.title, "")].filter(Boolean);
}

function styleToKind(style: unknown): string {
  if (style === "subtitle") return "card-title";
  if (style === "small") return "caption";
  if (style === "large") return "section-title";
  return "paragraph";
}

function safeName(value: string, fallback: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function slugId(value: string, index: number): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || `slide-${index + 1}`;
}

function normalizeHex(value: string): string {
  const cleaned = value.replace(/^#/, "");
  return /^[0-9A-Fa-f]{6}$/.test(cleaned) ? cleaned.toUpperCase() : "2563EB";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
