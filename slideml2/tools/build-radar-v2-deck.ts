import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
  inspectLayout,
  renderToPptx,
  sourceToRenderedDeck,
  validateDeck,
  type DomNode,
  type Slideml2SourceDeck,
} from "../src/index.js";

const slideml2Root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(slideml2Root, "outputs");
const deckPath = resolve(outputRoot, "radar-v2-e2e.pptx.deck.json");
const pptxPath = resolve(outputRoot, "radar-v2-e2e.pptx");
const diagnosticsPath = resolve(outputRoot, "radar-v2-e2e.diagnostics.json");
const inspectPath = resolve(outputRoot, "radar-v2-e2e.inspect-layout.json");

const deck: Slideml2SourceDeck = {
  slideml2: 2,
  deck: {
    size: "16x9",
    theme: "default",
    brand: { name: "智能竞争雷达", primary: "0F766E" },
    chrome: { brandMark: "bottom-right", pageNumber: true, footerText: "智能竞争雷达 · System Design v2" },
    metadata: {
      title: "智能竞争雷达 — 系统设计文档 v2",
      source: "/Users/river/Documents/Workspace/radar v2.md",
      generatedBy: "SlideML2 local deterministic E2E",
    },
    themeOverride: {
      colors: {
        "brand.primary": "0F766E",
        "brand.secondary": "2563EB",
        background: "F8FAFC",
        surface: "FFFFFF",
        "surface.subtle": "ECFDF5",
        "text.primary": "0F172A",
        "text.secondary": "334155",
        "text.muted": "64748B",
        divider: "CBD5E1",
        "green.tint": "DCFCE7",
        green: "16A34A",
        "orange.tint": "FFEDD5",
        orange: "EA580C",
        "red.tint": "FEE2E2",
        red: "DC2626",
      },
      fonts: {
        latin: ["Aptos", "Arial"],
        cjk: ["PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC"],
        mono: ["SF Mono", "Menlo", "Consolas"],
      },
      text: {
        "deck-title": { fontSize: 42, weight: "bold", color: "text.primary", lineHeight: 1.08 },
        "slide-title": { fontSize: 25, weight: "bold", color: "text.primary", lineHeight: 1.12 },
        lead: { fontSize: 17, color: "text.secondary", lineHeight: 1.25 },
        paragraph: { fontSize: 12.5, color: "text.secondary", lineHeight: 1.22 },
        "card-title": { fontSize: 14, weight: "bold", color: "text.primary", lineHeight: 1.15 },
        "source-note": { fontSize: 8.5, color: "text.muted", lineHeight: 1.15 },
      },
      component: {
        card: { fill: "surface", line: "divider", padding: 0.45, cornerRadius: 0.18 },
        panel: { fill: "surface", line: "divider", padding: 0.45, cornerRadius: 0.18 },
      },
      chart: { series: ["brand.primary", "brand.secondary", "orange", "green", "red"] },
      guidance: {
        scenario: "系统设计文档转产品/架构决策简报",
        stylePrinciples: ["结论先行", "高密度但不拥挤", "用组件表达系统结构而不是装饰"],
        layoutPrinciples: ["每页保留一个主论点", "架构页使用流程或矩阵", "商业页使用指标和对比"],
        dataVizGuidance: ["用表格承载策略矩阵", "用柱状图表达阶段目标", "避免无依据的精确趋势"],
      },
    },
  },
  slides: [
    slide("s01", undefined, [
      stack("s01.cover", [
        text("s01.kicker", "系统设计简报 · v2 / 2026-04-13", "lead", { color: "text.secondary", fixedHeight: 0.7 }),
        text("s01.title", "智能竞争雷达", "deck-title", { fixedHeight: 1.25 }),
        text("s01.subtitle", "从 7x24 竞品监控到可执行的竞争战略参谋", "lead", { fixedHeight: 0.8 }),
        {
          id: "s01.strip",
          type: "stat-strip",
          fixedHeight: 2.0,
          items: [
            { value: "OODA", label: "Observe · Orient · Decide · Act" },
            { value: "L1-L5", label: "信号理解到行动生成" },
            { value: "ROCI", label: "相关性 · 成果 · 信心 · 影响" },
          ],
        },
        {
          id: "s01.takeaway",
          type: "key-takeaway",
          headline: "核心判断：产品价值不在 Dashboard，而在“及时发现变化、解释意图、给出行动方案”。",
          fixedHeight: 1.05,
          tone: "brand",
        },
      ], { area: "content", gap: 0.42 }),
    ], "background"),

    slide("s02", "1. 产品定位：竞争战略参谋", [
      {
        id: "s02.cols",
        type: "split",
        area: "content",
        ratio: [0.47, 0.53],
        children: [
          stack("s02.left", [
            { id: "s02.position", type: "insight-card", badge: "定位", headline: "不是信息中心，而是决策参谋", detail: "系统要回答“这意味着什么、我们该怎么做”，而不仅展示变化。", tone: "brand" },
            { id: "s02.advantage", type: "insight-card", badge: "差异", headline: "从监控到行动", bullets: ["7x24 采集", "多源交叉验证", "Fact-Impact-Act 输出"], tone: "positive" },
          ]),
          {
            id: "s02.table",
            type: "table-card",
            title: "商业目标与定价假设",
            headers: ["阶段", "目标客户", "定价", "成功指标"],
            rows: [
              ["Phase 1", "中国消费品牌 / 新消费 / 电商", "¥999-4999/月", "10-20 付费客户"],
              ["Phase 2", "中国 SaaS / 软件服务", "¥1999-9999/月", "50-100 付费客户"],
              ["Phase 3", "全球 SaaS", "$99-999/月", "进入英文市场"],
            ],
            caption: "来源：产品战略章节",
          },
        ],
      },
    ]),

    slide("s03", "2. 系统闭环：OODA 驱动的竞争情报流", [
      stack("s03.content", [
        {
          id: "s03.flow",
          type: "process-flow",
          direction: "horizontal",
          fixedHeight: 4.2,
          steps: [
            { title: "Observe", body: "官网、电商、社交、评价、广告、招聘、人工情报" },
            { title: "Orient", body: "Fact 标准化、Admiralty 评级、模式识别、ACH" },
            { title: "Decide", body: "按角色生成选项、利弊、推荐动作和话术" },
            { title: "Act", body: "Push、Slack/飞书、语音简报、动态战报" },
          ],
        },
        {
          id: "s03.kpi",
          type: "stat-strip",
          fixedHeight: 1.55,
          items: [
            { value: "<5min", label: "critical 信号告警目标" },
            { value: "A1-A6", label: "来源可靠性 × 信息可信度" },
            { value: "3+", label: "多信号触发战略推断" },
          ],
        },
      ], { area: "content", gap: 0.45 }),
    ]),

    slide("s04", "3. 数据来源：API-first, Browser-always", [
      {
        id: "s04.grid",
        type: "grid",
        area: "content",
        columns: 2,
        gap: 0.5,
        children: [
          {
            id: "s04.sources",
            type: "table-card",
            title: "7 大来源类别",
            headers: ["类别", "首选", "保底"],
            rows: [
              ["自有渠道", "Browser", "官网公开页"],
              ["分销渠道", "API", "Browser / Manual"],
              ["社交内容", "API", "Browser / Manual"],
              ["评价口碑", "API + Browser", "Manual"],
              ["广告营销", "API", "Browser"],
              ["公开数据", "API + RSS", "Manual"],
              ["人工情报", "Manual", "Manual"],
            ],
          },
          {
            id: "s04.coverage",
            type: "chart-card",
            title: "浏览器采集覆盖能力",
            chartType: "bar",
            labels: ["可靠公开页", "有限覆盖", "基本不可得"],
            series: [{ name: "数据需求占比", values: [60, 25, 15] }],
            showValues: true,
            caption: "文档估计：浏览器足以支撑基本监控，深度分析仍需 API",
          },
        ],
      },
    ]),

    slide("s05", "4. 通用数据模型：Fact 是所有分析的底座", [
      {
        id: "s05.cols",
        type: "split",
        area: "content",
        ratio: [0.42, 0.58],
        children: [
          stack("s05.left", [
            { id: "s05.fact", type: "metric-card", value: "Fact", label: "competitor × dimension × value × evidence", tone: "brand" },
            { id: "s05.signal", type: "metric-card", value: "Signal", label: "change + importance + confidence", tone: "neutral" },
            { id: "s05.action", type: "metric-card", value: "Act", label: "角色化行动建议和话术", tone: "positive" },
          ], { gap: 0.32 }),
          {
            id: "s05.table",
            type: "table-card",
            title: "Fact 核心字段",
            headers: ["字段组", "关键字段", "用途"],
            rows: [
              ["归属", "competitor_id, customer_id", "隔离客户与竞品空间"],
              ["来源", "source_type, collector, raw_evidence", "追溯证据与采集器"],
              ["内容", "dimension, fact_type, value", "统一多源数据"],
              ["质量", "source_reliability, info_credibility", "控制推断置信度"],
              ["时间", "observed_at, collected_at", "做变化检测和新鲜度判断"],
            ],
          },
        ],
      },
    ]),

    slide("s06", "5. 分析引擎：五层从变化走到行动", [
      {
        id: "s06.grid",
        type: "grid",
        area: "content",
        columns: 3,
        gap: 0.45,
        children: [
          { id: "s06.l1", type: "insight-card", badge: "L1", headline: "信号理解", detail: "识别变化类型、重要性、估算属性和基础置信度。", tone: "brand" },
          { id: "s06.l2", type: "insight-card", badge: "L2", headline: "多源关联", detail: "同竞品跨维度、跨竞品同维度、多来源交叉验证。", tone: "positive" },
          { id: "s06.l3", type: "insight-card", badge: "L3", headline: "战略推断", detail: "渐进式 ACH：假设、证据矩阵、排除、确认信号。", tone: "warning" },
          { id: "s06.l4", type: "insight-card", badge: "L4", headline: "影响评估", detail: "收入、产品、定位、紧急度四维打分。", tone: "neutral" },
          { id: "s06.l5", type: "insight-card", badge: "L5", headline: "行动生成", detail: "Fact-Impact-Act，按 Sales / Product / Leadership 分发。", tone: "brand" },
          { id: "s06.guard", type: "insight-card", badge: "Guardrail", headline: "防过度推断", detail: "单信号不做战略结论，估算数据不能作为唯一排除依据。", tone: "danger" },
        ],
      },
    ]),

    slide("s07", "6. 模式库：把碎片信号压缩成战略故事", [
      {
        id: "s07.grid",
        type: "grid",
        area: "content",
        columns: 3,
        gap: 0.45,
        children: [
          { id: "s07.c1", type: "insight-card", badge: "Market Push", headline: "市场攻势", bullets: ["降价 ≥15%", "投放增加 ≥50%", "销售招聘增加"], tone: "brand" },
          { id: "s07.c2", type: "insight-card", badge: "Enterprise", headline: "上攻高端", bullets: ["高端套餐", "SSO/SAML", "Contact Sales"], tone: "positive" },
          { id: "s07.c3", type: "insight-card", badge: "Distress", headline: "困境信号", bullets: ["招聘减少", "差评增加", "高管离职"], tone: "warning" },
          { id: "s07.c4", type: "insight-card", badge: "Channel", headline: "渠道扩张", bullets: ["新增平台", "新增账号", "新增地域"], tone: "neutral" },
          { id: "s07.c5", type: "insight-card", badge: "Brand", headline: "品牌升级", bullets: ["消息变化", "视觉变化", "套餐重命名"], tone: "neutral" },
          { id: "s07.c6", type: "insight-card", badge: "Price War", headline: "价格战", bullets: ["连续降价", "多竞品同期降价", "大促频率增加"], tone: "danger" },
        ],
      },
    ]),

    slide("s08", "7. 交付体系：五级时间跨度", [
      {
        id: "s08.table",
        type: "table-card",
        area: "content",
        title: "从即时告警到年度战略报告",
        headers: ["时间跨度", "触发", "受众", "渠道", "分析深度"],
        rows: [
          ["即时", "Signal critical <5min", "Sales / 定价负责人", "Push + Slack", "L1-L2 / SALUTE"],
          ["每日", "09:00", "PM / CI 负责人", "Slack + Dashboard", "L1-L2 聚合"],
          ["每周", "周一 09:00", "CEO / 管理层", "Email + 语音", "L1-L5 / PDB"],
          ["每月", "第 1 工作日", "战略团队 / Board", "PDF", "Decision Briefing"],
          ["年度", "每年 1 月", "Board / 投资者", "PDF", "行业建模"],
        ],
      },
    ]),

    slide("s09", "8. Massistant：移动语音入口 + 获客漏斗", [
      {
        id: "s09.cols",
        type: "split",
        area: "content",
        ratio: [0.5, 0.5],
        children: [
          {
            id: "s09.tools",
            type: "table-card",
            title: "新增 5 个 CI 工具",
            headers: ["工具", "用途"],
            rows: [
              ["ci_query", "事实查询 + 态势分析"],
              ["ci_advisor", "策略评估 / What-if / 决策建议"],
              ["ci_battlecard", "动态战报和话术"],
              ["ci_report", "周报 / 月报"],
              ["ci_submit_intel", "提交人工情报"],
            ],
          },
          stack("s09.right", [
            { id: "s09.voice", type: "insight-card", badge: "语音模式", headline: "结论先行，2 分钟内说清楚", detail: "语音输出不读表格和编码，把证据转为“多个可靠来源确认”等自然表达。", tone: "brand" },
            { id: "s09.funnel", type: "insight-card", badge: "转化", headline: "第 3 次竞品问题触发付费提示", detail: "免费层提供单次分析；付费层提供 24/7 监控、战报和周报。", tone: "positive" },
          ]),
        ],
      },
    ]),

    slide("s10", "9. 质量保障：门禁、健康度、ROCI", [
      {
        id: "s10.grid",
        type: "grid",
        area: "content",
        columns: 3,
        gap: 0.45,
        children: [
          { id: "s10.q1", type: "insight-card", badge: "分析质量", headline: "Fact + Impact + Act 门禁", bullets: ["缺 Impact 不推送", "低置信仅参考", "单信号不做战略推断"], tone: "brand" },
          { id: "s10.q2", type: "insight-card", badge: "数据质量", headline: "采集健康度监控", bullets: ["成功率 >95%", "覆盖率 <50% 提示补源", "新鲜度超时标记 stale"], tone: "positive" },
          { id: "s10.q3", type: "insight-card", badge: "效果度量", headline: "ROCI 框架", bullets: ["告警点击率 >60%", "每周 ≥3 个有用标记", "预测准确率 >65%"], tone: "warning" },
        ],
      },
    ]),

    slide("s11", "10. 成本与商业可行性", [
      {
        id: "s11.cols",
        type: "split",
        area: "content",
        ratio: [0.48, 0.52],
        children: [
          {
            id: "s11.cost",
            type: "chart-card",
            title: "每客户月成本区间",
            chartType: "bar",
            labels: ["浏览器模式低", "浏览器模式高", "含 API 低", "含 API 高"],
            series: [{ name: "¥/月/客户", values: [25, 60, 60, 120] }],
            showValues: true,
            caption: "不含非常重度 Advisor 使用场景",
          },
          stack("s11.right", [
            { id: "s11.margin1", type: "metric-card", value: ">90%", label: "仅浏览器模式毛利率", tone: "positive" },
            { id: "s11.margin2", type: "metric-card", value: ">85%", label: "含第三方 API 模式毛利率", tone: "positive" },
            { id: "s11.price", type: "metric-card", value: "¥999-4999", label: "Phase 1 月定价区间", tone: "brand" },
          ], { gap: 0.32 }),
        ],
      },
    ]),

    slide("s12", "11. 路线图：40 周从基础搭建到企业功能", [
      stack("s12.content", [
        {
          id: "s12.grid",
          type: "grid",
          columns: 2,
          gap: 0.45,
          layoutWeight: 1,
          children: [
            { id: "s12.p0", type: "insight-card", badge: "W1-8", headline: "Phase 0 基础搭建", detail: "服务端脚手架、Fact/Signal、3 个浏览器采集器。", tone: "brand" },
            { id: "s12.p1", type: "insight-card", badge: "W9-16", headline: "Phase 1 MVP", detail: "Advisor v0、Massistant CI 工具、通知和种子用户内测。", tone: "positive" },
            { id: "s12.p2", type: "insight-card", badge: "W17-28", headline: "Phase 2 核心功能", detail: "深度分析、Web、首批 API、周报和月报体系。", tone: "warning" },
            { id: "s12.p3", type: "insight-card", badge: "W29-40", headline: "Phase 3 差异化", detail: "全球化、企业权限、预测校准、规模化交付。", tone: "neutral" },
          ],
        },
      ], { area: "content", gap: 0.4 }),
    ]),
  ],
};

