import { describe, expect, it } from "vitest";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
  type LayoutDiagnostic,
} from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Long-text usability suite.
 *
 * Audit (2026-05-03): many composite factories baked `fixedHeight` into their
 * inner text nodes. When an agent supplied realistic prose (a Chinese sentence
 * for a callout, a long pricing tier name, a multi-line metric label), these
 * inner texts were clipped or triggered FALLBACK_FAILED with a `constrainedBy`
 * pointing at the factory's hard-coded fixedHeight — something the agent
 * could not change from outside the component.
 *
 * Each fixture below pushes a realistic upper-bound text length at the
 * component and asserts no blocking diagnostic that points at a factory-set
 * fixedHeight. The conversion to minHeight + autoFit:"shrink" inside the
 * factories is what makes these green.
 */

const BLOCKING: ReadonlySet<LayoutDiagnostic["code"]> = new Set([
  "FALLBACK_FAILED", "COLLISION", "TINY_RECT", "SQUASHED", "DROP", "LOW_CONTRAST", "UNKNOWN_COLOR", "UNKNOWN_STYLE",
]);

function deck(slide: SlideV2, themeOverride?: Slideml2SourceDeck["deck"]["themeOverride"]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: { size: "16x9", theme: "default", brand: { name: "Test", primary: "8B0000" }, themeOverride },
    slides: [slide],
  };
}

function blockingFor(slide: SlideV2, themeOverride?: Slideml2SourceDeck["deck"]["themeOverride"]): LayoutDiagnostic[] {
  clearRenderDiagnostics();
  renderToAst(sourceToRenderedDeck(deck(slide, themeOverride)));
  return getRenderDiagnostics().filter((d) => BLOCKING.has(d.code) && d.severity !== "info");
}

describe("insightCallout: long callout text doesn't get clipped at fixedHeight", () => {
  it("multi-sentence callout with autoFit lets the height grow", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "证据",
      children: [{
        id: "s.callout",
        type: "callout",
        text: "近代以来，南北文化经历了从碰撞到融合的全过程；这条件下出现的新文化形态既保留了北方的厚重，也吸收了南方的灵动。",
        tone: "warning",
      } as unknown as DomNode],
    };
    const blocking = blockingFor(slide);
    const fallback = blocking.filter((d) => d.code === "FALLBACK_FAILED");
    expect(fallback, fallback.map((d) => d.message).join("\n")).toHaveLength(0);
  });
});

describe("featureCard: long Chinese title (>10 chars) inside a 3-card grid", () => {
  it("does not FALLBACK on title.fixedHeight", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "三大特色",
      children: [{
        id: "s.grid",
        type: "grid",
        columns: 3,
        gap: 0.4,
        area: "content",
        children: Array.from({ length: 3 }, (_, i) => ({
          id: `s.f${i}`,
          type: "feature-card",
          icon: "ellipse",
          title: `这是一个相对较长的特色标题 ${i + 1}`,
          body: "短描述。",
          iconColor: "text.inverse",
          iconBackground: "brand.primary",
        } as unknown as DomNode)),
      } as unknown as DomNode],
    };
    const blocking = blockingFor(slide);
    const titleConstrained = blocking.filter((d) => d.code === "FALLBACK_FAILED" && /\.title$/.test(String(d.constrainedBy?.ancestorId || "")));
    expect(titleConstrained, titleConstrained.map((d) => d.message).join("\n")).toHaveLength(0);
  });
});

describe("pricingCard: long plan name + period label survive in 3-tier grid", () => {
  it("does not FALLBACK on plan.fixedHeight", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "定价",
      children: [{
        id: "s.grid",
        type: "grid",
        columns: 3,
        gap: 0.4,
        area: "content",
        children: [
          { id: "s.t1", type: "pricing-card", plan: "免费版（个人开发者）", price: "¥0", period: "/月（无限期）", features: ["1 项目", "1GB"] } as unknown as DomNode,
          { id: "s.t2", type: "pricing-card", plan: "专业版（团队协作）", price: "¥99", period: "/月（首年优惠）", features: ["10 项目", "100GB", "优先支持"], tone: "brand", ctaText: "升级" } as unknown as DomNode,
          { id: "s.t3", type: "pricing-card", plan: "企业版（自定义合同）", price: "¥299", period: "/月（含 SLA）", features: ["无限项目", "1TB", "SLA"] } as unknown as DomNode,
        ],
      } as unknown as DomNode],
    };
    const blocking = blockingFor(slide);
    const planFail = blocking.filter((d) => d.code === "FALLBACK_FAILED" && /\.plan$|\.period$/.test(String(d.constrainedBy?.ancestorId || "")));
    expect(planFail, planFail.map((d) => d.message).join("\n")).toHaveLength(0);
  });
});

