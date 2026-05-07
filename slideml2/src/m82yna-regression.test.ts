import { describe, expect, it } from "vitest";
import { clearRenderDiagnostics } from "./diagnostics.js";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";

const EMU_PER_CM = 360000;

function deck(slides: SlideV2[]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: "default",
      brand: { name: "AI Agent 报告", primary: "1E40AF" },
      themeOverride: {
        colors: {
          "brand.primary": "1E40AF",
          background: "F8FAFC",
          surface: "FFFFFF",
          "text.primary": "1E293B",
          "text.secondary": "475569",
          divider: "E2E8F0",
          success: "10B981",
          warning: "F59E0B",
          danger: "EF4444",
        },
        text: {
          "slide-title": { fontSize: 32, fontWeight: "bold" },
          paragraph: { fontSize: 14 },
        },
      },
    },
    slides,
  };
}

describe("m82yna visual regressions", () => {
  it("short callout and quote components do not stretch to cover the remaining slide height", () => {
    const source = deck([
      {
        id: "horizon-36m",
        title: "36个月格局演化（至 2029）",
        children: [
          { id: "h36.win", type: "label", text: "长期赢家", tone: "positive" },
          {
            id: "h36.witems",
            type: "text",
            text: "模型方：日韩/东南亚英语场景拿走 80% C 端价值\n中国四巨头：字节 + 阿里 + 智谱 + Kimi 瓜分市场\n垂直 Agent：保险/医疗/法律/财税走得更稳",
            color: "text.primary",
          },
          { id: "h36.lose", type: "label", text: "长期输家", tone: "danger" },
          {
            id: "h36.litems",
            type: "text",
            text: "Microsoft Copilot / Notion / Slack：降级为数据后端\n通用 OCR API：被商品化吃掉\n无护城河的 wrapper 公司消亡",
            color: "text.primary",
          },
          {
            id: "h36.unk",
            type: "callout",
            variant: "card",
            tone: "warning",
            title: "仍未明朗",
            content: [{ text: "vibe office / 出海华人 $10B+ / 中美分化？" }],
          },
        ],
      },
      {
        id: "final-rec",
        title: "最终建议",
        children: [
          { id: "fr.t1", type: "label", text: "核心行动项", tone: "brand" },
          {
            id: "fr.t2",
            type: "text",
            text: "① 选地理：中国 vs 出海，必须选一个\n② 选垂直：保险/财税/医疗/法律 + 特定地理\n③ 选退出锚：港股 IPO / 美股 / 战略并购\n④ 选 GTM：项目制 / SaaS / 开源\n⑤ 36月目标：$30-100M ARR / ¥1-5亿 ARR",
            color: "text.primary",
          },
          {
            id: "fr.quote",
            type: "quote",
            text: "不要做最大，要做最深。这是一个「分形 winner」的市场。",
            source: "核心洞察",
          },
        ],
      },
    ]);

    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(source));
    const calloutBg = ast.slides[0]!.shapes.find((shape) => shape.type === "shape" && shape.name === "h36.unk-background");
    const quoteBg = ast.slides[1]!.shapes.find((shape) => shape.type === "shape" && shape.name === "fr.quote-background");

    expect((calloutBg?.xfrm.cy || 0) / EMU_PER_CM).toBeLessThan(4.2);
    expect((quoteBg?.xfrm.cy || 0) / EMU_PER_CM).toBeLessThan(5.4);
  });

  it("dense fact-list without interpretation/source renders as a two-column table", () => {
    const source = deck([{
      id: "valuations",
      title: "关键数据速查",
      children: [{
        id: "val.global",
        type: "fact-list",
        title: "全球头部公司估值",
        variant: "list",
        items: [
          { label: "Glean", fact: "$7.2B / $200M ARR" },
          { label: "Harvey", fact: "$11B（法律）" },
          { label: "Sierra", fact: "$4B+" },
          { label: "Browserbase", fact: "$300M / 70× ARR" },
          { label: "Reducto", fact: "$600-900M est / $108M" },
          { label: "Mistral OCR", fact: "$2/1000 页（商品化地板）" },
        ],
      }],
    }]);

    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(source));
    const table = ast.slides[0]!.shapes.find((shape) => shape.type === "table" && shape.name === "valuations.val.global.items");

    expect(table?.type).toBe("table");
    if (table?.type !== "table") throw new Error("Expected fact-list table shape");
    expect(table.colWidths).toHaveLength(2);
    expect(table.cells.every((row) => row.length === 2)).toBe(true);
  });
});
