import { describe, expect, it } from "vitest";
import { COMPONENT_DEFINITIONS } from "./component-registry.js";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
  type LayoutDiagnostic,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { validateDeck } from "./validate.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Component usability suite. Each test exercises a complex semantic component
 * in a realistic deck context — full slide title, sibling content, dense items,
 * dark/light theme variants — and asserts:
 *   - schema validation passes (component fields the agent reaches for resolve)
 *   - 0 BLOCKING render diagnostics (LOW_CONTRAST/FALLBACK_FAILED/SQUASHED/...)
 *
 * The intent: every composition pattern an agent is likely to author, on
 * either a default or a custom themed deck, should render the FIRST time
 * without forcing a multi-turn repair loop. Regressions to that contract show
 * up here as test failures, not in production logs.
 */

const TINY_PNG = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MDAiIGhlaWdodD0iNDUwIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjQ1MCIgZmlsbD0iIzExMTgyNyIvPjwvc3ZnPg==";

const BLOCKING: ReadonlySet<LayoutDiagnostic["code"]> = new Set([
  "FALLBACK_FAILED", "COLLISION", "TINY_RECT", "SQUASHED", "DROP", "LOW_CONTRAST", "UNKNOWN_COLOR", "UNKNOWN_STYLE",
]);

const DARK_OVERRIDE: Slideml2SourceDeck["deck"]["themeOverride"] = {
  colors: {
    brand: { primary: "C0392B" },
    background: "0D1117",
    surface: "161B22",
    text: { primary: "F0F6FC", secondary: "8B949E", muted: "484F58", inverse: "0D1117" },
  } as never,
};

const LIGHT_BRAND_OVERRIDE: Slideml2SourceDeck["deck"]["themeOverride"] = {
  colors: {
    brand: { primary: "C41E3A" },
    background: "FDF6E3",
    surface: "FFFFFF",
    text: { primary: "1A1A1A", secondary: "555555", muted: "888888" },
  } as never,
};

interface UsabilityCase {
  name: string;
  build: () => SlideV2;
  themeOverride?: Slideml2SourceDeck["deck"]["themeOverride"];
}

function deckWith(slide: SlideV2, themeOverride?: Slideml2SourceDeck["deck"]["themeOverride"]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { name: "Test", primary: "8B0000" }, themeOverride },
    slides: [slide],
  };
}

function runCase(testCase: UsabilityCase): { schema: string[]; blocking: string[] } {
  const slide = testCase.build();
  const deck = deckWith(slide, testCase.themeOverride);
  const validation = validateDeck(deck);
  const schemaErrors = validation.errors.map((e) => `[${e.code}${e.path ? ` ${e.path}` : ""}] ${e.message}`);
  if (schemaErrors.length > 0) return { schema: schemaErrors, blocking: [] };
  clearRenderDiagnostics();
  renderToAst(sourceToRenderedDeck(deck));
  const blocking = getRenderDiagnostics()
    .filter((d) => BLOCKING.has(d.code) && d.severity !== "info")
    .map((d) => `[${d.code} ${d.slideId || "?"}/${d.nodeId || "?"}] ${d.message?.slice(0, 200)}`);
  return { schema: [], blocking };
}

const KNOWN_COMPONENT_NAMES = new Set(COMPONENT_DEFINITIONS.map((d) => d.name));

