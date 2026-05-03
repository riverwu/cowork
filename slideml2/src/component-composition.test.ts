import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
  type LayoutDiagnostic,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { validateDeck } from "./validate.js";
import type { DomNode, Slideml2SourceDeck } from "./types.js";

/**
 * Composition fixtures: combinations of components an LLM actually emits.
 * Each fixture is a faithful rebuild of one of the patterns from the wuur34
 * authoring run that previously triggered FALLBACK_FAILED, SQUASHED, or
 * LOW_CONTRAST cycles. The contract: schema-clean and zero blocking
 * diagnostics, end to end.
 */

const TINY_PNG = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MDAiIGhlaWdodD0iNDUwIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjQ1MCIgZmlsbD0iIzExMTgyNyIvPjwvc3ZnPg==";

const BLOCKING_CODES: ReadonlySet<LayoutDiagnostic["code"]> = new Set<LayoutDiagnostic["code"]>([
  "FALLBACK_FAILED",
  "COLLISION",
  "TINY_RECT",
  "SQUASHED",
  "DROP",
  "LOW_CONTRAST",
  "UNKNOWN_COLOR",
  "UNKNOWN_STYLE",
]);

interface Fixture {
  name: string;
  deck: Slideml2SourceDeck;
}

function deckOf(slides: Slideml2SourceDeck["slides"]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: "default",
      brand: { name: "Composition Test", primary: "C41E3A" },
    },
    slides,
  };
}

function describeBlocking(diags: LayoutDiagnostic[]): string {
  return diags.map((d) => `[${d.code} ${d.slideId || "?"}/${d.nodeId || "?"}] ${d.message}`).join("\n");
}

function runFixture(fixture: Fixture): { schema: string[]; blocking: string[] } {
  const schema = validateDeck(fixture.deck);
  const schemaErrors = schema.errors.map((e) => `[${e.code}${e.path ? ` ${e.path}` : ""}] ${e.message}`);
  if (schemaErrors.length > 0) return { schema: schemaErrors, blocking: [] };
  clearRenderDiagnostics();
  renderToAst(sourceToRenderedDeck(fixture.deck));
  const blocking = getRenderDiagnostics().filter((d) => BLOCKING_CODES.has(d.code) && d.severity !== "info");
  return { schema: [], blocking: blocking.map((d) => `[${d.code} ${d.slideId || "?"}/${d.nodeId || "?"}] ${d.message}`) };
}

