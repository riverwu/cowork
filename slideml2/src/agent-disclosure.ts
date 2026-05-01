import { describeComponents, listComponents } from "./component-registry.js";
import { describeDeck } from "./deck-disclosure.js";
import { listPaletteColors } from "./theme.js";

export interface AgentPromptPackOptions {
  intent?: string;
  components?: string[];
  includeExamples?: boolean;
  /** Default true. Set false to omit the full deck rule block. */
  includeDeckGuide?: boolean;
  /** Default true. Set false to omit the always-on starter component set. */
  includeStarterComponents?: boolean;
}

/**
 * The starter set is *always* offered to the agent (in addition to intent-
 * ranked extras). It covers the eight composite shapes and decorative
 * containers an agent should consider on most slides — without these the
 * model defaults to callouts for everything because intent-ranking alone
 * doesn't surface the new vocabulary.
 */
const STARTER_COMPONENTS = [
  "panel", "card", "band", "frame", "inset",
  "feature-card", "checklist", "progress-bar", "pros-cons",
  "process-flow", "stat-comparison", "pricing-card", "logo-strip",
  "metric-card", "callout", "comparison-card", "step-card",
  "definition-card", "kpi-grid", "timeline", "section-break",
  "swot-matrix", "quote", "icon-text", "numbered-list",
  "hero-stat", "bar-list", "tag-list", "key-takeaway", "numbered-grid",
  "stat-strip", "legend", "badge", "flow-arrow",
  "image-card", "chart-card", "table-card", "insight-card", "two-column",
  "lead", "h1", "h2", "text", "label", "source-note",
] as const;

function rankComponentsForIntent(intent: string, limit = 4): string[] {
  const text = intent.toLowerCase();
  const scored = listComponents().map((component) => {
    const haystack = [component.name, component.purpose].join(" ").toLowerCase();
    let score = 0;
    for (const term of intentTerms(text)) {
      if (haystack.includes(term)) score += 2;
    }
    score += heuristicComponentScore(component.name, text);
    return { name: component.name, score };
  });
  const selected = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((item) => item.name)
    .slice(0, limit);
  return selected.length > 0 ? selected : ["callout", "comparison-card", "metric-card"].slice(0, limit);
}