function slide(id: string, title: string | undefined, children: DomNode[], background = "background") {
  return { id, title, background, children };
}

function stack(id: string, children: DomNode[], extra: Record<string, unknown> = {}): DomNode {
  return { id, type: "stack", direction: "vertical", gap: 0.35, children, ...extra };
}

function text(id: string, value: string, style: string, extra: Record<string, unknown> = {}): DomNode {
  return { id, type: "text", text: value, style, ...extra };
}

async function main() {
  await mkdir(outputRoot, { recursive: true });
  await writeFile(deckPath, JSON.stringify(deck, null, 2), "utf8");
  const validation = validateDeck(deck);
  if (!validation.ok) {
    await writeFile(resolve(outputRoot, "radar-v2-e2e.validation.json"), JSON.stringify(validation, null, 2), "utf8");
    throw new Error(`Deck validation failed with ${validation.errors.length} error(s), ${validation.warnings.length} warning(s)`);
  }

  clearRenderDiagnostics();
  const renderedDeck = sourceToRenderedDeck(deck);
  const inspect = inspectLayout(renderedDeck);
  await writeFile(inspectPath, JSON.stringify(inspect, null, 2), "utf8");
  clearRenderDiagnostics();
  const result = await renderToPptx(renderedDeck, pptxPath);
  const diagnostics = getRenderDiagnostics();
  await writeFile(diagnosticsPath, JSON.stringify(diagnostics, null, 2), "utf8");

  console.log(JSON.stringify({
    deckPath,
    pptxPath: result.outputPath,
    renderTreePath: result.domPath,
    diagnosticsPath,
    inspectPath,
    slides: deck.slides.length,
    diagnostics: diagnostics.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