const FIXTURES: Fixture[] = [
  {
    name: "cover with stat-strip + dark band overlay (wuur34 cover pattern)",
    deck: deckOf([{
      id: "cover",
      children: [
        {
          id: "cover.band",
          type: "band",
          fill: "2C1810",
          padding: 0.8,
          children: [{
            id: "cover.band.stack",
            type: "stack",
            direction: "vertical",
            gap: 0.4,
            valign: "middle",
            children: [
              { id: "cover.band.eyebrow", type: "text", text: "中华文明研究", style: "label", color: "text.inverse" },
              { id: "cover.band.title", type: "text", text: "黄河，长江与中华文明", style: "deck-title", color: "text.inverse" },
              { id: "cover.band.subtitle", type: "text", text: "两大母亲河塑造的千年文明", style: "lead", color: "text.inverse" },
            ],
          }],
        } as unknown as DomNode,
        {
          id: "cover.stats",
          type: "stat-strip",
          tone: "brand",
          items: [
            { value: "5464公里", label: "黄河全长" },
            { value: "6397公里", label: "长江全长" },
            { value: "5000+年", label: "文明历史" },
          ],
        } as unknown as DomNode,
      ],
    }]),
  },
  {
    name: "table-of-contents grid with three icon-text cards",
    deck: deckOf([{
      id: "toc",
      title: "目录",
      children: [{
        id: "toc.grid",
        type: "grid",
        columns: 3,
        gap: 0.5,
        area: "content",
        children: [
          { id: "toc.1", type: "feature-card", icon: "ellipse", title: "黄河", body: "文明摇篮", iconColor: "text.inverse", iconBackground: "brand.primary" } as unknown as DomNode,
          { id: "toc.2", type: "feature-card", icon: "ellipse", title: "长江", body: "经济重心", iconColor: "text.inverse", iconBackground: "success" } as unknown as DomNode,
          { id: "toc.3", type: "feature-card", icon: "ellipse", title: "双河", body: "文化交融", iconColor: "text.inverse", iconBackground: "warning" } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }]),
  },
  {
    name: "kpi-grid + comparison-card grid (4 + 3 layout)",
    deck: deckOf([{
      id: "market",
      title: "市场概览",
      children: [{
        id: "market.body",
        type: "stack",
        direction: "vertical",
        gap: 0.4,
        area: "content",
        children: [
          {
            id: "market.kpi",
            type: "kpi-grid",
            metrics: [
              { value: "500亿+", label: "市场规模" },
              { value: "30%+", label: "CAGR" },
              { value: "50%+", label: "AI芯片需求" },
              { value: "8M+", label: "出货量" },
            ],
          } as unknown as DomNode,
          {
            id: "market.compare",
            type: "grid",
            columns: 3,
            gap: 0.4,
            children: [
              { id: "market.compare.a", type: "comparison-card", title: "Meta", points: ["Ray-Ban 销量破百万", "开放生态", "多模态 AI"] } as unknown as DomNode,
              { id: "market.compare.b", type: "comparison-card", title: "Google", points: ["AI Pin 受挫", "重启 Glass", "Gemini 协同"] } as unknown as DomNode,
              { id: "market.compare.c", type: "comparison-card", title: "Apple", points: ["Vision Pro", "重叠生态", "保密研发"] } as unknown as DomNode,
            ],
          } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }]),
  },
  {
    name: "image-card + insight-card split (cover-of-content slide)",
    deck: deckOf([{
      id: "evidence",
      title: "证据与分析",
      children: [{
        id: "evidence.split",
        type: "split",
        direction: "horizontal",
        ratio: [0.55, 0.45],
        gap: 0.4,
        area: "content",
        children: [
          {
            id: "evidence.image",
            type: "image-card",
            src: TINY_PNG,
            alt: "黄河流域",
            caption: "黄河流域示意图",
          } as unknown as DomNode,
          {
            id: "evidence.insight",
            type: "insight-card",
            headline: "黄河中下游孕育了早期农业文明",
            body: "新石器晚期的仰韶、龙山文化均沿黄河中下游分布，奠定了夏商周三代的核心区域。",
            bullets: ["仰韶遗址 7000+ 处", "龙山遗址 1500+ 处", "三代均都于黄河中下游"],
          } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }]),
  },
  {
    name: "swot-matrix on a single slide",
    deck: deckOf([{
      id: "swot",
      title: "战略诊断",
      children: [{
        id: "swot.matrix",
        type: "swot-matrix",
        strengths: ["品牌识别度高", "用户规模大", "渠道广泛"],
        weaknesses: ["技术迭代慢", "成本结构高"],
        opportunities: ["新兴市场扩张", "AI 协同"],
        threats: ["新进入者", "替代技术"],
      } as unknown as DomNode],
    }]),
  },
  {
    name: "section-break + key-takeaway closing slide",
    deck: deckOf([
      {
        id: "section",
        children: [{
          id: "section.break",
          type: "section-break",
          accent: "PART 03",
          title: "核心结论",
          subtitle: "三条带走的观点",
        } as unknown as DomNode],
      },
      {
        id: "takeaway",
        title: "关键启示",
        children: [{
          id: "takeaway.tk",
          type: "key-takeaway",
          headline: "AI 穿戴从硬件比拼转向场景生态",
          bullets: ["健康场景率先放量", "AI 助理交互成为差异点", "开放生态是壁垒"],
        } as unknown as DomNode],
      },
    ]),
  },
  {
    name: "process-flow horizontal with 5 steps",
    deck: deckOf([{
      id: "flow",
      title: "投放流程",
      children: [{
        id: "flow.f",
        type: "process-flow",
        direction: "horizontal",
        steps: [
          { title: "立项", body: "确认目标" },
          { title: "调研", body: "用户画像" },
          { title: "设计", body: "原型迭代" },
          { title: "测试", body: "AB 验证" },
          { title: "投放", body: "全量上线" },
        ],
      } as unknown as DomNode],
    }]),
  },
  {
    name: "hero-stat + bar-list two-column",
    deck: deckOf([{
      id: "hero",
      title: "市场份额",
      children: [{
        id: "hero.split",
        type: "split",
        direction: "horizontal",
        ratio: [0.4, 0.6],
        gap: 0.4,
        area: "content",
        children: [
          { id: "hero.h", type: "hero-stat", value: "78%", label: "前三名集中度", caption: "+8pp YoY", tone: "brand" } as unknown as DomNode,
          {
            id: "hero.bars",
            type: "bar-list",
            tone: "brand",
            items: [
              { label: "厂商 A", value: 32 },
              { label: "厂商 B", value: 24 },
              { label: "厂商 C", value: 22 },
              { label: "其他", value: 22 },
            ],
          } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }]),
  },
  {
    name: "callout + checklist on the same slide",
    deck: deckOf([{
      id: "checklist",
      title: "上线检查",
      children: [{
        id: "checklist.body",
        type: "stack",
        direction: "vertical",
        gap: 0.4,
        area: "content",
        children: [
          { id: "checklist.callout", type: "callout", text: "上线前完成全部 5 项准入。", tone: "warning" } as unknown as DomNode,
          {
            id: "checklist.list",
            type: "checklist",
            items: [
              { text: "安全评审通过", status: "checked" },
              { text: "性能压测通过", status: "checked" },
              { text: "灰度方案就绪", status: "warning" },
              { text: "回滚演练完成", status: "unchecked" },
              { text: "运维 oncall 排班", status: "unchecked" },
            ],
          } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }]),
  },
  {
    name: "title-lockup tone:'inverse' on a content slide",
    deck: deckOf([{
      id: "lockup-cover",
      children: [{
        id: "lockup-cover.lock",
        type: "title-lockup",
        title: "新一轮智能穿戴爆发",
        eyebrow: "2026 年报告",
        subtitle: "硬件、AI、生态三足鼎立",
        tone: "inverse",
        rule: true,
      } as unknown as DomNode],
    }]),
  },
  {
    name: "definition-card grid (glossary slide)",
    deck: deckOf([{
      id: "glossary",
      title: "术语速览",
      children: [{
        id: "glossary.grid",
        type: "grid",
        columns: 3,
        gap: 0.4,
        area: "content",
        children: [
          { id: "glossary.a", type: "definition-card", term: "CAGR", definition: "复合年增长率，衡量长期增速。" } as unknown as DomNode,
          { id: "glossary.b", type: "definition-card", term: "ARPU", definition: "单用户平均收入，反映变现效率。" } as unknown as DomNode,
          { id: "glossary.c", type: "definition-card", term: "GMV", definition: "成交总额，反映商业体量。" } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }]),
  },
  {
    name: "timeline horizontal (5 milestones)",
    deck: deckOf([{
      id: "timeline",
      title: "演进里程碑",
      children: [{
        id: "timeline.t",
        type: "timeline",
        direction: "horizontal",
        items: [
          { time: "2014", title: "首代发布", body: "原型与早期反馈" },
          { time: "2017", title: "二代量产", body: "供应链就绪" },
          { time: "2020", title: "AI 引擎", body: "本地推理上线" },
          { time: "2023", title: "多模态", body: "音视频融合" },
          { time: "2026", title: "生态开放", body: "第三方接入" },
        ],
      } as unknown as DomNode],
    }]),
  },
  {
    name: "quote + source-note pairing",
    deck: deckOf([{
      id: "quote",
      title: "用户声音",
      children: [{
        id: "quote.body",
        type: "stack",
        direction: "vertical",
        gap: 0.45,
        area: "content",
        children: [
          { id: "quote.q", type: "quote", text: "智能眼镜让我第一次相信 AI 助理是真的有用。", source: "—— Beta 用户 #042" } as unknown as DomNode,
          { id: "quote.note", type: "source-note", text: "数据来源：2026 Q1 用户访谈样本 N=120。" } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }]),
  },
  {
    name: "logo-strip + caption (partner slide)",
    deck: deckOf([{
      id: "logos",
      title: "合作伙伴",
      children: [{
        id: "logos.body",
        type: "logo-strip",
        caption: "已落地的 6 家头部品牌",
        logos: [
          { src: TINY_PNG, alt: "Brand A" },
          { src: TINY_PNG, alt: "Brand B" },
          { src: TINY_PNG, alt: "Brand C" },
          { src: TINY_PNG, alt: "Brand D" },
          { src: TINY_PNG, alt: "Brand E" },
          { src: TINY_PNG, alt: "Brand F" },
        ],
      } as unknown as DomNode],
    }]),
  },
  {
    name: "pricing-card grid (3 tiers)",
    deck: deckOf([{
      id: "pricing",
      title: "定价方案",
      children: [{
        id: "pricing.grid",
        type: "grid",
        columns: 3,
        gap: 0.4,
        area: "content",
        children: [
          { id: "pricing.free", type: "pricing-card", plan: "Free", price: "¥0", period: "/月", features: ["1 个项目", "1GB 存储", "社区支持"] } as unknown as DomNode,
          { id: "pricing.pro", type: "pricing-card", plan: "Pro", price: "¥99", period: "/月", features: ["10 项目", "100GB", "优先支持", "高级分析"], tone: "brand", ctaText: "升级" } as unknown as DomNode,
          { id: "pricing.team", type: "pricing-card", plan: "Team", price: "¥299", period: "/月", features: ["无限项目", "1TB", "SLA 保障", "专属客户成功"] } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }]),
  },
  {
    name: "stat-comparison + annotation pair",
    deck: deckOf([{
      id: "compare",
      title: "升级前后",
      children: [{
        id: "compare.body",
        type: "stack",
        direction: "vertical",
        gap: 0.4,
        area: "content",
        children: [
          { id: "compare.stats", type: "stat-comparison", beforeLabel: "升级前", beforeValue: "32%", afterLabel: "升级后", afterValue: "78%", trend: "up", deltaLabel: "+46pp" } as unknown as DomNode,
          { id: "compare.note", type: "annotation", label: "样本说明", text: "样本量 N=2000，2026 Q1。" } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }]),
  },
  {
    name: "pros-cons + key-takeaway summary",
    deck: deckOf([{
      id: "trade-off",
      title: "权衡分析",
      children: [{
        id: "trade-off.body",
        type: "stack",
        direction: "vertical",
        gap: 0.4,
        area: "content",
        children: [
          {
            id: "trade-off.pc",
            type: "pros-cons",
            pros: ["上线周期短", "存量用户高", "营收快速放量"],
            cons: ["技术债增加", "维护成本上升"],
          } as unknown as DomNode,
          { id: "trade-off.tk", type: "key-takeaway", headline: "短期收益高于长期债务，建议执行。", bullets: ["设置 6 个月技术债清理 OKR", "每两周复盘"] } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }]),
  },
  {
    name: "tag-list + badge metadata row",
    deck: deckOf([{
      id: "tags",
      title: "状态总览",
      children: [{
        id: "tags.row",
        type: "stack",
        direction: "horizontal",
        gap: 0.3,
        align: "start",
        valign: "middle",
        children: [
          { id: "tags.row.b1", type: "badge", text: "RISK", tone: "danger" } as unknown as DomNode,
          { id: "tags.row.b2", type: "badge", text: "BETA", tone: "warning" } as unknown as DomNode,
          { id: "tags.row.tags", type: "tag-list", items: ["AI", "穿戴", "健康", "生态"] } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }]),
  },
  {
    name: "chart-card with 6-bucket bar chart",
    deck: deckOf([{
      id: "chart",
      title: "季度营收",
      children: [{
        id: "chart.c",
        type: "chart-card",
        chartType: "bar",
        labels: ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"],
        series: [{ name: "Revenue", values: [10, 14, 16, 22, 28, 35] }],
        title: "六个季度营收",
        caption: "数据来源：内部财报",
        showLegend: true,
        showValues: true,
        yFormat: "wanyuan",
      } as unknown as DomNode],
    }]),
  },
  {
    name: "table-card with 4 rows",
    deck: deckOf([{
      id: "table",
      title: "区域对比",
      children: [{
        id: "table.t",
        type: "table-card",
        title: "三地区表现",
        headers: ["地区", "营收", "增长", "份额"],
        rows: [
          ["华东", "1.2 亿", "+18%", "32%"],
          ["华南", "0.9 亿", "+12%", "24%"],
          ["华北", "0.8 亿", "+9%", "22%"],
          ["西南", "0.5 亿", "+24%", "12%"],
        ],
        caption: "2026 Q1 数据",
      } as unknown as DomNode],
    }]),
  },
];

describe("component composition fixtures", () => {
  for (const fixture of FIXTURES) {
    it(`renders cleanly: ${fixture.name}`, () => {
      const result = runFixture(fixture);
      expect(result.schema, `Schema errors:\n${result.schema.join("\n")}`).toHaveLength(0);
      expect(result.blocking, `Blocking diagnostics:\n${result.blocking.join("\n")}`).toHaveLength(0);
    });
  }
});