describe("numbered-grid: long titles + bodies in a 4-column grid", () => {
  it("does not FALLBACK on factory-set fixedHeight on num/title/body", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "四步流程",
      children: [{
        id: "s.ng",
        type: "numbered-grid",
        columns: 4,
        items: Array.from({ length: 4 }, (_, i) => ({
          title: `阶段 ${i + 1}：详细名称`,
          body: `做第 ${i + 1} 步：稍微长一些的步骤说明文字，覆盖关键判断和必要的执行细节`,
        })),
      } as unknown as DomNode],
    };
    const blocking = blockingFor(slide);
    const factoryFail = blocking.filter((d) =>
      d.code === "FALLBACK_FAILED" &&
      /\.(num|title|body)$/.test(String(d.constrainedBy?.ancestorId || "")) &&
      d.constrainedBy?.prop === "fixedHeight"
    );
    expect(factoryFail, factoryFail.map((d) => d.message).join("\n")).toHaveLength(0);
  });
});

describe("heroStat: long value, long label, long caption all survive", () => {
  it("does not FALLBACK on value/label/caption fixedHeight", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "里程碑",
      children: [{
        id: "s.hero",
        type: "hero-stat",
        value: "1,234,567,890亿+",
        label: "累计市场规模（含未结算订单与预付）",
        caption: "数据来源：行业报告 2026 Q1，YoY 增速持续高于 30% 已连续四个季度",
        tone: "brand",
      } as unknown as DomNode],
    };
    const blocking = blockingFor(slide);
    const factoryFail = blocking.filter((d) =>
      d.code === "FALLBACK_FAILED" &&
      /\.(value|label|caption)$/.test(String(d.constrainedBy?.ancestorId || "")) &&
      d.constrainedBy?.prop === "fixedHeight"
    );
    expect(factoryFail, factoryFail.map((d) => d.message).join("\n")).toHaveLength(0);
  });
});

describe("statComparison: long before/after labels and delta label survive", () => {
  it("does not FALLBACK on label fixedHeight", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "升级前后对比",
      children: [{
        id: "s.cmp",
        type: "stat-comparison",
        beforeLabel: "升级前的市场规模与渗透率",
        beforeValue: "32%",
        afterLabel: "升级后的市场规模与渗透率",
        afterValue: "78%",
        trend: "up",
        deltaLabel: "+46 个百分点（YoY）",
      } as unknown as DomNode],
    };
    const blocking = blockingFor(slide);
    const factoryFail = blocking.filter((d) =>
      d.code === "FALLBACK_FAILED" &&
      /\.label$/.test(String(d.constrainedBy?.ancestorId || "")) &&
      d.constrainedBy?.prop === "fixedHeight"
    );
    expect(factoryFail, factoryFail.map((d) => d.message).join("\n")).toHaveLength(0);
  });
});

describe("logoStrip caption: long source line doesn't get clipped", () => {
  it("does not FALLBACK on caption fixedHeight", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "合作伙伴",
      children: [{
        id: "s.ls",
        type: "logo-strip",
        logos: Array.from({ length: 6 }, (_, i) => ({ src: "data:image/svg+xml;base64,PHN2Zy8+", alt: `Logo ${i + 1}` })),
        caption: "已落地的 6 家头部品牌（按合作年限排序，包含两家 Fortune 500 企业）",
      } as unknown as DomNode],
    };
    const blocking = blockingFor(slide);
    const factoryFail = blocking.filter((d) =>
      d.code === "FALLBACK_FAILED" &&
      /\.caption$/.test(String(d.constrainedBy?.ancestorId || "")) &&
      d.constrainedBy?.prop === "fixedHeight"
    );
    expect(factoryFail, factoryFail.map((d) => d.message).join("\n")).toHaveLength(0);
  });
});

describe("tag-list: long tag text doesn't trip fixedHeight", () => {
  it("does not FALLBACK on tag fixedHeight when items are slightly longer", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "维度",
      children: [{
        id: "s.tags",
        type: "tag-list",
        items: ["人工智能", "大数据分析", "云端部署", "边缘计算", "量子通讯（早期）"],
      } as unknown as DomNode],
    };
    const blocking = blockingFor(slide);
    const fixedFail = blocking.filter((d) => d.code === "FALLBACK_FAILED" && d.constrainedBy?.prop === "fixedHeight");
    expect(fixedFail, fixedFail.map((d) => d.message).join("\n")).toHaveLength(0);
  });
});