export function buildAgentPromptPack(options: AgentPromptPackOptions = {}): string {
  const includeDeckGuide = options.includeDeckGuide !== false;
  const includeStarter = options.includeStarterComponents !== false;
  const intentExtras = rankComponentsForIntent(options.intent || "", 4);
  const explicit = options.components || [];
  const components = unique([
    "stack", "grid",
    ...(includeStarter ? STARTER_COMPONENTS : []),
    ...intentExtras,
    ...explicit,
  ]);
  const descriptions = describeComponents(components).found;
  const palette = listPaletteColors();
  const lines: string[] = [
    "SlideML2 compact guide:",
    "- Output exactly one slide JSON: {id,title,children}.",
    "- Write the component name directly in `type`: {id,type:'callout',...fields}; never wrap as type:'component'+component:'X'.",
    "- Component nodes are flat; do not wrap fields in `props`.",
    "- Compose the page freely with top-level components, stack/grid/split, and anchored overlays. Use area:'content' when a node should occupy the standard content rect; it is not a required wrapper.",
    "- All distance fields (gap, padding, fixedHeight, fixedWidth, ...) are in cm.",
    "- Avoid page-level components: cover, section, dashboard, product-matrix, risk-list.",
    "- For each slide, reach for the *most semantic* component first. Only fall back to plain `callout` when no specific component fits.",
    "- Pick from this menu, in roughly this order of preference:",
    "    KPIs/quantitative outcomes → kpi-grid (3-4 metric-card)",
    "    Before/after numeric shift → stat-comparison",
    "    Done/not-done audit list → checklist",
    "    Pros vs cons trade-offs → pros-cons",
    "    Pipeline / multi-stage process → process-flow (3-5 stages)",
    "    Long dated sequence → timeline",
    "    Product/feature highlights → grid of feature-card (icon+title+body)",
    "    Pricing tiers → grid of pricing-card (mark one with tone:'brand')",
    "    Framed evidence image → image-card",
    "    Dashboard chart module → chart-card",
    "    Financial/feature matrix module → table-card",
    "    Reusable insight with badge/detail/bullets → insight-card",
    "    Narrative + visual/chart split → two-column",
    "    Partner/customer logos → logo-strip",
    "    Strategic 2x2 → swot-matrix",
    "    Compare 2-4 things with parallel points → comparison-card grid",
    "    Define a term → definition-card",
    "    % completion / quota → progress-bar",
    "    Single hero insight → callout (use sparingly — once per slide max)",
    "    Pull-quote → quote",
    "    Long article body → article",
    "- Decorative containers (NOT layout): panel (tinted surface), card (panel + header/footer/accent), band (full-width strip), frame (border-only), inset (padding only). Wrap a stack/grid inside one when grouping needs visual separation. Never set fill/line/cornerRadius on stack/grid — wrap in panel/card instead.",
    `- Color tokens: brand.primary, surface, surface.subtle, text.primary, text.muted, text.inverse, divider, success/warning/danger (+ .tint), brand.tint. Semantic palette for *categorical* meaning: ${palette.join(", ")} (each with .tint and .shade). DO NOT invent tokens like text-secondary, primary-color.`,
    "- Use `optional: true` on captions/source-notes/secondary callouts so the layout can drop them when space is tight.",
    "- Minimal shape: {\"id\":\"s1\",\"title\":\"Title\",\"children\":[{\"id\":\"s1.lead\",\"type\":\"lead\",\"area\":\"content\",\"text\":\"One insight\"}]}",
  ];
  if (includeDeckGuide) {
    const deck = describeDeck();
    lines.push("", "Layout principles:");
    for (const r of deck.layoutPrinciples) lines.push(`- ${r}`);
    lines.push("", "Consistency:");
    for (const r of deck.consistencyPrinciples) lines.push(`- ${r}`);
    lines.push("", "Text hygiene:");
    for (const r of deck.textHygiene) lines.push(`- ${r}`);
    lines.push("", "Component choice:");
    for (const r of deck.componentChoiceGuidelines) lines.push(`- ${r}`);
    lines.push("", "Container usage (panel/card/band/frame/inset):");
    for (const r of deck.containerUsageRules) lines.push(`- ${r}`);
    lines.push("", "Color usage:");
    for (const r of deck.colorUsageRules) lines.push(`- ${r}`);
    lines.push("", "Color palette usage:");
    for (const r of deck.colorPaletteUsage) lines.push(`- ${r}`);
    lines.push("", "Shape decoration:");
    for (const r of deck.shapeDecorationRules) lines.push(`- ${r}`);
    lines.push("", "Emphasis hierarchy:");
    for (const r of deck.emphasisHierarchy) lines.push(`- ${r}`);
    lines.push("", "Density:");
    for (const r of deck.densityRules) lines.push(`- ${r}`);
    lines.push("", "Fallback ladder (these are the layout failure modes you should avoid; if you see them in diagnostics, restructure rather than tweak sizes):");
    for (const r of deck.fallbackLadder.stages) lines.push(`- ${r}`);
    lines.push("", "Do NOT:");
    for (const r of deck.doNot) lines.push(`- ${r}`);
  }
  lines.push("", "Component schemas:");
  for (const name of components) {
    const line = compactComponentSchema(descriptions[name], Boolean(options.includeExamples));
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

export function getAgentSystemPrompt(): string {
  return [
    "You are a SlideML2 agent. Output well-structured presentation slide JSON.",
    "Reach for the most semantic component first (kpi-grid, stat-comparison, checklist, pros-cons, process-flow, feature-card, pricing-card, logo-strip, timeline, swot-matrix, comparison-card, definition-card, quote, etc.). Use bare callout/text only when no specific component fits.",
    "Group related primitives in a panel/card/band/frame/inset to give them visual separation; do NOT set fill/line/cornerRadius on stack/grid.",
    "One emphasis system per slide: brand.primary OR semantic palette (red/lime/blue/...) — never both. Use success/warning/danger only when the value carries that meaning. Body text stays text.primary or text.muted.",
    "Use only documented color tokens; do not invent names like text-secondary or primary-color.",
    "Mark nice-to-have children with optional:true so the renderer can drop them under tight layout.",
    "Return strict JSON only — no markdown fences, no commentary, no trailing text.",
  ].join("\n");
}

function compactComponentSchema(definition: import("./component-registry.js").ComponentDescription | undefined, includeExample: boolean): string {
  if (!definition) return "";
  const fields = Object.entries(definition.fields).slice(0, 8).map(([key, prop]) => `${key}${prop.required ? "*" : ""}:${prop.type}`).join(", ");
  const shouldIncludeExample = includeExample || definition.children.required;
  const example = shouldIncludeExample && definition.examples[0] ? ` example=${JSON.stringify(definition.examples[0])}` : "";
  const parent = definition.layoutBehavior?.preferredParent || "any";
  const children = definition.children.allowed
    ? ` children=${definition.children.required ? "required" : "optional"}`
    : " children=none";
  return `- ${definition.name}: ${definition.purpose} parent=${parent}${children} fields={type:'${definition.name}', ${fields}}${example}`;
}

function intentTerms(text: string): string[] {
  return text.split(/[^a-z0-9\u4e00-\u9fff%]+/).map((item) => item.trim()).filter((item) => item.length >= 2);
}

function heuristicComponentScore(name: string, text: string): number {
  if (name === "stack" && /layout|column|row|section|布局|区域|纵向|横向/.test(text)) return 5;
  if (name === "grid" && /grid|columns|cards|matrix|网格|分栏|矩阵|卡片/.test(text)) return 5;
  if (name === "spacer" && /space|gap|breath|留白|间距|空白/.test(text)) return 4;
  if (name === "divider" && /divider|rule|split|separator|分割|分隔|线/.test(text)) return 4;
  if (name === "image" && /image|photo|logo|visual|图片|图像|照片|视觉|logo/.test(text)) return 6;
  if (name === "table" && /table|rows|columns|data|表格|行|列|数据/.test(text)) return 6;
  if (name === "chart" && /chart|bar|line|pie|trend|图表|柱状|折线|饼图|趋势/.test(text)) return 6;
  if (name === "metric-card" && /metric|kpi|growth|market|revenue|规模|增长|营收|比例|百分|cagr|%/.test(text)) return 6;
  if (name === "callout" && /insight|thesis|highlight|summary|结论|洞察|摘要|建议|判断/.test(text)) return 5;
  if (name === "lead" && /summary|thesis|opening|摘要|开篇|主结论|核心判断/.test(text)) return 5;
  if (name === "article" && /article|passage|prose|reading|long-form|长文|文章|阅读|段落|原文/.test(text)) return 6;
  if (name === "text" && /text|paragraph|body|explain|正文|说明|解释/.test(text)) return 4;
  if (name === "code" && /code|api|config|json|代码|接口|配置/.test(text)) return 6;
  if (name === "source-note" && /source|citation|disclaimer|出处|来源|数据来源|免责声明/.test(text)) return 5;
  if (name === "label" && /status|badge|priority|tag|category|状态|标签|优先级|分类/.test(text)) return 4;
  if (name === "comparison-card" && /compare|vendor|product|option|竞争|对比|比较|厂商|产品/.test(text)) return 5;
  if (name === "step-card" && /timeline|roadmap|process|stage|步骤|阶段|路线|流程/.test(text)) return 5;
  if (name === "definition-card" && /definition|concept|term|定义|概念|术语/.test(text)) return 4;
  if (name === "feature-card" && /feature|capability|benefit|功能|能力|特性|优势/.test(text)) return 5;
  if (name === "checklist" && /checklist|requirement|audit|done|清单|清查|审核/.test(text)) return 5;
  if (name === "progress-bar" && /progress|completion|quota|capacity|进度|完成|配额|容量|百分比/.test(text)) return 5;
  if (name === "pros-cons" && /pros|cons|tradeoff|trade-off|优劣|优缺|取舍|利弊/.test(text)) return 5;
  if (name === "process-flow" && /pipeline|flow|stage|step|流程|阶段|管道|流水线|步骤/.test(text)) return 5;
  if (name === "logo-strip" && /logo|partner|customer|client|合作|客户|伙伴|商标/.test(text)) return 6;
  if (name === "pricing-card" && /pricing|plan|tier|subscription|定价|套餐|档位|订阅|价格/.test(text)) return 6;
  if (name === "stat-comparison" && /before|after|delta|change|前后|对比|提升|下降|变化/.test(text)) return 5;
  if (name === "hero-stat" && /headline|hero|landmark|big number|核心|头条|核心数据|关键数字|大数字/.test(text)) return 6;
  if (name === "bar-list" && /ranking|share|distribution|breakdown|排名|占比|分布|份额|分解/.test(text)) return 6;
  if (name === "tag-list" && /keyword|tag|chip|label|category|关键词|标签|分类|类别|tags/.test(text)) return 5;
  if (name === "key-takeaway" && /takeaway|conclusion|so what|结论|要点|启示|核心|底牌/.test(text)) return 6;
  if (name === "numbered-grid" && /principle|priority|step|principle|rank|框架|要点|原则|准则|优先级|步骤/.test(text)) return 5;
  if (name === "stat-strip" && /headline|inline|strip|kpi|核心数据|首屏|条/.test(text)) return 5;
  if (name === "legend" && /legend|category|key|图例|图注|分类|标识/.test(text)) return 5;
  if (name === "badge" && /status|tag|category|new|hot|状态|徽章|标记|新品/.test(text)) return 4;
  if (name === "flow-arrow" && /arrow|connect|flow|next|箭头|连接|流向|下一步|过渡/.test(text)) return 5;
  if (name === "image-card" && /image|photo|visual|screenshot|figure|evidence|case|案例|图片|画面|证据|场景/.test(text)) return 6;
  if (name === "chart-card" && /chart|graph|plot|dashboard|metric.*chart|图表|趋势|柱状|饼图|可视化|监控/.test(text)) return 6;
  if (name === "table-card" && /matrix|grid.*data|spec|specification|comparison.*table|矩阵|参数|规格|对照表|功能矩阵/.test(text)) return 5;
  if (name === "insight-card" && /insight|callout|highlight|with.*detail|论点|洞察卡|要点卡/.test(text)) return 5;
  if (name === "two-column" && /two-column|side by side|narrative.*visual|chart.*commentary|双栏|两栏|图文|分栏对照/.test(text)) return 5;
  return 0;
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
