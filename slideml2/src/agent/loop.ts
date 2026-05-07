import { auditDeck } from "../audit.js";
import { companyOverviewLayout } from "../components.js";
import { applyEdits } from "../edit.js";
import { inspectDeck } from "../inspect.js";
import type { AgentTask, AuditIssue, DomNode, EditOp, RenderedDeck } from "../types.js";

export interface AgentLoopResult {
  deck: RenderedDeck;
  rounds: number;
  appliedOps: EditOp[];
}

export function runSimpleAgentLoop(initialDeck: RenderedDeck, task: AgentTask, maxRounds = 4): AgentLoopResult {
  let deck = JSON.parse(JSON.stringify(initialDeck)) as RenderedDeck;
  const appliedOps: EditOp[] = [];
  for (let round = 0; round < maxRounds; round++) {
    const audit = auditDeck(deck, task);
    if (audit.ok) return { deck, rounds: round, appliedOps };
    const inspect = inspectDeck(deck);
    const ops = proposeEdits(deck, audit.issues, inspect);
    if (ops.length === 0) return { deck, rounds: round + 1, appliedOps };
    deck = applyEdits(deck, ops);
    appliedOps.push(...ops);
  }
  return { deck, rounds: maxRounds, appliedOps };
}

function proposeEdits(deck: RenderedDeck, issues: AuditIssue[], inspect: ReturnType<typeof inspectDeck>): EditOp[] {
  const ops: EditOp[] = [];
  for (const issue of issues) {
    if (issue.code === "COVER_BACKGROUND" && issue.slideId) {
      ops.push({ op: "setSlideProp", slideId: issue.slideId, prop: "background", value: "brand.primary" });
    }
    if (issue.code === "BRAND_LOGO_POSITION") {
      for (const slide of deck.slides) {
        ops.push({ op: "setNodeProp", slideId: slide.id, nodeName: `${slide.id}.brandLogo`, prop: "anchor", value: "bottom-right" });
      }
    }
    if (issue.code === "MISSING_BRAND_LOGO" && deck.deck.brand.logo) {
      for (const slide of deck.slides) {
        ops.push({ op: "insertNode", slideId: slide.id, parentName: slide.dom.id, node: brandLogoNode(slide.id, deck.deck.brand.logo) });
      }
    }
    if (issue.code === "MISSING_BUSINESS_BULLETS" && issue.slideId) {
      ops.push({
        op: "insertNode",
        slideId: issue.slideId,
        parentName: `${issue.slideId}.content`,
        node: {
          id: `${issue.slideId}.businessLines`,
          type: "bullets",
          items: ["学习服务", "智能硬件", "在线营销"],
          density: "comfortable",
        },
      });
    }
    if (issue.code === "MISSING_COMPANY_OVERVIEW_LAYOUT" && issue.slideId) {
      const slide = deck.slides.find((item) => item.id === issue.slideId);
      const slideInspection = inspect.slides.find((item) => item.id === issue.slideId);
      if (slide && slideInspection) {
        const hasMainContent = slideInspection.nodes.some((node) => node.id === `${slide.id}.content`);
        if (hasMainContent) ops.push({ op: "deleteNode", slideId: slide.id, nodeName: `${slide.id}.content` });
        ops.push({
          op: "insertNode",
          slideId: slide.id,
          parentName: slide.dom.id,
          position: { after: `${slide.id}.title` },
          node: companyOverviewLayout({
            slideId: slide.id,
            visualSrc: deck.deck.brand.logo || "",
            summary: "有道是网易旗下智能学习公司，业务覆盖学习服务、智能硬件与在线营销。",
            businessLines: ["学习服务", "智能硬件", "在线营销"],
            metrics: [
              { name: "metric-revenue", value: "56.3亿", label: "2024年营收" },
              { name: "metric-profit", value: "首次", label: "全年盈利" },
              { name: "metric-users", value: "2.8亿+", label: "月活用户" },
            ],
          }),
        });
      }
    }
  }
  return dedupeOps(ops);
}

function brandLogoNode(slideId: string, logo: string): DomNode {
  return {
    id: `${slideId}.brandLogo`,
    type: "image",
    src: logo,
    alt: "Brand logo",
    anchor: "bottom-right",
    width: 2.4,
    height: 1.0,
    fit: "contain",
  };
}

function dedupeOps(ops: EditOp[]): EditOp[] {
  const seen = new Set<string>();
  return ops.filter((op) => {
    const key = JSON.stringify(op);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