describe("composite suite under tight slot (sibling competition)", () => {
  it("kpi-grid + comparison-card grid stacked: does not FALLBACK on factory-set fixedHeight", () => {
    // Two grids stacked in one slide reproduces the rm8s07 pinch.
    const slide: SlideV2 = {
      id: "tight",
      title: "市场总览",
      children: [
        { id: "t.lead", type: "lead", text: "二维度概述" } as unknown as DomNode,
        {
          id: "t.kpi",
          type: "kpi-grid",
          metrics: [
            { value: "500亿+", label: "市场规模" },
            { value: "30%", label: "增速" },
            { value: "78%", label: "市占率" },
          ],
        } as unknown as DomNode,
        {
          id: "t.compare",
          type: "grid",
          columns: 2,
          gap: 0.4,
          children: [
            { id: "t.c1", type: "comparison-card", title: "厂商 A", points: ["要点 1", "要点 2", "要点 3"] } as unknown as DomNode,
            { id: "t.c2", type: "comparison-card", title: "厂商 B", points: ["要点 1", "要点 2", "要点 3"] } as unknown as DomNode,
          ],
        } as unknown as DomNode,
      ],
    };
    const blocking = blockingFor(slide);
    const factoryFail = blocking.filter((d) =>
      d.code === "FALLBACK_FAILED" &&
      d.constrainedBy?.prop === "fixedHeight" &&
      /\.(title|value|label|num|body|plan|period|caption)$/.test(String(d.constrainedBy?.ancestorId || ""))
    );
    expect(factoryFail, factoryFail.map((d) => `${d.nodeId}: ${d.constrainedBy?.ancestorId}`).join("\n")).toHaveLength(0);
  });

  it("hero-stat inside a tight panel doesn't FALLBACK on internal fixedHeight", () => {
    const slide: SlideV2 = {
      id: "panel",
      children: [{
        id: "panel.outer",
        type: "panel",
        // Tighter than hero-stat's intrinsic — used to trigger fixedHeight
        // FALLBACKs on value/label/caption.
        fixedHeight: 4.5,
        children: [{
          id: "panel.outer.hero",
          type: "hero-stat",
          value: "1,234,567亿+",
          label: "市场规模（YoY 持续 30%+ 增长）",
          caption: "数据更新于 2026 Q1",
          tone: "brand",
        } as unknown as DomNode],
      } as unknown as DomNode],
    };
    const blocking = blockingFor(slide);
    const factoryFail = blocking.filter((d) =>
      d.code === "FALLBACK_FAILED" &&
      d.constrainedBy?.prop === "fixedHeight" &&
      /\.(value|label|caption)$/.test(String(d.constrainedBy?.ancestorId || ""))
    );
    expect(factoryFail, factoryFail.map((d) => d.message).join("\n")).toHaveLength(0);
  });
});

describe("dark theme: same composites, none collapse on muted/semantic accents", () => {
  const dark: Slideml2SourceDeck["deck"]["themeOverride"] = {
    colors: {
      brand: { primary: "C0392B" },
      background: "0D1117",
      surface: "161B22",
      text: { primary: "F0F6FC", secondary: "8B949E", muted: "484F58", inverse: "0D1117" },
    } as never,
  };

  it("hero-stat tone:'positive' on dark theme stays readable (no LOW_CONTRAST after auto-fix)", () => {
    const slide: SlideV2 = {
      id: "s",
      children: [{
        id: "s.hero",
        type: "hero-stat",
        value: "+78%",
        label: "增长率",
        caption: "近三年复合增长",
        tone: "positive",
      } as unknown as DomNode],
    };
    const blocking = blockingFor(slide, dark);
    const lowContrast = blocking.filter((d) => d.code === "LOW_CONTRAST");
    expect(lowContrast, lowContrast.map((d) => d.message).join("\n")).toHaveLength(0);
  });

  it("statComparison up trend on dark theme stays readable", () => {
    const slide: SlideV2 = {
      id: "s",
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
    };
    const blocking = blockingFor(slide, dark);
    const lowContrast = blocking.filter((d) => d.code === "LOW_CONTRAST");
    expect(lowContrast, lowContrast.map((d) => d.message).join("\n")).toHaveLength(0);
  });
});