const cases: UsabilityCase[] = [
  // ---- Dense data components ----
  {
    name: "kpi-grid 4 metrics with trend on dark theme",
    themeOverride: DARK_OVERRIDE,
    build: () => ({
      id: "s",
      title: "关键指标",
      children: [{
        id: "s.kpi",
        type: "kpi-grid",
        metrics: [
          { value: "500亿+", label: "市场规模", trend: "up" },
          { value: "30%", label: "增速", trend: "up" },
          { value: "78%", label: "市占", trend: "flat" },
          { value: "8M+", label: "出货", trend: "down" },
        ],
      } as unknown as DomNode],
    }),
  },
  {
    name: "kpi-grid 6 metrics light brand theme",
    themeOverride: LIGHT_BRAND_OVERRIDE,
    build: () => ({
      id: "s",
      title: "六维指标",
      children: [{
        id: "s.kpi",
        type: "kpi-grid",
        columns: 3,
        metrics: Array.from({ length: 6 }, (_, i) => ({ value: `${(i + 1) * 12}%`, label: `维度 ${i + 1}` })),
      } as unknown as DomNode],
    }),
  },
  {
    name: "stat-strip 5 items inside a brand-fill band on dark deck",
    themeOverride: DARK_OVERRIDE,
    build: () => ({
      id: "s",
      title: "数据带",
      children: [{
        id: "s.band",
        type: "band",
        fill: "brand.primary",
        height: 3.4,
        children: [{
          id: "s.band.strip",
          type: "stat-strip",
          tone: "brand",
          items: [
            { value: "5464km", label: "黄河" },
            { value: "6300km", label: "长江" },
            { value: "5000+年", label: "文明" },
            { value: "9省区", label: "流域" },
            { value: "11省市", label: "干流" },
          ],
        } as unknown as DomNode],
      } as unknown as DomNode],
    }),
  },
  {
    name: "bar-list 6 items dense — sortable",
    build: () => ({
      id: "s",
      title: "排行榜",
      children: [{
        id: "s.list",
        type: "bar-list",
        sort: "desc",
        items: Array.from({ length: 6 }, (_, i) => ({ label: `项目 ${i + 1}`, value: 100 - i * 12 })),
      } as unknown as DomNode],
    }),
  },
  {
    name: "hero-stat with caption tone:positive",
    build: () => ({
      id: "s",
      title: "里程碑",
      children: [{
        id: "s.hero",
        type: "hero-stat",
        value: "1.2亿",
        label: "活跃用户",
        caption: "+38% YoY",
        tone: "positive",
      } as unknown as DomNode],
    }),
  },
  {
    name: "stat-comparison up trend on dark theme",
    themeOverride: DARK_OVERRIDE,
    build: () => ({
      id: "s",
      title: "升级前后",
      children: [{
        id: "s.cmp",
        type: "stat-comparison",
        beforeLabel: "升级前",
        beforeValue: "32%",
        afterLabel: "升级后",
        afterValue: "78%",
        trend: "up",
        deltaLabel: "+46pp",
      } as unknown as DomNode],
    }),
  },

  // ---- Cards & narrative ----
  {
    name: "comparison-card grid of 3 (dense bullets)",
    build: () => ({
      id: "s",
      title: "对比",
      children: [{
        id: "s.grid",
        type: "grid",
        columns: 3,
        gap: 0.4,
        area: "content",
        children: Array.from({ length: 3 }, (_, i) => ({
          id: `s.grid.${i}`,
          type: "comparison-card",
          title: `选项 ${i + 1}`,
          subtitle: "说明",
          points: ["要点一", "要点二", "要点三", "要点四"],
        } as unknown as DomNode)),
      } as unknown as DomNode],
    }),
  },
  {
    name: "step-card grid of 4 in numbered-grid",
    build: () => ({
      id: "s",
      title: "四步流程",
      children: [{
        id: "s.steps",
        type: "numbered-grid",
        columns: 4,
        items: Array.from({ length: 4 }, (_, i) => ({ title: `阶段 ${i + 1}`, body: `做${i + 1}件事的简短描述` })),
      } as unknown as DomNode],
    }),
  },
  {
    name: "feature-card grid of 4 with icon backgrounds",
    build: () => ({
      id: "s",
      title: "核心特性",
      children: [{
        id: "s.feat",
        type: "grid",
        columns: 4,
        gap: 0.4,
        area: "content",
        children: Array.from({ length: 4 }, (_, i) => ({
          id: `s.feat.${i}`,
          type: "feature-card",
          icon: "ellipse",
          title: `特性 ${i + 1}`,
          body: "简短说明文字",
          iconColor: "text.inverse",
          iconBackground: "brand.primary",
        } as unknown as DomNode)),
      } as unknown as DomNode],
    }),
  },
  {
    name: "definition-card grid of 4 (glossary)",
    build: () => ({
      id: "s",
      title: "术语",
      children: [{
        id: "s.def",
        type: "grid",
        columns: 4,
        gap: 0.4,
        area: "content",
        children: Array.from({ length: 4 }, (_, i) => ({
          id: `s.def.${i}`,
          type: "definition-card",
          term: `术语 ${i + 1}`,
          definition: "短定义文本，用于术语速览。",
        } as unknown as DomNode)),
      } as unknown as DomNode],
    }),
  },
  {
    name: "insight-card with badge + bullets on dark deck",
    themeOverride: DARK_OVERRIDE,
    build: () => ({
      id: "s",
      title: "核心洞察",
      children: [{
        id: "s.insight",
        type: "insight-card",
        badge: "RISK",
        headline: "需求快速增长但供给受限",
        detail: "近三季度需求侧 +38% YoY，但供给侧产能利用率已达 95%。",
        bullets: ["产能扩张周期约 18 个月", "现金流压力上升", "供应商议价能力提升"],
        tone: "warning",
      } as unknown as DomNode],
    }),
  },
  {
    name: "profile-card grid of 3 dark theme",
    themeOverride: DARK_OVERRIDE,
    build: () => ({
      id: "s",
      title: "团队",
      children: [{
        id: "s.team",
        type: "grid",
        columns: 3,
        gap: 0.5,
        area: "content",
        children: Array.from({ length: 3 }, (_, i) => ({
          id: `s.team.${i}`,
          type: "profile-card",
          image: TINY_PNG,
          name: `成员 ${i + 1}`,
          role: "工程师",
          bio: "8 年经验，专注 AI 与平台工程。",
        } as unknown as DomNode)),
      } as unknown as DomNode],
    }),
  },
  {
    name: "key-takeaway with bullets on light brand theme",
    themeOverride: LIGHT_BRAND_OVERRIDE,
    build: () => ({
      id: "s",
      title: "结论",
      children: [{
        id: "s.tk",
        type: "key-takeaway",
        headline: "继续投入，三个方向并行推进",
        bullets: ["扩展核心场景", "建立合作伙伴生态", "数据驱动迭代"],
      } as unknown as DomNode],
    }),
  },

  // ---- Quotes & callouts ----
  {
    name: "quote with source on dark deck",
    themeOverride: DARK_OVERRIDE,
    build: () => ({
      id: "s",
      title: "用户声音",
      children: [{
        id: "s.q",
        type: "quote",
        text: "这个产品让我重新相信 AI 助理是真的有用。",
        source: "Beta 用户 #042",
      } as unknown as DomNode],
    }),
  },
  {
    name: "callout warning + checklist combo",
    build: () => ({
      id: "s",
      title: "上线前",
      children: [{
        id: "s.body",
        type: "stack",
        direction: "vertical",
        gap: 0.4,
        area: "content",
        children: [
          { id: "s.body.warn", type: "callout", text: "上线前需完成全部 5 项准入。", tone: "warning" } as unknown as DomNode,
          {
            id: "s.body.list",
            type: "checklist",
            items: [
              { text: "安全评审", status: "checked" },
              { text: "性能压测", status: "checked" },
              { text: "灰度方案", status: "warning" },
              { text: "回滚演练", status: "unchecked" },
              { text: "运维 oncall", status: "unchecked" },
            ],
          } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }),
  },
  {
    name: "section-break with eyebrow accent + subtitle",
    build: () => ({
      id: "s",
      children: [{
        id: "s.sb",
        type: "section-break",
        accent: "PART 02",
        title: "经济重心南移",
        subtitle: "唐宋之际的格局转折",
      } as unknown as DomNode],
    }),
  },
  {
    name: "title-lockup tone:'inverse' wraps in brand surface",
    build: () => ({
      id: "s",
      children: [{
        id: "s.lock",
        type: "title-lockup",
        eyebrow: "封面",
        title: "AI 时代的中华文明",
        subtitle: "技术与人文的对话",
        tone: "inverse",
        rule: true,
      } as unknown as DomNode],
    }),
  },

  // ---- Process & sequencing ----
  {
    name: "process-flow horizontal 4 steps",
    build: () => ({
      id: "s",
      title: "流程",
      children: [{
        id: "s.flow",
        type: "process-flow",
        direction: "horizontal",
        steps: [
          { title: "立项", body: "确认目标" },
          { title: "调研", body: "用户访谈" },
          { title: "设计", body: "原型迭代" },
          { title: "投放", body: "全量上线" },
        ],
      } as unknown as DomNode],
    }),
  },
  {
    name: "process-flow vertical 5 steps dense compact mode",
    build: () => ({
      id: "s",
      title: "纵向流程",
      children: [{
        id: "s.flow",
        type: "process-flow",
        direction: "vertical",
        steps: Array.from({ length: 5 }, (_, i) => ({ title: `步骤 ${i + 1}`, body: `工作 ${i + 1}` })),
      } as unknown as DomNode],
    }),
  },
  {
    name: "axis-ruler 5 stages on dark deck",
    themeOverride: DARK_OVERRIDE,
    build: () => ({
      id: "s",
      title: "成熟度",
      children: [{
        id: "s.axis",
        type: "axis-ruler",
        items: Array.from({ length: 5 }, (_, i) => ({ label: `阶段 ${i + 1}`, body: `状态描述 ${i + 1}` })),
      } as unknown as DomNode],
    }),
  },
  {
    name: "timeline 6 items horizontal on dark deck",
    themeOverride: DARK_OVERRIDE,
    build: () => ({
      id: "s",
      title: "六阶段时间线",
      children: [{
        id: "s.tl",
        type: "timeline",
        direction: "horizontal",
        items: [
          { time: "约前2070", title: "夏朝", body: "青铜时代开启" },
          { time: "前221", title: "秦", body: "统一文字" },
          { time: "前206", title: "汉", body: "丝绸之路" },
          { time: "618", title: "唐", body: "万国来朝" },
          { time: "1368", title: "明", body: "海上贸易" },
          { time: "1912", title: "民国", body: "近代转型" },
        ],
      } as unknown as DomNode],
    }),
  },
  {
    name: "timeline 4 items vertical with bodies on dark deck",
    themeOverride: DARK_OVERRIDE,
    build: () => ({
      id: "s",
      children: [{
        id: "s.tl",
        type: "timeline",
        direction: "vertical",
        items: Array.from({ length: 4 }, (_, i) => ({ time: `T${i}`, title: `Step ${i}`, body: `第 ${i} 阶段说明` })),
      } as unknown as DomNode],
    }),
  },

  // ---- Frameworks ----
  {
    name: "swot-matrix on light brand theme",
    themeOverride: LIGHT_BRAND_OVERRIDE,
    build: () => ({
      id: "s",
      title: "SWOT 分析",
      children: [{
        id: "s.swot",
        type: "swot-matrix",
        strengths: ["品牌强", "渠道广", "现金充足"],
        weaknesses: ["技术债", "成本结构"],
        opportunities: ["新兴市场", "AI 协同"],
        threats: ["新进入者", "替代技术"],
      } as unknown as DomNode],
    }),
  },
  {
    name: "pros-cons + key-takeaway summary",
    build: () => ({
      id: "s",
      title: "权衡",
      children: [{
        id: "s.body",
        type: "stack",
        direction: "vertical",
        gap: 0.4,
        area: "content",
        children: [
          {
            id: "s.body.pc",
            type: "pros-cons",
            pros: ["短期收益", "用户存量大", "渠道现成"],
            cons: ["技术债增加", "维护成本上升"],
          } as unknown as DomNode,
          { id: "s.body.tk", type: "key-takeaway", headline: "短期收益高于长期债务，建议执行。", bullets: ["设置 6 个月清理 OKR"] } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }),
  },

  // ---- Visual evidence ----
  {
    name: "image-card with caption + dark deck",
    themeOverride: DARK_OVERRIDE,
    build: () => ({
      id: "s",
      title: "证据图",
      children: [{
        id: "s.img",
        type: "image-card",
        src: TINY_PNG,
        title: "黄河流域分布",
        caption: "数据来源：考古所",
      } as unknown as DomNode],
    }),
  },
  {
    name: "logo-strip 6 logos with caption",
    build: () => ({
      id: "s",
      title: "合作伙伴",
      children: [{
        id: "s.logos",
        type: "logo-strip",
        logos: Array.from({ length: 6 }, (_, i) => ({ src: TINY_PNG, alt: `品牌 ${i + 1}` })),
        caption: "已落地的 6 家头部品牌",
      } as unknown as DomNode],
    }),
  },
  {
    name: "chart-card bar 6 buckets",
    build: () => ({
      id: "s",
      title: "营收",
      children: [{
        id: "s.chart",
        type: "chart-card",
        chartType: "bar",
        labels: ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"],
        series: [{ name: "营收", values: [10, 14, 16, 22, 28, 35] }],
        caption: "数据来源：内部报表",
        showValues: true,
      } as unknown as DomNode],
    }),
  },
  {
    name: "table-card 4 rows on dark deck",
    themeOverride: DARK_OVERRIDE,
    build: () => ({
      id: "s",
      title: "区域对比",
      children: [{
        id: "s.tbl",
        type: "table-card",
        headers: ["地区", "营收", "增长", "份额"],
        rows: [
          ["华东", "1.2 亿", "+18%", "32%"],
          ["华南", "0.9 亿", "+12%", "24%"],
          ["华北", "0.8 亿", "+9%", "22%"],
          ["西南", "0.5 亿", "+24%", "12%"],
        ],
        caption: "2026 Q1 数据",
      } as unknown as DomNode],
    }),
  },

  // ---- Pricing & meta ----
  {
    name: "pricing-card grid of 3 tiers with brand highlight",
    build: () => ({
      id: "s",
      title: "定价方案",
      children: [{
        id: "s.pricing",
        type: "grid",
        columns: 3,
        gap: 0.4,
        area: "content",
        children: [
          { id: "s.pricing.free", type: "pricing-card", plan: "Free", price: "¥0", period: "/月", features: ["1 项目", "1GB", "社区"] } as unknown as DomNode,
          { id: "s.pricing.pro", type: "pricing-card", plan: "Pro", price: "¥99", period: "/月", features: ["10 项目", "100GB", "优先支持"], tone: "brand", ctaText: "升级" } as unknown as DomNode,
          { id: "s.pricing.team", type: "pricing-card", plan: "Team", price: "¥299", period: "/月", features: ["无限", "1TB", "SLA"] } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }),
  },
  {
    name: "tag-list + badge metadata row",
    build: () => ({
      id: "s",
      title: "状态",
      children: [{
        id: "s.row",
        type: "stack",
        direction: "horizontal",
        gap: 0.3,
        align: "start",
        valign: "middle",
        children: [
          { id: "s.row.b1", type: "badge", text: "RISK", tone: "danger" } as unknown as DomNode,
          { id: "s.row.b2", type: "badge", text: "BETA", tone: "warning" } as unknown as DomNode,
          { id: "s.row.tags", type: "tag-list", items: ["AI", "穿戴", "健康", "生态"] } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }),
  },
  {
    name: "legend horizontal across multiple swatches",
    build: () => ({
      id: "s",
      title: "图例",
      children: [{
        id: "s.legend",
        type: "legend",
        direction: "horizontal",
        items: [
          { label: "类别一", color: "brand.primary" },
          { label: "类别二", color: "success" },
          { label: "类别三", color: "warning" },
          { label: "类别四", color: "danger" },
        ],
      } as unknown as DomNode],
    }),
  },
  {
    name: "annotation on dark deck",
    themeOverride: DARK_OVERRIDE,
    build: () => ({
      id: "s",
      title: "注释",
      children: [{
        id: "s.note",
        type: "annotation",
        label: "样本说明",
        text: "样本量 N=2000，2026 Q1。",
      } as unknown as DomNode],
    }),
  },
  {
    name: "progress-bar on light brand theme",
    themeOverride: LIGHT_BRAND_OVERRIDE,
    build: () => ({
      id: "s",
      title: "进度",
      children: [{
        id: "s.pb",
        type: "progress-bar",
        label: "目标完成度",
        value: 75,
        max: 100,
        valueLabel: "75%",
        tone: "brand",
      } as unknown as DomNode],
    }),
  },
  {
    name: "cta button (brand) + cta button (positive) row",
    build: () => ({
      id: "s",
      title: "下一步",
      children: [{
        id: "s.row",
        type: "stack",
        direction: "horizontal",
        gap: 0.4,
        children: [
          { id: "s.row.cta1", type: "cta", text: "立即开始", tone: "brand" } as unknown as DomNode,
          { id: "s.row.cta2", type: "cta", text: "了解更多", tone: "neutral" } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }),
  },

  // ---- Containers ----
  {
    name: "two-column with insight-card + image-card",
    build: () => ({
      id: "s",
      title: "证据 + 解读",
      children: [{
        id: "s.tc",
        type: "two-column",
        ratio: [0.55, 0.45],
        gap: 0.4,
        left: {
          id: "s.tc.left",
          type: "insight-card",
          headline: "黄河中下游孕育农业文明",
          body: "新石器晚期的仰韶、龙山文化沿黄河中下游分布。",
          bullets: ["仰韶遗址 7000+ 处", "龙山遗址 1500+ 处"],
        },
        right: {
          id: "s.tc.right",
          type: "image-card",
          src: TINY_PNG,
          caption: "黄河文明分布",
        },
      } as unknown as DomNode],
    }),
  },
];

describe("component usability suite", () => {
  // Sanity: every test case targets a known component name (catches typos).
  it("every fixture targets a known component name", () => {
    for (const c of cases) {
      const slide = c.build();
      const types = new Set<string>();
      const visit = (n: unknown): void => {
        if (!n || typeof n !== "object") return;
        const rec = n as Record<string, unknown>;
        if (typeof rec.type === "string") types.add(rec.type);
        const children = rec.children;
        if (Array.isArray(children)) children.forEach(visit);
        if (rec.left) visit(rec.left);
        if (rec.right) visit(rec.right);
      };
      slide.children.forEach(visit);
      // The slide must use at least one known semantic component.
      const semantics = Array.from(types).filter((t) => KNOWN_COMPONENT_NAMES.has(t));
      expect(semantics.length, `${c.name} did not use a known semantic component (saw types ${[...types].join(",")})`).toBeGreaterThan(0);
    }
  });

  for (const c of cases) {
    it(`renders cleanly: ${c.name}`, () => {
      const result = runCase(c);
      expect(result.schema, `Schema errors:\n${result.schema.join("\n")}`).toHaveLength(0);
      expect(result.blocking, `Blocking diagnostics:\n${result.blocking.join("\n")}`).toHaveLength(0);
    });
  }
});
