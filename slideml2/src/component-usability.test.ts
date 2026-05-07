import { describe, expect, it } from "vitest";
import { COMPONENT_DEFINITIONS } from "./component-registry.js";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
  type LayoutDiagnostic,
} from "./diagnostics.js";
import { measureDeck, renderToAst } from "./render.js";
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
    name: "expressive kpi-grid with deltas status and sparklines",
    build: () => ({
      id: "s",
      title: "指标故事",
      children: [{
        id: "s.kpi.story",
        type: "kpi-grid",
        columns: 3,
        variant: "card",
        metrics: [
          { value: "42%", label: "样式串扰", delta: "-18pp", status: "positive", comparison: "vs baseline", sparkline: [70, 64, 58, 42] },
          { value: "3.2s", label: "读取延迟", delta: "+0.4s", status: "warning", source: "render log", sparkline: [2.1, 2.3, 2.8, 3.2] },
          { value: "0", label: "阻断诊断", status: "positive", comparison: "target met", sparkline: [4, 2, 1, 0] },
        ],
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
    name: "comparison-card rich winner with metrics and pros-cons",
    build: () => ({
      id: "s",
      title: "方案选择",
      children: [{
        id: "s.compare",
        type: "grid",
        columns: 2,
        gap: 0.45,
        children: [
          {
            id: "s.compare.a",
            type: "comparison-card",
            variant: "card",
            winner: true,
            badge: "Recommended",
            title: "显式任务隔离",
            subtitle: "每个新任务重置风格锚点",
            score: "92/100",
            content: [{ text: "最稳定地降低跨任务影响，", marks: ["bold"] }, { text: "同时保留用户意图。" }],
            points: ["开销低", "行为可解释"],
            metrics: [{ label: "carryover", value: "-68%", tone: "positive" }],
            pros: ["清晰边界", "易测试"],
            cons: ["需要识别新任务"],
            footer: "适合作为默认策略",
          },
          {
            id: "s.compare.b",
            type: "comparison-card",
            variant: "card",
            badge: "Fallback",
            title: "完全清空上下文",
            points: ["隔离彻底", "会丢失连续修改语境"],
            score: "74/100",
          },
        ],
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
    name: "feature-card rich card with badge tags proof metric",
    build: () => ({
      id: "s",
      title: "能力模块",
      children: [{
        id: "s.features",
        type: "grid",
        columns: 3,
        gap: 0.35,
        children: [
          {
            id: "s.features.1",
            type: "feature-card",
            variant: "card",
            icon: "ellipse",
            badge: "Core",
            title: "任务隔离",
            content: [{ text: "重置上一轮 deck 的视觉锚点", marks: ["bold"] }, { text: "，避免风格继承。" }],
            tags: ["memory", "style"],
            metric: { value: "-68%", label: "carryover", tone: "positive" },
            proof: "来自同内容双 deck 对比",
          },
          { id: "s.features.2", type: "feature-card", variant: "card", icon: "roundRect", title: "组件表达", body: "让 agent 少手写 primitive。", tags: ["schema"] },
          { id: "s.features.3", type: "feature-card", variant: "card", icon: "triangle", title: "渲染兜底", body: "保留主体，丢弃低优先级装饰。", ctaText: "Inspect" },
        ],
      } as unknown as DomNode],
    }),
  },
  {
    name: "feature-card 2x2 compact grid keeps title readable",
    build: () => ({
      id: "s",
      title: "产品亮点",
      children: [{
        id: "s.features.tight",
        type: "grid",
        columns: 2,
        gap: 0.3,
        area: "content",
        children: [
          { id: "s.features.tight.1", type: "feature-card", icon: "ellipse", title: "高精准同传翻译", body: "低延时，实时翻译多语言" },
          { id: "s.features.tight.2", type: "feature-card", icon: "roundRect", title: "AI 课堂笔记", body: "一键生成课堂笔记与期末总结" },
          { id: "s.features.tight.3", type: "feature-card", icon: "triangle", title: "对话翻译", body: "留学生生活随时可用" },
          { id: "s.features.tight.4", type: "feature-card", icon: "star-5", title: "便捷入口", body: "增加便捷入口，渗透词典用户" },
        ] as unknown as DomNode[],
      } as unknown as DomNode],
    }),
  },
  {
    name: "process-flow cards with status owner time and bullets",
    build: () => ({
      id: "s",
      title: "发布流程",
      children: [{
        id: "s.flow.rich",
        type: "process-flow",
        variant: "cards",
        direction: "horizontal",
        steps: [
          { title: "Detect", body: "识别是否为新任务", status: "positive", owner: "Agent", icon: "ellipse", bullets: ["主题变更", "产物路径变更"] },
          { title: "Reset", body: "清理上轮风格锚点", status: "warning", time: "T+1", icon: "roundRect" },
          { title: "Render", body: "用本轮 theme 和组件重建", status: "brand", owner: "SlideML2", icon: "arrow-right" },
        ],
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
    name: "quote in a tight grid cell degrades instead of failing",
    build: () => ({
      id: "s",
      title: "紧凑引用",
      children: [{
        id: "s.grid",
        type: "grid",
        columns: 2,
        gap: 0.35,
        area: "content",
        children: [
          { id: "s.grid.quote", type: "quote", text: "市面上最好用的同传翻译，最强 AI 课堂助手", source: "产品定位" } as unknown as DomNode,
          { id: "s.grid.note", type: "callout", text: "右侧内容必须保留，引用组件不能挤爆整页。", tone: "brand" } as unknown as DomNode,
        ],
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
    name: "rich callout with colored title and bold body runs",
    build: () => ({
      id: "s",
      title: "关键提醒",
      children: [{
        id: "s.callout",
        type: "callout",
        variant: "card",
        tone: "warning",
        title: "模型记忆会污染下一次任务",
        content: [
          { text: "必须在新任务开始时重置风格锚点，", marks: ["bold"] },
          { text: "否则后续 PPT 会沿用上一个 deck 的视觉语言。" },
        ],
        bullets: ["隔离任务上下文", "显式记录本次 deck 的主题", "避免复用上一轮设计 token"],
      } as unknown as DomNode],
    }),
  },
  {
    name: "media cards with badges insights annotations and frameless variant",
    build: () => ({
      id: "s",
      title: "证据页",
      children: [{
        id: "s.media.grid",
        type: "grid",
        columns: 2,
        gap: 0.45,
        children: [
          {
            id: "s.media.image",
            type: "image-card",
            variant: "compact",
            src: TINY_PNG,
            title: "最终 PPT 截图",
            badge: "Evidence",
            fit: "contain",
            insight: "亮色文字风险集中在自动继承的深浅配色。",
            annotations: ["标题可读", "正文低对比"],
            caption: "render validation sample",
          },
          {
            id: "s.media.chart",
            type: "chart-card",
            variant: "compact",
            chartType: "bar",
            title: "诊断数量",
            badge: "Render",
            labels: ["Before", "After"],
            series: [{ name: "Blocking", values: [7, 0] }],
            insight: "阻断项归零后仍需看视觉质量。",
            caption: "synthetic test",
          },
        ],
      } as unknown as DomNode],
    }),
  },
  {
    name: "key-takeaway rich banner with bullets",
    build: () => ({
      id: "s",
      title: "结论",
      children: [{
        id: "s.takeaway",
        type: "key-takeaway",
        variant: "banner",
        tone: "brand",
        headline: "组件必须表达 agent 的真实意图",
        content: [{ text: "能力增强应优先落在常用组件，", marks: ["bold"] }, { text: "而不是让 agent 退回手写 primitive。" }],
        bullets: ["KPI 自带上下文", "对比卡支持 winner 和证据", "媒体卡直接承载 readout"],
      } as unknown as DomNode],
    }),
  },
  {
    name: "component instance typography overrides theme defaults locally",
    build: () => ({
      id: "s",
      title: "局部样式覆盖",
      children: [{
        id: "s.stack.override",
        type: "stack",
        direction: "vertical",
        gap: 0.35,
        children: [
          {
            id: "s.override.takeaway",
            type: "key-takeaway",
            headline: "这一条使用实例级字体覆盖",
            detail: "theme 仍然是默认字体节奏，只有这个组件实例被放大。",
            fontSize: 18,
            fontFamily: "display",
            fontWeight: "bold",
            lineHeight: 1.15,
            color: "text.primary",
            surface: { fill: "surface.subtle", borderColor: "divider", cornerRadius: 0.08 },
          } as unknown as DomNode,
          {
            id: "s.override.callout",
            type: "callout",
            variant: "card",
            tone: "brand",
            title: "run 级别仍然可以覆盖实例",
            fontSize: 12,
            content: [
              { text: "普通片段继承实例字号；" },
              { text: "重点片段使用 run 自己的字号和颜色。", size: "lg", color: "brand.primary", marks: ["bold"] },
            ],
          } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }),
  },
  {
    name: "callout legacy plain and rich banner variants",
    themeOverride: DARK_OVERRIDE,
    build: () => ({
      id: "s",
      title: "Callout 变体",
      children: [{
        id: "s.stack",
        type: "stack",
        direction: "vertical",
        gap: 0.4,
        area: "content",
        children: [
          { id: "s.stack.legacy", type: "callout", text: "旧写法仍然保持单句强调能力。", tone: "brand" } as unknown as DomNode,
          {
            id: "s.stack.banner",
            type: "callout",
            variant: "banner",
            tone: "danger",
            title: "亮色文字风险",
            body: "深色主题下必须由组件控制标题、正文和 surface 对比度。",
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
  {
    name: "freeform-group anchors decorative and annotation overlays",
    build: () => ({
      id: "s",
      title: "自由构图",
      children: [{
        id: "s.free",
        type: "freeform-group",
        children: [
          { id: "s.free.bg", type: "decorative-shapes", motif: "corner-blobs", position: "top-right", tone: "muted", count: 6 },
          { id: "s.free.arrow", type: "pointer-arrow", label: "重点", anchor: "middle-right", direction: "left", offsetX: 1.0, tone: "warning" },
        ],
      } as unknown as DomNode, {
        id: "s.body",
        type: "insight-card",
        headline: "主体内容仍走流式布局",
        detail: "装饰和箭头由 freeform-group 作为受约束 overlay 展开。",
      } as unknown as DomNode],
    }),
  },
  {
    name: "freeform-group background mode keeps authored content in flow",
    build: () => ({
      id: "s",
      title: "背景装饰",
      children: [
        {
          id: "s.bg",
          type: "freeform-group",
          mode: "background",
          children: [
            { id: "s.bg.grid", type: "decoration-grid", pattern: "grid", density: "sparse", tone: "muted" },
            { id: "s.bg.mark", type: "watermark", text: "DRAFT", tone: "muted", rotation: -18 },
          ],
        } as unknown as DomNode,
        { id: "s.content", type: "key-takeaway", headline: "背景装饰不参与主内容排版", detail: "正文仍由 content stack 约束，overlay 只提供视觉气氛。" } as unknown as DomNode,
      ],
    }),
  },
  {
    name: "slide-level decoration-grid renders as background overlay",
    build: () => ({
      id: "s",
      children: [
        { id: "s.decor", type: "decoration-grid", pattern: "dots", density: "sparse", tone: "muted" } as unknown as DomNode,
        { id: "s.title", type: "deck-title", text: "背景装饰", align: "left" } as unknown as DomNode,
        { id: "s.lead", type: "lead", text: "decoration-grid 不应进入 content stack，也不应抢占主内容高度。" } as unknown as DomNode,
      ],
    }),
  },
  {
    name: "cover-composition with hero stat and background visual",
    build: () => ({
      id: "s",
      children: [{
        id: "s.cover",
        type: "cover-composition",
        eyebrow: "DIAGNOSIS",
        title: "LLM Agent Memory Diagnosis",
        subtitle: "Task isolation, evidence, and mitigation strategy",
        visual: { src: TINY_PNG, fit: "cover" },
        heroStat: { value: "22", label: "slides compared", caption: "pptxgenjs vs SlideML2" },
        tone: "inverse",
        decor: "shapes",
      } as unknown as DomNode],
    }),
  },
  {
    name: "chapter-divider full-slide brand field",
    build: () => ({
      id: "s",
      children: [{
        id: "s.chapter",
        type: "chapter-divider",
        chapter: "03",
        eyebrow: "RESULTS",
        title: "实验结果",
        subtitle: "从诊断到改进路径",
        sections: ["背景", "方法", "结果", "建议"],
        current: 2,
        tone: "brand",
      } as unknown as DomNode],
    }),
  },
  {
    name: "chapter-divider neutral tone without progress",
    build: () => ({
      id: "s",
      children: [{
        id: "s.chapter",
        type: "chapter-divider",
        chapter: "01",
        title: "研究背景",
        subtitle: "为什么任务隔离会影响最终质量",
        tone: "neutral",
      } as unknown as DomNode],
    }),
  },
  {
    name: "evidence-layout sidecar with image evidence and insight",
    build: () => ({
      id: "s",
      title: "证据与解读",
      children: [{
        id: "s.ev",
        type: "evidence-layout",
        evidence: { id: "s.ev.img", type: "image-card", src: TINY_PNG, title: "输出截图", caption: "同一内容的两种生成方式" },
        insight: { id: "s.ev.insight", type: "insight-card", headline: "原生 PPTX 更灵活", detail: "SlideML2 需要增加受约束的自由定位和证据解读版式。" },
        annotations: [{ id: "s.ev.arrow", type: "pointer-arrow", label: "布局差异", anchor: "middle-center", offsetX: 1.5, direction: "right", tone: "brand" }],
      } as unknown as DomNode],
    }),
  },
  {
    name: "evidence-layout stacked chart evidence with generated insight",
    themeOverride: DARK_OVERRIDE,
    build: () => ({
      id: "s",
      title: "堆叠证据页",
      children: [{
        id: "s.ev",
        type: "evidence-layout",
        layout: "stacked",
        ratio: [0.62, 0.38],
        evidence: {
          id: "s.ev.chart",
          type: "chart-card",
          chartType: "bar",
          labels: ["A", "B", "C"],
          series: [{ name: "错误率", values: [42, 18, 8] }],
          title: "错误率下降",
          showValues: true,
        },
        headline: "任务隔离降低跨任务污染",
        detail: "使用 generated insight fallback 时也应形成完整 evidence + interpretation 版式。",
      } as unknown as DomNode],
    }),
  },
  {
    name: "analysis components for matrix taxonomy and main effect",
    build: () => ({
      id: "s",
      title: "分析页组件",
      children: [{
        id: "s.grid",
        type: "grid",
        columns: 2,
        gap: 0.4,
        area: "content",
        children: [
          { id: "s.grid.matrix", type: "factorial-matrix", title: "2×2 条件", rows: ["记忆开", "记忆关"], columns: ["旧任务", "新任务"], cells: [[{ text: "污染", tone: "danger" }, { text: "继承", tone: "warning" }], [{ text: "干净", tone: "positive" }, { text: "稳定", tone: "positive" }]] } as unknown as DomNode,
          { id: "s.grid.fail", type: "failure-taxonomy", columns: 1, items: [{ title: "风格串扰", rate: "42%", examples: ["颜色沿用", "版式沿用"] }, { title: "主题偏移", rate: "18%", examples: ["上一任务术语残留"] }] } as unknown as DomNode,
          { id: "s.grid.effect", type: "main-effect-comparison", beforeLabel: "隔离前", beforeValue: "42%", afterLabel: "隔离后", afterValue: "8%", trend: "down", insight: "任务隔离显著降低风格串扰。" } as unknown as DomNode,
          { id: "s.grid.probe", type: "probe-flow", steps: [{ title: "输入", body: "新主题 brief" }, { title: "执行", body: "生成 deck" }, { title: "检查", body: "比对风格残留" }] } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    }),
  },
  {
    name: "analysis components dense standalone variants",
    themeOverride: LIGHT_BRAND_OVERRIDE,
    build: () => ({
      id: "s",
      title: "独立分析组件",
      children: [{
        id: "s.stack",
        type: "stack",
        direction: "vertical",
        gap: 0.35,
        area: "content",
        children: [
          {
            id: "s.stack.taxonomy",
            type: "failure-taxonomy",
            columns: 3,
            tone: "warning",
            items: [
              { title: "风格串扰", rate: "42%", body: "上一任务视觉残留", examples: ["颜色沿用", "卡片样式沿用"] },
              { title: "事实串扰", rate: "16%", body: "旧主题术语进入新任务", examples: ["专有名词残留"] },
              { title: "结构串扰", rate: "11%", body: "沿用旧 deck 章节节奏", examples: ["过度 section-break"] },
            ],
          } as unknown as DomNode,
          { id: "s.stack.effect", type: "main-effect-comparison", title: "隔离效果", beforeLabel: "基线", beforeValue: "42%", afterLabel: "隔离", afterValue: "8%", trend: "down", insight: "显式任务边界后，风格串扰显著下降。" } as unknown as DomNode,
        ],
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

  it("keeps slide-level decoration-grid as a root overlay", () => {
    const source = deckWith({
      id: "s",
      children: [
        { id: "s.decor", type: "decoration-grid", pattern: "dots", density: "sparse", tone: "muted" } as unknown as DomNode,
        { id: "s.title", type: "deck-title", text: "背景装饰" } as unknown as DomNode,
      ],
    });
    const rendered = sourceToRenderedDeck(source);
    const rootChildren = rendered.slides[0]?.dom.children || [];
    const decor = rootChildren.find((child) => child.id === "s.decor");
    const content = rootChildren.find((child) => child.id === "s.content");
    expect(decor, "decoration-grid must stay at slide root so anchor/fillSlide is honored").toBeTruthy();
    expect((content?.children || []).some((child) => child.id === "s.decor")).toBe(false);
  });

  it("rich callout keeps comfortable spacing between text and border", () => {
    const source = deckWith({
      id: "s",
      title: "关键提醒",
      children: [{
        id: "s.callout",
        type: "callout",
        variant: "card",
        tone: "warning",
        title: "模型记忆会污染下一次任务",
        body: "新任务开始时必须重置风格锚点，否则后续 PPT 会沿用上一个 deck 的视觉语言。",
      } as unknown as DomNode],
    });
    const measured = measureDeck(sourceToRenderedDeck(source))[0]!.nodes;
    const rect = (id: string) => measured.find((n) => n.id === id)!.rect;
    const root = rect("s.callout");
    const title = rect("s.callout.title");
    const body = rect("s.callout.body");
    const contentRight = Math.max(title.x + title.w, body.x + body.w);
    const contentBottom = Math.max(title.y + title.h, body.y + body.h);

    expect(title.x - root.x).toBeGreaterThanOrEqual(0.7);
    expect(body.x - root.x).toBeGreaterThanOrEqual(0.7);
    expect(title.y - root.y).toBeGreaterThanOrEqual(0.7);
    expect(root.x + root.w - contentRight).toBeGreaterThanOrEqual(0.65);
    expect(root.y + root.h - contentBottom).toBeGreaterThanOrEqual(0.65);
  });

  for (const c of cases) {
    it(`renders cleanly: ${c.name}`, () => {
      const result = runCase(c);
      expect(result.schema, `Schema errors:\n${result.schema.join("\n")}`).toHaveLength(0);
      expect(result.blocking, `Blocking diagnostics:\n${result.blocking.join("\n")}`).toHaveLength(0);
    });
  }
});
