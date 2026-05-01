import { auditDeck } from "./audit.js";
import { generateWithComponentAgent } from "./agent/component-agent.js";
import { runSimpleAgentLoop } from "./agent/loop.js";
import { generateFromMarkdown } from "./agent/markdown-pipeline.js";
import { designComplexDeck, designDeckFromBrief } from "./agent/page-designer.js";
import { buildDom } from "./layouts.js";
import { renderToPptx } from "./render.js";
import type { AgentTask, Slideml2Deck } from "./types.js";

export async function generateComponentLayoutDemo(outputPath: string): Promise<void> {
  const task: AgentTask = {
    requireBrandLogoBottomRight: true,
    requireCompanyOverviewLayout: { slideId: "overview" },
  };
  const initial = buildDom(demoSource());
  const result = runSimpleAgentLoop(initial, task);
  const audit = auditDeck(result.deck, task);
  if (!audit.ok) throw new Error(`Demo agent loop did not satisfy audit: ${audit.issues.map((issue) => issue.code).join(", ")}`);
  await renderToPptx(result.deck, outputPath);
}

export async function generateBriefLayoutDemo(outputPath: string): Promise<void> {
  const logo = dataSvg("<svg xmlns='http://www.w3.org/2000/svg' width='240' height='96'><rect width='240' height='96' rx='10' fill='#E8382C'/><text x='120' y='60' text-anchor='middle' font-family='Arial' font-size='40' font-weight='700' fill='white'>Youdao</text></svg>");
  const deck = designDeckFromBrief(
    { name: "Youdao", primary: "E8382C", logo },
    {
      slideId: "brief",
      title: "有道智能学习业务",
      body: "有道围绕学习服务、智能硬件和在线营销构建业务组合，依托教育大模型和网易生态提升产品体验。",
      imageSrc: logo,
      imageTitle: "有道品牌与智能学习产品",
    },
  );
  await renderToPptx(deck, outputPath);
}

export async function generateComplexLayoutDemo(outputPath: string): Promise<void> {
  const logo = demoLogo();
  const deck = designComplexDeck(
    { name: "Youdao", primary: "E8382C", logo },
    {
      dashboard: {
        slideId: "dashboard",
        title: "业务经营概览",
        summary: "学习服务、智能硬件与在线营销形成互补组合，增长质量取决于 AI 能力和硬件入口的协同。",
        metrics: [
          { name: "metric-revenue", value: "56.3亿", label: "2024年营收" },
          { name: "metric-profit", value: "首次", label: "全年盈利" },
          { name: "metric-users", value: "2.8亿+", label: "月活用户" },
        ],
        bullets: ["硬件承担高频学习入口", "大模型提升学习服务体验", "营销业务提供现金流支撑"],
        imageSrc: logo,
        imageTitle: "品牌入口与学习场景",
      },
      timeline: {
        slideId: "timeline",
        title: "从工具到 AI 学习平台",
        intro: "页面需要同时容纳阶段说明和四个演进节点，自动布局要保留标题、导语和卡片间距。",
        steps: [
          { title: "词典入口", body: "用高频工具建立用户基础。" },
          { title: "内容服务", body: "扩展课程、翻译和学习资源。" },
          { title: "智能硬件", body: "用词典笔等设备进入学习现场。" },
          { title: "AI Agent", body: "把大模型能力嵌入学习流程。" },
        ],
      },
      comparison: {
        slideId: "comparison",
        title: "三类业务的角色分工",
        thesis: "复杂页面不应该把所有信息挤成一组均分文本框，而应保留主结论和并列比较区。",
        columns: [
          { title: "学习服务", points: ["内容和订阅承接需求", "AI 提升个性化体验", "适合做长期留存"] },
          { title: "智能硬件", points: ["形成场景入口", "具备品牌可见度", "推动软硬件协同"] },
          { title: "在线营销", points: ["贡献现金流", "依托用户规模", "支持业务投入"] },
        ],
      },
    },
  );
  await renderToPptx(deck, outputPath);
}

export async function generateMarkdownPipelineDemo(markdownPath: string, outputPath: string, useLlm = false): Promise<void> {
  await generateFromMarkdown(markdownPath, outputPath, demoLogo(), { useLlm });
}

export async function generateComponentAgentDemo(markdownPath: string, outputPath: string): Promise<void> {
  await generateWithComponentAgent(markdownPath, outputPath, demoLogo());
}

function demoSource(): Slideml2Deck {
  return {
    slideml2: 1,
    deck: {
      size: "16x9",
      theme: "simple",
      brand: {
        name: "Youdao",
        primary: "E8382C",
        logo: demoLogo(),
      },
    },
    slides: [
      { id: "cover", layout: "cover", title: "Youdao Company", subtitle: "Semantic component layout demo" },
      { id: "overview", layout: "title-and-content", title: "Company overview", items: ["Weak generated content to be replaced"] },
    ],
  };
}

function dataSvg(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function demoLogo(): string {
  return dataSvg("<svg xmlns='http://www.w3.org/2000/svg' width='240' height='96'><rect width='240' height='96' rx='10' fill='#E8382C'/><text x='120' y='60' text-anchor='middle' font-family='Arial' font-size='40' font-weight='700' fill='white'>Youdao</text></svg>");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] === "--complex" ? "complex" : process.argv[2] === "--markdown" ? "markdown" : process.argv[2] === "--markdown-llm" ? "markdown-llm" : process.argv[2] === "--component-agent" ? "component-agent" : "brief";
  const outputPath = mode === "complex"
    ? (process.argv[3] || "/Users/river/Documents/Workspace/slideml2_complex_layout_demo.pptx")
    : mode === "markdown" || mode === "markdown-llm" || mode === "component-agent"
      ? (process.argv[4] || "/Users/river/Documents/Workspace/slideml2_markdown_pipeline_demo.pptx")
      : (process.argv[2] || "/Users/river/Documents/Workspace/slideml2_brief_layout_demo.pptx");
  if (mode === "complex") await generateComplexLayoutDemo(outputPath);
  else if (mode === "markdown" || mode === "markdown-llm") await generateMarkdownPipelineDemo(process.argv[3] || "slideml2/examples/youdao_ai_learning.md", outputPath, mode === "markdown-llm");
  else if (mode === "component-agent") await generateComponentAgentDemo(process.argv[3] || "slideml2/examples/youdao_ai_learning.md", outputPath);
  else await generateBriefLayoutDemo(outputPath);
  console.log(outputPath);
}
